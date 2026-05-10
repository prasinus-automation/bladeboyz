/**
 * Shared fixed-tick counter.
 *
 * Incremented exactly once per fixedUpdate (60Hz) by main.ts. Systems that
 * need to stamp events with the current tick (e.g. HitReactComp.spawnedAtTick)
 * read it via `getCurrentFixedTick()`.
 *
 * NOT incremented from variable-rate update/render — the counter must
 * advance in lockstep with the fixed timestep so consumers can compare
 * `currentTick` to a previously-stamped `spawnedAtTick + durationTicks`
 * with tick-precise semantics.
 *
 * Module-level state: works for the current single-world client. If we
 * ever run multiple worlds in the same process, this will need to move
 * onto `GameWorld`.
 */

let currentFixedTick = 0;

/** Read the current tick. Cheap; safe to call from any system. */
export function getCurrentFixedTick(): number {
  return currentFixedTick;
}

/**
 * Advance the fixed-tick counter by 1.
 * Call once at the top of fixedUpdate (before any system that stamps events).
 */
export function advanceFixedTick(): number {
  currentFixedTick++;
  return currentFixedTick;
}

/** Reset to 0 — for tests that need deterministic tick counts. */
export function resetFixedTick(): void {
  currentFixedTick = 0;
}
