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
 * Coordinate system per spec Section 3.2.2:
 * - Book lies flat on XZ plane (horizontal)
 * - Pages face UP (+Y direction)
 * - Spine runs along Z axis at X=0
 * - Right page extends in +X direction
 * - Left page extends in -X direction
 * - Page turn rotates around Y axis (the spine)
 */
export function createPageMesh(): PageMesh {
  // Create subdivided geometry for potential deformation
  // Higher subdivision allows for curved page effects
  const segmentsX = 32;
  const segmentsZ = 1;
  const geometry = new THREE.PlaneGeometry(1, 1, segmentsX, segmentsZ);

  // Rotate geometry to lie flat on XZ plane (facing up)
  // PlaneGeometry defaults to XY plane facing +Z, we need XZ facing +Y
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);

  // Group for positioning - the mesh rotates within this around Y axis
  const group = new THREE.Group();
  group.add(mesh);

  let pageSide: "left" | "right" = "right";
  let currentWidth = 1;
  let currentHeight = 1; // This is depth on XZ plane (Z direction)
  let isAnimating = false;
  let turnProgress = 0;

  /**
   * Set turn progress: 0 = flat, 1 = fully turned (180 degrees)
   * Page rotates around Y axis (spine) at X=0
   */
  const setProgress = (progress: number) => {
    turnProgress = Math.max(0, Math.min(1, progress));

    // Rotation angle: 0 to PI (180 degrees) around Y axis
    const angle = turnProgress * Math.PI;

    if (pageSide === "right") {
      // Right page: starts at angle 0 (flat, extending +X)
      // Rotates counterclockwise (negative Y rotation) to flip over spine
      mesh.rotation.y = -angle;
    } else {
      // Left page: starts at angle 0 (flat, extending -X)
      // Rotates clockwise (positive Y rotation) to flip over spine
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

    // Scale the mesh - width is X direction, height is Z direction (depth)
    mesh.scale.set(width, 1, height);

    // Position mesh so its spine edge is at the group origin (X=0)
    // The mesh pivot needs to be at the spine edge for proper rotation
    if (pageSide === "right") {
      // Right page: left edge (spine) at X=0, extends to +X
      mesh.position.set(width / 2, 0, 0);
    } else {
      // Left page: right edge (spine) at X=0, extends to -X
      mesh.position.set(-width / 2, 0, 0);
    }
  };

  const setSide = (side: "left" | "right") => {
    pageSide = side;
    // Re-apply size to update positioning
    setSize(currentWidth, currentHeight);
    // Reset rotation
    setProgress(0);
  };

  const beginAnimation = () => {
    if (isAnimating) return;
    isAnimating = true;
    // Raise render order so animating page appears above static pages
    mesh.renderOrder = 10;
  };

  const endAnimation = () => {
    if (!isAnimating) return;
    isAnimating = false;
    mesh.renderOrder = 1;
  };

  const getMaterial = () => material;

  const update = (_time: number) => {
    // Reserved for future time-based effects (flutter, etc.)
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
