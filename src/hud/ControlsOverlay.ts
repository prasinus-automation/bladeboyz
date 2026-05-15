/**
 * ControlsOverlay — read-only modal listing every keybind.
 *
 * Part of issue #111. Reachable from the pause menu (`Controls` button). Once
 * a main-menu screen lands (#106 is already in), this will also be reachable
 * from there — no additional code needed because MenuManager's one-deep
 * back-stack handles "return to whoever opened controls" automatically.
 *
 * Renders one row per `keybind` in `src/input/keybinds.ts`, grouped by section
 * (Movement / Combat / Interface). Single **Back** button at the bottom calls
 * `hide()`, which routes through `menuManager.notifyClose('controls')`. The
 * manager's back-stack pop restores the previous modal automatically.
 *
 * Rebinding is out of scope (covered by #87) — this overlay is read-only.
 */

import { theme } from './theme';
import {
  keybinds,
  keybindsByGroup,
  formatKeyCode,
  type KeybindGroup,
} from '../input/keybinds';
import type { MenuManager } from './MenuManager';

const GROUP_ORDER: KeybindGroup[] = ['Movement', 'Combat', 'Interface'];

export class ControlsOverlay {
  private container: HTMLDivElement;
  private backButton: HTMLButtonElement;
  private _isVisible = false;
  private _disposed = false;

  constructor(private menuManager: MenuManager) {
    // ── Root container — full-screen dim overlay ──
    this.container = document.createElement('div');
    this.container.id = 'controls-overlay';
    this.container.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: ${theme.bg.backdrop};
      color: ${theme.text.primary};
      font-family: ${theme.font};
      z-index: ${theme.z.menu};
      user-select: none;
    `;

    // ── Panel ──
    const panel = document.createElement('div');
    panel.id = 'controls-overlay-panel';
    panel.style.cssText = `
      display: flex;
      flex-direction: column;
      min-width: 360px;
      max-width: 480px;
      max-height: 80vh;
      padding: 24px 32px;
      background: ${theme.bg.panel};
      border: 2px solid ${theme.border.default};
      z-index: ${theme.z.overlay};
      overflow-y: auto;
    `;

    // Title
    const title = document.createElement('div');
    title.id = 'controls-overlay-title';
    title.textContent = 'CONTROLS';
    title.style.cssText = `
      font-size: 20px;
      font-weight: bold;
      letter-spacing: 6px;
      text-align: center;
      color: ${theme.text.primary};
      padding-bottom: 12px;
      margin-bottom: 16px;
      border-bottom: 1px solid ${theme.border.default};
    `;
    panel.appendChild(title);

    // Body — iterate keybindsByGroup() and render section-by-section.
    const body = document.createElement('div');
    body.id = 'controls-overlay-body';
    body.style.cssText = `display: flex; flex-direction: column; gap: 14px;`;

    const grouped = keybindsByGroup();
    for (const group of GROUP_ORDER) {
      const groupBindings = grouped[group];
      if (!groupBindings || groupBindings.length === 0) continue;

      // Group header
      const header = document.createElement('div');
      header.className = 'controls-group-header';
      header.dataset.group = group;
      header.textContent = group;
      header.style.cssText = `
        font-size: 13px;
        font-weight: bold;
        letter-spacing: 2px;
        color: ${theme.text.accent};
        text-transform: uppercase;
        margin-bottom: 4px;
      `;
      body.appendChild(header);

      // Rows
      for (const kb of groupBindings) {
        const row = document.createElement('div');
        row.className = 'controls-row';
        row.dataset.action = kb.action;
        row.style.cssText = `
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 0;
          font-size: 13px;
        `;

        const keyEl = document.createElement('span');
        keyEl.className = 'controls-row-key';
        keyEl.textContent = formatKeyCode(kb.key);
        keyEl.style.cssText = `
          min-width: 80px;
          padding: 2px 8px;
          background: ${theme.bg.subtle};
          border: 1px solid ${theme.border.default};
          color: ${theme.text.accent};
          font-family: ${theme.font};
          text-align: center;
        `;

        const labelEl = document.createElement('span');
        labelEl.className = 'controls-row-label';
        labelEl.textContent = kb.label;
        labelEl.style.cssText = `
          flex: 1;
          margin-left: 16px;
          color: ${theme.text.primary};
        `;

        row.appendChild(keyEl);
        row.appendChild(labelEl);
        body.appendChild(row);
      }
    }
    panel.appendChild(body);

    // ── Back button ──
    this.backButton = document.createElement('button');
    this.backButton.id = 'controls-overlay-back';
    this.backButton.type = 'button';
    this.backButton.textContent = 'Back';
    this.backButton.style.cssText = `
      align-self: center;
      margin-top: 20px;
      font-family: ${theme.font};
      font-size: 14px;
      letter-spacing: 2px;
      padding: 8px 24px;
      background: ${theme.bg.subtle};
      color: ${theme.text.primary};
      border: 1px solid ${theme.border.default};
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    `;
    this.backButton.addEventListener('mouseenter', () => {
      this.backButton.style.borderColor = theme.border.accent;
      this.backButton.style.color = theme.text.accent;
    });
    this.backButton.addEventListener('mouseleave', () => {
      this.backButton.style.borderColor = theme.border.default;
      this.backButton.style.color = theme.text.primary;
    });
    this.backButton.addEventListener('click', () => this.hide());
    panel.appendChild(this.backButton);

    this.container.appendChild(panel);
    document.body.appendChild(this.container);

    // Register so ESC routing + back-stack restoration can drive us.
    this.menuManager.register('controls', {
      close: () => this.hide(),
      open: () => this.show(),
    });
  }

  /** Whether the overlay is currently visible. */
  get isVisible(): boolean {
    return this._isVisible;
  }

  /**
   * Show the overlay and tell MenuManager. If we're being opened on top of
   * an existing modal (pause, main), MenuManager records that modal in its
   * back-stack so Back/ESC restores it automatically.
   */
  show(): void {
    if (this._isVisible || this._disposed) return;
    this._isVisible = true;
    this.container.style.display = 'flex';
    this.menuManager.notifyOpen('controls');
  }

  /**
   * Hide the overlay and tell MenuManager. MenuManager.notifyClose pops the
   * back-stack — if pause was the opener, it re-opens automatically.
   */
  hide(): void {
    if (!this._isVisible || this._disposed) return;
    this._isVisible = false;
    this.container.style.display = 'none';
    this.menuManager.notifyClose('controls');
  }

  /** Tear down DOM + unregister. Idempotent. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.menuManager.unregister('controls');
    this.container.remove();
  }
}
