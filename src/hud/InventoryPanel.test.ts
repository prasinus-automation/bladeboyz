import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InventoryPanel } from './InventoryPanel';
import { InputManager } from '../input/InputManager';
import {
  initInventory,
  addWeapon,
  getInventory,
  clearAllInventories,
} from '../inventory/InventoryData';
import { registerWeapon, weaponConfigs } from '../weapons/WeaponConfig';
import { AttackDirection } from '../combat/directions';

// Register a test weapon config if not already registered
function ensureTestWeapons(): void {
  if (!weaponConfigs['TestSword']) {
    const dirs = [
      AttackDirection.Left,
      AttackDirection.Right,
      AttackDirection.Overhead,
      AttackDirection.Underhand,
      AttackDirection.Stab,
    ];
    const dirRecord = <T>(val: T): Record<AttackDirection, T> => {
      const r: any = {};
      for (const d of dirs) r[d] = val;
      return r;
    };

    registerWeapon({
      name: 'TestSword',
      damage: dirRecord({ head: 50, torso: 35, limb: 25 }),
      windup: dirRecord(20),
      release: dirRecord(15),
      recovery: dirRecord(25),
      comboRecovery: dirRecord(15),
      parryWindow: 10,
      staminaCost: { attack: 15, block: 10, parry: 5, feint: 8 },
      turncap: { windup: 0.04, release: 0.02, recovery: 0.05 },
      tracerPoints: [[0, 0, 0]],
      range: 2.0,
      blockStaminaDrain: 20,
      parryStunTicks: 30,
      hitStunTicks: 15,
    });

    registerWeapon({
      name: 'TestMace',
      damage: dirRecord({ head: 60, torso: 45, limb: 30 }),
      windup: dirRecord(25),
      release: dirRecord(12),
      recovery: dirRecord(30),
      comboRecovery: dirRecord(18),
      parryWindow: 8,
      staminaCost: { attack: 20, block: 12, parry: 6, feint: 10 },
      turncap: { windup: 0.03, release: 0.015, recovery: 0.04 },
      tracerPoints: [[0, 0, 0]],
      range: 1.8,
      blockStaminaDrain: 25,
      parryStunTicks: 35,
      hitStunTicks: 20,
    });
  }
}

// Minimal mock InputManager
function createMockInput(): InputManager {
  const canvas = document.createElement('canvas');
  return new InputManager(canvas);
}

describe('InventoryPanel', () => {
  let panel: InventoryPanel;
  let input: InputManager;
  const playerEid = 42;

  beforeEach(() => {
    clearAllInventories();
    ensureTestWeapons();
    initInventory(playerEid, 'TestSword');
    input = createMockInput();
    panel = new InventoryPanel(input, playerEid);
  });

  afterEach(() => {
    panel.dispose();
  });

  describe('open/close state', () => {
    it('starts closed', () => {
      expect(panel.isOpen).toBe(false);
    });

    it('opens when toggle() called while closed', () => {
      panel.toggle();
      expect(panel.isOpen).toBe(true);
    });

    it('closes when toggle() called while open', () => {
      panel.open();
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
      const el = document.getElementById('inventory-panel');
      expect(el).not.toBeNull();
      expect(el!.style.display).toBe('none');
    });

    it('panel is visible when open', () => {
      panel.open();
      const el = document.getElementById('inventory-panel')!;
      expect(el.style.display).toBe('block');
    });

    it('backdrop is visible when open', () => {
      panel.open();
      const el = document.getElementById('inventory-backdrop')!;
      expect(el.style.display).toBe('block');
    });

    it('panel is hidden after close', () => {
      panel.open();
      panel.close();
      const el = document.getElementById('inventory-panel')!;
      expect(el.style.display).toBe('none');
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
      // jsdom doesn't provide exitPointerLock by default — define it for this test
      (document as any).exitPointerLock = vi.fn();
      panel.open();
      expect(document.exitPointerLock).toHaveBeenCalled();
      delete (document as any).exitPointerLock;
    });
  });

  describe('weapon display', () => {
    it('shows owned weapons in the grid', () => {
      panel.open();
      const grid = document.getElementById('inventory-weapons-grid')!;
      const cards = grid.querySelectorAll('.inventory-weapon-card');
      expect(cards.length).toBe(1);
      expect(cards[0].textContent).toContain('TestSword');
    });

    it('shows equipped weapon as EQUIPPED', () => {
      panel.open();
      const grid = document.getElementById('inventory-weapons-grid')!;
      expect(grid.textContent).toContain('EQUIPPED');
    });

    it('shows multiple weapons after adding one', () => {
      addWeapon(playerEid, 'TestMace');
      panel.open();
      const grid = document.getElementById('inventory-weapons-grid')!;
      const cards = grid.querySelectorAll('.inventory-weapon-card');
      expect(cards.length).toBe(2);
    });

    it('highlights equipped weapon differently from unequipped', () => {
      addWeapon(playerEid, 'TestMace');
      panel.open();
      const grid = document.getElementById('inventory-weapons-grid')!;
      const cards = grid.querySelectorAll('.inventory-weapon-card') as NodeListOf<HTMLElement>;
      // First card (TestSword) is equipped — gold border
      expect(cards[0].style.borderColor).toContain('rgb(255, 204, 0)');
      // Second card (TestMace) is not equipped — dark border
      expect(cards[1].style.borderColor).not.toContain('rgb(255, 204, 0)');
    });
  });

  describe('equip click handler', () => {
    it('equips weapon on click', () => {
      addWeapon(playerEid, 'TestMace');
      panel.open();
      const grid = document.getElementById('inventory-weapons-grid')!;
      const cards = grid.querySelectorAll('.inventory-weapon-card') as NodeListOf<HTMLElement>;
      // Click the unequipped weapon (TestMace, second card)
      cards[1].click();
      const inv = getInventory(playerEid)!;
      expect(inv.equippedWeapon).toBe('TestMace');
    });

    it('refreshes display after equip', () => {
      addWeapon(playerEid, 'TestMace');
      panel.open();
      const grid = document.getElementById('inventory-weapons-grid')!;
      let cards = grid.querySelectorAll('.inventory-weapon-card') as NodeListOf<HTMLElement>;
      cards[1].click();
      // After click, grid should be refreshed — TestMace now EQUIPPED
      cards = grid.querySelectorAll('.inventory-weapon-card') as NodeListOf<HTMLElement>;
      expect(cards[1].textContent).toContain('EQUIPPED');
    });

    it('clicking equipped weapon does nothing', () => {
      panel.open();
      const grid = document.getElementById('inventory-weapons-grid')!;
      const cards = grid.querySelectorAll('.inventory-weapon-card') as NodeListOf<HTMLElement>;
      // Already equipped — should not have pointer cursor
      expect(cards[0].style.cursor).toBe('default');
    });
  });

  describe('keyboard interaction', () => {
    it('toggles on KeyI keydown', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI' }));
      expect(panel.isOpen).toBe(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI' }));
      expect(panel.isOpen).toBe(false);
    });

    it('closes on Escape when open', () => {
      panel.open();
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      expect(panel.isOpen).toBe(false);
    });

    it('does not close on Escape when already closed', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      expect(panel.isOpen).toBe(false);
    });
  });

  describe('gear slots', () => {
    it('displays 4 armor slot placeholders', () => {
      panel.open();
      const container = document.getElementById('inventory-panel')!;
      expect(container.textContent).toContain('Head');
      expect(container.textContent).toContain('Chest');
      expect(container.textContent).toContain('Legs');
      expect(container.textContent).toContain('Boots');
      expect(container.textContent).toContain('Coming Soon');
    });

    it('displays weapon gear slot with equipped weapon name', () => {
      panel.open();
      const slot = document.getElementById('gear-slot-weapon')!;
      expect(slot).not.toBeNull();
      expect(slot.textContent).toContain('Weapon');
      expect(slot.textContent).toContain('TestSword');
    });

    it('weapon gear slot has gold border when equipped', () => {
      panel.open();
      const slot = document.getElementById('gear-slot-weapon')! as HTMLElement;
      expect(slot.style.borderColor).toContain('rgb(255, 204, 0)');
    });

    it('weapon gear slot has full opacity when equipped', () => {
      panel.open();
      const slot = document.getElementById('gear-slot-weapon')! as HTMLElement;
      expect(slot.style.opacity).toBe('1');
    });

    it('weapon gear slot is visually distinct from placeholder slots', () => {
      panel.open();
      const slot = document.getElementById('gear-slot-weapon')! as HTMLElement;
      // Gold border, not the grey #333 of placeholders
      expect(slot.style.borderColor).toContain('rgb(255, 204, 0)');
      // Full opacity, not the 0.5 of placeholders
      expect(slot.style.opacity).not.toBe('0.5');
    });

    it('weapon gear slot appears before armor slots in the DOM', () => {
      panel.open();
      const container = document.getElementById('inventory-panel')!;
      const text = container.textContent!;
      const weaponIdx = text.indexOf('Weapon');
      const headIdx = text.indexOf('Head');
      expect(weaponIdx).toBeLessThan(headIdx);
    });

    it('weapon gear slot updates when a different weapon is equipped', () => {
      addWeapon(playerEid, 'TestMace');
      panel.open();
      // Equip TestMace via the weapons grid
      const grid = document.getElementById('inventory-weapons-grid')!;
      const cards = grid.querySelectorAll('.inventory-weapon-card') as NodeListOf<HTMLElement>;
      cards[1].click(); // TestMace
      // Check gear slot now shows TestMace
      const slot = document.getElementById('gear-slot-weapon')!;
      expect(slot.textContent).toContain('TestMace');
    });

    it('weapon gear slot shows "None" when no inventory exists', () => {
      clearAllInventories();
      panel.open();
      const slot = document.getElementById('gear-slot-weapon')!;
      expect(slot.textContent).toContain('None');
    });

    it('weapon gear slot shows range stat when config exists', () => {
      panel.open();
      const slot = document.getElementById('gear-slot-weapon')!;
      expect(slot.textContent).toContain('Range: 2');
    });

    it('weapon gear slot contains a weapon icon element', () => {
      panel.open();
      const slot = document.getElementById('gear-slot-weapon')!;
      // The gear-weapon-name class element should exist
      const nameEl = slot.querySelector('.gear-weapon-name');
      expect(nameEl).not.toBeNull();
      expect(nameEl!.textContent).toBe('TestSword');
    });
  });

  describe('close button', () => {
    it('closes panel on close button click', () => {
      panel.open();
      const closeBtn = document.getElementById('inventory-close-btn')!;
      closeBtn.click();
      expect(panel.isOpen).toBe(false);
    });
  });

  describe('dispose', () => {
    it('removes DOM elements', () => {
      panel.dispose();
      expect(document.getElementById('inventory-panel')).toBeNull();
      expect(document.getElementById('inventory-backdrop')).toBeNull();
    });

    it('removes keydown listener', () => {
      panel.dispose();
      // After dispose, KeyI should not toggle
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI' }));
      // Panel should remain closed since listener was removed
      expect(panel.isOpen).toBe(false);
    });
  });
});
