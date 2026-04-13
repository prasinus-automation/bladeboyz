import { AttackDirection } from '../combat/directions';

/**
 * Raw input capture for keyboard and mouse.
 * Manages pointer lock, mouse deltas, and key states.
 *
 * No abstraction layers — direct browser events per AGENTS.md spec.
 */
export class InputManager {
  /** Keys currently held down */
  private keysDown = new Set<string>();
  /** Keys pressed this frame (cleared each tick) */
  private keysPressed = new Set<string>();
  /** Keys released this frame (cleared each tick) */
  private keysReleased = new Set<string>();

  /** Mouse buttons currently held */
  private mouseDown = new Set<number>();
  /** Mouse buttons pressed this frame */
  private mousePressed = new Set<number>();
  /** Mouse buttons released this frame */
  private mouseReleased = new Set<number>();

  /** Accumulated mouse delta since last read */
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;

  /** Whether pointer is locked */
  private _pointerLocked = false;

  /** Target element for pointer lock */
  private target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;

    // Keyboard events
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);

    // Mouse events
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('mousemove', this.onMouseMove);

    // Pointer lock change
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    // Request pointer lock on click (required by API — must be user gesture)
    target.addEventListener('click', this.requestPointerLock);
  }

  // ── Public API ──────────────────────────────────────────

  /** Whether the attack button (LMB) was pressed this frame */
  get attackPressed(): boolean {
    return this.mousePressed.has(0);
  }

  /** Whether the block button (RMB) is held */
  get blockHeld(): boolean {
    return this.mouseDown.has(2);
  }

  /** Whether the block button (RMB) was just pressed this frame */
  get blockPressed(): boolean {
    return this.mousePressed.has(2);
  }

  /** Whether the block button (RMB) was released this frame */
  get blockReleased(): boolean {
    return this.mouseReleased.has(2);
  }

  /** Whether pointer is currently locked */
  get pointerLocked(): boolean {
    return this._pointerLocked;
  }

  /**
   * Determine attack direction from mouse movement delta.
   * Horizontal movement → Left/Right swing
   * Vertical movement → Overhead (up) / Stab (down)
   */
  getAttackDirection(): AttackDirection {
    const dx = this.mouseDeltaX;
    const dy = this.mouseDeltaY;

    // Reset delta after reading so direction is based on recent movement, not cumulative
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    // Minimum delta threshold to determine direction
    const threshold = 2;

    if (absX < threshold && absY < threshold) {
      // Default to overhead if no clear mouse movement
      return AttackDirection.Overhead;
    }

    if (absX > absY) {
      return dx > 0 ? AttackDirection.Right : AttackDirection.Left;
    } else {
      return dy > 0 ? AttackDirection.Stab : AttackDirection.Overhead;
    }
  }

  /** Read and reset accumulated mouse delta */
  consumeMouseDelta(): { x: number; y: number } {
    const delta = { x: this.mouseDeltaX, y: this.mouseDeltaY };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return delta;
  }

  /** Whether a specific key was pressed this frame */
  wasKeyPressed(key: string): boolean {
    return this.keysPressed.has(key);
  }

  /** Whether a specific key is held */
  isKeyDown(key: string): boolean {
    return this.keysDown.has(key);
  }

  /** Call at end of each tick to clear per-frame inputs */
  endFrame(): void {
    this.keysPressed.clear();
    this.keysReleased.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
  }

  /** Clean up all event listeners */
  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.target.removeEventListener('click', this.requestPointerLock);
  }

  // ── Event handlers ──────────────────────────────────────

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.keysDown.has(e.code)) {
      this.keysPressed.add(e.code);
    }
    this.keysDown.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
    this.keysReleased.add(e.code);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.mouseDown.has(e.button)) {
      this.mousePressed.add(e.button);
    }
    this.mouseDown.add(e.button);
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.mouseDown.delete(e.button);
    this.mouseReleased.add(e.button);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this._pointerLocked) {
      this.mouseDeltaX += e.movementX;
      this.mouseDeltaY += e.movementY;
    }
  };

  private onPointerLockChange = (): void => {
    this._pointerLocked = document.pointerLockElement === this.target;
  };

  private requestPointerLock = (): void => {
    if (!this._pointerLocked) {
      this.target.requestPointerLock();
    }
  };
}
