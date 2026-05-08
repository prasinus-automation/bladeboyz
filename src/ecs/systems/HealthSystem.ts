/**
 * HealthSystem — manages health for all combatant entities.
 *
 * Responsibilities:
 * - Process damage events (from hit detection or other systems)
 * - Clamp health to [0, max]
 * - Handle death: when health reaches 0, mark entity for respawn and
 *   emit a KillEvent joining the victim with the last attacker that
 *   hit them this tick (when known)
 * - Respawn after delay (scaffolding: reset to max health after 2 seconds = 120 ticks)
 *
 * Runs in fixedUpdate() at 60Hz.
 *
 * Kill attribution model:
 * - Each tick, the queue of pending DamageEvents is consumed in order.
 * - For events that carry an `attackerEid`, the most recent attacker wins
 *   (overwrites prior entries for the same victim within the tick).
 * - When death is detected for a victim, the attacker map is consulted and
 *   a KillEvent is recorded in the tick's return value.
 * - Map is rebuilt every tick (function-local) so it cannot leak across ticks.
 *
 * See `docs/gold-currency.md` §8 for the design rationale.
 */

import { defineQuery, type IWorld } from 'bitecs';
import { Health } from '../components';

/** Respawn delay in ticks (2 seconds at 60Hz) */
const RESPAWN_DELAY_TICKS = 120;

/** Query all entities with Health component */
const healthQuery = defineQuery([Health]);

/** Damage event — pushed by hit detection or other systems */
export interface DamageEvent {
  target: number;
  amount: number;
  /**
   * Optional. The entity that dealt the damage. When the damage causes the
   * target to die this tick, the kill is attributed to this entity.
   * Omit (or pass undefined) for environmental / unattributed damage.
   */
  attackerEid?: number;
}

/** Information about a death emitted by `healthSystemTick`. */
export interface KillEvent {
  /** The entity that died. */
  victimEid: number;
  /**
   * The entity that landed the killing blow this tick, if any.
   * `undefined` for environmental deaths (no attacker recorded).
   */
  attackerEid: number | undefined;
}

const pendingDamage: DamageEvent[] = [];

/** Queue a damage event */
export function queueDamage(event: DamageEvent): void {
  pendingDamage.push(event);
}

/** Clear all pending damage events (for testing) */
export function clearDamageEvents(): void {
  pendingDamage.length = 0;
}

/**
 * Per-entity death tracking: maps entity ID → ticks until respawn.
 * Not in ECS because it's internal bookkeeping.
 */
const respawnTimers = new Map<number, number>();

/** Clear respawn timers (for testing) */
export function resetHealthTracking(): void {
  respawnTimers.clear();
  pendingDamage.length = 0;
}

/** Check if an entity is dead (awaiting respawn) */
export function isDead(eid: number): boolean {
  return respawnTimers.has(eid);
}

/**
 * Process one fixed-update tick of the health system.
 *
 * @param ecsWorld - The bitECS world to query entities from
 * @returns Object with arrays of entities that died, respawned, and a
 *          parallel `kills` array attributing each death to its last attacker.
 */
export function healthSystemTick(ecsWorld: IWorld): {
  died: number[];
  respawned: number[];
  kills: KillEvent[];
} {
  const died: number[] = [];
  const respawned: number[] = [];
  const kills: KillEvent[] = [];
  const entities = healthQuery(ecsWorld);

  // Build the tick-scoped attacker map from this tick's damage queue.
  // Function-local: the map is GC'd at end of tick — cannot leak across ticks.
  // Most-recent-attacker-wins semantics: later events overwrite earlier ones.
  const lastAttackerThisTick = new Map<number, number>();

  // Process pending damage. Iterate in insertion order so the LAST attacker
  // for a given victim wins (mirrors "last to land a hit gets the kill").
  for (let i = 0; i < pendingDamage.length; i++) {
    const event = pendingDamage[i];
    // Skip if already dead — the already-dead guard prevents double-attribution
    // (e.g. a posthumous tick of damage doesn't reassign the kill).
    if (respawnTimers.has(event.target)) continue;

    Health.current[event.target] = Math.max(0, Health.current[event.target] - event.amount);

    if (event.attackerEid !== undefined) {
      lastAttackerThisTick.set(event.target, event.attackerEid);
    }
  }
  pendingDamage.length = 0;

  // Check for deaths and process respawns
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];

    if (respawnTimers.has(eid)) {
      // Entity is dead, count down respawn timer
      const remaining = respawnTimers.get(eid)! - 1;
      if (remaining <= 0) {
        // Respawn: reset health to max
        Health.current[eid] = Health.max[eid];
        respawnTimers.delete(eid);
        respawned.push(eid);
      } else {
        respawnTimers.set(eid, remaining);
      }
    } else if (Health.current[eid] <= 0 && Health.max[eid] > 0) {
      // Just died — start respawn timer and record kill attribution
      respawnTimers.set(eid, RESPAWN_DELAY_TICKS);
      died.push(eid);
      kills.push({
        victimEid: eid,
        attackerEid: lastAttackerThisTick.get(eid),
      });
    }
  }

  return { died, respawned, kills };
}

/** Exported constant for testing */
export { RESPAWN_DELAY_TICKS };
