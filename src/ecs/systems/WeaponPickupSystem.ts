/**
 * WeaponPickupSystem — proximity pickup (KeyE) + despawn sweep (#121).
 *
 * Drop-on-death lives in `dropEquippedWeapon` (this file's sibling in
 * `InventorySystem.ts`), called by `processDeaths` for every dying
 * Player/Bot. This system handles ONLY:
 *
 *   (b) Pickup attempt: edge-detect KeyE press → find closest pickup in
 *       range → validate via `tryClaimPickup` → swap inventory + equip,
 *       dropping the previously-equipped weapon at the player's feet.
 *
 *   (c) Despawn sweep: any pickup whose `despawnTick` has passed is removed
 *       from the scene + ECS world, freeing geometries/materials.
 *
 * ## `tryClaimPickup` — the networking seam
 *
 * All MVP validation logic lives in `tryClaimPickup`. It is a pure function
 * (no scene mutation, no inventory writes, no event emit) so when the
 * networking layer (#92) lands, the server can call this exact predicate
 * against authoritative state and the client doesn't change. The KeyE
 * handler reads the result and performs the actual mutation; on the server
 * side the same result becomes a replicated snapshot delta.
 *
 * Validation rules (all must pass):
 *   - pickup exists in `pickupRegistry`
 *   - player exists (Position is readable — we don't gate on `Player` tag
 *     because future bot pickup logic can reuse this)
 *   - 3D Euclidean distance ≤ `PICKUP_RADIUS`
 *   - `currentTick >= pickup.spawnTick` (claim cooldown elapsed)
 *   - `currentTick < pickup.despawnTick` (pickup not yet expired)
 *   - player's combat FSM is in `Idle` — same gate as `equipWeapon` itself,
 *     pulled forward so we can reject before any mutation
 *
 * ## Visibility / pickup parity
 *
 * `PickupPrompt.update` runs the same proximity + Idle + pointer-lock check
 * to decide whether to show the "Press [E] to pick up X" overlay. The
 * acceptance criterion is "when the prompt is showing, KeyE must always
 * succeed; when it's hidden, KeyE must always fail". The prompt module
 * still owns its closest-in-range search (it needs a name to render),
 * but the *predicate* — pointer-lock, Idle, in-range — must stay 1:1
 * with what `tryClaimPickup` enforces here.
 */

import { defineQuery, hasComponent } from 'bitecs';
import { Position, WeaponPickup, Player, Bot } from '../components';
import { fsmRegistry } from '../../combat/CombatFSM';
import { CombatState } from '../../combat/states';
import {
  createWeaponPickup,
  removeWeaponPickup,
} from '../entities/createWeaponPickup';
import { pickupRegistry } from '../../inventory/PickupRegistry';
import {
  addWeaponToInventory,
  equipWeapon,
  inventoryRegistry,
  removeWeaponFromInventory,
} from './InventorySystem';
import { EventBus } from '../../events/EventBus';
import type { InputManager } from '../../input/InputManager';
import type { GameWorld } from '../../core/types';
import type {
  WeaponDespawnPayload,
  WeaponPickupPayload,
} from '../../events/types';

// ── Pickup timeline constants ─────────────────────────────
//
// Moved here from `PickupRenderer.ts` per #121's "single source of truth"
// directive. `PickupRenderer.ts` and `PickupPrompt.ts` re-import — so the
// despawn timer here can never drift from the blink-fade window in the
// renderer or the proximity check in the HUD prompt.

/** Total ticks a pickup lives on the ground before despawning. 30s @ 60Hz. */
export const DESPAWN_TICKS = 1800;

/** How many ticks before despawn the blink+fade warning starts. 5s @ 60Hz. */
export const BLINK_TICKS = 300;

/**
 * 3D Euclidean radius (meters) within which a player can pick up a weapon.
 * Shared with `PickupPrompt` so the prompt visibility and the actual KeyE
 * predicate stay in sync.
 */
export const PICKUP_RADIUS = 1.5;

/**
 * Ticks between a weapon being dropped at the player's feet (via a pickup
 * swap) and it becoming claimable again. Prevents the immediately-dropped
 * weapon from being re-picked-up on the same KeyE press (since pickup
 * happens AFTER drop in `claimPickup`). 0.5s @ 60Hz.
 */
export const PICKUP_COOLDOWN_TICKS = 30;

/** Pre-squared radius — squared-distance compare in the hot path. */
const PICKUP_RADIUS_SQ = PICKUP_RADIUS * PICKUP_RADIUS;

// ── Public event shape (return) ───────────────────────────

/**
 * A successful pickup outcome. Returned from `tryClaimPickup` and also
 * emitted on `EventBus.emit('WeaponPickup', ...)` for HUD/scoreboard/
 * analytics consumers. The `WeaponDespawnEvent` is parallel for sweep.
 */
export type WeaponPickupEvent = WeaponPickupPayload;
export type WeaponDespawnEvent = WeaponDespawnPayload;

// ── Edge-detect state for KeyE ────────────────────────────
//
// Module-level — matches the pattern used by other systems that need
// rising-edge input detection (CombatSystem's mouse-button prevState
// fields at CombatSystem.ts:53-54). When networking lands, this state
// moves into a per-connection InputBuffer; for single-player MVP a
// module-level flag is fine.

let prevKeyEDown = false;

/**
 * Reset module-level state (test helper / hot-reload safety). Production
 * code never calls this. Matches the pattern of `resetInventorySystem`,
 * `resetPickupRegistry`, etc.
 */
export function resetWeaponPickupSystem(): void {
  prevKeyEDown = false;
}

// ── Pure validation (networking seam) ─────────────────────

/**
 * Validate a pickup claim against current world state. Returns the event
 * payload on success, `null` on any rejection.
 *
 * **Pure** — does not mutate the world, inventory, scene, or registry.
 * Calling it twice with the same args returns equal events and leaves
 * everything untouched. This is the entire point of the function: when
 * networking lands (#92), the server runs this exact predicate against
 * authoritative state and only the client→server input delivery changes.
 *
 * Failure modes are intentionally silent — callers may call this every
 * frame for visibility checks, and warning-logging every miss would spam.
 */
export function tryClaimPickup(
  playerEid: number,
  pickupEid: number,
  currentTick: number,
  world: GameWorld,
): WeaponPickupEvent | null {
  // 1. Pickup must exist in the registry.
  const pickupData = pickupRegistry.get(pickupEid);
  if (!pickupData) return null;

  // 2. Pickup ECS-side state must agree with the registry (a foundation
  // invariant — they're written together by `createWeaponPickup` — but
  // guards against an orphaned registry entry post-removeEntity).
  if (!hasComponent(world.ecs, WeaponPickup, pickupEid)) return null;

  // 3. Claim cooldown — just-dropped pickups are invisible to claim until
  // `PICKUP_COOLDOWN_TICKS` have elapsed.
  const spawnTick = WeaponPickup.spawnTick[pickupEid];
  if (currentTick < spawnTick) return null;

  // 4. Expired — past `despawnTick`, the renderer is fading it out and
  // the next sweep tick will remove it. Don't let the player claim a
  // ghost mid-fade.
  const despawnTick = WeaponPickup.despawnTick[pickupEid];
  if (currentTick >= despawnTick) return null;

  // 5. Distance gate — 3D Euclidean, squared-distance compare against
  // `PICKUP_RADIUS`. Matches PickupPrompt's metric exactly.
  const dx = Position.x[pickupEid] - Position.x[playerEid];
  const dy = Position.y[pickupEid] - Position.y[playerEid];
  const dz = Position.z[pickupEid] - Position.z[playerEid];
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq > PICKUP_RADIUS_SQ) return null;

  // 6. FSM must be Idle. Reading the registry directly (instead of
  // CombatStateComp.state) so the gate matches what `equipWeapon` will
  // check inside its own body — no race where the FSM has moved but the
  // ECS mirror hasn't.
  const fsm = fsmRegistry.get(playerEid);
  if (fsm && fsm.state !== CombatState.Idle) return null;

  // All checks passed. Build the event payload (caller is responsible for
  // mutating world state + emitting on EventBus).
  return {
    pickupEid,
    playerEid,
    weaponName: pickupData.weaponName,
    tick: currentTick,
  };
}

/**
 * Shared closest-in-range scan. Returns the ECS id of the nearest pickup
 * to `playerEid` (within `PICKUP_RADIUS`), or `null` if none. Identical
 * geometry/metric to `PickupPrompt.update`'s search loop. Exposed so the
 * prompt and the KeyE handler can pin to the same result if a future
 * refactor wants to dedupe.
 */
export function findClosestPickup(playerEid: number): number | null {
  if (pickupRegistry.size === 0) return null;
  const px = Position.x[playerEid];
  const py = Position.y[playerEid];
  const pz = Position.z[playerEid];
  let closestSq = PICKUP_RADIUS_SQ + 1; // sentinel just past radius
  let closestEid: number | null = null;
  for (const [eid] of pickupRegistry) {
    const dx = Position.x[eid] - px;
    const dy = Position.y[eid] - py;
    const dz = Position.z[eid] - pz;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq <= PICKUP_RADIUS_SQ && distSq < closestSq) {
      closestSq = distSq;
      closestEid = eid;
    }
  }
  return closestEid;
}

// ── Mutating helpers ──────────────────────────────────────

/**
 * Execute a validated pickup claim. Mutates inventory + spawns/removes
 * pickup entities + emits on `EventBus`. Returns the event on success,
 * `null` if the claim was rejected (defense in depth — the caller
 * already validated via `tryClaimPickup`).
 *
 * Side-effect ordering matters: the OLD weapon's pickup is spawned FIRST
 * (with `spawnTick = currentTick + PICKUP_COOLDOWN_TICKS` so it's
 * invisible to claim this tick), then the OLD weapon is removed from
 * inventory, then the NEW weapon is added + equipped, then the original
 * pickup is removed. Doing the old-drop first keeps the inventory
 * invariant "equippedWeapon ∈ weapons || equippedWeapon === null" true
 * at every intermediate step.
 */
function claimPickup(
  world: GameWorld,
  event: WeaponPickupEvent,
  currentTick: number,
): WeaponPickupEvent | null {
  const { playerEid, pickupEid, weaponName } = event;

  const inv = inventoryRegistry.get(playerEid);
  if (!inv) return null;

  // 1. If the player has a current equipped weapon AND it's not the
  // starter, drop it at the player's feet with the claim cooldown.
  const currentWeapon = inv.equippedWeapon;
  if (currentWeapon !== null && currentWeapon !== inv.starterWeapon) {
    createWeaponPickup(world, {
      weaponName: currentWeapon,
      position: {
        x: Position.x[playerEid],
        y: Position.y[playerEid],
        z: Position.z[playerEid],
      },
      spawnTick: currentTick + PICKUP_COOLDOWN_TICKS,
      despawnTick: currentTick + PICKUP_COOLDOWN_TICKS + DESPAWN_TICKS,
    });
    // Also emit a WeaponDrop event so the killfeed/analytics see the
    // dropped weapon (matches the death-pipeline drop semantics).
    EventBus.emit('WeaponDrop', {
      sourceEid: playerEid,
      weaponName: currentWeapon,
      position: [
        Position.x[playerEid],
        Position.y[playerEid],
        Position.z[playerEid],
      ],
      tick: currentTick,
    });
    removeWeaponFromInventory(playerEid, currentWeapon);
  }

  // 2. Add the new weapon to inventory + equip. `equipWeapon` is the
  // single chokepoint that does the model swap, viewmodel swap (via
  // onEquip listener), FSM config update, ECS weaponId mirror write.
  addWeaponToInventory(playerEid, weaponName);
  const equipped = equipWeapon(playerEid, weaponName);
  if (!equipped) {
    // Defensive — `tryClaimPickup` already verified FSM is Idle, so this
    // shouldn't trigger. Logged at warn so a future FSM addition that
    // changes the Idle gate surfaces clearly.
    console.warn(
      `[WeaponPickupSystem] equipWeapon rejected ${weaponName} on eid ${playerEid} after tryClaimPickup passed — investigate FSM gate divergence`,
    );
    // Don't remove the pickup — let it remain claimable on a later tick.
    return null;
  }

  // 3. Remove the original pickup. `removeWeaponPickup` is no-op safe
  // and disposes geometries/materials.
  removeWeaponPickup(world, pickupEid);

  // 4. Emit on EventBus so HUD/scoreboard/analytics see it. Same payload
  // shape as the return value.
  EventBus.emit('WeaponPickup', event);

  return event;
}

// ── The system ────────────────────────────────────────────

const pickupQuery = defineQuery([WeaponPickup]);

/**
 * Run the pickup + despawn loop once per fixed tick.
 *
 * @param world         GameWorld (scene + ecs for entity ops)
 * @param currentTick   Result of `getCurrentFixedTick()` — passed in so
 *                      tests can drive the system deterministically
 *                      without advancing the global counter.
 * @param inputManager  InputManager for the local player (KeyE).
 *                      In a future multi-controller world this would be
 *                      per-entity; for the single-player MVP one global
 *                      mapper is fine.
 * @param playerEid     The local player's ECS id.
 * @returns             `{ pickups, despawns }` — arrays of events that
 *                      fired this tick. Useful for synchronous test
 *                      assertions; equivalent events also went out on
 *                      the `EventBus` for declarative consumers.
 */
export function weaponPickupSystem(
  world: GameWorld,
  currentTick: number,
  inputManager: InputManager,
  playerEid: number,
): {
  pickups: WeaponPickupEvent[];
  despawns: WeaponDespawnEvent[];
} {
  const pickups: WeaponPickupEvent[] = [];
  const despawns: WeaponDespawnEvent[] = [];

  // ── (a) Pickup attempt — edge-detect KeyE press ──
  //
  // `InputManager.isKeyDown` returns `true` for every tick the key is
  // held; we only want to fire on rising edge. `prevKeyEDown` is the
  // single-tick latch. `paused` is honored by `isKeyDown` itself (it
  // returns false when paused), so any modal overlay automatically
  // suppresses pickup.
  const eDown = inputManager.isKeyDown('KeyE');
  if (eDown && !prevKeyEDown) {
    const pickupEid = findClosestPickup(playerEid);
    if (pickupEid !== null) {
      const event = tryClaimPickup(playerEid, pickupEid, currentTick, world);
      if (event !== null) {
        const result = claimPickup(world, event, currentTick);
        if (result !== null) {
          pickups.push(result);
        }
      }
    }
  }
  prevKeyEDown = eDown;

  // ── (b) Despawn sweep — any pickup past despawnTick is removed ──
  //
  // Iterate the bitECS query rather than the registry Map so any
  // orphaned-entity-without-registry-entry case still drops. Build a
  // local array first; removing entities mid-query iteration is unsafe.
  const ents = pickupQuery(world.ecs);
  let expiredCount = 0;
  // Two-pass to avoid mutating the array we're iterating: first count,
  // then collect, then remove.
  for (let i = 0; i < ents.length; i++) {
    if (WeaponPickup.despawnTick[ents[i]] <= currentTick) expiredCount++;
  }
  if (expiredCount > 0) {
    const expired: number[] = new Array(expiredCount);
    let j = 0;
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i];
      if (WeaponPickup.despawnTick[eid] <= currentTick) {
        expired[j++] = eid;
      }
    }
    for (let i = 0; i < expired.length; i++) {
      const eid = expired[i];
      removeWeaponPickup(world, eid);
      const payload: WeaponDespawnEvent = { pickupEid: eid, tick: currentTick };
      despawns.push(payload);
      EventBus.emit('WeaponDespawn', payload);
    }
  }

  return { pickups, despawns };
}

// ── Internal — Player/Bot gate (unused today, here for symmetry) ──

/**
 * Same Player|Bot gate used by `processDeaths`. Currently we don't apply
 * it on the pickup side because pickup is locally driven by the single
 * `playerEid` passed in — but the helper exists so future bot pickup AI
 * can re-use the predicate without re-importing both component tags.
 */
export function canEntityPickup(world: GameWorld, eid: number): boolean {
  return (
    hasComponent(world.ecs, Player, eid) || hasComponent(world.ecs, Bot, eid)
  );
}
