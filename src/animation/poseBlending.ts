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

// ── Constants ────────────────────────────────────────────

/**
 * Default crossfade duration on combat-state transitions, in seconds.
 * Matches the legacy `DEFAULT_BLEND_DURATION` (`AnimationSystem.ts:42`)
 * and `ViewmodelAnimationSystem.ts:24` so the third-person and
 * first-person systems crossfade in lockstep.
 */
export const CROSSFADE_DURATION_SEC = 0.08;

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
