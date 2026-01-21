/**
 * Flipbook Interaction Controller
 * Handles book-style page turning around the spine
 */

import { FlipbookStateMachine, FlipbookState } from "./stateMachine";
import { PagePhysics } from "./physics";
import type { PageMesh } from "../renderer/createPageMesh";
import * as THREE from "three";

export interface InteractionConfig {
  // Hit area on right side for forward turn (fraction of width)
  turnAreaFraction: number;
  // Minimum drag distance to start turn (pixels)
  dragThreshold: number;
  // Corner hit area size as fraction of page size
  cornerHitAreaFraction: number;
  // Edge hit area size as fraction of page size (non-corner)
  edgeHitAreaFraction: number;
  // Enable console debug logging
  debug: boolean;
  // Optional debug reporter for on-screen overlay
  debugReporter?: (message: string) => void;
}

const DEFAULT_CONFIG: InteractionConfig = {
  turnAreaFraction: 0.3,
  dragThreshold: 10,
  cornerHitAreaFraction: 0.18,
  edgeHitAreaFraction: 0.12,
  debug: false,
  debugReporter: undefined,
};

export type PageChangeCallback = (page: number) => void;

export class FlipbookController {
  private stateMachine: FlipbookStateMachine;
  private physics: PagePhysics;
  private config: InteractionConfig;

  private leftPage: PageMesh;
  private rightPage: PageMesh;
  private turningPage: PageMesh | null = null;
  private turnDirection: "forward" | "backward" | null = null;

  private container: HTMLElement;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private inputTarget: HTMLElement;
  private pageWidth: number = 1;
  private pageHeight: number = 1;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private tempVec = new THREE.Vector3();
  private tempVec2 = new THREE.Vector3();
  private tempVec3 = new THREE.Vector3();
  private tempVec4 = new THREE.Vector3();

  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartU: number = 0;
  private dragStartTime: number = 0;
  private dragSide: "left" | "right" | null = null;
  private hasExceededThreshold: boolean = false;

  private animationFrame: number | null = null;
  private lastTime: number = 0;

  private onPageChange: PageChangeCallback | null = null;

  constructor(
    container: HTMLElement,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    leftPage: PageMesh,
    rightPage: PageMesh,
    totalPages: number,
    config: Partial<InteractionConfig> = {}
  ) {
    this.container = container;
    this.camera = camera;
    this.renderer = renderer;
    this.inputTarget = renderer.domElement;
    this.inputTarget.style.touchAction = "none";
    this.leftPage = leftPage;
    this.rightPage = rightPage;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.stateMachine = new FlipbookStateMachine(totalPages);
    this.physics = new PagePhysics({
      springK: 80,
      damping: 12,
    });

    // Initialize page sides
    this.leftPage.setSide("left");
    this.rightPage.setSide("right");

    this.setupEventListeners();
    this.setupStateListeners();
  }

  setPageChangeCallback(callback: PageChangeCallback): void {
    this.onPageChange = callback;
  }

  setPageDimensions(width: number, height: number): void {
    this.pageWidth = width;
    this.pageHeight = height;
  }

  setTotalPages(total: number): void {
    this.stateMachine.setTotalPages(total);
  }

  getCurrentPage(): number {
    return this.stateMachine.getCurrentPage();
  }

  private setupEventListeners(): void {
    // Pointer events (mouse + touch)
    this.inputTarget.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);

    // Keyboard events
    window.addEventListener("keydown", this.handleKeyDown);
  }

  private setupStateListeners(): void {
    this.stateMachine.onStateChange((oldState, newState) => {
      if (
        newState === FlipbookState.DRAGGING_FORWARD ||
        newState === FlipbookState.ANIMATING_FORWARD
      ) {
        this.turnDirection = "forward";
        this.turningPage = this.rightPage;
        this.turningPage.beginAnimation();
      } else if (
        newState === FlipbookState.DRAGGING_BACKWARD ||
        newState === FlipbookState.ANIMATING_BACKWARD
      ) {
        this.turnDirection = "backward";
        this.turningPage = this.leftPage;
        this.turningPage.beginAnimation();
      }

      if (newState === FlipbookState.SETTLING) {
        this.startAnimationLoop();
      }

      if (newState === FlipbookState.IDLE && oldState !== FlipbookState.IDLE) {
        if (this.turningPage) {
          this.turningPage.endAnimation();
          this.turningPage.setProgress(0);
          this.turningPage = null;
        }
        this.turnDirection = null;
      }
    });
  }

  private getPointerPosition(e: MouseEvent | Touch): { x: number; y: number } {
    const rect = this.inputTarget.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private getPageHit(e: MouseEvent | Touch) {
    const rect = this.inputTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pages = [this.rightPage, this.leftPage].filter((p) => p.mesh.visible);
    for (const page of pages) {
      const bounds = this.getScreenBounds(page.mesh, rect);
      if (!bounds) continue;
      if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
        continue;
      }
      const u = (x - bounds.minX) / Math.max(bounds.maxX - bounds.minX, 1);
      const v = 1 - (y - bounds.minY) / Math.max(bounds.maxY - bounds.minY, 1);
      return { page, u, v };
    }
    return null;
  }

  private getScreenBounds(
    mesh: THREE.Mesh,
    rect: DOMRect
  ): { minX: number; maxX: number; minY: number; maxY: number } | null {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    const box = geometry.boundingBox;
    if (!box) return null;
    this.tempVec.set(box.min.x, box.min.y, 0);
    this.tempVec2.set(box.max.x, box.min.y, 0);
    this.tempVec3.set(box.min.x, box.max.y, 0);
    this.tempVec4.set(box.max.x, box.max.y, 0);
    const pts = [this.tempVec, this.tempVec2, this.tempVec3, this.tempVec4];

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const p of pts) {
      p.applyMatrix4(mesh.matrixWorld).project(this.camera);
      const sx = ((p.x + 1) / 2) * rect.width;
      const sy = ((-p.y + 1) / 2) * rect.height;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    return { minX, maxX, minY, maxY };
  }

  private detectHitZone(u: number, v: number): "corner" | "edge" | "none" {
    const cornerSize = this.config.cornerHitAreaFraction;
    const edgeSize = this.config.edgeHitAreaFraction;
    const nearOuter = u > 1 - edgeSize;
    if (!nearOuter) return "none";
    const nearCornerOuter = u > 1 - cornerSize;
    const nearTop = v > 1 - cornerSize;
    const nearBottom = v < cornerSize;
    if (nearCornerOuter && (nearTop || nearBottom)) return "corner";
    return "edge";
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.stateMachine.getState() !== FlipbookState.IDLE) return;

    if (e.pointerType === "mouse" && e.button !== 0) return;
    const pos = this.getPointerPosition(e);
    const hit = this.getPageHit(e);
    if (!hit) {
      if (this.config.debug) {
        const message = `hit: none (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`;
        console.log("flipbook: pointerdown no hit", { x: pos.x, y: pos.y });
        this.config.debugReporter?.(message);
      }
      return;
    }
    const side = hit.page.getSide();
    const uOuter = side === "left" ? 1 - hit.u : hit.u;
    const zone = this.detectHitZone(uOuter, hit.v);
    if (zone === "none") {
      if (this.config.debug) {
        const message = `hit: miss ${side} u=${uOuter.toFixed(2)} v=${hit.v.toFixed(2)}`;
        console.log("flipbook: pointerdown miss zone", {
          side,
          u: hit.u,
          v: hit.v,
          uOuter,
        });
        this.config.debugReporter?.(message);
      }
      return;
    }
    if (side === "right" && !this.stateMachine.canTurnForward()) return;
    if (side === "left" && !this.stateMachine.canTurnBackward()) return;
    if (this.config.debug) {
      const message = `hit: ${zone} ${side} u=${uOuter.toFixed(2)} v=${hit.v.toFixed(2)}`;
      console.log("flipbook: pointerdown start drag", {
        side,
        zone,
        u: hit.u,
        v: hit.v,
        uOuter,
      });
      this.config.debugReporter?.(message);
    }

    this.isDragging = true;
    this.dragStartX = pos.x;
    this.dragStartU = uOuter;
    this.dragStartTime = performance.now();
    this.dragSide = side;
    this.hasExceededThreshold = false;
    this.stateMachine.startDrag(pos.x, pos.y, side);
    this.physics.setPosition(0);
    e.preventDefault();
    (e.target as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const pos = this.getPointerPosition(e);
    const state = this.stateMachine.getState();

    if (!this.isDragging) {
      const hoverHit = this.getPageHit(e);
      if (hoverHit) {
        const hoverSide = hoverHit.page.getSide();
        const hoverOuterU = hoverSide === "left" ? 1 - hoverHit.u : hoverHit.u;
        if (this.detectHitZone(hoverOuterU, hoverHit.v) !== "none") {
          this.stateMachine.hoverCorner(hoverSide);
        } else {
          this.stateMachine.leaveCorner();
        }
      } else {
        this.stateMachine.leaveCorner();
      }
      return;
    }

    if (
      state !== FlipbookState.DRAGGING_FORWARD &&
      state !== FlipbookState.DRAGGING_BACKWARD
    ) {
      return;
    }

    const hit = this.getPageHit(e);
    if (!hit || !this.dragSide) return;
    const uOuter = this.dragSide === "left" ? 1 - hit.u : hit.u;
    const dragDistance = Math.abs(pos.x - this.dragStartX);
    if (!this.hasExceededThreshold && dragDistance < this.config.dragThreshold) {
      return;
    }
    this.hasExceededThreshold = true;

    const deltaU = Math.max(0, this.dragStartU - uOuter);
    const maxU = Math.max(this.dragStartU, 0.001);
    const progress = Math.max(0, Math.min(1, deltaU / maxU));

    this.stateMachine.updateDrag(pos.x, pos.y, progress);
    this.physics.setPosition(progress);
    if (this.turningPage) {
      this.turningPage.setProgress(progress);
    }
  };

  private handlePointerUp = (e?: PointerEvent): void => {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.dragSide = null;
    this.hasExceededThreshold = false;
    if (e) {
      (e.target as HTMLElement | null)?.releasePointerCapture?.(e.pointerId);
    }

    const state = this.stateMachine.getState();
    if (
      state === FlipbookState.DRAGGING_FORWARD ||
      state === FlipbookState.DRAGGING_BACKWARD
    ) {
      const { shouldComplete } = this.stateMachine.endDrag();

      if (shouldComplete) {
        // Animate to completion (progress = 1)
        this.physics.release(1, 0);
        this.startAnimationLoop();
      } else {
        // Snap back (progress = 0)
        this.physics.release(0, 0);
        this.startAnimationLoop();
      }
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "ArrowRight" || e.key === " ") {
      e.preventDefault();
      this.turnPageForward();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      this.turnPageBackward();
    }
  };

  /**
   * Programmatically turn page forward
   */
  turnPageForward(): boolean {
    if (this.stateMachine.getState() !== FlipbookState.IDLE) return false;
    if (!this.stateMachine.canTurnForward()) return false;

    this.stateMachine.turnPage("forward");
    this.physics.setPosition(0);
    this.physics.release(1, 1.5); // Add some initial velocity
    this.startAnimationLoop();
    return true;
  }

  /**
   * Programmatically turn page backward
   */
  turnPageBackward(): boolean {
    if (this.stateMachine.getState() !== FlipbookState.IDLE) return false;
    if (!this.stateMachine.canTurnBackward()) return false;

    this.stateMachine.turnPage("backward");
    this.physics.setPosition(0);
    this.physics.release(1, 1.5);
    this.startAnimationLoop();
    return true;
  }

  private startAnimationLoop(): void {
    if (this.animationFrame !== null) return;
    this.lastTime = performance.now();
    this.animationFrame = requestAnimationFrame(this.animationLoop);
  }

  private stopAnimationLoop(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  private animationLoop = (time: number): void => {
    const deltaTime = (time - this.lastTime) / 1000;
    this.lastTime = time;

    const state = this.stateMachine.getState();
    const progress = this.physics.step(deltaTime);

    if (this.turningPage) {
      this.turningPage.setProgress(progress);
    }

    if (this.physics.isAtRest()) {
      // Check if we completed the turn or snapped back
      const completedTurn = progress > 0.5;

      if (
        state === FlipbookState.ANIMATING_FORWARD ||
        state === FlipbookState.ANIMATING_BACKWARD
      ) {
        const direction = state === FlipbookState.ANIMATING_FORWARD ? "forward" : "backward";
        this.stateMachine.completeAnimation(direction);
        if (this.onPageChange) {
          this.onPageChange(this.stateMachine.getCurrentPage());
        }
      } else if (state === FlipbookState.SETTLING) {
        if (completedTurn) {
          // Finished the turn
          const direction = this.turnDirection === "forward" ? "forward" : "backward";
          this.stateMachine.completeAnimation(direction);
          if (this.onPageChange) {
            this.onPageChange(this.stateMachine.getCurrentPage());
          }
        } else {
          // Snapped back
          this.stateMachine.completeSettling();
        }
      }

      this.stopAnimationLoop();
    } else {
      this.animationFrame = requestAnimationFrame(this.animationLoop);
    }
  };

  /**
   * Update method to be called in render loop
   */
  update(time: number): void {
    this.leftPage.update(time);
    this.rightPage.update(time);
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.stopAnimationLoop();
    this.inputTarget.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerUp);
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}
