import * as THREE from "three";
import { pageVertexShader, pageFragmentShader } from "./pageShader";

export type PageMesh = {
  group: THREE.Group;
  mesh: THREE.Mesh;
  setProgress: (progress: number) => void;
  setTexture: (texture: THREE.Texture | null) => void;
  setSize: (width: number, height: number) => void;
  beginAnimation: () => void;
  endAnimation: () => void;
  getMaterial: () => THREE.ShaderMaterial;
  update: (time: number) => void;
};

/**
 * Creates a page mesh with conical deformation shader
 * per the Production Technical Specification
 */
export function createPageMesh(): PageMesh {
  // Higher subdivision for smooth deformation per spec (50x50 recommended)
  const geometry = new THREE.PlaneGeometry(1, 1, 50, 50);

  // Full shader uniforms for conical deformation
  const uniforms = {
    uTexture: { value: null as THREE.Texture | null },
    uHasTexture: { value: 0.0 },
    // Curl animation
    uCurlProgress: { value: 0.0 },
    uApex: { value: new THREE.Vector3(0, 0, -0.5) },
    uFoldAxis: { value: new THREE.Vector3(0, 1, 0).normalize() },
    uConeAngle: { value: Math.PI / 6 }, // 30 degrees
    uStiffness: { value: 0.4 }, // Paper stiffness (0-1)
    uTime: { value: 0.0 },
    uPageSide: { value: 1.0 }, // 1.0 for front, -1.0 for back
    // Lighting
    uLightPosition: { value: new THREE.Vector3(2, 2, 3) },
    uLightColor: { value: new THREE.Vector3(1, 1, 1) },
    uAmbientStrength: { value: 0.4 },
    uRoughness: { value: 0.8 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: pageVertexShader,
    fragmentShader: pageFragmentShader,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    // Z-fighting mitigation per Addendum v2.1 Section 4
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = 0.02;
  mesh.renderOrder = 1;

  // Page thickness/edge mesh for 3D appearance
  const thicknessMaterial = new THREE.MeshStandardMaterial({
    color: 0xe6e0d5,
    roughness: 0.9,
    metalness: 0.05,
  });
  const thicknessGeometry = new THREE.BoxGeometry(1, 1, 0.02, 1, 1, 1);
  const thicknessMesh = new THREE.Mesh(thicknessGeometry, thicknessMaterial);
  thicknessMesh.position.z = -0.01;
  thicknessMesh.renderOrder = 0;

  const group = new THREE.Group();
  group.add(mesh);
  group.add(thicknessMesh);

  let isAnimating = false;
  let currentWidth = 1;
  let currentHeight = 1;

  /**
   * Set the curl progress (0 = flat, 1 = fully turned)
   */
  const setProgress = (progress: number) => {
    uniforms.uCurlProgress.value = Math.max(0, Math.min(1, progress));

    // Update cone parameters based on progress
    // As the page turns, the fold axis rotates and apex moves
    const angle = progress * Math.PI * 0.8; // Rotate fold axis
    uniforms.uFoldAxis.value.set(
      Math.sin(angle * 0.3),
      Math.cos(angle * 0.1),
      0
    ).normalize();

    // Cone angle increases as page lifts
    uniforms.uConeAngle.value = Math.PI / 6 + progress * Math.PI / 6;

    // Apex moves along spine as page turns
    uniforms.uApex.value.set(
      -currentWidth * 0.5,
      0,
      -0.2 - progress * 0.3
    );
  };

  const setTexture = (texture: THREE.Texture | null) => {
    uniforms.uTexture.value = texture;
    uniforms.uHasTexture.value = texture ? 1.0 : 0.0;
    material.needsUpdate = true;
  };

  const setSize = (width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
    currentWidth = width;
    currentHeight = height;
    mesh.scale.set(width, height, 1);
    thicknessMesh.scale.set(width, height, 1);
  };

  /**
   * Enable polygon offset when page animation starts
   * Per Addendum v2.1 Section 4: Z-Fighting Mitigation
   */
  const beginAnimation = () => {
    if (isAnimating) return;
    isAnimating = true;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1.0;
    material.polygonOffsetUnits = -4.0;
    material.needsUpdate = true;
  };

  /**
   * Disable polygon offset when page settles
   */
  const endAnimation = () => {
    if (!isAnimating) return;
    isAnimating = false;
    material.polygonOffset = false;
    material.polygonOffsetFactor = 0;
    material.polygonOffsetUnits = 0;
    material.needsUpdate = true;
  };

  const getMaterial = () => material;

  /**
   * Update time uniform for subtle animations
   */
  const update = (time: number) => {
    uniforms.uTime.value = time;
  };

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
  };
}
