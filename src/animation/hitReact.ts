/**
 * Hit-react / stagger lean overlay for HitStun.
 *
 * Applied after the §4 keyframe pose (HITSTUN_POSE) on top of `spine` and
 * `chest` to lean the torso AWAY from the incoming hit. See §7 of
 * `docs/animation-architecture.md`.
 *
 * Contract:
 *  - `dirLocal` is in target-body-local space, pointing FROM attacker
 *    TO target (i.e. the direction the hit *pushes* the target).
 *    Already populated this way by `DamageSystem.handleHit`.
 *  - `magnitude ∈ [0, 1]` scales the lean.
 *  - `t ∈ [0, 1]` is the normalized hit-react progress over the
 *    component's full `durationTicks`. The lean peaks around `t = 0.3`
 *    and decays back to 0 by `t = 1`, so the late frames of the stun
 *    show the static `HITSTUN_POSE` without any overlay.
 *  - Caller passes the `spine` and `chest` bones explicitly (or `null`
 *    if the bone is missing). The function is bone-set-agnostic by
 *    design — anything else routes through the keyframe pipeline.
 */

import * as THREE from 'three';

// ── Constants ────────────────────────────────────────────

/**
 * Maximum spine bend the lean can drive at full magnitude × full
 * intensity. ~30° matches the visual budget the issue body calls out
 * ("cap at ~30° spine bend"). Chest gets the same axis-angle, doubling
 * the visible tilt at the head.
 */
const MAX_TILT_RAD = (30 * Math.PI) / 180;

/** Where the intensity curve peaks within `t ∈ [0, 1]`. */
const PEAK_T = 0.3;

// ── Reusable temp objects ────────────────────────────────

const _axis = new THREE.Vector3();
const _quat = new THREE.Quaternion();

// ── Helpers ──────────────────────────────────────────────

/**
 * Piecewise-linear intensity curve that ramps `0 → 1` over `[0, PEAK_T]`
 * and decays `1 → 0` over `[PEAK_T, 1]`. The peak at `t = 0.3` matches
 * the issue body's spec; the linear ramp is cheap and the eye doesn't
 * read the cubic ease as different from linear at this duration.
 *
 * Exported so the unit test can pin the curve shape.
 */
export function hitReactIntensity(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 0;
  if (t <= PEAK_T) return t / PEAK_T;
  return 1 - (t - PEAK_T) / (1 - PEAK_T);
}

// ── Main API ─────────────────────────────────────────────

/**
 * Apply a directional stagger lean to the spine and chest bones.
 *
 * The lean is multiplied INTO the existing bone quaternions
 * (`bone.quaternion.multiply(reactQuat)`) so it composes cleanly with
 * the static `HITSTUN_POSE` already applied by the keyframe layer —
 * no double-write, no fighting layers, no fixed-ratio blend.
 *
 * If both `spineBone` and `chestBone` are `null`, this is a no-op.
 * If `magnitude` is 0 (or `dirLocal` has zero horizontal component),
 * this is a no-op — there's no direction to lean *away* from.
 *
 * @param spineBone   Spine bone (or null if missing).
 * @param chestBone   Chest bone (or null if missing).
 * @param dirLocalX   X component of the unit-vector hit direction (target-local).
 * @param dirLocalY   Y component (vertical). Ignored — lean is horizontal-only.
 * @param dirLocalZ   Z component of the unit-vector hit direction (target-local).
 * @param magnitude   Hit magnitude in [0, 1].
 * @param t           Normalized progress in [0, 1] over the hit-react duration.
 */
export function applyHitReactLean(
  spineBone: THREE.Bone | null,
  chestBone: THREE.Bone | null,
  dirLocalX: number,
  _dirLocalY: number,
  dirLocalZ: number,
  magnitude: number,
  t: number,
): void {
  if (!spineBone && !chestBone) return;
  if (magnitude <= 0) return;

  const intensity = hitReactIntensity(t);
  if (intensity <= 0) return;

  // Tilt axis = cross(dirLocal_horizontal, +Y).
  // For dirLocal = (dx, _, dz), cross with (0, 1, 0) = (dz, 0, -dx).
  // Normalized: divide by sqrt(dx² + dz²).
  const horizontalMagSq = dirLocalX * dirLocalX + dirLocalZ * dirLocalZ;
  if (horizontalMagSq < 1e-10) return; // hit is purely vertical → no lean

  const invLen = 1 / Math.sqrt(horizontalMagSq);
  const ax = dirLocalZ * invLen;
  const az = -dirLocalX * invLen;

  // Tilt OPPOSITE to the push direction. Negative axis flips the rotation
  // direction so the spine leans backward from the incoming hit instead
  // of toward it. Equivalent to negating the angle.
  const angle = -intensity * magnitude * MAX_TILT_RAD;

  _axis.set(ax, 0, az);
  _quat.setFromAxisAngle(_axis, angle);

  // Multiply on top of the existing keyframe pose. `bone.quaternion *=
  // reactQuat` rotates the bone's local frame; child bones inherit the
  // tilt automatically (chest tilts → head tilts with it) so we only
  // need to write spine + chest explicitly.
  if (spineBone) spineBone.quaternion.multiply(_quat);
  if (chestBone) chestBone.quaternion.multiply(_quat);
}
