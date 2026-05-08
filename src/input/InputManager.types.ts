/**
 * InputManager type contract — interface signatures only.
 *
 * Source of truth for the input-pipeline rebuild tracked in issue #102. The
 * concrete implementation in `src/input/InputManager.ts` does NOT yet
 * conform to this interface — see `docs/input-pipeline.md` for the
 * architecture spec and the migration plan that will land downstream.
 *
 * Nothing in this file emits runtime code that affects existing consumers:
 * - `enum InputMode` — runtime numeric enum (zero-cost when treeshaken).
 * - `enum InputAction` — runtime numeric enum.
 * - `MouseDelta` / `IInputManager` — pure type declarations.
 *
 * Adding the file does not change any current behavior; it exists so that
 * downstream PRs can implement against a fixed contract.
 */

// ─── Input mode FSM ─────────────────────────────────────────────────────────

/**
 * Top-level input mode. Mutually exclusive and exhaustive.
 *
 * - `Menu`        — game loaded but not active; `#click-to-play` visible;
 *                   pointer lock released; gameplay polling reads return false.
 * - `Playing`     — pointer is locked, gameplay running; mouse/keys drive
 *                   the player.
 * - `OverlayOpen` — an HTML overlay (inventory, future shop, settings) is
 *                   in front; pointer lock released on purpose; gameplay
 *                   polling reads return false.
 *
 * See `docs/input-pipeline.md` §2 for transitions and triggers.
 */
export enum InputMode {
  Menu = 0,
  Playing = 1,
  OverlayOpen = 2,
}

// ─── Action enum ────────────────────────────────────────────────────────────

/**
 * Logical input actions.
 *
 * Every binding currently in code (see `docs/input-pipeline.md` §7) maps to
 * exactly one of these. The numeric values are stable for use as array
 * indices but are not part of the public contract — consumers should always
 * reference actions by name.
 */
export enum InputAction {
  // Movement (polled — held continuously)
  MoveForward,
  MoveBackward,
  StrafeLeft,
  StrafeRight,
  Sprint,
  Crouch,
  Jump,

  // Combat (mix of polled + edge-detected; see docs §6)
  AttackPrimary, // edge: JustPressed on Mouse0
  BlockOrFeint,  // polled (held = blocking) + edges (press/release)

  // UI
  OpenInventory, // edge: JustPressed on KeyI (toggle)
  CloseOverlay,  // edge: JustPressed on Escape (only meaningful in OverlayOpen)

  // Camera (debug)
  ToggleCameraMode, // edge: JustPressed on F5

  // Debug (training dummy controls)
  DebugSpawnDummy,        // edge: JustPressed on KeyJ
  DebugResetDummies,      // edge: JustPressed on KeyK
  DebugToggleDummyBlock,  // edge: JustPressed on KeyT
  DebugCycleBlockDir,     // edge: JustPressed on KeyY

  // Debug (renderers)
  DebugToggleWireframe,   // edge: JustPressed on F1
  DebugTogglePhysics,     // edge: JustPressed on F2
  DebugToggleHitboxes,    // edge: JustPressed on F3
  DebugToggleFsmOverlay,  // edge: JustPressed on F4
  DebugToggleTracers,     // edge: JustPressed on F6
}

// ─── Value types ────────────────────────────────────────────────────────────

/** Mouse-motion delta (or scroll vector). Pixels for x/y, browser-defined
 *  units for scroll (positive y = wheel down by default). */
export interface MouseDelta {
  x: number;
  y: number;
}

// ─── InputManager contract ──────────────────────────────────────────────────

/**
 * The contract every InputManager implementation must satisfy.
 *
 * Behavioral invariants (see `docs/input-pipeline.md` for the full spec):
 *
 * - When `mode !== InputMode.Playing`, **all** polling and edge-detected reads
 *   return `false` / `0` / a zero `MouseDelta`. The one exception is the
 *   `CloseOverlay` action, which is meaningful in `OverlayOpen`.
 * - `setMode(OverlayOpen)` releases pointer lock as a side effect. Consumers
 *   (e.g. `InventoryPanel`) MUST go through `setMode`; they MUST NOT call
 *   `document.exitPointerLock()` directly.
 * - When pointer lock is lost (browser-initiated or user-initiated via ESC),
 *   the manager demotes mode to `Menu` and clears all accumulated key/mouse
 *   button state.
 * - `dispose()` MUST remove every listener that was attached; the current
 *   implementation does not do this and the rewrite ticket fixes it.
 */
export interface IInputManager {
  // ─── Mode management ──────────────────────────────────────────────────────

  /** Current input mode. */
  readonly mode: InputMode;

  /**
   * Transition to a new mode. Emits `onModeChange`.
   *
   * Side effects:
   * - `Menu → Playing`: requests pointer lock (must be called from a
   *   user-gesture handler — browser requirement).
   * - `Playing → OverlayOpen`: calls `document.exitPointerLock()` and
   *   clears accumulated key/mouse-button state.
   * - `OverlayOpen → Menu` or `Playing → Menu`: clears accumulated state.
   */
  setMode(mode: InputMode): void;

  /**
   * Subscribe to mode-change events. Fires after the transition has been
   * applied. Returns an unsubscribe function.
   */
  onModeChange(cb: (mode: InputMode) => void): () => void;

  // ─── Pointer lock ─────────────────────────────────────────────────────────

  /**
   * Whether the canvas currently holds pointer lock.
   *
   * Tracks `document.pointerLockElement === canvas`. May briefly diverge
   * from `mode === Playing` during a transition; in steady state the two
   * are equivalent.
   */
  readonly isPointerLocked: boolean;

  /**
   * Request pointer lock on the canvas. Must be called from inside a user
   * gesture handler (browser requirement). On success, `pointerlockchange`
   * fires and mode transitions to `Playing` (if it wasn't already).
   *
   * No-op if already pointer-locked.
   */
  requestPointerLock(): void;

  /**
   * Release pointer lock. Equivalent to `document.exitPointerLock()` but
   * routed through the manager so the FSM stays consistent.
   *
   * Prefer `setMode(OverlayOpen)` when releasing because an overlay is
   * opening — it does the right thing automatically.
   */
  releasePointerLock(): void;

  /**
   * Subscribe to pointer-lock-state changes. Fires whenever
   * `pointerlockchange` is observed. Returns an unsubscribe function.
   */
  onPointerLockChange(cb: (locked: boolean) => void): () => void;

  // ─── Polled (continuous) reads ────────────────────────────────────────────

  /**
   * Returns true while the action is held. Returns false whenever
   * `mode !== InputMode.Playing` (gameplay actions are pause-gated).
   *
   * Use for movement and held-block. Call once per fixed tick from the
   * relevant gameplay system.
   */
  isActionDown(action: InputAction): boolean;

  // ─── Edge-detected reads ──────────────────────────────────────────────────

  /**
   * Returns true on the tick where the action transitioned from up → down.
   * Valid for the current fixed tick only. Returns false for the tick
   * after, even if the key is still held.
   *
   * Implementation detail: the manager commits the "previous pressed-set"
   * snapshot at a defined point in the tick (typically end of fixed
   * update); see `docs/input-pipeline.md` §5.3.
   */
  isActionJustPressed(action: InputAction): boolean;

  /**
   * Returns true on the tick where the action transitioned from down → up.
   * Valid for the current fixed tick only.
   */
  isActionJustReleased(action: InputAction): boolean;

  // ─── Mouse motion ─────────────────────────────────────────────────────────

  /**
   * Accumulated mouse delta since the last `resetFrameDeltas()`.
   *
   * Per-frame (NOT per-tick). Called once per render frame from
   * `CameraController.processInput()` at frame start, before any fixed
   * updates run. Returns `{x:0, y:0}` whenever `mode !== Playing`.
   */
  getMouseDelta(): MouseDelta;

  /**
   * Average mouse delta over the last `windowMs` milliseconds, computed
   * from the rolling buffer. Used by combat-direction detection where
   * stable directional intent matters more than instantaneous motion.
   *
   * Time-windowed and independent of `getMouseDelta()` — does not consume
   * or reset any state.
   */
  getAverageDelta(windowMs: number): MouseDelta;

  /**
   * Accumulated scroll-wheel delta since the last `resetFrameDeltas()`.
   * Positive = scroll down (matches `WheelEvent.deltaY`). Used by
   * `CameraController` for third-person zoom.
   */
  getScrollDelta(): number;

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Reset per-frame deltas (mouse and scroll). Call at end of each render
   * frame (`GameLoop.onFrameEnd`). Also prunes stale entries from the
   * rolling delta buffer.
   *
   * NOT a per-tick reset — see `docs/input-pipeline.md` §5.
   */
  resetFrameDeltas(): void;

  /**
   * Release pointer lock and remove every event listener that was
   * attached. After `dispose()`, the manager is unusable. Required for
   * Vite HMR teardown.
   */
  dispose(): void;
}
