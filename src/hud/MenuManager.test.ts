/**
 * MenuManager — unit tests
 *
 * Covers:
 *   - register/unregister + open/close API
 *   - notifyOpen/notifyClose pause + pointer-lock plumbing
 *   - subscribe/unsubscribe
 *   - ESC routing 6-cell matrix
 *   - click-to-play overlay suppression
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InputManager } from '../input/InputManager';
import { GameState, GameStateManager } from '../core/GameState';
import { MenuManager, type ModalKind } from './MenuManager';

function createInput(): InputManager {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  return new InputManager(canvas);
}

/** Build a faux modal that tracks open/close calls and wires through the manager. */
function makeModal(mgr: MenuManager, kind: ModalKind) {
  const state = { open: false, openCalls: 0, closeCalls: 0 };
  const reg = {
    open: () => {
      state.open = true;
      state.openCalls++;
      mgr.notifyOpen(kind);
    },
    close: () => {
      state.open = false;
      state.closeCalls++;
      mgr.notifyClose(kind);
    },
  };
  mgr.register(kind, reg);
  return { ...state, reg, get isOpen() { return state.open; } };
}

describe('MenuManager', () => {
  let input: InputManager;
  let gsm: GameStateManager;
  let mgr: MenuManager;
  let exitPointerLockSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom doesn't supply exitPointerLock; stub it so we can assert calls.
    exitPointerLockSpy = vi.fn();
    (document as any).exitPointerLock = exitPointerLockSpy;

    // Provide a #click-to-play overlay so re-evaluation paths run.
    const overlay = document.createElement('div');
    overlay.id = 'click-to-play';
    document.body.appendChild(overlay);

    input = createInput();
    gsm = new GameStateManager();
    mgr = new MenuManager(input, gsm);
  });

  afterEach(() => {
    mgr.dispose();
    document.getElementById('click-to-play')?.remove();
    delete (document as any).exitPointerLock;
    document.body.innerHTML = '';
  });

  describe('initial state', () => {
    it('no modal is open', () => {
      expect(mgr.isAnyOpen()).toBe(false);
      expect(mgr.getCurrent()).toBeNull();
    });

    it('input is not paused', () => {
      expect(input.paused).toBe(false);
    });

    it('takes ownership of input._suppressClickToPlay', () => {
      expect(input._suppressClickToPlay).not.toBeNull();
      expect(input._suppressClickToPlay!()).toBe(false);
    });
  });

  describe('register / unregister', () => {
    it('register makes a modal known', () => {
      expect(mgr.isRegistered('inventory')).toBe(false);
      mgr.register('inventory', { close: () => {} });
      expect(mgr.isRegistered('inventory')).toBe(true);
    });

    it('unregister removes a modal', () => {
      mgr.register('inventory', { close: () => {} });
      mgr.unregister('inventory');
      expect(mgr.isRegistered('inventory')).toBe(false);
    });
  });

  describe('notifyOpen / notifyClose', () => {
    it('notifyOpen sets current and pauses input', () => {
      const inv = makeModal(mgr, 'inventory');
      inv.reg.open();
      expect(mgr.getCurrent()).toBe('inventory');
      expect(input.paused).toBe(true);
    });

    it('notifyOpen releases pointer lock', () => {
      const inv = makeModal(mgr, 'inventory');
      inv.reg.open();
      expect(exitPointerLockSpy).toHaveBeenCalled();
    });

    it('notifyClose clears current and unpauses input', () => {
      const inv = makeModal(mgr, 'inventory');
      inv.reg.open();
      inv.reg.close();
      expect(mgr.getCurrent()).toBeNull();
      expect(input.paused).toBe(false);
    });

    it('notifyOpen of the same modal twice is a no-op', () => {
      const inv = makeModal(mgr, 'inventory');
      inv.reg.open();
      // Calling notifyOpen directly on second time should not retrigger.
      const calls = exitPointerLockSpy.mock.calls.length;
      mgr.notifyOpen('inventory');
      expect(exitPointerLockSpy.mock.calls.length).toBe(calls);
    });

    it('notifyClose for a modal that is not current is a no-op', () => {
      makeModal(mgr, 'inventory');
      mgr.notifyClose('inventory');
      expect(input.paused).toBe(false);
    });

    it('handles missing exitPointerLock gracefully', () => {
      delete (document as any).exitPointerLock;
      const inv = makeModal(mgr, 'inventory');
      expect(() => inv.reg.open()).not.toThrow();
      expect(input.paused).toBe(true);
    });
  });

  describe('open / close API', () => {
    it('open() invokes a registered open handler', () => {
      const inv = makeModal(mgr, 'inventory');
      const opened = mgr.open('inventory');
      expect(opened).toBe(true);
      expect(inv.isOpen).toBe(true);
    });

    it('open() returns false when modal is not registered', () => {
      expect(mgr.open('pause')).toBe(false);
    });

    it('open() returns false when modal has no open handler', () => {
      mgr.register('pause', { close: () => {} });
      expect(mgr.open('pause')).toBe(false);
    });

    it('close() invokes the current modal\'s close handler', () => {
      const inv = makeModal(mgr, 'inventory');
      inv.reg.open();
      mgr.close();
      expect(inv.isOpen).toBe(false);
      expect(mgr.getCurrent()).toBeNull();
    });

    it('close(kind) only closes the matching modal', () => {
      const inv = makeModal(mgr, 'inventory');
      inv.reg.open();
      mgr.close('pause'); // not current — no-op
      expect(mgr.getCurrent()).toBe('inventory');
      mgr.close('inventory');
      expect(mgr.getCurrent()).toBeNull();
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('fires listener when current modal changes', () => {
      const fn = vi.fn();
      mgr.subscribe(fn);
      const inv = makeModal(mgr, 'inventory');
      inv.reg.open();
      expect(fn).toHaveBeenCalledWith('inventory');
      inv.reg.close();
      expect(fn).toHaveBeenLastCalledWith(null);
    });

    it('unsubscribe stops further calls', () => {
      const fn = vi.fn();
      const unsub = mgr.subscribe(fn);
      const inv = makeModal(mgr, 'inventory');
      inv.reg.open();
      expect(fn).toHaveBeenCalledTimes(1);
      unsub();
      inv.reg.close();
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('ESC routing — 6-cell matrix', () => {
    function pressEsc() {
      const e = new KeyboardEvent('keydown', { code: 'Escape', cancelable: true });
      document.dispatchEvent(e);
      return e;
    }

    it('cell 1: current=null + PLAYING + pause registered → opens pause', () => {
      gsm.state = GameState.PLAYING;
      const pause = makeModal(mgr, 'pause');
      pressEsc();
      expect(pause.isOpen).toBe(true);
      expect(mgr.getCurrent()).toBe('pause');
    });

    it('cell 1b: current=null + PLAYING + pause NOT registered → no-op', () => {
      gsm.state = GameState.PLAYING;
      pressEsc();
      expect(mgr.getCurrent()).toBeNull();
      expect(input.paused).toBe(false);
    });

    it('cell 2: current=null + MAIN_MENU → no-op (no pause to open)', () => {
      gsm.state = GameState.MAIN_MENU;
      const pause = makeModal(mgr, 'pause');
      pressEsc();
      expect(pause.isOpen).toBe(false);
      expect(mgr.getCurrent()).toBeNull();
    });

    it('cell 3: current=pause + ESC → close pause (resume)', () => {
      gsm.state = GameState.PLAYING;
      const pause = makeModal(mgr, 'pause');
      pause.reg.open();
      expect(mgr.getCurrent()).toBe('pause');
      pressEsc();
      expect(pause.isOpen).toBe(false);
      expect(mgr.getCurrent()).toBeNull();
      expect(input.paused).toBe(false);
    });

    it('cell 4: current=controls (from pause) + ESC → back to pause', () => {
      gsm.state = GameState.PLAYING;
      const pause = makeModal(mgr, 'pause');
      const controls = makeModal(mgr, 'controls');
      pause.reg.open();
      // Open controls on top of pause
      controls.reg.open();
      expect(mgr.getCurrent()).toBe('controls');
      // ESC: should close controls and re-open pause
      pressEsc();
      expect(controls.isOpen).toBe(false);
      expect(mgr.getCurrent()).toBe('pause');
      // Input should still be paused (we never resumed)
      expect(input.paused).toBe(true);
    });

    it('cell 5: current=controls (from main) + ESC → back to main', () => {
      gsm.state = GameState.MAIN_MENU;
      const main = makeModal(mgr, 'main');
      const controls = makeModal(mgr, 'controls');
      main.reg.open();
      controls.reg.open();
      expect(mgr.getCurrent()).toBe('controls');
      pressEsc();
      expect(controls.isOpen).toBe(false);
      expect(mgr.getCurrent()).toBe('main');
    });

    it('cell 5b: current=controls with no back-stack → just close', () => {
      gsm.state = GameState.MAIN_MENU;
      const controls = makeModal(mgr, 'controls');
      controls.reg.open();
      expect(mgr.getCurrent()).toBe('controls');
      pressEsc();
      expect(controls.isOpen).toBe(false);
      expect(mgr.getCurrent()).toBeNull();
      expect(input.paused).toBe(false);
    });

    it('cell 6: current=inventory + ESC → close inventory', () => {
      gsm.state = GameState.PLAYING;
      const inv = makeModal(mgr, 'inventory');
      inv.reg.open();
      pressEsc();
      expect(inv.isOpen).toBe(false);
      expect(mgr.getCurrent()).toBeNull();
      expect(input.paused).toBe(false);
    });

    it('non-ESC keys are ignored', () => {
      gsm.state = GameState.PLAYING;
      makeModal(mgr, 'pause');
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
      expect(mgr.getCurrent()).toBeNull();
    });
  });

  describe('click-to-play suppression', () => {
    it('overlay is hidden while a modal is open', () => {
      const overlay = document.getElementById('click-to-play')!;
      expect(overlay.classList.contains('hidden')).toBe(false);
      const inv = makeModal(mgr, 'inventory');
      inv.reg.open();
      expect(overlay.classList.contains('hidden')).toBe(true);
    });

    it('overlay returns when modal closes (and pointer not locked)', () => {
      const overlay = document.getElementById('click-to-play')!;
      const inv = makeModal(mgr, 'inventory');
      inv.reg.open();
      inv.reg.close();
      expect(overlay.classList.contains('hidden')).toBe(false);
    });

    it('input._suppressClickToPlay reflects manager state', () => {
      const inv = makeModal(mgr, 'inventory');
      expect(input._suppressClickToPlay!()).toBe(false);
      inv.reg.open();
      expect(input._suppressClickToPlay!()).toBe(true);
      inv.reg.close();
      expect(input._suppressClickToPlay!()).toBe(false);
    });
  });

  describe('dispose', () => {
    it('removes the keydown listener', () => {
      gsm.state = GameState.PLAYING;
      const pause = makeModal(mgr, 'pause');
      mgr.dispose();
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      expect(pause.isOpen).toBe(false);
    });

    it('clears subscribers', () => {
      const fn = vi.fn();
      mgr.subscribe(fn);
      expect(mgr.listenerCount).toBe(1);
      mgr.dispose();
      expect(mgr.listenerCount).toBe(0);
    });

    it('clears input._suppressClickToPlay', () => {
      mgr.dispose();
      expect(input._suppressClickToPlay).toBeNull();
    });

    it('double-dispose is safe', () => {
      mgr.dispose();
      expect(() => mgr.dispose()).not.toThrow();
    });
  });
});
