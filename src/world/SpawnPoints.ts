/**
 * SpawnPoints — registry + weighted-random selection of spawn points.
 *
 * Issue #134 / part of #93. This is the interface contract that issue #91
 * (arena map v1) will fill in with real arena-defined spawn locations.
 * Until then, `seedPlaceholderSpawnPoints()` registers four placeholder
 * points at `(±10, SPAWN_HEIGHT, ±10)` so the spawn/death/respawn loop
 * can be exercised end-to-end.
 *
 * Selection is "weighted away from enemies":
 *   1. Empty registry → null
 *   2. No enemies → uniform random pick from all candidates
 *   3. Else compute distance from each candidate to its NEAREST enemy.
 *      Filter to candidates ≥ `minEnemyDistance` (default 8.0). If any
 *      remain, uniform-random pick from that "safe" subset.
 *   4. Else fall back to the candidate that is FURTHEST from its nearest
 *      enemy (max-min). This guarantees a spawn even when the arena is
 *      packed.
 *
 * The `random: () => number` option is the seam tests inject so the
 * selection is deterministic. Production code calls Math.random by default.
 *
 * See `docs/spawn-death-respawn.md` for the full lifecycle and the
 * "Spawn-Point Registry" section that pins this interface.
 */

import { Position } from '../ecs/components';
import { SPAWN_HEIGHT } from '../core/types';

/**
 * A registered spawn location.
 *
 * - `id` is the registry key. Unique per registered point. Used by
 *   `RespawnEvent.spawnPointId` so consumers (telemetry, replays) can
 *   trace which point an entity spawned at.
 * - `position` is the FEET position the entity will be teleported to —
 *   matches the feet-origin spatial convention from #104. The Y here is
 *   used directly; entity factories no longer raycast through this path
 *   (the data IS the ground contact).
 * - `yaw` is the facing direction in radians. Three.js convention:
 *   yaw=0 looks down -Z, positive yaw rotates left.
 */
export interface SpawnPoint {
  id: number;
  position: { x: number; y: number; z: number };
  yaw: number;
}

/**
 * Side-table; populated by `registerSpawnPoint()` (called by the arena
 * factory at world-load time, or by `seedPlaceholderSpawnPoints()` until
 * #91 lands the real arena layout).
 *
 * Keyed by `SpawnPoint.id` so callers can look up a specific point if
 * they receive an id in a `RespawnEvent`. Tests `.clear()` between runs
 * via the exported `clearSpawnPoints()` helper.
 */
export const spawnPointRegistry = new Map<number, SpawnPoint>();

/**
 * Register a spawn point. Overwrites any existing point with the same id —
 * the arena factory and tests are the only producers, and both treat ids
 * as authoritative, so silent overwrite is the right behavior.
 */
export function registerSpawnPoint(point: SpawnPoint): void {
  spawnPointRegistry.set(point.id, point);
}

/**
 * Drop every registered spawn point. Production code shouldn't call this
 * (the arena owns its spawn points); tests use it to isolate cases.
 */
export function clearSpawnPoints(): void {
  spawnPointRegistry.clear();
}

/**
 * Options bag for `selectSpawnPoint()`.
 *
 * - `enemies` is a list of bitECS eids. Each must have the `Position`
 *   component; entities without one will read NaN/0 from the typed array
 *   and skew distance math, so callers (production: `processRespawns`)
 *   must filter their enemy list before passing it in.
 * - `minEnemyDistance` defaults to 8.0 (units = meters in our scale).
 *   The design doc value; bumping it requires retuning the arena, not
 *   this constant.
 * - `random` is the deterministic-test hook. Defaults to Math.random.
 */
export interface SpawnSelectionOptions {
  enemies: number[];
  minEnemyDistance?: number;
  random?: () => number;
}

const DEFAULT_MIN_ENEMY_DISTANCE = 8.0;

/**
 * Pick a spawn point per the "weighted away from enemies" algorithm.
 *
 * Returns null only if the registry is empty. Always returns SOMETHING
 * when at least one point is registered — the algorithm degrades to
 * max-min if no candidate clears the safe-distance threshold, so a
 * cramped arena still respawns the player.
 *
 * Distance is 3D Euclidean using `Math.sqrt`. We do the sqrt once per
 * candidate (a handful of points) so the API spec stays in plain meters.
 * If the registry ever scales beyond ~50 points, switch to squared
 * distance and a `minEnemyDistance²` threshold.
 */
export function selectSpawnPoint(
  options: SpawnSelectionOptions,
): SpawnPoint | null {
  const candidates = Array.from(spawnPointRegistry.values());
  if (candidates.length === 0) return null;

  const random = options.random ?? Math.random;
  const enemies = options.enemies;

  // Fast path: no enemies → uniform random across all candidates.
  if (enemies.length === 0) {
    return candidates[Math.floor(random() * candidates.length)];
  }

  const minEnemyDistance =
    options.minEnemyDistance ?? DEFAULT_MIN_ENEMY_DISTANCE;

  // For each candidate, compute distance to the NEAREST enemy. We need
  // both the value (to filter) and the same value again (for max-min
  // fallback), so cache.
  type Scored = { point: SpawnPoint; distToNearest: number };
  const scored: Scored[] = candidates.map((point) => ({
    point,
    distToNearest: distanceToNearestEnemy(point, enemies),
  }));

  const safe = scored.filter((s) => s.distToNearest >= minEnemyDistance);
  if (safe.length > 0) {
    return safe[Math.floor(random() * safe.length)].point;
  }

  // Max-min fallback: the candidate whose nearest enemy is furthest away.
  // No tie-breaker; if two candidates tie exactly, the first one wins
  // (deterministic for a given enemy layout, which is what tests want).
  let best = scored[0];
  for (let i = 1; i < scored.length; i++) {
    if (scored[i].distToNearest > best.distToNearest) best = scored[i];
  }
  return best.point;
}

/**
 * Internal: 3D Euclidean distance from a candidate spawn point to the
 * closest enemy in the supplied list.
 *
 * Returns +Infinity if the enemies list is empty, which is the convention
 * `selectSpawnPoint` relies on so the safe-filter unconditionally accepts
 * candidates when nobody's around. (The fast-path above shortcuts before
 * we ever get here, but keeping the convention is defensive.)
 */
function distanceToNearestEnemy(
  point: SpawnPoint,
  enemies: number[],
): number {
  let best = Infinity;
  for (let i = 0; i < enemies.length; i++) {
    const eid = enemies[i];
    const dx = point.position.x - Position.x[eid];
    const dy = point.position.y - Position.y[eid];
    const dz = point.position.z - Position.z[eid];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Seed four placeholder spawn points for development and tests, until the
 * real arena layout (#91) registers its own.
 *
 * Coordinates: (±10, SPAWN_HEIGHT, ±10) — the four corners of an interior
 * 20×20 square. Yaw faces roughly toward the origin via
 * `atan2(-position.x, -position.z)` (Three.js convention: yaw=0 looks
 * down -Z, positive yaw rotates left). For the corner at (10, _, 10) this
 * gives yaw = atan2(-10, -10) = -3π/4, i.e. looking toward the origin.
 *
 * Production note: SPAWN_HEIGHT is the deprecated alias of GROUND_TOP_Y
 * (= 0.1) per #104. These are FEET positions; pass them through to
 * `setNextKinematicTranslation` and `Position.y` directly without the
 * old +1.0 capsule-center offset.
 *
 * TODO(#91): replace these placeholders with the real arena-defined
 * spawn points when the arena map v1 lands.
 */
export function seedPlaceholderSpawnPoints(): void {
  const corners: Array<{ x: number; z: number }> = [
    { x: 10, z: 10 },
    { x: 10, z: -10 },
    { x: -10, z: 10 },
    { x: -10, z: -10 },
  ];
  for (let i = 0; i < corners.length; i++) {
    const { x, z } = corners[i];
    registerSpawnPoint({
      id: i + 1, // 1-based so id=0 stays the "no spawn point" sentinel
      position: { x, y: SPAWN_HEIGHT, z },
      yaw: Math.atan2(-x, -z),
    });
  }
}
