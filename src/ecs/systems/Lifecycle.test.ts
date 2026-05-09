/**
 * Integration test for the full death → respawn lifecycle (issue #134).
 *
 * Drives the real `healthSystemTick` → `processDeaths` → `processRespawns`
 * chain — the same wiring main.ts runs every fixedUpdate. Mock points are
 * limited to the GameWorld wrapper (no real Rapier physics — we don't need
 * any kinematic solver to verify ECS state transitions).
 *
 * The lifecycle this validates:
 *   1. Entity is alive at full HP, not DeadTag'd.
 *   2. `queueDamage` enough to drop HP to 0.
 *   3. `healthSystemTick` adds DeadTag + RespawnPending(180), returns
 *      the eid in `died`.
 *   4. `processDeaths(died)` emits a DeathEvent and resets per-tick state.
 *   5. Tick the loop 180 more times (the respawn delay). At tick 180,
 *      `healthSystemTick` returns the eid in `respawned`.
 *   6. `processRespawns(respawned)` teleports + restores + emits
 *      RespawnEvent.
 *   7. The entity is alive at the spawn point with full HP/Stamina,
 *      Longsword equipped.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createWorld,
  addEntity,
  addComponent,
  hasComponent,
  type IWorld,
} from 'bitecs';
import {
  Position,
  PreviousPosition,
  Rotation,
  Player,
  Health,
  Stamina,
  Velocity,
  CombatStateComp,
  CombatStateComponent,
  Score,
  DeadTag,
  RespawnPending,
} from '../components';
import {
  healthSystemTick,
  queueDamage,
  resetHealthTracking,
} from './HealthSystem';
import { processDeaths } from './processDeaths';
import { processRespawns } from './processRespawns';
import {
  registerSpawnPoint,
  clearSpawnPoints,
} from '../../world/SpawnPoints';
import { EventBus } from '../../events/EventBus';
import {
  inventoryRegistry,
  initInventory,
  resetInventorySystem,
} from './InventorySystem';
import { fsmRegistry, createFSM } from '../../combat/CombatFSM';
import { weaponConfigs } from '../../weapons/WeaponConfig';
import { resetMovementState } from './MovementSystem';
import { resetStaminaTracking } from './StaminaSystem';
import { resetFixedTick, advanceFixedTick } from '../../core/tickCounter';

// Force weapon configs to register
import '../../weapons/longsword';
import '../../weapons/dagger';

const RESPAWN_DELAY_TICKS = 180;

function makeWorld(ecs: IWorld): any {
  return {
    ecs,
    scene: null,
    physicsWorld: null,
    rapier: null,
    playerEntity: 0,
  };
}

function makeAlivePlayer(ecs: IWorld): number {
  const eid = addEntity(ecs);
  addComponent(ecs, Player, eid);
  addComponent(ecs, Position, eid);
  addComponent(ecs, PreviousPosition, eid);
  addComponent(ecs, Rotation, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Stamina, eid);
  addComponent(ecs, CombatStateComp, eid);
  addComponent(ecs, CombatStateComponent, eid);
  addComponent(ecs, Score, eid);

  Health.current[eid] = 100;
  Health.max[eid] = 100;
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;
  Position.x[eid] = 5;
  Position.y[eid] = 0.1;
  Position.z[eid] = 5;
  PreviousPosition.x[eid] = 5;
  PreviousPosition.y[eid] = 0.1;
  PreviousPosition.z[eid] = 5;

  // Set up FSM + inventory the way main.ts does
  createFSM(eid, weaponConfigs['Longsword']);
  initInventory(eid, ['Longsword'], 'Longsword', 'Longsword');

  return eid;
}

/**
 * Run one fixed-update tick of the death-pipeline systems in the same
 * order main.ts runs them. Damage queueing happens BEFORE this is called.
 */
function runTick(world: any): { died: number[]; respawned: number[] } {
  advanceFixedTick();
  const { died, respawned } = healthSystemTick(world.ecs);
  processDeaths(died, world);
  processRespawns(respawned, world);
  EventBus.flush();
  return { died, respawned };
}

describe('Lifecycle: alive → fatal damage → DeathEvent → 180 ticks → RespawnEvent', () => {
  let ecs: IWorld;
  let world: any;

  beforeEach(() => {
    ecs = createWorld();
    world = makeWorld(ecs);
    clearSpawnPoints();
    EventBus.clear();
    fsmRegistry.clear();
    resetMovementState();
    resetInventorySystem();
    resetStaminaTracking();
    resetHealthTracking();
    resetFixedTick();

    // Register one spawn point — non-trivial coords so we can assert
    // teleport happened.
    registerSpawnPoint({
      id: 1,
      position: { x: -10, y: 0.1, z: 10 },
      yaw: Math.PI / 4,
    });
  });

  it('runs the full alive → dead → respawn loop end-to-end', () => {
    const eid = makeAlivePlayer(ecs);

    // Sanity: start state.
    expect(hasComponent(ecs, DeadTag, eid)).toBe(false);
    expect(Health.current[eid]).toBe(100);

    // Capture every event emitted across the loop.
    const deaths: any[] = [];
    const respawns: any[] = [];
    EventBus.on('DeathEvent', (p) => deaths.push(p));
    EventBus.on('RespawnEvent', (p) => respawns.push(p));

    // 1. Damage to 0 HP.
    queueDamage({ target: eid, amount: 200 });
    const { died: t1Died, respawned: t1Respawned } = runTick(world);

    expect(t1Died).toEqual([eid]);
    expect(t1Respawned).toEqual([]);
    expect(Health.current[eid]).toBe(0);
    expect(hasComponent(ecs, DeadTag, eid)).toBe(true);
    expect(hasComponent(ecs, RespawnPending, eid)).toBe(true);
    expect(RespawnPending.ticksRemaining[eid]).toBe(RESPAWN_DELAY_TICKS);
    expect(deaths).toHaveLength(1);
    expect(deaths[0].victimEid).toBe(eid);
    expect(Score.deaths[eid]).toBe(1);

    // 2. Tick down the timer. Each tick decrements RespawnPending by 1.
    // After (RESPAWN_DELAY_TICKS - 1) more ticks the counter sits at 1;
    // the next tick takes it to 0 and surfaces the eid in `respawned`.
    for (let i = 0; i < RESPAWN_DELAY_TICKS - 1; i++) {
      const { died, respawned } = runTick(world);
      expect(died).toEqual([]);
      expect(respawned).toEqual([]);
      // Still dead, still HP=0.
      expect(hasComponent(ecs, DeadTag, eid)).toBe(true);
      expect(Health.current[eid]).toBe(0);
    }

    // Counter should now be 1 (was 180, decremented 179 times).
    expect(RespawnPending.ticksRemaining[eid]).toBe(1);

    // 3. Final tick fires the respawn.
    const { died: tFinalDied, respawned: tFinalRespawned } = runTick(world);
    expect(tFinalDied).toEqual([]);
    expect(tFinalRespawned).toEqual([eid]);

    // 4. Post-respawn invariants.
    expect(hasComponent(ecs, DeadTag, eid)).toBe(false);
    expect(hasComponent(ecs, RespawnPending, eid)).toBe(false);
    expect(Health.current[eid]).toBe(Health.max[eid]);
    expect(Stamina.current[eid]).toBe(Stamina.max[eid]);

    // Teleported to the registered spawn point.
    expect(Position.x[eid]).toBeCloseTo(-10, 5);
    expect(Position.y[eid]).toBeCloseTo(0.1, 5);
    expect(Position.z[eid]).toBeCloseTo(10, 5);
    expect(PreviousPosition.x[eid]).toBe(Position.x[eid]);
    expect(PreviousPosition.y[eid]).toBe(Position.y[eid]);
    expect(PreviousPosition.z[eid]).toBe(Position.z[eid]);
    expect(Rotation.y[eid]).toBeCloseTo(Math.PI / 4, 5);

    // Longsword equipped (default starter).
    const inv = inventoryRegistry.get(eid);
    expect(inv?.equippedWeapon).toBe('Longsword');

    // Exactly one DeathEvent and one RespawnEvent — no extras across the loop.
    expect(deaths).toHaveLength(1);
    expect(respawns).toHaveLength(1);
    expect(respawns[0]).toMatchObject({
      eid,
      spawnPointId: 1,
    });
  });

  it('ticks counter exactly 180 times (off-by-one regression check)', () => {
    const eid = makeAlivePlayer(ecs);
    queueDamage({ target: eid, amount: 200 });
    runTick(world); // tick 1: dies, counter set to 180

    let respawnTickIndex = -1;
    // Run up to 200 more ticks; we expect respawn at exactly tick 180.
    for (let i = 1; i <= 200; i++) {
      const { respawned } = runTick(world);
      if (respawned.length > 0) {
        respawnTickIndex = i;
        break;
      }
    }
    expect(respawnTickIndex).toBe(RESPAWN_DELAY_TICKS);
  });

  it('a second damage event after respawn does NOT immediately re-kill', () => {
    const eid = makeAlivePlayer(ecs);

    // Kill once, run through the full delay.
    queueDamage({ target: eid, amount: 200 });
    runTick(world);
    for (let i = 0; i < RESPAWN_DELAY_TICKS; i++) {
      runTick(world);
    }
    // Now alive, full HP.
    expect(Health.current[eid]).toBe(100);
    expect(hasComponent(ecs, DeadTag, eid)).toBe(false);

    // Take some chip damage. Should NOT add DeadTag.
    queueDamage({ target: eid, amount: 30 });
    const { died } = runTick(world);
    expect(died).toEqual([]);
    expect(Health.current[eid]).toBe(70);
    expect(hasComponent(ecs, DeadTag, eid)).toBe(false);
  });

  it('Score.deaths persists across respawn (not reset)', () => {
    const eid = makeAlivePlayer(ecs);
    Score.deaths[eid] = 4; // simulate previous lives

    queueDamage({ target: eid, amount: 200 });
    runTick(world);
    expect(Score.deaths[eid]).toBe(5); // bumped on death

    // Run through respawn.
    for (let i = 0; i < RESPAWN_DELAY_TICKS; i++) {
      runTick(world);
    }
    expect(Score.deaths[eid]).toBe(5); // not reset on respawn
  });

  it('Score.goldThisLife is reset on death and stays at 0 through respawn', () => {
    const eid = makeAlivePlayer(ecs);
    Score.goldThisLife[eid] = 250;

    queueDamage({ target: eid, amount: 200 });
    runTick(world);
    expect(Score.goldThisLife[eid]).toBe(0); // reset by processDeaths

    for (let i = 0; i < RESPAWN_DELAY_TICKS; i++) {
      runTick(world);
    }
    expect(Score.goldThisLife[eid]).toBe(0); // processRespawns doesn't touch it
  });

  it('damage that does not kill produces no DeathEvent', () => {
    const eid = makeAlivePlayer(ecs);
    const handler: any[] = [];
    EventBus.on('DeathEvent', (p) => handler.push(p));

    queueDamage({ target: eid, amount: 30 });
    const { died } = runTick(world);

    expect(died).toEqual([]);
    expect(Health.current[eid]).toBe(70);
    expect(handler).toHaveLength(0);
  });
});
