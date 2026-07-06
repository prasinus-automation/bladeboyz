/**
 * Arena type definitions — stub interface for Arena v1 (#91).
 *
 * Implementation lives in `./createArena.ts` (created by the implementation
 * sub-issue). See `docs/arena-v1.md` for the full design doc, including
 * dimensions, spawn-point coordinates, and the shopkeep stall layout.
 *
 * Terrain support (#206): `ArenaSpec.terrain` is an optional variable-height
 * ground. Every fixed system that needs ground height MUST go through the
 * `getGroundHeightAt` accessor below — never read `groundHeight` directly —
 * so flat Arena v1 and heightfield Arena v2 share one code path.
 */

import { GROUND_TOP_Y } from '../core/types';
import type { TerrainHandle } from './terrain';

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
  /**
   * Discriminator for multi-arena support. `'arena_v1'` today; Arena v2 and
   * future maps get their own names. Widened from the `'arena_v1'` literal in
   * #206 so a heightfield map can identify itself.
   */
  name: string;
  /**
   * Flat-ground fallback: the top-surface y used when {@link ArenaSpec.terrain}
   * is absent (Arena v1). `0.1` = `GROUND_TOP_Y`. When `terrain` is present it
   * is authoritative and this value is ignored — query {@link getGroundHeightAt}
   * instead of reading either field directly.
   */
  groundHeight: number;
  /**
   * Optional variable-height terrain (Arena v2+). When present, ground height
   * varies with (x, z) via the deterministic sampler; when absent the arena is
   * flat at {@link ArenaSpec.groundHeight} (Arena v1). Issue #206.
   */
  terrain?: TerrainHandle;
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

/**
 * The single ground-height accessor every fixed system uses.
 *
 * - Terrain present  → deterministic `terrain.sample(x, z)` (Arena v2+).
 * - Terrain absent   → flat `arena.groundHeight` (Arena v1).
 * - No arena at all   → `GROUND_TOP_Y` (test environments that construct a
 *   bare `GameWorld`), preserving pre-#206 behavior byte-for-byte.
 *
 * Pure and allocation-free — safe to call every tick, per entity.
 */
export function getGroundHeightAt(
  arena: ArenaSpec | undefined,
  x: number,
  z: number,
): number {
  if (!arena) return GROUND_TOP_Y;
  if (arena.terrain) return arena.terrain.sample(x, z);
  return arena.groundHeight;
}
