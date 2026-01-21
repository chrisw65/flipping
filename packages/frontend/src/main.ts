import * as THREE from "three";
import { createPageMesh } from "./renderer/createPageMesh";
import { TextureCache } from "./renderer/textureCache";
import { createSession, fetchImageBlob, rasterizePage, uploadDocument } from "./api/client";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Missing #app container");
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f141a);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 2.2);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.physicallyCorrectLights = true;
container.appendChild(renderer.domElement);

const leftPage = createPageMesh();
const rightPage = createPageMesh();
leftPage.group.position.set(0, 0, 0);
rightPage.group.position.set(0, 0, 0);
scene.add(leftPage.group);
scene.add(rightPage.group);

const spineMaterial = new THREE.MeshStandardMaterial({
  color: 0xd6d0c6,
  roughness: 0.75,
  metalness: 0.05
});
const spineGeometry = new THREE.BoxGeometry(0.02, 1, 0.02);
const spine = new THREE.Mesh(spineGeometry, spineMaterial);
scene.add(spine);

const shadowTexture = createEdgeShadowTexture();
const shadowMaterial = new THREE.MeshBasicMaterial({
  map: shadowTexture,
  transparent: true,
  opacity: 0.35,
  depthWrite: false
});
const shadowWidth = 0.02;
const leftShadow = new THREE.Mesh(new THREE.PlaneGeometry(shadowWidth, 1), shadowMaterial);
const rightShadow = new THREE.Mesh(new THREE.PlaneGeometry(shadowWidth, 1), shadowMaterial);
leftShadow.material.side = THREE.DoubleSide;
rightShadow.material.side = THREE.DoubleSide;
scene.add(leftShadow);
scene.add(rightShadow);
const shadowEdge = new THREE.Mesh(
  new THREE.PlaneGeometry(0.06, 1),
  new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.2 })
);
shadowEdge.rotation.y = Math.PI;
scene.add(shadowEdge);

const paperTexture = createPaperTexture();
const paperMaterial = new THREE.MeshStandardMaterial({
  color: 0xf2efe7,
  roughness: 0.92,
  metalness: 0.02,
  map: paperTexture
});
const stackGeometry = new THREE.BoxGeometry(1, 1, 0.12);
const leftStack = new THREE.Mesh(stackGeometry, paperMaterial);
const rightStack = new THREE.Mesh(stackGeometry, paperMaterial);
scene.add(leftStack);
scene.add(rightStack);
const minimalRender = true;

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);

const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(1.8, 1.6, 2.4);
scene.add(key);

const fill = new THREE.DirectionalLight(0xdfe8f2, 0.5);
fill.position.set(-1.2, 1.1, 1.6);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffffff, 0.35);
rim.position.set(0, -1.4, 1.8);
scene.add(rim);

function resize() {
  const { clientWidth, clientHeight } = container;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);
}

window.addEventListener("resize", resize);
resize();

function animate() {
  leftPage.setProgress(0);
  rightPage.setProgress(0);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

const status = document.getElementById("status");
const fileInput = document.getElementById("fileInput") as HTMLInputElement | null;
const pageInput = document.getElementById("pageInput") as HTMLInputElement | null;
const scaleInput = document.getElementById("scaleInput") as HTMLInputElement | null;
const renderButton = document.getElementById("renderButton") as HTMLButtonElement | null;
const layoutSelect = document.getElementById("layoutSelect") as HTMLSelectElement | null;
const qualitySelect = document.getElementById("qualitySelect") as HTMLSelectElement | null;
const debugPreview = document.getElementById("debugPreview") as HTMLImageElement | null;

let sessionId = "";
let token = "";
let documentId = "";
let lastPageSize: { width: number; height: number } | null = null;
const textureCache = new TextureCache(10);
const disableTextureCache = true;

type LayoutMode = "auto" | "single" | "double";
type PageSizePreset = "auto" | "a4" | "6x9" | "8.5x8.5";
type QualityPreset = "low" | "medium" | "high";

function resolveLayout(): LayoutMode {
  const selection = (layoutSelect?.value ?? "auto") as LayoutMode;
  if (selection !== "auto") return selection;
  return window.innerWidth < 900 ? "single" : "double";
}

function updateLayout(pageWidth: number, pageHeight: number, mode: LayoutMode) {
  const aspect = pageWidth / pageHeight;
  const baseHeight = 1.0;
  const pageW = baseHeight * aspect;
  const pageH = baseHeight;
  const gutter = pageW * 0.08;
  const stackDepth = getStackDepth(pageH);
  const stackScaleZ = stackDepth / 0.12;

  if (mode === "double") {
    const spreadWidth = pageW * 2 + gutter;
    leftPage.setSize(pageW, pageH);
    rightPage.setSize(pageW, pageH);
    leftPage.group.position.set(-(pageW + gutter) / 2, 0, 0.01);
    rightPage.group.position.set((pageW + gutter) / 2, 0, 0.01);
    leftStack.visible = !minimalRender;
    rightStack.visible = !minimalRender;
    spine.visible = !minimalRender;
    leftShadow.visible = !minimalRender;
    rightShadow.visible = !minimalRender;
    shadowEdge.visible = !minimalRender;
    if (!minimalRender) {
      leftStack.scale.set(pageW, pageH, 1);
      rightStack.scale.set(pageW, pageH, 1);
      leftStack.scale.z = stackScaleZ;
      rightStack.scale.z = stackScaleZ;
      leftStack.position.set(leftPage.group.position.x, 0, -stackDepth / 2);
      rightStack.position.set(rightPage.group.position.x, 0, -stackDepth / 2);
      spine.scale.set(1, pageH, stackScaleZ);
      spine.position.set(0, 0, 0);
      leftShadow.scale.set(1, pageH, 1);
      rightShadow.scale.set(1, pageH, 1);
      leftShadow.position.set(leftPage.group.position.x + pageW / 2 - shadowWidth / 2, 0, 0.02);
      rightShadow.position.set(rightPage.group.position.x - pageW / 2 + shadowWidth / 2, 0, 0.02);
      rightShadow.rotation.y = Math.PI;
      shadowEdge.scale.set(1, pageH, 1);
      shadowEdge.position.set(0, 0, 0.012);
    }
    fitCamera(spreadWidth, pageH, mode);
    rightPage.group.visible = true;
  } else {
    leftPage.setSize(pageW, pageH);
    leftPage.group.position.set(0, 0, 0);
    leftStack.visible = !minimalRender;
    fitCamera(pageW, pageH, mode);
    rightPage.group.visible = false;
    spine.visible = false;
    shadowEdge.visible = false;
    rightStack.visible = false;
    leftShadow.visible = false;
    rightShadow.visible = false;
    if (!minimalRender) {
      leftStack.scale.set(pageW, pageH, 1);
      leftStack.scale.z = stackScaleZ;
      leftStack.position.set(0, 0, -stackDepth / 2);
    }
  }
}

function fitCamera(width: number, height: number, mode: LayoutMode) {
  const margin = 1.08;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distH = (width * margin) / (2 * Math.tan(hFov / 2));
  const distV = (height * margin) / (2 * Math.tan(vFov / 2));
  const minFraction = mode === "double" ? 0.68 : 0.78;
  const readableDistance = height / (2 * Math.tan(vFov / 2) * minFraction);
  const distance = Math.min(Math.max(distH, distV, 1.2), readableDistance);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
}

function setStatus(message: string) {
  if (status) {
    status.textContent = message;
  }
}

async function ensureSession() {
  if (token) return;
  try {
    setStatus("Creating session...");
    const session = await createSession();
    sessionId = session.sessionId;
    token = session.token;
    setStatus("Session ready");
  } catch (error) {
    console.error(error);
    setStatus(`Session failed: ${(error as Error).message}`);
  }
}

async function handleUpload() {
  if (!fileInput?.files?.[0]) return;
  await ensureSession();
  if (!token) return;
  try {
    setStatus("Uploading PDF...");
    const result = await uploadDocument(token, fileInput.files[0]);
    documentId = result.id;
    setStatus(`Uploaded ${result.filename}`);
  } catch (error) {
    console.error(error);
    setStatus(`Upload failed: ${(error as Error).message}`);
  }
}

async function handleRender() {
  if (!documentId) {
    setStatus("Upload a PDF first");
    return;
  }
  if (!pageInput || !scaleInput) return;
  const pageNumber = Number.parseInt(pageInput.value, 10);
  const scale = Number.parseFloat(scaleInput.value);
  if (!Number.isFinite(pageNumber) || !Number.isFinite(scale)) {
    setStatus("Invalid page or scale");
    return;
  }
  await ensureSession();
  if (!token) return;
  try {
    setStatus("Rasterizing...");
    const result = await rasterizePage(token, {
      sessionId,
      documentId,
      pageNumber,
      scale
    });
  let layoutMode = resolveLayout();
  const [leftPageNumber, rightPageNumber] = resolveSpread(pageNumber, layoutMode);
  if (layoutMode === "double" && !rightPageNumber) {
    layoutMode = "single";
  }
  const leftRender = await requestAndLoadPage(leftPageNumber, layoutMode, scale);
  leftPage.setTexture(leftRender.texture);
  lastPageSize = { width: leftRender.width, height: leftRender.height };

  if (layoutMode === "double" && rightPageNumber) {
    const rightRender = await requestAndLoadPage(rightPageNumber, layoutMode, scale);
    rightPage.setTexture(rightRender.texture);
  }

    if (lastPageSize) {
      updateLayout(lastPageSize.width, lastPageSize.height, layoutMode);
    }
    setStatus(`Rendered page ${pageNumber}${layoutMode === "double" ? " (spread)" : ""}`);
  } catch (error) {
    console.error(error);
    setStatus(`Rasterize failed: ${(error as Error).message}`);
  }
}

fileInput?.addEventListener("change", () => {
  void handleUpload();
});

renderButton?.addEventListener("click", () => {
  void handleRender();
});

layoutSelect?.addEventListener("change", () => {
  if (lastPageSize) {
    updateLayout(lastPageSize.width, lastPageSize.height, resolveLayout());
  }
});

const sizeSelect = document.getElementById("sizeSelect") as HTMLSelectElement | null;
sizeSelect?.addEventListener("change", () => {
  if (lastPageSize) {
    updateLayout(lastPageSize.width, lastPageSize.height, resolveLayout());
  }
});

qualitySelect?.addEventListener("change", () => {
  if (lastPageSize) {
    void handleRender();
  }
});

window.addEventListener("resize", () => {
  if (lastPageSize) {
    updateLayout(lastPageSize.width, lastPageSize.height, resolveLayout());
  }
});

async function loadTexture(url: string) {
  if (!disableTextureCache) {
    const cached = textureCache.get(url);
    if (cached) {
      return cached;
    }
  }
  const blob = await fetchImageBlob(token, url);
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  const texture = new THREE.CanvasTexture(document.createElement("canvas"));

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = objectUrl;
  });

  texture.center.set(0.5, 0.5);
  texture.rotation = Math.PI;
  texture.repeat.set(-1, 1);
  texture.offset.set(1, 0);
  const canvas = texture.image as HTMLCanvasElement;
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(image, 0, 0);
  }
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  if (debugPreview) {
    debugPreview.src = canvas.toDataURL("image/png");
    debugPreview.style.display = "block";
  }
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  const result = { key: url, texture, width: image.width, height: image.height, lastUsed: Date.now() };
  if (!disableTextureCache) {
    textureCache.set(url, result);
  }
  return result;
}

async function requestAndLoadPage(pageNumber: number, mode: LayoutMode, scale: number) {
  const desired = getTargetDimensions(mode);
  const first = await rasterizePage(token, {
    sessionId,
    documentId,
    pageNumber,
    scale,
    ...desired
  });
  let loaded = await loadTexture(first.url);
  if (desired.targetWidth && loaded.width < desired.targetWidth * 0.9) {
    const retry = await rasterizePage(token, {
      sessionId,
      documentId,
      pageNumber,
      scale,
      ...desired
    });
    loaded = await loadTexture(retry.url);
  }
  return loaded;
}

function createEdgeShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.Texture();
  }
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, "rgba(0,0,0,0.25)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createPaperTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.Texture();
  }
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const noise = 240 + Math.random() * 12;
    imageData.data[i] = noise;
    imageData.data[i + 1] = noise;
    imageData.data[i + 2] = noise;
    imageData.data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getPageAspect() {
  const preset = (document.getElementById("sizeSelect") as HTMLSelectElement | null)?.value as
    | PageSizePreset
    | undefined;
  switch (preset) {
    case "a4":
      return 210 / 297;
    case "6x9":
      return 6 / 9;
    case "8.5x8.5":
      return 1;
    case "auto":
    default:
      return null;
  }
}

function getQualityPreset(): QualityPreset {
  return (qualitySelect?.value ?? "medium") as QualityPreset;
}

function getStackDepth(pageHeight: number) {
  const preset = (document.getElementById("sizeSelect") as HTMLSelectElement | null)?.value as
    | PageSizePreset
    | undefined;
  const base = pageHeight * 0.12;
  switch (preset) {
    case "a4":
      return base * 0.9;
    case "6x9":
      return base * 1.05;
    case "8.5x8.5":
      return base * 0.85;
    case "auto":
    default:
      return base;
  }
}

function resolveSpread(pageNumber: number, mode: LayoutMode): [number, number | null] {
  if (mode !== "double") {
    return [pageNumber, null];
  }
  if (pageNumber <= 1) {
    return [1, null];
  }
  if (pageNumber % 2 === 0) {
    return [pageNumber, pageNumber + 1];
  }
  return [pageNumber - 1, pageNumber];
}

function getTargetDimensions(mode: LayoutMode) {
  if (!lastPageSize) return {};
  const canvasWidth = renderer.domElement.clientWidth;
  const canvasHeight = renderer.domElement.clientHeight;
  const dpr = Math.min(window.devicePixelRatio, 2);
  const widthForPage = mode === "double" ? canvasWidth * 0.5 : canvasWidth;
  const quality = getQualityPreset();
  const multiplier = quality === "high" ? 1.6 : quality === "low" ? 1.0 : 1.2;
  const maxWidth = quality === "high" ? 4200 : quality === "low" ? 2400 : 3600;
  const baseWidth = widthForPage * dpr * multiplier;
  const targetWidth = Math.min(Math.round(baseWidth), maxWidth);
  const aspect = getPageAspect() ?? lastPageSize.width / lastPageSize.height;
  const targetHeight = Math.round(targetWidth / aspect);
  if (targetWidth <= 0 || targetHeight <= 0) return {};
  return { targetWidth, targetHeight };
}
