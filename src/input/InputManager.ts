/**
 * InputManager — raw input capture with pointer lock, keyboard, and mouse tracking.
 *
 * Captures raw KeyboardEvent / MouseEvent / PointerLockAPI.
 * Provides per-frame delta queries and a rolling mouse delta buffer for combat.
 */

export interface MouseDeltaEntry {
  dx: number;
  dy: number;
  timestamp: number;
}

const DELTA_BUFFER_WINDOW_MS = 100;

export class InputManager {
  // Keyboard state
  private keysDown: Set<string> = new Set();

  // Mouse button state (button index -> pressed)
  private mouseButtons: Set<number> = new Set();

  // Per-frame mouse delta (accumulated between resets)
  private frameDeltaX = 0;
  private frameDeltaY = 0;

  // Rolling mouse delta buffer for combat directional detection
  private deltaBuffer: MouseDeltaEntry[] = [];

  // Pointer lock state
  private _isPointerLocked = false;
  private readonly canvas: HTMLElement;

  // Scroll wheel delta (for third-person zoom)
  private frameScrollDelta = 0;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    this.bindEvents();
  }

  private bindEvents(): void {
    // Keyboard
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      this.keysDown.add(e.code);
    });
    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.keysDown.delete(e.code);
    });

    // Mouse move (only useful when pointer-locked)
    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this._isPointerLocked) return;
      this.frameDeltaX += e.movementX;
      this.frameDeltaY += e.movementY;

      this.deltaBuffer.push({
        dx: e.movementX,
        dy: e.movementY,
        timestamp: performance.now(),
      });
    });

    // Mouse buttons
    window.addEventListener('mousedown', (e: MouseEvent) => {
      this.mouseButtons.add(e.button);
    });
    window.addEventListener('mouseup', (e: MouseEvent) => {
      this.mouseButtons.delete(e.button);
    });

    // Scroll wheel
    window.addEventListener('wheel', (e: WheelEvent) => {
      this.frameScrollDelta += e.deltaY;
    }, { passive: true });

    // Pointer lock change
    document.addEventListener('pointerlockchange', () => {
      this._isPointerLocked = document.pointerLockElement === this.canvas;

      const overlay = document.getElementById('click-to-play');
      if (overlay) {
        overlay.classList.toggle('hidden', this._isPointerLocked);
      }
    });

    document.addEventListener('pointerlockerror', () => {
      console.warn('Pointer lock error');
      this._isPointerLocked = false;
    });
  }

  /** Request pointer lock (must be called from a user gesture) */
  requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  /** Check if a key is currently held */
  isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  /** Check if a mouse button is currently held (0=left, 1=middle, 2=right) */
  isMouseButtonDown(button: number): boolean {
    return this.mouseButtons.has(button);
  }

  /** Get accumulated mouse delta since last reset */
  getMouseDelta(): { x: number; y: number } {
    return { x: this.frameDeltaX, y: this.frameDeltaY };
  }

  /** Get accumulated scroll delta since last reset */
  getScrollDelta(): number {
    return this.frameScrollDelta;
  }

  /** Is pointer currently locked? */
  get isPointerLocked(): boolean {
    return this._isPointerLocked;
  }

  /**
   * Get average mouse delta over the last N milliseconds.
   * Used for combat directional attack detection.
   */
  getAverageDelta(windowMs: number = DELTA_BUFFER_WINDOW_MS): { dx: number; dy: number } {
    const now = performance.now();
    const cutoff = now - windowMs;

    let totalDx = 0;
    let totalDy = 0;
    let count = 0;

    for (let i = this.deltaBuffer.length - 1; i >= 0; i--) {
      const entry = this.deltaBuffer[i];
      if (entry.timestamp < cutoff) break;
      totalDx += entry.dx;
      totalDy += entry.dy;
      count++;
    }

    if (count === 0) return { dx: 0, dy: 0 };
    return { dx: totalDx / count, dy: totalDy / count };
  }

  /** Reset per-frame deltas. Call at end of each frame. */
  resetFrameDeltas(): void {
    this.frameDeltaX = 0;
    this.frameDeltaY = 0;
    this.frameScrollDelta = 0;

    // Prune old entries from rolling buffer
    const cutoff = performance.now() - DELTA_BUFFER_WINDOW_MS * 2;
    let pruneIndex = 0;
    while (pruneIndex < this.deltaBuffer.length && this.deltaBuffer[pruneIndex].timestamp < cutoff) {
      pruneIndex++;
    }
    if (pruneIndex > 0) {
      this.deltaBuffer.splice(0, pruneIndex);
    }
  }

  /** Dispose event listeners */
  dispose(): void {
    // In a real app we'd remove listeners; for scaffolding this is fine
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }
}
