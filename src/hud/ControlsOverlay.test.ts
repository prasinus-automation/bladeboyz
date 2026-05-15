/**
 * ControlsOverlay — unit tests
 *
 * Covers:
 *   - DOM construction (title, body, Back button)
 *   - Renders one row per `keybind`, grouped by section
 *   - Key labels are formatted via `formatKeyCode` (e.g. KeyW → W)
 *   - show / hide visibility flips + MenuManager notification
 *   - Back button calls hide()
 *   - Adding a new keybind appears automatically (data-driven assertion)
 *   - dispose cleanup
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InputManager } from '../input/InputManager';
import { MenuManager } from './MenuManager';
import { GameStateManager } from '../core/GameState';
import { ControlsOverlay } from './ControlsOverlay';
import { keybinds, formatKeyCode } from '../input/keybinds';

function createInput(): InputManager {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  return new InputManager(canvas);
}

describe('ControlsOverlay', () => {
  let input: InputManager;
  let gsm: GameStateManager;
  let mgr: MenuManager;
  let overlay: ControlsOverlay;
  let exitPointerLockSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    exitPointerLockSpy = vi.fn();
    (document as any).exitPointerLock = exitPointerLockSpy;

    const ctp = document.createElement('div');
    ctp.id = 'click-to-play';
    document.body.appendChild(ctp);

    input = createInput();
    gsm = new GameStateManager();
    mgr = new MenuManager(input, gsm);
  });

  afterEach(() => {
    try {
      overlay?.dispose();
    } catch {
      /* tests may already dispose */
    }
    mgr.dispose();
    delete (document as any).exitPointerLock;
    document.body.innerHTML = '';
  });

  describe('DOM construction', () => {
    beforeEach(() => {
      overlay = new ControlsOverlay(mgr);
    });

    it('appends #controls-overlay to body', () => {
      expect(document.getElementById('controls-overlay')).not.toBeNull();
    });

    it('starts hidden until show() is called', () => {
      const container = document.getElementById('controls-overlay')!;
      expect(container.style.display).toBe('none');
      expect(overlay.isVisible).toBe(false);
    });

    it('renders a CONTROLS title', () => {
      const title = document.getElementById('controls-overlay-title');
      expect(title).not.toBeNull();
      expect(title!.textContent).toBe('CONTROLS');
    });

    it('renders a Back button', () => {
      const btn = document.getElementById('controls-overlay-back') as HTMLButtonElement;
      expect(btn).not.toBeNull();
      expect(btn.textContent).toBe('Back');
      expect(btn.tagName.toLowerCase()).toBe('button');
    });

    it('renders one row per keybind in the table', () => {
      const rows = document.querySelectorAll('.controls-row');
      expect(rows.length).toBe(keybinds.length);
    });

    it('every row exposes its action via data-action', () => {
      const rows = document.querySelectorAll<HTMLDivElement>('.controls-row');
      const actions = Array.from(rows).map((r) => r.dataset.action);
      // Spot-check a few canonical actions
      expect(actions).toContain('moveForward');
      expect(actions).toContain('attack');
      expect(actions).toContain('toggleInventory');
      expect(actions).toContain('pauseMenu');
    });

    it('every group header exists (Movement, Combat, Interface)', () => {
      const headers = document.querySelectorAll<HTMLDivElement>('.controls-group-header');
      const groups = Array.from(headers).map((h) => h.dataset.group);
      expect(groups).toEqual(['Movement', 'Combat', 'Interface']);
    });

    it('key labels are formatted via formatKeyCode', () => {
      // Find the moveForward row and check its key cell.
      const row = document.querySelector<HTMLDivElement>(
        '.controls-row[data-action="moveForward"]',
      );
      expect(row).not.toBeNull();
      const keyEl = row!.querySelector<HTMLSpanElement>('.controls-row-key');
      expect(keyEl?.textContent).toBe(formatKeyCode('KeyW'));
      expect(keyEl?.textContent).toBe('W');
    });

    it('label text comes from the keybind table (e.g. "Move forward")', () => {
      const row = document.querySelector<HTMLDivElement>(
        '.controls-row[data-action="moveForward"]',
      );
      const labelEl = row!.querySelector<HTMLSpanElement>('.controls-row-label');
      expect(labelEl?.textContent).toBe('Move forward');
    });

    it('Mouse0 attack row renders as LMB', () => {
      const row = document.querySelector<HTMLDivElement>(
        '.controls-row[data-action="attack"]',
      );
      const keyEl = row!.querySelector<HTMLSpanElement>('.controls-row-key');
      expect(keyEl?.textContent).toBe('LMB');
    });

    it('Escape pauseMenu row renders as "Esc"', () => {
      const row = document.querySelector<HTMLDivElement>(
        '.controls-row[data-action="pauseMenu"]',
      );
      const keyEl = row!.querySelector<HTMLSpanElement>('.controls-row-key');
      expect(keyEl?.textContent).toBe('Esc');
    });
  });

  describe('show / hide', () => {
    beforeEach(() => {
      overlay = new ControlsOverlay(mgr);
    });

    it('show() flips _isVisible + display:flex + notifies MenuManager', () => {
      overlay.show();
      expect(overlay.isVisible).toBe(true);
      const container = document.getElementById('controls-overlay')!;
      expect(container.style.display).toBe('flex');
      expect(mgr.getCurrent()).toBe('controls');
      expect(input.paused).toBe(true);
    });

    it('hide() flips _isVisible + display:none + notifies MenuManager', () => {
      overlay.show();
      overlay.hide();
      expect(overlay.isVisible).toBe(false);
      const container = document.getElementById('controls-overlay')!;
      expect(container.style.display).toBe('none');
      expect(mgr.getCurrent()).toBeNull();
    });

    it('show() / hide() are idempotent', () => {
      overlay.show();
      overlay.show();
      expect(overlay.isVisible).toBe(true);
      overlay.hide();
      overlay.hide();
      expect(overlay.isVisible).toBe(false);
    });
  });

  describe('Back button', () => {
    beforeEach(() => {
      overlay = new ControlsOverlay(mgr);
      overlay.show();
    });

    it('clicking Back hides the overlay', () => {
      const btn = document.getElementById('controls-overlay-back') as HTMLButtonElement;
      btn.click();
      expect(overlay.isVisible).toBe(false);
    });

    it('clicking Back calls notifyClose("controls")', () => {
      const btn = document.getElementById('controls-overlay-back') as HTMLButtonElement;
      btn.click();
      expect(mgr.getCurrent()).toBeNull();
    });
  });

  describe('MenuManager registration', () => {
    it('registers under "controls" on construction', () => {
      overlay = new ControlsOverlay(mgr);
      expect(mgr.isRegistered('controls')).toBe(true);
    });

    it('MenuManager.open("controls") shows the overlay', () => {
      overlay = new ControlsOverlay(mgr);
      mgr.open('controls');
      expect(overlay.isVisible).toBe(true);
    });
  });

  describe('data-driven contract', () => {
    // If a new keybind is added in src/input/keybinds.ts, it should appear in
    // the overlay automatically — no code change here required. We assert the
    // count parity to pin this contract.
    it('row count equals keybinds.length', () => {
      overlay = new ControlsOverlay(mgr);
      const rows = document.querySelectorAll('.controls-row');
      expect(rows.length).toBe(keybinds.length);
    });

    it('every keybind has a corresponding row', () => {
      overlay = new ControlsOverlay(mgr);
      for (const kb of keybinds) {
        const row = document.querySelector(
          `.controls-row[data-action="${kb.action}"]`,
        );
        expect(row).not.toBeNull();
      }
    });
  });

  describe('dispose', () => {
    it('removes the #controls-overlay element', () => {
      overlay = new ControlsOverlay(mgr);
      expect(document.getElementById('controls-overlay')).not.toBeNull();
      overlay.dispose();
      expect(document.getElementById('controls-overlay')).toBeNull();
    });

    it('unregisters from MenuManager', () => {
      overlay = new ControlsOverlay(mgr);
      expect(mgr.isRegistered('controls')).toBe(true);
      overlay.dispose();
      expect(mgr.isRegistered('controls')).toBe(false);
    });

    it('is idempotent', () => {
      overlay = new ControlsOverlay(mgr);
      overlay.dispose();
      expect(() => overlay.dispose()).not.toThrow();
    });

    it('show() / hide() are no-ops after dispose', () => {
      overlay = new ControlsOverlay(mgr);
      overlay.dispose();
      overlay.show();
      expect(overlay.isVisible).toBe(false);
      overlay.hide();
      expect(overlay.isVisible).toBe(false);
    });
  });
});
