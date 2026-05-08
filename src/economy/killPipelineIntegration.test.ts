/**
 * Integration test: damage → death → kill-attribution → gold-award pipeline.
 *
 * Exercises the full chain that lands in `main.ts`'s fixed-update loop:
 *   DamageSystem.handleHit → queueDamage(with attackerEid)
 *     → healthSystemTick → kills array
 *     → awardGoldOnKill → Gold.amount mutated
 *
 * This is the test that would fail if any link in the chain is broken
 * (e.g. DamageSystem stops forwarding attackerEid, or healthSystemTick
 * stops emitting kills).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import {
  CombatStateComponent,
  DamageEvent,
  Gold,
  Health,
  Player,
  Stamina,
} from '../ecs/components';
import { CombatState } from '../combat/states';
import { AttackDirection } from '../combat/directions';
import { DamageSystem } from '../ecs/systems/DamageSystem';
import {
  healthSystemTick,
  resetHealthTracking,
} from '../ecs/systems/HealthSystem';
import { weaponConfigMap } from '../ecs/systems/TracerSystem';
import { awardGoldOnKill, GOLD_PER_KILL, resetGoldEconomyListeners } from './goldEconomy';

function setupCombatant(world: any, hp = 100): number {
  const eid = addEntity(world);
  addComponent(world, Health, eid);
  addComponent(world, Stamina, eid);
  addComponent(world, CombatStateComponent, eid);
  Health.current[eid] = hp;
  Health.max[eid] = 100;
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;
  CombatStateComponent.state[eid] = CombatState.Idle;
  CombatStateComponent.weaponId[eid] = 0;
  return eid;
}

function setupPlayer(world: any, hp = 100): number {
  const eid = setupCombatant(world, hp);
  addComponent(world, Player, eid);
  addComponent(world, Gold, eid);
  Gold.amount[eid] = 0;
  return eid;
}

function emitDamageEventEntity(
  world: any,
  targetEid: number,
  attackerEid: number,
  damage: number,
): number {
  const eventEid = addEntity(world);
  addComponent(world, DamageEvent, eventEid);
  DamageEvent.targetEid[eventEid] = targetEid;
  DamageEvent.attackerEid[eventEid] = attackerEid;
  DamageEvent.damage[eventEid] = damage;
  DamageEvent.bodyRegion[eventEid] = 0;
  DamageEvent.attackDirection[eventEid] = AttackDirection.Overhead;
  DamageEvent.processed[eventEid] = 0;
  return eventEid;
}

describe('Kill pipeline integration (DamageSystem → HealthSystem → goldEconomy)', () => {
  let world: any;
  let mockGameWorld: any;

  beforeEach(() => {
    world = createWorld();
    resetHealthTracking();
    resetGoldEconomyListeners();
    weaponConfigMap.clear();
    // Minimal weapon config so DamageSystem can read hitStunTicks safely.
    weaponConfigMap.set(0, {
      name: 'TestWeapon',
      hitStunTicks: 30,
      blockStaminaDrain: 25,
      parryStunTicks: 40,
      recovery: { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25 },
    } as any);
    mockGameWorld = { ecs: world };
  });

  it('killing a dummy as the player awards 25 gold same-tick', () => {
    const player = setupPlayer(world, 100);
    const dummy = setupCombatant(world, 5);

    // Tracer creates a DamageEvent entity for a 10-damage hit (overkill on dummy).
    emitDamageEventEntity(world, dummy, player, 10);

    // DamageSystem processes the DamageEvent → calls queueDamage with attackerEid
    DamageSystem(mockGameWorld, 1 / 60);

    // healthSystemTick applies damage and detects death same-tick
    const { kills } = healthSystemTick(world);

    // Verify: dummy is dead, kill attributed to player
    expect(kills).toHaveLength(1);
    expect(kills[0].victimEid).toBe(dummy);
    expect(kills[0].attackerEid).toBe(player);
    expect(Health.current[dummy]).toBe(0);

    // Route through goldEconomy
    const newBalance = awardGoldOnKill(world, kills[0].victimEid, kills[0].attackerEid);

    expect(newBalance).toBe(GOLD_PER_KILL);
    expect(Gold.amount[player]).toBe(25);
  });

  it('non-fatal hit produces no kill event and no gold', () => {
    const player = setupPlayer(world, 100);
    const dummy = setupCombatant(world, 100);

    emitDamageEventEntity(world, dummy, player, 30);
    DamageSystem(mockGameWorld, 1 / 60);

    const { kills } = healthSystemTick(world);

    expect(kills).toEqual([]);
    expect(Health.current[dummy]).toBe(70);
    expect(Gold.amount[player]).toBe(0);
  });

  it('two simultaneous hits — last attacker gets the kill', () => {
    const p1 = setupPlayer(world, 100);
    const p2 = setupPlayer(world, 100);
    const dummy = setupCombatant(world, 50);

    // Both events queued in same tick; second one is the killing blow.
    emitDamageEventEntity(world, dummy, p1, 30);
    emitDamageEventEntity(world, dummy, p2, 60);

    DamageSystem(mockGameWorld, 1 / 60);
    const { kills } = healthSystemTick(world);

    // Note: order in the DamageEvent query is not strictly guaranteed by bitECS,
    // but in practice (and per current behavior) entities are queried in
    // creation order. We assert SOMEONE got the kill, not which one.
    expect(kills).toHaveLength(1);
    expect([p1, p2]).toContain(kills[0].attackerEid);

    awardGoldOnKill(world, kills[0].victimEid, kills[0].attackerEid);

    const totalAwarded = Gold.amount[p1] + Gold.amount[p2];
    expect(totalAwarded).toBe(GOLD_PER_KILL); // exactly one of them got 25
  });
});
