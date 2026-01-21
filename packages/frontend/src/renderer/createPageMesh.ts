import * as THREE from "three";

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
  setSide: (side: "left" | "right") => void;
  getSide: () => "left" | "right";
};

// Vertex shader for book page turn - rotates around spine with paper bend
const bookPageVertexShader = `
  uniform float uTurnProgress;    // 0 = flat on right, 1 = flat on left
  uniform float uPageWidth;
  uniform float uPageHeight;
  uniform float uBendAmount;      // How much the paper bends during turn
  uniform float uTime;
  uniform float uSide;            // 1.0 = right page, -1.0 = left page

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vTurnAmount;

  const float PI = 3.14159265359;

  void main() {
    vUv = uv;

    // Start with the original position
    vec3 pos = position;

    // The page rotates around the spine (left edge of page at x=0)
    // Turn angle: 0 = flat (0 degrees), 1 = fully turned (180 degrees)
    float turnAngle = uTurnProgress * PI;

    // Distance from spine (left edge) determines rotation amount
    // x goes from 0 (spine) to pageWidth (outer edge)
    float distFromSpine = pos.x;
    float normalizedDist = distFromSpine / uPageWidth;

    // Paper bend - pages don't turn rigidly, they curve
    // More bend in the middle of the turn, less at start/end
    float bendPhase = sin(uTurnProgress * PI); // Peak bend at 50%
    float bendCurve = sin(normalizedDist * PI * 0.5); // More bend toward outer edge
    float bend = bendPhase * bendCurve * uBendAmount * uPageHeight * 0.3;

    // Apply the turn rotation around the spine (Y-axis rotation at x=0)
    float cosAngle = cos(turnAngle);
    float sinAngle = sin(turnAngle);

    // Rotate point around Y-axis at x=0
    float rotatedX = pos.x * cosAngle;
    float rotatedZ = pos.x * sinAngle;

    // Add the paper bend (lifts the page during turn)
    float lift = bend;

    // Final position
    vec3 transformed;
    transformed.x = rotatedX;
    transformed.y = pos.y + lift;
    transformed.z = rotatedZ + pos.z;

    // Calculate normal - it rotates with the page
    vec3 baseNormal = vec3(0.0, 0.0, 1.0);
    vec3 rotatedNormal;
    rotatedNormal.x = baseNormal.x * cosAngle + baseNormal.z * sinAngle;
    rotatedNormal.y = baseNormal.y;
    rotatedNormal.z = -baseNormal.x * sinAngle + baseNormal.z * cosAngle;

    // Adjust normal for bend
    float bendNormalTilt = bendPhase * bendCurve * 0.3;
    rotatedNormal.y += bendNormalTilt;
    vNormal = normalize(rotatedNormal);

    vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vTurnAmount = uTurnProgress;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

// Fragment shader for book page
const bookPageFragmentShader = `
  uniform sampler2D uTexture;
  uniform float uHasTexture;
  uniform float uTurnProgress;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vTurnAmount;

  void main() {
    // Base paper color
    vec3 paperColor = vec3(0.96, 0.94, 0.9);

    // Get texture color if available
    vec3 color = paperColor;
    if (uHasTexture > 0.5) {
      vec4 texColor = texture2D(uTexture, vUv);
      color = texColor.rgb;
    }

    // Simple lighting
    vec3 lightDir = normalize(vec3(1.0, 2.0, 3.0));
    vec3 normal = normalize(vNormal);

    // Check if we're viewing the back of the page (normal facing away)
    float facing = dot(normal, vec3(0.0, 0.0, 1.0));
    if (facing < 0.0) {
      // Back of page - show plain paper color, slightly darker
      color = paperColor * 0.92;
      normal = -normal; // Flip normal for lighting
    }

    float diff = max(dot(normal, lightDir), 0.0);
    vec3 ambient = vec3(0.4);
    vec3 lit = color * (ambient + diff * 0.6);

    // Slight shadow during turn
    float turnShadow = 1.0 - vTurnAmount * (1.0 - vTurnAmount) * 0.3;
    lit *= turnShadow;

    // Edge darkening
    float edgeMin = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float bevel = smoothstep(0.0, 0.02, edgeMin);
    lit *= mix(0.9, 1.0, bevel);

    gl_FragColor = vec4(lit, 1.0);
  }
`;

/**
 * Creates a page mesh that turns like a real book page
 * - Rotates around the spine (left edge)
 * - Paper bends naturally during turn
 */
export function createPageMesh(): PageMesh {
  // Higher subdivision for smooth bending
  const geometry = new THREE.PlaneGeometry(1, 1, 40, 20);

  const uniforms = {
    uTexture: { value: null as THREE.Texture | null },
    uHasTexture: { value: 0.0 },
    uTurnProgress: { value: 0.0 },
    uPageWidth: { value: 1.0 },
    uPageHeight: { value: 1.0 },
    uBendAmount: { value: 1.0 },
    uTime: { value: 0.0 },
    uSide: { value: 1.0 }, // 1.0 = right page
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: bookPageVertexShader,
    fragmentShader: bookPageFragmentShader,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;

  const group = new THREE.Group();
  group.add(mesh);

  let isAnimating = false;
  let currentWidth = 1;
  let currentHeight = 1;
  let pageSide: "left" | "right" = "right";

  /**
   * Set the turn progress (0 = flat on original side, 1 = fully turned)
   */
  const setProgress = (progress: number) => {
    uniforms.uTurnProgress.value = Math.max(0, Math.min(1, progress));
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

    // Update geometry to match aspect ratio
    // Page is positioned with left edge at x=0 (spine)
    // So vertices go from x=0 to x=width
    const geo = mesh.geometry as THREE.PlaneGeometry;
    const positions = geo.attributes.position;

    for (let i = 0; i < positions.count; i++) {
      // Original plane is -0.5 to 0.5, remap to 0 to width
      const origX = positions.getX(i) + 0.5; // Now 0 to 1
      const origY = positions.getY(i); // -0.5 to 0.5

      positions.setX(i, origX * width);
      positions.setY(i, origY * height);
    }
    positions.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    uniforms.uPageWidth.value = width;
    uniforms.uPageHeight.value = height;
  };

  const setSide = (side: "left" | "right") => {
    pageSide = side;
    uniforms.uSide.value = side === "right" ? 1.0 : -1.0;

    // Position the group so the spine edge is at center
    if (side === "right") {
      // Right page: spine is at left edge of page
      group.position.x = 0;
      group.scale.x = 1;
    } else {
      // Left page: mirror it - spine is at right edge
      group.position.x = 0;
      group.scale.x = -1; // Mirror the page
    }
  };

  const getSide = () => pageSide;

  const beginAnimation = () => {
    if (isAnimating) return;
    isAnimating = true;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1.0;
    material.polygonOffsetUnits = -4.0;
    material.needsUpdate = true;
    mesh.renderOrder = 10; // Bring to front during animation
  };

  const endAnimation = () => {
    if (!isAnimating) return;
    isAnimating = false;
    material.polygonOffset = false;
    material.polygonOffsetFactor = 0;
    material.polygonOffsetUnits = 0;
    material.needsUpdate = true;
    mesh.renderOrder = 2;
  };

  const getMaterial = () => material;

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
    setSide,
    getSide,
  };
}
