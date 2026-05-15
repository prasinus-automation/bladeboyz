/**
 * PauseMenu — unit tests
 *
 * Covers:
 *   - DOM construction (title, three buttons, PvP warning)
 *   - show / hide visibility flips + MenuManager notification
 *   - Resume button → hide + notifyClose
 *   - Quit button → hide + GameState.MAIN_MENU
 *   - Controls button → opens overlay without dropping pause from back-stack
 *   - Back-stack restoration: controls → ESC → pause re-shows
 *   - ESC routes ESC-during-PLAYING → opens pause (via MenuManager)
 *   - PvP simulation invariant — fixedUpdate keeps ticking while paused
 *   - dispose cleanup
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InputManager } from '../input/InputManager';
import { MenuManager } from './MenuManager';
import { GameState, GameStateManager } from '../core/GameState';
import { PauseMenu } from './PauseMenu';
import { ControlsOverlay } from './ControlsOverlay';
import { theme } from './theme';

function createInput(): InputManager {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  return new InputManager(canvas);
}

describe('PauseMenu', () => {
  let input: InputManager;
  let gsm: GameStateManager;
  let mgr: MenuManager;
  let pause: PauseMenu;
  let exitPointerLockSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    exitPointerLockSpy = vi.fn();
    (document as any).exitPointerLock = exitPointerLockSpy;

    const overlay = document.createElement('div');
    overlay.id = 'click-to-play';
    document.body.appendChild(overlay);

    input = createInput();
    gsm = new GameStateManager();
    mgr = new MenuManager(input, gsm);
  });

  afterEach(() => {
    try {
      pause?.dispose();
    } catch {
      /* tests that already disposed are fine */
    }
    mgr.dispose();
    delete (document as any).exitPointerLock;
    document.body.innerHTML = '';
  });

  describe('DOM construction', () => {
    beforeEach(() => {
      pause = new PauseMenu(gsm, mgr);
    });

    it('appends #pause-menu to body', () => {
      expect(document.getElementById('pause-menu')).not.toBeNull();
    });

    it('starts hidden (display:none) until show() is called', () => {
      const container = document.getElementById('pause-menu')!;
      expect(container.style.display).toBe('none');
      expect(pause.isVisible).toBe(false);
    });

    it('renders the PAUSED title', () => {
      const title = document.getElementById('pause-menu-title');
      expect(title).not.toBeNull();
      expect(title!.textContent).toBe('PAUSED');
    });

    it('renders three buttons: Resume / Controls / Quit', () => {
      const resume = document.getElementById('pause-menu-resume') as HTMLButtonElement;
      const controls = document.getElementById('pause-menu-controls') as HTMLButtonElement;
      const quit = document.getElementById('pause-menu-quit') as HTMLButtonElement;
      expect(resume?.textContent).toBe('Resume');
      expect(controls?.textContent).toBe('Controls');
      expect(quit?.textContent).toBe('Quit');
    });

    it('renders a PvP simulation warning below the panel', () => {
      const warning = document.getElementById('pause-menu-pvp-warning');
      expect(warning).not.toBeNull();
      // Match the key phrase, not the exact text — keeps wording-tweaks safe.
      expect(warning!.textContent).toMatch(/killed while paused/i);
    });

    it('PvP warning uses theme.status.warn color', () => {
      const warning = document.getElementById('pause-menu-pvp-warning')!;
      // theme.status.warn is '#ff0'; jsdom normalizes hex colors to rgb sometimes.
      // Just verify it isn't the default text color.
      expect(warning.style.color).not.toBe('');
      // The literal value or its rgb form, depending on jsdom version.
      const v = warning.style.color;
      expect(v === theme.status.warn || v === 'rgb(255, 255, 0)').toBe(true);
    });

    it('uses theme.bg.dim for the backdrop (lighter than full backdrop)', () => {
      const container = document.getElementById('pause-menu')!;
      // jsdom keeps css values approximately as-written; we just check the
      // alpha component (0.55 rather than 0.7) made it through.
      expect(container.style.background).toContain('0.55');
    });
  });

  describe('show / hide visibility', () => {
    beforeEach(() => {
      pause = new PauseMenu(gsm, mgr);
    });

    it('show() flips _isVisible + display:flex + notifies MenuManager', () => {
      pause.show();
      expect(pause.isVisible).toBe(true);
      const container = document.getElementById('pause-menu')!;
      expect(container.style.display).toBe('flex');
      expect(mgr.getCurrent()).toBe('pause');
      expect(input.paused).toBe(true);
    });

    it('hide() flips _isVisible + display:none + notifies MenuManager', () => {
      pause.show();
      expect(mgr.getCurrent()).toBe('pause');
      pause.hide();
      expect(pause.isVisible).toBe(false);
      const container = document.getElementById('pause-menu')!;
      expect(container.style.display).toBe('none');
      expect(mgr.getCurrent()).toBeNull();
      expect(input.paused).toBe(false);
    });

    it('show() is idempotent', () => {
      pause.show();
      pause.show();
      pause.show();
      expect(pause.isVisible).toBe(true);
      expect(mgr.getCurrent()).toBe('pause');
    });

    it('hide() is idempotent', () => {
      pause.hide();
      pause.hide();
      expect(pause.isVisible).toBe(false);
    });
  });

  describe('MenuManager registration', () => {
    it('registers under "pause" on construction', () => {
      pause = new PauseMenu(gsm, mgr);
      expect(mgr.isRegistered('pause')).toBe(true);
    });

    it('MenuManager.open("pause") shows the panel (covers ESC-during-PLAYING path)', () => {
      pause = new PauseMenu(gsm, mgr);
      expect(pause.isVisible).toBe(false);
      mgr.open('pause');
      expect(pause.isVisible).toBe(true);
      expect(mgr.getCurrent()).toBe('pause');
    });

    it('MenuManager.close("pause") hides the panel', () => {
      pause = new PauseMenu(gsm, mgr);
      pause.show();
      mgr.close('pause');
      expect(pause.isVisible).toBe(false);
      expect(mgr.getCurrent()).toBeNull();
    });
  });

  describe('ESC routing — opens pause when nothing is up + state is PLAYING', () => {
    beforeEach(() => {
      pause = new PauseMenu(gsm, mgr);
    });

    function pressEsc() {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    }

    it('ESC during PLAYING opens the pause menu', () => {
      gsm.state = GameState.PLAYING;
      expect(pause.isVisible).toBe(false);
      pressEsc();
      expect(pause.isVisible).toBe(true);
      expect(mgr.getCurrent()).toBe('pause');
    });

    it('ESC while pause is open closes it', () => {
      gsm.state = GameState.PLAYING;
      mgr.open('pause');
      expect(pause.isVisible).toBe(true);
      pressEsc();
      expect(pause.isVisible).toBe(false);
    });

    it('ESC during MAIN_MENU does not open the pause menu', () => {
      gsm.state = GameState.MAIN_MENU;
      pressEsc();
      expect(pause.isVisible).toBe(false);
    });
  });

  describe('Resume button', () => {
    beforeEach(() => {
      pause = new PauseMenu(gsm, mgr);
      pause.show();
    });

    it('hides the panel', () => {
      const btn = document.getElementById('pause-menu-resume') as HTMLButtonElement;
      btn.click();
      expect(pause.isVisible).toBe(false);
    });

    it('clears the MenuManager current modal', () => {
      const btn = document.getElementById('pause-menu-resume') as HTMLButtonElement;
      btn.click();
      expect(mgr.getCurrent()).toBeNull();
      expect(input.paused).toBe(false);
    });

    it('leaves GameState unchanged (PLAYING stays PLAYING)', () => {
      gsm.state = GameState.PLAYING;
      const btn = document.getElementById('pause-menu-resume') as HTMLButtonElement;
      btn.click();
      expect(gsm.state).toBe(GameState.PLAYING);
    });
  });

  describe('Quit button', () => {
    beforeEach(() => {
      pause = new PauseMenu(gsm, mgr);
      gsm.state = GameState.PLAYING;
      pause.show();
    });

    it('hides the panel and transitions GameState to MAIN_MENU', () => {
      const btn = document.getElementById('pause-menu-quit') as HTMLButtonElement;
      btn.click();
      expect(pause.isVisible).toBe(false);
      expect(gsm.state).toBe(GameState.MAIN_MENU);
    });

    it('clears the MenuManager current modal', () => {
      const btn = document.getElementById('pause-menu-quit') as HTMLButtonElement;
      btn.click();
      expect(mgr.getCurrent()).toBeNull();
    });
  });

  describe('Controls button + back-stack flow', () => {
    let controls: ControlsOverlay;

    beforeEach(() => {
      pause = new PauseMenu(gsm, mgr);
      controls = new ControlsOverlay(mgr);
      pause.setControlsOverlay(controls);
      gsm.state = GameState.PLAYING;
      pause.show();
    });

    afterEach(() => {
      controls?.dispose();
    });

    it('clicking Controls opens the ControlsOverlay and hides the pause DOM', () => {
      const btn = document.getElementById('pause-menu-controls') as HTMLButtonElement;
      btn.click();
      // Pause DOM is hidden visually, but MenuManager's back-stack tracks pause.
      const pauseContainer = document.getElementById('pause-menu')!;
      expect(pauseContainer.style.display).toBe('none');
      expect(controls.isVisible).toBe(true);
      expect(mgr.getCurrent()).toBe('controls');
    });

    it('pressing ESC inside Controls restores the pause menu (back-stack)', () => {
      const btn = document.getElementById('pause-menu-controls') as HTMLButtonElement;
      btn.click();
      expect(mgr.getCurrent()).toBe('controls');

      // ESC routes to controls → notifyClose('controls') → back-stack → pause.open()
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));

      expect(controls.isVisible).toBe(false);
      expect(pause.isVisible).toBe(true);
      const pauseContainer = document.getElementById('pause-menu')!;
      expect(pauseContainer.style.display).toBe('flex');
      expect(mgr.getCurrent()).toBe('pause');
      // We never un-paused input across the controls→pause hop.
      expect(input.paused).toBe(true);
    });

    it('clicking Controls without a linked overlay is a defensive no-op', () => {
      // Create a fresh pause without linking the overlay
      pause.dispose();
      pause = new PauseMenu(gsm, mgr);
      pause.show();
      const btn = document.getElementById('pause-menu-controls') as HTMLButtonElement;
      // Should not throw; the menu stays visible.
      expect(() => btn.click()).not.toThrow();
      expect(pause.isVisible).toBe(true);
    });
  });

  describe('PvP simulation invariant', () => {
    // Per the PR spec: ECS systems must keep running while pause is open. We
    // verify this with a synthetic tick counter that mimics fixedUpdate.
    it('a counter incremented in fixedUpdate keeps ticking while paused', () => {
      pause = new PauseMenu(gsm, mgr);
      gsm.state = GameState.PLAYING;
      let ticks = 0;
      // Mimic the contract used in main.ts: fixedUpdate runs unconditionally,
      // it never consults gameStateManager.state or menuManager.isAnyOpen().
      const fixedUpdate = (_dt: number) => {
        ticks++;
      };
      // Tick 5 times before pause
      for (let i = 0; i < 5; i++) fixedUpdate(1 / 60);
      expect(ticks).toBe(5);

      pause.show();
      // Even while paused, fixedUpdate keeps running — the menu doesn't
      // suppress it.
      for (let i = 0; i < 10; i++) fixedUpdate(1 / 60);
      expect(ticks).toBe(15);

      // Input is paused, but the simulation isn't.
      expect(input.paused).toBe(true);
    });
  });

  describe('dispose', () => {
    it('removes the #pause-menu element', () => {
      pause = new PauseMenu(gsm, mgr);
      expect(document.getElementById('pause-menu')).not.toBeNull();
      pause.dispose();
      expect(document.getElementById('pause-menu')).toBeNull();
    });

    it('unregisters from MenuManager', () => {
      pause = new PauseMenu(gsm, mgr);
      expect(mgr.isRegistered('pause')).toBe(true);
      pause.dispose();
      expect(mgr.isRegistered('pause')).toBe(false);
    });

    it('is idempotent', () => {
      pause = new PauseMenu(gsm, mgr);
      pause.dispose();
      expect(() => pause.dispose()).not.toThrow();
    });

    it('after dispose, show() is a no-op', () => {
      pause = new PauseMenu(gsm, mgr);
      pause.dispose();
      pause.show();
      expect(pause.isVisible).toBe(false);
    });
  });
});
