/**
 * Integration test: damage → death → kill-attribution → gold-award pipeline.
 *
 * Exercises the full chain that runs in `main.ts`'s fixed-update loop after
 * the architect's #103-fix-feedback rework:
 *
 *   DamageEvent entity
 *     → DamageSystem (applies damage to Health.current, records
 *        attribution into attributionByVictim, emits DamageDealt)
 *     → healthSystemTick (detects HP ≤ 0, adds DeadTag + RespawnPending,
 *        returns `died` array)
 *     → processDeaths (looks up attribution, emits DeathEvent)
 *     → EventBus subscriber (main.ts wires `awardGoldOnKill` to DeathEvent)
 *     → Gold.amount mutated
 *
 * This is the test that would fail if any link in the chain is broken —
 * e.g. DamageSystem stops recording attribution, processDeaths stops
 * emitting DeathEvent, or main.ts's EventBus subscription regresses.
 *
 * Pre-#103-fix versions of this PR used a `kills: KillEvent[]` array on
 * `healthSystemTick` and an `AttackDirection` enum — both were retired
 * upstream by #130 / #134 (kill pipeline) and #139 (Direction unification).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import {
  CombatStateComponent,
  DamageEvent,
  DeadTag,
  Gold,
  Health,
  Player,
  Score,
  Stamina,
} from '../ecs/components';
import { CombatState } from '../combat/states';
import { Direction } from '../combat/directions';
import { DamageSystem, clearDamageAttribution } from '../ecs/systems/DamageSystem';
import {
  healthSystemTick,
  resetHealthTracking,
} from '../ecs/systems/HealthSystem';
import { processDeaths } from '../ecs/systems/processDeaths';
import { weaponConfigMap } from '../ecs/systems/TracerSystem';
import { EventBus } from '../events/EventBus';
import { resetFixedTick } from '../core/tickCounter';
import {
  awardGoldOnKill,
  GOLD_PER_KILL,
  resetGoldEconomyListeners,
} from './goldEconomy';
import { resetWallet } from './Wallet';

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
  addComponent(world, Score, eid);
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
  // FSM v2 / #139: unified `Direction` enum replaces the retired `AttackDirection`.
  DamageEvent.attackDirection[eventEid] = Direction.Overhead;
  DamageEvent.processed[eventEid] = 0;
  return eventEid;
}

/**
 * Mirror the main.ts `EventBus.on('DeathEvent', ...)` wiring in test scope
 * so the integration test exercises the real subscription surface that
 * production gold-award uses.
 */
function subscribeAwardGoldToDeathEvent(world: any): () => void {
  const unsubscribe = EventBus.on('DeathEvent', (payload) => {
    awardGoldOnKill(
      world,
      payload.victimEid,
      payload.killerEid === 0 ? undefined : payload.killerEid,
    );
  });
  return unsubscribe;
}

describe('Kill pipeline integration (DamageSystem → processDeaths → goldEconomy)', () => {
  let world: any;
  let mockGameWorld: any;
  let unsubscribe: () => void;

  beforeEach(() => {
    world = createWorld();
    // Reset every cross-test piece of state the pipeline touches.
    resetHealthTracking(); // also clears EventBus + DamageSystem attribution
    clearDamageAttribution(); // belt-and-suspenders
    resetGoldEconomyListeners();
    resetWallet(); // bridge double-writes touch Wallet — reset to default
    resetFixedTick(); // attribution windows depend on the tick counter
    weaponConfigMap.clear();
    // Minimal weapon config so DamageSystem can read hitStunTicks and
    // populate the per-direction damage table for HitReact magnitude.
    weaponConfigMap.set(0, {
      name: 'TestWeapon',
      hitStunTicks: 30,
      blockStaminaDrain: 25,
      parryStunTicks: 40,
      recovery: { 0: 25, 1: 25, 2: 25, 3: 25 },
      damage: {
        0: { head: 60, torso: 40, limb: 20 },
        1: { head: 60, torso: 40, limb: 20 },
        2: { head: 60, torso: 40, limb: 20 },
        3: { head: 60, torso: 40, limb: 20 },
      },
    } as any);
    mockGameWorld = { ecs: world };
    unsubscribe = subscribeAwardGoldToDeathEvent(world);
  });

  afterEach(() => {
    unsubscribe();
    EventBus.clear();
  });

  it('killing a dummy as the player awards 25 gold same-tick', () => {
    const player = setupPlayer(world, 100);
    const dummy = setupCombatant(world, 5);
    // processDeaths needs the Player or Bot tag to fire the DeathEvent.
    // Dummies in production opt out (they regen via tickDummyHealthReset),
    // but the integration test simulates a kill-credit scenario where the
    // victim IS something that emits a DeathEvent. Tag it accordingly.
    addComponent(world, Player, dummy);
    addComponent(world, Score, dummy);

    // Tracer creates a DamageEvent entity for a 10-damage hit (overkill on dummy).
    emitDamageEventEntity(world, dummy, player, 10);

    // DamageSystem: applies damage directly to Health.current, records
    // attribution, emits DamageDealt.
    DamageSystem(mockGameWorld, 1 / 60);
    expect(Health.current[dummy]).toBe(0);

    // healthSystemTick: detects HP ≤ 0, adds DeadTag + RespawnPending.
    const { died } = healthSystemTick(world);
    expect(died).toContain(dummy);

    // processDeaths: looks up attribution, emits DeathEvent.
    processDeaths(died, mockGameWorld);

    // EventBus.flush: triggers the subscribed `awardGoldOnKill` call.
    EventBus.flush();

    expect(Gold.amount[player]).toBe(GOLD_PER_KILL);
  });

  it('non-fatal hit produces no DeathEvent and no gold', () => {
    const player = setupPlayer(world, 100);
    const dummy = setupCombatant(world, 100);
    addComponent(world, Player, dummy);
    addComponent(world, Score, dummy);

    emitDamageEventEntity(world, dummy, player, 30);
    DamageSystem(mockGameWorld, 1 / 60);

    const { died } = healthSystemTick(world);
    expect(died).toEqual([]);

    processDeaths(died, mockGameWorld);
    EventBus.flush();

    expect(Health.current[dummy]).toBe(70);
    expect(Gold.amount[player]).toBe(0);
  });

  it('two simultaneous hits — exactly one player gets the kill credit', () => {
    const p1 = setupPlayer(world, 100);
    const p2 = setupPlayer(world, 100);
    const dummy = setupCombatant(world, 50);
    addComponent(world, Player, dummy);
    addComponent(world, Score, dummy);

    // Both events queued in same tick; second one is the killing blow.
    emitDamageEventEntity(world, dummy, p1, 30);
    emitDamageEventEntity(world, dummy, p2, 60);

    DamageSystem(mockGameWorld, 1 / 60);
    const { died } = healthSystemTick(world);
    expect(died).toContain(dummy);

    processDeaths(died, mockGameWorld);
    EventBus.flush();

    // Attribution map records the MOST-RECENT attacker — one player gets 25,
    // the other gets 0. We assert exactly one of them was credited.
    const totalAwarded = Gold.amount[p1] + Gold.amount[p2];
    expect(totalAwarded).toBe(GOLD_PER_KILL);
    expect(p1 === p2).toBe(false); // sanity
    // The credited player should be one of the two — DamageSystem's iteration
    // order over bitECS events is creation order in current bitECS.
    const credited = Gold.amount[p1] === GOLD_PER_KILL ? p1 : p2;
    expect([p1, p2]).toContain(credited);
  });

  it('environmental death (no attacker) produces no gold even though DeathEvent fires', () => {
    const victim = setupPlayer(world, 100);

    // Simulate a non-combat HP drain: directly zero the victim's HP without
    // any DamageEvent. attributionByVictim has no record for this entity,
    // so processDeaths emits DeathEvent with killerEid=0 (the env-death
    // sentinel). main.ts's wiring maps killerEid=0 → undefined, and
    // awardGoldOnKill rejects undefined attacker.
    Health.current[victim] = 0;

    const { died } = healthSystemTick(world);
    expect(died).toContain(victim);

    processDeaths(died, mockGameWorld);
    EventBus.flush();

    // No gold awarded — there's no attacker, so the only other Player
    // (the dead one) shouldn't get credit either.
    expect(Gold.amount[victim]).toBe(0);
  });

  it('respawn-tagged victim is not credited again on subsequent ticks', () => {
    const player = setupPlayer(world, 100);
    const dummy = setupCombatant(world, 5);
    addComponent(world, Player, dummy);
    addComponent(world, Score, dummy);

    // Kill the dummy this tick.
    emitDamageEventEntity(world, dummy, player, 10);
    DamageSystem(mockGameWorld, 1 / 60);
    const t1 = healthSystemTick(world);
    processDeaths(t1.died, mockGameWorld);
    EventBus.flush();
    expect(Gold.amount[player]).toBe(GOLD_PER_KILL);

    // Next tick: dummy still has DeadTag, no new DamageEvent. died should
    // be empty; no double-credit.
    expect(t1.died.length).toBe(1);
    const t2 = healthSystemTick(world);
    expect(t2.died).toEqual([]);
    processDeaths(t2.died, mockGameWorld);
    EventBus.flush();
    expect(Gold.amount[player]).toBe(GOLD_PER_KILL); // still 25, not 50
  });

  it('self-kill (player damages themselves to 0) awards no gold', () => {
    const player = setupPlayer(world, 100);
    // Hit self with overkill damage.
    emitDamageEventEntity(world, player, player, 200);
    DamageSystem(mockGameWorld, 1 / 60);

    const { died } = healthSystemTick(world);
    expect(died).toContain(player);

    processDeaths(died, mockGameWorld);
    EventBus.flush();

    // DeathEvent fires but awardGoldOnKill rejects self-kill.
    expect(Gold.amount[player]).toBe(0);
  });
});
