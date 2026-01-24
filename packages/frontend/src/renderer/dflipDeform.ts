import * as THREE from "three";

export type SheetOrientation = "horizontal" | "vertical";

export type SheetDeformParams = {
  width: number;
  height: number;
  depth: number;
  segments: number;
  sheetAngleDeg: number;
  curveAngleDeg: number;
  flexibility: number;
  isHard: boolean;
  orientation: SheetOrientation;
  pageOffset: number;
  pageSide: number;
};

export type SheetDeformResult = {
  positionOffset: THREE.Vector3;
  scaleX: number;
  arcLength: number;
};

const DEG2RAD = Math.PI / 180;

export function getCurveAngle(isLeftTurn: boolean, angleDeg: number, minClampDeg = 0): number {
  let curve: number;
  if (isLeftTurn) {
    if (angleDeg > 135) {
      curve = 180 - (180 - angleDeg) * 2;
    } else if (angleDeg > 45) {
      curve = angleDeg - 45;
    } else {
      curve = 0;
    }
    curve = clamp(curve, minClampDeg, 180);
  } else {
    if (angleDeg < 45) {
      curve = 2 * angleDeg;
    } else if (angleDeg < 135) {
      curve = angleDeg + 45;
    } else {
      curve = 180;
    }
    curve = clamp(curve, 0, 180 - minClampDeg);
  }
  return curve;
}

export function updateSheetGeometry(
  geometry: THREE.BufferGeometry,
  params: SheetDeformParams
): SheetDeformResult {
  const {
    width,
    height,
    depth,
    segments,
    sheetAngleDeg,
    curveAngleDeg,
    flexibility,
    isHard,
    orientation,
    pageOffset,
  } = params;

  const nearFlat = sheetAngleDeg < 1 || sheetAngleDeg > 179;
  const e = isHard || nearFlat ? 0 : flexibility;
  const baseAxis = (orientation === "vertical" ? height : width) *
    (1 - Math.sin((e / 2) * (e / 2)) / 2 - e / 20);
  const n = baseAxis;
  const o = n * e;
  const p = depth;

  const f = sheetAngleDeg * DEG2RAD;
  const g = isHard ? f : curveAngleDeg * DEG2RAD;
  const v = f;
  const m = v - Math.PI / 2;
  const y = Math.sin(m) * p / 2;

  const h: THREE.Vector3[] = [];
  const u: THREE.Vector3[] = [];

  h[0] = new THREE.Vector3(-n * Math.cos(f), 0, Math.sin(f) * n - y);
  h[1] = new THREE.Vector3(-n / 2 * Math.cos(g), 0, (n / 2) * Math.sin(g) - y);
  const v2 = (45 + sheetAngleDeg / 2) * DEG2RAD;
  h[2] = new THREE.Vector3(-Math.cos(v2) * o / 2, 0, Math.sin(v2) * o - y);
  h[3] = new THREE.Vector3(0, 0, -y);

  u[0] = new THREE.Vector3(h[0].x - Math.cos(m) * p, 0, h[0].z + 2 * y);
  u[1] = new THREE.Vector3(h[1].x - Math.cos(m) * p, 0, h[1].z + 2 * y);
  u[2] = new THREE.Vector3(h[2].x + Math.cos(m) * p, 0, h[2].z + 2 * y);
  u[3] = new THREE.Vector3(h[3].x - Math.cos(m) * p, 0, h[3].z + 2 * y);

  if (Math.abs(u[2].x) < 5e-4) u[2].x = 0;
  if (Math.abs(u[3].x) < 5e-4) u[3].x = 0;

  const w = Math.max(segments - 1, 1);
  const frontCurve = new THREE.CubicBezierCurve3(h[0], h[1], h[2], h[3]);
  const backCurve = new THREE.CubicBezierCurve3(u[0], u[1], u[2], u[3]);
  const frontPts = frontCurve.getPoints(w);
  const backPts = backCurve.getPoints(w);
  if (w > 2) {
    frontPts.push(frontPts[w].clone());
    backPts.push(backPts[w].clone());
  }

  let arcLength = 0;
  const arc = [0];
  for (let i = 1; i < frontPts.length; i++) {
    arcLength += frontPts[i].distanceTo(frontPts[i - 1]);
    arc.push(arcLength);
  }

  // Calculate separate arc lengths for back curve (different shape due to paper thickness)
  let backArcLength = 0;
  const backArc = [0];
  for (let i = 1; i < backPts.length; i++) {
    backArcLength += backPts[i].distanceTo(backPts[i - 1]);
    backArc.push(backArcLength);
  }

  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | null;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute | null;
  const layout = geometry.userData?.layout as
    | { E: number; frontTop: number; frontBottom: number; backTop: number; backBottom: number }
    | undefined;

  if (pos && uv && layout) {
    const E = layout.E;
    const halfHeight = height / 2;
    const yFront = depth / 2;
    const yBack = -depth / 2;

    for (let r = 0; r < E; r++) {
      const uArc = arcLength > 0 ? arc[r] / arcLength : r / Math.max(1, E - 1);
    const front = frontPts[r];
    const back = backPts[r];
    const flip = params.pageSide > 0 ? -1 : 1;
    const fx = front.x * flip;
    const bx = back.x * flip;

      setVertex(pos, layout.frontTop + r, fx, yFront + front.z, halfHeight);
      setVertex(pos, layout.frontBottom + r, fx, yFront + front.z, -halfHeight);
      setVertex(pos, layout.backTop + r, bx, yBack + back.z, halfHeight);
      setVertex(pos, layout.backBottom + r, bx, yBack + back.z, -halfHeight);

      // UV mapping: front face is side-dependent, back face uses consistent mapping
      // Front: right pages have U=0 at spine, left pages have U=0 at outer edge
      // Back: always U=0 at outer edge so revealed back shows text correctly
      // Use separate arc length calculation for back face (different curve shape)
      const uFront = params.pageSide > 0 ? 1 - uArc : uArc;
      const uBackArc = backArcLength > 0 ? backArc[r] / backArcLength : r / Math.max(1, E - 1);
      const uBack = uBackArc;
      setUv(uv, layout.frontTop + r, uFront, 0);
      setUv(uv, layout.frontBottom + r, uFront, 1);
      setUv(uv, layout.backTop + r, uBack, 0);
      setUv(uv, layout.backBottom + r, uBack, 1);
    }

    pos.needsUpdate = true;
    uv.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.computeVertexNormals();
  }

  const positionOffset = new THREE.Vector3();
  if (orientation !== "vertical") {
    const flip = params.pageSide > 0 ? -1 : 1;
    positionOffset.x = -Math.cos(f) * pageOffset * flip;
  } else {
    positionOffset.y = Math.cos(f) * pageOffset;
  }

  const scaleX = arcLength > 0 ? n / arcLength : 1;

  return {
    positionOffset,
    scaleX,
    arcLength,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function setVertex(
  attr: THREE.BufferAttribute,
  index: number,
  x: number,
  y: number,
  z: number
) {
  if (index < 0 || index >= attr.count) return;
  attr.setX(index, x);
  attr.setY(index, y);
  attr.setZ(index, z);
}

function setUv(attr: THREE.BufferAttribute, index: number, x: number, y: number) {
  if (index < 0 || index >= attr.count) return;
  attr.setX(index, x);
  attr.setY(index, y);
}
