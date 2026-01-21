import * as THREE from "three";

export type PageMesh = {
  group: THREE.Group;
  mesh: THREE.Mesh;
  setProgress: (progress: number) => void;
  setTexture: (texture: THREE.Texture | null) => void;
  setSize: (width: number, height: number) => void;
  beginAnimation: () => void;
  endAnimation: () => void;
  getMaterial: () => THREE.MeshStandardMaterial;
  update: (time: number) => void;
  setSide: (side: "left" | "right") => void;
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
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  // Create a simple plane - we position it so the spine edge is at origin
  let geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);

  // Group positioned at spine (X=0) - the mesh rotates within the group
  const group = new THREE.Group();
  group.add(mesh);

  let pageSide: "left" | "right" = "right";
  let currentWidth = 1;
  let currentHeight = 1;
  let isAnimating = false;

  /**
   * Create geometry for a page lying flat on XZ plane.
   * The page is positioned so the spine edge is at the local origin.
   */
  const createPageGeometry = (width: number, height: number, side: "left" | "right") => {
    // Create plane in XZ orientation (lying flat, facing up)
    // We'll build it directly in XZ plane instead of rotating XY
    const geo = new THREE.BufferGeometry();

    // For a page lying flat:
    // - X is the width direction (left-right)
    // - Y is up (page faces up, thickness negligible)
    // - Z is the height direction (top-bottom of page, along spine)

    let vertices: number[];
    let uvs: number[];

    if (side === "right") {
      // Right page: spine at x=0 (left edge), extends to +x
      // Vertices go from x=0 to x=width, z from -height/2 to +height/2
      vertices = [
        0, 0, -height / 2,          // bottom-left (at spine)
        width, 0, -height / 2,      // bottom-right
        width, 0, height / 2,       // top-right
        0, 0, height / 2,           // top-left (at spine)
      ];
      // UVs: u goes 0->1 from spine to outer edge, v goes 0->1 bottom to top
      uvs = [
        0, 0,  // bottom-left
        1, 0,  // bottom-right
        1, 1,  // top-right
        0, 1,  // top-left
      ];
    } else {
      // Left page: spine at x=0 (right edge), extends to -x
      vertices = [
        0, 0, -height / 2,           // bottom-right (at spine)
        -width, 0, -height / 2,      // bottom-left
        -width, 0, height / 2,       // top-left
        0, 0, height / 2,            // top-right (at spine)
      ];
      // UVs: flip horizontally so texture reads correctly
      uvs = [
        1, 0,  // bottom-right (at spine, but UV flipped)
        0, 0,  // bottom-left
        0, 1,  // top-left
        1, 1,  // top-right (at spine)
      ];
    }

    // Two triangles to make the quad
    const indices = [0, 1, 2, 0, 2, 3];

    geo.setIndex(indices);
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();

    return geo;
  };

  /**
   * Set turn progress: 0 = flat, 1 = fully turned (180 degrees)
   * Page rotates around Z axis (the spine runs along Z)
   */
  const setProgress = (progress: number) => {
    const clampedProgress = Math.max(0, Math.min(1, progress));

    // Rotation angle: 0 to PI (180 degrees) around Z axis
    const angle = clampedProgress * Math.PI;

    if (pageSide === "right") {
      // Right page: starts flat (angle 0), rotates to flip over spine
      // Positive Z rotation lifts the right edge up and over to the left
      mesh.rotation.z = angle;
    } else {
      // Left page: starts flat, rotates the opposite direction
      // Negative Z rotation lifts the left edge up and over to the right
      mesh.rotation.z = -angle;
    }
  };

  const setTexture = (texture: THREE.Texture | null) => {
    material.map = texture;
    material.needsUpdate = true;
  };

  const setSize = (width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
    currentWidth = width;
    currentHeight = height;

    // Dispose old geometry and create new one
    if (geometry) {
      geometry.dispose();
    }
    geometry = createPageGeometry(width, height, pageSide);
    mesh.geometry = geometry;
  };

  const setSide = (side: "left" | "right") => {
    pageSide = side;
    // Re-create geometry for the new side
    setSize(currentWidth, currentHeight);
    // Reset rotation
    setProgress(0);
  };

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

  const getMaterial = () => material;

  const update = (_time: number) => {
    // Reserved for future effects
  };

  // Initialize as right page
  setSide("right");

  return {
    group,
    mesh,
    setProgress,
    setTexture,
    setSize,
    beginAnimation,
    endAnimation,
    getMaterial,
    update,
    setSide,
  };
}
