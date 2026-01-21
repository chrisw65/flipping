/**
 * Flipbook Interaction Controller
 * Connects state machine, physics, and input handling
 */

import { FlipbookStateMachine, FlipbookState } from "./stateMachine";
import { PagePhysics, calculateDragProgress } from "./physics";
import type { PageMesh } from "../renderer/createPageMesh";

export interface InteractionConfig {
  // Corner hit area as fraction of page dimension
  cornerHitAreaFraction: number;
  // Minimum drag distance to start turn (pixels)
  dragThreshold: number;
}

const DEFAULT_CONFIG: InteractionConfig = {
  cornerHitAreaFraction: 0.15,
  dragThreshold: 10,
};

export type PageChangeCallback = (page: number) => void;

export class FlipbookController {
  private stateMachine: FlipbookStateMachine;
  private physics: PagePhysics;
  private config: InteractionConfig;

  private leftPage: PageMesh;
  private rightPage: PageMesh;
  private turningPage: PageMesh | null = null;

  private container: HTMLElement;
  private pageWidth: number = 1;
  private pageHeight: number = 1;

  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;

  private animationFrame: number | null = null;
  private lastTime: number = 0;

  private onPageChange: PageChangeCallback | null = null;

  constructor(
    container: HTMLElement,
    leftPage: PageMesh,
    rightPage: PageMesh,
    totalPages: number,
    config: Partial<InteractionConfig> = {}
  ) {
    this.container = container;
    this.leftPage = leftPage;
    this.rightPage = rightPage;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.stateMachine = new FlipbookStateMachine(totalPages);
    this.physics = new PagePhysics();

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
    // Mouse events
    this.container.addEventListener("mousedown", this.handlePointerDown);
    this.container.addEventListener("mousemove", this.handlePointerMove);
    this.container.addEventListener("mouseup", this.handlePointerUp);
    this.container.addEventListener("mouseleave", this.handlePointerUp);

    // Touch events
    this.container.addEventListener("touchstart", this.handleTouchStart, { passive: false });
    this.container.addEventListener("touchmove", this.handleTouchMove, { passive: false });
    this.container.addEventListener("touchend", this.handleTouchEnd);
    this.container.addEventListener("touchcancel", this.handleTouchEnd);

    // Keyboard events
    window.addEventListener("keydown", this.handleKeyDown);
  }

  private setupStateListeners(): void {
    this.stateMachine.onStateChange((oldState, newState) => {
      // Handle state transitions
      if (
        newState === FlipbookState.DRAGGING_FORWARD ||
        newState === FlipbookState.DRAGGING_BACKWARD
      ) {
        this.turningPage = newState === FlipbookState.DRAGGING_FORWARD
          ? this.rightPage
          : this.leftPage;
        this.turningPage.beginAnimation();
      }

      if (
        newState === FlipbookState.ANIMATING_FORWARD ||
        newState === FlipbookState.ANIMATING_BACKWARD
      ) {
        this.startAnimationLoop();
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
      }
    });
  }

  private getPointerPosition(e: MouseEvent | Touch): { x: number; y: number } {
    const rect = this.container.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private detectCorner(x: number, y: number): "left" | "right" | null {
    const rect = this.container.getBoundingClientRect();
    const cornerSize = Math.min(rect.width, rect.height) * this.config.cornerHitAreaFraction;

    const isInRightCorner = x > rect.width - cornerSize;
    const isInLeftCorner = x < cornerSize;

    if (isInRightCorner) return "right";
    if (isInLeftCorner) return "left";
    return null;
  }

  private handlePointerDown = (e: MouseEvent): void => {
    const pos = this.getPointerPosition(e);
    const corner = this.detectCorner(pos.x, pos.y);

    if (corner) {
      this.isDragging = true;
      this.dragStartX = pos.x;
      this.dragStartY = pos.y;
      this.stateMachine.startDrag(pos.x, pos.y, corner);
      this.physics.setPosition(0);
      e.preventDefault();
    }
  };

  private handlePointerMove = (e: MouseEvent): void => {
    const pos = this.getPointerPosition(e);
    const state = this.stateMachine.getState();

    if (this.isDragging && (
      state === FlipbookState.DRAGGING_FORWARD ||
      state === FlipbookState.DRAGGING_BACKWARD
    )) {
      const direction = state === FlipbookState.DRAGGING_FORWARD ? "forward" : "backward";
      const progress = calculateDragProgress(
        this.dragStartX,
        pos.x,
        this.container.getBoundingClientRect().width * 0.5,
        direction
      );

      this.stateMachine.updateDrag(pos.x, pos.y, progress);
      this.physics.setPosition(progress);

      if (this.turningPage) {
        this.turningPage.setProgress(progress);
      }
    } else if (state === FlipbookState.IDLE) {
      // Check for hover
      const corner = this.detectCorner(pos.x, pos.y);
      if (corner) {
        this.stateMachine.hoverCorner(corner);
      } else {
        this.stateMachine.leaveCorner();
      }
    }
  };

  private handlePointerUp = (): void => {
    if (!this.isDragging) return;
    this.isDragging = false;

    const state = this.stateMachine.getState();
    if (
      state === FlipbookState.DRAGGING_FORWARD ||
      state === FlipbookState.DRAGGING_BACKWARD
    ) {
      const { shouldComplete, direction } = this.stateMachine.endDrag();
      const currentProgress = this.physics.getPosition();

      if (shouldComplete) {
        // Animate to completion (progress = 1)
        this.physics.release(1, 0);
      } else {
        // Snap back (progress = 0)
        this.physics.release(0, 0);
      }
    }
  };

  private handleTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const pos = this.getPointerPosition(touch);
      const corner = this.detectCorner(pos.x, pos.y);

      if (corner) {
        this.isDragging = true;
        this.dragStartX = pos.x;
        this.dragStartY = pos.y;
        this.stateMachine.startDrag(pos.x, pos.y, corner);
        this.physics.setPosition(0);
        e.preventDefault();
      }
    }
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (e.touches.length === 1 && this.isDragging) {
      const touch = e.touches[0];
      const pos = this.getPointerPosition(touch);
      const state = this.stateMachine.getState();

      if (
        state === FlipbookState.DRAGGING_FORWARD ||
        state === FlipbookState.DRAGGING_BACKWARD
      ) {
        const direction = state === FlipbookState.DRAGGING_FORWARD ? "forward" : "backward";
        const progress = calculateDragProgress(
          this.dragStartX,
          pos.x,
          this.container.getBoundingClientRect().width * 0.5,
          direction
        );

        this.stateMachine.updateDrag(pos.x, pos.y, progress);
        this.physics.setPosition(progress);

        if (this.turningPage) {
          this.turningPage.setProgress(progress);
        }
        e.preventDefault();
      }
    }
  };

  private handleTouchEnd = (): void => {
    this.handlePointerUp();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "ArrowRight" || e.key === " ") {
      this.turnPageForward();
    } else if (e.key === "ArrowLeft") {
      this.turnPageBackward();
    }
  };

  /**
   * Programmatically turn page forward
   */
  turnPageForward(): boolean {
    if (this.stateMachine.turnPage("forward")) {
      this.turningPage = this.rightPage;
      this.turningPage.beginAnimation();
      this.physics.setPosition(0);
      this.physics.release(1, 2); // Start with some velocity
      return true;
    }
    return false;
  }

  /**
   * Programmatically turn page backward
   */
  turnPageBackward(): boolean {
    if (this.stateMachine.turnPage("backward")) {
      this.turningPage = this.leftPage;
      this.turningPage.beginAnimation();
      this.physics.setPosition(0);
      this.physics.release(1, 2);
      return true;
    }
    return false;
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
      const direction = state === FlipbookState.ANIMATING_FORWARD ? "forward" : "backward";

      if (
        state === FlipbookState.ANIMATING_FORWARD ||
        state === FlipbookState.ANIMATING_BACKWARD
      ) {
        this.stateMachine.completeAnimation(direction);
        if (this.onPageChange) {
          this.onPageChange(this.stateMachine.getCurrentPage());
        }
      } else if (state === FlipbookState.SETTLING) {
        this.stateMachine.completeSettling();
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
    this.container.removeEventListener("mousedown", this.handlePointerDown);
    this.container.removeEventListener("mousemove", this.handlePointerMove);
    this.container.removeEventListener("mouseup", this.handlePointerUp);
    this.container.removeEventListener("mouseleave", this.handlePointerUp);
    this.container.removeEventListener("touchstart", this.handleTouchStart);
    this.container.removeEventListener("touchmove", this.handleTouchMove);
    this.container.removeEventListener("touchend", this.handleTouchEnd);
    this.container.removeEventListener("touchcancel", this.handleTouchEnd);
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}
