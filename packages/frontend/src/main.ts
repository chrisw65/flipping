import * as THREE from "three";
import { createPageMesh } from "./renderer/createPageMesh";
import { TextureCache } from "./renderer/textureCache";
import { createSession, fetchImageBlob, rasterizePage, uploadDocument } from "./api/client";
import { FlipbookController } from "./interaction/controller";

const containerElement = document.getElementById("app");
if (!containerElement) {
  throw new Error("Missing #app container");
}
// Narrow the type after null check
const container: HTMLElement = containerElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f141a);

/**
 * Camera configuration per spec Section 3.2.2:
 * - Book lies flat on XZ plane at origin
 * - Camera is ABOVE, looking DOWN at the book
 * - Viewing angle 25-35 degrees from vertical
 */
type ViewportClass = "desktop" | "tablet" | "mobile";

interface CameraConfig {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

function getViewportClass(): ViewportClass {
  const width = window.innerWidth;
  const aspectRatio = window.innerWidth / window.innerHeight;
  if (aspectRatio > 1.5 && width >= 1200) {
    return "desktop";
  } else if (aspectRatio > 1.0 && width >= 768) {
    return "tablet";
  } else {
    return "mobile";
  }
}

// Camera positions from spec - above book, looking down
function getCameraConfig(): CameraConfig {
  const viewport = getViewportClass();
  switch (viewport) {
    case "desktop":
      return {
        position: new THREE.Vector3(0, 1.8, 0.85),
        target: new THREE.Vector3(0, 0.02, 0),
        fov: 28,
      };
    case "tablet":
      return {
        position: new THREE.Vector3(0, 1.6, 0.9),
        target: new THREE.Vector3(0, 0.02, 0),
        fov: 32,
      };
    case "mobile":
    default:
      return {
        position: new THREE.Vector3(0, 1.4, 0.95),
        target: new THREE.Vector3(0, 0.02, 0),
        fov: 38,
      };
  }
}

const initialConfig = getCameraConfig();
const camera = new THREE.PerspectiveCamera(initialConfig.fov, 1, 0.1, 100);
camera.position.copy(initialConfig.position);
camera.lookAt(initialConfig.target);

// Renderer configuration optimized for text clarity per spec
const renderer = new THREE.WebGLRenderer({
  antialias: true, // Enable MSAA for text clarity
  alpha: false, // Opaque background improves performance
  powerPreference: "high-performance",
  stencil: false, // Not needed, saves memory
  depth: true,
  preserveDrawingBuffer: false // Security: prevents canvas data extraction
});
// Cap DPR at 2 for performance while maintaining Retina sharpness
const dpr = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(dpr);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

// Create pages - they lie flat on XZ plane per spec
const leftPage = createPageMesh();
const rightPage = createPageMesh();
// Pages positioned at small Y offset above any stack geometry
leftPage.group.position.set(0, 0.01, 0);
rightPage.group.position.set(0, 0.01, 0);
scene.add(leftPage.group);
scene.add(rightPage.group);

// Spine runs along Z axis at X=0 for horizontal book
const spineMaterial = new THREE.MeshStandardMaterial({
  color: 0xd6d0c6,
  roughness: 0.75,
  metalness: 0.05
});
// Spine: thin in X, tall in Y (book thickness), long in Z (page height)
const spineGeometry = new THREE.BoxGeometry(0.02, 0.02, 1);
const spine = new THREE.Mesh(spineGeometry, spineMaterial);
scene.add(spine);

// Edge shadows for book depth effect
const shadowTexture = createEdgeShadowTexture();
const shadowMaterial = new THREE.MeshBasicMaterial({
  map: shadowTexture,
  transparent: true,
  opacity: 0.35,
  depthWrite: false
});
const shadowWidth = 0.02;
// Shadows lie flat on XZ plane
const leftShadowGeo = new THREE.PlaneGeometry(shadowWidth, 1);
leftShadowGeo.rotateX(-Math.PI / 2); // Lie flat
const rightShadowGeo = new THREE.PlaneGeometry(shadowWidth, 1);
rightShadowGeo.rotateX(-Math.PI / 2); // Lie flat
const leftShadow = new THREE.Mesh(leftShadowGeo, shadowMaterial);
const rightShadow = new THREE.Mesh(rightShadowGeo, shadowMaterial.clone());
(rightShadow.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
(leftShadow.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
scene.add(leftShadow);
scene.add(rightShadow);

const shadowEdgeGeo = new THREE.PlaneGeometry(0.06, 1);
shadowEdgeGeo.rotateX(-Math.PI / 2);
const shadowEdge = new THREE.Mesh(
  shadowEdgeGeo,
  new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.2 })
);
scene.add(shadowEdge);

// Paper stacks under pages (represent unturned pages)
const paperTexture = createPaperTexture();
const paperMaterial = new THREE.MeshStandardMaterial({
  color: 0xf2efe7,
  roughness: 0.92,
  metalness: 0.02,
  map: paperTexture
});
// Stack geometry: width in X, thickness in Y, depth in Z
const stackGeometry = new THREE.BoxGeometry(1, 0.02, 1);
const leftStack = new THREE.Mesh(stackGeometry, paperMaterial);
const rightStack = new THREE.Mesh(stackGeometry, paperMaterial.clone());
scene.add(leftStack);
scene.add(rightStack);
const minimalRender = true;

// Lighting for book lying flat - lights from above
const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);

// Key light: above and to the side, simulating desk lamp
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(1.0, 2.5, 0.5);
scene.add(key);

// Fill light: softer, from opposite side
const fill = new THREE.DirectionalLight(0xdfe8f2, 0.5);
fill.position.set(-0.8, 2.0, 0.8);
scene.add(fill);

// Rim/back light: from behind to add depth
const rim = new THREE.DirectionalLight(0xffffff, 0.35);
rim.position.set(0, 1.5, -1.2);
scene.add(rim);

function resize() {
  const { clientWidth, clientHeight } = container;
  camera.aspect = clientWidth / clientHeight;

  // Update camera configuration based on viewport per spec
  const config = getCameraConfig();
  camera.fov = config.fov;
  camera.position.copy(config.position);
  camera.lookAt(config.target);
  camera.updateProjectionMatrix();

  // Update renderer size accounting for DPR
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(clientWidth, clientHeight);
}

window.addEventListener("resize", resize);
resize();

// Initialize the flipbook controller for interactions
const flipbookController = new FlipbookController(
  container,
  leftPage,
  rightPage,
  1 // Will be updated when document is loaded
);

// Track current page for loading textures
let currentPageNumber = 1;
let totalDocumentPages = 1;

flipbookController.setPageChangeCallback(async (newPage) => {
  currentPageNumber = newPage + 1; // Convert 0-indexed to 1-indexed
  await loadCurrentSpread();
});

async function loadCurrentSpread() {
  if (!documentId || !token) return;

  const layoutMode = resolveLayout();
  const scale = Number.parseFloat(scaleInput?.value ?? "1");
  const [leftPageNumber, rightPageNumber] = resolveSpread(currentPageNumber, layoutMode);

  try {
    const leftRender = await requestAndLoadPage(leftPageNumber, layoutMode, scale);
    leftPage.setTexture(leftRender.texture);
    lastPageSize = { width: leftRender.width, height: leftRender.height };

    if (layoutMode === "double" && rightPageNumber && rightPageNumber <= totalDocumentPages) {
      const rightRender = await requestAndLoadPage(rightPageNumber, layoutMode, scale);
      rightPage.setTexture(rightRender.texture);
    } else {
      rightPage.setTexture(null);
    }

    updateLayout(leftRender.width, leftRender.height, layoutMode);
  } catch (error) {
    console.error("Failed to load spread:", error);
  }
}

function animate(time: number = 0) {
  // Update controller (handles physics animation internally)
  flipbookController.update(time / 1000);

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

/**
 * Update layout for book lying FLAT on XZ plane per spec Section 3.2.2:
 * - X axis: left/right (page width)
 * - Y axis: up/down (book thickness)
 * - Z axis: front/back (page height/depth)
 * - Spine runs along Z axis at X=0
 */
function updateLayout(pageWidth: number, pageHeight: number, mode: LayoutMode) {
  const aspect = pageWidth / pageHeight;
  const baseDepth = 1.0; // Base page depth in Z direction
  const pageW = baseDepth * aspect; // Page width in X direction
  const pageD = baseDepth; // Page depth in Z direction
  const bookThickness = 0.02; // Y direction thickness
  const pageY = bookThickness / 2 + 0.001; // Pages sit just above book stack

  if (mode === "double") {
    // Set page sizes: width (X) and depth (Z)
    leftPage.setSize(pageW, pageD);
    rightPage.setSize(pageW, pageD);
    leftPage.setSide("left");
    rightPage.setSide("right");

    // Position pages at spine (X=0), slightly above Y=0
    leftPage.group.position.set(0, pageY, 0);
    rightPage.group.position.set(0, pageY, 0);

    // Decorative elements (stacks, spine, shadows)
    leftStack.visible = !minimalRender;
    rightStack.visible = !minimalRender;
    spine.visible = !minimalRender;
    leftShadow.visible = !minimalRender;
    rightShadow.visible = !minimalRender;
    shadowEdge.visible = !minimalRender;

    if (!minimalRender) {
      // Stack under left pages: centered at -pageW/2, below pages
      leftStack.scale.set(pageW, bookThickness, pageD);
      leftStack.position.set(-pageW / 2, 0, 0);

      // Stack under right pages: centered at +pageW/2
      rightStack.scale.set(pageW, bookThickness, pageD);
      rightStack.position.set(pageW / 2, 0, 0);

      // Spine at X=0, running along Z
      spine.scale.set(1, bookThickness / 0.02, pageD);
      spine.position.set(0, 0, 0);

      // Shadows at gutter (spine) area
      leftShadow.scale.set(1, 1, pageD);
      rightShadow.scale.set(1, 1, pageD);
      leftShadow.position.set(-0.01, pageY + 0.001, 0);
      rightShadow.position.set(0.01, pageY + 0.001, 0);
      rightShadow.rotation.z = Math.PI;

      shadowEdge.scale.set(1, 1, pageD);
      shadowEdge.position.set(0, pageY + 0.002, 0);
    }

    rightPage.group.visible = true;
    leftPage.group.visible = true;
  } else {
    // Single page mode - show as right page (like first page of book)
    leftPage.setSize(pageW, pageD);
    leftPage.setSide("right");
    // Position so page is centered (spine edge at X=0, page extends to +X)
    leftPage.group.position.set(0, pageY, 0);

    leftStack.visible = !minimalRender;
    rightPage.group.visible = false;
    leftPage.group.visible = true;
    spine.visible = false;
    shadowEdge.visible = false;
    rightStack.visible = false;
    leftShadow.visible = false;
    rightShadow.visible = false;

    if (!minimalRender) {
      leftStack.scale.set(pageW, bookThickness, pageD);
      leftStack.position.set(pageW / 2, 0, 0);
    }
  }
}

// Camera is positioned by getCameraConfig() based on viewport class per spec
// No dynamic fitCamera needed - spec defines fixed positions for each viewport

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
    currentPageNumber = pageNumber;

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
      // Update controller with page dimensions
      flipbookController.setPageDimensions(lastPageSize.width, lastPageSize.height);
    }

    // For now, assume 10 pages - this should come from PDF metadata
    totalDocumentPages = 10;
    flipbookController.setTotalPages(totalDocumentPages);

    setStatus(`Rendered page ${pageNumber}${layoutMode === "double" ? " (spread)" : ""} - Use arrow keys or drag corners to turn pages`);
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

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = objectUrl;
  });

  // Create texture directly from loaded image - keep it simple
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // Enable mipmaps with trilinear filtering for text clarity per spec
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  if (debugPreview) {
    debugPreview.src = objectUrl;
    debugPreview.style.display = "block";
  }

  // Revoke object URL after texture is uploaded to GPU (next frame)
  requestAnimationFrame(() => {
    URL.revokeObjectURL(objectUrl);
  });

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
