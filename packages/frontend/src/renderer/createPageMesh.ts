import * as THREE from "three";
import { simpleVertexShader, simpleFragmentShader } from "./pageShader";

export type PageMesh = {
  group: THREE.Group;
  setProgress: (progress: number) => void;
  setTexture: (texture: THREE.Texture | null) => void;
  setSize: (width: number, height: number) => void;
  beginAnimation: () => void;
  endAnimation: () => void;
  getMaterial: () => THREE.ShaderMaterial;
};

/**
 * Creates a page mesh with shader-based rendering and Z-fighting mitigation
 * per the Production Technical Specification and Addendum v2.1
 */
export function createPageMesh(): PageMesh {
  // Higher subdivision for smooth deformation per spec (50x50 recommended)
  const geometry = new THREE.PlaneGeometry(1, 1, 50, 50);

  // Shader uniforms
  const uniforms = {
    uTexture: { value: null as THREE.Texture | null },
    uHasTexture: { value: 0.0 },
  };

  // Use simple shaders initially - full conical deformation for animations
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: simpleVertexShader,
    fragmentShader: simpleFragmentShader,
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

  const setProgress = (progress: number) => {
    // Placeholder for curl progress - to be used with full shader
    void progress;
  };

  const setTexture = (texture: THREE.Texture | null) => {
    uniforms.uTexture.value = texture;
    uniforms.uHasTexture.value = texture ? 1.0 : 0.0;
    material.needsUpdate = true;
  };

  const setSize = (width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
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
   * Per Addendum v2.1 Section 4
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

  return {
    group,
    setProgress,
    setTexture,
    setSize,
    beginAnimation,
    endAnimation,
    getMaterial,
  };
}
