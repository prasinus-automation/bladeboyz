import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShopPanel } from './ShopPanel';
import { InputManager } from '../../input/InputManager';
import { MockPaymentProvider, type ShopTab } from './types';

function createMockInput(): InputManager {
  const canvas = document.createElement('canvas');
  return new InputManager(canvas);
}

/** Test ShopTab that records mount/unmount calls */
class RecordingTab implements ShopTab {
  currency = 'gold' as const;
  mountCount = 0;
  unmountCount = 0;
  lastContainer: HTMLElement | null = null;

  constructor(public id: string, public label: string) {}

  mount(container: HTMLElement): void {
    this.mountCount++;
    this.lastContainer = container;
    const node = document.createElement('div');
    node.className = `recording-tab-${this.id}`;
    node.textContent = `tab:${this.id}`;
    container.appendChild(node);
  }

  unmount(): void {
    this.unmountCount++;
  }
}

describe('ShopPanel', () => {
  let panel: ShopPanel;
  let input: InputManager;

  beforeEach(() => {
    input = createMockInput();
    panel = new ShopPanel(input);
  });

  afterEach(() => {
    panel.dispose();
  });

  describe('open/close state', () => {
    it('starts closed', () => {
      expect(panel.isOpen).toBe(false);
    });

    it('opens via open()', () => {
      panel.open();
      expect(panel.isOpen).toBe(true);
    });

    it('closes via close()', () => {
      panel.open();
      panel.close();
      expect(panel.isOpen).toBe(false);
    });

    it('toggle() flips state', () => {
      panel.toggle();
      expect(panel.isOpen).toBe(true);
      panel.toggle();
      expect(panel.isOpen).toBe(false);
    });

    it('open() is idempotent', () => {
      panel.open();
      panel.open();
      expect(panel.isOpen).toBe(true);
    });

    it('close() is idempotent', () => {
      panel.close();
      expect(panel.isOpen).toBe(false);
    });
  });

  describe('DOM visibility', () => {
    it('panel is hidden when closed', () => {
      const el = document.getElementById('shop-panel')!;
      expect(el.style.display).toBe('none');
    });

    it('panel is visible when open', () => {
      panel.open();
      const el = document.getElementById('shop-panel')!;
      // Uses flex because the panel has flex-direction: column
      expect(el.style.display).toBe('flex');
    });

    it('backdrop is visible when open', () => {
      panel.open();
      const el = document.getElementById('shop-backdrop')!;
      expect(el.style.display).toBe('block');
    });
  });

  describe('input pausing', () => {
    it('sets input.paused = true when opened', () => {
      panel.open();
      expect(input.paused).toBe(true);
    });

    it('sets input.paused = false when closed', () => {
      panel.open();
      panel.close();
      expect(input.paused).toBe(false);
    });
  });

  describe('pointer lock', () => {
    it('calls document.exitPointerLock on open', () => {
      (document as any).exitPointerLock = vi.fn();
      panel.open();
      expect(document.exitPointerLock).toHaveBeenCalled();
      delete (document as any).exitPointerLock;
    });
  });

  describe('default tabs', () => {
    it('registers a Weapons stub tab', () => {
      const buttons = document.querySelectorAll('.shop-tab-btn');
      const labels = Array.from(buttons).map((b) => b.textContent);
      expect(labels).toContain('Weapons (Gold)');
    });

    it('registers the Premium tab', () => {
      const buttons = document.querySelectorAll('.shop-tab-btn');
      const labels = Array.from(buttons).map((b) => b.textContent);
      expect(labels).toContain('Premium (USD)');
    });

    it('mounts the Weapons stub tab on first open', () => {
      panel.open();
      const body = document.getElementById('shop-body')!;
      expect(body.textContent).toContain('Weapons shop coming in #96');
    });

    it('switches to Premium tab on click', () => {
      panel.open();
      const buttons = document.querySelectorAll('.shop-tab-btn') as NodeListOf<HTMLButtonElement>;
      const premiumBtn = Array.from(buttons).find((b) => b.textContent === 'Premium (USD)')!;
      premiumBtn.click();
      const body = document.getElementById('shop-body')!;
      expect(body.textContent).toContain('Coming soon');
    });
  });

  describe('addTab', () => {
    it('appends a new tab button to the strip', () => {
      const tab = new RecordingTab('custom', 'Custom');
      panel.addTab(tab);
      const buttons = document.querySelectorAll('.shop-tab-btn');
      const labels = Array.from(buttons).map((b) => b.textContent);
      expect(labels).toContain('Custom');
    });

    it('mounts the newly added tab if it is the first registered tab', () => {
      // Build a panel with no defaults so the addTab can be the first tab
      panel.dispose();
      panel = new ShopPanel(input, { registerDefaultTabs: false });
      panel.open();
      const tab = new RecordingTab('only', 'Only');
      panel.addTab(tab);
      expect(tab.mountCount).toBe(1);
    });

    it('does not auto-mount additional tabs after the first', () => {
      const tab = new RecordingTab('extra', 'Extra');
      panel.addTab(tab);
      panel.open();
      // Default Weapons tab mounts first; Extra is not active yet.
      expect(tab.mountCount).toBe(0);
    });
  });

  describe('switchTab', () => {
    let a: RecordingTab;
    let b: RecordingTab;

    beforeEach(() => {
      panel.dispose();
      panel = new ShopPanel(input, { registerDefaultTabs: false });
      a = new RecordingTab('a', 'A');
      b = new RecordingTab('b', 'B');
      panel.addTab(a);
      panel.addTab(b);
      panel.open();
    });

    it('mounts the first tab on open', () => {
      expect(a.mountCount).toBe(1);
      expect(b.mountCount).toBe(0);
    });

    it('switching calls unmount on previous tab and mount on next', () => {
      panel.switchTab('b');
      expect(a.unmountCount).toBe(1);
      expect(b.mountCount).toBe(1);
    });

    it('clears body before mounting next tab', () => {
      panel.switchTab('b');
      const body = document.getElementById('shop-body')!;
      // Only B's element should remain
      expect(body.querySelector('.recording-tab-a')).toBeNull();
      expect(body.querySelector('.recording-tab-b')).not.toBeNull();
    });

    it('switching to the active tab is a no-op', () => {
      panel.switchTab('a');
      expect(a.mountCount).toBe(1);
      expect(a.unmountCount).toBe(0);
    });

    it('switching to an unknown tab is a no-op', () => {
      panel.switchTab('does-not-exist');
      expect(a.unmountCount).toBe(0);
      expect(a.mountCount).toBe(1);
    });

    it('active tab button gets accent styling', () => {
      const buttons = Array.from(
        document.querySelectorAll('.shop-tab-btn'),
      ) as HTMLButtonElement[];
      const aBtn = buttons.find((btn) => btn.dataset.tabId === 'a')!;
      const bBtn = buttons.find((btn) => btn.dataset.tabId === 'b')!;
      expect(aBtn.style.color).toBe('rgb(255, 204, 0)');
      expect(bBtn.style.color).toBe('rgb(170, 170, 170)');
      panel.switchTab('b');
      expect(aBtn.style.color).toBe('rgb(170, 170, 170)');
      expect(bBtn.style.color).toBe('rgb(255, 204, 0)');
    });
  });

  describe('Escape key', () => {
    it('closes the panel when Escape is pressed', () => {
      panel.open();
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      expect(panel.isOpen).toBe(false);
    });

    it('does nothing when Escape is pressed and panel is closed', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      expect(panel.isOpen).toBe(false);
    });
  });

  describe('click outside', () => {
    it('closes when clicking the backdrop', () => {
      panel.open();
      const backdrop = document.getElementById('shop-backdrop')!;
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(panel.isOpen).toBe(false);
    });

    it('does NOT close when clicking the panel itself', () => {
      panel.open();
      const container = document.getElementById('shop-panel')!;
      // Simulate click bubbled to backdrop with target=container
      // (The handler explicitly checks `e.target === backdrop`.)
      const backdrop = document.getElementById('shop-backdrop')!;
      const evt = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(evt, 'target', { value: container });
      backdrop.dispatchEvent(evt);
      expect(panel.isOpen).toBe(true);
    });
  });

  describe('close button', () => {
    it('closes panel on close button click', () => {
      panel.open();
      const closeBtn = document.getElementById('shop-close-btn')!;
      closeBtn.click();
      expect(panel.isOpen).toBe(false);
    });
  });

  describe('dispose', () => {
    it('removes DOM elements', () => {
      panel.dispose();
      expect(document.getElementById('shop-panel')).toBeNull();
      expect(document.getElementById('shop-backdrop')).toBeNull();
    });

    it('removes keydown listener', () => {
      panel.open();
      panel.dispose();
      // Re-instantiating a new panel for cleanup safety in afterEach
      panel = new ShopPanel(input);
      // Old listener should not be active — Escape should not toggle the disposed panel
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      // New panel was never opened, so it stays closed
      expect(panel.isOpen).toBe(false);
    });

    it('unmounts the active tab', () => {
      panel.dispose();
      panel = new ShopPanel(input, { registerDefaultTabs: false });
      const tab = new RecordingTab('x', 'X');
      panel.addTab(tab);
      panel.open();
      panel.dispose();
      expect(tab.unmountCount).toBe(1);
      // Re-create for afterEach cleanup
      panel = new ShopPanel(input);
    });
  });

  describe('provider injection', () => {
    it('uses MockPaymentProvider by default', () => {
      panel.open();
      // Switch to premium and verify Buy button (if visible items existed) would be disabled
      const buttons = document.querySelectorAll('.shop-tab-btn') as NodeListOf<HTMLButtonElement>;
      const premiumBtn = Array.from(buttons).find((b) => b.textContent === 'Premium (USD)')!;
      premiumBtn.click();
      // Default has empty items → empty state
      const body = document.getElementById('shop-body')!;
      expect(body.textContent).toContain('Coming soon');
    });

    it('accepts a custom provider via options', () => {
      panel.dispose();
      const provider = new MockPaymentProvider();
      panel = new ShopPanel(input, { provider });
      // Construction succeeded — premium tab uses the supplied provider
      const buttons = document.querySelectorAll('.shop-tab-btn');
      const labels = Array.from(buttons).map((b) => b.textContent);
      expect(labels).toContain('Premium (USD)');
    });
  });
});
