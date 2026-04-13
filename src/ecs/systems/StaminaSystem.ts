/**
 * StaminaSystem — manages stamina resource for all combatant entities.
 *
 * Responsibilities:
 * - Deduct stamina costs when combat actions begin (attack, block hit, parry, feint)
 * - Passive regeneration after idle delay (60 ticks = 1 second)
 * - Block break → Stunned transition when stamina hits 0 while blocking
 * - Clamp stamina to [0, max]
 *
 * Runs in fixedUpdate() at 60Hz.
 */

import { defineQuery, type IWorld } from 'bitecs';
import { Stamina, CombatStateComp } from '../components';
import { CombatState, BLOCK_BREAK_STUN_TICKS } from '../../combat/states';
import type { WeaponConfig } from '../../weapons/WeaponConfig';

/** Stamina regen rate per second */
const STAMINA_REGEN_PER_SECOND = 5;
/** Stamina regen per tick (at 60Hz) */
const STAMINA_REGEN_PER_TICK = STAMINA_REGEN_PER_SECOND / 60;
/** Ticks of idle before regen starts (1 second at 60Hz) */
const REGEN_DELAY_TICKS = 60;

/** Query entities that have both Stamina and CombatStateComp */
const staminaQuery = defineQuery([Stamina, CombatStateComp]);

/**
 * Per-entity stamina tracking state (not in ECS because it's internal bookkeeping).
 * Tracks ticks since last stamina-consuming action for regen delay.
 */
const ticksSinceLastCost = new Map<number, number>();

/**
 * Event queue for stamina costs from combat actions.
 * Systems push events here; StaminaSystem processes and clears each tick.
 */
export interface StaminaCostEvent {
  entity: number;
  type: 'attack' | 'block' | 'parry' | 'feint';
  weaponConfig: WeaponConfig;
}

const pendingCosts: StaminaCostEvent[] = [];

/** Queue a stamina cost event (called by CombatSystem or other systems) */
export function queueStaminaCost(event: StaminaCostEvent): void {
  pendingCosts.push(event);
}

/** Clear all pending events (for testing) */
export function clearStaminaEvents(): void {
  pendingCosts.length = 0;
}

/** Clear per-entity tracking state (for testing) */
export function resetStaminaTracking(): void {
  ticksSinceLastCost.clear();
  pendingCosts.length = 0;
}

/**
 * Process one fixed-update tick of the stamina system.
 *
 * @param ecsWorld - The bitECS world to query entities from
 * @returns Array of entity IDs that had their block broken this tick
 */
export function staminaSystemTick(ecsWorld: IWorld): number[] {
  const blockBrokenEntities: number[] = [];
  const entities = staminaQuery(ecsWorld);

  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];

    // Process pending cost events for this entity
    let hadCost = false;
    for (let j = pendingCosts.length - 1; j >= 0; j--) {
      const event = pendingCosts[j];
      if (event.entity !== eid) continue;

      const cost = event.weaponConfig.staminaCost[event.type];
      Stamina.current[eid] = Math.max(0, Stamina.current[eid] - cost);
      hadCost = true;

      // Remove processed event
      pendingCosts.splice(j, 1);
    }

    if (hadCost) {
      ticksSinceLastCost.set(eid, 0);

      // Check block break: stamina hit 0 while blocking
      const currentState = CombatStateComp.state[eid] as CombatState;
      if (
        Stamina.current[eid] <= 0 &&
        (currentState === CombatState.Block || currentState === CombatState.ParryWindow)
      ) {
        // Transition to Stunned
        CombatStateComp.state[eid] = CombatState.Stunned;
        CombatStateComp.ticksRemaining[eid] = BLOCK_BREAK_STUN_TICKS;
        blockBrokenEntities.push(eid);
      }
    } else {
      // Increment idle ticks (new entities start at 0 and must wait the full delay)
      const prevTicks = ticksSinceLastCost.get(eid) ?? 0;
      const ticks = prevTicks + 1;
      ticksSinceLastCost.set(eid, ticks);

      // Passive regeneration after delay, only when not attacking or blocking
      const currentState = CombatStateComp.state[eid] as CombatState;
      const isIdle =
        currentState === CombatState.Idle || currentState === CombatState.Recovery;

      if (ticks >= REGEN_DELAY_TICKS && isIdle) {
        const max = Stamina.max[eid];
        Stamina.current[eid] = Math.min(max, Stamina.current[eid] + STAMINA_REGEN_PER_TICK);
      }
    }
  }

  // Clear any remaining events (for entities not in query)
  pendingCosts.length = 0;

  return blockBrokenEntities;
}

/** Exported constants for testing */
export { STAMINA_REGEN_PER_TICK, REGEN_DELAY_TICKS };
