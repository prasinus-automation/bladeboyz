/**
 * HealthSystem — manages health for all combatant entities.
 *
 * Responsibilities:
 * - Process pending damage events (queued via `queueDamage`)
 * - Clamp health to [0, max]
 * - Handle death: when health first crosses to 0, add `DeadTag` and
 *   `RespawnPending`, push the eid into the returned `died` array
 * - Tick down `RespawnPending.ticksRemaining`; when it hits 0, push eid
 *   into the returned `respawned` array (HP/stamina restore happens in
 *   `processRespawns` — issue B — NOT here)
 *
 * Issue #130: this used to track death via a `respawnTimers: Map`
 * side-table. That has been replaced by the `RespawnPending` component
 * + `DeadTag` so the data lives on the entity (network-replicable) and
 * `isDead(eid)` is a simple `hasComponent` check.
 *
 * Runs in fixedUpdate() at 60Hz.
 */

import {
  defineQuery,
  hasComponent,
  addComponent,
  type IWorld,
} from 'bitecs';
import { Health, DeadTag, RespawnPending } from '../components';
import { EventBus } from '../../events/EventBus';
import { clearDamageAttribution } from './DamageSystem';

/**
 * Default respawn delay in ticks (3.0 s at 60 Hz).
 *
 * Issue #130 bumped this from 120 (2 s) to 180 (3 s) per the design doc.
 * The constant is the DEFAULT — `RespawnPending.ticksRemaining` is the
 * per-entity source of truth and may eventually be set from a mode-specific
 * override.
 */
const RESPAWN_DELAY_TICKS = 180;

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
 * Reset all health-system state for a fresh test. Drops queued damage AND
 * clears the EventBus + DamageSystem attribution map (both of which can
 * leak across tests when the death pipeline runs end-to-end).
 *
 * NOTE: this does NOT remove DeadTag/RespawnPending from existing entities.
 * Tests that need a clean ECS world should `createWorld()` fresh.
 */
export function resetHealthTracking(): void {
  pendingDamage.length = 0;
  EventBus.clear();
  clearDamageAttribution();
}

/**
 * Check if an entity is dead (awaiting respawn).
 *
 * Pre-#130 this consulted a Map; now it's a `hasComponent(DeadTag)` check.
 * Kept as a function so callers don't have to import `DeadTag` + `hasComponent`
 * just to ask the question. Pass the bitECS world.
 */
export function isDead(world: IWorld, eid: number): boolean {
  return hasComponent(world, DeadTag, eid);
}

/**
 * Process one fixed-update tick of the health system.
 *
 * @param ecsWorld - The bitECS world to query entities from
 * @returns Object with arrays of entities that died or respawned this tick
 *
 * Tick contract:
 *   1. Apply pending damage events (skipping entities that already have DeadTag)
 *   2. For each entity with Health:
 *      - if it has RespawnPending, decrement; if it hits 0, push to `respawned`
 *      - else if Health.current ≤ 0, add DeadTag + RespawnPending and push to `died`
 *
 * Note that HP is NOT restored on respawn here — that's the job of
 * `processRespawns` in main.ts (issue B). HealthSystem is purely the
 * "detect death + tick down the timer" stage.
 */
export function healthSystemTick(
  ecsWorld: IWorld,
): { died: number[]; respawned: number[] } {
  const died: number[] = [];
  const respawned: number[] = [];
  const entities = healthQuery(ecsWorld);

  // Process pending damage
  for (let i = pendingDamage.length - 1; i >= 0; i--) {
    const event = pendingDamage[i];
    // Skip if already dead
    if (hasComponent(ecsWorld, DeadTag, event.target)) continue;

    Health.current[event.target] = Math.max(
      0,
      Health.current[event.target] - event.amount,
    );
  }
  pendingDamage.length = 0;

  // Check for deaths and process respawns
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];

    if (hasComponent(ecsWorld, RespawnPending, eid)) {
      // Entity is dead, count down respawn timer
      const remaining = RespawnPending.ticksRemaining[eid] - 1;
      if (remaining <= 0) {
        // Respawn ready — caller (main.ts → processRespawns) handles HP /
        // position restore + DeadTag/RespawnPending removal. We just signal.
        respawned.push(eid);
        // Defensive: clamp the counter at 0 so a follow-up tick before
        // processRespawns runs doesn't underflow the ui16.
        RespawnPending.ticksRemaining[eid] = 0;
      } else {
        RespawnPending.ticksRemaining[eid] = remaining;
      }
    } else if (
      Health.current[eid] <= 0 &&
      Health.max[eid] > 0 &&
      !hasComponent(ecsWorld, DeadTag, eid)
    ) {
      // Just died — add the death-state components. processDeaths (called
      // immediately after this in main.ts) handles event emission, score,
      // FSM reset, velocity zero, weapon drop. We don't do any of that here
      // because HealthSystem doesn't know about the GameWorld wrapper.
      addComponent(ecsWorld, DeadTag, eid);
      addComponent(ecsWorld, RespawnPending, eid);
      RespawnPending.ticksRemaining[eid] = RESPAWN_DELAY_TICKS;
      died.push(eid);
    }
  }

  return { died, respawned };
}

/** Exported constant for testing */
export { RESPAWN_DELAY_TICKS };
