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
export type WeaponName =
  | 'Longsword'
  | 'Mace'
  | 'Dagger'
  | 'Battleaxe'
  | 'Zweihander'
  | 'Warhammer'
  | 'Spear'
  | 'Katana'
  | 'Scythe'
  | 'Yeeter'
  | 'Rapier'
  | 'Halberd';

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
 * Swing endpoints per direction.
 *
 * GEOMETRY CONVENTION (this is what the 2026-07 rewrite fixed): the arm
 * bones hang along local -Y at rest and the character faces -Z. A bone
 * rotation `{x, y, z}` converts via Euler 'XYZ', so the arm direction is
 * `Rx(x)·Ry(y)·Rz(z)·(0,-1,0)`. Consequences the endpoints below rely on:
 *
 *  - shoulder `x` sweeps the arm in the sagittal plane. `x = 0` hangs
 *    down; `x = +π/2` points straight FORWARD (-Z); `x ≈ +3.5` (≡ -160°)
 *    points up and slightly back. Chops must travel DOWN through the
 *    front hemisphere: start ~3.5 and DECREASE toward ~0.55. The old
 *    table went -2.5 → +1.0, which sweeps down the player's BACK and
 *    through the ground under their feet — the "swings never hit
 *    anything" bug.
 *  - For horizontal slashes, `x = +1.35` first tips the swing plane to
 *    just-below-shoulder height, then `z` sweeps the arm across the
 *    FRONT hemisphere (`z = +1.25` = out to the player's right,
 *    `z = -1.25` = out to the left). The old table swept `z` with no `x`
 *    lift, which wipes the blade across the player's own chest plane
 *    (z ≈ 0) and never reaches a target standing in front.
 *  - Stab keeps the elbow chambered (forearm `x = -1.5`) and extends to
 *    straight while the shoulder rises from down-forward to nearly
 *    horizontal — tip travels hip → full forward extension.
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
  // ── Overhead — vertical chop: up-over-the-head → forward → thigh height ──
  // shoulder x 3.5 is the same physical pose as the windup keyframe's
  // -160° (they differ by 2π), so the Release crossfade is seamless.
  // The z ramp (0 → -0.3) converges the blade from the right-shoulder
  // lateral offset (~0.29 m) onto the aim centerline through the contact
  // window (phaseT ≈ 0.5–0.8) — without it the chop passes a full torso
  // half-width to the right of whatever the crosshair is on.
  [Direction.Overhead as number]: {
    shoulderStart: { x: 3.5, z: 0 },
    shoulderEnd: { x: 0.55, z: -0.3 },
    forearmStart: { x: -0.5 },
    forearmEnd: { x: -0.05 },
    handStart: { x: 0 },
    handEnd: { x: 0.15 },
    spineStart: { x: -0.15 },
    spineEnd: { x: 0.3 },
  },

  // ── Left — horizontal slash from attacker's right → left through the front ──
  [Direction.Left as number]: {
    shoulderStart: { x: 1.35, z: 1.25 },
    shoulderEnd: { x: 1.35, z: -1.25 },
    forearmStart: { x: -0.35 },
    forearmEnd: { x: -0.05 },
    handStart: { z: 0.15 },
    handEnd: { z: -0.2 },
    spineStart: { y: -0.4 },
    spineEnd: { y: 0.4 },
  },

  // ── Right — mirror of Left ──
  [Direction.Right as number]: {
    shoulderStart: { x: 1.35, z: -1.25 },
    shoulderEnd: { x: 1.35, z: 1.25 },
    forearmStart: { x: -0.35 },
    forearmEnd: { x: -0.05 },
    handStart: { z: -0.15 },
    handEnd: { z: 0.2 },
    spineStart: { y: 0.4 },
    spineEnd: { y: -0.4 },
  },

  // ── Stab — forward thrust: chambered elbow extends to full reach ──
  // Same centerline convergence as Overhead (z → -0.18): the thrust ends
  // on the crosshair, not a shoulder-width to its right.
  // Chamber is deliberately shallow (forearm -0.9, not a full fold): short
  // Release windows (dagger: 7 ticks) must reach full extension with time
  // to spare inside the window, or the tip never crosses the target plane.
  //
  // Convergence (z → -0.08) is deliberately smaller than Overhead's: the
  // lateral correction scales with weapon reach, and a spear-length weapon
  // with an Overhead-sized correction thrusts half a meter left of the
  // crosshair. Stab additionally gets an EASE-OUT time curve in
  // `computeArcSwingPose` so full extension arrives around phaseT≈0.6 and
  // dwells — with a linear ramp, long weapons only align with the aim line
  // on the final tick and the tip spends the Release window underground.
  [Direction.Stab as number]: {
    shoulderStart: { x: 0.8, z: 0 },
    shoulderEnd: { x: 1.6, z: -0.08 },
    forearmStart: { x: -0.9 },
    forearmEnd: { x: -0.02 },
    handStart: { x: 0 },
    handEnd: { x: 0.05 },
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
  /**
   * Slash velocity-profile exponent (#goal-2026-07 fluidity pass):
   * `tt = t^swingExponent` for Left/Right/Overhead. 1 = the old constant
   * angular velocity. Higher = the blade loads up early and ACCELERATES
   * through contact — the whip that makes a heavy swing read as heavy.
   * Stab keeps its own ease-out (fast extension, dwell at full reach).
   */
  swingExponent: number;
}

const WEAPON_SCALING: Record<WeaponName, WeaponScaling> = {
  Longsword: { shoulder: 1.0, forearm: 1.0, hand: 1.0, spine: 1.0, swingExponent: 1.35 },
  Mace: { shoulder: 1.15, forearm: 1.0, hand: 1.1, spine: 1.5, swingExponent: 1.55 },
  // Dagger: forearm + hand contribution boosted; spine commitment zeroed
  // (a thrust/slash with a dagger has no torso wind-up — it's all wrist).
  Dagger: { shoulder: 0.75, forearm: 1.2, hand: 1.2, spine: 0, swingExponent: 1.15 },
  Battleaxe: { shoulder: 1.3, forearm: 1.05, hand: 1.0, spine: 1.5, swingExponent: 1.6 },
  // ── 2026-07 arsenal ──
  // Zweihander: huge deliberate arcs with full-body commitment.
  Zweihander: { shoulder: 1.25, forearm: 1.0, hand: 1.0, spine: 1.4, swingExponent: 1.75 },
  // Warhammer: the biggest wind — the whole torso loads the launch.
  Warhammer: { shoulder: 1.35, forearm: 1.0, hand: 1.0, spine: 1.6, swingExponent: 1.8 },
  // Spear: economical thrust-first motion, slashes stay tight.
  Spear: { shoulder: 0.9, forearm: 1.1, hand: 1.0, spine: 0.6, swingExponent: 1.3 },
  // Katana: quick wrist-driven cuts.
  Katana: { shoulder: 0.9, forearm: 1.15, hand: 1.25, spine: 0.9, swingExponent: 1.2 },
  // Scythe: sweeping horizontal drama.
  Scythe: { shoulder: 1.2, forearm: 1.0, hand: 1.0, spine: 1.5, swingExponent: 1.5 },
  // Yeeter: maximum wind-up, maximum theater.
  Yeeter: { shoulder: 1.4, forearm: 0.95, hand: 0.9, spine: 1.7, swingExponent: 1.75 },
  // Rapier: wrist-and-point fencing — tiny shoulder arcs, all extension.
  Rapier: { shoulder: 0.8, forearm: 1.15, hand: 1.1, spine: 0.3, swingExponent: 1.1 },
  // Halberd: long-lever polearm chops with real body commitment.
  Halberd: { shoulder: 1.2, forearm: 1.05, hand: 1.0, spine: 1.3, swingExponent: 1.65 },
};

/**
 * Exponent used for the legacy 2-arg `computeArcSwingPose` form and for
 * unknown weapon names — matches the Longsword baseline.
 */
const DEFAULT_SWING_EXPONENT = WEAPON_SCALING.Longsword.swingExponent;

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
  const weapons = Object.keys(WEAPON_SCALING) as WeaponName[];

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

  const stabParams = table[Direction.Stab as number];
  const params = table[direction as number] ?? stabParams;

  // Clamp t to [0, 1] so callers don't have to.
  let tt = t <= 0 ? 0 : t >= 1 ? 1 : t;

  // Stab: ease-out (fast extension, then dwell at full reach).
  // Identity-compared against the resolved params so the unknown-direction
  // fallback (which uses the stab arc) eases identically to a real Stab.
  //
  // Slashes: accelerate through the swing (`t^exponent`, per-weapon).
  // The old constant angular velocity had no loading phase and no whip —
  // the #goal-2026-07 fluidity pass made the profile weight-dependent:
  // daggers stay near-linear, warhammers load up and crack through.
  if (params === stabParams) {
    tt = 1 - (1 - tt) * (1 - tt);
  } else {
    const exponent =
      weaponName !== undefined
        ? (WEAPON_SCALING[weaponName]?.swingExponent ?? DEFAULT_SWING_EXPONENT)
        : DEFAULT_SWING_EXPONENT;
    tt = Math.pow(tt, exponent);
  }

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
