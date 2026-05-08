import type RAPIER from '@dimforge/rapier3d-compat';
import type { GameWorld } from '../../core/types';
import { CHARACTER_CONTROLLER_OFFSET, GROUND_TOP_Y } from '../../core/types';

/**
 * Cast a downward ray from (x, 50, z) and return the feet Y position.
 *
 * Adds a small `CHARACTER_CONTROLLER_OFFSET` epsilon above the hit so the
 * kinematic character controller has room to settle without immediately
 * intersecting the ground.
 *
 * Falls back to `GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET` if the
 * raycast misses (e.g. spawning over a hole) or if the physics-world
 * raycast API is unavailable in the host environment (tests).
 *
 * Used by entity factories (player, dummy, future NPCs) so spawn Y
 * isn't hard-coded — the entity always lands on whatever surface is
 * directly below its (x, z).
 */
export function spawnAtGround(
  world: Pick<GameWorld, 'rapier' | 'physicsWorld'>,
  x: number,
  z: number,
): { x: number; y: number; z: number } {
  const fallback = GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET;

  // The cast should be straightforward but we defensively guard each
  // optional dependency so that test environments without a real Rapier
  // world (or with a mocked physicsWorld that lacks .castRay) still get
  // a sane fallback rather than throwing.
  const rapier = world.rapier;
  const physicsWorld = world.physicsWorld;
  if (!rapier || !physicsWorld || typeof (physicsWorld as any).castRay !== 'function') {
    return { x, y: fallback, z };
  }

  try {
    const origin = new rapier.Vector3(x, 50, z);
    const dir = new rapier.Vector3(0, -1, 0);
    const ray = new rapier.Ray(origin, dir);
    const hit: RAPIER.RayColliderHit | null = (physicsWorld as RAPIER.World).castRay(
      ray,
      100, // max toi
      true, // solid
    );

    if (hit) {
      const groundY = 50 - hit.timeOfImpact;
      return { x, y: groundY + CHARACTER_CONTROLLER_OFFSET, z };
    }
  } catch {
    // Defensive: any raycast failure (mock world, missing Vector3, etc.)
    // falls through to the constant fallback.
  }

  return { x, y: fallback, z };
}
