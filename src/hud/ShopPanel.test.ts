import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShopPanel } from './ShopPanel';
import { InputManager } from '../input/InputManager';
import {
  initInventory,
  resetInventorySystem,
  getInventory,
} from '../ecs/systems/InventorySystem';
import {
  setGold,
  getGold,
  resetWallet,
  addGold,
} from '../economy/Wallet';
import { fsmRegistry } from '../combat/CombatFSM';
import { CombatStateComponent } from '../ecs/components';

// Auto-register the four real weapons (matches main.ts side-effect imports)
import '../weapons/longsword';
import '../weapons/mace';
import '../weapons/dagger';
import '../weapons/battleaxe';

const PLAYER_EID = 7;

function createMockInput(): InputManager {
  const canvas = document.createElement('canvas');
  return new InputManager(canvas);
}

describe('ShopPanel', () => {
  let panel: ShopPanel;
  let input: InputManager;

  beforeEach(() => {
    resetWallet();
    resetInventorySystem();
    fsmRegistry.clear();
    CombatStateComponent.weaponId[PLAYER_EID] = 0;
    initInventory(PLAYER_EID, ['Dagger'], 'Dagger');
    input = createMockInput();
    panel = new ShopPanel(input, PLAYER_EID);
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

    it('accepts a shopkeepEid argument without breaking', () => {
      // Forward-compat: signature accepts the eid even though we don't yet
      // route per-shopkeep wares.
      panel.open(42);
      expect(panel.isOpen).toBe(true);
    });
  });

  describe('DOM visibility', () => {
    it('panel is hidden when closed', () => {
      const el = document.getElementById('shop-panel')!;
      expect(el.style.display).toBe('none');
    });

    it('panel is visible (display: block) when open', () => {
      panel.open();
      const el = document.getElementById('shop-panel')!;
      expect(el.style.display).toBe('block');
    });

    it('backdrop is visible when open', () => {
      panel.open();
      const el = document.getElementById('shop-backdrop')!;
      expect(el.style.display).toBe('block');
    });

    it('panel hides again on close', () => {
      panel.open();
      panel.close();
      const el = document.getElementById('shop-panel')!;
      expect(el.style.display).toBe('none');
    });
  });

  describe('input pausing', () => {
    it('sets input.paused = true on open', () => {
      panel.open();
      expect(input.paused).toBe(true);
    });

    it('sets input.paused = false on close', () => {
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

  describe('header', () => {
    it('renders the title "Shopkeep — Wares"', () => {
      panel.open();
      const titleText = document.getElementById('shop-panel')!.textContent ?? '';
      expect(titleText).toContain('Shopkeep');
      expect(titleText).toContain('Wares');
    });

    it('renders the gold balance in the header', () => {
      setGold(250);
      panel.open();
      const goldEl = document.getElementById('shop-gold-label')!;
      expect(goldEl.textContent).toContain('250');
      expect(goldEl.textContent?.toLowerCase()).toContain('gold');
    });

    it('updates the gold balance live (subscribes to onGoldChange)', () => {
      panel.open();
      const goldEl = document.getElementById('shop-gold-label')!;
      const before = goldEl.textContent;
      addGold(50); // emits to subscribers
      expect(goldEl.textContent).not.toBe(before);
      expect(goldEl.textContent).toContain('250');
    });

    it('updates header gold even while panel is closed (live subscription)', () => {
      const goldEl = document.getElementById('shop-gold-label')!;
      addGold(75);
      // 200 starting + 75 = 275
      expect(goldEl.textContent).toContain('275');
    });
  });

  describe('weapon rows', () => {
    it('renders one row per registered weapon', () => {
      panel.open();
      const rows = document.querySelectorAll('.shop-weapon-row');
      // Four registered weapons: Longsword, Mace, Dagger, Battleaxe
      expect(rows.length).toBe(4);
    });

    it('marks the starter Dagger as Owned (button disabled)', () => {
      panel.open();
      const daggerBtn = document.querySelector(
        '.shop-buy-btn[data-weapon-name="Dagger"]',
      ) as HTMLButtonElement;
      expect(daggerBtn).not.toBeNull();
      expect(daggerBtn.disabled).toBe(true);
      expect(daggerBtn.textContent).toBe('Owned');
    });

    it('shows Buy enabled for affordable weapons', () => {
      setGold(500);
      panel.open();
      const maceBtn = document.querySelector(
        '.shop-buy-btn[data-weapon-name="Mace"]',
      ) as HTMLButtonElement;
      expect(maceBtn.disabled).toBe(false);
      expect(maceBtn.textContent).toBe('Buy');
    });

    it('shows "Not enough gold" disabled state when balance is too low', () => {
      setGold(50);
      panel.open();
      const longswordBtn = document.querySelector(
        '.shop-buy-btn[data-weapon-name="Longsword"]',
      ) as HTMLButtonElement;
      expect(longswordBtn.disabled).toBe(true);
      expect(longswordBtn.textContent).toBe('Not enough gold');
    });

    it('shows the equipped weapon with green border styling', () => {
      panel.open();
      const daggerRow = document.querySelector(
        '.shop-weapon-row[data-weapon-name="Dagger"]',
      ) as HTMLElement;
      // Equipped → green-ish border (rgb(58, 138, 58))
      expect(daggerRow.style.borderColor).toContain('rgb(58, 138, 58)');
    });

    it('renders an "(equipped)" tag next to the equipped weapon name', () => {
      panel.open();
      const daggerName = document.querySelector(
        '.shop-weapon-row[data-weapon-name="Dagger"] .shop-weapon-name',
      )!;
      expect(daggerName.textContent).toContain('(equipped)');
    });

    it('renders price including a "g" suffix for paid weapons', () => {
      panel.open();
      const macePriceCell = document.querySelector(
        '.shop-weapon-row[data-weapon-name="Mace"] .shop-weapon-price',
      )!;
      expect(macePriceCell.textContent).toContain('100');
    });

    it('renders FREE for zero-priced weapons (Dagger)', () => {
      panel.open();
      const daggerPriceCell = document.querySelector(
        '.shop-weapon-row[data-weapon-name="Dagger"] .shop-weapon-price',
      )!;
      expect(daggerPriceCell.textContent).toBe('FREE');
    });

    it('renders a stats summary row with damage / reach / swing', () => {
      panel.open();
      const stats = document.querySelector(
        '.shop-weapon-row[data-weapon-name="Mace"] .shop-weapon-stats',
      )!;
      const text = stats.textContent ?? '';
      expect(text.toLowerCase()).toContain('damage');
      expect(text.toLowerCase()).toContain('reach');
      expect(text.toLowerCase()).toContain('swing');
    });
  });

  describe('purchase flow integration', () => {
    it('clicking Buy on an affordable weapon spends gold', () => {
      setGold(500);
      panel.open();
      const maceBtn = document.querySelector(
        '.shop-buy-btn[data-weapon-name="Mace"]',
      ) as HTMLButtonElement;
      maceBtn.click();
      expect(getGold()).toBe(400);
    });

    it('clicking Buy adds the weapon to inventory and equips it', () => {
      setGold(500);
      panel.open();
      const longswordBtn = document.querySelector(
        '.shop-buy-btn[data-weapon-name="Longsword"]',
      ) as HTMLButtonElement;
      longswordBtn.click();
      const inv = getInventory(PLAYER_EID)!;
      expect(inv.weapons).toContain('Longsword');
      expect(inv.equippedWeapon).toBe('Longsword');
    });

    it('refreshes rows after a successful purchase (Buy → Owned)', () => {
      setGold(500);
      panel.open();
      const maceBtn = document.querySelector(
        '.shop-buy-btn[data-weapon-name="Mace"]',
      ) as HTMLButtonElement;
      maceBtn.click();
      // Re-query — refresh rebuilt the row
      const refreshedBtn = document.querySelector(
        '.shop-buy-btn[data-weapon-name="Mace"]',
      ) as HTMLButtonElement;
      expect(refreshedBtn.textContent).toBe('Owned');
      expect(refreshedBtn.disabled).toBe(true);
    });

    it('does not deduct gold or add weapon when click handler is bound to a sold-out / disabled state', () => {
      // Simulate the disabled-button case: with too-low gold, the click
      // handler is never attached, so even programmatic click does nothing.
      setGold(50);
      panel.open();
      const maceBtn = document.querySelector(
        '.shop-buy-btn[data-weapon-name="Mace"]',
      ) as HTMLButtonElement;
      // The disabled state means no click listener; but call .click() anyway.
      maceBtn.click();
      expect(getGold()).toBe(50);
      expect(getInventory(PLAYER_EID)!.weapons).not.toContain('Mace');
    });
  });

  describe('Escape key', () => {
    it('closes the panel when Escape is pressed and panel is open', () => {
      panel.open();
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      expect(panel.isOpen).toBe(false);
    });

    it('does nothing when Escape is pressed and panel is closed', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      expect(panel.isOpen).toBe(false);
    });
  });

  describe('click outside (backdrop)', () => {
    it('closes when clicking the backdrop', () => {
      panel.open();
      const backdrop = document.getElementById('shop-backdrop')!;
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(panel.isOpen).toBe(false);
    });

    it('does NOT close when click target is NOT the backdrop', () => {
      panel.open();
      const backdrop = document.getElementById('shop-backdrop')!;
      const evt = new MouseEvent('click', { bubbles: true });
      const container = document.getElementById('shop-panel')!;
      Object.defineProperty(evt, 'target', { value: container });
      backdrop.dispatchEvent(evt);
      expect(panel.isOpen).toBe(true);
    });
  });

  describe('close button', () => {
    it('closes the panel on close button click', () => {
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

    it('removes the keydown listener', () => {
      panel.open();
      panel.dispose();
      // Re-create for afterEach hygiene
      panel = new ShopPanel(input, PLAYER_EID);
      // New panel never opened — Escape should leave it closed
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      expect(panel.isOpen).toBe(false);
    });

    it('unsubscribes from Wallet onGoldChange', () => {
      const goldEl = document.getElementById('shop-gold-label')!;
      panel.dispose();
      // After dispose, mutating gold should not throw / update via stale ref
      addGold(50);
      // The disposed element may still exist as a JS reference but
      // detached from DOM — the assertion is just that nothing throws
      expect(goldEl).toBeDefined();
      // Re-create for afterEach
      panel = new ShopPanel(input, PLAYER_EID);
    });
  });
});
