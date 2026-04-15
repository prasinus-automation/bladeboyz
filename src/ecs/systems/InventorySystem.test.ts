/**
 * Tests for the InventorySystem — inventory management and weapon equipping.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent, type IWorld } from 'bitecs';
import { CombatStateComponent, Player, meshRegistry } from '../components';
import { CombatState } from '../../combat/states';
import { AttackDirection } from '../../combat/directions';
import { fsmRegistry, createFSM } from '../../combat/CombatFSM';
import { weaponConfigs, registerWeapon } from '../../weapons/WeaponConfig';
import type { WeaponConfig } from '../../weapons/WeaponConfig';
import { weaponIdToName } from './CombatSystem';
import {
  inventoryRegistry,
  initInventory,
  getInventory,
  equipWeapon,
  addWeaponToInventory,
  removeWeaponFromInventory,
  onEquip,
  offEquip,
  resetInventorySystem,
  registerWeaponModelFactory,
  weaponModelFactories,
} from './InventorySystem';

// ── Test weapon config factory ──────────────────────────

function createTestWeapon(name: string): WeaponConfig {
  const ticks = {
    [AttackDirection.Left]: 6,
    [AttackDirection.Right]: 6,
    [AttackDirection.Overhead]: 8,
    [AttackDirection.Underhand]: 7,
    [AttackDirection.Stab]: 5,
  };

  return {
    name,
    damage: {
      [AttackDirection.Left]: { head: 50, torso: 35, limb: 25 },
      [AttackDirection.Right]: { head: 50, torso: 35, limb: 25 },
      [AttackDirection.Overhead]: { head: 55, torso: 40, limb: 25 },
      [AttackDirection.Underhand]: { head: 45, torso: 35, limb: 25 },
      [AttackDirection.Stab]: { head: 45, torso: 40, limb: 20 },
    },
    windup: { ...ticks },
    release: {
      [AttackDirection.Left]: 4,
      [AttackDirection.Right]: 4,
      [AttackDirection.Overhead]: 5,
      [AttackDirection.Underhand]: 4,
      [AttackDirection.Stab]: 3,
    },
    recovery: {
      [AttackDirection.Left]: 12,
      [AttackDirection.Right]: 12,
      [AttackDirection.Overhead]: 15,
      [AttackDirection.Underhand]: 13,
      [AttackDirection.Stab]: 10,
    },
    comboRecovery: {
      [AttackDirection.Left]: 8,
      [AttackDirection.Right]: 8,
      [AttackDirection.Overhead]: 10,
      [AttackDirection.Underhand]: 9,
      [AttackDirection.Stab]: 6,
    },
    parryWindow: 6,
    staminaCost: { attack: 15, block: 10, parry: 5, feint: 20 },
    turncap: { windup: 0.08, release: 0.03, recovery: 0.05 },
    tracerPoints: [[0, 0.5, 0]],
    range: 1.4,
    blockStaminaDrain: 10,
    parryStunTicks: 40,
    hitStunTicks: 30,
  };
}

// ── Mock THREE.js objects ───────────────────────────────

class MockBone {
  children: any[] = [];
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  add(child: any): void {
    this.children.push(child);
  }

  remove(child: any): void {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
  }
}

class MockGroup {
  position = { x: 0, y: 0, z: 0 };
}

// ── Tests ────────────────────────────────────────────────

describe('InventorySystem', () => {
  let ecsWorld: IWorld;
  let eid: number;
  let swordConfig: WeaponConfig;
  let maceConfig: WeaponConfig;
  let weaponAttachBone: MockBone;

  beforeEach(() => {
    // Clear registries
    fsmRegistry.clear();
    meshRegistry.clear();
    resetInventorySystem();

    // Clear weaponModelFactories
    for (const key of Object.keys(weaponModelFactories)) {
      delete weaponModelFactories[key];
    }

    // Clear test weapons from weaponConfigs
    delete weaponConfigs['TestSword'];
    delete weaponConfigs['TestMace'];
    delete weaponConfigs['TestDagger'];

    // Reset weaponIdToName
    weaponIdToName.length = 0;
    weaponIdToName.push('TestSword', 'TestMace');

    // Setup ECS world
    ecsWorld = createWorld();
    eid = addEntity(ecsWorld);
    addComponent(ecsWorld, CombatStateComponent, eid);
    addComponent(ecsWorld, Player, eid);
    CombatStateComponent.state[eid] = CombatState.Idle;
    CombatStateComponent.weaponId[eid] = 0;

    // Register test weapons
    swordConfig = createTestWeapon('TestSword');
    maceConfig = createTestWeapon('TestMace');
    registerWeapon(swordConfig);
    registerWeapon(maceConfig);

    // Create FSM for entity
    createFSM(eid, swordConfig);

    // Setup mock mesh registry with weapon_attach bone
    weaponAttachBone = new MockBone('weapon_attach');
    meshRegistry.set(eid, {
      group: new MockGroup() as any,
      skeleton: {} as any,
      bones: { weapon_attach: weaponAttachBone as any },
    });

    // Register weapon model factories
    registerWeaponModelFactory('TestSword', () => ({ group: new MockGroup() as any }));
    registerWeaponModelFactory('TestMace', () => ({ group: new MockGroup() as any }));
  });

  // ── initInventory ────────────────────────────────────

  describe('initInventory', () => {
    it('should create inventory for entity', () => {
      initInventory(eid, ['TestSword', 'TestMace'], 'TestSword');
      const inv = inventoryRegistry.get(eid);
      expect(inv).toBeDefined();
      expect(inv!.weapons).toEqual(['TestSword', 'TestMace']);
      expect(inv!.equippedWeapon).toBe('TestSword');
    });

    it('should default equippedWeapon to null', () => {
      initInventory(eid, ['TestSword']);
      const inv = inventoryRegistry.get(eid);
      expect(inv!.equippedWeapon).toBeNull();
    });

    it('should create a copy of the weapons array', () => {
      const weapons = ['TestSword', 'TestMace'];
      initInventory(eid, weapons);
      weapons.push('Extra');
      expect(inventoryRegistry.get(eid)!.weapons).toHaveLength(2);
    });
  });

  // ── getInventory ─────────────────────────────────────

  describe('getInventory', () => {
    it('should return null for entity without inventory', () => {
      expect(getInventory(eid)).toBeNull();
    });

    it('should return a copy of inventory data', () => {
      initInventory(eid, ['TestSword', 'TestMace'], 'TestSword');
      const inv = getInventory(eid)!;
      expect(inv.weapons).toEqual(['TestSword', 'TestMace']);
      expect(inv.equippedWeapon).toBe('TestSword');

      // Mutating returned copy should not affect registry
      inv.weapons.push('Extra');
      expect(inventoryRegistry.get(eid)!.weapons).toHaveLength(2);
    });
  });

  // ── equipWeapon ──────────────────────────────────────

  describe('equipWeapon', () => {
    beforeEach(() => {
      initInventory(eid, ['TestSword', 'TestMace'], 'TestSword');
    });

    it('should equip a weapon from inventory', () => {
      const result = equipWeapon(eid, 'TestMace');
      expect(result).toBe(true);
      expect(inventoryRegistry.get(eid)!.equippedWeapon).toBe('TestMace');
    });

    it('should update FSM weapon config', () => {
      equipWeapon(eid, 'TestMace');
      const fsm = fsmRegistry.get(eid)!;
      expect(fsm.weaponConfig.name).toBe('TestMace');
    });

    it('should update CombatStateComponent.weaponId', () => {
      equipWeapon(eid, 'TestMace');
      expect(CombatStateComponent.weaponId[eid]).toBe(1); // TestMace is index 1
    });

    it('should reject weapon not in inventory', () => {
      const result = equipWeapon(eid, 'TestDagger');
      expect(result).toBe(false);
      expect(inventoryRegistry.get(eid)!.equippedWeapon).toBe('TestSword');
    });

    it('should reject unknown weapon', () => {
      const result = equipWeapon(eid, 'NonExistent');
      expect(result).toBe(false);
    });

    it('should reject when entity has no inventory', () => {
      const eid2 = addEntity(ecsWorld);
      const result = equipWeapon(eid2, 'TestSword');
      expect(result).toBe(false);
    });

    it('should reject when entity is not idle', () => {
      // Put FSM into Windup state
      const fsm = fsmRegistry.get(eid)!;
      fsm.transition(1 as any, AttackDirection.Left); // CombatInput.Attack
      expect(fsm.state).not.toBe(CombatState.Idle);

      const result = equipWeapon(eid, 'TestMace');
      expect(result).toBe(false);
      expect(inventoryRegistry.get(eid)!.equippedWeapon).toBe('TestSword');
    });

    it('should return true when equipping already-equipped weapon', () => {
      const result = equipWeapon(eid, 'TestSword');
      expect(result).toBe(true);
    });

    it('should swap weapon model on weapon_attach bone', () => {
      // Add initial weapon child
      const oldWeapon = { name: 'old' };
      weaponAttachBone.add(oldWeapon);
      expect(weaponAttachBone.children).toHaveLength(1);

      equipWeapon(eid, 'TestMace');

      // Old weapon removed, new one added
      expect(weaponAttachBone.children).toHaveLength(1);
      expect(weaponAttachBone.children[0]).not.toBe(oldWeapon);
    });

    it('should emit equip event', () => {
      const listener = vi.fn();
      onEquip(listener);

      equipWeapon(eid, 'TestMace');

      expect(listener).toHaveBeenCalledWith({
        entityId: eid,
        weaponName: 'TestMace',
        previousWeapon: 'TestSword',
      });
    });

    it('should not emit event when equipping same weapon', () => {
      const listener = vi.fn();
      onEquip(listener);

      equipWeapon(eid, 'TestSword');

      expect(listener).not.toHaveBeenCalled();
    });

    it('should work without meshRegistry entry (headless/testing)', () => {
      meshRegistry.clear();
      const result = equipWeapon(eid, 'TestMace');
      expect(result).toBe(true);
      expect(inventoryRegistry.get(eid)!.equippedWeapon).toBe('TestMace');
    });

    it('should work without FSM (still updates inventory)', () => {
      fsmRegistry.clear();
      const result = equipWeapon(eid, 'TestMace');
      expect(result).toBe(true);
      expect(inventoryRegistry.get(eid)!.equippedWeapon).toBe('TestMace');
    });
  });

  // ── addWeaponToInventory ─────────────────────────────

  describe('addWeaponToInventory', () => {
    beforeEach(() => {
      initInventory(eid, ['TestSword'], 'TestSword');
    });

    it('should add weapon to inventory', () => {
      const result = addWeaponToInventory(eid, 'TestMace');
      expect(result).toBe(true);
      expect(inventoryRegistry.get(eid)!.weapons).toContain('TestMace');
    });

    it('should reject duplicate weapon', () => {
      const result = addWeaponToInventory(eid, 'TestSword');
      expect(result).toBe(false);
    });

    it('should return false for entity without inventory', () => {
      const eid2 = addEntity(ecsWorld);
      expect(addWeaponToInventory(eid2, 'TestSword')).toBe(false);
    });
  });

  // ── removeWeaponFromInventory ────────────────────────

  describe('removeWeaponFromInventory', () => {
    beforeEach(() => {
      initInventory(eid, ['TestSword', 'TestMace'], 'TestSword');
    });

    it('should remove weapon from inventory', () => {
      const result = removeWeaponFromInventory(eid, 'TestMace');
      expect(result).toBe(true);
      expect(inventoryRegistry.get(eid)!.weapons).not.toContain('TestMace');
    });

    it('should unequip weapon if currently equipped', () => {
      const result = removeWeaponFromInventory(eid, 'TestSword');
      expect(result).toBe(true);
      expect(inventoryRegistry.get(eid)!.equippedWeapon).toBeNull();
    });

    it('should return false for weapon not in inventory', () => {
      expect(removeWeaponFromInventory(eid, 'TestDagger')).toBe(false);
    });

    it('should return false for entity without inventory', () => {
      const eid2 = addEntity(ecsWorld);
      expect(removeWeaponFromInventory(eid2, 'TestSword')).toBe(false);
    });
  });

  // ── Equip event listeners ────────────────────────────

  describe('equip events', () => {
    beforeEach(() => {
      initInventory(eid, ['TestSword', 'TestMace'], 'TestSword');
    });

    it('should support multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      onEquip(listener1);
      onEquip(listener2);

      equipWeapon(eid, 'TestMace');

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should support removing listeners', () => {
      const listener = vi.fn();
      onEquip(listener);
      offEquip(listener);

      equipWeapon(eid, 'TestMace');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ── resetInventorySystem ─────────────────────────────

  describe('resetInventorySystem', () => {
    it('should clear all inventory data and listeners', () => {
      initInventory(eid, ['TestSword']);
      const listener = vi.fn();
      onEquip(listener);

      resetInventorySystem();

      expect(inventoryRegistry.size).toBe(0);
      // Listeners should be cleared too — verify by equipping
      // (need to re-init since registry was cleared)
      initInventory(eid, ['TestSword', 'TestMace'], 'TestSword');
      equipWeapon(eid, 'TestMace');
      expect(listener).not.toHaveBeenCalled();
    });
  });
});

// ── InputManager paused flag tests ──────────────────────

describe('InputManager paused flag', () => {
  // Minimal mock to test the paused logic in isolation
  // We test the actual InputManager class behavior

  it('isKeyDown returns false when paused', async () => {
    // We need to import the real InputManager and test with a mock canvas
    const { InputManager } = await import('../../input/InputManager');

    // Create a minimal mock canvas element
    const canvas = {
      requestPointerLock: vi.fn(),
    } as any;

    // Mock document methods to prevent real event binding
    const originalAddEventListener = document.addEventListener;
    const listeners: Record<string, Function[]> = {};
    document.addEventListener = vi.fn((type: string, cb: Function) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(cb);
    }) as any;

    const inputMgr = new InputManager(canvas);

    // Simulate keydown
    if (listeners['keydown']) {
      listeners['keydown'].forEach(cb => cb({ code: 'KeyW' }));
    }

    expect(inputMgr.isKeyDown('KeyW')).toBe(true);

    inputMgr.paused = true;
    expect(inputMgr.isKeyDown('KeyW')).toBe(false);

    // Setting paused = true clears keysDown as a safety net (fixes stuck key bug #72)
    inputMgr.paused = false;
    expect(inputMgr.isKeyDown('KeyW')).toBe(false);

    // Restore
    document.addEventListener = originalAddEventListener;
  });

  it('isMouseButtonDown returns false when paused', async () => {
    const { InputManager } = await import('../../input/InputManager');

    const canvas = {
      requestPointerLock: vi.fn(),
    } as any;

    const originalAddEventListener = document.addEventListener;
    const listeners: Record<string, Function[]> = {};
    document.addEventListener = vi.fn((type: string, cb: Function) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(cb);
    }) as any;

    const inputMgr = new InputManager(canvas);

    // Simulate mousedown
    if (listeners['mousedown']) {
      listeners['mousedown'].forEach(cb => cb({ button: 0 }));
    }

    expect(inputMgr.isMouseButtonDown(0)).toBe(true);

    inputMgr.paused = true;
    expect(inputMgr.isMouseButtonDown(0)).toBe(false);

    // Setting paused = true clears mouseButtons as a safety net (fixes stuck key bug #72)
    inputMgr.paused = false;
    expect(inputMgr.isMouseButtonDown(0)).toBe(false);

    // Restore
    document.addEventListener = originalAddEventListener;
  });
});
