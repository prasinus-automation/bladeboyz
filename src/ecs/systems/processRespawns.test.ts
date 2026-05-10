/**
 * Tests for `processRespawns` (issue #134).
 *
 * Mirrors the `processDeaths.test.ts` structure: build a mock GameWorld,
 * stage entities through the death-side state (`DeadTag` + `RespawnPending`
 * are added by `healthSystemTick`, so we add them by hand here), then run
 * `processRespawns(respawned, world)` and assert on the post-state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import * as MovementSystemModule from './MovementSystem';
import { resetStaminaTracking } from './StaminaSystem';
import { resetFixedTick, advanceFixedTick } from '../../core/tickCounter';
import { CombatState } from '../../combat/states';

// Force weapon configs to register
import '../../weapons/longsword';
import '../../weapons/dagger';

function makeMockWorld(ecs: IWorld): any {
  return {
    ecs,
    scene: null,
    physicsWorld: null,
    rapier: null,
    playerEntity: 0,
  };
}

/**
 * Build a player-tagged entity that's already in the post-death state
 * (DeadTag set, RespawnPending = 0, HP 0). Mirrors what HealthSystem +
 * processDeaths leave on the entity by the time processRespawns runs.
 */
function makeRespawningPlayer(
  ecs: IWorld,
  opts: { startX?: number; startZ?: number } = {},
): number {
  const eid = addEntity(ecs);
  addComponent(ecs, Player, eid);
  addComponent(ecs, Position, eid);
  addComponent(ecs, PreviousPosition, eid);
  addComponent(ecs, Rotation, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Stamina, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, CombatStateComp, eid);
  addComponent(ecs, CombatStateComponent, eid);
  addComponent(ecs, Score, eid);
  addComponent(ecs, DeadTag, eid);
  addComponent(ecs, RespawnPending, eid);

  // Death-time state — HP 0, RespawnPending counter 0 (timer just fired).
  Health.current[eid] = 0;
  Health.max[eid] = 100;
  Stamina.current[eid] = 0;
  Stamina.max[eid] = 100;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Velocity.z[eid] = 0;
  // Pretend the entity died at (5, 0, 5) — non-zero so we can verify the
  // teleport actually moved it.
  Position.x[eid] = opts.startX ?? 5;
  Position.y[eid] = 0.5;
  Position.z[eid] = opts.startZ ?? 5;
  PreviousPosition.x[eid] = opts.startX ?? 5;
  PreviousPosition.y[eid] = 0.5;
  PreviousPosition.z[eid] = opts.startZ ?? 5;
  Rotation.y[eid] = 0;
  RespawnPending.ticksRemaining[eid] = 0;
  CombatStateComponent.state[eid] = CombatState.Idle;
  CombatStateComp.state[eid] = CombatState.Idle;

  return eid;
}

describe('processRespawns', () => {
  let ecs: IWorld;
  let world: any;

  beforeEach(() => {
    ecs = createWorld();
    world = makeMockWorld(ecs);
    clearSpawnPoints();
    EventBus.clear();
    fsmRegistry.clear();
    resetMovementState();
    resetInventorySystem();
    resetStaminaTracking();
    resetFixedTick();

    // Register one spawn point at a non-trivial location/orientation so
    // teleport assertions can compare against known expected values.
    registerSpawnPoint({
      id: 1,
      position: { x: -10, y: 0.1, z: 7 },
      yaw: Math.PI / 2,
    });
  });

  describe('happy path', () => {
    it('teleports Position to the registered spawn point', () => {
      const eid = makeRespawningPlayer(ecs);
      processRespawns([eid], world);

      expect(Position.x[eid]).toBeCloseTo(-10, 5);
      expect(Position.y[eid]).toBeCloseTo(0.1, 5);
      expect(Position.z[eid]).toBeCloseTo(7, 5);
    });

    it('updates PreviousPosition to match (no interpolation jitter)', () => {
      const eid = makeRespawningPlayer(ecs);
      processRespawns([eid], world);

      expect(PreviousPosition.x[eid]).toBeCloseTo(-10, 5);
      expect(PreviousPosition.y[eid]).toBeCloseTo(0.1, 5);
      expect(PreviousPosition.z[eid]).toBeCloseTo(7, 5);
      // The render-tick lerp(PreviousPosition, Position, alpha) must be a
      // no-op tween — both endpoints equal — to avoid a single-frame
      // visible glide from death location to spawn point.
      expect(PreviousPosition.x[eid]).toBe(Position.x[eid]);
      expect(PreviousPosition.y[eid]).toBe(Position.y[eid]);
      expect(PreviousPosition.z[eid]).toBe(Position.z[eid]);
    });

    it('writes Rotation.y to the spawn-point yaw', () => {
      const eid = makeRespawningPlayer(ecs);
      processRespawns([eid], world);

      expect(Rotation.y[eid]).toBeCloseTo(Math.PI / 2, 5);
    });

    it('restores Health to max', () => {
      const eid = makeRespawningPlayer(ecs);
      Health.max[eid] = 87;
      Health.current[eid] = 0;
      processRespawns([eid], world);

      expect(Health.current[eid]).toBe(Health.max[eid]);
      expect(Health.current[eid]).toBe(87);
    });

    it('restores Stamina to max', () => {
      const eid = makeRespawningPlayer(ecs);
      Stamina.max[eid] = 110;
      Stamina.current[eid] = 0;
      processRespawns([eid], world);

      expect(Stamina.current[eid]).toBe(Stamina.max[eid]);
      expect(Stamina.current[eid]).toBe(110);
    });

    it('removes DeadTag and RespawnPending', () => {
      const eid = makeRespawningPlayer(ecs);
      processRespawns([eid], world);

      expect(hasComponent(ecs, DeadTag, eid)).toBe(false);
      expect(hasComponent(ecs, RespawnPending, eid)).toBe(false);
    });

    it('emits a RespawnEvent with the correct payload', () => {
      const handler = vi.fn();
      EventBus.on('RespawnEvent', handler);
      const eid = makeRespawningPlayer(ecs);

      // Advance the tick so the payload's tick is non-zero.
      advanceFixedTick();
      advanceFixedTick();
      processRespawns([eid], world);
      EventBus.flush();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({
        eid,
        spawnPointId: 1,
        tick: 2,
      });
    });

    it('equips the default starter weapon (Longsword)', () => {
      const eid = makeRespawningPlayer(ecs);
      // Initialize inventory with no weapons — equipDefaultStarter should
      // add Longsword and equip it.
      initInventory(eid, [], null, null);

      processRespawns([eid], world);
      const inv = inventoryRegistry.get(eid);
      expect(inv?.equippedWeapon).toBe('Longsword');
      expect(inv?.weapons).toContain('Longsword');
    });

    it('equips Longsword even when inventory already has it', () => {
      const eid = makeRespawningPlayer(ecs);
      initInventory(eid, ['Longsword', 'Dagger'], 'Dagger', 'Dagger');
      // Need an FSM for equipWeapon to not warn — but allow Idle so it succeeds.
      createFSM(eid, weaponConfigs['Dagger']);

      processRespawns([eid], world);
      const inv = inventoryRegistry.get(eid);
      expect(inv?.equippedWeapon).toBe('Longsword');
      // No duplicate — equipDefaultStarter checks before pushing.
      expect(inv?.weapons.filter((w) => w === 'Longsword').length).toBe(1);
    });
  });

  describe('Rapier body teleport', () => {
    it('calls setNextKinematicTranslation on the registered body', () => {
      const eid = makeRespawningPlayer(ecs);

      const setNext = vi.fn();
      const fakeBody = {
        setNextKinematicTranslation: setNext,
        translation: () => ({ x: 0, y: 0, z: 0 }),
      } as any;
      const fakeCollider = { handle: 0 } as any;
      MovementSystemModule.registerPhysicsBody(eid, fakeBody, fakeCollider);

      processRespawns([eid], world);
      expect(setNext).toHaveBeenCalledWith({ x: -10, y: 0.1, z: 7 });
    });

    it('does not throw when there is no registered body', () => {
      const eid = makeRespawningPlayer(ecs);
      // No registerPhysicsBody call.
      expect(() => processRespawns([eid], world)).not.toThrow();
      // Still teleports the ECS-side state.
      expect(Position.x[eid]).toBeCloseTo(-10, 5);
    });
  });

  describe('null spawn-point case', () => {
    it('logs a warning and skips when registry is empty', () => {
      clearSpawnPoints();
      const eid = makeRespawningPlayer(ecs);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      processRespawns([eid], world);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      // Still dead — DeadTag NOT removed.
      expect(hasComponent(ecs, DeadTag, eid)).toBe(true);
      expect(hasComponent(ecs, RespawnPending, eid)).toBe(true);
      // Position untouched (still at "death" location).
      expect(Position.x[eid]).toBe(5);

      warnSpy.mockRestore();
    });

    it('does not emit RespawnEvent on the null path', () => {
      clearSpawnPoints();
      const handler = vi.fn();
      EventBus.on('RespawnEvent', handler);
      const eid = makeRespawningPlayer(ecs);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      processRespawns([eid], world);
      EventBus.flush();

      expect(handler).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('multiple eids in one tick', () => {
    it('processes each independently', () => {
      const a = makeRespawningPlayer(ecs, { startX: 5, startZ: 5 });
      const b = makeRespawningPlayer(ecs, { startX: -5, startZ: -5 });

      const handler = vi.fn();
      EventBus.on('RespawnEvent', handler);

      processRespawns([a, b], world);
      EventBus.flush();

      expect(handler).toHaveBeenCalledTimes(2);
      expect(hasComponent(ecs, DeadTag, a)).toBe(false);
      expect(hasComponent(ecs, DeadTag, b)).toBe(false);
      expect(Position.x[a]).toBeCloseTo(-10, 5);
      expect(Position.x[b]).toBeCloseTo(-10, 5);
    });

    it('is a no-op when respawned is empty', () => {
      const handler = vi.fn();
      EventBus.on('RespawnEvent', handler);

      processRespawns([], world);
      EventBus.flush();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('safety / robustness', () => {
    it('does not double-restore HP on a second call (idempotent at end-state)', () => {
      const eid = makeRespawningPlayer(ecs);
      processRespawns([eid], world);
      // After one pass the entity is alive at full HP. Calling again is a
      // misuse (HealthSystem won't re-enqueue an already-respawned eid)
      // but it shouldn't damage the entity or throw.
      Health.current[eid] = 50; // simulate later damage
      // Re-enqueue manually: the eid no longer has DeadTag, but the system
      // doesn't gate on that — it processes whatever's passed in.
      processRespawns([eid], world);
      // HP is restored to max again, which is the documented behavior.
      expect(Health.current[eid]).toBe(Health.max[eid]);
    });

    it('handles an entity without Stamina component (Bot stub case)', () => {
      const eid = addEntity(ecs);
      addComponent(ecs, Player, eid);
      addComponent(ecs, Position, eid);
      addComponent(ecs, PreviousPosition, eid);
      addComponent(ecs, Rotation, eid);
      addComponent(ecs, Health, eid);
      // No Stamina, no Velocity.
      addComponent(ecs, DeadTag, eid);
      addComponent(ecs, RespawnPending, eid);
      Health.current[eid] = 0;
      Health.max[eid] = 50;

      expect(() => processRespawns([eid], world)).not.toThrow();
      expect(Health.current[eid]).toBe(50);
      expect(hasComponent(ecs, DeadTag, eid)).toBe(false);
    });
  });
});
