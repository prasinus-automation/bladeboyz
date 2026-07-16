/**
 * Procedural animation pose data.
 *
 * All animations are defined as target bone rotations (Euler angles in radians).
 * The AnimationSystem interpolates between poses using quaternion slerp.
 *
 * Architecture: animation data is separate from the system —
 * poses are plain data objects, looked up by FSM state + direction.
 *
 * ── Release-entry policy (#132 — option A) ────────────────────
 *
 * The `release` pose under each direction in `ATTACK_ANIMATIONS` is the
 * **third-person spine + non-right-arm fallback** during Release. The
 * right arm (shoulder_R, forearm_R, hand_R) is owned by `arcSwing.ts`'s
 * `computeArcSwingPose(direction, weaponName, t)` during Release —
 * `AnimationSystem.ts` filters the arc bones out before applying the
 * keyframe pose to the remaining combat-owned bones (chest, neck, head,
 * left arm, upper_arm_R, plus spine when the combat layer owns it).
 *
 * Option B (delete `release` entries) was considered and rejected: the
 * spine + chest follow-through values authored here are visually load-
 * bearing for horizontal slashes and stab thrusts, and the arc-swing
 * already supplies its own spine endpoints when the swing is horizontal.
 * Keeping the keyframe `release` entries means a future spine-owning
 * Release pose can be tuned independently of the arc-swing geometry
 * without re-authoring `arcSwing.ts`.
 *
 * Right-arm entries (`shoulder_R`, `forearm_R`, `hand_R`) inside a
 * `release` pose are dead-on-arrival in third-person — the AnimationSystem
 * never reads them because `combatOwned` is set-minus'd with
 * `ARC_SWING_OWNED_BONES` before they're applied. They're kept here only
 * so the data file remains consistent with the windup/recovery shape;
 * editors should NOT spend authoring time on right-arm `release` values.
 *
 * **First-person viewmodel does NOT read these `release` entries at all** —
 * `ViewmodelAnimationSystem.ts` (#132) calls `computeArcSwingPose` directly
 * for the right-arm viewmodel bones; `getViewmodelPose(weaponName, Release, dir)`
 * is bypassed during Release. The viewmodel `release` pose data in
 * `ViewmodelAnimationData.ts` is similarly dead-on-arrival during Release,
 * but kept for the same reason — symmetry with windup/recovery + future
 * extension.
 */

import { CombatState } from '../combat/states';
import { Direction } from '../combat/directions';

// ── Types ────────────────────────────────────────────────

/**
 * A bone rotation expressed as Euler angles (radians).
 * Only bones that differ from the default rest pose need to be specified.
 */
export interface BoneRotation {
  x?: number;
  y?: number;
  z?: number;
}

/**
 * A pose is a partial map of bone names to target rotations.
 * Bones not specified in a pose keep their current rotation (blend-through).
 */
export type Pose = Record<string, BoneRotation>;

/**
 * A combat animation has poses for each phase (windup, release, recovery).
 * Each phase blends from the previous pose to this target over the phase duration.
 */
export interface CombatAnimation {
  windup: Pose;
  release: Pose;
  recovery: Pose;
}

/**
 * A block pose — static target pose for a block direction.
 */
export type BlockPose = Pose;

/**
 * Movement animation keyframes — sinusoidal parameters for procedural walk/run.
 */
export interface MovementAnimParams {
  /** Leg swing amplitude (radians) */
  legSwing: number;
  /** Arm swing amplitude (radians) */
  armSwing: number;
  /** Cycle speed multiplier */
  cycleSpeed: number;
  /** Base pose offsets */
  basePose: Pose;
}

// ── Helper constants ─────────────────────────────────────

const DEG = Math.PI / 180;

// ── Idle Pose ────────────────────────────────────────────

/**
 * Subtle "ready" stance — sword held in front at mid-guard.
 *
 * FACING CONVENTION (#219): limbs hang along local -Y at rest, so
 * `Rx(θ)·(0,-1,0) = (0,-cosθ,-sinθ)` — a **POSITIVE** X rotation swings an
 * arm toward world-forward (-Z), a negative X swings it toward the
 * third-person camera (+Z). This pose was originally authored to the
 * inverted convention (all-negative X on the right-arm chain → guard raised
 * toward the camera → the "floating sword pointing at the camera" bug). It
 * has been corrected by conjugation with Ry(π): negate every X and Z Euler
 * component, keep Y. Verified in `AnimationData.orientation.test.ts` —
 * `hand_R`/`weapon_attach` now resolve to world-z < 0 at yaw=0.
 */
export const IDLE_POSE: Pose = {
  shoulder_R: { x: 15 * DEG, z: 20 * DEG },
  upper_arm_R: { x: 40 * DEG },
  forearm_R: { x: 30 * DEG },
  shoulder_L: { x: 10 * DEG, z: -20 * DEG },
  upper_arm_L: { x: 30 * DEG },
  forearm_L: { x: 20 * DEG },
  spine: { x: -2 * DEG },
};

// ── Combat Animations (4 directions × 3 phases) ─────────
//
// FSM v2 (#88, #131, #139): trimmed from 5 directions to 4 — `Underhand`
// was removed because it animated similarly to `Overhead` and added
// detection noise. After #139 the keys are unified `Direction` enum
// values (Overhead=0, Left=1, Right=2, Stab=3) instead of the old
// `AttackDirection` (Left=0, Right=1, Overhead=2, Stab=3).
//
// #219 audit: the RIGHT-ARM / weapon-chain windup keyframes were NOT flipped.
// They were already tuned to the corrected -Z convention to crossfade
// seamlessly into the arc-swing Release starts in `arcSwing.ts` (Overhead's
// shoulder `x: -160°` is 2π-equivalent to arc `shoulderStart x: 3.5`;
// Left/Right chamber on the same lateral hemisphere as their arc starts;
// Stab keeps its rear elbow chamber). Negating them would break the
// windup→Release crossfade. Pinned by `BladeTimingParity.test.ts` (Release)
// and the windup-hemisphere checks in `AnimationData.orientation.test.ts`.
//
// #227 follow-up: that #219 guarantee covered the RIGHT-ARM / weapon chain
// ONLY. The off-hand chain (`shoulder_L` / `upper_arm_L` / `forearm_L`) was
// still authored to the old +Z convention and read backward (toward the
// camera) at the start of every swing. It was corrected here via the Ry(π)
// conjugation — negate the X and Z Euler components, keep Y — after measuring
// each pose's `hand_L` world-z empirically (see the per-pose notes below and
// the hand_L assertions in `AnimationData.orientation.test.ts`). Hitboxes and
// tracers read `weapon_attach` / `hand_R` only, so the off-hand is cosmetic —
// no hit/tracer test moved. Overhead windup was measured neutral and left as
// authored (see its note).

const ATTACK_ANIMATIONS: Record<number, CombatAnimation> = {
  // ── Left Swing ──
  // A Left slash sweeps the arm from the player's RIGHT side across the
  // front to the left. Chamber = arm raised out to the right (+z on
  // shoulder_R) with the chest wound so the right shoulder pulls BACK
  // (chest -y). Matches the arc-swing Release start {x: 1.35, z: 1.25}.
  [Direction.Left as number]: {
    windup: {
      chest: { y: -35 * DEG },
      shoulder_R: { x: 72 * DEG, z: 68 * DEG },
      forearm_R: { x: -25 * DEG },
      // #227: off-hand flipped to -Z (Ry(π) conjugation; was {x:-10,z:15} →
      // full-pose hand_L.z ≈ +0.094 backward; now ≈ -0.421 forward).
      shoulder_L: { x: 10 * DEG, z: -15 * DEG },
      upper_arm_L: { x: 20 * DEG },
    },
    release: {
      // Chest unwinds through the swing — the right shoulder drives
      // forward-left. Right-arm bones are owned by the arc during Release.
      chest: { y: 35 * DEG },
      // #227: off-hand corrected to -Z (was {x:-10,z:10}/{x:-20} → hand_L.z ≈
      // +0.295 backward). The plain Ry(π) flip only reaches ≈ +0.03 here — the
      // (correct, untouched) chest y:+35 winds the torso so the left arm
      // trails backward — so the off-hand is given extra forward reach to
      // clear into the forward hemisphere: now hand_L.z ≈ -0.203 forward.
      shoulder_L: { x: 35 * DEG, z: -5 * DEG },
      upper_arm_L: { x: 45 * DEG },
    },
    recovery: IDLE_POSE,
  },

  // ── Right Swing ──
  // Mirror of Left: chamber pulls the arm across the body to the player's
  // LEFT (-z on shoulder_R), chest wound with the right shoulder forward
  // (chest +y), then unwinds right. Matches arc start {x: 1.35, z: -1.25}.
  [Direction.Right as number]: {
    windup: {
      chest: { y: 35 * DEG },
      shoulder_R: { x: 72 * DEG, z: -68 * DEG },
      forearm_R: { x: -25 * DEG },
      // #227: off-hand corrected to -Z (was {x:-15,z:25}/{x:-30} → hand_L.z ≈
      // +0.297 backward, the most visible case). Like Left release, the plain
      // Ry(π) flip only reaches ≈ +0.03 because the (untouched) chest y:+35
      // winds the torso back; extra forward reach clears it: now ≈ -0.156.
      shoulder_L: { x: 35 * DEG, z: -15 * DEG },
      upper_arm_L: { x: 45 * DEG },
    },
    release: {
      chest: { y: -35 * DEG },
      // #227: off-hand flipped (Ry(π); was {x:-10,z:15} → hand_L.z ≈ +0.094
      // backward; now ≈ -0.421 forward — chest y:-35 aids the flip here).
      shoulder_L: { x: 10 * DEG, z: -15 * DEG },
      upper_arm_L: { x: 20 * DEG },
    },
    recovery: IDLE_POSE,
  },

  // ── Overhead ──
  [Direction.Overhead as number]: {
    windup: {
      // Sword raised high above head
      chest: { x: -10 * DEG },
      shoulder_R: { x: -160 * DEG, z: -15 * DEG },
      upper_arm_R: { x: -10 * DEG },
      forearm_R: { x: -30 * DEG },
      // #227: off-hand LEFT AS AUTHORED. Measured hand_L.z ≈ -0.018 — neutral
      // (hand sits ~directly above the head as the arms raise), on the forward
      // side. `shoulder_L x:-140°` is a large-angle 2π-adjacency case, NOT the
      // small-negative +Z-authoring bug; the sign flip would push the off-hand
      // up-and-forward, a less natural overhead chamber. Do NOT "fix" by sign.
      shoulder_L: { x: -140 * DEG, z: 15 * DEG },
      upper_arm_L: { x: -10 * DEG },
      forearm_L: { x: -40 * DEG },
    },
    release: {
      // Chop down — arms come forward and down
      chest: { x: 15 * DEG },
      shoulder_R: { x: -30 * DEG, z: -10 * DEG },
      upper_arm_R: { x: -40 * DEG },
      forearm_R: { x: -50 * DEG },
      // #227: off-hand flipped (Ry(π); was {x:-20,z:10}/{x:-30}/{x:-30} →
      // hand_L.z ≈ +0.386 backward; now ≈ -0.405 forward). Small-negative
      // +Z-authoring bug — unlike the windup's large angle, the 2π caveat does
      // not apply. The off-hand now follows the chop forward, not trailing.
      shoulder_L: { x: 20 * DEG, z: -10 * DEG },
      upper_arm_L: { x: 30 * DEG },
      forearm_L: { x: 30 * DEG },
    },
    recovery: IDLE_POSE,
  },

  // ── Stab ──
  // Chamber = arm low-forward with the elbow fully bent (blade pulled back
  // at the hip) and the chest wound so the right shoulder pulls BACK
  // (chest -y). The Release arc extends the elbow while the shoulder rises
  // to near-horizontal — matches arc start {shoulder x: 0.5, forearm x: -1.5}.
  [Direction.Stab as number]: {
    windup: {
      chest: { y: -25 * DEG },
      shoulder_R: { x: 28 * DEG, z: -8 * DEG },
      forearm_R: { x: -88 * DEG },
      // #227: off-hand flipped (Ry(π); was {x:-40,z:20}/{x:-20}/{x:-30} →
      // hand_L.z ≈ +0.355 backward; now ≈ -0.596 forward).
      shoulder_L: { x: 40 * DEG, z: -20 * DEG },
      upper_arm_L: { x: 20 * DEG },
      forearm_L: { x: 30 * DEG },
    },
    release: {
      // Chest drives the right shoulder forward through the thrust. The
      // yaw is small (5°) on purpose: it laterally displaces the thrust
      // tip proportionally to weapon reach, and long weapons (Spear)
      // would otherwise stab well left of the crosshair.
      chest: { y: 5 * DEG, x: 5 * DEG },
      // #227: off-hand flipped (Ry(π); was {x:-20,z:15}/{x:-15}/{x:-10} →
      // hand_L.z ≈ +0.301 backward; now ≈ -0.284 forward).
      shoulder_L: { x: 20 * DEG, z: -15 * DEG },
      upper_arm_L: { x: 15 * DEG },
      forearm_L: { x: 10 * DEG },
    },
    recovery: IDLE_POSE,
  },
};

// ── Block Poses (4 directions) ───────────────────────────
//
// FSM v2 (#139): keys are the unified `Direction` enum. The old `Bottom`
// block direction (catch underhand attacks) is gone — Underhand attacks
// fold into Stab now. The `Stab` block pose reuses the low/forward guard
// (formerly Bottom) — visually it reads as a forward-thrust parry stance.

const BLOCK_POSES: Record<number, BlockPose> = {
  [Direction.Left as number]: {
    // Guard held out FORWARD on the defender's left — where an attacker's
    // Left slash (same-direction blocking, FSM v2 #139) arrives. Positive
    // shoulder x raises the arm into the front hemisphere; the old -60°
    // held the guard behind the defender's back.
    chest: { y: 15 * DEG },
    shoulder_R: { x: 60 * DEG, z: -35 * DEG },
    forearm_R: { x: -50 * DEG },
    shoulder_L: { x: -50 * DEG, z: 25 * DEG },
    upper_arm_L: { x: -30 * DEG },
    forearm_L: { x: -40 * DEG },
  },
  [Direction.Right as number]: {
    // Mirror: guard forward on the defender's right.
    chest: { y: -15 * DEG },
    shoulder_R: { x: 60 * DEG, z: 35 * DEG },
    forearm_R: { x: -50 * DEG },
    shoulder_L: { x: -40 * DEG, z: 15 * DEG },
    upper_arm_L: { x: -20 * DEG },
    forearm_L: { x: -30 * DEG },
  },
  [Direction.Overhead as number]: {
    // Sword held high above head, tipped FORWARD to catch a descending
    // overhead attack (formerly BlockDirection.Top). #219: corrected from
    // the +Z-authored `x: -150°` (which resolved the guard toward the
    // camera, hand world-z ≈ +0.11) via Ry(π) conjugation (negate X and Z,
    // keep Y). The Left/Right/Stab blocks were already fixed for the -Z
    // convention in #139; this brings Overhead into line.
    shoulder_R: { x: 150 * DEG, z: 10 * DEG },
    upper_arm_R: { x: 10 * DEG },
    forearm_R: { x: 20 * DEG },
    shoulder_L: { x: 130 * DEG, z: -10 * DEG },
    upper_arm_L: { x: 10 * DEG },
    forearm_L: { x: 30 * DEG },
  },
  [Direction.Stab as number]: {
    // Sword held low/forward to catch a thrust (reuses the v1 `Bottom` pose).
    chest: { x: 10 * DEG },
    shoulder_R: { x: 10 * DEG, z: -20 * DEG },
    upper_arm_R: { x: 10 * DEG },
    forearm_R: { x: -20 * DEG },
    shoulder_L: { x: 0, z: 15 * DEG },
    upper_arm_L: { x: 5 * DEG },
    forearm_L: { x: -10 * DEG },
  },
};

// ── Movement Animation Parameters ────────────────────────

export const MOVEMENT_PARAMS: Record<string, MovementAnimParams> = {
  idle: {
    legSwing: 0,
    armSwing: 0,
    cycleSpeed: 1,
    basePose: {
      // Subtle idle stance
      thigh_L: { x: 0 },
      thigh_R: { x: 0 },
      shin_L: { x: 0 },
      shin_R: { x: 0 },
    },
  },
  walk: {
    legSwing: 20 * DEG,
    armSwing: 10 * DEG,
    cycleSpeed: 4,
    basePose: {},
  },
  run: {
    legSwing: 35 * DEG,
    armSwing: 20 * DEG,
    cycleSpeed: 6.5,
    basePose: {
      chest: { x: 5 * DEG }, // slight forward lean when running
    },
  },
  crouch: {
    legSwing: 0,
    armSwing: 0,
    cycleSpeed: 1,
    basePose: {
      spine: { x: 15 * DEG },
      thigh_L: { x: -40 * DEG },
      thigh_R: { x: -40 * DEG },
      shin_L: { x: 40 * DEG },
      shin_R: { x: 40 * DEG },
    },
  },
  jump: {
    legSwing: 0,
    armSwing: 0,
    cycleSpeed: 0,
    basePose: {
      shoulder_L: { x: -30 * DEG, z: 30 * DEG },
      shoulder_R: { x: -30 * DEG, z: -30 * DEG },
      thigh_L: { x: -20 * DEG },
      thigh_R: { x: -20 * DEG },
      shin_L: { x: 30 * DEG },
      shin_R: { x: 30 * DEG },
    },
  },
};

// ── Parry visual feedback pose (slight knockback) ────────

// #219: corrected from the +Z-authored pose (shoulder_R `x: -80°` threw the
// sword arm toward the camera, hand world-z ≈ +0.34) via Ry(π) conjugation
// (negate X and Z, keep Y). The parry now reads as a forward blade-catch
// with a slight upward recoil, on the character's facing side (-Z).
export const PARRY_POSE: Pose = {
  chest: { x: 10 * DEG },
  shoulder_R: { x: 80 * DEG, z: 20 * DEG },
  upper_arm_R: { x: 20 * DEG },
  forearm_R: { x: 40 * DEG },
};

// ── Stunned pose ─────────────────────────────────────────
//
// #219 audit: already authored to the -Z convention (positive shoulder_R x
// → arms forward, hand world-z ≈ -0.30). NOT flipped. (Dead code anyway —
// FSM v2 folded Stunned into HitStun — but kept convention-correct.)

export const STUNNED_POSE: Pose = {
  chest: { x: 15 * DEG, y: 10 * DEG },
  shoulder_R: { x: 20 * DEG, z: -10 * DEG },
  upper_arm_R: { x: 10 * DEG },
  forearm_R: { x: -10 * DEG },
  shoulder_L: { x: 15 * DEG, z: 10 * DEG },
  upper_arm_L: { x: 10 * DEG },
  head: { x: 10 * DEG, z: 5 * DEG },
};

// ── HitStun pose ─────────────────────────────────────────
//
// #219 audit: already authored to the -Z convention (positive shoulder_R /
// upper_arm_R x → defensive flinch forward, hand world-z ≈ -0.24). NOT
// flipped — flipping would throw the guard toward the camera. The
// directional stagger lean (`applyHitReactLean`) composes on top in
// body-local space and is convention-agnostic.

export const HITSTUN_POSE: Pose = {
  chest: { x: 10 * DEG, z: -5 * DEG },
  shoulder_R: { x: 10 * DEG },
  upper_arm_R: { x: 15 * DEG },
  shoulder_L: { x: 10 * DEG },
  upper_arm_L: { x: 15 * DEG },
  head: { x: -5 * DEG },
};

// ── Lookup Functions ─────────────────────────────────────

/**
 * Get the combat animation data for a given attack direction.
 * Returns the full animation with windup/release/recovery poses.
 */
export function getAttackAnimation(direction: Direction): CombatAnimation {
  return ATTACK_ANIMATIONS[direction as number] ?? ATTACK_ANIMATIONS[Direction.Stab as number];
}

/**
 * Get the block pose for a given block direction (FSM v2 unified `Direction`).
 * Falls back to the Overhead block pose for unknown values.
 */
export function getBlockPose(direction: Direction): BlockPose {
  return BLOCK_POSES[direction as number] ?? BLOCK_POSES[Direction.Overhead as number];
}

/**
 * Get the target pose for a combat state and direction.
 * This is the main lookup used by the AnimationSystem.
 */
export function getCombatPose(
  state: CombatState,
  direction: number,
): Pose {
  switch (state) {
    case CombatState.Idle:
      return IDLE_POSE;

    case CombatState.Windup:
      return getAttackAnimation(direction as Direction).windup;

    case CombatState.Release:
      return getAttackAnimation(direction as Direction).release;

    case CombatState.Recovery:
      return getAttackAnimation(direction as Direction).recovery;

    case CombatState.Blocking:
      return getBlockPose(direction as Direction);

    // FSM v2 (#135): `Parry` is a brief locked pose after a successful
    // parry (formerly `ParryWindow`). The standalone parry-window state
    // is gone — incoming-parry detection now reads `parryActive` off the
    // FSM, not a separate state.
    case CombatState.Parry:
      return PARRY_POSE;

    // FSM v2: `Stunned` and `Clash` were absorbed into `HitStun`.
    case CombatState.HitStun:
      return HITSTUN_POSE;

    default:
      return IDLE_POSE;
  }
}

/**
 * Get the movement animation parameters for a movement state key.
 */
export function getMovementParams(key: string): MovementAnimParams {
  return MOVEMENT_PARAMS[key] ?? MOVEMENT_PARAMS['idle'];
}

/** Gait numbers shared by walk and run, continuously blendable. */
export interface GaitParams {
  legSwing: number;
  armSwing: number;
  cycleSpeed: number;
}

/**
 * Continuously blended walk↔run gait (#goal-2026-07 locomotion pass).
 *
 * `speedNorm` is the entity's planar speed normalized to sprint speed
 * (plain walking ≈ 0.6, full sprint = 1.0). The old system picked walk
 * OR run params at a hard speedFactor threshold, so stride length and
 * cadence JUMPED mid-motion. This lerps the three gait numbers across
 * the 0.55→1.0 band instead: pure walk gait at walking pace, pure run
 * gait at sprint, smooth in between.
 */
export function getBlendedGaitParams(speedNorm: number): GaitParams {
  const walk = MOVEMENT_PARAMS['walk'];
  const run = MOVEMENT_PARAMS['run'];
  const t = Math.max(0, Math.min(1, (speedNorm - 0.55) / 0.45));
  return {
    legSwing: walk.legSwing + (run.legSwing - walk.legSwing) * t,
    armSwing: walk.armSwing + (run.armSwing - walk.armSwing) * t,
    cycleSpeed: walk.cycleSpeed + (run.cycleSpeed - walk.cycleSpeed) * t,
  };
}

// ── Upper/Lower body bone sets ───────────────────────────

/** Bones controlled by combat (upper body) animations */
export const UPPER_BODY_BONES: ReadonlySet<string> = new Set([
  'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upper_arm_L', 'forearm_L', 'hand_L',
  'shoulder_R', 'upper_arm_R', 'forearm_R', 'hand_R',
]);

/**
 * Upper-body bones MINUS spine. Used by the rebuilt AnimationSystem
 * (issue #128) so the combat layer can claim arms + chest + head + neck
 * while leaving spine ownership to the §5 precedence rule (combat owns
 * spine iff the combat pose has a spine entry, else movement owns it).
 *
 * This replaces the old fixed `60/40` blend (`AnimationSystem.ts:294-303`
 * pre-rebuild) where both layers wrote spine and the result drifted.
 */
export const UPPER_BODY_BONES_EXCEPT_SPINE: ReadonlySet<string> = new Set([
  'chest', 'neck', 'head',
  'shoulder_L', 'upper_arm_L', 'forearm_L', 'hand_L',
  'shoulder_R', 'upper_arm_R', 'forearm_R', 'hand_R',
]);

/** Bones controlled by movement (lower body) animations */
export const LOWER_BODY_BONES: ReadonlySet<string> = new Set([
  'thigh_L', 'shin_L', 'foot_L',
  'thigh_R', 'shin_R', 'foot_R',
]);

/**
 * @deprecated The fixed-ratio shared-bone blend was replaced by the
 * §5 layer-ownership precedence rule (issue #128). Spine is now owned
 * by exactly one layer per tick — combat if the pose specifies it, else
 * movement, else rest. New code SHOULD NOT use this set.
 *
 * Kept exported for backward compat with consumers that haven't migrated;
 * remove in a follow-up cleanup once those land.
 */
export const SHARED_BONES: ReadonlySet<string> = new Set([
  'spine',
]);
