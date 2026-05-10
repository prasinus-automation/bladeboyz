/**
 * Arc-driven swing pose computation for the Release phase.
 *
 * Replaces the static keyframe lerp from windup-end → release-end with
 * an explicit arc swept across the swing arc by `phaseT`. The static
 * keyframe approach gave a "porridge" arc that didn't read as a swing;
 * the arc gives a clean linear-in-radians sweep that the eye reads as
 * a slash. See §4 of `docs/animation-architecture.md`.
 *
 * Per-direction params are weapon-agnostic at this stage. Per-weapon
 * scaling (dagger tighter, battleaxe wider, mace wrist follow-through)
 * is deferred to issue #D's pose-data PR.
 */

import { Direction } from '../combat/directions';
import type { Pose, BoneRotation } from './AnimationData';

// ── Types ────────────────────────────────────────────────

/**
 * Per-direction arc-swing parameters. Each pair (start/end) defines the
 * Euler-delta bone rotation at `phaseT = 0` and `phaseT = 1`. The visible
 * pose at any `phaseT ∈ [0, 1]` is the linear interpolation of these
 * endpoints — `lerp` in Euler space, NOT slerp. The slerp happens when
 * the resulting `Pose` is fed through `applyPoseLayer`.
 *
 * Optional `spineStart`/`spineEnd` add a torso rotation to the swing —
 * useful for horizontal slashes where chest follow-through sells the swing.
 */
export interface ArcSwingParams {
  shoulderStart: BoneRotation;
  shoulderEnd: BoneRotation;
  forearmStart: BoneRotation;
  forearmEnd: BoneRotation;
  handStart: BoneRotation;
  handEnd: BoneRotation;
  /** Optional spine follow-through. */
  spineStart?: BoneRotation;
  spineEnd?: BoneRotation;
}

// ── Helpers ──────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Lerp two `BoneRotation` Euler deltas axis-by-axis. Missing axes default
 * to 0 (rest). Returns a fresh object — callers are expected to discard
 * the result each frame, so allocation cost is amortized over the
 * 4-bones-per-Release-frame cost which is negligible.
 */
function lerpBoneRotation(
  a: BoneRotation,
  b: BoneRotation,
  t: number,
): BoneRotation {
  return {
    x: lerp(a.x ?? 0, b.x ?? 0, t),
    y: lerp(a.y ?? 0, b.y ?? 0, t),
    z: lerp(a.z ?? 0, b.z ?? 0, t),
  };
}

// ── Per-direction arc tables ─────────────────────────────

/**
 * Swing endpoints per direction. Numeric values follow the issue body's
 * pseudo-table:
 *  - `Overhead`: shoulder X = -2.5 → +1.0 (chop-down arc); forearm X
 *    extends from -0.3 → +0.5 for the snap on the strike.
 *  - `Left`: shoulder Z = +1.4 → -1.4 (right shoulder sweeps from
 *    pulled-back to across-the-body).
 *  - `Right`: mirror of Left (shoulder Z = -1.4 → +1.4).
 *  - `Stab`: shoulder mostly stationary (-0.4 → -0.65); forearm extends
 *    from chambered (+0.4) → committed (-0.5).
 *
 * `Underhand` is intentionally absent — FSM v2 #131 / #139 dropped that
 * direction. If it's re-added post-MVP it gets a new numeric slot per
 * the wire-format note in `src/combat/directions.ts`.
 */
export const ARC_SWING_PARAMS: Record<number, ArcSwingParams> = {
  // ── Overhead — vertical chop down ──
  [Direction.Overhead as number]: {
    shoulderStart: { x: -2.5 },
    shoulderEnd: { x: 1.0 },
    forearmStart: { x: -0.3 },
    forearmEnd: { x: 0.5 },
    handStart: { x: 0 },
    handEnd: { x: 0.2 },
    spineStart: { x: -0.15 },
    spineEnd: { x: 0.25 },
  },

  // ── Left — sweep from attacker's right to left across screen ──
  [Direction.Left as number]: {
    shoulderStart: { z: 1.4, x: -0.3 },
    shoulderEnd: { z: -1.4, x: -0.2 },
    forearmStart: { x: -0.4 },
    forearmEnd: { x: -0.1 },
    handStart: { z: 0.1 },
    handEnd: { z: -0.2 },
    spineStart: { y: 0.4 },
    spineEnd: { y: -0.4 },
  },

  // ── Right — mirror of Left ──
  [Direction.Right as number]: {
    shoulderStart: { z: -1.4, x: -0.3 },
    shoulderEnd: { z: 1.4, x: -0.2 },
    forearmStart: { x: -0.4 },
    forearmEnd: { x: -0.1 },
    handStart: { z: -0.1 },
    handEnd: { z: 0.2 },
    spineStart: { y: -0.4 },
    spineEnd: { y: 0.4 },
  },

  // ── Stab — forward thrust, mostly forearm extension ──
  [Direction.Stab as number]: {
    shoulderStart: { x: -0.4 },
    shoulderEnd: { x: -0.65 },
    forearmStart: { x: 0.4 },
    forearmEnd: { x: -0.5 },
    handStart: { x: 0 },
    handEnd: { x: 0.1 },
  },
};

/**
 * Compute the arc-swing pose for a given direction at normalized
 * progress `t ∈ [0, 1]`.
 *
 * Returns a `Pose` containing **only** the four arm bones
 * (`shoulder_R`, `forearm_R`, `hand_R`) and optionally `spine`.
 * Caller is responsible for restricting the returned Pose to the
 * bones the layer owns (the AnimationSystem's `combatOwned ∩ ARM_BONES_R`
 * intersection — see §9 step 7 of the spec doc).
 *
 * If `direction` is unknown, falls back to the `Stab` arc — same
 * fallback as `getCombatPose`.
 */
export function computeArcSwingPose(
  direction: Direction,
  t: number,
): Pose {
  const params =
    ARC_SWING_PARAMS[direction as number] ??
    ARC_SWING_PARAMS[Direction.Stab as number];

  // Clamp t to [0, 1] so callers don't have to.
  const tt = t <= 0 ? 0 : t >= 1 ? 1 : t;

  const result: Pose = {
    shoulder_R: lerpBoneRotation(params.shoulderStart, params.shoulderEnd, tt),
    forearm_R: lerpBoneRotation(params.forearmStart, params.forearmEnd, tt),
    hand_R: lerpBoneRotation(params.handStart, params.handEnd, tt),
  };

  if (params.spineStart && params.spineEnd) {
    result.spine = lerpBoneRotation(params.spineStart, params.spineEnd, tt);
  }

  return result;
}

/**
 * Bones owned by the arc-swing layer during Release. `upper_arm_R` is
 * intentionally absent — the swing pivots from `shoulder_R`, and
 * `upper_arm_R` keeps its rest rotation so the arc reads as a clean
 * shoulder rotation rather than a compound shoulder+upper-arm motion.
 *
 * Exported as a `ReadonlySet<string>` so AnimationSystem can take an
 * intersection with the broader combat-owned bone set without copying
 * each tick.
 */
export const ARC_SWING_OWNED_BONES: ReadonlySet<string> = new Set([
  'shoulder_R',
  'forearm_R',
  'hand_R',
]);
