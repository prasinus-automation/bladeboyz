/**
 * Event payload types for the in-process EventBus (`src/events/EventBus.ts`).
 *
 * These match the event table in `docs/spawn-death-respawn.md`. When the
 * networking layer (#92) lands, server-authoritative events will be replayed
 * onto this same bus on the client; the payload shapes are stable.
 *
 * `bodyRegion`, `attackDirection`, and `weaponId` are stored as numbers
 * (enum / index values) so they survive the ECS / network-snapshot boundary
 * without needing string lookup tables. Consumers map them to display names
 * via the same registries that bitECS components use (`weaponIdToName`,
 * `BodyRegion` enum).
 */

import type { Direction } from '../combat/directions';
import type { BodyRegion } from '../ecs/components';

/**
 * EventType — string discriminator. Listed inline in `src/events/EventBus.ts`'s
 * `EventType` union; exported here too so tests / consumers don't have to
 * import from both files.
 */
export type EventType =
  | 'DamageDealt'
  | 'DeathEvent'
  | 'RespawnEvent'
  | 'WeaponEquipped'
  | 'WeaponDrop'
  | 'WeaponPickup'
  | 'WeaponDespawn';

/**
 * `DamageDealt` — emitted by `DamageSystem` after a non-blocked, non-parried
 * hit lands and HP has been decremented. Fires for every successful hit, NOT
 * just lethal ones (lethal hits also produce a `DeathEvent`).
 */
export interface DamageDealtPayload {
  /** Entity that took damage */
  victimEid: number;
  /** Entity that dealt the damage */
  attackerEid: number;
  /** HP delta applied (positive number) */
  amount: number;
  /** BodyRegion enum value of the part hit */
  bodyRegion: BodyRegion;
  /** Numeric weapon id (index into `weaponIdToName`) */
  weaponId: number;
  /** `Direction` enum value (FSM v2 #139) */
  attackDirection: Direction;
  /** True if this hit reduced victim HP to 0 */
  isLethal: boolean;
  /** Fixed-tick at which the damage was applied */
  tick: number;
}

/**
 * `DeathEvent` — emitted by `processDeaths` exactly once per death. Used by
 * Killfeed, DeathScreen, Score updaters, and analytics.
 *
 * `killerEid = 0` is the sentinel for "no killer" (suicide / fall damage /
 * environmental). Eid 0 is never a valid bitECS entity, so this is unambiguous.
 */
export interface DeathEventPayload {
  /** Entity that died */
  victimEid: number;
  /** Entity that scored the kill, or 0 if no recent attribution */
  killerEid: number;
  /** Numeric weapon id of the weapon that landed the killing blow, or 0 */
  weaponId: number;
  /** BodyRegion of the killing-blow hit, or 0 if no recent attribution */
  bodyRegion: BodyRegion;
  /** Fixed-tick of the death */
  tick: number;
}

/**
 * `RespawnEvent` — emitted by `processRespawns` (issue B) when the
 * RespawnPending timer expires and the entity is teleported to a new spawn.
 */
export interface RespawnEventPayload {
  /** Entity that respawned */
  eid: number;
  /** Spawn-point id from `spawnPointRegistry`, or 0 if none was selected */
  spawnPointId: number;
  /**
   * Yaw (radians) the entity was oriented to at the chosen spawn point. The
   * local player's camera consumes this to look along the spawn facing after
   * respawn (see main.ts RespawnEvent subscription) — `MovementSystem`
   * overwrites `Rotation.y` from the camera each tick, so setting the
   * component alone would be immediately clobbered. In-process only; not a
   * wire field.
   */
  yaw: number;
  /** Fixed-tick of the respawn */
  tick: number;
}

/**
 * `WeaponEquipped` — emitted by `InventorySystem.equipWeapon` after a
 * successful equip. Issue #130 only adds the type; the actual emit hook
 * lives in InventorySystem and is wired separately to keep the change
 * footprint here focused on the death pipeline.
 */
export interface WeaponEquippedPayload {
  eid: number;
  weaponId: number;
  weaponName: string;
}

/**
 * `WeaponDrop` — emitted by `dropEquippedWeapon` (called from `processDeaths`
 * for each dying Player/Bot) after a non-starter weapon has been laid on the
 * ground and the entity's inventory updated. Killfeed / scoreboard / analytics
 * can subscribe without having to walk the ECS for a fresh `WeaponPickup`
 * entity each tick.
 *
 * Networking note (#92): when the server takes ownership of pickup state,
 * this same payload is replayed on the client receive path so HUD code
 * doesn't have to branch on local-vs-server origin.
 */
export interface WeaponDropPayload {
  /** Entity that dropped the weapon (the dying player/bot) */
  sourceEid: number;
  /** Canonical weapon name dropped */
  weaponName: string;
  /** Drop position (feet of the source entity) */
  position: [number, number, number];
  /** Fixed-tick of the drop */
  tick: number;
}

/**
 * `WeaponPickup` — emitted by `weaponPickupSystem` when a player successfully
 * claims a ground pickup via KeyE. The pickup entity is removed from the
 * scene and the player's equipped weapon swaps in the same tick.
 */
export interface WeaponPickupPayload {
  /** The pickup ECS entity that was consumed (now removed) */
  pickupEid: number;
  /** Player entity that claimed the pickup */
  playerEid: number;
  /** Canonical weapon name that was picked up */
  weaponName: string;
  /** Fixed-tick of the claim */
  tick: number;
}

/**
 * `WeaponDespawn` — emitted by `weaponPickupSystem` when a pickup expires
 * past its `despawnTick` and is swept from the scene. Used by analytics / HUD
 * code that needs to know the pickup is gone (the renderer itself doesn't
 * subscribe — it iterates `pickupRegistry` and naturally drops removed entries).
 */
export interface WeaponDespawnPayload {
  /** The pickup ECS entity that timed out */
  pickupEid: number;
  /** Fixed-tick of the despawn */
  tick: number;
}

/**
 * Convenience map from event type name → payload type. Used by EventBus's
 * generic on/emit signatures so consumers get type-safe payloads.
 */
export interface EventPayloadMap {
  DamageDealt: DamageDealtPayload;
  DeathEvent: DeathEventPayload;
  RespawnEvent: RespawnEventPayload;
  WeaponEquipped: WeaponEquippedPayload;
  WeaponDrop: WeaponDropPayload;
  WeaponPickup: WeaponPickupPayload;
  WeaponDespawn: WeaponDespawnPayload;
}
