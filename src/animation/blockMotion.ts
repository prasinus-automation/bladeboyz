/**
 * Living-guard block-hold motion (#218).
 *
 * Blocking already selects a direction-distinct static pose, but once the
 * entry crossfade finishes the pose FREEZES — idle sway is Idle-gated in
 * both rigs, so nothing moves during the hold. This module adds a subtle,
 * continuous, direction-flavoured "breathing guard" motion that is layered
 * ADDITIVELY on top of the keyframe block pose (see `applyAdditivePoseLayer`
 * in `poseBlending.ts`).
 *
 * **Pure & deterministic.** The only input clock is the caller's
 * `blockTicks` (the FSM's `phaseElapsed`, which free-runs every tick during
 * Blocking — see `CombatFSM.tick`). No `Date.now()` / `performance.now()` /
 * `Math.random()` — this keeps the motion reproducible for the networking
 * seam (#92) and satisfies the forbidden-patterns lint (G7). Same
 * `(direction, blockTicks)` ⇒ byte-identical offsets.
 *
 * The offsets are keyed by bones common to BOTH the third-person and
 * viewmodel rigs (`upper_arm_R` / `forearm_R` / `hand_R`) plus `chest`
 * (third-person only — the FP viewmodel has no torso, so the caller's owned
 * set simply drops it). Each caller filters to the bones it is permitted to
 * write; see the bone write-permission contracts in
 * `docs/animation-architecture.md` and `docs/viewmodel-architecture.md`.
 */

import { Direction } from '../combat/directions';
import type { Pose } from './AnimationData';

// ── Tuning constants ─────────────────────────────────────

/** Fixed-tick rate (Hz) — mirror of the game loop's fixed timestep. */
const TICKS_PER_SEC = 60;

/**
 * Peak amplitude of the hold motion (radians ≈ 2.5°). Kept tiny on purpose:
 * this is a "the guard is alive" tell, not a visible sway. Every returned
 * offset component is bounded by this value.
 */
export const BLOCK_HOLD_PEAK_RAD = (2.5 * Math.PI) / 180;

/**
 * Period of the sinusoid in ticks (~1.25 s at 60 Hz). Chosen in the
 * 70–80-tick band from the issue so the motion reads as a slow, calm brace
 * rather than a jitter.
 */
export const BLOCK_HOLD_PERIOD_TICKS = 75;

/**
 * Seconds over which the amplitude ramps 0 → full. Fading the motion in
 * over the first ~0.25 s keeps it from fighting the 0.14 s entry crossfade
 * (the raise-in sweep) — the guard settles, THEN starts breathing.
 */
export const BLOCK_HOLD_FADEIN_SEC = 0.25;

// ── Pure motion function ─────────────────────────────────

/**
 * Compute the additive per-bone Euler offsets for the living block hold.
 *
 * @param direction  The block direction (unified `Direction` enum).
 * @param blockTicks Ticks elapsed in the current Blocking state
 *                   (`CombatStateComp.phaseElapsed`). ≤ 0 ⇒ no motion.
 * @returns A `Pose` of small Euler offsets (radians). Empty when the block
 *          has not started or the direction is unrecognised.
 *
 * Per-direction character (each visually distinct):
 *  - `Left`  / `Right`: lateral rock about Z (mirrored sign).
 *  - `Overhead`:        vertical brace bob about X (symmetric).
 *  - `Stab`:            one-sided forward pulse about X (always forward).
 */
export function computeBlockHoldOffsets(
  direction: Direction,
  blockTicks: number,
): Pose {
  if (blockTicks <= 0) return {};

  const fade = Math.min(1, blockTicks / TICKS_PER_SEC / BLOCK_HOLD_FADEIN_SEC);
  const phase = ((2 * Math.PI) / BLOCK_HOLD_PERIOD_TICKS) * blockTicks;

  // Symmetric rock/bob in [-1, 1], and a one-sided "pulse" in [0, 1] that
  // only ever pushes forward (for the Stab guard).
  const wave = Math.sin(phase);
  const pulse = 0.5 - 0.5 * Math.cos(phase);

  const a = wave * fade * BLOCK_HOLD_PEAK_RAD; // signed rock/bob amplitude
  const p = pulse * fade * BLOCK_HOLD_PEAK_RAD; // one-sided forward pulse

  switch (direction) {
    case Direction.Left:
      return {
        upper_arm_R: { z: a },
        forearm_R: { z: a * 0.6 },
        chest: { z: a * 0.4 },
      };
    case Direction.Right:
      return {
        upper_arm_R: { z: -a },
        forearm_R: { z: -a * 0.6 },
        chest: { z: -a * 0.4 },
      };
    case Direction.Overhead:
      return {
        upper_arm_R: { x: a },
        forearm_R: { x: a * 0.5 },
        chest: { x: a * 0.4 },
      };
    case Direction.Stab:
      return {
        forearm_R: { x: p },
        upper_arm_R: { x: p * 0.5 },
        chest: { x: p * 0.3 },
      };
    default:
      return {};
  }
}
