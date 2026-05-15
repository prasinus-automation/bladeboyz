/**
 * processDeaths — runs in fixedUpdate immediately after `healthSystemTick`.
 *
 * For each entity in the `died` array (entities whose HP first crossed 0
 * THIS tick), we:
 *   1. Look up the killer via `getDamageAttribution` (5-second window).
 *   2. Emit a `DeathEvent` on the `EventBus`.
 *   3. Increment `Score.deaths[victim]` and (if attributed) `Score.kills[killer]`.
 *   4. Reset `Score.goldThisLife[victim]` to 0.
 *   5. Reset the victim's CombatFSM to Idle and force the ECS combat-state
 *      mirrors to Idle. Without this, dead entities stay frozen mid-windup.
 *   6. Zero `Velocity` so the corpse doesn't drift while waiting for respawn.
 *   7. Call `dropEquippedWeapon(victim, world)` — currently a no-op stub
 *      from `InventorySystem`. #94 fills it in with real drop-on-death logic.
 *
 * `DeadTag` and `RespawnPending` were added by `healthSystemTick` itself —
 * we don't add them again here.
 *
 * Filtering:
 *   - Only entities tagged `Player` or `Bot` are processed. Dummies are
 *     deliberately excluded (they regen via `tickTrainingDummyHealthReset`
 *     and never "die" in the killfeed sense). The early-skip is critical
 *     — without it, a dummy's HP hitting 0 would emit a DeathEvent and bump
 *     an absent `Score.deaths` counter to garbage values.
 *   - When #99 lands warmup bots, the `Bot` tag is added automatically
 *     and they flow through this same pipeline (kills/deaths counted).
 *
 * See `docs/spawn-death-respawn.md` for the full lifecycle.
 */

import { hasComponent } from 'bitecs';
import {
  Player,
  Bot,
  Score,
  Velocity,
  CombatStateComp,
  CombatStateComponent,
} from '../components';
import type { GameWorld } from '../../core/types';
import { fsmRegistry } from '../../combat/CombatFSM';
import { CombatState } from '../../combat/states';
import { EventBus } from '../../events/EventBus';
import { getDamageAttribution } from './DamageSystem';
import { getCurrentFixedTick } from '../../core/tickCounter';
import { dropEquippedWeapon } from './InventorySystem';

/**
 * Decide whether an entity should flow through the death pipeline.
 *
 * Players and bots get full treatment (events, score, FSM reset, drop).
 * Dummies and non-combatant entities (shopkeeps, pickups, etc.) are skipped.
 */
function shouldProcess(world: GameWorld, eid: number): boolean {
  return (
    hasComponent(world.ecs, Player, eid) || hasComponent(world.ecs, Bot, eid)
  );
}

/**
 * Process the death-cleanup hook for every entity in `died` this tick.
 */
export function processDeaths(died: number[], world: GameWorld): void {
  if (died.length === 0) return;

  const tick = getCurrentFixedTick();

  for (let i = 0; i < died.length; i++) {
    const victimEid = died[i];

    // Skip dummies / non-combatants. Their HP=0 is reset by tickTrainingDummyHealthReset.
    if (!shouldProcess(world, victimEid)) continue;

    // 1. Resolve killer attribution. Window is 5 s; missing record → 0.
    const attribution = getDamageAttribution(victimEid, tick);
    const killerEid = attribution?.attackerEid ?? 0;
    const weaponId = attribution?.weaponId ?? 0;
    const bodyRegion = attribution?.bodyRegion ?? 0;

    // 2. Emit DeathEvent. Killfeed/DeathScreen subscribe on the EventBus.
    EventBus.emit('DeathEvent', {
      victimEid,
      killerEid,
      weaponId,
      bodyRegion,
      tick,
    });

    // 3. Update Score components. Skip if the entity wasn't given a Score
    // component (dummies wouldn't pass the shouldProcess gate, but bots/
    // players might be created by tests without the component).
    if (hasComponent(world.ecs, Score, victimEid)) {
      Score.deaths[victimEid]++;
      // 4. Per design doc: gold-earned-this-life resets on death.
      Score.goldThisLife[victimEid] = 0;
    }
    if (
      killerEid !== 0 &&
      killerEid !== victimEid && // self-kills don't credit
      hasComponent(world.ecs, Score, killerEid)
    ) {
      Score.kills[killerEid]++;
    }

    // 5. Reset combat FSM and ECS mirrors so the dead entity doesn't
    // keep "swinging" mid-Recovery. Both mirrors must be flushed because
    // CombatSystem early-outs on DeadTag and won't sync these any more.
    const fsm = fsmRegistry.get(victimEid);
    if (fsm) {
      fsm.reset();
    }
    if (hasComponent(world.ecs, CombatStateComponent, victimEid)) {
      CombatStateComponent.state[victimEid] = CombatState.Idle;
      CombatStateComponent.ticksRemaining[victimEid] = 0;
    }
    if (hasComponent(world.ecs, CombatStateComp, victimEid)) {
      CombatStateComp.state[victimEid] = CombatState.Idle;
      CombatStateComp.phaseElapsed[victimEid] = 0;
      CombatStateComp.phaseTotal[victimEid] = 0;
      CombatStateComp.phaseT[victimEid] = 0;
    }

    // 6. Zero velocity. The kinematic character controller is also
    // skipped on DeadTag in MovementSystem, but the legacy Velocity
    // mirror could still surface in animation/HUD math.
    if (hasComponent(world.ecs, Velocity, victimEid)) {
      Velocity.x[victimEid] = 0;
      Velocity.y[victimEid] = 0;
      Velocity.z[victimEid] = 0;
    }

    // 7. Stub drop-on-death. #94 fills this in with real pickup spawning.
    dropEquippedWeapon(victimEid, world);
  }
}
