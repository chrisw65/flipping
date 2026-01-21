import * as THREE from "three";

export type PageMesh = {
  group: THREE.Group;
  setProgress: (progress: number) => void;
  setTexture: (texture: THREE.Texture | null) => void;
  setSize: (width: number, height: number) => void;
};

export function createPageMesh() : PageMesh {
  const geometry = new THREE.PlaneGeometry(1, 1, 48, 48);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.02,
    side: THREE.DoubleSide
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `
        float edgeMin = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float bevel = smoothstep(0.0, 0.025, edgeMin);
        gl_FragColor.rgb *= mix(0.9, 1.0, bevel);
        #include <dithering_fragment>
      `
    );
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = 0.02;
  mesh.renderOrder = 1;
  mesh.rotation.x = 0;

  const thicknessMaterial = new THREE.MeshStandardMaterial({
    color: 0xe6e0d5,
    roughness: 0.9,
    metalness: 0.05
  });
  const thicknessGeometry = new THREE.BoxGeometry(1, 1, 0.02, 1, 1, 1);
  const thicknessMesh = new THREE.Mesh(thicknessGeometry, thicknessMaterial);
  thicknessMesh.position.z = -0.02;

  const group = new THREE.Group();
  group.add(mesh);
  group.add(thicknessMesh);

  const setProgress = (progress: number) => {
    // Placeholder for future shader-driven turns.
    void progress;
  };

  const setTexture = (texture: THREE.Texture | null) => {
    material.map = texture;
    material.needsUpdate = true;
  };

  const setSize = (width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
    mesh.scale.set(width, height, 1);
    thicknessMesh.scale.set(width, height, 1);
  };

  return { group, setProgress, setTexture, setSize };
}
