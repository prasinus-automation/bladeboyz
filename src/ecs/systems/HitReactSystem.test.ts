/**
 * Tests for HitReactSystem (clearing expired hit-react entries) and the
 * `populateHitReact` path inside DamageSystem.handleHit.
 *
 * Pure ECS / pure logic tests — no Three.js, no Rapier, no DOM.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createWorld,
  addEntity,
  addComponent,
  removeEntity,
  type IWorld,
} from 'bitecs';
import {
  CombatStateComponent,
  DamageEvent,
  Health,
  HitReactComp,
  Position,
  Rotation,
  Stamina,
} from '../components';
import { hitReactSystemTick } from './HitReactSystem';
import { DamageSystem } from './DamageSystem';
import { weaponConfigMap } from './TracerSystem';
import { AttackDirection } from '../../combat/directions';
import { CombatState } from '../../combat/states';
import {
  advanceFixedTick,
  getCurrentFixedTick,
  resetFixedTick,
} from '../../core/tickCounter';
import type { GameWorld } from '../../core/types';
import type { WeaponConfig } from '../../weapons/WeaponConfig';

function makeTestWeapon(): WeaponConfig {
  const ticks = {
    [AttackDirection.Left]: 6,
    [AttackDirection.Right]: 6,
    [AttackDirection.Overhead]: 8,
    [AttackDirection.Stab]: 5,
  };
  return {
    name: 'TestSword',
    damage: {
      [AttackDirection.Left]: { head: 50, torso: 35, limb: 25 },
      [AttackDirection.Right]: { head: 50, torso: 35, limb: 25 },
      [AttackDirection.Overhead]: { head: 60, torso: 40, limb: 25 },
      [AttackDirection.Stab]: { head: 45, torso: 40, limb: 20 },
    },
    windup: { ...ticks },
    release: {
      [AttackDirection.Left]: 4,
      [AttackDirection.Right]: 4,
      [AttackDirection.Overhead]: 5,
      [AttackDirection.Stab]: 3,
    },
    recovery: {
      [AttackDirection.Left]: 12,
      [AttackDirection.Right]: 12,
      [AttackDirection.Overhead]: 15,
      [AttackDirection.Stab]: 10,
    },
    comboRecovery: {
      [AttackDirection.Left]: 8,
      [AttackDirection.Right]: 8,
      [AttackDirection.Overhead]: 10,
      [AttackDirection.Stab]: 6,
    },
    parryWindow: 6,
    parryRecovery: 10,
    blockBreakStunTicks: 28,
    staminaCost: { attack: 15, block: 10, parry: 5 },
    turncap: { windup: 0.08, release: 0.03, recovery: 0.05, hitStun: 0.005 },
    tracerPoints: [[0, 0.5, 0]],
    range: 1.4,
    blockStaminaDrain: 10,
    parryStunTicks: 40,
    hitStunTicks: 30,
  };
}

/** Minimal GameWorld stub for DamageSystem (it only reads `world.ecs`). */
function makeStubWorld(ecs: IWorld): GameWorld {
  return { ecs } as unknown as GameWorld;
}

function spawnHitReactEntity(ecs: IWorld): number {
  const eid = addEntity(ecs);
  addComponent(ecs, HitReactComp, eid);
  return eid;
}

describe('HitReactSystem', () => {
  let ecs: IWorld;

  beforeEach(() => {
    ecs = createWorld();
    resetFixedTick();
  });

  it('does nothing for entities with active=0', () => {
    const eid = spawnHitReactEntity(ecs);
    HitReactComp.active[eid] = 0;
    HitReactComp.spawnedAtTick[eid] = 0;
    HitReactComp.durationTicks[eid] = 12;

    advanceFixedTick(); // tick 1
    hitReactSystemTick(ecs);
    expect(HitReactComp.active[eid]).toBe(0);
  });

  it('keeps active=1 while not yet expired', () => {
    const eid = spawnHitReactEntity(ecs);
    HitReactComp.active[eid] = 1;
    HitReactComp.spawnedAtTick[eid] = 5;
    HitReactComp.durationTicks[eid] = 12;

    // Currently at tick 5 (just spawned)
    for (let i = 0; i < 5; i++) advanceFixedTick();
    hitReactSystemTick(ecs);
    expect(HitReactComp.active[eid]).toBe(1);

    // Mid-window
    for (let i = 0; i < 6; i++) advanceFixedTick();
    hitReactSystemTick(ecs);
    expect(HitReactComp.active[eid]).toBe(1);
  });

  it('clears active=1 → 0 once currentTick >= spawnedAtTick + durationTicks', () => {
    const eid = spawnHitReactEntity(ecs);
    HitReactComp.active[eid] = 1;
    HitReactComp.spawnedAtTick[eid] = 0;
    HitReactComp.durationTicks[eid] = 12;

    // Advance to expiration boundary
    for (let i = 0; i < 12; i++) advanceFixedTick();
    expect(getCurrentFixedTick()).toBe(12);
    hitReactSystemTick(ecs);
    expect(HitReactComp.active[eid]).toBe(0);
  });

  it('clears past-due entries even if spawned far in the past', () => {
    const eid = spawnHitReactEntity(ecs);
    HitReactComp.active[eid] = 1;
    HitReactComp.spawnedAtTick[eid] = 10;
    HitReactComp.durationTicks[eid] = 5;

    for (let i = 0; i < 100; i++) advanceFixedTick();
    hitReactSystemTick(ecs);
    expect(HitReactComp.active[eid]).toBe(0);
  });

  it('processes multiple entities independently', () => {
    const a = spawnHitReactEntity(ecs);
    const b = spawnHitReactEntity(ecs);

    HitReactComp.active[a] = 1;
    HitReactComp.spawnedAtTick[a] = 0;
    HitReactComp.durationTicks[a] = 5; // expires fast

    HitReactComp.active[b] = 1;
    HitReactComp.spawnedAtTick[b] = 0;
    HitReactComp.durationTicks[b] = 100; // long lived

    for (let i = 0; i < 10; i++) advanceFixedTick();
    hitReactSystemTick(ecs);

    expect(HitReactComp.active[a]).toBe(0);
    expect(HitReactComp.active[b]).toBe(1);
  });
});

describe('DamageSystem populates HitReactComp on unblocked hit', () => {
  let ecs: IWorld;
  let world: GameWorld;
  let attacker: number;
  let target: number;
  let weapon: WeaponConfig;

  beforeEach(() => {
    ecs = createWorld();
    world = makeStubWorld(ecs);
    resetFixedTick();
    weapon = makeTestWeapon();
    weaponConfigMap.set(0, weapon);

    attacker = addEntity(ecs);
    addComponent(ecs, Position, attacker);
    addComponent(ecs, Rotation, attacker);
    addComponent(ecs, CombatStateComponent, attacker);
    Position.x[attacker] = 0;
    Position.y[attacker] = 0;
    Position.z[attacker] = 0;
    Rotation.y[attacker] = 0;
    CombatStateComponent.weaponId[attacker] = 0;
    CombatStateComponent.state[attacker] = CombatState.Release;

    target = addEntity(ecs);
    addComponent(ecs, Position, target);
    addComponent(ecs, Rotation, target);
    addComponent(ecs, Health, target);
    addComponent(ecs, Stamina, target);
    addComponent(ecs, CombatStateComponent, target);
    addComponent(ecs, HitReactComp, target);
    Health.current[target] = 100;
    Health.max[target] = 100;
    Stamina.current[target] = 100;
    Stamina.max[target] = 100;
    CombatStateComponent.state[target] = CombatState.Idle;
  });

  function queueDamageEvent(damage: number, attackDir: AttackDirection): number {
    const eventEid = addEntity(ecs);
    addComponent(ecs, DamageEvent, eventEid);
    DamageEvent.targetEid[eventEid] = target;
    DamageEvent.attackerEid[eventEid] = attacker;
    DamageEvent.damage[eventEid] = damage;
    DamageEvent.attackDirection[eventEid] = attackDir;
    DamageEvent.bodyRegion[eventEid] = 1; // torso
    DamageEvent.processed[eventEid] = 0;
    return eventEid;
  }

  it('marks active=1 with current fixed tick + duration', () => {
    Position.x[target] = 0;
    Position.y[target] = 0;
    Position.z[target] = 2; // target north of attacker
    advanceFixedTick();
    advanceFixedTick();
    advanceFixedTick(); // tick = 3

    queueDamageEvent(20, AttackDirection.Stab);
    DamageSystem(world, 1 / 60);

    expect(HitReactComp.active[target]).toBe(1);
    expect(HitReactComp.spawnedAtTick[target]).toBe(3);
    expect(HitReactComp.durationTicks[target]).toBe(12);
  });

  it('writes a unit direction vector in target-local space', () => {
    Position.x[target] = 0;
    Position.y[target] = 0;
    Position.z[target] = 2; // 2m straight ahead in world space
    Rotation.y[target] = 0; // target faces -Z (forward)

    queueDamageEvent(20, AttackDirection.Stab);
    DamageSystem(world, 1 / 60);

    // World direction (attacker→target) = (0, 0, +1).
    // Target's local frame: yaw=0 → world axes line up with body axes.
    // So local dirZ = +1 (the hit comes from behind because target faces -Z).
    const dx = HitReactComp.dirX[target];
    const dy = HitReactComp.dirY[target];
    const dz = HitReactComp.dirZ[target];
    expect(dx).toBeCloseTo(0, 5);
    expect(dy).toBeCloseTo(0, 5);
    expect(dz).toBeCloseTo(1, 5);
    // Unit length
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    expect(len).toBeCloseTo(1, 5);
  });

  it('rotates direction vector into target-local space when target is yawed', () => {
    Position.x[target] = 2; // attack from world +X
    Position.y[target] = 0;
    Position.z[target] = 0;
    // Yaw target by +90° around Y → its local +X axis points to world +Z.
    Rotation.y[target] = Math.PI / 2;

    queueDamageEvent(20, AttackDirection.Stab);
    DamageSystem(world, 1 / 60);

    // World dir (0→target) = (+1, 0, 0). Rotated by -yaw=-π/2:
    // localX = cos(-π/2)*1 + sin(-π/2)*0 = 0
    // localZ = -sin(-π/2)*1 + cos(-π/2)*0 = 1
    expect(HitReactComp.dirX[target]).toBeCloseTo(0, 5);
    expect(HitReactComp.dirZ[target]).toBeCloseTo(1, 5);
  });

  it('writes a zero vector when attacker and target overlap', () => {
    // Attacker at the same position as target — degenerate but possible.
    Position.x[target] = 0;
    Position.y[target] = 0;
    Position.z[target] = 0;

    queueDamageEvent(20, AttackDirection.Stab);
    DamageSystem(world, 1 / 60);

    expect(HitReactComp.dirX[target]).toBe(0);
    expect(HitReactComp.dirY[target]).toBe(0);
    expect(HitReactComp.dirZ[target]).toBe(0);
    // Still marked active so animation can pick a default lean.
    expect(HitReactComp.active[target]).toBe(1);
  });

  it('normalizes magnitude as damage / max-direction-damage, clamped to 1', () => {
    Position.z[target] = 2;
    // Stab direction has max=45 (head). 20 damage / 45 ≈ 0.4444.
    queueDamageEvent(20, AttackDirection.Stab);
    DamageSystem(world, 1 / 60);
    expect(HitReactComp.magnitude[target]).toBeCloseTo(20 / 45, 4);
  });

  it('clamps magnitude to 1 when damage exceeds max', () => {
    Position.z[target] = 2;
    queueDamageEvent(9999, AttackDirection.Stab);
    DamageSystem(world, 1 / 60);
    expect(HitReactComp.magnitude[target]).toBe(1);
  });

  it('does NOT touch HitReactComp on a successful block', () => {
    Position.z[target] = 2;
    // Pre-stamp HitReactComp with a sentinel so we can detect a write.
    HitReactComp.active[target] = 0;
    HitReactComp.magnitude[target] = -1;
    HitReactComp.spawnedAtTick[target] = 9999;

    // Target is Blocking facing the correct direction for Stab.
    // FSM v2 (#135): single Blocking state replaces Block + ParryWindow.
    CombatStateComponent.state[target] = CombatState.Blocking;
    CombatStateComponent.blockDirection[target] = 2; // BlockDirection.Top — Stab is blocked by any
    queueDamageEvent(20, AttackDirection.Stab);
    DamageSystem(world, 1 / 60);

    // Sentinel still untouched → block path didn't populate HitReactComp.
    expect(HitReactComp.active[target]).toBe(0);
    expect(HitReactComp.magnitude[target]).toBe(-1);
    expect(HitReactComp.spawnedAtTick[target]).toBe(9999);
  });

  it('skips populate for targets without HitReactComp', () => {
    // Remove the component from target before the hit lands.
    removeEntity(ecs, target);
    target = addEntity(ecs);
    addComponent(ecs, Position, target);
    addComponent(ecs, Rotation, target);
    addComponent(ecs, Health, target);
    addComponent(ecs, Stamina, target);
    addComponent(ecs, CombatStateComponent, target);
    // No HitReactComp.
    Health.current[target] = 100;
    Health.max[target] = 100;
    Stamina.current[target] = 100;
    Stamina.max[target] = 100;
    Position.z[target] = 2;
    CombatStateComponent.state[target] = CombatState.Idle;

    // Should not throw.
    queueDamageEvent(20, AttackDirection.Stab);
    expect(() => DamageSystem(world, 1 / 60)).not.toThrow();
    // Target health was still applied.
    expect(Health.current[target]).toBe(80);
  });
});
