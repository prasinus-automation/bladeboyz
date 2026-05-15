/**
 * MainMenu — the entry overlay shown when the page first loads.
 *
 * Issue #106 (part of #98 "HUD and menus pass"). Replaces the old
 * `#click-to-play` text-only overlay as the game's entry point. The page now
 * loads into `GameState.MAIN_MENU` (the GameStateManager default) and the
 * player must click **Play** to transition to `PLAYING`. The legacy
 * `#click-to-play` div is kept as the "lost pointer lock mid-game" hint —
 * see `InputManager._onPointerLockChange` for that flow.
 *
 * Visibility is driven by `GameStateManager`: shown in `MAIN_MENU`, hidden
 * otherwise. The menu also registers with `MenuManager` as `'main'` so the
 * click-to-play suppression composition (`menuManager.isAnyOpen()`) keeps the
 * old text overlay from flashing in behind us on initial load.
 *
 * **Pointer-lock policy** (browser-mandated):
 *   `input.requestPointerLock()` MUST run synchronously inside the Play
 *   button's `click` handler. Browsers reject lock requests whose call stack
 *   doesn't trace back to a user gesture. State changes must come AFTER the
 *   lock request, not before — see the click handler below.
 *
 * Layout uses `theme.ts` constants exclusively. Title is plain `monospace`
 * with letter-spacing — no web fonts, no external font files.
 */

import { GameState, GameStateManager } from '../core/GameState';
import { APP_VERSION } from '../core/version';
import { theme } from './theme';
import type { InputManager } from '../input/InputManager';
import type { MenuManager } from './MenuManager';

export class MainMenu {
  /** Full-screen flex-centered overlay. */
  private container: HTMLDivElement;
  private playButton: HTMLButtonElement;
  private _isVisible = false;
  private _unsubGameState: () => void;
  private _disposed = false;

  constructor(
    private input: InputManager,
    private gameState: GameStateManager,
    private menuManager: MenuManager,
  ) {
    // Root container — flex-centered fullscreen overlay.
    this.container = document.createElement('div');
    this.container.id = 'main-menu';
    this.container.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 32px;
      background: ${theme.bg.backdrop};
      color: ${theme.text.primary};
      font-family: ${theme.font};
      z-index: ${theme.z.menu};
      user-select: none;
    `;

    // ── Title ──
    // Plain monospace with wide letter-spacing — no web font dependency.
    const title = document.createElement('div');
    title.id = 'main-menu-title';
    title.textContent = 'BLADEBOYZ';
    title.style.cssText = `
      font-size: 64px;
      font-weight: bold;
      letter-spacing: 12px;
      color: ${theme.text.primary};
      padding-bottom: 8px;
      border-bottom: 2px solid ${theme.border.accent};
    `;
    this.container.appendChild(title);

    // ── Play button ──
    this.playButton = document.createElement('button');
    this.playButton.id = 'main-menu-play-button';
    this.playButton.type = 'button';
    this.playButton.textContent = 'PLAY';
    this.playButton.style.cssText = `
      font-family: ${theme.font};
      font-size: 24px;
      letter-spacing: 4px;
      padding: 16px 64px;
      background: ${theme.bg.subtle};
      color: ${theme.text.primary};
      border: 2px solid ${theme.border.default};
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    `;
    // Hover: accent border + text. Use programmatic listeners (rather than CSS
    // :hover) so the file stays self-contained and consistent with the rest
    // of the HUD's inline-style pattern.
    this.playButton.addEventListener('mouseenter', () => {
      this.playButton.style.borderColor = theme.border.accent;
      this.playButton.style.color = theme.text.accent;
    });
    this.playButton.addEventListener('mouseleave', () => {
      this.playButton.style.borderColor = theme.border.default;
      this.playButton.style.color = theme.text.primary;
    });
    // **Synchronous pointer-lock request inside the click handler.**
    // Browsers reject `requestPointerLock` outside a user-gesture stack
    // frame, so we MUST call it before any awaiting / state-change side
    // effects. The state flip then closes the menu (via our subscriber).
    this.playButton.addEventListener('click', () => {
      this.input.requestPointerLock();
      this.gameState.state = GameState.PLAYING;
    });
    this.container.appendChild(this.playButton);

    // ── Controls hint ──
    // 2-3 lines of muted text. Sourced manually (not from the full
    // `keybinds.ts` table) so we don't render the entire 17-row list — that's
    // the Controls overlay's job in #3. These are the six most important
    // actions a new player needs to start moving and fighting.
    const controlsHint = document.createElement('div');
    controlsHint.id = 'main-menu-controls';
    controlsHint.style.cssText = `
      font-size: 14px;
      color: ${theme.text.muted};
      text-align: center;
      line-height: 1.6;
      letter-spacing: 1px;
    `;
    // Two lines, six bindings. Bullet-separated for compactness.
    controlsHint.innerHTML = [
      'WASD move &bull; Mouse look &bull; LMB attack',
      'RMB block &bull; E interact &bull; I inventory &bull; ESC pause',
    ].join('<br>');
    this.container.appendChild(controlsHint);

    // ── Version label ──
    // Bottom-right corner, absolutely positioned inside the flex container
    // so it doesn't push the centered group around.
    const versionLabel = document.createElement('div');
    versionLabel.id = 'main-menu-version';
    versionLabel.textContent = `v${APP_VERSION}`;
    versionLabel.style.cssText = `
      position: absolute;
      bottom: 16px;
      right: 24px;
      font-size: 12px;
      color: ${theme.text.muted};
      letter-spacing: 1px;
    `;
    this.container.appendChild(versionLabel);

    document.body.appendChild(this.container);

    // Register with MenuManager. The `close` handler is the canonical entry
    // point: when the state transitions away from MAIN_MENU we hide the DOM
    // and tell MenuManager. The `open` handler is provided for symmetry but
    // is not currently used by MenuManager (ESC in `'main'` is a deliberate
    // no-op per #101 spec) — kept so a future quit-confirm flow can call it.
    this.menuManager.register('main', {
      close: () => this.close(),
      open: () => this.show(),
    });

    // Subscribe to GameStateManager so we react to programmatic state changes
    // (e.g. someone calls `gameStateManager.state = MAIN_MENU` from elsewhere).
    this._unsubGameState = this.gameState.subscribe((state) => {
      if (state === GameState.MAIN_MENU) {
        this.show();
      } else {
        this.close();
      }
    });

    // Initial sync — show on construction iff state is already MAIN_MENU
    // (the GameStateManager default). If the caller has already flipped to
    // PLAYING before constructing us, stay hidden.
    if (this.gameState.state === GameState.MAIN_MENU) {
      this.show();
    }
  }

  /** Whether the menu overlay is currently visible. */
  get isVisible(): boolean {
    return this._isVisible;
  }

  /**
   * Show the menu and notify MenuManager. Idempotent.
   */
  show(): void {
    if (this._isVisible || this._disposed) return;
    this._isVisible = true;
    this.container.style.display = 'flex';
    this.menuManager.notifyOpen('main');
  }

  /**
   * Hide the menu and notify MenuManager. Idempotent. Called by:
   *   - the Play-button click path (via the GameState subscriber, after the
   *     state flips PLAYING),
   *   - the GameState subscriber on any non-MAIN_MENU transition,
   *   - `MenuManager.close('main')` if anything ever wires that up.
   */
  close(): void {
    if (!this._isVisible || this._disposed) return;
    this._isVisible = false;
    this.container.style.display = 'none';
    this.menuManager.notifyClose('main');
  }

  /** Tear down DOM + subscriptions. Matches the dispose pattern in other HUD modules. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._unsubGameState();
    this.menuManager.unregister('main');
    this.container.remove();
  }
}
