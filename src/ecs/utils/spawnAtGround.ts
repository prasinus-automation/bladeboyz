import type RAPIER from '@dimforge/rapier3d-compat';
import type { GameWorld } from '../../core/types';
import { CHARACTER_CONTROLLER_OFFSET } from '../../core/types';
import { getGroundHeightAt } from '../../arena/types';

/**
 * Cast a downward ray from above the terrain and return the feet Y position.
 *
 * The cast origin is derived from the arena bounds (`max.y + margin`, floored
 * at the legacy 50) so it clears the tallest Arena v2 terrain feature; the
 * `maxToi` is extended to match. Adds a small `CHARACTER_CONTROLLER_OFFSET`
 * epsilon above the hit so the kinematic character controller has room to
 * settle without immediately intersecting the ground.
 *
 * Fallback (raycast can't run, or misses — e.g. spawning over a hole):
 *   - Arena present → deterministic `getGroundHeightAt(arena, x, z)` + offset
 *     (safe because the terrain sampler is shared client/server).
 *   - No arena       → `GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET`
 *     (mock/test worlds), preserving pre-#206 behavior — `getGroundHeightAt`
 *     returns `GROUND_TOP_Y` when `arena` is undefined.
 *
 * Used by entity factories (player, dummy, shopkeep, future NPCs) so spawn Y
 * isn't hard-coded — the entity always lands on whatever surface is directly
 * below its (x, z). NOTE: no collider filtering yet (pre-existing limitation,
 * out of scope for #206) — the ray hits the first collider below.
 */
export function spawnAtGround(
  world: Pick<GameWorld, 'rapier' | 'physicsWorld' | 'arena'>,
  x: number,
  z: number,
): { x: number; y: number; z: number } {
  const arena = world.arena;
  const fallback = getGroundHeightAt(arena, x, z) + CHARACTER_CONTROLLER_OFFSET;

  // The cast should be straightforward but we defensively guard each
  // optional dependency so that test environments without a real Rapier
  // world (or with a mocked physicsWorld that lacks .castRay) still get
  // a sane fallback rather than throwing.
  const rapier = world.rapier;
  const physicsWorld = world.physicsWorld;
  if (!rapier || !physicsWorld || typeof (physicsWorld as any).castRay !== 'function') {
    return { x, y: fallback, z };
  }

  // Start the cast above the tallest terrain feature. Arena bounds carry the
  // headroom max-y; add a 20m margin and never drop below the legacy 50 (so
  // flat Arena v1 / mock worlds cast from exactly y = 50 as before).
  const castOrigin = Math.max(50, (arena?.bounds?.max?.y ?? 0) + 20);

  try {
    const origin = new rapier.Vector3(x, castOrigin, z);
    const dir = new rapier.Vector3(0, -1, 0);
    const ray = new rapier.Ray(origin, dir);
    const hit: RAPIER.RayColliderHit | null = (physicsWorld as RAPIER.World).castRay(
      ray,
      castOrigin + 50, // max toi — reach well below y = 0
      true, // solid
    );

    if (hit) {
      const groundY = castOrigin - hit.timeOfImpact;
      return { x, y: groundY + CHARACTER_CONTROLLER_OFFSET, z };
    }
  } catch {
    // Defensive: any raycast failure (mock world, missing Vector3, etc.)
    // falls through to the constant fallback.
  }

  return { x, y: fallback, z };
}
