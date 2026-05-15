/**
 * Arc-driven swing pose computation for the Release phase.
 *
 * Replaces the static keyframe lerp from windup-end → release-end with
 * an explicit arc swept across the swing arc by `phaseT`. The static
 * keyframe approach gave a "porridge" arc that didn't read as a swing;
 * the arc gives a clean linear-in-radians sweep that the eye reads as
 * a slash. See §4 of `docs/animation-architecture.md`.
 *
 * Per-weapon scaling (#132): the base direction params live in
 * `ARC_SWING_PARAMS` (Longsword baseline, kept for backward compat).
 * Per-weapon overrides live in `ARC_SWING_PARAMS_PER_WEAPON`. The
 * speed/reach hierarchy is Dagger < Longsword < Mace < Battleaxe —
 * heavier weapons get wider shoulder rotation and more spine commitment,
 * faster weapons get more wrist/forearm contribution and tighter
 * shoulders. Phase-t math is identical across all weapons; only the
 * angular magnitudes scale.
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

/**
 * Canonical weapon names matching `weaponIdToName` in
 * `src/ecs/systems/CombatSystem.ts:43` and the `getViewmodelPose`
 * registry keys. Capitalized — lowercase forms are NOT recognized.
 */
export type WeaponName = 'Longsword' | 'Mace' | 'Dagger' | 'Battleaxe';

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

/**
 * Scale every numeric axis of a `BoneRotation` by `factor`. Used to derive
 * per-weapon endpoints from the Longsword baseline (Mace = 1.15× shoulder,
 * etc.) without hand-authoring all 16 sets. Missing axes pass through as
 * undefined (NOT scaled to 0) so the result stays structurally identical
 * to the input.
 */
function scaleBoneRotation(rot: BoneRotation, factor: number): BoneRotation {
  const out: BoneRotation = {};
  if (rot.x !== undefined) out.x = rot.x * factor;
  if (rot.y !== undefined) out.y = rot.y * factor;
  if (rot.z !== undefined) out.z = rot.z * factor;
  return out;
}

/**
 * Derive a per-weapon `ArcSwingParams` from the Longsword baseline by
 * scaling shoulder / forearm / hand / spine independently. Spine
 * endpoints are scaled iff the baseline has them — Stab has no spine
 * follow-through and stays spine-less across all four weapons.
 */
function scaleParams(
  base: ArcSwingParams,
  shoulderFactor: number,
  forearmFactor: number,
  handFactor: number,
  spineFactor: number,
): ArcSwingParams {
  const out: ArcSwingParams = {
    shoulderStart: scaleBoneRotation(base.shoulderStart, shoulderFactor),
    shoulderEnd: scaleBoneRotation(base.shoulderEnd, shoulderFactor),
    forearmStart: scaleBoneRotation(base.forearmStart, forearmFactor),
    forearmEnd: scaleBoneRotation(base.forearmEnd, forearmFactor),
    handStart: scaleBoneRotation(base.handStart, handFactor),
    handEnd: scaleBoneRotation(base.handEnd, handFactor),
  };
  if (base.spineStart && base.spineEnd) {
    out.spineStart = scaleBoneRotation(base.spineStart, spineFactor);
    out.spineEnd = scaleBoneRotation(base.spineEnd, spineFactor);
  }
  return out;
}

// ── Per-direction arc tables (Longsword baseline) ────────

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
 *
 * This table is the **Longsword baseline**. Mace / Dagger / Battleaxe
 * scale these values (see `WEAPON_SCALING` and `ARC_SWING_PARAMS_PER_WEAPON`).
 * Kept exported under the legacy name so the existing 1-arg `computeArcSwingPose`
 * callers that pass no weapon get Longsword behavior verbatim.
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

// ── Per-weapon scaling factors ────────────────────────────

/**
 * Per-weapon multipliers for the four bone groups. Longsword = 1.0 (no
 * scaling — it's the baseline). Values pulled from issue #132's body:
 *
 *  - **Mace**: ~1.15× shoulder, +50% spine wind-up, slightly wider arc plane.
 *  - **Dagger**: ~0.75× shoulder, ~1.2× forearm/wrist contribution, no spine commitment.
 *  - **Battleaxe**: ~1.30× shoulder, ~1.5× spine, slowest visual build.
 *
 * For weapons with no spine entries in the baseline (Stab), the spine
 * factor is irrelevant — `scaleParams` skips spine when the baseline lacks it.
 */
interface WeaponScaling {
  shoulder: number;
  forearm: number;
  hand: number;
  spine: number;
}

const WEAPON_SCALING: Record<WeaponName, WeaponScaling> = {
  Longsword: { shoulder: 1.0, forearm: 1.0, hand: 1.0, spine: 1.0 },
  Mace: { shoulder: 1.15, forearm: 1.0, hand: 1.1, spine: 1.5 },
  // Dagger: forearm + hand contribution boosted; spine commitment zeroed
  // (a thrust/slash with a dagger has no torso wind-up — it's all wrist).
  Dagger: { shoulder: 0.75, forearm: 1.2, hand: 1.2, spine: 0 },
  Battleaxe: { shoulder: 1.3, forearm: 1.05, hand: 1.0, spine: 1.5 },
};

/**
 * Build the per-weapon × per-direction params table from the baseline +
 * scaling. Keys: weapon name → numeric Direction enum value → params.
 *
 * Numeric direction keys (not the enum) are used as the inner key so
 * lookup is a plain object property read — same shape as `ARC_SWING_PARAMS`.
 */
function buildPerWeaponParams(): Record<
  WeaponName,
  Record<number, ArcSwingParams>
> {
  const result = {} as Record<WeaponName, Record<number, ArcSwingParams>>;
  const directions: number[] = [
    Direction.Overhead,
    Direction.Left,
    Direction.Right,
    Direction.Stab,
  ];
  const weapons: WeaponName[] = ['Longsword', 'Mace', 'Dagger', 'Battleaxe'];

  for (const weapon of weapons) {
    const scaling = WEAPON_SCALING[weapon];
    const perDirection: Record<number, ArcSwingParams> = {};
    for (const dir of directions) {
      const base = ARC_SWING_PARAMS[dir];
      perDirection[dir] = scaleParams(
        base,
        scaling.shoulder,
        scaling.forearm,
        scaling.hand,
        scaling.spine,
      );
    }
    result[weapon] = perDirection;
  }
  return result;
}

/**
 * Per-weapon × per-direction arc params. Build-once on module load via
 * `buildPerWeaponParams()`; the cost is 16 small object allocations at
 * import time, paid once.
 *
 * Lookup contract: `ARC_SWING_PARAMS_PER_WEAPON[weaponName][direction]`.
 * Unknown weapons fall back to Longsword via `computeArcSwingPose`.
 */
export const ARC_SWING_PARAMS_PER_WEAPON: Record<
  WeaponName,
  Record<number, ArcSwingParams>
> = buildPerWeaponParams();

// ── Main API ─────────────────────────────────────────────

/**
 * Compute the arc-swing pose for a given direction + weapon at normalized
 * progress `t ∈ [0, 1]`.
 *
 * Returns a `Pose` containing **only** the four arm bones
 * (`shoulder_R`, `forearm_R`, `hand_R`) and optionally `spine`.
 * Caller is responsible for restricting the returned Pose to the
 * bones the layer owns (the AnimationSystem's `combatOwned ∩ ARM_BONES_R`
 * intersection — see §9 step 7 of the spec doc).
 *
 * The 2-arg overload `computeArcSwingPose(direction, t)` is preserved for
 * backward compat — it implicitly uses the Longsword baseline.
 *
 * Unknown `weaponName` (e.g. a future weapon registered after this module
 * loaded) silently falls back to the Longsword baseline. Unknown `direction`
 * falls back to the Stab arc — same fallback as `getCombatPose`.
 */
export function computeArcSwingPose(direction: Direction, t: number): Pose;
export function computeArcSwingPose(
  direction: Direction,
  weaponName: WeaponName,
  t: number,
): Pose;
export function computeArcSwingPose(
  direction: Direction,
  arg2: WeaponName | number,
  arg3?: number,
): Pose {
  // Disambiguate overloads by arg2 type.
  let weaponName: WeaponName | undefined;
  let t: number;
  if (typeof arg2 === 'number') {
    weaponName = undefined; // legacy 2-arg form — use Longsword baseline
    t = arg2;
  } else {
    weaponName = arg2;
    t = arg3 ?? 0;
  }

  const table =
    weaponName !== undefined
      ? ARC_SWING_PARAMS_PER_WEAPON[weaponName] ??
        ARC_SWING_PARAMS_PER_WEAPON.Longsword
      : ARC_SWING_PARAMS;

  const params = table[direction as number] ?? table[Direction.Stab as number];

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

/**
 * Viewmodel arc-swing bones — the FP rig's right-arm hierarchy. Used by
 * `ViewmodelAnimationSystem` to filter the `computeArcSwingPose` output
 * to the viewmodel bone names. `vm_weapon_attach` is deliberately absent
 * — that bone is owned by per-weapon grip data (#125) and must not be
 * touched by animation code.
 *
 * Note: the renderer exposes bones under canonical names (without the
 * `vm_` prefix) — see `ViewmodelRenderer.bones`. So `shoulder_R` here
 * matches the third-person system; the viewmodel system maps these to
 * `upper_arm_R` / `forearm_R` / `hand_R` at the bone-write site (the
 * viewmodel has no `shoulder_R` — it pivots from `upper_arm_R` directly).
 */
export const ARC_SWING_VIEWMODEL_BONES: ReadonlySet<string> = new Set([
  'upper_arm_R',
  'forearm_R',
  'hand_R',
]);
