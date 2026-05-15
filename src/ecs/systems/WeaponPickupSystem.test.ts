/**
 * Tests for WeaponPickupSystem (#121).
 *
 * Coverage:
 *   - tryClaimPickup purity — calling twice with the same args returns
 *     equal events and mutates nothing
 *   - all 6 validation gates (missing pickup, missing component, claim
 *     cooldown, expired, distance, FSM not Idle)
 *   - happy-path KeyE pickup — inventory swap + scene removal + event
 *   - swap path — non-starter equipped → drop at feet with cooldown
 *   - starter-equipped → no drop, just swap
 *   - despawn sweep removes expired pickups + emits event
 *   - KeyE edge-detect (held-down doesn't re-fire)
 *   - resetWeaponPickupSystem clears prevKeyEDown
 *   - constants moved (DESPAWN_TICKS, BLINK_TICKS, PICKUP_RADIUS exported)
 *   - prompt-pickup parity — when PickupPrompt would show, tryClaimPickup
 *     returns non-null with same playerEid; when it'd hide, returns null
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
import { Direction } from '../../combat/directions';
import { fsmRegistry, createFSM, CombatInput } from '../../combat/CombatFSM';
import { weaponConfigs } from '../../weapons/WeaponConfig';
import {
  createWeaponPickup,
  removeWeaponPickup,
} from '../entities/createWeaponPickup';
import {
  pickupRegistry,
  resetPickupRegistry,
} from '../../inventory/PickupRegistry';
import { weaponIdToName } from './CombatSystem';
import {
  weaponModelFactories,
  registerWeaponModelFactory,
} from './InventorySystem';
import {
  inventoryRegistry,
  initInventory,
  resetInventorySystem,
  getInventory,
} from './InventorySystem';
import { weaponModelFactories as renderingFactories } from '../../rendering/WeaponModels';
import { EventBus } from '../../events/EventBus';
import type { GameWorld } from '../../core/types';
import {
  weaponPickupSystem,
  tryClaimPickup,
  findClosestPickup,
  resetWeaponPickupSystem,
  DESPAWN_TICKS,
  BLINK_TICKS,
  PICKUP_RADIUS,
  PICKUP_COOLDOWN_TICKS,
} from './WeaponPickupSystem';

// Force weapon configs to register
import '../../weapons/longsword';
import '../../weapons/dagger';
import '../../weapons/mace';
import '../../weapons/battleaxe';

// ── Test harness ─────────────────────────────────────────

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

/**
 * Minimal InputManager stub — we only care about isKeyDown('KeyE').
 * Reads `_keyEDown` so tests can flip the press state per tick.
 */
class InputStub {
  _keyEDown = false;
  paused = false;
  isKeyDown(code: string): boolean {
    if (this.paused) return false;
    return code === 'KeyE' && this._keyEDown;
  }
  isMouseButtonDown(): boolean {
    return false;
  }
  getMouseDelta(): { x: number; y: number } {
    return { x: 0, y: 0 };
  }
}

function makePlayer(world: GameWorld, x: number, y: number, z: number): number {
  const eid = addEntity(world.ecs);
  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, Player, eid);
  addComponent(world.ecs, CombatStateComponent, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;
  CombatStateComponent.state[eid] = CombatState.Idle;
  CombatStateComponent.weaponId[eid] = 0;
  // Real FSM so equipWeapon's Idle gate has something to read
  createFSM(eid, weaponConfigs['Longsword']);
  // Mesh registry stub so equipWeapon's model-swap path is reachable.
  // We only need a `weapon_attach` bone with add/remove methods.
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
  return eid;
}

let savedWeaponIdToName: string[] = [];

function snapshotWeaponIdTable(): void {
  savedWeaponIdToName = [...weaponIdToName];
}

function restoreWeaponIdTable(): void {
  weaponIdToName.length = 0;
  weaponIdToName.push(...savedWeaponIdToName);
}

beforeEach(() => {
  resetPickupRegistry();
  resetInventorySystem();
  resetWeaponPickupSystem();
  fsmRegistry.clear();
  meshRegistry.clear();
  EventBus.clear();
  snapshotWeaponIdTable();
  // Ensure all four canonical weapons are in the id table
  weaponIdToName.length = 0;
  weaponIdToName.push('Longsword', 'Mace', 'Dagger', 'Battleaxe');
  // Wire the InventorySystem's weaponModelFactories from the rendering
  // factories so `equipWeapon` can mount the swapped model. The rendering
  // module auto-populates its registry at import time.
  for (const [name, factory] of Object.entries(renderingFactories)) {
    registerWeaponModelFactory(name, factory);
  }
});

afterEach(() => {
  restoreWeaponIdTable();
});

// ── Tests ────────────────────────────────────────────────

describe('WeaponPickupSystem — constants', () => {
  it('exports DESPAWN_TICKS = 1800 (30s @ 60Hz)', () => {
    expect(DESPAWN_TICKS).toBe(1800);
  });
  it('exports BLINK_TICKS = 300 (5s @ 60Hz)', () => {
    expect(BLINK_TICKS).toBe(300);
  });
  it('exports PICKUP_RADIUS = 1.5 (meters)', () => {
    expect(PICKUP_RADIUS).toBe(1.5);
  });
  it('exports PICKUP_COOLDOWN_TICKS = 30 (0.5s @ 60Hz)', () => {
    expect(PICKUP_COOLDOWN_TICKS).toBe(30);
  });
  it('PickupRenderer re-exports the same DESPAWN_TICKS', async () => {
    const re = await import('../../rendering/PickupRenderer');
    expect(re.DESPAWN_TICKS).toBe(DESPAWN_TICKS);
    expect(re.BLINK_TICKS).toBe(BLINK_TICKS);
    expect(re.PICKUP_RADIUS).toBe(PICKUP_RADIUS);
  });
});

describe('tryClaimPickup — pure validation', () => {
  let world: GameWorld;
  let playerEid: number;
  let pickupEid: number;

  beforeEach(() => {
    world = makeMinimalWorld();
    playerEid = makePlayer(world, 0, 0.1, 0);
    initInventory(playerEid, ['Longsword'], 'Longsword', 'Longsword');
    pickupEid = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 0.5, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 600,
    });
  });

  it('returns an event payload on success', () => {
    const event = tryClaimPickup(playerEid, pickupEid, 10, world);
    expect(event).not.toBeNull();
    expect(event!.playerEid).toBe(playerEid);
    expect(event!.pickupEid).toBe(pickupEid);
    expect(event!.weaponName).toBe('Mace');
    expect(event!.tick).toBe(10);
  });

  it('is pure — calling twice returns equal events and mutates nothing', () => {
    const sceneChildrenBefore = world.scene.children.length;
    const registrySizeBefore = pickupRegistry.size;
    const inventoryBefore = JSON.stringify(getInventory(playerEid));

    const ev1 = tryClaimPickup(playerEid, pickupEid, 10, world);
    const ev2 = tryClaimPickup(playerEid, pickupEid, 10, world);

    expect(ev1).toEqual(ev2);
    expect(world.scene.children.length).toBe(sceneChildrenBefore);
    expect(pickupRegistry.size).toBe(registrySizeBefore);
    expect(JSON.stringify(getInventory(playerEid))).toBe(inventoryBefore);
    expect(hasComponent(world.ecs, WeaponPickup, pickupEid)).toBe(true);
  });

  it('rejects when pickup is missing from registry', () => {
    expect(tryClaimPickup(playerEid, 99999, 10, world)).toBeNull();
  });

  it('rejects when pickup lacks WeaponPickup component (orphaned registry entry)', () => {
    // Remove the component but leave the registry entry — simulates a
    // partial-cleanup race. tryClaimPickup must refuse to claim a ghost.
    const orphanEid = addEntity(world.ecs);
    addComponent(world.ecs, Position, orphanEid);
    Position.x[orphanEid] = 0;
    Position.y[orphanEid] = 0.1;
    Position.z[orphanEid] = 0;
    pickupRegistry.set(orphanEid, {
      weaponName: 'Mace',
      group: new THREE.Group(),
      materials: [],
    });
    expect(tryClaimPickup(playerEid, orphanEid, 10, world)).toBeNull();
  });

  it('rejects before spawnTick (claim cooldown not elapsed)', () => {
    // Re-create the pickup with a future spawnTick (just-dropped scenario)
    removeWeaponPickup(world, pickupEid);
    pickupEid = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 0.5, y: 0.1, z: 0 },
      spawnTick: 50,
      despawnTick: 1000,
    });
    expect(tryClaimPickup(playerEid, pickupEid, 49, world)).toBeNull();
    expect(tryClaimPickup(playerEid, pickupEid, 50, world)).not.toBeNull();
  });

  it('rejects when currentTick >= despawnTick (expired)', () => {
    expect(tryClaimPickup(playerEid, pickupEid, 600, world)).toBeNull();
    expect(tryClaimPickup(playerEid, pickupEid, 700, world)).toBeNull();
  });

  it('rejects when 3D distance > PICKUP_RADIUS', () => {
    Position.x[playerEid] = 10;
    expect(tryClaimPickup(playerEid, pickupEid, 10, world)).toBeNull();
  });

  it('rejects when 3D Y-distance pushes it past PICKUP_RADIUS', () => {
    // Horizontal 1m + vertical 1.5m → ~1.8m > 1.5m
    Position.y[pickupEid] = 1.5;
    Position.x[pickupEid] = 1.0;
    expect(tryClaimPickup(playerEid, pickupEid, 10, world)).toBeNull();
  });

  it('accepts at exactly PICKUP_RADIUS (inclusive)', () => {
    Position.x[pickupEid] = 1.5;
    Position.y[pickupEid] = 0.1;
    Position.z[pickupEid] = 0;
    Position.x[playerEid] = 0;
    Position.y[playerEid] = 0.1;
    Position.z[playerEid] = 0;
    expect(tryClaimPickup(playerEid, pickupEid, 10, world)).not.toBeNull();
  });

  it('rejects when player FSM is not Idle', () => {
    const fsm = fsmRegistry.get(playerEid)!;
    fsm.transition(CombatInput.Attack, Direction.Stab);
    expect(fsm.state).not.toBe(CombatState.Idle);
    expect(tryClaimPickup(playerEid, pickupEid, 10, world)).toBeNull();
  });

  it('accepts when player has no FSM registered (defensive — equipWeapon also accepts)', () => {
    fsmRegistry.delete(playerEid);
    // Without a registered FSM, tryClaimPickup can't gate on Idle —
    // matches `equipWeapon`'s "no FSM = no gate" semantics. The KeyE
    // code path in main.ts always creates a FSM for the player, so this
    // is a defensive case.
    expect(tryClaimPickup(playerEid, pickupEid, 10, world)).not.toBeNull();
  });
});

describe('findClosestPickup', () => {
  let world: GameWorld;
  let playerEid: number;

  beforeEach(() => {
    world = makeMinimalWorld();
    playerEid = makePlayer(world, 0, 0.1, 0);
  });

  it('returns null when registry is empty', () => {
    expect(findClosestPickup(playerEid)).toBeNull();
  });

  it('returns the closest pickup when multiple are in range', () => {
    createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 1.4, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 1000,
    });
    const close = createWeaponPickup(world, {
      weaponName: 'Dagger',
      position: { x: 0.4, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 1000,
    });
    createWeaponPickup(world, {
      weaponName: 'Longsword',
      position: { x: 1.0, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 1000,
    });
    expect(findClosestPickup(playerEid)).toBe(close);
  });

  it('returns null when no pickup is within PICKUP_RADIUS', () => {
    createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 5, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 1000,
    });
    expect(findClosestPickup(playerEid)).toBeNull();
  });
});

describe('weaponPickupSystem — pickup happy path', () => {
  let world: GameWorld;
  let input: InputStub;
  let playerEid: number;
  let macePickup: number;

  beforeEach(() => {
    world = makeMinimalWorld();
    input = new InputStub();
    playerEid = makePlayer(world, 0, 0.1, 0);
    // Starter = Longsword (protected). Currently equipped = Longsword.
    initInventory(playerEid, ['Longsword'], 'Longsword', 'Longsword');
    macePickup = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 0.5, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 1000,
    });
  });

  it('claims the pickup on rising-edge KeyE press', () => {
    input._keyEDown = true;
    const { pickups } = weaponPickupSystem(world, 10, input as any, playerEid);
    expect(pickups).toHaveLength(1);
    expect(pickups[0].weaponName).toBe('Mace');
    expect(pickups[0].playerEid).toBe(playerEid);
  });

  it('updates inventory: Mace added, equipped becomes Mace', () => {
    input._keyEDown = true;
    weaponPickupSystem(world, 10, input as any, playerEid);
    const inv = getInventory(playerEid);
    expect(inv!.equippedWeapon).toBe('Mace');
    expect(inv!.weapons).toContain('Mace');
    // Longsword is the starter — not dropped when picking up over it
    expect(inv!.weapons).toContain('Longsword');
    expect(inv!.starterWeapon).toBe('Longsword');
  });

  it('removes the pickup entity + registry entry on success', () => {
    input._keyEDown = true;
    weaponPickupSystem(world, 10, input as any, playerEid);
    expect(pickupRegistry.has(macePickup)).toBe(false);
    expect(hasComponent(world.ecs, WeaponPickup, macePickup)).toBe(false);
  });

  it('emits WeaponPickup on EventBus', () => {
    const handler = vi.fn();
    EventBus.on('WeaponPickup', handler);
    input._keyEDown = true;
    weaponPickupSystem(world, 42, input as any, playerEid);
    EventBus.flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      playerEid,
      pickupEid: macePickup,
      weaponName: 'Mace',
      tick: 42,
    });
  });

  it('does not claim on subsequent ticks while KeyE is held (edge-detect)', () => {
    input._keyEDown = true;
    const tick1 = weaponPickupSystem(world, 10, input as any, playerEid);
    expect(tick1.pickups).toHaveLength(1);

    // Spawn another pickup so a second claim would be possible if
    // edge-detect were broken
    createWeaponPickup(world, {
      weaponName: 'Dagger',
      position: { x: 0.5, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 1000,
    });

    // KeyE still held — no rising edge, no claim
    const tick2 = weaponPickupSystem(world, 11, input as any, playerEid);
    expect(tick2.pickups).toHaveLength(0);

    // Release KeyE → next press fires again
    input._keyEDown = false;
    weaponPickupSystem(world, 12, input as any, playerEid);
    input._keyEDown = true;
    const tick4 = weaponPickupSystem(world, 13, input as any, playerEid);
    expect(tick4.pickups).toHaveLength(1);
    expect(tick4.pickups[0].weaponName).toBe('Dagger');
  });

  it('does not claim when KeyE is not pressed', () => {
    input._keyEDown = false;
    const { pickups } = weaponPickupSystem(world, 10, input as any, playerEid);
    expect(pickups).toHaveLength(0);
  });

  it('does not claim when FSM is not Idle (mid-Windup)', () => {
    const fsm = fsmRegistry.get(playerEid)!;
    fsm.transition(CombatInput.Attack, Direction.Stab);
    expect(fsm.state).not.toBe(CombatState.Idle);
    input._keyEDown = true;
    const { pickups } = weaponPickupSystem(world, 10, input as any, playerEid);
    expect(pickups).toHaveLength(0);
    expect(pickupRegistry.has(macePickup)).toBe(true);
  });

  it('does not claim when pickup is outside radius', () => {
    Position.x[macePickup] = 10;
    input._keyEDown = true;
    const { pickups } = weaponPickupSystem(world, 10, input as any, playerEid);
    expect(pickups).toHaveLength(0);
    expect(pickupRegistry.has(macePickup)).toBe(true);
  });

  it('does not claim before pickup spawnTick (cooldown not elapsed)', () => {
    removeWeaponPickup(world, macePickup);
    const future = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 0.5, y: 0.1, z: 0 },
      spawnTick: 50,
      despawnTick: 1000,
    });
    input._keyEDown = true;
    const { pickups } = weaponPickupSystem(world, 49, input as any, playerEid);
    expect(pickups).toHaveLength(0);
    expect(pickupRegistry.has(future)).toBe(true);
  });

  it('claims after cooldown elapses', () => {
    removeWeaponPickup(world, macePickup);
    const future = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 0.5, y: 0.1, z: 0 },
      spawnTick: 50,
      despawnTick: 1000,
    });
    input._keyEDown = true;
    const { pickups } = weaponPickupSystem(world, 50, input as any, playerEid);
    expect(pickups).toHaveLength(1);
    expect(pickups[0].pickupEid).toBe(future);
  });

  it('does not claim from despawned pickup', () => {
    input._keyEDown = true;
    // Use a tick AT despawnTick — should still be rejected
    const { pickups } = weaponPickupSystem(
      world,
      1000,
      input as any,
      playerEid,
    );
    expect(pickups).toHaveLength(0);
  });
});

describe('weaponPickupSystem — swap-on-pickup (drop current at feet)', () => {
  let world: GameWorld;
  let input: InputStub;
  let playerEid: number;
  let macePickup: number;

  beforeEach(() => {
    world = makeMinimalWorld();
    input = new InputStub();
    playerEid = makePlayer(world, 0, 0.1, 0);
    // Starter = Longsword, currently equipped = Mace (non-starter)
    initInventory(
      playerEid,
      ['Longsword', 'Mace'],
      'Mace',
      'Longsword',
    );
    macePickup = createWeaponPickup(world, {
      weaponName: 'Dagger',
      position: { x: 0.5, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 1000,
    });
  });

  it('spawns a fresh pickup at player feet with cooldown', () => {
    input._keyEDown = true;
    const sizeBefore = pickupRegistry.size;
    weaponPickupSystem(world, 100, input as any, playerEid);

    // Original Dagger pickup removed; new Mace pickup spawned at player feet
    expect(pickupRegistry.has(macePickup)).toBe(false);
    expect(pickupRegistry.size).toBe(sizeBefore); // -1 (Dagger) +1 (Mace dropped)

    // Find the new Mace pickup
    let newMaceEid: number | null = null;
    for (const [eid, data] of pickupRegistry) {
      if (data.weaponName === 'Mace') {
        newMaceEid = eid;
        break;
      }
    }
    expect(newMaceEid).not.toBeNull();
    // Spawned at player feet
    expect(Position.x[newMaceEid!]).toBeCloseTo(0);
    expect(Position.y[newMaceEid!]).toBeCloseTo(0.1);
    expect(Position.z[newMaceEid!]).toBeCloseTo(0);
    // spawnTick is currentTick + PICKUP_COOLDOWN_TICKS (so it's
    // invisible-to-claim for the cooldown window)
    expect(WeaponPickup.spawnTick[newMaceEid!]).toBe(100 + PICKUP_COOLDOWN_TICKS);
    // despawnTick is spawnTick + DESPAWN_TICKS
    expect(WeaponPickup.despawnTick[newMaceEid!]).toBe(
      100 + PICKUP_COOLDOWN_TICKS + DESPAWN_TICKS,
    );
  });

  it('emits a WeaponDrop event for the dropped current weapon', () => {
    const handler = vi.fn();
    EventBus.on('WeaponDrop', handler);
    input._keyEDown = true;
    weaponPickupSystem(world, 100, input as any, playerEid);
    EventBus.flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      sourceEid: playerEid,
      weaponName: 'Mace',
      tick: 100,
    });
  });

  it('removes the dropped weapon from inventory and equips the new one', () => {
    input._keyEDown = true;
    weaponPickupSystem(world, 100, input as any, playerEid);
    const inv = getInventory(playerEid);
    // Mace is dropped — out of inventory
    expect(inv!.weapons).not.toContain('Mace');
    // Dagger is in + equipped
    expect(inv!.weapons).toContain('Dagger');
    expect(inv!.equippedWeapon).toBe('Dagger');
    // Starter (Longsword) is still in inventory
    expect(inv!.weapons).toContain('Longsword');
    expect(inv!.starterWeapon).toBe('Longsword');
  });

  it('dropped pickup is NOT claimable during the cooldown window', () => {
    input._keyEDown = true;
    weaponPickupSystem(world, 100, input as any, playerEid);
    // Reset edge-detect so we can re-press on a later tick
    input._keyEDown = false;
    weaponPickupSystem(world, 101, input as any, playerEid);

    // At currentTick=129 (one tick short of cooldown elapsed) the dropped
    // pickup should be invisible to claim
    input._keyEDown = true;
    const result = weaponPickupSystem(world, 129, input as any, playerEid);
    expect(result.pickups).toHaveLength(0);
  });

  it('dropped pickup IS claimable after the cooldown', () => {
    input._keyEDown = true;
    weaponPickupSystem(world, 100, input as any, playerEid);
    // Player still standing on the dropped Mace; Mace is the only pickup
    // in range now. Drive edges manually.
    input._keyEDown = false;
    weaponPickupSystem(world, 101, input as any, playerEid);
    input._keyEDown = true;
    // currentTick = 100 + 30 = 130 (cooldown elapsed at the equality boundary)
    const result = weaponPickupSystem(world, 130, input as any, playerEid);
    expect(result.pickups).toHaveLength(1);
    expect(result.pickups[0].weaponName).toBe('Mace');
  });
});

describe('weaponPickupSystem — despawn sweep', () => {
  let world: GameWorld;
  let input: InputStub;
  let playerEid: number;

  beforeEach(() => {
    world = makeMinimalWorld();
    input = new InputStub();
    playerEid = makePlayer(world, 0, 0.1, 0);
    initInventory(playerEid, ['Longsword'], 'Longsword', 'Longsword');
  });

  it('removes pickups past despawnTick', () => {
    const a = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 10, y: 0.1, z: 0 }, // out of range so no claim
      spawnTick: 0,
      despawnTick: 100,
    });
    const b = createWeaponPickup(world, {
      weaponName: 'Dagger',
      position: { x: -10, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 200,
    });
    // currentTick = 150 → a is expired, b is alive
    const { despawns } = weaponPickupSystem(world, 150, input as any, playerEid);
    expect(despawns).toHaveLength(1);
    expect(despawns[0].pickupEid).toBe(a);
    expect(despawns[0].tick).toBe(150);
    expect(pickupRegistry.has(a)).toBe(false);
    expect(pickupRegistry.has(b)).toBe(true);
  });

  it('emits WeaponDespawn for each expired pickup', () => {
    const handler = vi.fn();
    EventBus.on('WeaponDespawn', handler);
    const a = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 10, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 100,
    });
    const b = createWeaponPickup(world, {
      weaponName: 'Dagger',
      position: { x: -10, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 100,
    });
    weaponPickupSystem(world, 200, input as any, playerEid);
    EventBus.flush();
    expect(handler).toHaveBeenCalledTimes(2);
    const eids = handler.mock.calls.map((c) => c[0].pickupEid).sort();
    expect(eids).toEqual([a, b].sort());
  });

  it('despawn is idempotent — same pickup removed only once', () => {
    createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 10, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 100,
    });
    const tick1 = weaponPickupSystem(world, 150, input as any, playerEid);
    expect(tick1.despawns).toHaveLength(1);
    const tick2 = weaponPickupSystem(world, 151, input as any, playerEid);
    expect(tick2.despawns).toHaveLength(0);
  });

  it('despawns at exact despawnTick (=)', () => {
    const a = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 10, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 100,
    });
    const { despawns } = weaponPickupSystem(world, 100, input as any, playerEid);
    expect(despawns).toHaveLength(1);
    expect(despawns[0].pickupEid).toBe(a);
  });

  it('does not despawn before despawnTick', () => {
    createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 10, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 100,
    });
    const { despawns } = weaponPickupSystem(world, 99, input as any, playerEid);
    expect(despawns).toHaveLength(0);
  });
});

describe('resetWeaponPickupSystem', () => {
  it('clears the prevKeyEDown latch (so the next press fires)', () => {
    const world = makeMinimalWorld();
    const input = new InputStub();
    const playerEid = makePlayer(world, 0, 0.1, 0);
    initInventory(playerEid, ['Longsword'], 'Longsword', 'Longsword');
    createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 0.5, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 1000,
    });
    input._keyEDown = true;
    weaponPickupSystem(world, 10, input as any, playerEid);
    // Without reset, holding KeyE doesn't re-fire — confirm
    createWeaponPickup(world, {
      weaponName: 'Dagger',
      position: { x: 0.5, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 1000,
    });
    const noReset = weaponPickupSystem(world, 11, input as any, playerEid);
    expect(noReset.pickups).toHaveLength(0);
    // With reset, prevKeyEDown=false so the held key re-fires next tick
    resetWeaponPickupSystem();
    const afterReset = weaponPickupSystem(world, 12, input as any, playerEid);
    expect(afterReset.pickups).toHaveLength(1);
  });
});

describe('weaponPickupSystem — prompt/pickup parity', () => {
  // The acceptance criterion is "when the prompt is showing, KeyE must
  // always succeed; when it's hidden, KeyE must always fail". We can't
  // import PickupPrompt directly here (it's a HUD module with DOM deps),
  // so we mirror the predicate logic and assert tryClaimPickup matches.

  let world: GameWorld;
  let playerEid: number;
  let pickupEid: number;

  beforeEach(() => {
    world = makeMinimalWorld();
    playerEid = makePlayer(world, 0, 0.1, 0);
    initInventory(playerEid, ['Longsword'], 'Longsword', 'Longsword');
    pickupEid = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 0.5, y: 0.1, z: 0 },
      spawnTick: 0,
      despawnTick: 1000,
    });
  });

  it('idle + in-range + cooldown-elapsed + not-expired → both prompt and pickup accept', () => {
    const fsm = fsmRegistry.get(playerEid)!;
    expect(fsm.state).toBe(CombatState.Idle);
    const distSq =
      (Position.x[pickupEid] - Position.x[playerEid]) ** 2 +
      (Position.y[pickupEid] - Position.y[playerEid]) ** 2 +
      (Position.z[pickupEid] - Position.z[playerEid]) ** 2;
    const inRange = distSq <= PICKUP_RADIUS * PICKUP_RADIUS;
    expect(inRange).toBe(true);
    expect(tryClaimPickup(playerEid, pickupEid, 10, world)).not.toBeNull();
  });

  it('not-idle → both prompt hides and pickup rejects', () => {
    const fsm = fsmRegistry.get(playerEid)!;
    fsm.transition(CombatInput.Attack, Direction.Stab);
    expect(fsm.state).not.toBe(CombatState.Idle);
    expect(tryClaimPickup(playerEid, pickupEid, 10, world)).toBeNull();
  });

  it('out-of-range → both prompt hides and pickup rejects', () => {
    Position.x[playerEid] = 10;
    expect(tryClaimPickup(playerEid, pickupEid, 10, world)).toBeNull();
  });
});
