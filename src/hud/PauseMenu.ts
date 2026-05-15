/**
 * PauseMenu — modal overlay shown when the player presses ESC during PLAYING.
 *
 * Part of issue #111 (foundation #101 / PR #145 already landed). Three buttons:
 *
 *   - **Resume**: closes the menu; pointer-lock re-acquires on the next canvas
 *     click via the existing main.ts handler.
 *   - **Controls**: opens the `ControlsOverlay`. MenuManager's one-deep
 *     back-stack records `'pause'` so closing controls restores us via the
 *     registered `open` handler — no explicit caller-tracking needed.
 *   - **Quit**: closes the menu and transitions GameState to MAIN_MENU.
 *
 * **PvP simulation continues** while paused — the world keeps running
 * server-side, the player can be killed during the pause. The warning text
 * below the panel documents this in-UI. ECS systems must NOT consult
 * GameStateManager.state — pause does NOT pause `fixedUpdate`.
 *
 * Lifecycle / DOM ownership matches `InventoryPanel` and `MainMenu`:
 *   - The panel registers `{close: () => this.hide(), open: () => this.show()}`
 *     with MenuManager in the constructor.
 *   - `show()` builds DOM (display:flex) + calls `menuManager.notifyOpen('pause')`.
 *   - `hide()` clears DOM (display:none) + calls `menuManager.notifyClose('pause')`.
 *   - MenuManager's ESC handler can both open us (when nothing else is up + state
 *     is PLAYING) and close us (when we're current).
 *
 * **Note on opening Controls**: clicking "Controls" calls
 * `controlsOverlay.show()` directly. That fires `menuManager.notifyOpen('controls')`,
 * which records `'pause'` as `_prevModal`. We hide the pause DOM beforehand
 * but deliberately do NOT call `notifyClose('pause')` — that would clear the
 * back-stack target. Internally we still flip `_isVisible = false` so that the
 * back-stack-restored `show()` call doesn't no-op out.
 */

import { GameState, GameStateManager } from '../core/GameState';
import { theme } from './theme';
import type { MenuManager } from './MenuManager';
import type { ControlsOverlay } from './ControlsOverlay';

export class PauseMenu {
  /** Full-screen dim overlay container — flex-centered. */
  private container: HTMLDivElement;
  private resumeButton: HTMLButtonElement;
  private controlsButton: HTMLButtonElement;
  private quitButton: HTMLButtonElement;
  private _isVisible = false;
  private _disposed = false;
  /**
   * Late-bound link to the ControlsOverlay — set via `setControlsOverlay`
   * after construction so the two panels can be created in either order.
   */
  private controlsOverlay: ControlsOverlay | null = null;

  constructor(
    private gameState: GameStateManager,
    private menuManager: MenuManager,
  ) {
    // ── Root container — full-screen dim backdrop, flex-centered ──
    this.container = document.createElement('div');
    this.container.id = 'pause-menu';
    this.container.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      background: ${theme.bg.dim};
      color: ${theme.text.primary};
      font-family: ${theme.font};
      z-index: ${theme.z.menu};
      user-select: none;
    `;

    // ── Panel ──
    const panel = document.createElement('div');
    panel.id = 'pause-menu-panel';
    panel.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
      min-width: 240px;
      padding: 24px 32px;
      background: ${theme.bg.panel};
      border: 2px solid ${theme.border.default};
      z-index: ${theme.z.overlay};
    `;

    // Title
    const title = document.createElement('div');
    title.id = 'pause-menu-title';
    title.textContent = 'PAUSED';
    title.style.cssText = `
      font-size: 24px;
      font-weight: bold;
      letter-spacing: 6px;
      text-align: center;
      color: ${theme.text.primary};
      padding-bottom: 8px;
      margin-bottom: 4px;
      border-bottom: 1px solid ${theme.border.default};
    `;
    panel.appendChild(title);

    // Buttons
    this.resumeButton = this._makeButton('pause-menu-resume', 'Resume');
    this.controlsButton = this._makeButton('pause-menu-controls', 'Controls');
    this.quitButton = this._makeButton('pause-menu-quit', 'Quit');

    this.resumeButton.addEventListener('click', () => this._onResume());
    this.controlsButton.addEventListener('click', () => this._onControls());
    this.quitButton.addEventListener('click', () => this._onQuit());

    panel.appendChild(this.resumeButton);
    panel.appendChild(this.controlsButton);
    panel.appendChild(this.quitButton);

    this.container.appendChild(panel);

    // ── PvP warning text (below panel) ──
    const warning = document.createElement('div');
    warning.id = 'pause-menu-pvp-warning';
    warning.style.cssText = `
      max-width: 360px;
      margin-top: 4px;
      padding: 8px 12px;
      text-align: center;
      font-size: 13px;
      line-height: 1.5;
      color: ${theme.status.warn};
      letter-spacing: 0.5px;
    `;
    // Plain text content — no HTML injection risk and easier to assert in tests.
    warning.textContent =
      '⚠ World still simulates — you can be killed while paused.';
    this.container.appendChild(warning);

    document.body.appendChild(this.container);

    // Register with MenuManager. Both handlers are required:
    //   - `open` so ESC routing (MenuManager._onKeyDown cell "nothing open +
    //     PLAYING") can open the pause menu, and so the controls→pause
    //     back-stack restoration can re-open us after Back.
    //   - `close` so MenuManager's ESC + programmatic close can route here.
    this.menuManager.register('pause', {
      close: () => this.hide(),
      open: () => this.show(),
    });
  }

  /**
   * Link the ControlsOverlay so the Controls button can call `show()` on it.
   * Late-bound because the two panels are constructed in main.ts and either
   * order is valid; the wiring code calls this once both exist.
   */
  setControlsOverlay(overlay: ControlsOverlay): void {
    this.controlsOverlay = overlay;
  }

  /** Whether the pause overlay is currently visible. */
  get isVisible(): boolean {
    return this._isVisible;
  }

  /**
   * Show the pause menu and notify MenuManager. Idempotent.
   * Called by the ESC handler (via MenuManager) and by the controls→pause
   * back-stack restoration (via MenuManager.notifyClose's restore path).
   */
  show(): void {
    this._setVisible(true, /* notify */ true);
  }

  /**
   * Hide the pause menu and notify MenuManager. Idempotent.
   * Called by Resume / Quit / ESC routing.
   */
  hide(): void {
    this._setVisible(false, /* notify */ true);
  }

  /** Resume: just close. Pointer lock re-acquires on next canvas click. */
  private _onResume(): void {
    this.hide();
  }

  /**
   * Controls: open the controls overlay on top of us. MenuManager records us
   * as the previous modal and will restore us when controls closes.
   *
   * We hide the pause DOM (so the controls panel reads cleanly above) but do
   * NOT call `notifyClose` — the back-stack depends on `'pause'` still being
   * the current modal at the moment `notifyOpen('controls')` runs inside
   * `controlsOverlay.show()`. We DO flip `_isVisible = false` so the eventual
   * back-stack-restored `show()` call doesn't no-op out.
   */
  private _onControls(): void {
    if (!this.controlsOverlay) {
      // Defensive: if no overlay is wired up, do nothing rather than crash.
      // This path should never run in production — main.ts wires both up.
      return;
    }
    this._setVisible(false, /* notify */ false);
    this.controlsOverlay.show();
  }

  /**
   * Quit: close pause, set state back to MAIN_MENU. No MainMenu screen is
   * required for this PR — the GameState transition is the contract.
   */
  private _onQuit(): void {
    this.hide();
    this.gameState.state = GameState.MAIN_MENU;
  }

  /**
   * Single source of truth for the visibility flip. `notify=false` is the
   * "hide DOM without telling MenuManager" path used when opening the
   * controls overlay — we want MenuManager's `_current` to stay `'pause'`
   * so the back-stack records us correctly.
   */
  private _setVisible(visible: boolean, notify: boolean): void {
    if (this._disposed) return;
    if (this._isVisible === visible) return;
    this._isVisible = visible;
    this.container.style.display = visible ? 'flex' : 'none';
    if (notify) {
      if (visible) this.menuManager.notifyOpen('pause');
      else this.menuManager.notifyClose('pause');
    }
  }

  private _makeButton(id: string, label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = `
      font-family: ${theme.font};
      font-size: 16px;
      letter-spacing: 2px;
      padding: 10px 24px;
      background: ${theme.bg.subtle};
      color: ${theme.text.primary};
      border: 1px solid ${theme.border.default};
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = theme.border.accent;
      btn.style.color = theme.text.accent;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = theme.border.default;
      btn.style.color = theme.text.primary;
    });
    return btn;
  }

  /** Tear down DOM + unregister from MenuManager. Idempotent. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.menuManager.unregister('pause');
    this.container.remove();
  }
}
