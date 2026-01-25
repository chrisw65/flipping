import * as THREE from "three";
import { createPageMesh } from "./renderer/createPageMesh";
import { TextureCache, type CachedTexture } from "./renderer/textureCache";
import {
  createSession,
  fetchImageBlob,
  fetchPreprocessedPage,
  getDocumentStatus,
  rasterizePage,
  uploadDocument,
  type Resolution
} from "./api/client";
import { FlipbookController } from "./interaction/controller";
import { FlipbookState } from "./interaction/stateMachine";
import { createInteractionDebugOverlay } from "./interaction/debugOverlay";

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
        position: new THREE.Vector3(0, 2.875, 0.4375),
        target: new THREE.Vector3(0, 0.02, 0),
        fov: 20,
      };
    case "tablet":
      return {
        position: new THREE.Vector3(0, 2.5, 0.5),
        target: new THREE.Vector3(0, 0.02, 0),
        fov: 22,
      };
    case "mobile":
    default:
      return {
        position: new THREE.Vector3(0, 2.25, 0.5625),
        target: new THREE.Vector3(0, 0.02, 0),
        fov: 26,
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
// Cap DPR at 3 to improve text readability on high-DPI displays
const dpr = Math.min(window.devicePixelRatio, 3);
renderer.setPixelRatio(dpr);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// Create pages - they lie flat on XZ plane per spec
const leftPage = createPageMesh();
const rightPage = createPageMesh();
const underLeftPage = createPageMesh();
const underRightPage = createPageMesh();
leftPage.setDepthBias(-0.5);
rightPage.setDepthBias(-0.5);
underLeftPage.setDepthBias(1.0);
underRightPage.setDepthBias(1.0);
// Pages positioned at small Y offset above any stack geometry
leftPage.group.position.set(0, 0.021, 0);
rightPage.group.position.set(0, 0.021, 0);
// Keep under pages just below the visible pages but above the stack.
underLeftPage.group.position.set(0, 0.019, 0);
underRightPage.group.position.set(0, 0.019, 0);
scene.add(leftPage.group);
scene.add(rightPage.group);
scene.add(underLeftPage.group);
scene.add(underRightPage.group);

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

// Fold shadows that follow the curling sheet
const foldInnerShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(0.25, 1),
  new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.2,
    depthWrite: false
  })
);
const foldOuterShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(0.25, 1),
  new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.18,
    depthWrite: false
  })
);
foldInnerShadow.rotation.x = -Math.PI / 2;
foldOuterShadow.rotation.x = -Math.PI / 2;
scene.add(foldInnerShadow);
scene.add(foldOuterShadow);

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
const minimalRender = false;

// Lighting for book lying flat - lights from above
const ambient = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambient);

// Key light: above and to the side, simulating desk lamp
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(1.0, 2.5, 0.5);
key.castShadow = true;
key.shadow.mapSize.width = 1024;
key.shadow.mapSize.height = 1024;
key.shadow.bias = -0.0002;
key.shadow.normalBias = 0.02;
scene.add(key);

// Fill light: softer, from opposite side
const fill = new THREE.DirectionalLight(0xdfe8f2, 0.45);
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
  const dpr = Math.min(window.devicePixelRatio, 3);
  renderer.setPixelRatio(dpr);
  renderer.setSize(clientWidth, clientHeight);
}

window.addEventListener("resize", resize);
resize();

// Initialize the flipbook controller for interactions
const searchParams = new URLSearchParams(window.location.search);
const debugHit = searchParams.has("debugHit");
const perfEnabled = searchParams.has("perf");
const debugOverlay = debugHit
  ? createInteractionDebugOverlay(renderer.domElement, {
      cornerHitAreaFraction: 0.18,
      edgeHitAreaFraction: 0.12,
    })
  : null;

const perfOverlay = perfEnabled ? document.createElement("div") : null;
if (perfOverlay) {
  perfOverlay.style.position = "fixed";
  perfOverlay.style.right = "16px";
  perfOverlay.style.bottom = "16px";
  perfOverlay.style.padding = "6px 8px";
  perfOverlay.style.borderRadius = "8px";
  perfOverlay.style.background = "rgba(10, 14, 18, 0.85)";
  perfOverlay.style.border = "1px solid rgba(255, 255, 255, 0.08)";
  perfOverlay.style.color = "#cbd5e1";
  perfOverlay.style.fontSize = "11px";
  perfOverlay.style.fontFamily = "ui-monospace, Menlo, SFMono-Regular, monospace";
  perfOverlay.style.zIndex = "9999";
  perfOverlay.textContent = "fps: --";
  document.body.appendChild(perfOverlay);
}

const dragFeelSelectEarly = document.getElementById("dragFeelSelect") as HTMLSelectElement | null;

const flipbookController = new FlipbookController(
  container,
  camera,
  renderer,
  leftPage,
  rightPage,
  1,
  {
    debug: debugHit,
    debugReporter: debugOverlay ? debugOverlay.setMessage : undefined,
    dragFeel: (dragFeelSelectEarly?.value as "snappy" | "soft") ?? "snappy",
    canStartDrag: (side) => {
      const direction = side === "right" ? "forward" : "backward";
      if (!areUnderPagesReady(direction) || !isTurningBackReady(direction)) {
        void loadUnderSpread(direction);
        void loadTurningBackTexture(direction);
        return false;
      }
      return true;
    },
    onHoverSide: (side) => {
      const direction = side === "right" ? "forward" : "backward";
      applyUnderFromCache(direction);
      void loadTurningBackTexture(direction);
      void loadUnderSpread(direction);
      void prefetchAdjacentPages();
    }
  }
);
flipbookController.setPageStep(resolveLayout() === "double" ? 2 : 1);

// Track current page for loading textures
let currentPageNumber = 1;
let totalDocumentPages = 1;
let currentSpreadLeft = 1;
let underDirection: "forward" | "backward" = "forward";
let turnDirection: "forward" | "backward" = "forward";
let spreadRequestId = 0;
let activeSpreadId = 0;
let underRequestId = 0;
let activeUnderId = 0;

flipbookController.setPageChangeCallback(async (newPage) => {
  currentPageNumber = newPage + 1; // Convert 0-indexed to 1-indexed
  await loadCurrentSpread();
});

flipbookController.setStateChangeCallback((oldState, newState) => {
  const dragging =
    newState === FlipbookState.DRAGGING_FORWARD ||
    newState === FlipbookState.ANIMATING_FORWARD ||
    newState === FlipbookState.DRAGGING_BACKWARD ||
    newState === FlipbookState.ANIMATING_BACKWARD;

  if (hideTurningFrontFace) {
    if (
      newState === FlipbookState.DRAGGING_FORWARD ||
      newState === FlipbookState.ANIMATING_FORWARD
    ) {
      rightPage.setFrontVisible(false);
    } else if (
      newState === FlipbookState.DRAGGING_BACKWARD ||
      newState === FlipbookState.ANIMATING_BACKWARD
    ) {
      leftPage.setFrontVisible(false);
    }
  }

  if (dragging) {
    if (
      newState === FlipbookState.DRAGGING_FORWARD ||
      newState === FlipbookState.ANIMATING_FORWARD
    ) {
      rightPage.setFrontBiasDelta(turningFrontBiasDelta);
      rightPage.setFrontDepthWrite(false);
    } else if (
      newState === FlipbookState.DRAGGING_BACKWARD ||
      newState === FlipbookState.ANIMATING_BACKWARD
    ) {
      leftPage.setFrontBiasDelta(turningFrontBiasDelta);
      leftPage.setFrontDepthWrite(false);
    }
  }

  if (hideUnderPagesDuringDrag && dragging) {
    underLeftPage.mesh.visible = false;
    underRightPage.mesh.visible = false;
  }

  if (newState === FlipbookState.IDLE && oldState !== FlipbookState.IDLE) {
    leftPage.setFrontVisible(true);
    rightPage.setFrontVisible(true);
    leftPage.setFrontBiasDelta(0);
    rightPage.setFrontBiasDelta(0);
    leftPage.setFrontDepthWrite(true);
    rightPage.setFrontDepthWrite(true);
    updateUnderVisibility(underDirection);
  }
});

flipbookController.setTurnStartCallback((direction) => {
  logTurnDebug(direction);
  underDirection = direction;
  turnDirection = direction;
  lastTurnDirection = direction;
  if (hideTurningFrontFace) {
    if (direction === "forward") {
      rightPage.setFrontVisible(false);
    } else {
      leftPage.setFrontVisible(false);
    }
  }
  applyUnderFromCache(direction);
  updateUnderVisibility(direction);
  void loadTurningBackTexture(direction);
  void loadUnderSpread(direction);
});

async function loadCurrentSpread() {
  if (!documentId || !token) return;

  const layoutMode = resolveLayout();
  const scale = Number.parseFloat(scaleInput?.value ?? "1");
  const spread = resolveSpread(currentPageNumber, layoutMode);
  const leftPageNumber = spread.left;
  const rightPageNumber = spread.right;
  currentSpreadLeft = spread.spreadLeft ?? currentPageNumber;
  const requestId = ++spreadRequestId;
  activeSpreadId = requestId;
  const isActive = () => requestId === activeSpreadId;

  const loadAtTarget = async (target: { qualityScale: number; maxWidthScale: number }) => {
    return Promise.all([
      leftPageNumber
        ? requestAndLoadPage(leftPageNumber, layoutMode, scale, isActive, { target })
        : null,
      layoutMode === "double" && rightPageNumber && rightPageNumber <= totalDocumentPages
        ? requestAndLoadPage(rightPageNumber, layoutMode, scale, isActive, { target })
        : null
    ]);
  };
  const loadRightBack = async (pageNumber: number | null) => {
    if (!pageNumber || layoutMode !== "double") return;
    const backPageNumber = pageNumber + 1;
    if (backPageNumber > totalDocumentPages) {
      rightPage.setBackTexture(null);
      return;
    }
    const target = { qualityScale: underQualityScale, maxWidthScale: underQualityScale };
    const render = await requestAndLoadPage(backPageNumber, layoutMode, scale, isActive, {
      allowInactiveCache: true,
      target
    });
    if (!isActive() || !render) return;
    rightPage.setBackTexture(render.texture);
  };

  try {
    let referenceRender: { width: number; height: number } | null = null;
    // Fast low-res pass for immediate response.
    const [leftRender, rightRender] = await loadAtTarget({
      qualityScale: underQualityScale,
      maxWidthScale: underQualityScale
    });
    if (!isActive()) return;
    if (leftRender) {
      leftPage.setTexture(leftRender.texture);
      referenceRender = { width: leftRender.width, height: leftRender.height };
      if (rightRender) {
        leftPage.setBackTexture(rightRender.texture);
      }
    } else {
      leftPage.setTexture(null);
    }

    if (rightRender) {
      rightPage.setTexture(rightRender.texture);
      if (!referenceRender) {
        referenceRender = { width: rightRender.width, height: rightRender.height };
      }
    } else {
      rightPage.setTexture(null);
    }
    void loadRightBack(rightPageNumber);

    if (referenceRender) {
      updateLayout(referenceRender.width, referenceRender.height, layoutMode);
    }
    await loadUnderSpread(underDirection);
    void loadTurningBackTexture("forward");
    void loadTurningBackTexture("backward");
    void preloadDirection("forward");
    void preloadDirection("backward");
    void prefetchAdjacentPages();
    enforcePageCacheWindow();

    // High-res pass swaps in when ready.
    void (async () => {
      const [leftHi, rightHi] = await loadAtTarget({
        qualityScale: activeQualityBoost,
        maxWidthScale: activeQualityBoost
      });
      if (!isActive()) return;
      if (leftHi) {
        leftPage.setTexture(leftHi.texture);
      }
      if (rightHi) {
        rightPage.setTexture(rightHi.texture);
      }
      if (leftHi && rightHi) {
        leftPage.setBackTexture(rightHi.texture);
      }
    })();
  } catch (error) {
    console.error("Failed to load spread:", error);
  }
}

let perfFrames = 0;
let perfLastTime = 0;
let perfLastUpdate = 0;
let perfFps = 0;

function getTexturePage(texture: THREE.Texture | null | undefined) {
  return (texture?.userData as { pageNumber?: number } | undefined)?.pageNumber ?? null;
}

function getMeshFaceTexturePage(mesh: THREE.Mesh, faceIndex: number) {
  const mats = mesh.material as THREE.Material[];
  const mat = mats?.[faceIndex] as THREE.MeshPhongMaterial | undefined;
  return getTexturePage(mat?.map ?? null);
}

function logTurnDebug(direction: "forward" | "backward") {
  const turning = direction === "forward" ? rightPage : leftPage;
  const turningMaterial = turning.mesh.material as THREE.Material[];
  const frontMat = turningMaterial?.[5] as THREE.MeshPhongMaterial | undefined;
  const backMat = turningMaterial?.[4] as THREE.MeshPhongMaterial | undefined;
  const frontTex = frontMat?.map ?? null;
  const backTex = backMat?.map ?? null;

  const layout = (turning.mesh.geometry as THREE.BufferGeometry).userData?.layout as
    | { E: number; frontTop: number; backTop: number }
    | undefined;
  const uvAttr = (turning.mesh.geometry as THREE.BufferGeometry).getAttribute("uv") as
    | THREE.BufferAttribute
    | undefined;
  const samples: Array<{ r: number; uFront: number | null; uBack: number | null }> = [];
  if (layout && uvAttr) {
    const last = Math.max(0, layout.E - 1);
    const mid = Math.floor(last / 2);
    const indices = [0, mid, last];
    for (const r of indices) {
      const uFront = uvAttr.getX(layout.frontTop + r);
      const uBack = uvAttr.getX(layout.backTop + r);
      samples.push({ r, uFront, uBack });
    }
  }

  console.log("flipbook: turn debug", {
    direction,
    layoutMode: resolveLayout(),
    currentSpreadLeft,
    turningSide: direction === "forward" ? "right" : "left",
    turningFrontPage: getTexturePage(frontTex),
    turningBackPage: getTexturePage(backTex),
    underLeftPage: getUnderPages(direction).underLeft,
    underRightPage: getUnderPages(direction).underRight,
    underLeftTexture: getMeshFaceTexturePage(underLeftPage.mesh, 5),
    underRightTexture: getMeshFaceTexturePage(underRightPage.mesh, 5),
    uvSamples: samples,
    note: "uvSamples r=0 outer, r=mid mid, r=last spine"
  });
}

function animate(time: number = 0) {
  // Update controller (handles physics animation internally)
  flipbookController.update(time / 1000);
  updateFoldShadows();
  if (debugOverlay) {
    debugOverlay.setPageBounds("left", getScreenBounds(leftPage.mesh));
    debugOverlay.setPageBounds("right", getScreenBounds(rightPage.mesh));
  }

  renderer.render(scene, camera);
  if (perfOverlay) {
    perfFrames += 1;
    if (perfLastTime === 0) {
      perfLastTime = time;
      perfLastUpdate = time;
    }
    const elapsed = time - perfLastTime;
    if (elapsed >= 500) {
      perfFps = (perfFrames * 1000) / elapsed;
      perfFrames = 0;
      perfLastTime = time;
    }
    if (time - perfLastUpdate >= 500) {
      perfLastUpdate = time;
      perfOverlay.textContent = `fps: ${perfFps.toFixed(1)} | cache: ${pageRenderCache.size()}`;
    }
  }
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
const dragFeelSelect = document.getElementById("dragFeelSelect") as HTMLSelectElement | null;
const hideTurningFrontToggle = document.getElementById("hideTurningFrontToggle") as HTMLInputElement | null;
const hideUnderPagesToggle = document.getElementById("hideUnderPagesToggle") as HTMLInputElement | null;

let sessionId = "";
let token = "";
let documentId = "";
let isDocumentPreprocessed = false;
let lastPageSize: { width: number; height: number } | null = null;
let hideTurningFrontFace = false;
let lastTurnDirection: "forward" | "backward" | null = null;
let hideUnderPagesDuringDrag = false;
const turningFrontBiasDelta = 2.0;
const urlTextureCache = new TextureCache(10);
const pageRenderCache = new TextureCache(16);
const pageRenderPromises = new Map<string, Promise<CachedTexture | null>>();
const disableTextureCache = true;
const pageCacheWindow = 3;
const activeQualityBoost = 1.2;
const underQualityScale = 0.9;

type LayoutMode = "auto" | "single" | "double";
type PageSizePreset = "auto" | "a4" | "6x9" | "8.5x8.5";
type QualityPreset = "low" | "medium" | "high";

function resolveLayout(): LayoutMode {
  const selection = (
    (document.getElementById("layoutSelect") as HTMLSelectElement | null)?.value ?? "auto"
  ) as LayoutMode;
  if (selection !== "auto") return selection;
  return getViewportClass() === "mobile" ? "single" : "double";
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
  // Stack top is at bookThickness, so pages must sit above that.
  const pageY = bookThickness + 0.001;

  if (mode === "double") {
    // Set page sizes: width (X) and depth (Z)
    leftPage.setSize(pageW, pageD);
    rightPage.setSize(pageW, pageD);
    underLeftPage.setSize(pageW, pageD);
    underRightPage.setSize(pageW, pageD);
    leftPage.setSide("left");
    rightPage.setSide("right");
    underLeftPage.setSide("left");
    underRightPage.setSide("right");

    // Position pages at spine (X=0), slightly above Y=0
    leftPage.group.position.set(0, pageY, 0);
    rightPage.group.position.set(0, pageY, 0);
    // Keep under pages just below the visible pages but above the stack.
    underLeftPage.group.position.set(0, pageY - 0.002, 0);
    underRightPage.group.position.set(0, pageY - 0.002, 0);

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

    updateStackDepth(pageW, pageD, bookThickness, mode);

    rightPage.mesh.visible = true;
    leftPage.mesh.visible = true;
    underLeftPage.mesh.visible = true;
    underRightPage.mesh.visible = true;
  } else {
    // Single page mode - show as right page (like first page of book)
    leftPage.setSize(pageW, pageD);
    leftPage.setSide("right");
    // Position so page is centered (spine edge at X=0, page extends to +X)
    leftPage.group.position.set(0, pageY, 0);

    underLeftPage.mesh.visible = false;
    underRightPage.mesh.visible = false;
    leftStack.visible = !minimalRender;
    rightPage.mesh.visible = false;
    leftPage.mesh.visible = true;
    spine.visible = false;
    shadowEdge.visible = false;
    rightStack.visible = false;
    leftShadow.visible = false;
    rightShadow.visible = false;

    if (!minimalRender) {
      leftStack.scale.set(pageW, bookThickness, pageD);
      leftStack.position.set(pageW / 2, 0, 0);
    }

    updateStackDepth(pageW, pageD, bookThickness, mode);
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
    isDocumentPreprocessed = false;
    urlTextureCache.clear();
    pageRenderCache.clear();
    pageRenderPromises.clear();
    if (typeof result.pageCount === "number" && Number.isFinite(result.pageCount)) {
      totalDocumentPages = result.pageCount;
    }
    setStatus(`Uploaded ${result.filename} - preprocessing...`);

    // Poll for preprocessing completion in background
    if (result.preprocessingStarted) {
      pollPreprocessingStatus(result.id);
    }
  } catch (error) {
    console.error(error);
    setStatus(`Upload failed: ${(error as Error).message}`);
  }
}

/**
 * Poll for preprocessing status and update when complete
 */
async function pollPreprocessingStatus(docId: string) {
  const maxAttempts = 120; // 2 minutes max
  const pollInterval = 1000; // 1 second

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (documentId !== docId) {
      // Document changed, stop polling
      return;
    }

    try {
      const status = await getDocumentStatus(token, docId);

      if (status.preprocessed) {
        isDocumentPreprocessed = true;
        if (status.pageCount) {
          totalDocumentPages = status.pageCount;
        }
        setStatus(`Ready - ${status.pageCount} pages preprocessed`);
        // Clear cache to force reload with preprocessed pages
        pageRenderCache.clear();
        return;
      }

      if (status.preprocessingError) {
        setStatus(`Preprocessing failed: ${status.preprocessingError}`);
        return;
      }

      // Update progress
      setStatus(`Preprocessing: ${status.preprocessingProgress}%`);
    } catch (error) {
      console.warn("Failed to check preprocessing status:", error);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  setStatus("Preprocessing taking longer than expected - pages will load on demand");
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
    if (!Number.isFinite(totalDocumentPages) || totalDocumentPages < 1) {
      totalDocumentPages = 1;
    }
    const requestId = ++spreadRequestId;
    activeSpreadId = requestId;
    const isActive = () => requestId === activeSpreadId;

    let layoutMode = resolveLayout();
    const spread = resolveSpread(pageNumber, layoutMode);
    const leftPageNumber = spread.left;
    const rightPageNumber = spread.right;
    currentSpreadLeft = spread.spreadLeft ?? pageNumber;
    let referenceRender: { width: number; height: number } | null = null;
    let leftRender: Awaited<ReturnType<typeof requestAndLoadPage>> | null = null;
    let rightRender: Awaited<ReturnType<typeof requestAndLoadPage>> | null = null;

    if (leftPageNumber) {
      leftRender = await requestAndLoadPage(leftPageNumber, layoutMode, scale, isActive, {
        target: { qualityScale: underQualityScale, maxWidthScale: underQualityScale }
      });
      if (!isActive() || !leftRender) return;
      leftPage.setTexture(leftRender.texture);
      referenceRender = { width: leftRender.width, height: leftRender.height };
    } else {
      leftPage.setTexture(null);
    }

    if (layoutMode === "double" && rightPageNumber) {
      rightRender = await requestAndLoadPage(rightPageNumber, layoutMode, scale, isActive, {
        target: { qualityScale: underQualityScale, maxWidthScale: underQualityScale }
      });
      if (!isActive() || !rightRender) return;
      rightPage.setTexture(rightRender.texture);
      if (!referenceRender) {
        referenceRender = { width: rightRender.width, height: rightRender.height };
      }
    } else {
      rightPage.setTexture(null);
    }

    if (leftRender && rightRender) {
      leftPage.setBackTexture(rightRender.texture);
    }
    if (layoutMode === "double" && rightPageNumber) {
      const backPageNumber = rightPageNumber + 1;
      if (backPageNumber > totalDocumentPages) {
        rightPage.setBackTexture(null);
      } else {
        const backRender = await requestAndLoadPage(backPageNumber, layoutMode, scale, isActive, {
          allowInactiveCache: true,
          target: { qualityScale: underQualityScale, maxWidthScale: underQualityScale }
        });
        if (isActive() && backRender) {
          rightPage.setBackTexture(backRender.texture);
        }
      }
    }

    if (referenceRender) {
      lastPageSize = referenceRender;
      updateLayout(referenceRender.width, referenceRender.height, layoutMode);
      // Update controller with page dimensions
      flipbookController.setPageDimensions(referenceRender.width, referenceRender.height);
    }

    flipbookController.setTotalPages(totalDocumentPages);
    flipbookController.setCurrentPage(pageNumber - 1);

    setStatus(`Rendered page ${pageNumber}${layoutMode === "double" ? " (spread)" : ""} - Use arrow keys or drag corners to turn pages`);
    await loadUnderSpread(underDirection);
    void loadTurningBackTexture("forward");
    void loadTurningBackTexture("backward");
    void preloadDirection("forward");
    void preloadDirection("backward");
    void prefetchAdjacentPages();
    enforcePageCacheWindow();

    // High-res swap for active spread.
    void (async () => {
      if (!isActive()) return;
      const highTarget = { qualityScale: activeQualityBoost, maxWidthScale: activeQualityBoost };
      const [leftHi, rightHi] = await Promise.all([
        leftPageNumber
          ? requestAndLoadPage(leftPageNumber, layoutMode, scale, isActive, {
              target: highTarget
            })
          : null,
        layoutMode === "double" && rightPageNumber && rightPageNumber <= totalDocumentPages
          ? requestAndLoadPage(rightPageNumber, layoutMode, scale, isActive, {
              target: highTarget
            })
          : null
      ]);
      if (!isActive()) return;
      if (leftHi) leftPage.setTexture(leftHi.texture);
      if (rightHi) rightPage.setTexture(rightHi.texture);
      if (leftHi && rightHi) {
        leftPage.setBackTexture(rightHi.texture);
      }
    })();
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
    flipbookController.setPageStep(resolveLayout() === "double" ? 2 : 1);
  }
});
pageInput?.addEventListener("change", () => {
  const pageNumber = Number.parseInt(pageInput.value, 10);
  if (Number.isFinite(pageNumber)) {
    flipbookController.setCurrentPage(pageNumber - 1);
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

dragFeelSelect?.addEventListener("change", () => {
  const feel = (dragFeelSelect.value as "snappy" | "soft") ?? "snappy";
  flipbookController.setDragFeel(feel);
});
hideTurningFrontToggle?.addEventListener("change", () => {
  hideTurningFrontFace = !!hideTurningFrontToggle.checked;
  if (!hideTurningFrontFace) {
    leftPage.setFrontVisible(true);
    rightPage.setFrontVisible(true);
    return;
  }
  if (!lastTurnDirection) return;
  if (lastTurnDirection === "forward") {
    rightPage.setFrontVisible(false);
  } else {
    leftPage.setFrontVisible(false);
  }
});
hideUnderPagesToggle?.addEventListener("change", () => {
  hideUnderPagesDuringDrag = !!hideUnderPagesToggle.checked;
  if (!hideUnderPagesDuringDrag) {
    updateUnderVisibility(underDirection);
  }
});

window.addEventListener("resize", () => {
  if (lastPageSize) {
    updateLayout(lastPageSize.width, lastPageSize.height, resolveLayout());
    flipbookController.setPageStep(resolveLayout() === "double" ? 2 : 1);
  }
});

async function loadTexture(url: string) {
  if (!disableTextureCache) {
    const cached = urlTextureCache.get(url);
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
  texture.flipY = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.repeat.set(1, 1);
  texture.offset.set(0, 0);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // Prefer crisp text over mipmapped blur
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  // Revoke object URL after texture is uploaded to GPU (next frame)
  requestAnimationFrame(() => {
    URL.revokeObjectURL(objectUrl);
  });

  const result = { key: url, texture, width: image.width, height: image.height, lastUsed: Date.now() };
  if (!disableTextureCache) {
    urlTextureCache.set(url, result);
  }
  return result;
}

/**
 * Choose the best preprocessed resolution based on target dimensions
 */
function chooseResolution(targetWidth: number | undefined): Resolution {
  if (!targetWidth || targetWidth <= 200) return "thumbnail";
  if (targetWidth <= 1024) return "standard";
  return "high";
}

/**
 * Load a texture from a blob
 */
async function loadTextureFromBlob(blob: Blob): Promise<{
  texture: THREE.Texture;
  width: number;
  height: number;
}> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    const texture = new THREE.Texture(image);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, width: image.width, height: image.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function requestAndLoadPage(
  pageNumber: number,
  mode: LayoutMode,
  scale: number,
  isActive: () => boolean,
  options?: {
    allowInactiveCache?: boolean;
    target?: { qualityScale?: number; maxWidthScale?: number };
  }
) {
  const desired = getTargetDimensions(mode, options?.target);
  const cacheKey = buildPageCacheKey(pageNumber, mode, scale, options?.target);

  const cached = pageRenderCache.get(cacheKey);
  if (cached) return cached;

  const inflight = pageRenderPromises.get(cacheKey);
  if (inflight) {
    const result = await inflight;
    if (!result) return null;
    return isActive() || options?.allowInactiveCache ? result : null;
  }

  const promise = (async () => {
    let loaded: { texture: THREE.Texture; width: number; height: number };

    // Try preprocessed page first if document is preprocessed
    if (isDocumentPreprocessed) {
      try {
        const resolution = chooseResolution(desired.targetWidth);
        const blob = await fetchPreprocessedPage(token, documentId, pageNumber, resolution);
        if (blob) {
          loaded = await loadTextureFromBlob(blob);
        } else {
          // Preprocessed page not available, fall back to on-demand rasterization
          throw new Error("Preprocessed page returned null");
        }
      } catch (preprocessError) {
        // Fall back to on-demand rasterization on any error
        console.warn(`Preprocessed page ${pageNumber} failed, falling back to rasterization:`, preprocessError);
        const first = await rasterizePage(token, {
          sessionId,
          documentId,
          pageNumber,
          scale,
          ...desired
        });
        loaded = await loadTexture(first.url);
      }
    } else {
      // Document not preprocessed, use on-demand rasterization
      const first = await rasterizePage(token, {
        sessionId,
        documentId,
        pageNumber,
        scale,
        ...desired
      });
      loaded = await loadTexture(first.url);
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
    }

    loaded.texture.userData = {
      ...(loaded.texture.userData ?? {}),
      pageNumber,
      cacheKey
    };
    const cachedValue = {
      ...loaded,
      key: cacheKey,
      requestedWidth: desired.targetWidth,
      requestedHeight: desired.targetHeight
    };
    pageRenderCache.set(cacheKey, cachedValue);
    return cachedValue;
  })();

  pageRenderPromises.set(cacheKey, promise);
  try {
    const result = await promise;
    if (!result) return null;
    return isActive() || options?.allowInactiveCache ? result : null;
  } finally {
    pageRenderPromises.delete(cacheKey);
  }
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

function getScreenBounds(mesh: THREE.Mesh) {
  const rect = renderer.domElement.getBoundingClientRect();
  const geometry = mesh.geometry as THREE.BufferGeometry;
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }
  const box = geometry.boundingBox;
  if (!box) return null;
  const corners = [
    new THREE.Vector3(box.min.x, 0, box.min.z),
    new THREE.Vector3(box.max.x, 0, box.min.z),
    new THREE.Vector3(box.min.x, 0, box.max.z),
    new THREE.Vector3(box.max.x, 0, box.max.z),
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    corner.applyMatrix4(mesh.matrixWorld).project(camera);
    const sx = ((corner.x + 1) / 2) * rect.width;
    const sy = ((-corner.y + 1) / 2) * rect.height;
    minX = Math.min(minX, sx);
    maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy);
    maxY = Math.max(maxY, sy);
  }
  return { minX, maxX, minY, maxY };
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

function resolveSpread(
  pageNumber: number,
  mode: LayoutMode
): { left: number | null; right: number | null; spreadLeft: number | null } {
  if (mode !== "double") {
    return { left: pageNumber, right: null, spreadLeft: pageNumber };
  }
  if (pageNumber < 1) {
    return { left: null, right: null, spreadLeft: null };
  }
  const spreadLeft = pageNumber % 2 === 0 ? pageNumber - 1 : pageNumber;
  const right = spreadLeft + 1 <= totalDocumentPages ? spreadLeft + 1 : null;
  return { left: spreadLeft, right, spreadLeft };
}

function buildPageCacheKey(
  pageNumber: number,
  mode: LayoutMode,
  scale: number,
  target?: { qualityScale?: number; maxWidthScale?: number }
) {
  const desired = getTargetDimensions(mode, target);
  return `${documentId}|${mode}|${pageNumber}|${scale}|${desired.targetWidth ?? "auto"}x${desired.targetHeight ?? "auto"}`;
}

function getCachedPageRender(
  pageNumber: number,
  mode: LayoutMode,
  scale: number,
  target?: { qualityScale?: number; maxWidthScale?: number }
) {
  if (!documentId) return null;
  const key = buildPageCacheKey(pageNumber, mode, scale, target);
  return pageRenderCache.get(key) ?? null;
}

function applyUnderFromCache(direction: "forward" | "backward") {
  if (!documentId || !token) return;
  const layoutMode = resolveLayout();
  if (layoutMode !== "double") return;
  const scale = Number.parseFloat(scaleInput?.value ?? "1");
  const target = { qualityScale: underQualityScale, maxWidthScale: underQualityScale };
  let underLeft: number | null = null;
  let underRight: number | null = null;
  if (direction === "forward") {
    underLeft = currentSpreadLeft + 2;
    underRight = currentSpreadLeft + 3;
  } else {
    underLeft = currentSpreadLeft - 2;
    underRight = currentSpreadLeft - 1;
  }

  updateUnderVisibility(direction);
  const leftCached =
    underLeft && underLeft >= 1 && underLeft <= totalDocumentPages
      ? getCachedPageRender(underLeft, layoutMode, scale, target)
      : null;
  const rightCached =
    underRight && underRight >= 1 && underRight <= totalDocumentPages
      ? getCachedPageRender(underRight, layoutMode, scale, target)
      : null;

  if (leftCached) {
    underLeftPage.setTexture(leftCached.texture);
  }
  if (rightCached) {
    underRightPage.setTexture(rightCached.texture);
  }
  if (leftCached && rightCached) {
    underLeftPage.setBackTexture(rightCached.texture);
    underRightPage.setBackTexture(leftCached.texture);
  }
}

function getUnderPages(direction: "forward" | "backward") {
  if (direction === "forward") {
    return { underLeft: currentSpreadLeft + 2, underRight: currentSpreadLeft + 3 };
  }
  return { underLeft: currentSpreadLeft - 2, underRight: currentSpreadLeft - 1 };
}

function updateUnderVisibility(direction: "forward" | "backward") {
  const layoutMode = resolveLayout();
  if (layoutMode !== "double") {
    underLeftPage.mesh.visible = false;
    underRightPage.mesh.visible = false;
    return;
  }
  const { underLeft, underRight } = getUnderPages(direction);
  const showLeft = underLeft >= 1 && underLeft <= totalDocumentPages;
  const showRight = underRight >= 1 && underRight <= totalDocumentPages;
  underLeftPage.mesh.visible = showLeft;
  underRightPage.mesh.visible = showRight;
}


async function loadTurningBackTexture(direction: "forward" | "backward") {
  if (!documentId || !token) return;
  const layoutMode = resolveLayout();
  const scale = Number.parseFloat(scaleInput?.value ?? "1");
  const target = { qualityScale: underQualityScale, maxWidthScale: underQualityScale };

  if (layoutMode === "single") {
    // In single page mode, back shows next/prev page
    const targetPage = direction === "forward"
      ? currentPageNumber + 1
      : currentPageNumber - 1;
    if (targetPage < 1 || targetPage > totalDocumentPages) {
      leftPage.setBackTexture(null);
      return;
    }
    const render = await requestAndLoadPage(targetPage, layoutMode, scale, () => true, {
      allowInactiveCache: true,
      target
    });
    if (render) {
      leftPage.setBackTexture(render.texture);
    }
    return;
  }

  // Double page mode
  const targetPage = getTurningBackPage(direction);
  if (targetPage < 1 || targetPage > totalDocumentPages) return;
  const render = await requestAndLoadPage(targetPage, layoutMode, scale, () => true, {
    allowInactiveCache: true,
    target
  });
  if (!render) return;
}

function getTurningBackPage(direction: "forward" | "backward") {
  return direction === "forward" ? currentSpreadLeft + 2 : currentSpreadLeft - 1;
}

function areUnderPagesReady(direction: "forward" | "backward") {
  if (!documentId || !token) return false;
  const layoutMode = resolveLayout();
  if (layoutMode !== "double") return true;
  const scale = Number.parseFloat(scaleInput?.value ?? "1");
  const target = { qualityScale: underQualityScale, maxWidthScale: underQualityScale };
  let underLeft: number | null = null;
  let underRight: number | null = null;
  if (direction === "forward") {
    underLeft = currentSpreadLeft + 2;
    underRight = currentSpreadLeft + 3;
  } else {
    underLeft = currentSpreadLeft - 2;
    underRight = currentSpreadLeft - 1;
  }
  const leftReady =
    !underLeft ||
    underLeft < 1 ||
    underLeft > totalDocumentPages ||
    !!getCachedPageRender(underLeft, layoutMode, scale, target);
  const rightReady =
    !underRight ||
    underRight < 1 ||
    underRight > totalDocumentPages ||
    !!getCachedPageRender(underRight, layoutMode, scale, target);
  return leftReady && rightReady;
}

function isTurningBackReady(direction: "forward" | "backward") {
  if (!documentId || !token) return false;
  const layoutMode = resolveLayout();
  const scale = Number.parseFloat(scaleInput?.value ?? "1");
  const target = { qualityScale: underQualityScale, maxWidthScale: underQualityScale };

  if (layoutMode === "single") {
    const targetPage = direction === "forward"
      ? currentPageNumber + 1
      : currentPageNumber - 1;
    if (targetPage < 1 || targetPage > totalDocumentPages) return true;
    return !!getCachedPageRender(targetPage, layoutMode, scale, target);
  }

  // Double page mode
  const targetPage = getTurningBackPage(direction);
  if (targetPage < 1 || targetPage > totalDocumentPages) return true;
  return !!getCachedPageRender(targetPage, layoutMode, scale, target);
}

async function prefetchAdjacentPages() {
  if (!documentId || !token) return;
  const layoutMode = resolveLayout();
  const scale = Number.parseFloat(scaleInput?.value ?? "1");
  const target = { qualityScale: underQualityScale, maxWidthScale: underQualityScale };
  const pages: number[] = [];
  if (layoutMode === "double") {
    pages.push(
      currentSpreadLeft + 2,
      currentSpreadLeft + 3,
      currentSpreadLeft - 2,
      currentSpreadLeft - 1
    );
  } else {
    pages.push(currentPageNumber + 1, currentPageNumber - 1);
  }
  const unique = Array.from(new Set(pages)).filter(
    (page) => page >= 1 && page <= totalDocumentPages
  );
  if (unique.length === 0) return;
  await Promise.all(
    unique.map((page) =>
      requestAndLoadPage(page, layoutMode, scale, () => true, {
        allowInactiveCache: true,
        target
      })
    )
  );
}

function enforcePageCacheWindow() {
  if (!documentId) return;
  const layoutMode = resolveLayout();
  const base =
    layoutMode === "double" ? currentSpreadLeft : Math.max(1, currentPageNumber);
  const minPage = Math.max(1, base - pageCacheWindow);
  const maxPage = Math.min(totalDocumentPages, base + pageCacheWindow);

  const keys = pageRenderCache.keys();
  for (const key of keys) {
    const parts = key.split("|");
    if (parts.length < 4) continue;
    const cacheDocId = parts[0];
    const pageNumber = Number.parseInt(parts[2], 10);
    if (cacheDocId !== documentId || !Number.isFinite(pageNumber)) {
      pageRenderCache.delete(key);
      continue;
    }
    if (pageNumber < minPage || pageNumber > maxPage) {
      pageRenderCache.delete(key);
    }
  }
}

async function loadUnderSpread(direction: "forward" | "backward") {
  if (!documentId || !token) return;
  const layoutMode = resolveLayout();
  if (layoutMode !== "double") {
    underLeftPage.setTexture(null);
    underRightPage.setTexture(null);
    return;
  }
  const requestId = ++underRequestId;
  activeUnderId = requestId;
  const isActive = () => requestId === activeUnderId;
  const scale = Number.parseFloat(scaleInput?.value ?? "1");
  const target = { qualityScale: underQualityScale, maxWidthScale: underQualityScale };
  let underLeft: number | null = null;
  let underRight: number | null = null;
  if (direction === "forward") {
    underLeft = currentSpreadLeft + 2;
    underRight = currentSpreadLeft + 3;
  } else {
    underLeft = currentSpreadLeft - 2;
    underRight = currentSpreadLeft - 1;
  }

  const [leftRender, rightRender] = await Promise.all([
    !underLeft || underLeft < 1 || underLeft > totalDocumentPages
      ? Promise.resolve(null)
      : requestAndLoadPage(underLeft, layoutMode, scale, isActive, { target }),
    !underRight || underRight < 1 || underRight > totalDocumentPages
      ? Promise.resolve(null)
      : requestAndLoadPage(underRight, layoutMode, scale, isActive, { target }),
  ]);
  if (!isActive()) return;

  if (leftRender) {
    underLeftPage.setTexture(leftRender.texture);
  } else {
    underLeftPage.setTexture(null);
    underLeftPage.setBackTexture(null);
  }

  if (rightRender) {
    underRightPage.setTexture(rightRender.texture);
  } else {
    underRightPage.setTexture(null);
    underRightPage.setBackTexture(null);
  }

  if (leftRender && rightRender) {
    underLeftPage.setBackTexture(rightRender.texture);
    underRightPage.setBackTexture(leftRender.texture);
  } else {
    underLeftPage.setBackTexture(null);
    underRightPage.setBackTexture(null);
  }
}

async function preloadDirection(direction: "forward" | "backward") {
  if (!documentId || !token) return;
  const layoutMode = resolveLayout();
  if (layoutMode !== "double") return;
  const scale = Number.parseFloat(scaleInput?.value ?? "1");
  const target = { qualityScale: underQualityScale, maxWidthScale: underQualityScale };
  let underLeft: number | null = null;
  let underRight: number | null = null;
  if (direction === "forward") {
    underLeft = currentSpreadLeft + 2;
    underRight = currentSpreadLeft + 3;
  } else {
    underLeft = currentSpreadLeft - 2;
    underRight = currentSpreadLeft - 1;
  }
  const [leftRender, rightRender] = await Promise.all([
    !underLeft || underLeft < 1 || underLeft > totalDocumentPages
      ? Promise.resolve(null)
      : requestAndLoadPage(underLeft, layoutMode, scale, () => true, {
          allowInactiveCache: true,
          target
        }),
    !underRight || underRight < 1 || underRight > totalDocumentPages
      ? Promise.resolve(null)
      : requestAndLoadPage(underRight, layoutMode, scale, () => true, {
          allowInactiveCache: true,
          target
        }),
  ]);

  if (leftRender) underLeftPage.setTexture(leftRender.texture);
  if (rightRender) underRightPage.setTexture(rightRender.texture);
  if (leftRender && rightRender) {
    underLeftPage.setBackTexture(rightRender.texture);
    underRightPage.setBackTexture(leftRender.texture);
  }
}

function updateStackDepth(pageW: number, pageD: number, baseThickness: number, mode: LayoutMode) {
  const perPage = 0.0004;
  let leftCount = 0;
  let rightCount = 0;
  if (mode === "double") {
    leftCount = Math.max(0, currentSpreadLeft - 1);
    rightCount = Math.max(0, totalDocumentPages - (currentSpreadLeft + 1));
  } else {
    leftCount = Math.max(0, currentPageNumber - 1);
    rightCount = Math.max(0, totalDocumentPages - currentPageNumber);
  }
  const leftThickness = Math.min(0.04, Math.max(0.002, leftCount * perPage));
  const rightThickness = Math.min(0.04, Math.max(0.002, rightCount * perPage));

  if (!minimalRender) {
    leftStack.scale.set(pageW, leftThickness, pageD);
    rightStack.scale.set(pageW, rightThickness, pageD);
    leftStack.position.set(-pageW / 2, leftThickness / 2, 0);
    rightStack.position.set(pageW / 2, rightThickness / 2, 0);
  }
}

function updateFoldShadows() {
  const turning = turnDirection === "forward" ? rightPage : leftPage;
  if (!turning.mesh.visible) {
    foldInnerShadow.visible = false;
    foldOuterShadow.visible = false;
    return;
  }
  const bounds = getScreenBounds(turning.mesh);
  if (!bounds) {
    foldInnerShadow.visible = false;
    foldOuterShadow.visible = false;
    return;
  }

  const angle = turning.getAngle();
  const t = Math.max(0, Math.min(1, angle / 180));
  const widthNdc = (bounds.maxX - bounds.minX) / renderer.domElement.clientWidth;
  const shadowWidth = Math.max(0.05, widthNdc * (1.2 + t));
  const offset = 0.04 + t * 0.12;
  const innerOpacity = 0.08 + t * 0.22;
  const outerOpacity = 0.06 + t * 0.18;
  const sign = turnDirection === "forward" ? 1 : -1;

  foldInnerShadow.visible = angle > 1;
  foldOuterShadow.visible = angle > 1;
  foldInnerShadow.scale.set(shadowWidth, 1, 1);
  foldOuterShadow.scale.set(shadowWidth, 1, 1);
  foldInnerShadow.position.set(sign * offset, 0.012, 0);
  foldOuterShadow.position.set(-sign * offset, 0.011, 0);
  (foldInnerShadow.material as THREE.MeshBasicMaterial).opacity = innerOpacity;
  (foldOuterShadow.material as THREE.MeshBasicMaterial).opacity = outerOpacity;
}

function getTargetDimensions(
  mode: LayoutMode,
  options?: { qualityScale?: number; maxWidthScale?: number }
) {
  if (!lastPageSize) return {};
  const canvasWidth = renderer.domElement.clientWidth;
  const canvasHeight = renderer.domElement.clientHeight;
  const dpr = Math.min(window.devicePixelRatio, 3);
  const widthForPage = mode === "double" ? canvasWidth * 0.5 : canvasWidth;
  const quality = getQualityPreset();
  const baseMultiplier = quality === "high" ? 2.2 : quality === "low" ? 1.2 : 1.6;
  const baseMaxWidth = quality === "high" ? 5200 : quality === "low" ? 3000 : 4200;
  const multiplier = baseMultiplier * (options?.qualityScale ?? 1);
  const maxWidth = baseMaxWidth * (options?.maxWidthScale ?? 1);
  const baseWidth = widthForPage * dpr * multiplier;
  const targetWidth = Math.min(Math.round(baseWidth), maxWidth);
  const aspect = getPageAspect() ?? lastPageSize.width / lastPageSize.height;
  const targetHeight = Math.round(targetWidth / aspect);
  if (targetWidth <= 0 || targetHeight <= 0) return {};
  return { targetWidth, targetHeight };
}
