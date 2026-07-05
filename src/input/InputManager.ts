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

/**
 * One bound event-listener registration. Tracked at attach time so
 * `dispose()` can reverse every listener — required for HMR teardown
 * and isolation in tests.
 */
type ListenerTuple = {
  target: EventTarget;
  type: string;
  fn: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
};

export class InputManager {
  // Keyboard state
  private keysDown: Set<string> = new Set();

  // Mouse button state (button index -> pressed)
  private mouseButtons: Set<number> = new Set();

  // ── Latched edges (consume-on-read) ──────────────────────
  //
  // State polling (`isKeyDown`/`isMouseButtonDown`) drops any press+release
  // that both happen inside one 16.7ms fixed tick — the browser delivers
  // both events between ticks and the poll never sees the button down
  // (the "sub-tick click" gotcha, docs/AGENTS-DEBT.md). These sets latch
  // every rising/falling edge as it arrives; a consumer drains its edge
  // with `consumeKeyPress`/`consumeMousePress`/`consumeMouseRelease`, so a
  // press fires exactly once no matter how it straddles tick boundaries.
  //
  // Consume-on-read means each edge has ONE owner per tick — today that's
  // InputSystem (Space) and CombatSystem (mouse 0/2), which are disjoint.
  // A second consumer of the same key would race the first; give new
  // consumers their own key, don't share.
  private pressedKeys: Set<string> = new Set();
  private pressedMouseButtons: Set<number> = new Set();
  private releasedMouseButtons: Set<number> = new Set();

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

  /** True after `dispose()` has been called. Listener bodies short-circuit. */
  private _disposed = false;

  /**
   * Every (target, type, fn) tuple this instance attached. Used by
   * `dispose()` to reverse every binding so HMR / tests don't accumulate
   * stale listeners. See issue #172.
   */
  private _listeners: ListenerTuple[] = [];

  /**
   * When true, input capture is paused (e.g. inventory overlay is open).
   * Mouse move, keyboard, and mouse button events are ignored for reads.
   * Key-up and mouse-up events are still processed to prevent stuck keys.
   */
  private _paused = false;

  get paused(): boolean {
    return this._paused;
  }

  set paused(value: boolean) {
    this._paused = value;
    if (value) {
      // Latch a release edge for every button still held, BEFORE clearing.
      // A consumer watching for release (e.g. CombatSystem ending a block
      // on RMB-up) must still see the falling edge when pausing swallows
      // the real mouseup — otherwise the FSM sticks in Blocking.
      for (const button of this.mouseButtons) {
        this.releasedMouseButtons.add(button);
      }
      // Safety net: clear accumulated state so nothing stays "stuck"
      this.keysDown.clear();
      this.mouseButtons.clear();
      this.pressedKeys.clear();
      this.pressedMouseButtons.clear();
    }
  }

  /**
   * Optional callback to suppress the #click-to-play overlay.
   * When this returns true, the overlay stays hidden even without pointer lock.
   * Used by InventoryPanel to prevent overlay stacking.
   */
  _suppressClickToPlay: (() => boolean) | null = null;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    // Make the canvas focusable so it can receive keyboard events when
    // pointer-locked. Without tabindex, some browsers route keyboard events
    // to the locked canvas instead of bubbling them up to document.
    if (this.canvas instanceof HTMLElement && !this.canvas.hasAttribute('tabindex')) {
      this.canvas.setAttribute('tabindex', '0');
      // Hide the focus outline since the canvas is the entire game viewport
      (this.canvas as HTMLElement).style.outline = 'none';
    }
    this.bindEvents();
  }

  /**
   * Wrap addEventListener so every binding is tracked for dispose().
   * The listener body is short-circuited if `_disposed` is true so that
   * any browser-queued events post-dispose are no-ops.
   */
  private _track<E extends Event>(
    target: EventTarget,
    type: string,
    fn: (e: E) => void,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const wrapped = ((e: E) => {
      if (this._disposed) return;
      fn(e);
    }) as EventListener;
    target.addEventListener(type, wrapped, options);
    this._listeners.push({ target, type, fn: wrapped, options });
  }

  /**
   * Add a key event to the keysDown set. Centralized so we can hook in
   * runtime debug logging via `window.__debugInput = true`.
   */
  private _onKeyDown = (e: KeyboardEvent): void => {
    if ((globalThis as any).__debugInput) {
      // eslint-disable-next-line no-console
      console.log('[InputManager] keydown', e.code, 'paused?', this._paused);
    }
    if (this._paused) return;
    this.keysDown.add(e.code);
    // Latch the rising edge. `repeat` filters OS key auto-repeat — a held
    // key must not re-fire its edge every repeat interval.
    if (!e.repeat) {
      this.pressedKeys.add(e.code);
    }
  };

  private _onKeyUp = (e: KeyboardEvent): void => {
    if ((globalThis as any).__debugInput) {
      // eslint-disable-next-line no-console
      console.log('[InputManager] keyup', e.code);
    }
    // Always remove — paused only gates reads, not writes
    this.keysDown.delete(e.code);
  };

  private _onMouseMove = (e: MouseEvent): void => {
    if (this.paused || !this._isPointerLocked) return;
    this.frameDeltaX += e.movementX;
    this.frameDeltaY += e.movementY;

    this.deltaBuffer.push({
      dx: e.movementX,
      dy: e.movementY,
      timestamp: performance.now(),
    });
  };

  private _onMouseDown = (e: MouseEvent): void => {
    if (this.paused) return;
    this.mouseButtons.add(e.button);
    this.pressedMouseButtons.add(e.button);
  };

  private _onMouseUp = (e: MouseEvent): void => {
    // Always remove — paused only gates reads, not writes
    this.mouseButtons.delete(e.button);
    this.releasedMouseButtons.add(e.button);
  };

  private _onWheel = (e: WheelEvent): void => {
    this.frameScrollDelta += e.deltaY;
  };

  /**
   * Pointer-lock state has changed. Per the InputManager type contract
   * (`InputManager.types.ts:106-109`) and issue #172:
   *  - on lock acquired: ensure paused = false; auto-focus the canvas so
   *    keyboard events route through it reliably under lock.
   *  - on lock LOST: clear keysDown + mouseButtons + set paused = true.
   *    Browsers stop delivering keyup events to the (now-unlocked) canvas
   *    on some platforms — the user-facing symptom was a permanently-stuck
   *    "W" causing the player to walk forward involuntarily on re-lock.
   *    Setting paused = true also ensures debug-key handlers gated on
   *    `!input.paused` (see main.ts T/Y/J/K) stay quiet until the canvas
   *    is re-acquired via a real user gesture.
   */
  private _onPointerLockChange = (): void => {
    const wasLocked = this._isPointerLocked;
    this._isPointerLocked = document.pointerLockElement === this.canvas;

    if (this._isPointerLocked) {
      // Acquired pointer lock — re-enable input. Note: keysDown /
      // mouseButtons are already empty (we cleared them on the prior
      // unlock or never set them at all), so we just flip the flag.
      this._paused = false;
      // Auto-focus the canvas so keydown events route through it reliably.
      // Without this, some browsers can leave focus on a non-canvas element
      // (e.g. the click-to-play overlay or a button), which can suppress
      // key events in the canvas's bubble path.
      if (typeof (this.canvas as HTMLElement).focus === 'function') {
        (this.canvas as HTMLElement).focus();
      }
    } else if (wasLocked) {
      // Just lost pointer lock (transitioned locked → unlocked). Clear all
      // accumulated input state so a key the browser stopped sending keyup
      // for doesn't stay stuck. Use the paused setter so the clear-on-pause
      // side-effect runs in one place.
      this.paused = true;
    }
    // No-op when wasLocked === false && _isPointerLocked === false — that's
    // not a transition, just a spurious event, and we shouldn't surprise
    // consumers by flipping paused.

    const overlay = document.getElementById('click-to-play');
    if (overlay) {
      // Suppress click-to-play when an overlay (e.g. inventory) handles its own flow
      const suppress = this._suppressClickToPlay ? this._suppressClickToPlay() : false;
      overlay.classList.toggle('hidden', this._isPointerLocked || suppress);
    }
  };

  private _onPointerLockError = (): void => {
    console.warn('Pointer lock error');
    this._isPointerLocked = false;
    // Same cleanup as the unlock branch — a failed lock request leaves the
    // user in an unlocked state with potentially-stale held keys (e.g.
    // their mouse-click also fired a keydown that the document caught).
    this.paused = true;
  };

  /**
   * Window-blur fires when the user alt-tabs, switches virtual desktops,
   * or otherwise drops focus from the page. Browsers vary on whether
   * blur precedes pointerlockchange — covering blur catches the edge
   * cases pointerlockchange might miss. See issue #172.
   */
  private _onWindowBlur = (): void => {
    // Set paused so debug-key handlers stay quiet until re-focus, AND so
    // the existing paused-setter clears keysDown / mouseButtons in one
    // place. We don't flip _isPointerLocked here — pointerlockchange owns
    // that flag.
    this.paused = true;
  };

  private bindEvents(): void {
    // Keyboard — listen on BOTH document and the canvas itself.
    //
    // History: PR f41e987 switched from `window` → `document` because some
    // browsers stopped delivering keydown events to window listeners while
    // pointer lock was active on the canvas. We've since seen reports that
    // even document listeners can miss events under pointer lock in some
    // browser/OS combinations (issue #82). The locked canvas itself always
    // receives keyboard events when it has tabindex, so we defensively
    // listen there too. `Set.add` / `Set.delete` are idempotent, so
    // receiving the same event on multiple targets is safe.
    this._track<KeyboardEvent>(document, 'keydown', this._onKeyDown);
    this._track<KeyboardEvent>(document, 'keyup', this._onKeyUp);
    if (this.canvas) {
      this._track<KeyboardEvent>(this.canvas, 'keydown', this._onKeyDown);
      this._track<KeyboardEvent>(this.canvas, 'keyup', this._onKeyUp);
    }

    // Mouse move (only useful when pointer-locked)
    this._track<MouseEvent>(document, 'mousemove', this._onMouseMove);

    // Mouse buttons — use document for pointer lock compatibility
    this._track<MouseEvent>(document, 'mousedown', this._onMouseDown);
    this._track<MouseEvent>(document, 'mouseup', this._onMouseUp);

    // Scroll wheel
    this._track<WheelEvent>(window, 'wheel', this._onWheel, { passive: true });

    // Pointer lock change / error
    this._track<Event>(document, 'pointerlockchange', this._onPointerLockChange);
    this._track<Event>(document, 'pointerlockerror', this._onPointerLockError);

    // Window blur — defense-in-depth against browsers that don't fire
    // pointerlockchange on alt-tab. Issue #172.
    this._track<Event>(window, 'blur', this._onWindowBlur);
  }

  /** Request pointer lock (must be called from a user gesture) */
  requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  /** Check if a key is currently held (returns false when paused) */
  isKeyDown(code: string): boolean {
    return !this.paused && this.keysDown.has(code);
  }

  /** Check if a mouse button is currently held (returns false when paused; 0=left, 1=middle, 2=right) */
  isMouseButtonDown(button: number): boolean {
    return !this.paused && this.mouseButtons.has(button);
  }

  /**
   * Consume a latched key press edge. Returns true exactly once per
   * physical press, even when the press+release both happened inside a
   * single fixed tick (state polling would drop that press entirely).
   * Returns false while paused. One consumer per key — see the latched-edge
   * comment on the fields.
   */
  consumeKeyPress(code: string): boolean {
    if (this.paused) return false;
    return this.pressedKeys.delete(code);
  }

  /** Consume a latched mouse press edge (0=left, 2=right). See consumeKeyPress. */
  consumeMousePress(button: number): boolean {
    if (this.paused) return false;
    return this.pressedMouseButtons.delete(button);
  }

  /**
   * Consume a latched mouse release edge. NOT gated on paused: releases are
   * always processed (same philosophy as keyup/mouseup handlers) so a block
   * ended by pausing still delivers its falling edge to the combat FSM.
   */
  consumeMouseRelease(button: number): boolean {
    return this.releasedMouseButtons.delete(button);
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
   * Get TOTAL accumulated mouse delta over the last N milliseconds.
   * Used for combat directional attack detection.
   *
   * Total (not mean-per-event) is deliberate: mousemove event frequency
   * varies wildly across hardware/browsers (60–1000 Hz), so a per-event
   * mean makes direction detection depend on the pointing device — a
   * deliberate 150 px flick could average under the stab threshold on a
   * high-report-rate mouse. The physical quantity that encodes intent is
   * how far the mouse moved over the window, which is the sum.
   */
  getAccumulatedDelta(windowMs: number = DELTA_BUFFER_WINDOW_MS): { dx: number; dy: number } {
    const now = performance.now();
    const cutoff = now - windowMs;

    let totalDx = 0;
    let totalDy = 0;

    for (let i = this.deltaBuffer.length - 1; i >= 0; i--) {
      const entry = this.deltaBuffer[i];
      if (entry.timestamp < cutoff) break;
      totalDx += entry.dx;
      totalDy += entry.dy;
    }

    return { dx: totalDx, dy: totalDy };
  }

  /**
   * Get average mouse delta over the last N milliseconds.
   * @deprecated Direction detection moved to `getAccumulatedDelta` — the
   * per-event mean depends on the device's report rate. Kept for any
   * remaining callers; remove once nothing imports it.
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

  /**
   * Release pointer lock and remove every event listener that was attached.
   * After `dispose()`, the manager is unusable — listener bodies short-
   * circuit on `_disposed`. Required for Vite HMR teardown and test
   * isolation. Safe to call multiple times.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }

    // Reverse every (target, type, fn) tuple this instance attached.
    for (const { target, type, fn, options } of this._listeners) {
      target.removeEventListener(type, fn, options);
    }
    this._listeners.length = 0;

    // Drop accumulated state so a stray reference doesn't keep memory alive.
    this.keysDown.clear();
    this.mouseButtons.clear();
    this.pressedKeys.clear();
    this.pressedMouseButtons.clear();
    this.releasedMouseButtons.clear();
    this.deltaBuffer.length = 0;
  }
}
