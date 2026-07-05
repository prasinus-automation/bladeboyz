/**
 * MainMenu — the landing overlay (#106 foundation, multiplayer-era layout).
 *
 * Landing view: BLADEBOYZ title + four actions —
 *   MULTIPLAYER   → in-overlay submenu (Quick Play FFA … more modes later)
 *   PRACTICE BOTS → single-player arena (dummies, shopkeep, B-key bot)
 *   SHOP          → info panel (in-game weapon shop + upcoming skins)
 *   BUY CREDITS   → credits panel (balance from the Supabase profile; real
 *                   purchases arrive with the Stripe webhook — see
 *                   docs/supabase-setup.md §5)
 * plus an auth widget (sign in / create account / signed-in status) backed
 * by `src/auth/session.ts`, which no-ops into guest mode when Supabase env
 * isn't configured.
 *
 * Lifecycle contract is unchanged from #106: registers as ModalKind 'main'
 * with MenuManager, subscribes to GameStateManager (MAIN_MENU ⇄ visible),
 * and every game-entering click calls `input.requestPointerLock()`
 * SYNCHRONOUSLY before flipping state (browser user-gesture requirement).
 */

import { GameState, GameStateManager } from '../core/GameState';
import { APP_VERSION } from '../core/version';
import { theme } from './theme';
import type { InputManager } from '../input/InputManager';
import type { MenuManager } from './MenuManager';
import {
  getAuthState,
  onAuthChange,
  signIn,
  signUp,
  signOut,
  type AuthState,
} from '../auth/session';

type SubPanel = 'none' | 'multiplayer' | 'shop' | 'credits' | 'auth';

export class MainMenu {
  private container: HTMLDivElement;
  private buttonColumn: HTMLDivElement;
  private subPanel: HTMLDivElement;
  private authBar: HTMLDivElement;
  private _isVisible = false;
  private _unsubGameState: () => void;
  private _unsubAuth: () => void;
  private _disposed = false;
  private activePanel: SubPanel = 'none';

  /** Set by main.ts — invoked from inside the user-gesture click handlers. */
  onPractice: (() => void) | null = null;
  onMultiplayerFFA: (() => void) | null = null;

  constructor(
    private input: InputManager,
    private gameState: GameStateManager,
    private menuManager: MenuManager,
  ) {
    this.container = document.createElement('div');
    this.container.id = 'main-menu';
    this.container.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 24px;
      background: ${theme.bg.backdrop};
      color: ${theme.text.primary};
      font-family: ${theme.font};
      z-index: ${theme.z.menu};
      user-select: none;
    `;

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

    // ── Landing buttons ──
    this.buttonColumn = document.createElement('div');
    this.buttonColumn.id = 'main-menu-buttons';
    this.buttonColumn.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: stretch;
      min-width: 340px;
    `;
    this.container.appendChild(this.buttonColumn);

    this.addButton('menu-btn-multiplayer', 'MULTIPLAYER', () => {
      this.showPanel('multiplayer');
    });
    this.addButton('menu-btn-practice', 'PRACTICE BOTS', () => {
      // Synchronous pointer-lock inside the gesture, then mode + state.
      this.input.requestPointerLock();
      this.onPractice?.();
      this.gameState.state = GameState.PLAYING;
    });
    this.addButton('menu-btn-shop', 'SHOP', () => this.showPanel('shop'));
    this.addButton('menu-btn-credits', 'BUY CREDITS', () =>
      this.showPanel('credits'),
    );

    // ── Sub panel (swapped content under the buttons) ──
    this.subPanel = document.createElement('div');
    this.subPanel.id = 'menu-sub';
    this.subPanel.style.cssText = `
      display: none;
      flex-direction: column;
      gap: 12px;
      align-items: stretch;
      min-width: 340px;
      max-width: 460px;
      padding: 16px;
      border: 1px solid ${theme.border.default};
      background: ${theme.bg.panel};
    `;
    this.container.appendChild(this.subPanel);

    // ── Auth bar ──
    this.authBar = document.createElement('div');
    this.authBar.id = 'menu-auth';
    this.authBar.style.cssText = `
      font-size: 13px;
      color: ${theme.text.secondary};
      letter-spacing: 1px;
      display: flex;
      gap: 12px;
      align-items: center;
    `;
    this.container.appendChild(this.authBar);

    const controlsHint = document.createElement('div');
    controlsHint.id = 'main-menu-controls';
    controlsHint.style.cssText = `
      font-size: 13px;
      color: ${theme.text.muted};
      text-align: center;
      line-height: 1.6;
      letter-spacing: 1px;
    `;
    controlsHint.innerHTML = [
      'WASD move &bull; Mouse look &bull; LMB attack &bull; RMB block',
      'E interact &bull; I inventory &bull; TAB scoreboard &bull; ESC pause',
    ].join('<br>');
    this.container.appendChild(controlsHint);

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

    this.menuManager.register('main', {
      close: () => this.close(),
      open: () => this.show(),
    });

    this._unsubGameState = this.gameState.subscribe((state) => {
      if (state === GameState.MAIN_MENU) {
        this.show();
      } else {
        this.close();
      }
    });

    this._unsubAuth = onAuthChange(() => this.renderAuthBar());
    this.renderAuthBar();

    if (this.gameState.state === GameState.MAIN_MENU) {
      this.show();
    }
  }

  // ── Widgets ────────────────────────────────────────────

  private addButton(
    id: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = this.makeButton(id, label, onClick);
    this.buttonColumn.appendChild(btn);
    return btn;
  }

  private makeButton(
    id: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = `
      font-family: ${theme.font};
      font-size: 18px;
      letter-spacing: 3px;
      padding: 12px 32px;
      background: ${theme.bg.subtle};
      color: ${theme.text.primary};
      border: 2px solid ${theme.border.default};
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
    btn.addEventListener('click', onClick);
    return btn;
  }

  private label(text: string, muted = false): HTMLDivElement {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
      font-size: 13px;
      line-height: 1.5;
      letter-spacing: 1px;
      color: ${muted ? theme.text.muted : theme.text.secondary};
    `;
    return el;
  }

  private inputField(id: string, placeholder: string, type = 'text'): HTMLInputElement {
    const el = document.createElement('input');
    el.id = id;
    el.type = type;
    el.placeholder = placeholder;
    el.style.cssText = `
      font-family: ${theme.font};
      font-size: 14px;
      padding: 10px 12px;
      background: ${theme.bg.subtle};
      color: ${theme.text.primary};
      border: 1px solid ${theme.border.default};
      outline: none;
    `;
    return el;
  }

  // ── Sub panels ─────────────────────────────────────────

  private showPanel(panel: SubPanel): void {
    this.activePanel = this.activePanel === panel ? 'none' : panel;
    this.subPanel.innerHTML = '';
    if (this.activePanel === 'none') {
      this.subPanel.style.display = 'none';
      return;
    }
    this.subPanel.style.display = 'flex';
    switch (this.activePanel) {
      case 'multiplayer':
        this.renderMultiplayerPanel();
        break;
      case 'shop':
        this.renderShopPanel();
        break;
      case 'credits':
        this.renderCreditsPanel();
        break;
      case 'auth':
        this.renderAuthPanel();
        break;
      default:
        break;
    }
  }

  private renderMultiplayerPanel(): void {
    const auth = getAuthState();
    const who = auth.profile
      ? `Playing as ${auth.profile.username}`
      : 'Playing as guest — sign in for a persistent name';
    this.subPanel.appendChild(this.label(who, !auth.profile));

    const ffa = this.makeButton('menu-btn-ffa', 'QUICK PLAY — FFA', () => {
      this.input.requestPointerLock();
      this.onMultiplayerFFA?.();
      this.gameState.state = GameState.PLAYING;
    });
    this.subPanel.appendChild(ffa);
    this.subPanel.appendChild(
      this.label('Free-for-all in the arena. 15-minute matches. More modes soon.', true),
    );
    this.subPanel.appendChild(
      this.makeButton('menu-btn-mp-back', 'BACK', () => this.showPanel('none')),
    );
  }

  private renderShopPanel(): void {
    this.subPanel.appendChild(this.label('WEAPONS — in-match shop'));
    this.subPanel.appendChild(
      this.label(
        'Earn gold from kills, then press E at the shopkeep (SW corner of the arena) to buy from all 10 weapons.',
        true,
      ),
    );
    this.subPanel.appendChild(this.label('SKINS — coming soon'));
    this.subPanel.appendChild(
      this.label(
        'Crimson Steel · Midnight · Goldenboy. Purchasable with credits to support development.',
        true,
      ),
    );
    this.subPanel.appendChild(
      this.makeButton('menu-btn-shop-back', 'BACK', () => this.showPanel('none')),
    );
  }

  private renderCreditsPanel(): void {
    const auth = getAuthState();
    if (!auth.configured) {
      this.subPanel.appendChild(
        this.label('Accounts are not configured on this deployment.', true),
      );
    } else if (!auth.profile) {
      this.subPanel.appendChild(
        this.label('Sign in to view your credit balance.', true),
      );
      this.subPanel.appendChild(
        this.makeButton('menu-btn-credits-signin', 'SIGN IN', () =>
          this.showPanel('auth'),
        ),
      );
    } else {
      const bal = this.label(`CREDITS: ${auth.profile.credits}`);
      bal.id = 'menu-credits-balance';
      bal.style.fontSize = '18px';
      this.subPanel.appendChild(bal);
      this.subPanel.appendChild(
        this.label(
          'Credit purchases are coming soon (Stripe). Credits will buy skins and other cosmetics — never gameplay power.',
          true,
        ),
      );
    }
    this.subPanel.appendChild(
      this.makeButton('menu-btn-credits-back', 'BACK', () => this.showPanel('none')),
    );
  }

  private renderAuthPanel(): void {
    const auth = getAuthState();
    if (!auth.configured) {
      this.subPanel.appendChild(
        this.label('Supabase env not configured — see docs/supabase-setup.md.', true),
      );
      this.subPanel.appendChild(
        this.makeButton('menu-btn-auth-back', 'BACK', () => this.showPanel('none')),
      );
      return;
    }

    const email = this.inputField('auth-email', 'email', 'email');
    const password = this.inputField('auth-password', 'password', 'password');
    const username = this.inputField('auth-username', 'username (for new accounts)');
    const status = this.label('', true);
    status.id = 'auth-status';

    this.subPanel.appendChild(email);
    this.subPanel.appendChild(password);
    this.subPanel.appendChild(username);

    this.subPanel.appendChild(
      this.makeButton('menu-btn-signin', 'SIGN IN', () => {
        status.textContent = 'Signing in…';
        void signIn(email.value.trim(), password.value).then((r) => {
          status.textContent = r.message;
          if (r.ok) this.showPanel('none');
        });
      }),
    );
    this.subPanel.appendChild(
      this.makeButton('menu-btn-signup', 'CREATE ACCOUNT', () => {
        status.textContent = 'Creating account…';
        void signUp(email.value.trim(), password.value, username.value.trim()).then(
          (r) => {
            status.textContent = r.message;
          },
        );
      }),
    );
    this.subPanel.appendChild(status);
    this.subPanel.appendChild(
      this.makeButton('menu-btn-auth-back', 'BACK', () => this.showPanel('none')),
    );
  }

  private renderAuthBar(): void {
    const auth: AuthState = getAuthState();
    this.authBar.innerHTML = '';
    if (!auth.configured) {
      const span = document.createElement('span');
      span.id = 'auth-guest-label';
      span.textContent = 'Guest mode (accounts not configured)';
      this.authBar.appendChild(span);
      this.refreshAuthDependentPanel();
      return;
    }
    if (auth.profile) {
      const span = document.createElement('span');
      span.id = 'auth-signed-in-label';
      span.textContent = `Signed in as ${auth.profile.username} · ${auth.profile.credits} credits`;
      this.authBar.appendChild(span);
      const out = document.createElement('button');
      out.id = 'menu-btn-signout';
      out.textContent = 'sign out';
      out.style.cssText = `
        font-family: ${theme.font};
        font-size: 12px;
        background: none;
        border: none;
        color: ${theme.text.accent};
        cursor: pointer;
        text-decoration: underline;
      `;
      out.addEventListener('click', () => void signOut());
      this.authBar.appendChild(out);
    } else {
      const btn = document.createElement('button');
      btn.id = 'menu-btn-auth';
      btn.textContent = 'SIGN IN / CREATE ACCOUNT';
      btn.style.cssText = `
        font-family: ${theme.font};
        font-size: 13px;
        letter-spacing: 2px;
        background: none;
        border: 1px solid ${theme.border.default};
        padding: 8px 16px;
        color: ${theme.text.secondary};
        cursor: pointer;
      `;
      btn.addEventListener('click', () => this.showPanel('auth'));
      this.authBar.appendChild(btn);
    }
    this.refreshAuthDependentPanel();
  }

  /** Re-render an open panel whose content depends on auth state. */
  private refreshAuthDependentPanel(): void {
    if (this.activePanel === 'credits' || this.activePanel === 'multiplayer') {
      const p = this.activePanel;
      this.activePanel = 'none';
      this.showPanel(p);
    }
  }

  // ── Lifecycle (unchanged contract) ─────────────────────

  get isVisible(): boolean {
    return this._isVisible;
  }

  show(): void {
    if (this._isVisible || this._disposed) return;
    this._isVisible = true;
    this.container.style.display = 'flex';
    this.menuManager.notifyOpen('main');
  }

  close(): void {
    if (!this._isVisible || this._disposed) return;
    this._isVisible = false;
    this.container.style.display = 'none';
    this.subPanel.innerHTML = '';
    this.subPanel.style.display = 'none';
    this.activePanel = 'none';
    this.menuManager.notifyClose('main');
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._unsubGameState();
    this._unsubAuth();
    this.menuManager.unregister('main');
    this.container.remove();
  }
}
