/**
 * Tests for `dropEquippedWeapon` (#121).
 *
 * The function fills in the previously-empty stub at the end of
 * `InventorySystem.ts`. It's called from `processDeaths` for every dying
 * Player/Bot entity; this file tests the function in isolation against
 * the same world surface (real ECS world + Three.js scene + pickupRegistry).
 *
 * Lives in its own file because the existing `InventorySystem.test.ts` was
 * authored before the function had a body — it uses a mock-bone setup with
 * no Three.js scene, and `createWeaponPickup` (called from the dropped
 * weapon path) needs a real scene.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import {
  createWorld,
  addEntity,
  addComponent,
  hasComponent,
} from 'bitecs';
import {
  Position,
  WeaponPickup,
  CombatStateComponent,
  Player,
  meshRegistry,
} from '../components';
import { CombatState } from '../../combat/states';
import { fsmRegistry, createFSM } from '../../combat/CombatFSM';
import { weaponConfigs } from '../../weapons/WeaponConfig';
import {
  initInventory,
  resetInventorySystem,
  dropEquippedWeapon,
  getInventory,
  inventoryRegistry,
  registerWeaponModelFactory,
} from './InventorySystem';
import {
  pickupRegistry,
  resetPickupRegistry,
} from '../../inventory/PickupRegistry';
import { weaponIdToName } from './CombatSystem';
import { weaponModelFactories as renderingFactories } from '../../rendering/WeaponModels';
import { EventBus } from '../../events/EventBus';
import { resetFixedTick, advanceFixedTick } from '../../core/tickCounter';
import { DESPAWN_TICKS } from './WeaponPickupSystem';
import type { GameWorld } from '../../core/types';

// Force weapon configs to register
import '../../weapons/longsword';
import '../../weapons/dagger';
import '../../weapons/mace';
import '../../weapons/battleaxe';

function makeMinimalWorld(): GameWorld {
  return {
    ecs: createWorld(),
    scene: new THREE.Scene(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderer: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rapier: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    physicsWorld: {} as any,
    camera: new THREE.PerspectiveCamera(),
    playerEntity: 0,
  };
}

function makeArmedEntity(
  world: GameWorld,
  x: number,
  y: number,
  z: number,
): number {
  const eid = addEntity(world.ecs);
  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, Player, eid);
  addComponent(world.ecs, CombatStateComponent, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;
  CombatStateComponent.state[eid] = CombatState.Idle;
  // Mesh stub so equipWeapon's model-swap doesn't NPE on the re-equip path
  const bone: any = {
    children: [] as any[],
    add(c: any) {
      this.children.push(c);
    },
    remove(c: any) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
    },
  };
  meshRegistry.set(eid, {
    group: { position: { x: 0, y: 0, z: 0 } } as any,
    skeleton: {} as any,
    bones: { weapon_attach: bone as any },
  });
  createFSM(eid, weaponConfigs['Longsword']);
  return eid;
}

let savedWeaponIdToName: string[] = [];

beforeEach(() => {
  resetPickupRegistry();
  resetInventorySystem();
  fsmRegistry.clear();
  meshRegistry.clear();
  EventBus.clear();
  resetFixedTick();
  savedWeaponIdToName = [...weaponIdToName];
  weaponIdToName.length = 0;
  weaponIdToName.push('Longsword', 'Mace', 'Dagger', 'Battleaxe');
  for (const [name, factory] of Object.entries(renderingFactories)) {
    registerWeaponModelFactory(name, factory);
  }
});

afterEach(() => {
  weaponIdToName.length = 0;
  weaponIdToName.push(...savedWeaponIdToName);
});

describe('dropEquippedWeapon — no-op cases', () => {
  it('is a no-op when entity has no inventory', () => {
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 0, 0.1, 0);
    expect(() => dropEquippedWeapon(eid, world)).not.toThrow();
    expect(pickupRegistry.size).toBe(0);
  });

  it('is a no-op when nothing is equipped', () => {
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 0, 0.1, 0);
    initInventory(eid, ['Longsword'], null, 'Longsword');
    dropEquippedWeapon(eid, world);
    expect(pickupRegistry.size).toBe(0);
  });

  it('does NOT drop the starter weapon (equipped === starter)', () => {
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 0, 0.1, 0);
    initInventory(eid, ['Longsword'], 'Longsword', 'Longsword');
    dropEquippedWeapon(eid, world);
    expect(pickupRegistry.size).toBe(0);
    // Inventory unchanged
    const inv = getInventory(eid);
    expect(inv!.weapons).toEqual(['Longsword']);
    expect(inv!.equippedWeapon).toBe('Longsword');
  });

  it('does NOT emit WeaponDrop when starter would be dropped', () => {
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 0, 0.1, 0);
    initInventory(eid, ['Longsword'], 'Longsword', 'Longsword');
    const handler = vi.fn();
    EventBus.on('WeaponDrop', handler);
    dropEquippedWeapon(eid, world);
    EventBus.flush();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('dropEquippedWeapon — drop path', () => {
  it('spawns a WeaponPickup at the entity position with currentTick spawnTick', () => {
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 3, 0.1, -2);
    initInventory(eid, ['Longsword', 'Mace'], 'Mace', 'Longsword');
    advanceFixedTick(); // tick=1
    advanceFixedTick(); // tick=2

    dropEquippedWeapon(eid, world);

    expect(pickupRegistry.size).toBe(1);
    let pickupEid: number | null = null;
    for (const [eid2, data] of pickupRegistry) {
      expect(data.weaponName).toBe('Mace');
      pickupEid = eid2;
    }
    expect(pickupEid).not.toBeNull();
    // Spawned at the entity's position (feet)
    expect(Position.x[pickupEid!]).toBeCloseTo(3);
    expect(Position.y[pickupEid!]).toBeCloseTo(0.1);
    expect(Position.z[pickupEid!]).toBeCloseTo(-2);
    // spawnTick = currentTick (no cooldown for drop-on-death)
    expect(WeaponPickup.spawnTick[pickupEid!]).toBe(2);
    // despawnTick = spawnTick + DESPAWN_TICKS
    expect(WeaponPickup.despawnTick[pickupEid!]).toBe(2 + DESPAWN_TICKS);
  });

  it('removes the dropped weapon from inventory', () => {
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 0, 0.1, 0);
    initInventory(eid, ['Longsword', 'Mace'], 'Mace', 'Longsword');
    dropEquippedWeapon(eid, world);
    const inv = getInventory(eid);
    expect(inv!.weapons).not.toContain('Mace');
    expect(inv!.weapons).toContain('Longsword');
  });

  it('re-equips the starter weapon if it is still in inventory', () => {
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 0, 0.1, 0);
    initInventory(eid, ['Longsword', 'Mace'], 'Mace', 'Longsword');
    dropEquippedWeapon(eid, world);
    const inv = getInventory(eid);
    expect(inv!.equippedWeapon).toBe('Longsword');
  });

  it('leaves equippedWeapon=null if starter is not in inventory', () => {
    // Edge case: the entity's starter was removed by some other path
    // (no current production path does this, but defensive behavior
    // matters for future refactors).
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 0, 0.1, 0);
    initInventory(eid, ['Mace'], 'Mace', 'Longsword'); // starter Longsword, not in weapons
    dropEquippedWeapon(eid, world);
    const inv = getInventory(eid);
    expect(inv!.equippedWeapon).toBeNull();
    expect(inv!.weapons).not.toContain('Mace');
  });

  it('handles starterWeapon=null (no protected starter) — drops anyway', () => {
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 0, 0.1, 0);
    initInventory(eid, ['Mace'], 'Mace', null);
    dropEquippedWeapon(eid, world);
    const inv = getInventory(eid);
    expect(inv!.weapons).not.toContain('Mace');
    expect(inv!.equippedWeapon).toBeNull();
    expect(pickupRegistry.size).toBe(1);
  });

  it('emits WeaponDrop event on EventBus with correct payload', () => {
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 5, 0.1, 1);
    initInventory(eid, ['Longsword', 'Battleaxe'], 'Battleaxe', 'Longsword');
    advanceFixedTick();
    advanceFixedTick();
    advanceFixedTick();

    const handler = vi.fn();
    EventBus.on('WeaponDrop', handler);
    dropEquippedWeapon(eid, world);
    EventBus.flush();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      sourceEid: eid,
      weaponName: 'Battleaxe',
      tick: 3,
    });
    // Position values come from f32-backed bitECS components — use
    // approximate equality to absorb the 0.1 → 0.10000000149... drift.
    const pos = handler.mock.calls[0][0].position as [number, number, number];
    expect(pos[0]).toBeCloseTo(5);
    expect(pos[1]).toBeCloseTo(0.1);
    expect(pos[2]).toBeCloseTo(1);
  });

  it('adds the pickup mesh group to the scene', () => {
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 0, 0.1, 0);
    initInventory(eid, ['Longsword', 'Mace'], 'Mace', 'Longsword');
    const sceneSizeBefore = world.scene.children.length;
    dropEquippedWeapon(eid, world);
    expect(world.scene.children.length).toBe(sceneSizeBefore + 1);
  });

  it('attaches the WeaponPickup component to the spawned entity', () => {
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 0, 0.1, 0);
    initInventory(eid, ['Longsword', 'Mace'], 'Mace', 'Longsword');
    dropEquippedWeapon(eid, world);
    let pickupEid: number | null = null;
    for (const [eid2] of pickupRegistry) {
      pickupEid = eid2;
    }
    expect(hasComponent(world.ecs, WeaponPickup, pickupEid!)).toBe(true);
  });
});

describe('dropEquippedWeapon — death-pipeline scenarios', () => {
  it('a Player/Bot equipped with Mace (non-starter) drops Mace on death', () => {
    // Simulates the canonical death pipeline: HealthSystem → processDeaths
    // → dropEquippedWeapon. The HP/DeadTag/Score state has all been mutated
    // by the time dropEquippedWeapon runs, so we only need to model the
    // inventory + position state here.
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 2, 0.1, 4);
    initInventory(eid, ['Longsword', 'Mace'], 'Mace', 'Longsword');

    dropEquippedWeapon(eid, world);

    // 1. Mace pickup at corpse position
    let drop: { eid: number; weaponName: string } | null = null;
    for (const [pid, data] of pickupRegistry) {
      drop = { eid: pid, weaponName: data.weaponName };
    }
    expect(drop).not.toBeNull();
    expect(drop!.weaponName).toBe('Mace');
    expect(Position.x[drop!.eid]).toBeCloseTo(2);
    expect(Position.z[drop!.eid]).toBeCloseTo(4);

    // 2. Inventory updated: Mace gone, starter re-equipped
    const inv = inventoryRegistry.get(eid)!;
    expect(inv.weapons).toEqual(['Longsword']);
    expect(inv.equippedWeapon).toBe('Longsword');
  });

  it('equipped starter (Longsword) on death does NOT drop anything', () => {
    const world = makeMinimalWorld();
    const eid = makeArmedEntity(world, 0, 0.1, 0);
    initInventory(eid, ['Longsword'], 'Longsword', 'Longsword');
    dropEquippedWeapon(eid, world);
    expect(pickupRegistry.size).toBe(0);
    expect(inventoryRegistry.get(eid)!.equippedWeapon).toBe('Longsword');
  });
});
