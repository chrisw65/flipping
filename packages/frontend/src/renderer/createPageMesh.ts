import * as THREE from "three";
import { getCurveAngle, updateSheetGeometry } from "./dflipDeform";

export type PageMesh = {
  group: THREE.Group;
  mesh: THREE.Mesh;
  setProgress: (progress: number) => void;
  setAngle: (angleDeg: number) => void;
  getAngle: () => number;
  setTexture: (texture: THREE.Texture | null) => void;
  setBackTexture: (texture: THREE.Texture | null) => void;
  setFrontVisible: (visible: boolean) => void;
  setFrontBiasDelta: (delta: number) => void;
  setFrontDepthWrite: (enabled: boolean) => void;
  setSize: (width: number, height: number) => void;
  beginAnimation: () => void;
  endAnimation: () => void;
  getMaterial: () => THREE.MeshPhongMaterial;
  update: (time: number) => void;
  setSide: (side: "left" | "right") => void;
  getSide: () => "left" | "right";
  setDepthBias: (bias: number) => void;
};

/**
 * Creates a page mesh for a book lying FLAT on the XZ plane.
 *
 * Coordinate system:
 * - Book lies flat on XZ plane (horizontal, like on a table)
 * - Pages face UP (+Y direction)
 * - Spine runs along Z axis at X=0
 * - Right page extends in +X direction
 * - Left page extends in -X direction
 *
 * Page turn rotation:
 * - Pages rotate around the SPINE (Z axis at X=0)
 * - This lifts the page up and swings it over to the other side
 */
export function createPageMesh(): PageMesh {
  const faceMaterials = createFaceMaterials();
  let geometry = createSheetGeometry(1, 1, 0.01, 60);
  const mesh = new THREE.Mesh(geometry, faceMaterials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Group positioned at spine (X=0) - the mesh rotates within the group
  const group = new THREE.Group();
  group.add(mesh);

  let pageSide: "left" | "right" = "right";
  let currentWidth = 1;
  let currentHeight = 1;
  let currentDepth = 0.01;
  let currentSegments = 60;
  let isAnimating = false;
  let sheetAngleDeg = 0;
  let curveAngleDeg = 0;
  let flexibility = 0.9;

  let baseBias = 0;
  let frontBiasDelta = 0;

  /**
   * Create segmented box geometry for a page lying flat on XZ plane.
   * Width = X, Height = Z, Depth = Y (paper thickness).
   */
  const createSheet = (width: number, height: number, depth: number, segments: number) =>
    createSheetGeometry(width, height, depth, segments);

  const applyDeform = () => {
    const isLeftTurn = pageSide === "right";
    const curve = getCurveAngle(isLeftTurn, sheetAngleDeg, 0);
    curveAngleDeg = curve;

    const result = updateSheetGeometry(geometry, {
      width: currentWidth,
      height: currentHeight,
      depth: currentDepth,
      segments: currentSegments,
      sheetAngleDeg,
      curveAngleDeg,
      flexibility,
      isHard: false,
      orientation: "horizontal",
      pageOffset: 0.05,
      pageSide: pageSide === "right" ? 1 : -1,
    });

    mesh.position.copy(result.positionOffset);
    mesh.scale.x = result.scaleX;
  };

  /**
   * Set turn progress: 0 = flat, 1 = fully turned (180 degrees)
   * Uses deformable sheet geometry for curl realism.
   */
  const setProgress = (progress: number) => {
    const clampedProgress = Math.max(0, Math.min(1, progress));
    setAngle(clampedProgress * 180);
  };

  const setTexture = (texture: THREE.Texture | null) => {
    // Set texture on all materials EXCEPT material 4 (back face)
    // Material 4 is controlled separately by setBackTexture()
    for (let i = 0; i < faceMaterials.length; i++) {
      if (i === 4) continue; // Skip back face material
      const mat = faceMaterials[i] as THREE.MeshPhongMaterial;
      mat.map = texture ?? null;
      mat.needsUpdate = true;
    }
  };

  const setDepthBias = (bias: number) => {
    baseBias = bias;
    const front = faceMaterials[5] as THREE.MeshPhongMaterial;
    const back = faceMaterials[4] as THREE.MeshPhongMaterial;
    const delta = 0.6;

    const apply = (mat: THREE.MeshPhongMaterial, value: number) => {
      if (value !== 0) {
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = value;
        mat.polygonOffsetUnits = value;
      } else {
        mat.polygonOffset = false;
        mat.polygonOffsetFactor = 0;
        mat.polygonOffsetUnits = 0;
      }
      mat.needsUpdate = true;
    };

    // Separate front/back slightly to avoid z-fighting in the curl.
    // Keep back closer than front so the reverse side wins during curl.
    apply(front, bias + delta + frontBiasDelta);
    apply(back, bias - delta);
  };

  const setBackTexture = (texture: THREE.Texture | null) => {
    const back = faceMaterials[4] as THREE.MeshPhongMaterial;
    back.map = texture;
    back.needsUpdate = true;
  };

  const setFrontVisible = (visible: boolean) => {
    const front = faceMaterials[5] as THREE.MeshPhongMaterial;
    front.visible = visible;
    front.needsUpdate = true;
  };

  const setFrontBiasDelta = (delta: number) => {
    frontBiasDelta = delta;
    setDepthBias(baseBias);
  };

  const setFrontDepthWrite = (enabled: boolean) => {
    const front = faceMaterials[5] as THREE.MeshPhongMaterial;
    front.depthWrite = enabled;
    front.needsUpdate = true;
  };

  const setSize = (width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
    currentWidth = width;
    currentHeight = height;

    // Dispose old geometry and create new one
    if (geometry) {
      geometry.dispose();
    }
    geometry = createSheet(width, height, currentDepth, currentSegments);
    mesh.geometry = geometry;
    applyDeform();
  };

  const setSide = (side: "left" | "right") => {
    pageSide = side;
    // Re-create geometry for the new side
    setSize(currentWidth, currentHeight);
    // Reset rotation
    setProgress(0);

    // When X coordinates are flipped for left pages, the triangle winding
    // reverses, which inverts the computed normals. Use BackSide for left
    // pages so the faces render correctly.
    const materialSide = side === "left" ? THREE.BackSide : THREE.FrontSide;
    (faceMaterials[4] as THREE.MeshPhongMaterial).side = materialSide;
    (faceMaterials[5] as THREE.MeshPhongMaterial).side = materialSide;
  };

  const getSide = () => pageSide;

  const setAngle = (angleDeg: number) => {
    sheetAngleDeg = Math.max(0, Math.min(180, angleDeg));
    applyDeform();
  };
  const getAngle = () => sheetAngleDeg;

  const beginAnimation = () => {
    if (isAnimating) return;
    isAnimating = true;
    mesh.renderOrder = 10;
  };

  const endAnimation = () => {
    if (!isAnimating) return;
    isAnimating = false;
    mesh.renderOrder = 1;
  };

  const getMaterial = () => faceMaterials[5] as THREE.MeshPhongMaterial;

  const update = (_time: number) => {
    // Reserved for future effects
  };

  // Initialize as right page
  setSide("right");

  return {
    group,
    mesh,
    setProgress,
    setAngle,
    getAngle,
    setTexture,
    setBackTexture,
    setFrontVisible,
    setFrontBiasDelta,
    setFrontDepthWrite,
    setSize,
    beginAnimation,
    endAnimation,
    getMaterial,
    update,
    setSide,
    getSide,
    setDepthBias,
  };
}

function createSheetGeometry(
  width: number,
  height: number,
  depth: number,
  segments: number
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const E = Math.max(segments + 1, 2);
  const count = E * 4;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

  const yFront = depth / 2;
  const yBack = -depth / 2;
  const zTop = height / 2;
  const zBottom = -height / 2;

  const frontTop = 0;
  const frontBottom = E;
  const backTop = E * 2;
  const backBottom = E * 3;

  for (let i = 0; i < E; i++) {
    const u = i / (E - 1);
    const x = width * u;

    setVertex(positions, frontTop + i, x, yFront, zTop);
    setVertex(positions, frontBottom + i, x, yFront, zBottom);
    setVertex(positions, backTop + i, x, yBack, zTop);
    setVertex(positions, backBottom + i, x, yBack, zBottom);

    setUv(uvs, frontTop + i, u, 0);
    setUv(uvs, frontBottom + i, u, 1);
    setUv(uvs, backTop + i, 1 - u, 0);
    setUv(uvs, backBottom + i, 1 - u, 1);
  }

  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

  const indices: number[] = [];
  for (let i = 0; i < E - 1; i++) {
    const a = frontTop + i;
    const b = frontTop + i + 1;
    const c = frontBottom + i;
    const d = frontBottom + i + 1;
    indices.push(a, c, b, b, c, d);
  }

  const frontCount = indices.length;
  for (let i = 0; i < E - 1; i++) {
    const a = backTop + i;
    const b = backTop + i + 1;
    const c = backBottom + i;
    const d = backBottom + i + 1;
    indices.push(a, b, c, b, d, c);
  }

  geo.setIndex(indices);
  geo.clearGroups();
  geo.addGroup(0, frontCount, 5);
  geo.addGroup(frontCount, indices.length - frontCount, 4);
  geo.userData.layout = { E, frontTop, frontBottom, backTop, backBottom };

  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function setVertex(
  positions: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number
) {
  const p = index * 3;
  positions[p] = x;
  positions[p + 1] = y;
  positions[p + 2] = z;
}

function setUv(uvs: Float32Array, index: number, u: number, v: number) {
  const t = index * 2;
  uvs[t] = u;
  uvs[t + 1] = v;
}

function createFaceMaterials(): THREE.Material[] {
  const base = {
    color: 0xffffff,
    shininess: 6,
    specular: 0x111111,
    emissive: 0x050505,
  };
  const materials: THREE.MeshPhongMaterial[] = [];
  for (let i = 0; i < 6; i++) {
    materials.push(new THREE.MeshPhongMaterial({ ...base }));
  }
  materials[4].color = new THREE.Color(0xf2efe7);
  materials[5].color = new THREE.Color(0xffffff);
  materials[4].side = THREE.FrontSide;
  materials[5].side = THREE.FrontSide;
  return materials;
}
