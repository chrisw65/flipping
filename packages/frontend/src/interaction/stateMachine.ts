/**
 * Flipbook Interaction State Machine
 * Per Production Technical Specification Section 9.1
 */

export enum FlipbookState {
  IDLE = "IDLE",
  HOVER_CORNER_RIGHT = "HOVER_CORNER_RIGHT",
  HOVER_CORNER_LEFT = "HOVER_CORNER_LEFT",
  DRAGGING_FORWARD = "DRAGGING_FORWARD",
  DRAGGING_BACKWARD = "DRAGGING_BACKWARD",
  ANIMATING_FORWARD = "ANIMATING_FORWARD",
  ANIMATING_BACKWARD = "ANIMATING_BACKWARD",
  SETTLING = "SETTLING",
}

export type StateChangeCallback = (
  oldState: FlipbookState,
  newState: FlipbookState
) => void;

export interface DragData {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  progress: number; // 0 to 1, how far the page has turned
}

export class FlipbookStateMachine {
  private state: FlipbookState = FlipbookState.IDLE;
  private listeners: StateChangeCallback[] = [];
  private dragData: DragData | null = null;
  private currentPage: number = 0;
  private totalPages: number = 1;
  private pageStep: number = 1;

  constructor(totalPages: number = 1) {
    this.totalPages = totalPages;
  }

  getState(): FlipbookState {
    return this.state;
  }

  getDragData(): DragData | null {
    return this.dragData;
  }

  getCurrentPage(): number {
    return this.currentPage;
  }

  setCurrentPage(page: number): void {
    this.currentPage = Math.max(0, Math.min(page, this.totalPages - 1));
  }

  setTotalPages(total: number): void {
    this.totalPages = total;
  }

  setPageStep(step: number): void {
    this.pageStep = Math.max(1, Math.floor(step));
  }

  canTurnForward(): boolean {
    return this.currentPage + this.pageStep < this.totalPages;
  }

  canTurnBackward(): boolean {
    return this.currentPage - this.pageStep >= 0;
  }

  onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  private setState(newState: FlipbookState): void {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.listeners.forEach((cb) => cb(oldState, newState));
  }

  // Called when pointer enters corner region
  hoverCorner(side: "left" | "right"): void {
    if (this.state !== FlipbookState.IDLE) return;

    if (side === "right" && this.canTurnForward()) {
      this.setState(FlipbookState.HOVER_CORNER_RIGHT);
    } else if (side === "left" && this.canTurnBackward()) {
      this.setState(FlipbookState.HOVER_CORNER_LEFT);
    }
  }

  // Called when pointer leaves corner region
  leaveCorner(): void {
    if (
      this.state === FlipbookState.HOVER_CORNER_RIGHT ||
      this.state === FlipbookState.HOVER_CORNER_LEFT
    ) {
      this.setState(FlipbookState.IDLE);
    }
  }

  // Called when drag starts from corner
  startDrag(x: number, y: number, side: "left" | "right"): boolean {
    if (side === "right" && !this.canTurnForward()) return false;
    if (side === "left" && !this.canTurnBackward()) return false;

    this.dragData = {
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      progress: 0,
    };

    if (side === "right") {
      this.setState(FlipbookState.DRAGGING_FORWARD);
    } else {
      this.setState(FlipbookState.DRAGGING_BACKWARD);
    }

    return true;
  }

  // Called during drag
  updateDrag(x: number, y: number, progress: number): void {
    if (
      this.state !== FlipbookState.DRAGGING_FORWARD &&
      this.state !== FlipbookState.DRAGGING_BACKWARD
    ) {
      return;
    }

    if (this.dragData) {
      this.dragData.currentX = x;
      this.dragData.currentY = y;
      this.dragData.progress = Math.max(0, Math.min(1, progress));
    }
  }

  // Called when drag ends
  endDrag(): { shouldComplete: boolean; direction: "forward" | "backward" } {
    const direction =
      this.state === FlipbookState.DRAGGING_FORWARD ? "forward" : "backward";
    const progress = this.dragData?.progress ?? 0;

    // If dragged past 50%, complete the turn; otherwise, snap back
    const shouldComplete = progress > 0.5;

    if (shouldComplete) {
      this.setState(
        direction === "forward"
          ? FlipbookState.ANIMATING_FORWARD
          : FlipbookState.ANIMATING_BACKWARD
      );
    } else {
      this.setState(FlipbookState.SETTLING);
    }

    return { shouldComplete, direction };
  }

  // Called when animation completes
  completeAnimation(direction: "forward" | "backward"): void {
    if (direction === "forward") {
      this.currentPage = Math.min(
        this.currentPage + this.pageStep,
        this.totalPages - 1
      );
    } else {
      this.currentPage = Math.max(this.currentPage - this.pageStep, 0);
    }

    this.dragData = null;
    this.setState(FlipbookState.IDLE);
  }

  // Called when settling animation completes (snap back)
  completeSettling(): void {
    this.dragData = null;
    this.setState(FlipbookState.IDLE);
  }

  // Quick page turn without drag
  turnPage(direction: "forward" | "backward"): boolean {
    if (this.state !== FlipbookState.IDLE) return false;

    if (direction === "forward" && !this.canTurnForward()) return false;
    if (direction === "backward" && !this.canTurnBackward()) return false;

    this.dragData = {
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      progress: 0,
    };

    this.setState(
      direction === "forward"
        ? FlipbookState.ANIMATING_FORWARD
        : FlipbookState.ANIMATING_BACKWARD
    );

    return true;
  }
}
