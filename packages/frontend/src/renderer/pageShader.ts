/**
 * Conical Page Deformation Shaders
 * Based on the Production Technical Specification v2.0 and Addendum v2.1
 *
 * The vertex shader implements physically accurate conical deformation
 * for page turning, with analytical normal calculation for performance.
 */

// Optimized vertex shader with analytical normals per Addendum v2.1 Section 3
export const pageVertexShader = `
  precision highp float;

  // Uniforms for page turn animation
  uniform float uCurlProgress;  // 0 = flat, 1 = fully turned
  uniform vec3 uApex;           // Cone apex position (on spine extension)
  uniform vec3 uFoldAxis;       // Normalised fold axis direction
  uniform float uConeAngle;     // Cone half-angle (radians)
  uniform float uStiffness;     // Paper stiffness (0-1)
  uniform float uTime;          // Animation time for subtle effects
  uniform float uPageSide;      // 1.0 for front, -1.0 for back

  // Varyings to fragment shader
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vCurlAmount;
  varying float vDistanceFromFold;

  // Constants
  const float PI = 3.14159265359;
  const float EPSILON = 0.0001;

  /**
   * Compute signed distance from vertex to fold line
   * Positive = on the turning side, Negative = on the spine side
   */
  float computeFoldDistance(vec3 pos) {
    vec3 toPoint = pos - uApex;
    float alongAxis = dot(toPoint, uFoldAxis);
    vec3 projected = uApex + uFoldAxis * alongAxis;

    // Signed distance based on x position relative to fold
    vec3 perpendicular = pos - projected;
    return length(perpendicular) * sign(pos.x - projected.x);
  }

  /**
   * Compute effective cone radius at given position
   * Includes stiffness-based radius modification
   */
  float computeConeRadius(vec3 pos, float dist) {
    // Base radius from cone geometry
    float radialDist = length(pos.xz - uApex.xz);
    float baseRadius = max(radialDist * tan(uConeAngle), 0.05);

    // Stiffness increases effective radius (stiffer = larger radius = gentler curve)
    // This creates the "bevel curve" effect where paper relaxes toward edges
    float stiffnessModifier = 1.0 + uStiffness * dist * dist * 0.5;

    return baseRadius * stiffnessModifier;
  }

  /**
   * Apply conical deformation to vertex position
   * Returns: vec4(deformedPosition.xyz, wrapAngle)
   */
  vec4 applyDeformation(vec3 pos, float dist) {
    if (dist <= 0.0) {
      // Behind fold line - no deformation
      return vec4(pos, 0.0);
    }

    float radius = computeConeRadius(pos, dist);

    // Wrap angle (arc length preserved)
    float wrapAngle = (dist / radius) * uCurlProgress;
    wrapAngle = min(wrapAngle, PI); // Max 180° wrap

    // Rotation around fold axis
    float cosA = cos(wrapAngle);
    float sinA = sin(wrapAngle);

    // Deformed position
    vec3 deformed;
    deformed.x = pos.x * cosA + radius * (1.0 - cosA);
    deformed.y = pos.y + radius * sinA;
    deformed.z = pos.z;

    return vec4(deformed, wrapAngle);
  }

  /**
   * ANALYTICAL normal calculation using Jacobian
   * This is the key optimization - no finite differences needed
   */
  vec3 computeAnalyticalNormal(vec3 pos, float dist, float wrapAngle, float radius) {
    if (dist <= EPSILON) {
      // Flat region - normal points up
      return vec3(0.0, 1.0, 0.0);
    }

    // For conical deformation, the normal rotates with the wrap angle
    float cosA = cos(wrapAngle);
    float sinA = sin(wrapAngle);

    // Tangent vectors from analytical derivatives
    vec3 tangentX = vec3(cosA, sinA, 0.0);
    vec3 tangentZ = vec3(0.0, 0.0, 1.0);

    // Normal is cross product of tangents
    vec3 normal = cross(tangentZ, tangentX);

    // Flip normal for back face
    normal *= uPageSide;

    return normalize(normal);
  }

  void main() {
    vUv = uv;

    // Compute distance to fold line
    float dist = computeFoldDistance(position);
    vDistanceFromFold = dist;

    // Apply deformation
    vec4 deformResult = applyDeformation(position, dist);
    vec3 deformed = deformResult.xyz;
    float wrapAngle = deformResult.w;

    // Compute curl amount for fragment shader (lighting, shadows)
    vCurlAmount = smoothstep(0.0, 0.3, dist) * uCurlProgress;

    // Add subtle paper flutter for realism (only when moving)
    float flutterIntensity = (1.0 - uStiffness) * vCurlAmount * 0.003;
    float flutter = sin(uTime * 12.0 + position.z * 15.0) * flutterIntensity;
    deformed.y += flutter;

    // ANALYTICAL normal calculation (no finite differences!)
    float radius = computeConeRadius(position, dist);
    vNormal = computeAnalyticalNormal(position, dist, wrapAngle, radius);

    // Transform to world space
    vec4 worldPos = modelMatrix * vec4(deformed, 1.0);
    vWorldPosition = worldPos.xyz;

    // Final position
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

// Fragment shader for paper surface with PBR-like rendering
export const pageFragmentShader = `
  precision highp float;

  uniform sampler2D uTexture;
  uniform float uHasTexture;
  uniform vec3 uLightPosition;
  uniform vec3 uLightColor;
  uniform float uAmbientStrength;
  uniform float uRoughness;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vCurlAmount;
  varying float vDistanceFromFold;

  void main() {
    // Base paper color with subtle gradient
    vec3 paperBase = mix(vec3(0.96, 0.94, 0.9), vec3(0.92, 0.90, 0.86), vUv.y * 0.5);

    // Sample texture if available
    vec3 color = paperBase;
    if (uHasTexture > 0.5) {
      vec4 texColor = texture2D(uTexture, vUv);
      color = texColor.rgb;
    }

    // Simple lighting calculation
    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(uLightPosition - vWorldPosition);

    // Diffuse lighting
    float diff = max(dot(normal, lightDir), 0.0);
    vec3 diffuse = diff * uLightColor;

    // Ambient lighting
    vec3 ambient = uAmbientStrength * uLightColor;

    // Combine lighting
    vec3 lit = color * (ambient + diffuse * 0.6);

    // Edge darkening for bevel effect
    float edgeMin = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float bevel = smoothstep(0.0, 0.025, edgeMin);
    lit *= mix(0.88, 1.0, bevel);

    // Subtle shadow in curl area
    float curlShadow = 1.0 - vCurlAmount * 0.15;
    lit *= curlShadow;

    gl_FragColor = vec4(lit, 1.0);
  }
`;

// Simple fallback shaders for when curl animation is not active
export const simpleVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const simpleFragmentShader = `
  uniform sampler2D uTexture;
  uniform float uHasTexture;
  varying vec2 vUv;

  void main() {
    vec3 base = mix(vec3(0.96, 0.94, 0.9), vec3(0.92, 0.90, 0.86), vUv.y * 0.3);
    vec3 color = base;

    if (uHasTexture > 0.5) {
      color = texture2D(uTexture, vUv).rgb;
    }

    // Edge bevel
    float edgeMin = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float bevel = smoothstep(0.0, 0.025, edgeMin);
    color *= mix(0.9, 1.0, bevel);

    gl_FragColor = vec4(color, 1.0);
  }
`;
