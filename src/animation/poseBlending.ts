/**
 * Shared pose-blending pipeline for the third-person and first-person
 * animation systems.
 *
 * Lives in `src/animation/` so both `AnimationSystem.ts` and
 * `ViewmodelAnimationSystem.ts` (issue #D) can import it. This is the seam
 * that fixes the bug §10.1 of `docs/animation-architecture.md`: "pose
 * interpolation uses live bone state, not a snapshot".
 *
 * The contract:
 *  - `prevPose` is a snapshot of bone *quaternions* captured at the moment
 *    of state change. NOT bone.quaternion read live each frame.
 *  - `currentPose` is a `Pose` (Euler-delta map) for the CURRENT target.
 *  - `easedT` is the smoothstepped blend factor in [0, 1].
 *  - `ownedBoneSet` enumerates the bones this layer is allowed to write.
 *    Bones outside the set are NOT touched (this is the rule that fixes
 *    the §10.3 "absent bone slerps to identity" bug).
 *
 * For a bone that's owned but missing from `currentPose`, we slerp toward
 * **identity** — that's the "leave at rest" semantic from the layer-
 * ownership model in §5 of the spec doc.
 */

import * as THREE from 'three';
import type { Pose, BoneRotation } from './AnimationData';
import { CombatState } from '../combat/states';

// ── Constants ────────────────────────────────────────────

/**
 * Default crossfade duration on combat-state transitions, in seconds.
 * Matches the legacy `DEFAULT_BLEND_DURATION` (`AnimationSystem.ts:42`)
 * and `ViewmodelAnimationSystem.ts:24` so the third-person and
 * first-person systems crossfade in lockstep.
 */
export const CROSSFADE_DURATION_SEC = 0.08;

/**
 * Per-state crossfade overrides (seconds) — one uniform 0.08 for every
 * transition flattened all character out of the blends (#goal-2026-07
 * fluidity pass). Parry snaps (it's a reward flourish), hit-stun lands
 * heavier. States not listed use CROSSFADE_DURATION_SEC.
 */
const CROSSFADE_BY_STATE: Partial<Record<CombatState, number>> = {
  [CombatState.Parry]: 0.05,
  [CombatState.HitStun]: 0.12,
};

/** Crossfade duration to use when ENTERING `state`. */
export function crossfadeDurationFor(state: CombatState): number {
  return CROSSFADE_BY_STATE[state] ?? CROSSFADE_DURATION_SEC;
}

// ── Reusable temp objects (avoid GC pressure) ────────────

const _euler = new THREE.Euler();
const _targetQuat = new THREE.Quaternion();
const _identity = new THREE.Quaternion();

// ── Helpers ──────────────────────────────────────────────

/**
 * Smooth-Hermite (`3t² - 2t³`) ease-in/ease-out for a value in [0, 1].
 * Values outside [0, 1] are clamped first so it's safe to feed raw
 * accumulated timers without an explicit `clamp01` step at the call site.
 */
export function smoothstepEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Ease-out-back: decelerating curve that overshoots 1 by ~6% around
 * t≈0.75 and settles back to exactly 1. Used as a slerp factor it carries
 * the bone PAST its target along the snapshot→target geodesic before
 * settling — physical follow-through from a single blend. (THREE's
 * Quaternion.slerp extrapolates cleanly for factors > 1.)
 */
export function easeOutBack(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c1 = 1.0; // ~6% overshoot; the standard 1.70158 (10%) reads rubbery
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/**
 * Blend factor for the COMBAT pose layer, per state (#goal-2026-07
 * fluidity pass).
 *
 * The legacy formula `smoothstep(max(phaseT, crossfadeT))` let the 80ms
 * crossfade win every race against multi-hundred-ms phases: a 300ms
 * windup reached its full pose in 80ms and then FROZE for the remaining
 * 220ms, and recovery snapped back to guard the same way. That
 * hit-a-pose-and-hold cadence is the single biggest "robotic" tell.
 *
 *  - Windup: driven by phaseT alone — the arm draws back across the WHOLE
 *    windup and arrives at full draw exactly when the swing releases.
 *    Continuity on entry comes from the state-change snapshot (phaseT
 *    restarts at 0), including direction morphs and combos.
 *  - Recovery: ease-out-back on phaseT — the arm carries past guard
 *    (follow-through momentum) and settles into it across the whole
 *    recovery window.
 *  - Everything else (Idle, Blocking, Parry, HitStun): reactive states
 *    keep the crossfade race — snapping fast IS correct for a block.
 */
export function combatPhaseBlend(
  state: CombatState,
  phaseT: number,
  crossfadeT: number,
): number {
  switch (state) {
    case CombatState.Windup:
      return smoothstepEase(phaseT);
    case CombatState.Recovery:
      return easeOutBack(phaseT);
    default:
      return smoothstepEase(Math.max(phaseT, crossfadeT));
  }
}

/**
 * Convert a `BoneRotation` (Euler XYZ deltas-from-rest, radians) to a
 * quaternion. Internal helper — the system uses pre-allocated temp
 * objects, so this writes through `out`.
 */
function boneRotationToQuat(
  rot: BoneRotation,
  out: THREE.Quaternion,
): THREE.Quaternion {
  _euler.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0, 'XYZ');
  return out.setFromEuler(_euler);
}

// ── Main API ─────────────────────────────────────────────

/**
 * Apply a target pose to a set of bones, slerping each bone's quaternion
 * from a captured `prevPose` snapshot toward the `currentPose` target by
 * `easedT`.
 *
 * **Critical correctness rule** (the bug fix this helper exists for):
 * we slerp from the captured snapshot, NOT from `bone.quaternion`. The
 * latter is the legacy buggy behavior — slerping live bone state toward
 * a target produces exponential settling, not phase-progress motion. See
 * `docs/animation-architecture.md` §10.1.
 *
 * Bones in `ownedBoneSet` that are missing from `currentPose` slerp toward
 * the identity quaternion (rest pose). Bones outside `ownedBoneSet` are
 * not touched at all.
 *
 * @param bones        Bone hierarchy (third-person or viewmodel).
 * @param prevPose     Snapshot of bone quaternions captured at the last
 *                     state change. Keys are bone names.
 * @param currentPose  Target pose as an Euler-delta map. Bones missing
 *                     from this map slerp toward identity.
 * @param easedT       Blend factor in [0, 1]. Caller is responsible for
 *                     applying the ease curve (e.g. `smoothstepEase`).
 * @param ownedBoneSet Bones this layer is allowed to write this tick.
 */
export function applyPoseLayer(
  bones: Record<string, THREE.Bone>,
  prevPose: Record<string, THREE.Quaternion>,
  currentPose: Pose,
  easedT: number,
  ownedBoneSet: ReadonlySet<string>,
): void {
  for (const boneName of ownedBoneSet) {
    const bone = bones[boneName];
    if (!bone) continue;

    const rotation = currentPose[boneName];
    if (rotation) {
      boneRotationToQuat(rotation, _targetQuat);
    } else {
      _targetQuat.copy(_identity);
    }

    const prevQuat = prevPose[boneName] ?? _identity;
    bone.quaternion.copy(prevQuat).slerp(_targetQuat, easedT);
  }
}
