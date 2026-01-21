export const pageVertexShader = `
  uniform float uProgress;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position;

    float bend = sin(uv.x * 3.14159) * 0.08;
    float turn = uProgress;
    pos.z += bend * turn;
    pos.y += bend * (1.0 - uv.x) * turn;
    pos.x += (turn * turn) * 0.1;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const pageFragmentShader = `
  uniform sampler2D uTexture;
  uniform float uHasTexture;
  varying vec2 vUv;

  void main() {
    vec3 base = mix(vec3(0.96, 0.94, 0.9), vec3(0.9, 0.88, 0.84), vUv.y);
    vec3 color = base;
    if (uHasTexture > 0.5) {
      color = texture2D(uTexture, vUv).rgb;
    }
    float edgeMin = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float bevel = smoothstep(0.0, 0.03, edgeMin);
    float shade = mix(0.88, 1.0, bevel);
    color *= shade;
    gl_FragColor = vec4(color, 1.0);
  }
`;
