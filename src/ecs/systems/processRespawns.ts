/**
 * processRespawns — runs in fixedUpdate immediately after `processDeaths`.
 *
 * For each entity in the `respawned` array (entities whose RespawnPending
 * timer just hit 0 in `healthSystemTick`), we:
 *
 *   1. Build the live-enemy list (Player- or Bot-tagged combatants with
 *      Position, no DeadTag, excluding the respawning eid itself) and
 *      pick a spawn point via `selectSpawnPoint` (weighted away from
 *      enemies — see `src/world/SpawnPoints.ts`).
 *   2. Teleport: write `Position`, `Rotation.y`, AND `PreviousPosition`
 *      (the last is critical — without it the render-tick interpolation
 *      tweens the player from death location to spawn point over one
 *      frame, producing a visible jump artifact).
 *   3. Drive the Rapier kinematic body to the new feet position via
 *      `setNextKinematicTranslation`. The body is found via
 *      `getPhysicsBody(eid)` (NOT `world.physicsWorld.getRigidBody(handle)`
 *      — see comment on `getPhysicsBody` for why).
 *   4. Restore `Health.current = Health.max` and `Stamina.current = Stamina.max`.
 *      `processDeaths` already zeroed `Velocity` and reset the FSM, so
 *      we don't redo those.
 *   5. Reset the per-entity stamina regen-delay clock so the first
 *      action after respawn doesn't carry over the previous life's timing.
 *   6. Equip the default starter weapon. `processDeaths` may eventually
 *      drop the weapon (via `dropEquippedWeapon` once #94 lands); this
 *      guarantees the respawn always lands armed.
 *   7. Remove `DeadTag` and `RespawnPending`. Until both are removed,
 *      CombatSystem and MovementSystem keep early-skipping the entity.
 *   8. Emit a `RespawnEvent` on the EventBus so HUDs (DeathScreen,
 *      Killfeed) can react.
 *
 * If the spawn-point registry is empty (selectSpawnPoint returns null),
 * we log a warning and skip that eid. The entity stays dead-tagged on the
 * field — the registry should be seeded at world-load time, so an empty
 * registry is a config error, not a runtime concern. Tests cover this
 * branch via the placeholder helper.
 *
 * See `docs/spawn-death-respawn.md` and issue #134.
 */

import { defineQuery, hasComponent, removeComponent } from 'bitecs';
import {
  Position,
  PreviousPosition,
  Rotation,
  Health,
  Stamina,
  Player,
  Bot,
  DeadTag,
  RespawnPending,
} from '../components';
import type { GameWorld } from '../../core/types';
import { selectSpawnPoint } from '../../world/SpawnPoints';
import { EventBus } from '../../events/EventBus';
import { getCurrentFixedTick } from '../../core/tickCounter';
import { getPhysicsBody } from './MovementSystem';
import { resetEntityStaminaTracking } from './StaminaSystem';
import { equipDefaultStarter } from './InventorySystem';

/**
 * Combatant query — entities with Position that are tagged Player or Bot
 * AND aren't currently dead. Used to build the "enemies" list passed into
 * `selectSpawnPoint`.
 *
 * We separate the Player and Bot queries because bitECS queries are
 * conjunctive (every component must be present) — there's no built-in OR.
 * Two queries + dedupe is cheaper than tagging every combatant with a
 * shared `Combatant` marker just for this lookup.
 */
const playerCombatantQuery = defineQuery([Position, Player]);
const botCombatantQuery = defineQuery([Position, Bot]);

/**
 * Process the respawn-cleanup hook for every entity in `respawned` this tick.
 *
 * Called from main.ts immediately after `processDeaths(died, world)` so the
 * order on a tick where the same entity dies AND respawns (impossible today
 * — respawn delay is 180 ticks — but defensive against future timing
 * changes) is death-side first, respawn-side second.
 */
export function processRespawns(
  respawned: number[],
  world: GameWorld,
): void {
  if (respawned.length === 0) return;

  const tick = getCurrentFixedTick();

  // Build the live-combatant set ONCE per tick rather than per-eid: in the
  // (already rare) case where multiple players respawn on the same tick,
  // they all see the same enemy snapshot, which is the right answer
  // game-state-wise (all decisions are based on "state at tick boundary").
  const liveCombatants = collectLiveCombatants(world);

  for (let i = 0; i < respawned.length; i++) {
    const eid = respawned[i];

    // Build enemies list = live combatants minus self. The respawning
    // entity is still DeadTag'd at this point so it's already excluded
    // from `collectLiveCombatants`, but the explicit filter is defensive
    // against future changes that might un-tag earlier in the pipeline.
    const enemies = liveCombatants.filter((other) => other !== eid);

    const sp = selectSpawnPoint({ enemies });
    if (!sp) {
      // Empty registry — config error. Don't teleport, don't restore HP,
      // don't remove DeadTag. Entity stays on the floor; player-side this
      // means the death overlay sticks. Logging once per offending eid is
      // enough to surface the misconfig in dev.
      // eslint-disable-next-line no-console
      console.warn(
        `[processRespawns] no spawn points registered; skipping respawn for eid=${eid}`,
      );
      continue;
    }

    // 2. Teleport ECS Position + Rotation. Update PreviousPosition too —
    // without this the render-tick interpolation between PreviousPosition
    // and Position would tween the model from death location to spawn
    // point over one frame (visible jump). Match yaw via Rotation.y; we
    // intentionally don't touch pitch/roll (camera owns those for the
    // local player; bots/AI keep whatever they had).
    Position.x[eid] = sp.position.x;
    Position.y[eid] = sp.position.y;
    Position.z[eid] = sp.position.z;
    PreviousPosition.x[eid] = sp.position.x;
    PreviousPosition.y[eid] = sp.position.y;
    PreviousPosition.z[eid] = sp.position.z;
    Rotation.y[eid] = sp.yaw;

    // 3. Drive the Rapier body to match. Without this, ECS Position
    // would be at the spawn point but the kinematic body would still
    // be at the death location — first MovementSystem tick would write
    // Position back from body.translation() and the player would teleport
    // back to where they died.
    const body = getPhysicsBody(eid);
    if (body) {
      body.setNextKinematicTranslation({
        x: sp.position.x,
        y: sp.position.y,
        z: sp.position.z,
      });
    }
    // Note: we don't error on a missing body. Tests build entities
    // without physics for unit isolation, and a missing body just means
    // ECS-only state was restored (which is what tests assert).

    // 4. Restore HP/Stamina to max. processDeaths zeroed Velocity already.
    if (hasComponent(world.ecs, Health, eid)) {
      Health.current[eid] = Health.max[eid];
    }
    if (hasComponent(world.ecs, Stamina, eid)) {
      Stamina.current[eid] = Stamina.max[eid];
    }

    // 5. Wipe the per-entity stamina regen-delay clock. See the
    // resetEntityStaminaTracking docstring for why this matters.
    resetEntityStaminaTracking(eid);

    // 6. Equip the default starter weapon. equipDefaultStarter adds it
    // to inventory if missing, so respawn always lands armed even after
    // #94's drop-on-death clears the previous weapon.
    equipDefaultStarter(eid);

    // 7. Remove the lifecycle tags so CombatSystem / MovementSystem stop
    // early-skipping the entity. removeComponent is idempotent in bitECS
    // (no-op if absent), so the order is safe.
    removeComponent(world.ecs, DeadTag, eid);
    removeComponent(world.ecs, RespawnPending, eid);

    // 8. Emit RespawnEvent for HUD subscribers. Keep payload minimal —
    // the spawn-point id lets analytics correlate to a specific arena
    // location without re-encoding coordinates.
    EventBus.emit('RespawnEvent', {
      eid,
      spawnPointId: sp.id,
      tick,
    });
  }
}

/**
 * Internal: collect every live combatant (Player or Bot, no DeadTag,
 * with a Position component). Two queries + dedupe via Set because
 * bitECS queries are conjunctive.
 */
function collectLiveCombatants(world: GameWorld): number[] {
  const seen = new Set<number>();
  const players = playerCombatantQuery(world.ecs);
  for (let i = 0; i < players.length; i++) {
    const eid = players[i];
    if (!hasComponent(world.ecs, DeadTag, eid)) seen.add(eid);
  }
  const bots = botCombatantQuery(world.ecs);
  for (let i = 0; i < bots.length; i++) {
    const eid = bots[i];
    if (!hasComponent(world.ecs, DeadTag, eid)) seen.add(eid);
  }
  return Array.from(seen);
}
