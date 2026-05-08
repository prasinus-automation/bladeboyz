/**
 * Arena type definitions — stub interface for Arena v1 (#91).
 *
 * Implementation lives in `./createArena.ts` (created by the implementation
 * sub-issue). See `docs/arena-v1.md` for the full design doc, including
 * dimensions, spawn-point coordinates, and the shopkeep stall layout.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Axis-aligned bounding box in world space. */
export interface Volume3D {
  min: Vec3;
  max: Vec3;
}

/** A single spawn point. `position.y` is capsule-center y (matches `SPAWN_HEIGHT`). */
export interface SpawnPoint {
  /** Stable identifier, e.g. "s1".."s6". */
  id: string;
  /** Spawn position in world space. */
  position: Vec3;
  /** Yaw in radians the player faces on spawn. 0 = facing -Z (north). */
  facing: number;
}

/** Spec for the shopkeep stall structure (counter + NPC anchor). */
export interface ShopkeepStallSpec {
  /** AABB of the physical counter prop (collision-blocking). */
  counter: Volume3D;
  /** Where the shopkeep entity stands behind the counter. */
  npcAnchor: Vec3;
  /** Yaw (radians) the shopkeep faces; 0 = facing -Z (north / arena interior). */
  facing: number;
}

/**
 * Runtime spec describing an arena instance. Returned by `createArena()` and
 * stored on `GameWorld.arena` for systems (spawn, weapon-pickup, shopkeep AI)
 * to query without importing arena internals.
 */
export interface ArenaSpec {
  /** Discriminator for future multi-arena support. */
  name: 'arena_v1';
  /** Top surface y of the ground plane. Currently `0.1` to preserve `SPAWN_HEIGHT`. */
  groundHeight: number;
  /** Outer playable AABB (inside the walls). */
  bounds: Volume3D;
  /** Spawn points for player respawns. v1: 6 points, mirror-symmetric across z=0. */
  spawnPoints: SpawnPoint[];
  /** Shopkeep stall location & NPC anchor. */
  shopkeepStall: ShopkeepStallSpec;
  /**
   * AABB inside which dropped weapons are considered "in-bounds". Any weapon
   * pickup entity whose position exits this volume (or whose `y < 0`) should
   * be teleported to a safe in-bounds position by the weapon-pickup system.
   */
  weaponPickupSafeVolume: Volume3D;
}
