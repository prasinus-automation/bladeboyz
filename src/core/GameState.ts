/**
 * GameState — high-level state machine for the running game.
 *
 * This is **independent** of the per-entity Combat FSM and the ECS world. It
 * tracks whether the player is in the main menu, actively playing, or paused.
 *
 * Critical contract (per issue #101 and #98 spec):
 *   ECS systems must keep running in PAUSED. PvP — the server keeps simulating
 *   while the local player has a menu open. Only `InputManager.paused` is gated
 *   on this state by the menu code; nothing in `fixedUpdate` should consult
 *   `GameStateManager.state`.
 *
 * Default state is `MAIN_MENU`. Today the game effectively starts in PLAYING;
 * issue #2 will flip `main.ts` to start in MAIN_MENU and require the player to
 * click "Play" before entering PLAYING.
 */

export const enum GameState {
  MAIN_MENU,
  PLAYING,
  PAUSED,
}

/** Human-readable name for a `GameState` value. Useful for debug logging. */
export const GAME_STATE_NAMES: Record<number, string> = {
  [GameState.MAIN_MENU]: 'MAIN_MENU',
  [GameState.PLAYING]: 'PLAYING',
  [GameState.PAUSED]: 'PAUSED',
};

export type GameStateListener = (state: GameState) => void;

/**
 * Tiny pub/sub state holder. Listeners fire on every change (not on equal
 * writes). Subscribe returns an unsubscribe function — the canonical pattern.
 */
export class GameStateManager {
  private _state: GameState = GameState.MAIN_MENU;
  private listeners = new Set<GameStateListener>();

  /** Current game state. */
  get state(): GameState {
    return this._state;
  }

  /** Setting to the current state is a no-op (no listeners fired). */
  set state(s: GameState) {
    if (s === this._state) return;
    this._state = s;
    // Snapshot to a temp array so a listener that unsubscribes during dispatch
    // doesn't perturb iteration.
    const snapshot = Array.from(this.listeners);
    for (const fn of snapshot) {
      try {
        fn(s);
      } catch (err) {
        // Listener errors should never break state propagation
        // eslint-disable-next-line no-console
        console.error('[GameStateManager] listener threw', err);
      }
    }
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(fn: GameStateListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Number of active listeners (test-only convenience). */
  get listenerCount(): number {
    return this.listeners.size;
  }
}
