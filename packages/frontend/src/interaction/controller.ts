/**
 * Flipbook Interaction Controller
 * Handles book-style page turning around the spine
 */

import { FlipbookStateMachine, FlipbookState } from "./stateMachine";
import { PagePhysics } from "./physics";
import type { PageMesh } from "../renderer/createPageMesh";

export interface InteractionConfig {
  // Hit area on right side for forward turn (fraction of width)
  turnAreaFraction: number;
  // Minimum drag distance to start turn (pixels)
  dragThreshold: number;
}

const DEFAULT_CONFIG: InteractionConfig = {
  turnAreaFraction: 0.3,
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
  private turnDirection: "forward" | "backward" | null = null;

  private container: HTMLElement;
  private pageWidth: number = 1;
  private pageHeight: number = 1;

  private isDragging: boolean = false;
  private dragStartX: number = 0;

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
    const rect = this.container.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private detectTurnZone(x: number): "left" | "right" | null {
    const rect = this.container.getBoundingClientRect();
    const turnZoneWidth = rect.width * this.config.turnAreaFraction;

    // Right side - turn forward
    if (x > rect.width - turnZoneWidth) {
      return "right";
    }
    // Left side - turn backward
    if (x < turnZoneWidth) {
      return "left";
    }
    return null;
  }

  private handlePointerDown = (e: MouseEvent): void => {
    if (this.stateMachine.getState() !== FlipbookState.IDLE) return;

    const pos = this.getPointerPosition(e);
    const zone = this.detectTurnZone(pos.x);

    if (zone === "right" && this.stateMachine.canTurnForward()) {
      this.isDragging = true;
      this.dragStartX = pos.x;
      this.stateMachine.startDrag(pos.x, pos.y, "right");
      this.physics.setPosition(0);
      e.preventDefault();
    } else if (zone === "left" && this.stateMachine.canTurnBackward()) {
      this.isDragging = true;
      this.dragStartX = pos.x;
      this.stateMachine.startDrag(pos.x, pos.y, "left");
      this.physics.setPosition(0);
      e.preventDefault();
    }
  };

  private handlePointerMove = (e: MouseEvent): void => {
    const pos = this.getPointerPosition(e);
    const state = this.stateMachine.getState();

    if (!this.isDragging) return;

    if (state === FlipbookState.DRAGGING_FORWARD) {
      // Drag left to turn forward - progress increases as we drag left
      const dragDistance = this.dragStartX - pos.x;
      const maxDrag = this.container.getBoundingClientRect().width * 0.6;
      const progress = Math.max(0, Math.min(1, dragDistance / maxDrag));

      this.stateMachine.updateDrag(pos.x, pos.y, progress);
      this.physics.setPosition(progress);

      if (this.turningPage) {
        this.turningPage.setProgress(progress);
      }
    } else if (state === FlipbookState.DRAGGING_BACKWARD) {
      // Drag right to turn backward
      const dragDistance = pos.x - this.dragStartX;
      const maxDrag = this.container.getBoundingClientRect().width * 0.6;
      const progress = Math.max(0, Math.min(1, dragDistance / maxDrag));

      this.stateMachine.updateDrag(pos.x, pos.y, progress);
      this.physics.setPosition(progress);

      if (this.turningPage) {
        this.turningPage.setProgress(progress);
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

  private handleTouchStart = (e: TouchEvent): void => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const mouseEvent = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      preventDefault: () => e.preventDefault(),
    } as MouseEvent;
    this.handlePointerDown(mouseEvent);
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (e.touches.length !== 1 || !this.isDragging) return;
    const touch = e.touches[0];
    const mouseEvent = {
      clientX: touch.clientX,
      clientY: touch.clientY,
    } as MouseEvent;
    this.handlePointerMove(mouseEvent);
    e.preventDefault();
  };

  private handleTouchEnd = (): void => {
    this.handlePointerUp();
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
