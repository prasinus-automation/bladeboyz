/**
 * MainMenu — unit tests
 *
 * Covers:
 *   - DOM construction (title, play button, controls hint, version)
 *   - GameState-driven visibility (shows on MAIN_MENU, hides on PLAYING)
 *   - Play button click flow: requestPointerLock + state transition
 *   - MenuManager registration + suppression composition
 *   - Dispose cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MainMenu } from './MainMenu';
import { InputManager } from '../input/InputManager';
import { MenuManager } from './MenuManager';
import { GameState, GameStateManager } from '../core/GameState';
import { APP_VERSION } from '../core/version';

function createInput(): InputManager {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  return new InputManager(canvas);
}

describe('MainMenu', () => {
  let input: InputManager;
  let gsm: GameStateManager;
  let mgr: MenuManager;
  let menu: MainMenu;
  let exitPointerLockSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom doesn't supply exitPointerLock; stub it so MenuManager.notifyOpen
    // doesn't blow up during construction.
    exitPointerLockSpy = vi.fn();
    (document as any).exitPointerLock = exitPointerLockSpy;

    // Provide a #click-to-play overlay so MenuManager's re-evaluation runs.
    const overlay = document.createElement('div');
    overlay.id = 'click-to-play';
    document.body.appendChild(overlay);

    input = createInput();
    gsm = new GameStateManager();
    mgr = new MenuManager(input, gsm);
  });

  afterEach(() => {
    if (menu) {
      try {
        menu.dispose();
      } catch {
        /* tests that already disposed are fine */
      }
    }
    mgr.dispose();
    delete (document as any).exitPointerLock;
    document.body.innerHTML = '';
  });

  describe('DOM construction', () => {
    beforeEach(() => {
      menu = new MainMenu(input, gsm, mgr);
    });

    it('appends a #main-menu container to the body', () => {
      expect(document.getElementById('main-menu')).not.toBeNull();
    });

    it('renders a BLADEBOYZ title', () => {
      const title = document.getElementById('main-menu-title');
      expect(title).not.toBeNull();
      expect(title!.textContent).toBe('BLADEBOYZ');
    });

    it('renders the four landing buttons (multiplayer era)', () => {
      for (const [id, label] of [
        ['menu-btn-multiplayer', 'MULTIPLAYER'],
        ['menu-btn-practice', 'PRACTICE BOTS'],
        ['menu-btn-shop', 'SHOP'],
        ['menu-btn-credits', 'BUY CREDITS'],
      ] as const) {
        const btn = document.getElementById(id);
        expect(btn, id).not.toBeNull();
        expect(btn!.tagName.toLowerCase()).toBe('button');
        expect(btn!.textContent).toBe(label);
      }
    });

    it('MULTIPLAYER opens a submenu with QUICK PLAY — FFA', () => {
      document.getElementById('menu-btn-multiplayer')!.click();
      const ffa = document.getElementById('menu-btn-ffa');
      expect(ffa).not.toBeNull();
      expect(ffa!.textContent).toContain('FFA');
    });

    it('renders a controls hint', () => {
      const hint = document.getElementById('main-menu-controls');
      expect(hint).not.toBeNull();
      // Several of the key bindings should appear in the hint text.
      expect(hint!.textContent).toMatch(/WASD/i);
      expect(hint!.textContent).toMatch(/LMB/i);
      expect(hint!.textContent).toMatch(/RMB/i);
      expect(hint!.textContent).toMatch(/ESC/i);
    });

    it('renders the package version from APP_VERSION', () => {
      const ver = document.getElementById('main-menu-version');
      expect(ver).not.toBeNull();
      expect(ver!.textContent).toBe(`v${APP_VERSION}`);
    });

    it('uses font-family: monospace (no web fonts)', () => {
      const container = document.getElementById('main-menu')!;
      expect(container.style.fontFamily).toMatch(/monospace/);
    });
  });

  describe('initial visibility', () => {
    it('shows when GameStateManager defaults to MAIN_MENU', () => {
      menu = new MainMenu(input, gsm, mgr);
      expect(menu.isVisible).toBe(true);
      const container = document.getElementById('main-menu')!;
      expect(container.style.display).toBe('flex');
    });

    it('stays hidden when constructed with state already PLAYING', () => {
      gsm.state = GameState.PLAYING;
      menu = new MainMenu(input, gsm, mgr);
      expect(menu.isVisible).toBe(false);
      const container = document.getElementById('main-menu')!;
      expect(container.style.display).toBe('none');
    });
  });

  describe('GameState-driven visibility', () => {
    beforeEach(() => {
      menu = new MainMenu(input, gsm, mgr);
    });

    it('hides on transition MAIN_MENU → PLAYING', () => {
      expect(menu.isVisible).toBe(true);
      gsm.state = GameState.PLAYING;
      expect(menu.isVisible).toBe(false);
      const container = document.getElementById('main-menu')!;
      expect(container.style.display).toBe('none');
    });

    it('hides on transition MAIN_MENU → PAUSED', () => {
      expect(menu.isVisible).toBe(true);
      gsm.state = GameState.PAUSED;
      expect(menu.isVisible).toBe(false);
    });

    it('shows on transition PLAYING → MAIN_MENU', () => {
      gsm.state = GameState.PLAYING;
      expect(menu.isVisible).toBe(false);
      gsm.state = GameState.MAIN_MENU;
      expect(menu.isVisible).toBe(true);
    });

    it('show() is idempotent', () => {
      expect(menu.isVisible).toBe(true);
      menu.show();
      menu.show();
      expect(menu.isVisible).toBe(true);
    });

    it('close() is idempotent', () => {
      gsm.state = GameState.PLAYING;
      expect(menu.isVisible).toBe(false);
      menu.close();
      menu.close();
      expect(menu.isVisible).toBe(false);
    });
  });

  describe('Play button click flow', () => {
    let pointerLockSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // jsdom's canvas doesn't expose requestPointerLock — stub at the
      // InputManager wrapper so every click test in this group is safe.
      pointerLockSpy = vi.spyOn(input, 'requestPointerLock').mockImplementation(() => {});
      menu = new MainMenu(input, gsm, mgr);
    });

    afterEach(() => {
      pointerLockSpy.mockRestore();
    });

    it('clicking PRACTICE BOTS transitions GameState to PLAYING', () => {
      const btn = document.getElementById('menu-btn-practice') as HTMLButtonElement;
      btn.click();
      expect(gsm.state).toBe(GameState.PLAYING);
    });

    it('clicking PRACTICE BOTS calls input.requestPointerLock()', () => {
      const btn = document.getElementById('menu-btn-practice') as HTMLButtonElement;
      btn.click();
      expect(pointerLockSpy).toHaveBeenCalledTimes(1);
    });

    it('requestPointerLock is invoked BEFORE the state transition (synchronous browser-gesture path)', () => {
      const order: string[] = [];
      pointerLockSpy.mockImplementation(() => {
        order.push('requestPointerLock');
      });
      gsm.subscribe((state) => {
        if (state === GameState.PLAYING) order.push('state:PLAYING');
      });
      const btn = document.getElementById('menu-btn-practice') as HTMLButtonElement;
      btn.click();
      expect(order).toEqual(['requestPointerLock', 'state:PLAYING']);
    });

    it('clicking PRACTICE BOTS hides the menu', () => {
      expect(menu.isVisible).toBe(true);
      const btn = document.getElementById('menu-btn-practice') as HTMLButtonElement;
      btn.click();
      expect(menu.isVisible).toBe(false);
    });
  });

  describe('MenuManager integration', () => {
    it('registers as "main" on construction', () => {
      menu = new MainMenu(input, gsm, mgr);
      expect(mgr.isRegistered('main')).toBe(true);
    });

    it('notifyOpen runs when menu shows — current() is "main"', () => {
      menu = new MainMenu(input, gsm, mgr);
      expect(mgr.getCurrent()).toBe('main');
      expect(mgr.isAnyOpen()).toBe(true);
    });

    it('isAnyOpen() returns true while menu is visible → click-to-play suppression covers us', () => {
      menu = new MainMenu(input, gsm, mgr);
      // MenuManager's ctor wires `input._suppressClickToPlay = () => this.isAnyOpen()`.
      // While main menu is up, that predicate must return true so the legacy
      // #click-to-play overlay stays hidden behind us on initial load.
      expect(input._suppressClickToPlay).not.toBeNull();
      expect(input._suppressClickToPlay!()).toBe(true);
    });

    it('notifyClose runs when menu hides — current() is null after PLAYING', () => {
      menu = new MainMenu(input, gsm, mgr);
      gsm.state = GameState.PLAYING;
      expect(mgr.getCurrent()).toBeNull();
      expect(mgr.isAnyOpen()).toBe(false);
    });

    it('exitPointerLock is invoked on initial show (via MenuManager.notifyOpen)', () => {
      // MenuManager.notifyOpen releases pointer lock — guarantees the menu has
      // pointer focus on load even if some prior session left lock acquired.
      menu = new MainMenu(input, gsm, mgr);
      expect(exitPointerLockSpy).toHaveBeenCalled();
    });

    it('input.paused = true while menu is open (MenuManager contract)', () => {
      menu = new MainMenu(input, gsm, mgr);
      expect(input.paused).toBe(true);
    });

    it('input.paused = false after menu closes', () => {
      menu = new MainMenu(input, gsm, mgr);
      gsm.state = GameState.PLAYING;
      expect(input.paused).toBe(false);
    });
  });

  describe('dispose', () => {
    it('removes the #main-menu element', () => {
      menu = new MainMenu(input, gsm, mgr);
      expect(document.getElementById('main-menu')).not.toBeNull();
      menu.dispose();
      expect(document.getElementById('main-menu')).toBeNull();
    });

    it('unregisters from MenuManager', () => {
      menu = new MainMenu(input, gsm, mgr);
      expect(mgr.isRegistered('main')).toBe(true);
      menu.dispose();
      expect(mgr.isRegistered('main')).toBe(false);
    });

    it('stops reacting to state changes', () => {
      menu = new MainMenu(input, gsm, mgr);
      gsm.state = GameState.PLAYING;
      expect(menu.isVisible).toBe(false);
      menu.dispose();
      // After dispose, going back to MAIN_MENU should NOT make us re-show.
      gsm.state = GameState.MAIN_MENU;
      expect(menu.isVisible).toBe(false);
    });

    it('dispose is idempotent', () => {
      menu = new MainMenu(input, gsm, mgr);
      menu.dispose();
      expect(() => menu.dispose()).not.toThrow();
    });
  });
});
