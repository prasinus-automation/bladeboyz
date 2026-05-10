/**
 * MenuManager — single owner of modal-overlay lifecycle.
 *
 * Before #101 each overlay (just InventoryPanel today) attached its own
 * `keydown` listener for ESC and managed its own pointer-lock release / input
 * pause. As more menus arrive (main, pause, controls — issues #2/#3/#4) that
 * pattern would duplicate the same plumbing per-module and make ESC routing
 * conflict-prone. MenuManager centralizes all four of those concerns:
 *
 *   1. Tracks which modal is open (at most one at a time).
 *   2. Owns the `Escape` listener and routes it correctly.
 *   3. Releases pointer lock + sets `input.paused = true` on open, and
 *      reverses both on close.
 *   4. Owns the `_suppressClickToPlay` callback on InputManager so the
 *      click-to-play overlay stays hidden while a menu is up.
 *
 * Modals register a `close` (and optional `open`) handler so the manager can
 * dispatch ESC routing without each modal re-implementing it.
 *
 * **Important**: opening a menu does NOT pause the ECS world. Per #98 spec,
 * PvP simulation continues server-side while the local player has a menu
 * open — the local player can be killed during pause. Only `input.paused`
 * flips here. Nothing in the game loop should consult MenuManager state.
 */

import type { InputManager } from '../input/InputManager';
import { GameState, GameStateManager } from '../core/GameState';

/** All modal kinds the manager knows about. */
export type ModalKind = 'main' | 'pause' | 'controls' | 'inventory';

export interface ModalRegistration {
  /**
   * Hide the modal. Called by MenuManager when ESC routes to this modal, or
   * when another piece of code calls `menuManager.close(kind)`. Implementations
   * should hide their DOM and call `menuManager.notifyClose(kind)`.
   */
  close: () => void;
  /**
   * Show the modal. Optional — only required for modals that MenuManager needs
   * to open programmatically (e.g. ESC opening the pause menu, or restoring
   * a back-stack target after closing the controls overlay). Implementations
   * should show their DOM and call `menuManager.notifyOpen(kind)`.
   */
  open?: () => void;
}

export type MenuListener = (current: ModalKind | null) => void;

export class MenuManager {
  private _current: ModalKind | null = null;
  /**
   * One-deep back-stack used only when the controls overlay is opened on top
   * of another modal (e.g. pause → controls → ESC → back to pause). When
   * `notifyOpen('controls')` fires while another modal is current, this stores
   * the previous modal so `notifyClose('controls')` can re-open it without
   * un-pausing input.
   */
  private _prevModal: ModalKind | null = null;
  private modals = new Map<ModalKind, ModalRegistration>();
  private listeners = new Set<MenuListener>();
  private _disposed = false;

  constructor(
    private input: InputManager,
    private gameState: GameStateManager,
  ) {
    document.addEventListener('keydown', this._onKeyDown);
    // Take ownership of the click-to-play suppression. While any modal is open
    // we don't want the click-to-play prompt to flash in.
    input._suppressClickToPlay = () => this.isAnyOpen();
  }

  /** Register a modal so MenuManager can close (and optionally re-open) it. */
  register(kind: ModalKind, registration: ModalRegistration): void {
    this.modals.set(kind, registration);
  }

  unregister(kind: ModalKind): void {
    this.modals.delete(kind);
  }

  /** Whether a given modal is currently registered. Test convenience. */
  isRegistered(kind: ModalKind): boolean {
    return this.modals.has(kind);
  }

  /**
   * A modal calls this immediately after showing its DOM. MenuManager handles
   * the cross-cutting work (pointer lock, input pause, click-to-play, listener
   * dispatch).
   */
  notifyOpen(kind: ModalKind): void {
    if (this._disposed) return;
    if (this._current === kind) return;

    // Back-stack: opening the controls overlay over another menu records the
    // previous modal so we can restore it on close without un-pausing.
    if (kind === 'controls' && this._current !== null) {
      this._prevModal = this._current;
    }

    this._current = kind;

    // Release pointer lock — pointer lock can only be re-acquired from a user
    // gesture, so we deliberately do NOT re-acquire on close (the existing
    // canvas-click handler in main.ts handles re-acquisition).
    if (typeof document.exitPointerLock === 'function') {
      try {
        document.exitPointerLock();
      } catch {
        /* swallow — some browsers throw if no lock is held */
      }
    }
    this.input.paused = true;
    this._reEvaluateClickToPlay();
    this._notify();
  }

  /** A modal calls this immediately after hiding its DOM. */
  notifyClose(kind: ModalKind): void {
    if (this._disposed) return;
    if (this._current !== kind) return;

    // Back-stack pop: closing the controls overlay restores the previous menu
    // without un-pausing input.
    if (kind === 'controls' && this._prevModal !== null) {
      const prev = this._prevModal;
      this._prevModal = null;
      const reg = this.modals.get(prev);
      if (reg && reg.open) {
        // The registered open handler is expected to call notifyOpen(prev),
        // which sets _current = prev. Clear _current first so notifyOpen's
        // early-return doesn't bail.
        this._current = null;
        reg.open();
      } else {
        // No way to restore — fall through to normal close.
        this._current = null;
        this.input.paused = false;
      }
      this._reEvaluateClickToPlay();
      this._notify();
      return;
    }

    this._current = null;
    this._prevModal = null;
    this.input.paused = false;
    this._reEvaluateClickToPlay();
    this._notify();
  }

  /**
   * Programmatically open a registered modal. Returns true if the modal was
   * registered with an `open` handler and was invoked. Used by the ESC handler
   * to open the pause menu when nothing else is up.
   */
  open(kind: ModalKind): boolean {
    const reg = this.modals.get(kind);
    if (!reg || !reg.open) return false;
    reg.open();
    return true;
  }

  /**
   * Programmatically close a modal. If `kind` is omitted, closes whichever
   * modal is currently open. Calls the registered `close` handler — the modal
   * is expected to hide its DOM and call `notifyClose` itself.
   */
  close(kind?: ModalKind): void {
    const target = kind ?? this._current;
    if (!target) return;
    if (this._current !== target) return;
    const reg = this.modals.get(target);
    reg?.close();
  }

  /** Whether any modal is currently open. */
  isAnyOpen(): boolean {
    return this._current !== null;
  }

  /** Currently open modal, or null. */
  getCurrent(): ModalKind | null {
    return this._current;
  }

  /** Subscribe to modal-state changes. Returns unsubscribe. */
  subscribe(fn: MenuListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Number of subscribers (test convenience). */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Tear down the document keydown listener and clear state. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    document.removeEventListener('keydown', this._onKeyDown);
    this.listeners.clear();
    this.modals.clear();
    if (this.input._suppressClickToPlay) {
      // Only clear if we own it (best-effort — the field is public).
      this.input._suppressClickToPlay = null;
    }
  }

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (this._disposed) return;
    if (e.code !== 'Escape') return;

    if (this._current === 'controls') {
      // Closing controls pops the back-stack (handled by notifyClose).
      e.preventDefault();
      e.stopPropagation();
      this.close('controls');
      return;
    }

    if (this._current === 'pause') {
      e.preventDefault();
      e.stopPropagation();
      this.close('pause');
      return;
    }

    if (this._current === 'inventory') {
      e.preventDefault();
      e.stopPropagation();
      this.close('inventory');
      return;
    }

    if (this._current === 'main') {
      // ESC inside main menu is a no-op; #2 may add quit-confirm later.
      return;
    }

    // Nothing open. Open pause if we're playing AND pause modal is registered.
    if (this._current === null && this.gameState.state === GameState.PLAYING) {
      const reg = this.modals.get('pause');
      if (reg && reg.open) {
        e.preventDefault();
        e.stopPropagation();
        reg.open();
      }
    }
  };

  /**
   * Re-evaluate whether the `#click-to-play` overlay should be visible.
   * InputManager re-evaluates this on every `pointerlockchange`, but a modal
   * opening/closing doesn't change pointer-lock state, so we have to nudge it
   * manually here.
   */
  private _reEvaluateClickToPlay(): void {
    const overlay = document.getElementById('click-to-play');
    if (!overlay) return;
    const suppress = this.isAnyOpen();
    overlay.classList.toggle('hidden', this.input.isPointerLocked || suppress);
  }

  private _notify(): void {
    if (this.listeners.size === 0) return;
    const snapshot = Array.from(this.listeners);
    for (const fn of snapshot) {
      try {
        fn(this._current);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[MenuManager] listener threw', err);
      }
    }
  }
}
