/**
 * Per-weapon first-person viewmodel animation data.
 *
 * First-person poses are tuned separately from third-person (AnimationData.ts)
 * because the camera IS the character's eyes — swings need to be exaggerated
 * to feel impactful, and must stay within viewport bounds.
 *
 * Only right arm bones matter: upper_arm_R, forearm_R, hand_R.
 * The viewmodel has no torso, left arm, or legs.
 *
 * ── Rotation convention (issues #182 / c382023) ──
 *
 * The shoulder bone (upper_arm_R) sits at the viewmodel group origin and the
 * arm hangs DOWN from it (-Y in local space). To make the chain extend INTO
 * the viewport (camera-local -Z = forward), the X rotation must be POSITIVE.
 *   Three.js right-hand rule: Rx(+θ) rotates +Y → +Z, so applied to a -Y
 *   arm: Rx(+90°) points the chain along camera -Z (forward of camera).
 * Negative X rotations would extend the chain BEHIND the camera, which is
 * the bug c382023 fixed for IDLE and #182 fixes for every other pose.
 *
 * Practical rules used to author the values below:
 * - upper_arm_R.x ∈ [+20°, +120°] — choose larger values for raised poses.
 * - forearm_R.x positive → forearm continues forward-curve at the elbow;
 *   large positive values (≥+90°) fold the forearm UP toward the chest
 *   (used for stab windups and high-block hand positions).
 * - hand_R.x small (-30° to +25°) — wrist tilt. Negative tilts weapon up-and-back
 *   relative to the hand; positive tilts down-and-forward.
 * - upper_arm_R.z tilts arm side-to-side (positive = arm tilts to camera +X,
 *   "right"); use it for horizontal swing chamber/release.
 * - upper_arm_R.y twists the upper arm around its long axis.
 *
 * Recovery poses for every direction match IDLE exactly (the swing settles
 * back to ready stance).
 */

import { CombatState } from '../combat/states';
import { Direction } from '../combat/directions';
import type { Pose, BoneRotation, CombatAnimation } from './AnimationData';

// ── Types ────────────────────────────────────────────────

/** Per-weapon viewmodel pose set */
export interface ViewmodelWeaponAnims {
  idle: Pose;
  attacks: Record<number, CombatAnimation>;   // 4 Direction × 3 phases (FSM v2 #139)
  blocks: Record<number, Pose>;               // 4 Direction
  parry: Pose;
  stunned: Pose;
  hitStun: Pose;
}

// ── Helper ──────────────────────────────────────────────

const DEG = Math.PI / 180;

// ── Longsword — wide sweeping arcs, classic medieval FPS feel ──

const LONGSWORD_IDLE: Pose = {
  // X rotations are POSITIVE so the chain extends FORWARD (-Z camera-local)
  // from the shoulder, putting the hand + weapon in front of the camera.
  // Chain total ≈ 98°: hand sits lower-right INSIDE the fov-70 frustum.
  // (The pre-2026-07 values totalled ~65° — the hand hung 0.69 m below
  // the camera, under the frustum's bottom plane, and the weapon was
  // invisible in first person. That was the #181 mystery.)
  upper_arm_R: { x: 48 * DEG, z: -8 * DEG },
  forearm_R:   { x: 50 * DEG },
  hand_R:      { x: 5 * DEG, z: -5 * DEG },
};

const LONGSWORD_ATTACKS: Record<number, CombatAnimation> = {
  [Direction.Left as number]: {
    // Left slash: swings from upper-right chamber to lower-left finish.
    windup: {
      // Chamber to upper-right: arm pulled across, tilted right, twisted.
      upper_arm_R: { x: 50 * DEG, y: -20 * DEG, z: 45 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { z: -10 * DEG },
    },
    release: {
      // Sweep through to lower-left: arm twisted opposite, tilted left.
      upper_arm_R: { x: 40 * DEG, y: 30 * DEG, z: -45 * DEG },
      forearm_R:   { x: 40 * DEG },
      hand_R:      { z: 15 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 30 * DEG, z: -8 * DEG },
      forearm_R:   { x: 35 * DEG },
      hand_R:      { x: 5 * DEG, z: -5 * DEG },
    },
  },
  [Direction.Right as number]: {
    // Right slash: mirror of Left.
    windup: {
      upper_arm_R: { x: 50 * DEG, y: 20 * DEG, z: -45 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { z: 10 * DEG },
    },
    release: {
      upper_arm_R: { x: 40 * DEG, y: -30 * DEG, z: 45 * DEG },
      forearm_R:   { x: 40 * DEG },
      hand_R:      { z: -15 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 30 * DEG, z: -8 * DEG },
      forearm_R:   { x: 35 * DEG },
      hand_R:      { x: 5 * DEG, z: -5 * DEG },
    },
  },
  [Direction.Overhead as number]: {
    // Overhead chop: high chamber → strike down forward.
    windup: {
      // Arm raised up-and-forward (near vertical); wrist tips weapon back
      // over the head so the blade silhouettes near the top of the frame.
      upper_arm_R: { x: 110 * DEG, z: -10 * DEG },
      forearm_R:   { x: 25 * DEG },
      hand_R:      { x: -20 * DEG },
    },
    release: {
      // Arm chops down through the forward zone; forearm extends.
      upper_arm_R: { x: 60 * DEG, z: -5 * DEG },
      forearm_R:   { x: 60 * DEG },
      hand_R:      { x: 15 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 30 * DEG, z: -8 * DEG },
      forearm_R:   { x: 35 * DEG },
      hand_R:      { x: 5 * DEG, z: -5 * DEG },
    },
  },
  [Direction.Stab as number]: {
    // Forward thrust: weapon pulled back near body, then jabbed forward.
    windup: {
      // Hand chambered close to shoulder: forearm folded UP (large +x).
      upper_arm_R: { x: 25 * DEG, z: -10 * DEG },
      forearm_R:   { x: 100 * DEG },
      hand_R:      { x: -5 * DEG },
    },
    release: {
      // Full extension forward: upper arm near horizontal, forearm straight.
      upper_arm_R: { x: 75 * DEG, z: -5 * DEG },
      forearm_R:   { x: 15 * DEG },
      hand_R:      { x: 5 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 30 * DEG, z: -8 * DEG },
      forearm_R:   { x: 35 * DEG },
      hand_R:      { x: 5 * DEG, z: -5 * DEG },
    },
  },
};

const LONGSWORD_BLOCKS: Record<number, Pose> = {
  [Direction.Left as number]: {
    // Weapon braced forward, angled across body to the LEFT side.
    upper_arm_R: { x: 50 * DEG, y: -15 * DEG, z: 35 * DEG },
    forearm_R:   { x: 45 * DEG },
    hand_R:      { z: -15 * DEG },
  },
  [Direction.Right as number]: {
    upper_arm_R: { x: 50 * DEG, y: 15 * DEG, z: -35 * DEG },
    forearm_R:   { x: 45 * DEG },
    hand_R:      { z: 15 * DEG },
  },
  [Direction.Overhead as number]: {
    // Weapon held HIGH to catch overhead strikes — arm raised, wrist back.
    upper_arm_R: { x: 95 * DEG, z: -8 * DEG },
    forearm_R:   { x: 25 * DEG },
    hand_R:      { x: -25 * DEG },
  },
  [Direction.Stab as number]: {
    // Weapon angled forward to deflect a thrust — wider forearm bend.
    upper_arm_R: { x: 55 * DEG, z: -15 * DEG },
    forearm_R:   { x: 60 * DEG },
    hand_R:      { x: 10 * DEG },
  },
};

const LONGSWORD_PARRY: Pose = {
  // Snap-up parry stance: weapon raised aggressively across centerline.
  upper_arm_R: { x: 60 * DEG, z: -15 * DEG },
  forearm_R:   { x: 50 * DEG },
  hand_R:      { x: -5 * DEG, z: 5 * DEG },
};

const LONGSWORD_STUNNED: Pose = {
  // Arm slightly relaxed but still forward; weapon visible.
  upper_arm_R: { x: 25 * DEG, z: -10 * DEG },
  forearm_R:   { x: 25 * DEG },
  hand_R:      { z: 8 * DEG },
};

const LONGSWORD_HITSTUN: Pose = {
  // Brief flinch off-axis — weapon stays in frame, slight wrist jolt.
  upper_arm_R: { x: 35 * DEG, z: 5 * DEG },
  forearm_R:   { x: 25 * DEG },
  hand_R:      { z: -8 * DEG },
};

const LONGSWORD_ANIMS: ViewmodelWeaponAnims = {
  idle: LONGSWORD_IDLE,
  attacks: LONGSWORD_ATTACKS,
  blocks: LONGSWORD_BLOCKS,
  parry: LONGSWORD_PARRY,
  stunned: LONGSWORD_STUNNED,
  hitStun: LONGSWORD_HITSTUN,
};

// ── Mace — heavy, slower swings, extra wrist rotation ───

const MACE_IDLE: Pose = {
  upper_arm_R: { x: 46 * DEG, z: -10 * DEG },
  forearm_R:   { x: 48 * DEG },
  hand_R:      { x: 5 * DEG, z: -8 * DEG, y: 5 * DEG },
};

const MACE_ATTACKS: Record<number, CombatAnimation> = {
  [Direction.Left as number]: {
    windup: {
      // Bigger chamber than longsword — heavier weapon needs more wind-back.
      upper_arm_R: { x: 55 * DEG, y: -25 * DEG, z: 50 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { z: -15 * DEG, y: 10 * DEG },
    },
    release: {
      upper_arm_R: { x: 40 * DEG, y: 35 * DEG, z: -50 * DEG },
      forearm_R:   { x: 35 * DEG },
      hand_R:      { z: 20 * DEG, y: -10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 28 * DEG, z: -10 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { x: 5 * DEG, z: -8 * DEG, y: 5 * DEG },
    },
  },
  [Direction.Right as number]: {
    windup: {
      upper_arm_R: { x: 55 * DEG, y: 25 * DEG, z: -50 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { z: 15 * DEG, y: -10 * DEG },
    },
    release: {
      upper_arm_R: { x: 40 * DEG, y: -35 * DEG, z: 50 * DEG },
      forearm_R:   { x: 35 * DEG },
      hand_R:      { z: -20 * DEG, y: 10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 28 * DEG, z: -10 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { x: 5 * DEG, z: -8 * DEG, y: 5 * DEG },
    },
  },
  [Direction.Overhead as number]: {
    windup: {
      // Heavier wind-back than longsword.
      upper_arm_R: { x: 115 * DEG, z: -12 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { x: -25 * DEG, z: 5 * DEG },
    },
    release: {
      // Powerful slam — more wrist + forearm follow-through than longsword.
      upper_arm_R: { x: 55 * DEG, z: -5 * DEG },
      forearm_R:   { x: 70 * DEG },
      hand_R:      { x: 25 * DEG, z: -10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 28 * DEG, z: -10 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { x: 5 * DEG, z: -8 * DEG, y: 5 * DEG },
    },
  },
  [Direction.Stab as number]: {
    windup: {
      upper_arm_R: { x: 20 * DEG, z: -12 * DEG },
      forearm_R:   { x: 105 * DEG },
      hand_R:      { x: -10 * DEG, y: 5 * DEG },
    },
    release: {
      upper_arm_R: { x: 70 * DEG, z: -5 * DEG },
      forearm_R:   { x: 20 * DEG },
      hand_R:      { x: 10 * DEG, y: -5 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 28 * DEG, z: -10 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { x: 5 * DEG, z: -8 * DEG, y: 5 * DEG },
    },
  },
};

const MACE_BLOCKS: Record<number, Pose> = {
  [Direction.Left as number]: {
    upper_arm_R: { x: 50 * DEG, y: -20 * DEG, z: 40 * DEG },
    forearm_R:   { x: 40 * DEG },
    hand_R:      { z: -20 * DEG, y: 8 * DEG },
  },
  [Direction.Right as number]: {
    upper_arm_R: { x: 50 * DEG, y: 20 * DEG, z: -40 * DEG },
    forearm_R:   { x: 40 * DEG },
    hand_R:      { z: 20 * DEG, y: -8 * DEG },
  },
  [Direction.Overhead as number]: {
    upper_arm_R: { x: 100 * DEG, z: -10 * DEG },
    forearm_R:   { x: 25 * DEG },
    hand_R:      { x: -20 * DEG },
  },
  [Direction.Stab as number]: {
    upper_arm_R: { x: 55 * DEG, z: -15 * DEG },
    forearm_R:   { x: 60 * DEG },
    hand_R:      { x: 12 * DEG, y: 5 * DEG },
  },
};

const MACE_PARRY: Pose = {
  upper_arm_R: { x: 55 * DEG, z: -15 * DEG },
  forearm_R:   { x: 50 * DEG },
  hand_R:      { z: 10 * DEG, y: -8 * DEG },
};

const MACE_STUNNED: Pose = {
  upper_arm_R: { x: 22 * DEG, z: -12 * DEG },
  forearm_R:   { x: 25 * DEG },
  hand_R:      { z: 12 * DEG, y: 5 * DEG },
};

const MACE_HITSTUN: Pose = {
  upper_arm_R: { x: 35 * DEG, z: -5 * DEG },
  forearm_R:   { x: 25 * DEG },
  hand_R:      { z: -10 * DEG, y: -5 * DEG },
};

const MACE_ANIMS: ViewmodelWeaponAnims = {
  idle: MACE_IDLE,
  attacks: MACE_ATTACKS,
  blocks: MACE_BLOCKS,
  parry: MACE_PARRY,
  stunned: MACE_STUNNED,
  hitStun: MACE_HITSTUN,
};

// ── Dagger — quick, snappy motions, tight close-range ───

const DAGGER_IDLE: Pose = {
  upper_arm_R: { x: 42 * DEG, z: -5 * DEG },
  forearm_R:   { x: 58 * DEG },
  hand_R:      { x: 8 * DEG, z: -3 * DEG },
};

const DAGGER_ATTACKS: Record<number, CombatAnimation> = {
  [Direction.Left as number]: {
    windup: {
      // Smaller chamber than longsword/mace — dagger is fast and tight.
      upper_arm_R: { x: 40 * DEG, y: -15 * DEG, z: 30 * DEG },
      forearm_R:   { x: 35 * DEG },
      hand_R:      { z: -8 * DEG },
    },
    release: {
      upper_arm_R: { x: 35 * DEG, y: 25 * DEG, z: -35 * DEG },
      forearm_R:   { x: 40 * DEG },
      hand_R:      { z: 10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 22 * DEG, z: -5 * DEG },
      forearm_R:   { x: 45 * DEG },
      hand_R:      { x: 8 * DEG, z: -3 * DEG },
    },
  },
  [Direction.Right as number]: {
    windup: {
      upper_arm_R: { x: 40 * DEG, y: 15 * DEG, z: -30 * DEG },
      forearm_R:   { x: 35 * DEG },
      hand_R:      { z: 8 * DEG },
    },
    release: {
      upper_arm_R: { x: 35 * DEG, y: -25 * DEG, z: 35 * DEG },
      forearm_R:   { x: 40 * DEG },
      hand_R:      { z: -10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 22 * DEG, z: -5 * DEG },
      forearm_R:   { x: 45 * DEG },
      hand_R:      { x: 8 * DEG, z: -3 * DEG },
    },
  },
  [Direction.Overhead as number]: {
    windup: {
      // Shorter chamber than longsword — dagger goes up less.
      upper_arm_R: { x: 85 * DEG, z: -8 * DEG },
      forearm_R:   { x: 35 * DEG },
      hand_R:      { x: -15 * DEG },
    },
    release: {
      upper_arm_R: { x: 50 * DEG, z: -3 * DEG },
      forearm_R:   { x: 55 * DEG },
      hand_R:      { x: 10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 22 * DEG, z: -5 * DEG },
      forearm_R:   { x: 45 * DEG },
      hand_R:      { x: 8 * DEG, z: -3 * DEG },
    },
  },
  // Stab is the dagger's signature — explosive thrust, tighter chamber.
  [Direction.Stab as number]: {
    windup: {
      // Forearm folded tighter than longsword for an explosive release.
      upper_arm_R: { x: 20 * DEG, z: -5 * DEG },
      forearm_R:   { x: 110 * DEG },
      hand_R:      { x: -5 * DEG },
    },
    release: {
      // Full extension — arm nearly horizontal.
      upper_arm_R: { x: 80 * DEG, z: -3 * DEG },
      forearm_R:   { x: 5 * DEG },
      hand_R:      { x: 5 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 22 * DEG, z: -5 * DEG },
      forearm_R:   { x: 45 * DEG },
      hand_R:      { x: 8 * DEG, z: -3 * DEG },
    },
  },
};

const DAGGER_BLOCKS: Record<number, Pose> = {
  [Direction.Left as number]: {
    upper_arm_R: { x: 45 * DEG, y: -12 * DEG, z: 25 * DEG },
    forearm_R:   { x: 50 * DEG },
    hand_R:      { z: -10 * DEG },
  },
  [Direction.Right as number]: {
    upper_arm_R: { x: 45 * DEG, y: 12 * DEG, z: -25 * DEG },
    forearm_R:   { x: 50 * DEG },
    hand_R:      { z: 10 * DEG },
  },
  [Direction.Overhead as number]: {
    upper_arm_R: { x: 80 * DEG, z: -5 * DEG },
    forearm_R:   { x: 30 * DEG },
    hand_R:      { x: -15 * DEG },
  },
  [Direction.Stab as number]: {
    upper_arm_R: { x: 50 * DEG, z: -10 * DEG },
    forearm_R:   { x: 65 * DEG },
    hand_R:      { x: 10 * DEG },
  },
};

const DAGGER_PARRY: Pose = {
  upper_arm_R: { x: 50 * DEG, z: -10 * DEG },
  forearm_R:   { x: 55 * DEG },
  hand_R:      { z: 8 * DEG },
};

const DAGGER_STUNNED: Pose = {
  upper_arm_R: { x: 18 * DEG, z: -8 * DEG },
  forearm_R:   { x: 30 * DEG },
  hand_R:      { z: 5 * DEG },
};

const DAGGER_HITSTUN: Pose = {
  upper_arm_R: { x: 25 * DEG, z: 3 * DEG },
  forearm_R:   { x: 30 * DEG },
  hand_R:      { z: -5 * DEG },
};

const DAGGER_ANIMS: ViewmodelWeaponAnims = {
  idle: DAGGER_IDLE,
  attacks: DAGGER_ATTACKS,
  blocks: DAGGER_BLOCKS,
  parry: DAGGER_PARRY,
  stunned: DAGGER_STUNNED,
  hitStun: DAGGER_HITSTUN,
};

// ── Battleaxe — exaggerated windups, devastating releases ──

const BATTLEAXE_IDLE: Pose = {
  upper_arm_R: { x: 50 * DEG, z: -12 * DEG },
  forearm_R:   { x: 45 * DEG },
  hand_R:      { x: 5 * DEG, z: -10 * DEG },
};

const BATTLEAXE_ATTACKS: Record<number, CombatAnimation> = {
  [Direction.Left as number]: {
    windup: {
      // Biggest chamber of all four weapons — arm hauled WAY back.
      upper_arm_R: { x: 60 * DEG, y: -30 * DEG, z: 55 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { z: -15 * DEG },
    },
    release: {
      // Wide devastating sweep across.
      upper_arm_R: { x: 45 * DEG, y: 40 * DEG, z: -55 * DEG },
      forearm_R:   { x: 40 * DEG },
      hand_R:      { z: 22 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 32 * DEG, z: -12 * DEG },
      forearm_R:   { x: 25 * DEG },
      hand_R:      { x: 5 * DEG, z: -10 * DEG },
    },
  },
  [Direction.Right as number]: {
    windup: {
      upper_arm_R: { x: 60 * DEG, y: 30 * DEG, z: -55 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { z: 15 * DEG },
    },
    release: {
      upper_arm_R: { x: 45 * DEG, y: -40 * DEG, z: 55 * DEG },
      forearm_R:   { x: 40 * DEG },
      hand_R:      { z: -22 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 32 * DEG, z: -12 * DEG },
      forearm_R:   { x: 25 * DEG },
      hand_R:      { x: 5 * DEG, z: -10 * DEG },
    },
  },
  [Direction.Overhead as number]: {
    windup: {
      // Most exaggerated overhead wind — arm well past vertical.
      upper_arm_R: { x: 120 * DEG, z: -15 * DEG },
      forearm_R:   { x: 25 * DEG },
      hand_R:      { x: -30 * DEG },
    },
    release: {
      // Powerful chop with heavy follow-through.
      upper_arm_R: { x: 55 * DEG, z: -5 * DEG },
      forearm_R:   { x: 75 * DEG },
      hand_R:      { x: 25 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 32 * DEG, z: -12 * DEG },
      forearm_R:   { x: 25 * DEG },
      hand_R:      { x: 5 * DEG, z: -10 * DEG },
    },
  },
  [Direction.Stab as number]: {
    windup: {
      upper_arm_R: { x: 25 * DEG, z: -15 * DEG },
      forearm_R:   { x: 110 * DEG },
      hand_R:      { x: -10 * DEG },
    },
    release: {
      upper_arm_R: { x: 75 * DEG, z: -5 * DEG },
      forearm_R:   { x: 15 * DEG },
      hand_R:      { x: 5 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 32 * DEG, z: -12 * DEG },
      forearm_R:   { x: 25 * DEG },
      hand_R:      { x: 5 * DEG, z: -10 * DEG },
    },
  },
};

const BATTLEAXE_BLOCKS: Record<number, Pose> = {
  [Direction.Left as number]: {
    upper_arm_R: { x: 55 * DEG, y: -22 * DEG, z: 42 * DEG },
    forearm_R:   { x: 42 * DEG },
    hand_R:      { z: -18 * DEG },
  },
  [Direction.Right as number]: {
    upper_arm_R: { x: 55 * DEG, y: 22 * DEG, z: -42 * DEG },
    forearm_R:   { x: 42 * DEG },
    hand_R:      { z: 18 * DEG },
  },
  [Direction.Overhead as number]: {
    upper_arm_R: { x: 105 * DEG, z: -10 * DEG },
    forearm_R:   { x: 25 * DEG },
    hand_R:      { x: -25 * DEG },
  },
  [Direction.Stab as number]: {
    upper_arm_R: { x: 60 * DEG, z: -20 * DEG },
    forearm_R:   { x: 55 * DEG },
    hand_R:      { x: 10 * DEG },
  },
};

const BATTLEAXE_PARRY: Pose = {
  upper_arm_R: { x: 65 * DEG, z: -20 * DEG },
  forearm_R:   { x: 45 * DEG },
  hand_R:      { z: 8 * DEG, x: -8 * DEG },
};

const BATTLEAXE_STUNNED: Pose = {
  upper_arm_R: { x: 28 * DEG, z: -15 * DEG },
  forearm_R:   { x: 20 * DEG },
  hand_R:      { z: 15 * DEG },
};

const BATTLEAXE_HITSTUN: Pose = {
  upper_arm_R: { x: 38 * DEG, z: 5 * DEG },
  forearm_R:   { x: 20 * DEG },
  hand_R:      { z: -10 * DEG },
};

const BATTLEAXE_ANIMS: ViewmodelWeaponAnims = {
  idle: BATTLEAXE_IDLE,
  attacks: BATTLEAXE_ATTACKS,
  blocks: BATTLEAXE_BLOCKS,
  parry: BATTLEAXE_PARRY,
  stunned: BATTLEAXE_STUNNED,
  hitStun: BATTLEAXE_HITSTUN,
};

// ── Zweihander — a fence post with edges. Enormous chambers, the
// highest overhead silhouette in the game, wide flat-footed blocks. ──

const ZWEIHANDER_IDLE: Pose = {
  upper_arm_R: { x: 52 * DEG, z: -14 * DEG },
  forearm_R:   { x: 58 * DEG },
  hand_R:      { z: -4 * DEG },
};

const ZWEIHANDER_ATTACKS: Record<number, CombatAnimation> = {
  [Direction.Left as number]: {
    // Massive cross-body chamber — the whole frame loads the cut.
    windup: {
      upper_arm_R: { x: 58 * DEG, y: -30 * DEG, z: 58 * DEG },
      forearm_R:   { x: 25 * DEG },
      hand_R:      { z: -18 * DEG },
    },
    release: {
      upper_arm_R: { x: 38 * DEG, y: 38 * DEG, z: -58 * DEG },
      forearm_R:   { x: 42 * DEG },
      hand_R:      { z: 20 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 32 * DEG, z: -14 * DEG },
      forearm_R:   { x: 46 * DEG },
      hand_R:      { z: -4 * DEG },
    },
  },
  [Direction.Right as number]: {
    // Mirror of Left.
    windup: {
      upper_arm_R: { x: 58 * DEG, y: 30 * DEG, z: -58 * DEG },
      forearm_R:   { x: 25 * DEG },
      hand_R:      { z: 18 * DEG },
    },
    release: {
      upper_arm_R: { x: 38 * DEG, y: -38 * DEG, z: 58 * DEG },
      forearm_R:   { x: 42 * DEG },
      hand_R:      { z: -20 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 32 * DEG, z: -14 * DEG },
      forearm_R:   { x: 46 * DEG },
      hand_R:      { z: -4 * DEG },
    },
  },
  [Direction.Overhead as number]: {
    // Highest chamber in the arsenal: blade towers over the frame.
    windup: {
      upper_arm_R: { x: 118 * DEG, z: -14 * DEG },
      forearm_R:   { x: 20 * DEG },
      hand_R:      { x: -28 * DEG },
    },
    release: {
      upper_arm_R: { x: 55 * DEG, z: -6 * DEG },
      forearm_R:   { x: 65 * DEG },
      hand_R:      { x: 18 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 32 * DEG, z: -14 * DEG },
      forearm_R:   { x: 46 * DEG },
      hand_R:      { z: -4 * DEG },
    },
  },
  [Direction.Stab as number]: {
    // Half-sword thrust: hands pulled way in before the drive.
    windup: {
      upper_arm_R: { x: 22 * DEG, z: -12 * DEG },
      forearm_R:   { x: 105 * DEG },
      hand_R:      { x: -8 * DEG },
    },
    release: {
      upper_arm_R: { x: 70 * DEG, z: -6 * DEG },
      forearm_R:   { x: 18 * DEG },
      hand_R:      { x: 6 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 32 * DEG, z: -14 * DEG },
      forearm_R:   { x: 46 * DEG },
      hand_R:      { z: -4 * DEG },
    },
  },
};

const ZWEIHANDER_BLOCKS: Record<number, Pose> = {
  [Direction.Left as number]: {
    upper_arm_R: { x: 52 * DEG, y: -16 * DEG, z: 42 * DEG },
    forearm_R:   { x: 50 * DEG },
    hand_R:      { z: -16 * DEG },
  },
  [Direction.Right as number]: {
    upper_arm_R: { x: 52 * DEG, y: 16 * DEG, z: -42 * DEG },
    forearm_R:   { x: 50 * DEG },
    hand_R:      { z: 16 * DEG },
  },
  [Direction.Overhead as number]: {
    upper_arm_R: { x: 100 * DEG, z: -10 * DEG },
    forearm_R:   { x: 22 * DEG },
    hand_R:      { x: -28 * DEG },
  },
  [Direction.Stab as number]: {
    upper_arm_R: { x: 58 * DEG, z: -16 * DEG },
    forearm_R:   { x: 65 * DEG },
    hand_R:      { x: 12 * DEG },
  },
};

const ZWEIHANDER_PARRY: Pose = {
  upper_arm_R: { x: 65 * DEG, z: -18 * DEG },
  forearm_R:   { x: 55 * DEG },
  hand_R:      { x: -8 * DEG, z: 6 * DEG },
};

const ZWEIHANDER_STUNNED: Pose = {
  upper_arm_R: { x: 20 * DEG, z: -12 * DEG },
  forearm_R:   { x: 22 * DEG },
  hand_R:      { z: 10 * DEG },
};

const ZWEIHANDER_HITSTUN: Pose = {
  upper_arm_R: { x: 32 * DEG, z: 8 * DEG },
  forearm_R:   { x: 20 * DEG },
  hand_R:      { z: -10 * DEG },
};

const ZWEIHANDER_ANIMS: ViewmodelWeaponAnims = {
  idle: ZWEIHANDER_IDLE,
  attacks: ZWEIHANDER_ATTACKS,
  blocks: ZWEIHANDER_BLOCKS,
  parry: ZWEIHANDER_PARRY,
  stunned: ZWEIHANDER_STUNNED,
  hitStun: ZWEIHANDER_HITSTUN,
};

// ── Warhammer — everything hangs off the top-heavy head. Compressed
// elbow in the chambers, wrist rolled to keep the head visible. ──

const WARHAMMER_IDLE: Pose = {
  upper_arm_R: { x: 42 * DEG, z: -12 * DEG },
  forearm_R:   { x: 64 * DEG },
  hand_R:      { x: 10 * DEG, z: -8 * DEG },
};

const WARHAMMER_ATTACKS: Record<number, CombatAnimation> = {
  [Direction.Left as number]: {
    // Head swung back past the shoulder — the elbow stays bent to
      // keep the mass close until the release.
    windup: {
      upper_arm_R: { x: 60 * DEG, y: -26 * DEG, z: 50 * DEG },
      forearm_R:   { x: 52 * DEG },
      hand_R:      { y: 12 * DEG, z: -16 * DEG },
    },
    release: {
      upper_arm_R: { x: 36 * DEG, y: 34 * DEG, z: -52 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { y: -10 * DEG, z: 18 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 26 * DEG, z: -12 * DEG },
      forearm_R:   { x: 52 * DEG },
      hand_R:      { x: 10 * DEG, z: -8 * DEG },
    },
  },
  [Direction.Right as number]: {
    // Mirror of Left.
    windup: {
      upper_arm_R: { x: 60 * DEG, y: 26 * DEG, z: -50 * DEG },
      forearm_R:   { x: 52 * DEG },
      hand_R:      { y: -12 * DEG, z: 16 * DEG },
    },
    release: {
      upper_arm_R: { x: 36 * DEG, y: -34 * DEG, z: 52 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { y: 10 * DEG, z: -18 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 26 * DEG, z: -12 * DEG },
      forearm_R:   { x: 52 * DEG },
      hand_R:      { x: 10 * DEG, z: -8 * DEG },
    },
  },
  [Direction.Overhead as number]: {
    // Hammer raised nearly vertical; the head loads the drop.
    windup: {
      upper_arm_R: { x: 115 * DEG, z: -12 * DEG },
      forearm_R:   { x: 40 * DEG },
      hand_R:      { x: -25 * DEG },
    },
    release: {
      upper_arm_R: { x: 52 * DEG, z: -6 * DEG },
      forearm_R:   { x: 55 * DEG },
      hand_R:      { x: 22 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 26 * DEG, z: -12 * DEG },
      forearm_R:   { x: 52 * DEG },
      hand_R:      { x: 10 * DEG, z: -8 * DEG },
    },
  },
  [Direction.Stab as number]: {
    // Butt-end jab — quick, mean, close range.
    windup: {
      upper_arm_R: { x: 20 * DEG, z: -10 * DEG },
      forearm_R:   { x: 95 * DEG },
      hand_R:      { x: -6 * DEG },
    },
    release: {
      upper_arm_R: { x: 62 * DEG, z: -6 * DEG },
      forearm_R:   { x: 22 * DEG },
      hand_R:      { x: 8 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 26 * DEG, z: -12 * DEG },
      forearm_R:   { x: 52 * DEG },
      hand_R:      { x: 10 * DEG, z: -8 * DEG },
    },
  },
};

const WARHAMMER_BLOCKS: Record<number, Pose> = {
  [Direction.Left as number]: {
    upper_arm_R: { x: 48 * DEG, y: -14 * DEG, z: 32 * DEG },
    forearm_R:   { x: 55 * DEG },
    hand_R:      { z: -12 * DEG },
  },
  [Direction.Right as number]: {
    upper_arm_R: { x: 48 * DEG, y: 14 * DEG, z: -32 * DEG },
    forearm_R:   { x: 55 * DEG },
    hand_R:      { z: 12 * DEG },
  },
  [Direction.Overhead as number]: {
    upper_arm_R: { x: 92 * DEG, z: -10 * DEG },
    forearm_R:   { x: 35 * DEG },
    hand_R:      { x: -20 * DEG },
  },
  [Direction.Stab as number]: {
    upper_arm_R: { x: 52 * DEG, z: -14 * DEG },
    forearm_R:   { x: 68 * DEG },
    hand_R:      { x: 10 * DEG },
  },
};

const WARHAMMER_PARRY: Pose = {
  upper_arm_R: { x: 58 * DEG, z: -14 * DEG },
  forearm_R:   { x: 60 * DEG },
  hand_R:      { x: -6 * DEG },
};

const WARHAMMER_STUNNED: Pose = {
  upper_arm_R: { x: 18 * DEG, z: -10 * DEG },
  forearm_R:   { x: 20 * DEG },
  hand_R:      { z: 12 * DEG },
};

const WARHAMMER_HITSTUN: Pose = {
  upper_arm_R: { x: 30 * DEG, z: 10 * DEG },
  forearm_R:   { x: 18 * DEG },
  hand_R:      { z: -12 * DEG },
};

const WARHAMMER_ANIMS: ViewmodelWeaponAnims = {
  idle: WARHAMMER_IDLE,
  attacks: WARHAMMER_ATTACKS,
  blocks: WARHAMMER_BLOCKS,
  parry: WARHAMMER_PARRY,
  stunned: WARHAMMER_STUNNED,
  hitStun: WARHAMMER_HITSTUN,
};

// ── Spear — couched and economical. The shaft rides the forearm; the
// thrust is the star, slashes are short corrective sweeps. ──

const SPEAR_IDLE: Pose = {
  upper_arm_R: { x: 35 * DEG, z: -6 * DEG },
  forearm_R:   { x: 76 * DEG },
  hand_R:      { z: -2 * DEG },
};

const SPEAR_ATTACKS: Record<number, CombatAnimation> = {
  [Direction.Left as number]: {
    // Short lateral sweep — a spear slash is a correction, not a cut.
    windup: {
      upper_arm_R: { x: 40 * DEG, y: -12 * DEG, z: 24 * DEG },
      forearm_R:   { x: 60 * DEG },
      hand_R:      { z: -8 * DEG },
    },
    release: {
      upper_arm_R: { x: 32 * DEG, y: 16 * DEG, z: -24 * DEG },
      forearm_R:   { x: 66 * DEG },
      hand_R:      { z: 8 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 24 * DEG, z: -6 * DEG },
      forearm_R:   { x: 64 * DEG },
      hand_R:      { z: -2 * DEG },
    },
  },
  [Direction.Right as number]: {
    // Mirror of Left.
    windup: {
      upper_arm_R: { x: 40 * DEG, y: 12 * DEG, z: -24 * DEG },
      forearm_R:   { x: 60 * DEG },
      hand_R:      { z: 8 * DEG },
    },
    release: {
      upper_arm_R: { x: 32 * DEG, y: -16 * DEG, z: 24 * DEG },
      forearm_R:   { x: 66 * DEG },
      hand_R:      { z: -8 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 24 * DEG, z: -6 * DEG },
      forearm_R:   { x: 64 * DEG },
      hand_R:      { z: -2 * DEG },
    },
  },
  [Direction.Overhead as number]: {
    // High shaft chop — more warning than weapon.
    windup: {
      upper_arm_R: { x: 85 * DEG, z: -6 * DEG },
      forearm_R:   { x: 45 * DEG },
      hand_R:      { x: -12 * DEG },
    },
    release: {
      upper_arm_R: { x: 48 * DEG, z: -4 * DEG },
      forearm_R:   { x: 58 * DEG },
      hand_R:      { x: 10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 24 * DEG, z: -6 * DEG },
      forearm_R:   { x: 64 * DEG },
      hand_R:      { z: -2 * DEG },
    },
  },
  [Direction.Stab as number]: {
    // Deep coil along the flank, then a piston extension.
    windup: {
      upper_arm_R: { x: 24 * DEG, z: -8 * DEG },
      forearm_R:   { x: 118 * DEG },
      hand_R:      { x: -6 * DEG },
    },
    release: {
      upper_arm_R: { x: 78 * DEG, z: -4 * DEG },
      forearm_R:   { x: 8 * DEG },
      hand_R:      { x: 4 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 24 * DEG, z: -6 * DEG },
      forearm_R:   { x: 64 * DEG },
      hand_R:      { z: -2 * DEG },
    },
  },
};

const SPEAR_BLOCKS: Record<number, Pose> = {
  [Direction.Left as number]: {
    upper_arm_R: { x: 50 * DEG, y: -10 * DEG, z: 26 * DEG },
    forearm_R:   { x: 62 * DEG },
    hand_R:      { z: -8 * DEG },
  },
  [Direction.Right as number]: {
    upper_arm_R: { x: 50 * DEG, y: 10 * DEG, z: -26 * DEG },
    forearm_R:   { x: 62 * DEG },
    hand_R:      { z: 8 * DEG },
  },
  [Direction.Overhead as number]: {
    upper_arm_R: { x: 88 * DEG, z: -6 * DEG },
    forearm_R:   { x: 40 * DEG },
    hand_R:      { x: -16 * DEG },
  },
  [Direction.Stab as number]: {
    upper_arm_R: { x: 50 * DEG, z: -10 * DEG },
    forearm_R:   { x: 72 * DEG },
    hand_R:      { x: 8 * DEG },
  },
};

const SPEAR_PARRY: Pose = {
  upper_arm_R: { x: 55 * DEG, z: -10 * DEG },
  forearm_R:   { x: 62 * DEG },
  hand_R:      { x: -4 * DEG, z: 4 * DEG },
};

const SPEAR_STUNNED: Pose = {
  upper_arm_R: { x: 20 * DEG, z: -6 * DEG },
  forearm_R:   { x: 30 * DEG },
  hand_R:      { z: 6 * DEG },
};

const SPEAR_HITSTUN: Pose = {
  upper_arm_R: { x: 28 * DEG, z: 6 * DEG },
  forearm_R:   { x: 26 * DEG },
  hand_R:      { z: -8 * DEG },
};

const SPEAR_ANIMS: ViewmodelWeaponAnims = {
  idle: SPEAR_IDLE,
  attacks: SPEAR_ATTACKS,
  blocks: SPEAR_BLOCKS,
  parry: SPEAR_PARRY,
  stunned: SPEAR_STUNNED,
  hitStun: SPEAR_HITSTUN,
};

// ── Katana — high kendo guard, tight fast chambers, crisp cuts.
// The blade lives near the head; nothing sweeps wider than it must. ──

const KATANA_IDLE: Pose = {
  upper_arm_R: { x: 62 * DEG, z: -4 * DEG },
  forearm_R:   { x: 44 * DEG },
  hand_R:      { x: -6 * DEG, z: -2 * DEG },
};

const KATANA_ATTACKS: Record<number, CombatAnimation> = {
  [Direction.Left as number]: {
    // Compact chamber off the high guard — speed over spectacle.
    windup: {
      upper_arm_R: { x: 66 * DEG, y: -16 * DEG, z: 36 * DEG },
      forearm_R:   { x: 28 * DEG },
      hand_R:      { z: -8 * DEG },
    },
    release: {
      upper_arm_R: { x: 44 * DEG, y: 24 * DEG, z: -38 * DEG },
      forearm_R:   { x: 38 * DEG },
      hand_R:      { z: 10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 44 * DEG, z: -4 * DEG },
      forearm_R:   { x: 38 * DEG },
      hand_R:      { x: -6 * DEG, z: -2 * DEG },
    },
  },
  [Direction.Right as number]: {
    // Mirror of Left.
    windup: {
      upper_arm_R: { x: 66 * DEG, y: 16 * DEG, z: -36 * DEG },
      forearm_R:   { x: 28 * DEG },
      hand_R:      { z: 8 * DEG },
    },
    release: {
      upper_arm_R: { x: 44 * DEG, y: -24 * DEG, z: 38 * DEG },
      forearm_R:   { x: 38 * DEG },
      hand_R:      { z: -10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 44 * DEG, z: -4 * DEG },
      forearm_R:   { x: 38 * DEG },
      hand_R:      { x: -6 * DEG, z: -2 * DEG },
    },
  },
  [Direction.Overhead as number]: {
    // Classic men cut: raised straight over the centerline.
    windup: {
      upper_arm_R: { x: 105 * DEG, z: -4 * DEG },
      forearm_R:   { x: 20 * DEG },
      hand_R:      { x: -18 * DEG },
    },
    release: {
      upper_arm_R: { x: 58 * DEG, z: -2 * DEG },
      forearm_R:   { x: 55 * DEG },
      hand_R:      { x: 12 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 44 * DEG, z: -4 * DEG },
      forearm_R:   { x: 38 * DEG },
      hand_R:      { x: -6 * DEG, z: -2 * DEG },
    },
  },
  [Direction.Stab as number]: {
    // Tsuki: blade drawn to the ribs, then the point goes.
    windup: {
      upper_arm_R: { x: 30 * DEG, z: -6 * DEG },
      forearm_R:   { x: 96 * DEG },
      hand_R:      { x: -4 * DEG },
    },
    release: {
      upper_arm_R: { x: 74 * DEG, z: -2 * DEG },
      forearm_R:   { x: 12 * DEG },
      hand_R:      { x: 4 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 44 * DEG, z: -4 * DEG },
      forearm_R:   { x: 38 * DEG },
      hand_R:      { x: -6 * DEG, z: -2 * DEG },
    },
  },
};

const KATANA_BLOCKS: Record<number, Pose> = {
  [Direction.Left as number]: {
    upper_arm_R: { x: 56 * DEG, y: -12 * DEG, z: 28 * DEG },
    forearm_R:   { x: 40 * DEG },
    hand_R:      { z: -10 * DEG },
  },
  [Direction.Right as number]: {
    upper_arm_R: { x: 56 * DEG, y: 12 * DEG, z: -28 * DEG },
    forearm_R:   { x: 40 * DEG },
    hand_R:      { z: 10 * DEG },
  },
  [Direction.Overhead as number]: {
    upper_arm_R: { x: 96 * DEG, z: -4 * DEG },
    forearm_R:   { x: 20 * DEG },
    hand_R:      { x: -22 * DEG },
  },
  [Direction.Stab as number]: {
    upper_arm_R: { x: 56 * DEG, z: -8 * DEG },
    forearm_R:   { x: 58 * DEG },
    hand_R:      { x: 8 * DEG },
  },
};

const KATANA_PARRY: Pose = {
  upper_arm_R: { x: 64 * DEG, z: -10 * DEG },
  forearm_R:   { x: 46 * DEG },
  hand_R:      { x: -6 * DEG, z: 4 * DEG },
};

const KATANA_STUNNED: Pose = {
  upper_arm_R: { x: 24 * DEG, z: -6 * DEG },
  forearm_R:   { x: 24 * DEG },
  hand_R:      { z: 6 * DEG },
};

const KATANA_HITSTUN: Pose = {
  upper_arm_R: { x: 34 * DEG, z: 4 * DEG },
  forearm_R:   { x: 22 * DEG },
  hand_R:      { z: -8 * DEG },
};

const KATANA_ANIMS: ViewmodelWeaponAnims = {
  idle: KATANA_IDLE,
  attacks: KATANA_ATTACKS,
  blocks: KATANA_BLOCKS,
  parry: KATANA_PARRY,
  stunned: KATANA_STUNNED,
  hitStun: KATANA_HITSTUN,
};

// ── Scythe — hooking horizontal drama. The widest z-tilts in the
// arsenal; even the idle drags the blade low and outside. ──

const SCYTHE_IDLE: Pose = {
  upper_arm_R: { x: 40 * DEG, z: -16 * DEG },
  forearm_R:   { x: 54 * DEG },
  hand_R:      { x: 10 * DEG, z: -10 * DEG },
};

const SCYTHE_ATTACKS: Record<number, CombatAnimation> = {
  [Direction.Left as number]: {
    // Blade hooked far outside — the reap starts behind the frame.
    windup: {
      upper_arm_R: { x: 46 * DEG, y: -34 * DEG, z: 60 * DEG },
      forearm_R:   { x: 24 * DEG },
      hand_R:      { z: -20 * DEG },
    },
    release: {
      upper_arm_R: { x: 34 * DEG, y: 40 * DEG, z: -62 * DEG },
      forearm_R:   { x: 40 * DEG },
      hand_R:      { z: 22 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 26 * DEG, z: -16 * DEG },
      forearm_R:   { x: 44 * DEG },
      hand_R:      { x: 10 * DEG, z: -10 * DEG },
    },
  },
  [Direction.Right as number]: {
    // Mirror of Left.
    windup: {
      upper_arm_R: { x: 46 * DEG, y: 34 * DEG, z: -60 * DEG },
      forearm_R:   { x: 24 * DEG },
      hand_R:      { z: 20 * DEG },
    },
    release: {
      upper_arm_R: { x: 34 * DEG, y: -40 * DEG, z: 62 * DEG },
      forearm_R:   { x: 40 * DEG },
      hand_R:      { z: -22 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 26 * DEG, z: -16 * DEG },
      forearm_R:   { x: 44 * DEG },
      hand_R:      { x: 10 * DEG, z: -10 * DEG },
    },
  },
  [Direction.Overhead as number]: {
    // Hooking pull-down: the point comes over the top like a claw.
    windup: {
      upper_arm_R: { x: 100 * DEG, z: -18 * DEG },
      forearm_R:   { x: 22 * DEG },
      hand_R:      { x: -22 * DEG },
    },
    release: {
      upper_arm_R: { x: 50 * DEG, z: -8 * DEG },
      forearm_R:   { x: 52 * DEG },
      hand_R:      { x: 18 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 26 * DEG, z: -16 * DEG },
      forearm_R:   { x: 44 * DEG },
      hand_R:      { x: 10 * DEG, z: -10 * DEG },
    },
  },
  [Direction.Stab as number]: {
    // Handle-end jab; the scythe has no honest thrust.
    windup: {
      upper_arm_R: { x: 22 * DEG, z: -10 * DEG },
      forearm_R:   { x: 88 * DEG },
      hand_R:      { x: -4 * DEG },
    },
    release: {
      upper_arm_R: { x: 60 * DEG, z: -6 * DEG },
      forearm_R:   { x: 24 * DEG },
      hand_R:      { x: 6 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 26 * DEG, z: -16 * DEG },
      forearm_R:   { x: 44 * DEG },
      hand_R:      { x: 10 * DEG, z: -10 * DEG },
    },
  },
};

const SCYTHE_BLOCKS: Record<number, Pose> = {
  [Direction.Left as number]: {
    upper_arm_R: { x: 46 * DEG, y: -18 * DEG, z: 40 * DEG },
    forearm_R:   { x: 48 * DEG },
    hand_R:      { z: -14 * DEG },
  },
  [Direction.Right as number]: {
    upper_arm_R: { x: 46 * DEG, y: 18 * DEG, z: -40 * DEG },
    forearm_R:   { x: 48 * DEG },
    hand_R:      { z: 14 * DEG },
  },
  [Direction.Overhead as number]: {
    upper_arm_R: { x: 90 * DEG, z: -14 * DEG },
    forearm_R:   { x: 26 * DEG },
    hand_R:      { x: -20 * DEG },
  },
  [Direction.Stab as number]: {
    upper_arm_R: { x: 50 * DEG, z: -14 * DEG },
    forearm_R:   { x: 62 * DEG },
    hand_R:      { x: 10 * DEG },
  },
};

const SCYTHE_PARRY: Pose = {
  upper_arm_R: { x: 56 * DEG, z: -20 * DEG },
  forearm_R:   { x: 50 * DEG },
  hand_R:      { x: -6 * DEG, z: 8 * DEG },
};

const SCYTHE_STUNNED: Pose = {
  upper_arm_R: { x: 18 * DEG, z: -14 * DEG },
  forearm_R:   { x: 22 * DEG },
  hand_R:      { z: 10 * DEG },
};

const SCYTHE_HITSTUN: Pose = {
  upper_arm_R: { x: 30 * DEG, z: 8 * DEG },
  forearm_R:   { x: 20 * DEG },
  hand_R:      { z: -10 * DEG },
};

const SCYTHE_ANIMS: ViewmodelWeaponAnims = {
  idle: SCYTHE_IDLE,
  attacks: SCYTHE_ATTACKS,
  blocks: SCYTHE_BLOCKS,
  parry: SCYTHE_PARRY,
  stunned: SCYTHE_STUNNED,
  hitStun: SCYTHE_HITSTUN,
};

// ── Yeeter — maximum theater. Every chamber overshoots, every wrist
// angle is 20% too much. Premium physics deserve premium drama. ──

const YEETER_IDLE: Pose = {
  upper_arm_R: { x: 55 * DEG, z: -10 * DEG },
  forearm_R:   { x: 60 * DEG },
  hand_R:      { x: 12 * DEG, z: -12 * DEG },
};

const YEETER_ATTACKS: Record<number, CombatAnimation> = {
  [Direction.Left as number]: {
    // Wound up past the shoulder blade. Physics will forgive us.
    windup: {
      upper_arm_R: { x: 70 * DEG, y: -40 * DEG, z: 62 * DEG },
      forearm_R:   { x: 18 * DEG },
      hand_R:      { y: 14 * DEG, z: -24 * DEG },
    },
    release: {
      upper_arm_R: { x: 30 * DEG, y: 44 * DEG, z: -62 * DEG },
      forearm_R:   { x: 44 * DEG },
      hand_R:      { y: -12 * DEG, z: 24 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 36 * DEG, z: -10 * DEG },
      forearm_R:   { x: 48 * DEG },
      hand_R:      { x: 12 * DEG, z: -12 * DEG },
    },
  },
  [Direction.Right as number]: {
    // Mirror of Left.
    windup: {
      upper_arm_R: { x: 70 * DEG, y: 40 * DEG, z: -62 * DEG },
      forearm_R:   { x: 18 * DEG },
      hand_R:      { y: -14 * DEG, z: 24 * DEG },
    },
    release: {
      upper_arm_R: { x: 30 * DEG, y: -44 * DEG, z: 62 * DEG },
      forearm_R:   { x: 44 * DEG },
      hand_R:      { y: 12 * DEG, z: -24 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 36 * DEG, z: -10 * DEG },
      forearm_R:   { x: 48 * DEG },
      hand_R:      { x: 12 * DEG, z: -12 * DEG },
    },
  },
  [Direction.Overhead as number]: {
    // The full ceiling-scraper. Hold for applause.
    windup: {
      upper_arm_R: { x: 120 * DEG, z: -14 * DEG },
      forearm_R:   { x: 15 * DEG },
      hand_R:      { x: -30 * DEG },
    },
    release: {
      upper_arm_R: { x: 45 * DEG, z: -6 * DEG },
      forearm_R:   { x: 62 * DEG },
      hand_R:      { x: 24 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 36 * DEG, z: -10 * DEG },
      forearm_R:   { x: 48 * DEG },
      hand_R:      { x: 12 * DEG, z: -12 * DEG },
    },
  },
  [Direction.Stab as number]: {
    // Coiled like a mousetrap; releases like one too.
    windup: {
      upper_arm_R: { x: 18 * DEG, z: -10 * DEG },
      forearm_R:   { x: 112 * DEG },
      hand_R:      { x: -10 * DEG },
    },
    release: {
      upper_arm_R: { x: 80 * DEG, z: -4 * DEG },
      forearm_R:   { x: 10 * DEG },
      hand_R:      { x: 8 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 36 * DEG, z: -10 * DEG },
      forearm_R:   { x: 48 * DEG },
      hand_R:      { x: 12 * DEG, z: -12 * DEG },
    },
  },
};

const YEETER_BLOCKS: Record<number, Pose> = {
  [Direction.Left as number]: {
    upper_arm_R: { x: 50 * DEG, y: -20 * DEG, z: 44 * DEG },
    forearm_R:   { x: 44 * DEG },
    hand_R:      { z: -18 * DEG },
  },
  [Direction.Right as number]: {
    upper_arm_R: { x: 50 * DEG, y: 20 * DEG, z: -44 * DEG },
    forearm_R:   { x: 44 * DEG },
    hand_R:      { z: 18 * DEG },
  },
  [Direction.Overhead as number]: {
    upper_arm_R: { x: 100 * DEG, z: -10 * DEG },
    forearm_R:   { x: 20 * DEG },
    hand_R:      { x: -26 * DEG },
  },
  [Direction.Stab as number]: {
    upper_arm_R: { x: 55 * DEG, z: -14 * DEG },
    forearm_R:   { x: 66 * DEG },
    hand_R:      { x: 12 * DEG },
  },
};

const YEETER_PARRY: Pose = {
  upper_arm_R: { x: 66 * DEG, z: -16 * DEG },
  forearm_R:   { x: 52 * DEG },
  hand_R:      { x: -10 * DEG, z: 8 * DEG },
};

const YEETER_STUNNED: Pose = {
  upper_arm_R: { x: 15 * DEG, z: -12 * DEG },
  forearm_R:   { x: 18 * DEG },
  hand_R:      { z: 14 * DEG },
};

const YEETER_HITSTUN: Pose = {
  upper_arm_R: { x: 36 * DEG, z: 10 * DEG },
  forearm_R:   { x: 16 * DEG },
  hand_R:      { z: -14 * DEG },
};

const YEETER_ANIMS: ViewmodelWeaponAnims = {
  idle: YEETER_IDLE,
  attacks: YEETER_ATTACKS,
  blocks: YEETER_BLOCKS,
  parry: YEETER_PARRY,
  stunned: YEETER_STUNNED,
  hitStun: YEETER_HITSTUN,
};

// ── Rapier — fencing lunge master (new, 2026-07). Point-forward low
// guard, slashes are wrist flicks, and the stab coils deep then
// extends to a full needle-straight lunge. ──

const RAPIER_IDLE: Pose = {
  upper_arm_R: { x: 50 * DEG, z: -2 * DEG },
  forearm_R:   { x: 70 * DEG },
  hand_R:      { x: -4 * DEG },
};

const RAPIER_ATTACKS: Record<number, CombatAnimation> = {
  [Direction.Left as number]: {
    // A flick, not a swing — the point barely leaves centerline.
    windup: {
      upper_arm_R: { x: 52 * DEG, y: -10 * DEG, z: 18 * DEG },
      forearm_R:   { x: 62 * DEG },
      hand_R:      { z: -6 * DEG },
    },
    release: {
      upper_arm_R: { x: 46 * DEG, y: 12 * DEG, z: -20 * DEG },
      forearm_R:   { x: 64 * DEG },
      hand_R:      { z: 6 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 42 * DEG, z: -2 * DEG },
      forearm_R:   { x: 62 * DEG },
      hand_R:      { x: -4 * DEG },
    },
  },
  [Direction.Right as number]: {
    // Mirror of Left.
    windup: {
      upper_arm_R: { x: 52 * DEG, y: 10 * DEG, z: -18 * DEG },
      forearm_R:   { x: 62 * DEG },
      hand_R:      { z: 6 * DEG },
    },
    release: {
      upper_arm_R: { x: 46 * DEG, y: -12 * DEG, z: 20 * DEG },
      forearm_R:   { x: 64 * DEG },
      hand_R:      { z: -6 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 42 * DEG, z: -2 * DEG },
      forearm_R:   { x: 62 * DEG },
      hand_R:      { x: -4 * DEG },
    },
  },
  [Direction.Overhead as number]: {
    // A cut from the wrist; the rapier has no real chop.
    windup: {
      upper_arm_R: { x: 88 * DEG, z: -2 * DEG },
      forearm_R:   { x: 40 * DEG },
      hand_R:      { x: -10 * DEG },
    },
    release: {
      upper_arm_R: { x: 54 * DEG, z: -2 * DEG },
      forearm_R:   { x: 58 * DEG },
      hand_R:      { x: 8 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 42 * DEG, z: -2 * DEG },
      forearm_R:   { x: 62 * DEG },
      hand_R:      { x: -4 * DEG },
    },
  },
  [Direction.Stab as number]: {
    // The lunge: deepest coil in the arsenal, straightest extension.
    windup: {
      upper_arm_R: { x: 26 * DEG, z: -4 * DEG },
      forearm_R:   { x: 122 * DEG },
      hand_R:      { x: -4 * DEG },
    },
    release: {
      upper_arm_R: { x: 82 * DEG, z: -2 * DEG },
      forearm_R:   { x: 4 * DEG },
      hand_R:      { x: 2 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 42 * DEG, z: -2 * DEG },
      forearm_R:   { x: 62 * DEG },
      hand_R:      { x: -4 * DEG },
    },
  },
};

const RAPIER_BLOCKS: Record<number, Pose> = {
  [Direction.Left as number]: {
    upper_arm_R: { x: 54 * DEG, y: -8 * DEG, z: 20 * DEG },
    forearm_R:   { x: 58 * DEG },
    hand_R:      { z: -6 * DEG },
  },
  [Direction.Right as number]: {
    upper_arm_R: { x: 54 * DEG, y: 8 * DEG, z: -20 * DEG },
    forearm_R:   { x: 58 * DEG },
    hand_R:      { z: 6 * DEG },
  },
  [Direction.Overhead as number]: {
    upper_arm_R: { x: 90 * DEG, z: -2 * DEG },
    forearm_R:   { x: 30 * DEG },
    hand_R:      { x: -14 * DEG },
  },
  [Direction.Stab as number]: {
    upper_arm_R: { x: 56 * DEG, z: -6 * DEG },
    forearm_R:   { x: 66 * DEG },
    hand_R:      { x: 6 * DEG },
  },
};

const RAPIER_PARRY: Pose = {
  upper_arm_R: { x: 70 * DEG, z: -8 * DEG },
  forearm_R:   { x: 52 * DEG },
  hand_R:      { x: -10 * DEG, z: 6 * DEG },
};

const RAPIER_STUNNED: Pose = {
  upper_arm_R: { x: 22 * DEG, z: -4 * DEG },
  forearm_R:   { x: 32 * DEG },
  hand_R:      { z: 4 * DEG },
};

const RAPIER_HITSTUN: Pose = {
  upper_arm_R: { x: 30 * DEG, z: 4 * DEG },
  forearm_R:   { x: 28 * DEG },
  hand_R:      { z: -6 * DEG },
};

const RAPIER_ANIMS: ViewmodelWeaponAnims = {
  idle: RAPIER_IDLE,
  attacks: RAPIER_ATTACKS,
  blocks: RAPIER_BLOCKS,
  parry: RAPIER_PARRY,
  stunned: RAPIER_STUNNED,
  hitStun: RAPIER_HITSTUN,
};

// ── Halberd — two-handed polearm carry (new, 2026-07). High grip,
// commanding overhead chop, quick spike thrust off the top. ──

const HALBERD_IDLE: Pose = {
  upper_arm_R: { x: 48 * DEG, z: -12 * DEG },
  forearm_R:   { x: 62 * DEG },
  hand_R:      { x: 4 * DEG, z: -6 * DEG },
};

const HALBERD_ATTACKS: Record<number, CombatAnimation> = {
  [Direction.Left as number]: {
    // Shaft swung across the body; the axe head leads the arc.
    windup: {
      upper_arm_R: { x: 54 * DEG, y: -22 * DEG, z: 44 * DEG },
      forearm_R:   { x: 40 * DEG },
      hand_R:      { z: -14 * DEG },
    },
    release: {
      upper_arm_R: { x: 36 * DEG, y: 28 * DEG, z: -46 * DEG },
      forearm_R:   { x: 48 * DEG },
      hand_R:      { z: 16 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 30 * DEG, z: -12 * DEG },
      forearm_R:   { x: 50 * DEG },
      hand_R:      { x: 4 * DEG, z: -6 * DEG },
    },
  },
  [Direction.Right as number]: {
    // Mirror of Left.
    windup: {
      upper_arm_R: { x: 54 * DEG, y: 22 * DEG, z: -44 * DEG },
      forearm_R:   { x: 40 * DEG },
      hand_R:      { z: 14 * DEG },
    },
    release: {
      upper_arm_R: { x: 36 * DEG, y: -28 * DEG, z: 46 * DEG },
      forearm_R:   { x: 48 * DEG },
      hand_R:      { z: -16 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 30 * DEG, z: -12 * DEG },
      forearm_R:   { x: 50 * DEG },
      hand_R:      { x: 4 * DEG, z: -6 * DEG },
    },
  },
  [Direction.Overhead as number]: {
    // The headsman's silhouette — shaft near vertical.
    windup: {
      upper_arm_R: { x: 112 * DEG, z: -12 * DEG },
      forearm_R:   { x: 30 * DEG },
      hand_R:      { x: -24 * DEG },
    },
    release: {
      upper_arm_R: { x: 50 * DEG, z: -6 * DEG },
      forearm_R:   { x: 58 * DEG },
      hand_R:      { x: 18 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 30 * DEG, z: -12 * DEG },
      forearm_R:   { x: 50 * DEG },
      hand_R:      { x: 4 * DEG, z: -6 * DEG },
    },
  },
  [Direction.Stab as number]: {
    // Spike thrust: hands slide, the point drives off the top.
    windup: {
      upper_arm_R: { x: 24 * DEG, z: -8 * DEG },
      forearm_R:   { x: 108 * DEG },
      hand_R:      { x: -6 * DEG },
    },
    release: {
      upper_arm_R: { x: 76 * DEG, z: -4 * DEG },
      forearm_R:   { x: 10 * DEG },
      hand_R:      { x: 4 * DEG },
    },
    recovery: {
      upper_arm_R: { x: 30 * DEG, z: -12 * DEG },
      forearm_R:   { x: 50 * DEG },
      hand_R:      { x: 4 * DEG, z: -6 * DEG },
    },
  },
};

const HALBERD_BLOCKS: Record<number, Pose> = {
  [Direction.Left as number]: {
    upper_arm_R: { x: 48 * DEG, y: -14 * DEG, z: 30 * DEG },
    forearm_R:   { x: 58 * DEG },
    hand_R:      { z: -10 * DEG },
  },
  [Direction.Right as number]: {
    upper_arm_R: { x: 48 * DEG, y: 14 * DEG, z: -30 * DEG },
    forearm_R:   { x: 58 * DEG },
    hand_R:      { z: 10 * DEG },
  },
  [Direction.Overhead as number]: {
    upper_arm_R: { x: 94 * DEG, z: -8 * DEG },
    forearm_R:   { x: 32 * DEG },
    hand_R:      { x: -18 * DEG },
  },
  [Direction.Stab as number]: {
    upper_arm_R: { x: 52 * DEG, z: -12 * DEG },
    forearm_R:   { x: 70 * DEG },
    hand_R:      { x: 8 * DEG },
  },
};

const HALBERD_PARRY: Pose = {
  upper_arm_R: { x: 60 * DEG, z: -14 * DEG },
  forearm_R:   { x: 56 * DEG },
  hand_R:      { x: -6 * DEG, z: 6 * DEG },
};

const HALBERD_STUNNED: Pose = {
  upper_arm_R: { x: 18 * DEG, z: -10 * DEG },
  forearm_R:   { x: 26 * DEG },
  hand_R:      { z: 8 * DEG },
};

const HALBERD_HITSTUN: Pose = {
  upper_arm_R: { x: 30 * DEG, z: 8 * DEG },
  forearm_R:   { x: 22 * DEG },
  hand_R:      { z: -10 * DEG },
};

const HALBERD_ANIMS: ViewmodelWeaponAnims = {
  idle: HALBERD_IDLE,
  attacks: HALBERD_ATTACKS,
  blocks: HALBERD_BLOCKS,
  parry: HALBERD_PARRY,
  stunned: HALBERD_STUNNED,
  hitStun: HALBERD_HITSTUN,
};

// ── Registry ────────────────────────────────────────────

/** Weapon name → viewmodel animation data */
export const VIEWMODEL_ANIMS: Record<string, ViewmodelWeaponAnims> = {
  Longsword: LONGSWORD_ANIMS,
  Mace: MACE_ANIMS,
  Dagger: DAGGER_ANIMS,
  Battleaxe: BATTLEAXE_ANIMS,
  // 2026-07 arsenal + rapier/halberd: unique sets (previously these fell
  // back to the Longsword poses, which is why every weapon FELT the same
  // in first person — #goal-2026-07 "weapons with unique animations").
  Zweihander: ZWEIHANDER_ANIMS,
  Warhammer: WARHAMMER_ANIMS,
  Spear: SPEAR_ANIMS,
  Katana: KATANA_ANIMS,
  Scythe: SCYTHE_ANIMS,
  Yeeter: YEETER_ANIMS,
  Rapier: RAPIER_ANIMS,
  Halberd: HALBERD_ANIMS,
};

/** Allowed bone names in viewmodel poses */
const VIEWMODEL_BONES = new Set(['upper_arm_R', 'forearm_R', 'hand_R']);

// ── Lookup Function ─────────────────────────────────────

/**
 * Get the viewmodel pose for a weapon in a given combat state and direction.
 * Falls back to Longsword poses for unknown weapon names.
 *
 * Mirrors the signature of getCombatPose from AnimationData.ts but adds
 * a weaponName parameter for per-weapon differentiation.
 */
export function getViewmodelPose(
  weaponName: string,
  state: CombatState,
  direction: number,
): Pose {
  const anims = VIEWMODEL_ANIMS[weaponName] ?? VIEWMODEL_ANIMS['Longsword'];

  switch (state) {
    case CombatState.Idle:
      return anims.idle;

    case CombatState.Windup:
      return anims.attacks[direction as number]?.windup ?? anims.idle;

    case CombatState.Release:
      return anims.attacks[direction as number]?.release ?? anims.idle;

    case CombatState.Recovery:
      return anims.attacks[direction as number]?.recovery ?? anims.idle;

    case CombatState.Blocking:
      return anims.blocks[direction as number] ?? anims.idle;

    // FSM v2 (#135): `Parry` is the brief locked pose after a successful
    // parry. `Riposte`, `Feint`, `Clash`, `Stunned` were dropped from the
    // state set; their animation cases come out with them.
    case CombatState.Parry:
      return anims.parry;

    case CombatState.HitStun:
      return anims.hitStun;

    default:
      return anims.idle;
  }
}
