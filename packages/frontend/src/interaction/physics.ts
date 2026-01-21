/**
 * Spring-Damper Physics for Page Motion
 * Per Production Technical Specification Section 4.3
 */

export interface PhysicsConfig {
  // Spring constant - higher = snappier response
  springK: number;
  // Damping coefficient - higher = less oscillation
  damping: number;
  // Mass affects inertia
  mass: number;
  // Velocity threshold for considering "at rest"
  restThreshold: number;
}

// Default config calibrated for realistic paper behavior
const DEFAULT_CONFIG: PhysicsConfig = {
  springK: 120,
  damping: 14,
  mass: 1,
  restThreshold: 0.001,
};

export interface PhysicsState {
  position: number; // Current curl progress (0 = flat right, 1 = flat left)
  velocity: number;
  target: number; // Target position (0 or 1)
}

export class PagePhysics {
  private config: PhysicsConfig;
  private state: PhysicsState;

  constructor(config: Partial<PhysicsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      position: 0,
      velocity: 0,
      target: 0,
    };
  }

  /**
   * Set position directly (during drag)
   */
  setPosition(position: number): void {
    this.state.position = Math.max(0, Math.min(1, position));
    this.state.velocity = 0;
  }

  /**
   * Set target and let physics take over
   */
  setTarget(target: number): void {
    this.state.target = target;
  }

  /**
   * Release with initial velocity
   */
  release(target: number, initialVelocity: number = 0): void {
    this.state.target = target;
    this.state.velocity = initialVelocity;
  }

  /**
   * Get current position
   */
  getPosition(): number {
    return this.state.position;
  }

  /**
   * Get current velocity
   */
  getVelocity(): number {
    return this.state.velocity;
  }

  /**
   * Check if page has settled (at rest near target)
   */
  isAtRest(): boolean {
    const nearTarget =
      Math.abs(this.state.position - this.state.target) < this.config.restThreshold;
    const lowVelocity = Math.abs(this.state.velocity) < this.config.restThreshold;
    return nearTarget && lowVelocity;
  }

  /**
   * Step the physics simulation
   * Uses semi-implicit Euler integration
   */
  step(deltaTime: number): number {
    // Clamp delta to prevent instability
    const dt = Math.min(deltaTime, 0.033); // Max ~30fps step

    // Spring force: F = -k * (position - target)
    const displacement = this.state.position - this.state.target;
    const springForce = -this.config.springK * displacement;

    // Damping force: F = -c * velocity
    const dampingForce = -this.config.damping * this.state.velocity;

    // Total acceleration: a = F / m
    const acceleration = (springForce + dampingForce) / this.config.mass;

    // Semi-implicit Euler: update velocity first, then position
    this.state.velocity += acceleration * dt;
    this.state.position += this.state.velocity * dt;

    // Clamp to valid range and stop at boundaries
    if (this.state.position <= 0 && this.state.velocity < 0) {
      this.state.position = 0;
      this.state.velocity = 0;
    } else if (this.state.position >= 1 && this.state.velocity > 0) {
      this.state.position = 1;
      this.state.velocity = 0;
    }

    this.state.position = Math.max(0, Math.min(1, this.state.position));

    return this.state.position;
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.state = {
      position: 0,
      velocity: 0,
      target: 0,
    };
  }
}

/**
 * Calculate drag progress from screen coordinates
 */
export function calculateDragProgress(
  startX: number,
  currentX: number,
  pageWidth: number,
  direction: "forward" | "backward"
): number {
  const dragDistance = startX - currentX;
  const maxDrag = pageWidth;

  if (direction === "forward") {
    // Dragging left (negative X) increases progress
    return Math.max(0, Math.min(1, dragDistance / maxDrag));
  } else {
    // Dragging right (positive X) increases progress
    return Math.max(0, Math.min(1, -dragDistance / maxDrag));
  }
}
