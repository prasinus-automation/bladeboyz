/**
 * HealthSystem — manages health for all combatant entities.
 *
 * Responsibilities:
 * - Process damage events (from tracer/hit detection system)
 * - Clamp health to [0, max]
 * - Handle death: when health reaches 0, mark entity for respawn
 * - Respawn after delay (scaffolding: reset to max health after 2 seconds = 120 ticks)
 *
 * Runs in fixedUpdate() at 60Hz.
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
 * @returns Object with arrays of entities that died or respawned this tick
 */
export function healthSystemTick(ecsWorld: IWorld): { died: number[]; respawned: number[] } {
  const died: number[] = [];
  const respawned: number[] = [];
  const entities = healthQuery(ecsWorld);

  // Process pending damage
  for (let i = pendingDamage.length - 1; i >= 0; i--) {
    const event = pendingDamage[i];
    // Skip if already dead
    if (respawnTimers.has(event.target)) continue;

    Health.current[event.target] = Math.max(0, Health.current[event.target] - event.amount);
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
      // Just died
      respawnTimers.set(eid, RESPAWN_DELAY_TICKS);
      died.push(eid);
    }
  }

  return { died, respawned };
}

/** Exported constant for testing */
export { RESPAWN_DELAY_TICKS };
