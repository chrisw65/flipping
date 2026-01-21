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
 * Creates a simple page mesh that rotates around the spine
 * Like a real book page turning
 */
export function createPageMesh(): PageMesh {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);

  // Group for positioning - the mesh rotates within this
  const group = new THREE.Group();
  group.add(mesh);

  let pageSide: "left" | "right" = "right";
  let currentWidth = 1;
  let currentHeight = 1;
  let isAnimating = false;

  /**
   * Set turn progress: 0 = flat, 1 = fully turned (180 degrees)
   * Page rotates around its spine edge (the edge at x=0 for right page)
   */
  const setProgress = (progress: number) => {
    const clampedProgress = Math.max(0, Math.min(1, progress));

    // Rotation angle: 0 to PI (180 degrees)
    const angle = clampedProgress * Math.PI;

    if (pageSide === "right") {
      // Right page rotates around its left edge (spine)
      // Pivot is at x=0, so we rotate around Y axis
      mesh.rotation.y = -angle;
    } else {
      // Left page rotates around its right edge (spine)
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

    // Scale the mesh
    mesh.scale.set(width, height, 1);

    // Position mesh so its spine edge is at the group origin
    if (pageSide === "right") {
      // Right page: left edge at origin, extends to +x
      mesh.position.set(width / 2, 0, 0);
    } else {
      // Left page: right edge at origin, extends to -x
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
    mesh.renderOrder = 10;
  };

  const endAnimation = () => {
    if (!isAnimating) return;
    isAnimating = false;
    mesh.renderOrder = 1;
  };

  const getMaterial = () => material;

  const update = (_time: number) => {
    // No time-based updates needed for simple version
  };

  // Initialize
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
