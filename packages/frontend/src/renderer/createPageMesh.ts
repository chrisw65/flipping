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
  getSide: () => "left" | "right";
};

/**
 * Creates a page mesh for a book lying FLAT on the XZ plane.
 *
 * Coordinate system per spec Section 3.2.2:
 * - Book lies flat on XZ plane (horizontal)
 * - Pages face UP (+Y direction)
 * - Spine runs along Z axis at X=0
 * - Right page extends in +X direction
 * - Left page extends in -X direction
 * - Page turn rotates around Y axis (the spine)
 */
export function createPageMesh(): PageMesh {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  // We'll create geometry dynamically when size is set
  let geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);

  // Group for positioning in the scene
  const group = new THREE.Group();
  group.add(mesh);

  let pageSide: "left" | "right" = "right";
  let currentWidth = 1;
  let currentHeight = 1;
  let isAnimating = false;

  /**
   * Create geometry with pivot at spine edge.
   * For right page: pivot at left edge (x=0), page extends to +x
   * For left page: pivot at right edge (x=0), page extends to -x
   */
  const createGeometryWithPivot = (width: number, height: number, side: "left" | "right") => {
    // Create plane geometry lying flat on XZ plane
    // PlaneGeometry creates vertices centered at origin, we need to offset them
    const geo = new THREE.PlaneGeometry(width, height, 1, 1);

    // Rotate to lie flat on XZ plane (face up)
    geo.rotateX(-Math.PI / 2);

    // Now the plane is on XZ plane, centered at origin
    // We need to translate so the spine edge is at x=0

    const positions = geo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      if (side === "right") {
        // Right page: shift so left edge is at x=0, page extends to +x
        positions.setX(i, x + width / 2);
      } else {
        // Left page: shift so right edge is at x=0, page extends to -x
        positions.setX(i, x - width / 2);
      }
    }
    positions.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    return geo;
  };

  /**
   * Set turn progress: 0 = flat, 1 = fully turned (180 degrees)
   * Page rotates around Y axis (spine) at X=0
   */
  const setProgress = (progress: number) => {
    const clampedProgress = Math.max(0, Math.min(1, progress));

    // Rotation angle: 0 to PI (180 degrees) around Y axis
    const angle = clampedProgress * Math.PI;

    if (pageSide === "right") {
      // Right page: rotates counterclockwise (negative Y) to flip over spine to left
      mesh.rotation.y = -angle;
    } else {
      // Left page: rotates clockwise (positive Y) to flip over spine to right
      mesh.rotation.y = angle;
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

    // Dispose old geometry and create new one with proper pivot
    if (geometry) {
      geometry.dispose();
    }
    geometry = createGeometryWithPivot(width, height, pageSide);
    mesh.geometry = geometry;

    // Mesh stays at origin - the geometry vertices are offset instead
    mesh.position.set(0, 0, 0);
  };

  const setSide = (side: "left" | "right") => {
    pageSide = side;
    // Re-create geometry with new pivot
    setSize(currentWidth, currentHeight);
    // Reset rotation
    setProgress(0);
  };

  const getSide = () => pageSide;

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
    // Reserved for future time-based effects
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
    getSide,
  };
}
