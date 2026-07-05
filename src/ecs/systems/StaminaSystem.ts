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
import { Stamina, CombatStateComponent } from '../components';
import { CombatState } from '../../combat/states';
import { CombatInput, fsmRegistry } from '../../combat/CombatFSM';
import type { WeaponConfig } from '../../weapons/WeaponConfig';

/**
 * Stamina regen rate per second. 20/s (2026-07 fluidity pass — was 5/s,
 * which took 20 seconds to refill an empty bar: fights devolved into
 * standing around waiting for the meter). At 20/s a drained bar is back
 * in ~5s and a couple of swings recover between exchanges — stamina
 * paces the fight without parking it.
 */
const STAMINA_REGEN_PER_SECOND = 20;
/** Stamina regen per tick (at 60Hz) */
const STAMINA_REGEN_PER_TICK = STAMINA_REGEN_PER_SECOND / 60;
/** Ticks of pause before regen starts (0.75 s at 60Hz — was a full second). */
const REGEN_DELAY_TICKS = 45;

/** Query entities that have both Stamina and CombatStateComponent */
const staminaQuery = defineQuery([Stamina, CombatStateComponent]);

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
 * Drop the per-entity regen-delay counter for a single eid. Used by
 * `processRespawns` (#134): when a player respawns we want their stamina
 * regen clock to start fresh — without this, the regen-delay window from
 * their previous life carries over and the first tick after spawn either
 * regens immediately (if they died with a stale clock) or sits idle for a
 * full second (if they died mid-action). Either is wrong.
 *
 * Unlike `resetStaminaTracking()` (which clears every entity, intended for
 * test isolation), this is per-entity and safe to call in production.
 *
 * No-op when the eid has no entry — saves the caller a `has()` check.
 */
export function resetEntityStaminaTracking(eid: number): void {
  ticksSinceLastCost.delete(eid);
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

    // Process pending cost events for this entity. Track the most recent
    // weapon config so the block-break path below can read its
    // `blockBreakStunTicks` if no FSM is registered for this entity.
    let hadCost = false;
    let lastWeaponConfig: WeaponConfig | null = null;
    for (let j = pendingCosts.length - 1; j >= 0; j--) {
      const event = pendingCosts[j];
      if (event.entity !== eid) continue;

      // FSM v2 (#131): `staminaCost.feint` became optional, so `cost` can
      // be `undefined` for weapons that omit it. Treat omitted as 0 — same
      // behavior as the v1 schema, where missing fields would have surfaced
      // a runtime NaN.
      const cost = event.weaponConfig.staminaCost[event.type] ?? 0;
      Stamina.current[eid] = Math.max(0, Stamina.current[eid] - cost);
      hadCost = true;
      lastWeaponConfig = event.weaponConfig;

      // Remove processed event
      pendingCosts.splice(j, 1);
    }

    if (hadCost) {
      ticksSinceLastCost.set(eid, 0);

      // Block break — stamina hit 0 while blocking. FSM v2 (#135) routes
      // this through `CombatInput.BlockBreak` → HitStun for
      // `weapon.blockBreakStunTicks` (per-weapon, replacing the old
      // module-level `BLOCK_BREAK_STUN_TICKS = 30` constant). Fall back
      // to a direct ECS write if no FSM is registered (e.g. test fixtures
      // exercising the stamina pipeline without a real FSM).
      const currentState = CombatStateComponent.state[eid] as CombatState;
      if (
        Stamina.current[eid] <= 0 &&
        currentState === CombatState.Blocking
      ) {
        const fsm = fsmRegistry.get(eid);
        if (fsm) {
          fsm.transition(CombatInput.BlockBreak);
          // Sync ECS mirror immediately so same-tick readers see HitStun
          // before CombatSystem runs again next tick.
          CombatStateComponent.state[eid] = fsm.state;
          CombatStateComponent.ticksRemaining[eid] = fsm.ticksRemaining;
        } else {
          CombatStateComponent.state[eid] = CombatState.HitStun;
          CombatStateComponent.ticksRemaining[eid] =
            lastWeaponConfig?.blockBreakStunTicks ?? 30;
        }
        blockBrokenEntities.push(eid);
      }
    } else {
      // Increment idle ticks (new entities start at 0 and must wait the full delay)
      const prevTicks = ticksSinceLastCost.get(eid) ?? 0;
      const ticks = prevTicks + 1;
      ticksSinceLastCost.set(eid, ticks);

      // Passive regeneration after delay, only when not attacking or blocking
      const currentState = CombatStateComponent.state[eid] as CombatState;
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
