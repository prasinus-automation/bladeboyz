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
  upper_arm_R: { x: 30 * DEG, z: -8 * DEG },
  forearm_R:   { x: 35 * DEG },
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
  upper_arm_R: { x: 28 * DEG, z: -10 * DEG },
  forearm_R:   { x: 30 * DEG },
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
  upper_arm_R: { x: 22 * DEG, z: -5 * DEG },
  forearm_R:   { x: 45 * DEG },
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
  upper_arm_R: { x: 32 * DEG, z: -12 * DEG },
  forearm_R:   { x: 25 * DEG },
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

// ── Registry ────────────────────────────────────────────

/** Weapon name → viewmodel animation data */
export const VIEWMODEL_ANIMS: Record<string, ViewmodelWeaponAnims> = {
  Longsword: LONGSWORD_ANIMS,
  Mace: MACE_ANIMS,
  Dagger: DAGGER_ANIMS,
  Battleaxe: BATTLEAXE_ANIMS,
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
