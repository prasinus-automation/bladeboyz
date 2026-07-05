/**
 * BotAISystem — the warmup bot's brain (issue #119 / spec §4).
 *
 * Runs in fixedUpdate BEFORE CombatSystem and MovementSystem so both see
 * this tick's decisions. Per bot it:
 *
 *   1. Faces the target (writes `Rotation.y` — MovementSystem's camera-yaw
 *      write is Player-gated, so the bot owns its own yaw).
 *   2. Runs the spec's three-mode mini-FSM and writes `MovementIntent`
 *      (the documented AI/network seam — bots move through the exact same
 *      MovementSystem + character controller as the player):
 *        Approach   — outside meleeRange: walk straight at the target.
 *        Engage     — in range: stop and swing.
 *        Reposition — too close (inside PERSONAL_SPACE): back off.
 *   3. Issues `CombatInput.Attack` through the same CombatFSM path the
 *      player uses, at most once per SWING_COOLDOWN_TICKS, with a
 *      deterministic pseudo-random direction (no Math.random — a hash of
 *      (tick, eid) keeps replays/network reconciliation possible per #92).
 *
 * The bot never blocks, parries, or dodges (spec: intentionally minimal —
 * stamina and the FSM provide natural pacing). Dead bots and dead targets
 * zero their intent and wait.
 */

import { defineQuery, hasComponent } from 'bitecs';
import {
  Bot,
  BotBrain,
  Player,
  Position,
  Rotation,
  MovementIntent,
  DeadTag,
  KnockbackState,
} from '../components';
import { CombatState } from '../../combat/states';
import { CombatInput, fsmRegistry } from '../../combat/CombatFSM';
import { Direction } from '../../combat/directions';
import { getCurrentFixedTick } from '../../core/tickCounter';
import type { GameWorld } from '../../core/types';

/** Bot walk throttle: fraction of full player walk speed (warmup pace). */
const BOT_SPEED_FACTOR = 0.8;

/** Minimum ticks between swing attempts (~0.9 s — beatable but honest). */
const SWING_COOLDOWN_TICKS = 55;

/** Inside this distance (m) the bot backs off instead of body-blocking. */
const PERSONAL_SPACE = 0.8;

/** Bot mini-FSM modes (mirrors BotBrain.mode). */
export const enum BotMode {
  Approach = 0,
  Engage = 1,
  Reposition = 2,
}

const botQuery = defineQuery([Bot, BotBrain, Position, MovementIntent]);
const targetCandidateQuery = defineQuery([Player, Position]);

/**
 * Deterministic per-(tick, eid) direction pick. Knuth multiplicative hash —
 * cheap, stateless, and stable for replay. All four directions occur.
 */
export function pickSwingDirection(tick: number, eid: number): Direction {
  const h = ((tick * 2654435761) ^ (eid * 40503)) >>> 0;
  return (h % 4) as Direction;
}

export function createBotAISystem(world: GameWorld): () => void {
  return function botAISystem(): void {
    const tick = getCurrentFixedTick();
    const bots = botQuery(world.ecs);

    for (let i = 0; i < bots.length; i++) {
      const eid = bots[i];

      // Dead bots wait for processRespawns; also stand down while being
      // knocked across the arena (MovementSystem zeroes control anyway —
      // this keeps the intent honest for anything else reading it).
      const knocked =
        hasComponent(world.ecs, KnockbackState, eid) &&
        KnockbackState.ticksRemaining[eid] > 0;
      // Target validity: check for a live Position component, NOT a zero
      // sentinel — bitECS eids start at 0 and the local player IS entity 0
      // in practice, so `target === 0` would make every bot ignore the
      // player and stand still.
      let target = BotBrain.targetEid[eid];
      let targetGone =
        !hasComponent(world.ecs, Position, target) ||
        hasComponent(world.ecs, DeadTag, target);

      // Retarget on despawn (AC #9): if the assigned target no longer
      // exists, acquire the nearest living Player-tagged entity. A DEAD
      // target is NOT retargeted away from — it respawns in 3 s and the
      // bot should keep hunting the same player (spec: warmup partner).
      if (targetGone && !hasComponent(world.ecs, Position, target)) {
        const candidates = targetCandidateQuery(world.ecs);
        let best = -1;
        let bestD = Infinity;
        for (let c = 0; c < candidates.length; c++) {
          const cand = candidates[c];
          if (cand === eid) continue;
          if (hasComponent(world.ecs, DeadTag, cand)) continue;
          const d =
            (Position.x[cand] - Position.x[eid]) ** 2 +
            (Position.z[cand] - Position.z[eid]) ** 2;
          if (d < bestD) {
            bestD = d;
            best = cand;
          }
        }
        if (best >= 0) {
          BotBrain.targetEid[eid] = best;
          target = best;
          targetGone = false;
        }
      }

      if (hasComponent(world.ecs, DeadTag, eid) || knocked || targetGone) {
        MovementIntent.moveX[eid] = 0;
        MovementIntent.moveZ[eid] = 0;
        continue;
      }

      const dx = Position.x[target] - Position.x[eid];
      const dz = Position.z[target] - Position.z[eid];
      const dist = Math.hypot(dx, dz);

      // Always face the target (yaw drives the swing arc + hitboxes).
      // Forward = -Z: facing (dx, dz) means yaw = atan2(-dx, -dz).
      Rotation.y[eid] = Math.atan2(-dx, -dz);

      const meleeRange = BotBrain.meleeRange[eid];
      const ux = dist > 1e-6 ? dx / dist : 0;
      const uz = dist > 1e-6 ? dz / dist : 0;

      // ── Obstacle detour ──
      // Head-on contact with a pillar/wall face zeroes the controller's
      // slide (travel ⊥ face) and the bot would grind forever — observed
      // live: a bot beelining down the z=0 axis parks against the arena
      // pillar at x=6.3. Detect "intending to move but not moving", then
      // strafe perpendicular (deterministic side pick) long enough to
      // clear a 2 m prop before resuming the beeline.
      const movedSq =
        (Position.x[eid] - BotBrain.prevX[eid]) ** 2 +
        (Position.z[eid] - BotBrain.prevZ[eid]) ** 2;
      BotBrain.prevX[eid] = Position.x[eid];
      BotBrain.prevZ[eid] = Position.z[eid];
      const wantedToMove =
        MovementIntent.moveX[eid] !== 0 || MovementIntent.moveZ[eid] !== 0;
      if (wantedToMove && movedSq < 0.005 * 0.005) {
        BotBrain.stuckTicks[eid] += 1;
      } else {
        BotBrain.stuckTicks[eid] = 0;
      }
      if (BotBrain.stuckTicks[eid] > 20 && tick >= BotBrain.detourUntilTick[eid]) {
        BotBrain.detourUntilTick[eid] = tick + 45;
        BotBrain.detourSign[eid] = (((tick * 2654435761) ^ eid) >>> 0) & 1;
        BotBrain.stuckTicks[eid] = 0;
      }
      const detouring = tick < BotBrain.detourUntilTick[eid];

      if (detouring && dist > meleeRange) {
        // Perpendicular strafe with a small forward bias so the path
        // rounds the obstacle's corner instead of orbiting it.
        const sign = BotBrain.detourSign[eid] === 1 ? 1 : -1;
        let sx = -uz * sign + ux * 0.4;
        let sz = ux * sign + uz * 0.4;
        const slen = Math.hypot(sx, sz) || 1;
        sx /= slen;
        sz /= slen;
        BotBrain.mode[eid] = BotMode.Approach;
        MovementIntent.moveX[eid] = sx * BOT_SPEED_FACTOR;
        MovementIntent.moveZ[eid] = sz * BOT_SPEED_FACTOR;
      } else if (dist > meleeRange) {
        BotBrain.mode[eid] = BotMode.Approach;
        MovementIntent.moveX[eid] = ux * BOT_SPEED_FACTOR;
        MovementIntent.moveZ[eid] = uz * BOT_SPEED_FACTOR;
      } else if (dist < PERSONAL_SPACE) {
        BotBrain.mode[eid] = BotMode.Reposition;
        MovementIntent.moveX[eid] = -ux * BOT_SPEED_FACTOR;
        MovementIntent.moveZ[eid] = -uz * BOT_SPEED_FACTOR;
      } else {
        BotBrain.mode[eid] = BotMode.Engage;
        MovementIntent.moveX[eid] = 0;
        MovementIntent.moveZ[eid] = 0;
      }

      // Swing: in range, FSM idle, cooldown elapsed. Goes through the same
      // transition API as a player click; stamina drains identically.
      if (dist <= meleeRange) {
        const fsm = fsmRegistry.get(eid);
        // lastSwingTick 0 = "never swung" (fixed ticks start at 1) — a
        // freshly spawned bot engages immediately instead of waiting out
        // a phantom cooldown against tick 0.
        const lastSwing = BotBrain.lastSwingTick[eid];
        if (
          fsm &&
          fsm.state === CombatState.Idle &&
          (lastSwing === 0 || tick - lastSwing >= SWING_COOLDOWN_TICKS)
        ) {
          fsm.transition(CombatInput.Attack, pickSwingDirection(tick, eid));
          BotBrain.lastSwingTick[eid] = tick;
        }
      }
    }
  };
}
