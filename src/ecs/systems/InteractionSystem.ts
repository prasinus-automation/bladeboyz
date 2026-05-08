/**
 * InteractionSystem — proximity-based interactable detection.
 *
 * Per fixedUpdate tick, computes Euclidean distance from the player's
 * Position to each registered shopkeep. Exposes `getNearbyInteractable()`
 * for the KeyE handler and the world-label prompt visibility check.
 *
 * Why distance, not a Rapier sensor? Single shopkeep in a single-player
 * game — a per-tick 3D distance check on one Vector3 pair is ~5ns. Setting
 * up a sensor + intersectionsWithShape adds physics complexity for no gain.
 * If the interactable count grows beyond ~10, switch to a sensor-based
 * approach.
 */

import { Position } from '../components';
import { shopkeepRegistry } from '../entities/createShopkeep';

/** Cached: nearest interactable per player eid (updated each tick). */
const nearbyByPlayer: Map<number, number | null> = new Map();

/**
 * Tick the interaction system. Call each fixedUpdate before any consumer
 * that might call `getNearbyInteractable()`.
 *
 * Computes the nearest in-range interactable for the given player and
 * caches the result. Multiple in-range interactables → returns the nearest.
 */
export function interactionSystem(playerEid: number): void {
  const px = Position.x[playerEid];
  const py = Position.y[playerEid];
  const pz = Position.z[playerEid];

  let nearestEid: number | null = null;
  let nearestDistSq = Infinity;

  for (const [eid, data] of shopkeepRegistry) {
    const dx = Position.x[eid] - px;
    const dy = Position.y[eid] - py;
    const dz = Position.z[eid] - pz;
    const distSq = dx * dx + dy * dy + dz * dz;
    const radiusSq = data.interactRadius * data.interactRadius;
    if (distSq <= radiusSq && distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearestEid = eid;
    }
  }

  nearbyByPlayer.set(playerEid, nearestEid);
}

/**
 * Returns the entity ID of the nearest in-range interactable for the given
 * player, or `null` if none are in range.
 *
 * Reads cached value populated by `interactionSystem()`. Call after that
 * tick has run.
 */
export function getNearbyInteractable(playerEid: number): number | null {
  return nearbyByPlayer.get(playerEid) ?? null;
}

/**
 * Clear the cache. Useful for tests, and for cleanup when a player entity
 * is destroyed.
 */
export function clearInteractionCache(playerEid?: number): void {
  if (playerEid === undefined) {
    nearbyByPlayer.clear();
  } else {
    nearbyByPlayer.delete(playerEid);
  }
}
