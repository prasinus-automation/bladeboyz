/**
 * Per-weapon first-person viewmodel animation data.
 *
 * First-person poses are tuned separately from third-person (AnimationData.ts)
 * because the camera IS the character's eyes — swings need to be exaggerated
 * to feel impactful, and must stay within viewport bounds.
 *
 * Only right arm bones matter: upper_arm_R, forearm_R, hand_R.
 * The viewmodel has no torso, left arm, or legs.
 */

import { CombatState } from '../combat/states';
import { AttackDirection, BlockDirection } from '../combat/directions';
import type { Pose, BoneRotation, CombatAnimation } from './AnimationData';

// ── Types ────────────────────────────────────────────────

/** Per-weapon viewmodel pose set */
export interface ViewmodelWeaponAnims {
  idle: Pose;
  attacks: Record<number, CombatAnimation>;   // 5 AttackDirection × 3 phases
  blocks: Record<number, Pose>;               // 4 BlockDirection
  parry: Pose;
  stunned: Pose;
  hitStun: Pose;
}

// ── Helper ──────────────────────────────────────────────

const DEG = Math.PI / 180;

// ── Longsword — wide sweeping arcs, classic medieval FPS feel ──

const LONGSWORD_IDLE: Pose = {
  upper_arm_R: { x: -30 * DEG, z: -8 * DEG },
  forearm_R:   { x: -35 * DEG },
  hand_R:      { x: -5 * DEG, z: -5 * DEG },
};

const LONGSWORD_ATTACKS: Record<number, CombatAnimation> = {
  [AttackDirection.Left as number]: {
    windup: {
      upper_arm_R: { x: -50 * DEG, z: -50 * DEG, y: 30 * DEG },
      forearm_R:   { x: -20 * DEG },
      hand_R:      { z: 10 * DEG },
    },
    release: {
      upper_arm_R: { x: -40 * DEG, z: 50 * DEG, y: -40 * DEG },
      forearm_R:   { x: -10 * DEG },
      hand_R:      { z: -15 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -30 * DEG, z: -8 * DEG },
      forearm_R:   { x: -35 * DEG },
      hand_R:      { x: -5 * DEG, z: -5 * DEG },
    },
  },
  [AttackDirection.Right as number]: {
    windup: {
      upper_arm_R: { x: -50 * DEG, z: 50 * DEG, y: -30 * DEG },
      forearm_R:   { x: -20 * DEG },
      hand_R:      { z: -10 * DEG },
    },
    release: {
      upper_arm_R: { x: -40 * DEG, z: -50 * DEG, y: 40 * DEG },
      forearm_R:   { x: -10 * DEG },
      hand_R:      { z: 15 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -30 * DEG, z: -8 * DEG },
      forearm_R:   { x: -35 * DEG },
      hand_R:      { x: -5 * DEG, z: -5 * DEG },
    },
  },
  [AttackDirection.Overhead as number]: {
    windup: {
      upper_arm_R: { x: -110 * DEG, z: -10 * DEG },
      forearm_R:   { x: -40 * DEG },
      hand_R:      { x: -10 * DEG },
    },
    release: {
      upper_arm_R: { x: -20 * DEG, z: -5 * DEG },
      forearm_R:   { x: -50 * DEG },
      hand_R:      { x: 5 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -30 * DEG, z: -8 * DEG },
      forearm_R:   { x: -35 * DEG },
      hand_R:      { x: -5 * DEG, z: -5 * DEG },
    },
  },
  [AttackDirection.Underhand as number]: {
    windup: {
      upper_arm_R: { x: 15 * DEG, z: -20 * DEG },
      forearm_R:   { x: -10 * DEG },
      hand_R:      { x: 10 * DEG },
    },
    release: {
      upper_arm_R: { x: -90 * DEG, z: -10 * DEG },
      forearm_R:   { x: -20 * DEG },
      hand_R:      { x: -5 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -30 * DEG, z: -8 * DEG },
      forearm_R:   { x: -35 * DEG },
      hand_R:      { x: -5 * DEG, z: -5 * DEG },
    },
  },
  [AttackDirection.Stab as number]: {
    windup: {
      upper_arm_R: { x: -50 * DEG, z: -10 * DEG },
      forearm_R:   { x: -80 * DEG },
      hand_R:      { x: -5 * DEG },
    },
    release: {
      upper_arm_R: { x: -60 * DEG, z: -3 * DEG },
      forearm_R:   { x: -5 * DEG },
      hand_R:      { x: 3 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -30 * DEG, z: -8 * DEG },
      forearm_R:   { x: -35 * DEG },
      hand_R:      { x: -5 * DEG, z: -5 * DEG },
    },
  },
};

const LONGSWORD_BLOCKS: Record<number, Pose> = {
  [BlockDirection.Left as number]: {
    upper_arm_R: { x: -50 * DEG, z: 35 * DEG, y: -20 * DEG },
    forearm_R:   { x: -45 * DEG },
    hand_R:      { z: 15 * DEG },
  },
  [BlockDirection.Right as number]: {
    upper_arm_R: { x: -50 * DEG, z: -40 * DEG, y: 20 * DEG },
    forearm_R:   { x: -45 * DEG },
    hand_R:      { z: -15 * DEG },
  },
  [BlockDirection.Top as number]: {
    upper_arm_R: { x: -100 * DEG, z: -8 * DEG },
    forearm_R:   { x: -25 * DEG },
    hand_R:      { x: -5 * DEG },
  },
  [BlockDirection.Bottom as number]: {
    upper_arm_R: { x: 5 * DEG, z: -15 * DEG },
    forearm_R:   { x: -20 * DEG },
    hand_R:      { x: 5 * DEG },
  },
};

const LONGSWORD_PARRY: Pose = {
  upper_arm_R: { x: -60 * DEG, z: -15 * DEG },
  forearm_R:   { x: -40 * DEG },
  hand_R:      { x: -5 * DEG, z: 5 * DEG },
};

const LONGSWORD_STUNNED: Pose = {
  upper_arm_R: { x: 10 * DEG, z: -10 * DEG },
  forearm_R:   { x: -10 * DEG },
  hand_R:      { z: 8 * DEG },
};

const LONGSWORD_HITSTUN: Pose = {
  upper_arm_R: { x: 5 * DEG },
  forearm_R:   { x: -15 * DEG },
  hand_R:      { z: -5 * DEG },
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
  upper_arm_R: { x: -28 * DEG, z: -10 * DEG },
  forearm_R:   { x: -30 * DEG },
  hand_R:      { x: -5 * DEG, z: -8 * DEG, y: 5 * DEG },
};

const MACE_ATTACKS: Record<number, CombatAnimation> = {
  [AttackDirection.Left as number]: {
    windup: {
      upper_arm_R: { x: -55 * DEG, z: -55 * DEG, y: 35 * DEG },
      forearm_R:   { x: -25 * DEG },
      hand_R:      { z: 20 * DEG, y: 10 * DEG },
    },
    release: {
      upper_arm_R: { x: -35 * DEG, z: 55 * DEG, y: -45 * DEG },
      forearm_R:   { x: -8 * DEG },
      hand_R:      { z: -25 * DEG, y: -15 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -28 * DEG, z: -10 * DEG },
      forearm_R:   { x: -30 * DEG },
      hand_R:      { x: -5 * DEG, z: -8 * DEG, y: 5 * DEG },
    },
  },
  [AttackDirection.Right as number]: {
    windup: {
      upper_arm_R: { x: -55 * DEG, z: 55 * DEG, y: -35 * DEG },
      forearm_R:   { x: -25 * DEG },
      hand_R:      { z: -20 * DEG, y: -10 * DEG },
    },
    release: {
      upper_arm_R: { x: -35 * DEG, z: -55 * DEG, y: 45 * DEG },
      forearm_R:   { x: -8 * DEG },
      hand_R:      { z: 25 * DEG, y: 15 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -28 * DEG, z: -10 * DEG },
      forearm_R:   { x: -30 * DEG },
      hand_R:      { x: -5 * DEG, z: -8 * DEG, y: 5 * DEG },
    },
  },
  [AttackDirection.Overhead as number]: {
    windup: {
      upper_arm_R: { x: -115 * DEG, z: -12 * DEG },
      forearm_R:   { x: -45 * DEG },
      hand_R:      { x: -15 * DEG, z: 5 * DEG },
    },
    release: {
      // Powerful slam — arm comes down hard
      upper_arm_R: { x: -10 * DEG, z: -5 * DEG },
      forearm_R:   { x: -55 * DEG },
      hand_R:      { x: 10 * DEG, z: -10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -28 * DEG, z: -10 * DEG },
      forearm_R:   { x: -30 * DEG },
      hand_R:      { x: -5 * DEG, z: -8 * DEG, y: 5 * DEG },
    },
  },
  [AttackDirection.Underhand as number]: {
    windup: {
      upper_arm_R: { x: 20 * DEG, z: -25 * DEG },
      forearm_R:   { x: -8 * DEG },
      hand_R:      { x: 15 * DEG, y: 10 * DEG },
    },
    release: {
      upper_arm_R: { x: -95 * DEG, z: -12 * DEG },
      forearm_R:   { x: -15 * DEG },
      hand_R:      { x: -8 * DEG, y: -5 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -28 * DEG, z: -10 * DEG },
      forearm_R:   { x: -30 * DEG },
      hand_R:      { x: -5 * DEG, z: -8 * DEG, y: 5 * DEG },
    },
  },
  [AttackDirection.Stab as number]: {
    windup: {
      upper_arm_R: { x: -45 * DEG, z: -12 * DEG },
      forearm_R:   { x: -75 * DEG },
      hand_R:      { x: -8 * DEG, y: 5 * DEG },
    },
    release: {
      upper_arm_R: { x: -55 * DEG, z: -5 * DEG },
      forearm_R:   { x: -8 * DEG },
      hand_R:      { x: 5 * DEG, y: -5 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -28 * DEG, z: -10 * DEG },
      forearm_R:   { x: -30 * DEG },
      hand_R:      { x: -5 * DEG, z: -8 * DEG, y: 5 * DEG },
    },
  },
};

const MACE_BLOCKS: Record<number, Pose> = {
  [BlockDirection.Left as number]: {
    upper_arm_R: { x: -50 * DEG, z: 40 * DEG, y: -25 * DEG },
    forearm_R:   { x: -40 * DEG },
    hand_R:      { z: 20 * DEG, y: 8 * DEG },
  },
  [BlockDirection.Right as number]: {
    upper_arm_R: { x: -50 * DEG, z: -45 * DEG, y: 25 * DEG },
    forearm_R:   { x: -40 * DEG },
    hand_R:      { z: -20 * DEG, y: -8 * DEG },
  },
  [BlockDirection.Top as number]: {
    upper_arm_R: { x: -105 * DEG, z: -10 * DEG },
    forearm_R:   { x: -20 * DEG },
    hand_R:      { x: -8 * DEG },
  },
  [BlockDirection.Bottom as number]: {
    upper_arm_R: { x: 8 * DEG, z: -18 * DEG },
    forearm_R:   { x: -18 * DEG },
    hand_R:      { x: 8 * DEG, y: 5 * DEG },
  },
};

const MACE_PARRY: Pose = {
  upper_arm_R: { x: -55 * DEG, z: -18 * DEG },
  forearm_R:   { x: -35 * DEG },
  hand_R:      { z: 10 * DEG, y: -8 * DEG },
};

const MACE_STUNNED: Pose = {
  upper_arm_R: { x: 15 * DEG, z: -12 * DEG },
  forearm_R:   { x: -8 * DEG },
  hand_R:      { z: 12 * DEG, y: 5 * DEG },
};

const MACE_HITSTUN: Pose = {
  upper_arm_R: { x: 8 * DEG },
  forearm_R:   { x: -12 * DEG },
  hand_R:      { z: -8 * DEG, y: -5 * DEG },
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
  upper_arm_R: { x: -22 * DEG, z: -5 * DEG },
  forearm_R:   { x: -45 * DEG },
  hand_R:      { x: -8 * DEG, z: -3 * DEG },
};

const DAGGER_ATTACKS: Record<number, CombatAnimation> = {
  [AttackDirection.Left as number]: {
    windup: {
      upper_arm_R: { x: -35 * DEG, z: -35 * DEG, y: 20 * DEG },
      forearm_R:   { x: -25 * DEG },
      hand_R:      { z: 8 * DEG },
    },
    release: {
      upper_arm_R: { x: -30 * DEG, z: 35 * DEG, y: -30 * DEG },
      forearm_R:   { x: -15 * DEG },
      hand_R:      { z: -10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -22 * DEG, z: -5 * DEG },
      forearm_R:   { x: -45 * DEG },
      hand_R:      { x: -8 * DEG, z: -3 * DEG },
    },
  },
  [AttackDirection.Right as number]: {
    windup: {
      upper_arm_R: { x: -35 * DEG, z: 35 * DEG, y: -20 * DEG },
      forearm_R:   { x: -25 * DEG },
      hand_R:      { z: -8 * DEG },
    },
    release: {
      upper_arm_R: { x: -30 * DEG, z: -35 * DEG, y: 30 * DEG },
      forearm_R:   { x: -15 * DEG },
      hand_R:      { z: 10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -22 * DEG, z: -5 * DEG },
      forearm_R:   { x: -45 * DEG },
      hand_R:      { x: -8 * DEG, z: -3 * DEG },
    },
  },
  [AttackDirection.Overhead as number]: {
    windup: {
      upper_arm_R: { x: -85 * DEG, z: -8 * DEG },
      forearm_R:   { x: -35 * DEG },
      hand_R:      { x: -8 * DEG },
    },
    release: {
      upper_arm_R: { x: -20 * DEG, z: -3 * DEG },
      forearm_R:   { x: -45 * DEG },
      hand_R:      { x: 5 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -22 * DEG, z: -5 * DEG },
      forearm_R:   { x: -45 * DEG },
      hand_R:      { x: -8 * DEG, z: -3 * DEG },
    },
  },
  [AttackDirection.Underhand as number]: {
    windup: {
      upper_arm_R: { x: 5 * DEG, z: -15 * DEG },
      forearm_R:   { x: -12 * DEG },
      hand_R:      { x: 8 * DEG },
    },
    release: {
      upper_arm_R: { x: -70 * DEG, z: -8 * DEG },
      forearm_R:   { x: -20 * DEG },
      hand_R:      { x: -5 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -22 * DEG, z: -5 * DEG },
      forearm_R:   { x: -45 * DEG },
      hand_R:      { x: -8 * DEG, z: -3 * DEG },
    },
  },
  // Stab is the dagger's signature — fast thrust, minimal windup
  [AttackDirection.Stab as number]: {
    windup: {
      upper_arm_R: { x: -35 * DEG, z: -5 * DEG },
      forearm_R:   { x: -65 * DEG },
      hand_R:      { x: -3 * DEG },
    },
    release: {
      upper_arm_R: { x: -55 * DEG, z: -2 * DEG },
      forearm_R:   { x: -3 * DEG },
      hand_R:      { x: 2 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -22 * DEG, z: -5 * DEG },
      forearm_R:   { x: -45 * DEG },
      hand_R:      { x: -8 * DEG, z: -3 * DEG },
    },
  },
};

const DAGGER_BLOCKS: Record<number, Pose> = {
  [BlockDirection.Left as number]: {
    upper_arm_R: { x: -40 * DEG, z: 25 * DEG, y: -15 * DEG },
    forearm_R:   { x: -50 * DEG },
    hand_R:      { z: 10 * DEG },
  },
  [BlockDirection.Right as number]: {
    upper_arm_R: { x: -40 * DEG, z: -30 * DEG, y: 15 * DEG },
    forearm_R:   { x: -50 * DEG },
    hand_R:      { z: -10 * DEG },
  },
  [BlockDirection.Top as number]: {
    upper_arm_R: { x: -80 * DEG, z: -5 * DEG },
    forearm_R:   { x: -30 * DEG },
    hand_R:      { x: -5 * DEG },
  },
  [BlockDirection.Bottom as number]: {
    upper_arm_R: { x: 0, z: -12 * DEG },
    forearm_R:   { x: -25 * DEG },
    hand_R:      { x: 5 * DEG },
  },
};

const DAGGER_PARRY: Pose = {
  upper_arm_R: { x: -45 * DEG, z: -10 * DEG },
  forearm_R:   { x: -45 * DEG },
  hand_R:      { z: 8 * DEG },
};

const DAGGER_STUNNED: Pose = {
  upper_arm_R: { x: 5 * DEG, z: -8 * DEG },
  forearm_R:   { x: -12 * DEG },
  hand_R:      { z: 5 * DEG },
};

const DAGGER_HITSTUN: Pose = {
  upper_arm_R: { x: 3 * DEG },
  forearm_R:   { x: -18 * DEG },
  hand_R:      { z: -3 * DEG },
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
  upper_arm_R: { x: -32 * DEG, z: -12 * DEG },
  forearm_R:   { x: -25 * DEG },
  hand_R:      { x: -5 * DEG, z: -10 * DEG },
};

const BATTLEAXE_ATTACKS: Record<number, CombatAnimation> = {
  [AttackDirection.Left as number]: {
    windup: {
      // Arm pulled far back to the right
      upper_arm_R: { x: -60 * DEG, z: -65 * DEG, y: 40 * DEG },
      forearm_R:   { x: -30 * DEG },
      hand_R:      { z: 15 * DEG },
    },
    release: {
      // Wide devastating sweep left
      upper_arm_R: { x: -35 * DEG, z: 60 * DEG, y: -50 * DEG },
      forearm_R:   { x: -8 * DEG },
      hand_R:      { z: -20 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -32 * DEG, z: -12 * DEG },
      forearm_R:   { x: -25 * DEG },
      hand_R:      { x: -5 * DEG, z: -10 * DEG },
    },
  },
  [AttackDirection.Right as number]: {
    windup: {
      // Arm pulled far back to the left
      upper_arm_R: { x: -60 * DEG, z: 65 * DEG, y: -40 * DEG },
      forearm_R:   { x: -30 * DEG },
      hand_R:      { z: -15 * DEG },
    },
    release: {
      // Wide devastating sweep right
      upper_arm_R: { x: -35 * DEG, z: -60 * DEG, y: 50 * DEG },
      forearm_R:   { x: -8 * DEG },
      hand_R:      { z: 20 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -32 * DEG, z: -12 * DEG },
      forearm_R:   { x: -25 * DEG },
      hand_R:      { x: -5 * DEG, z: -10 * DEG },
    },
  },
  [AttackDirection.Overhead as number]: {
    windup: {
      // Arm WAY back — exaggerated overhead
      upper_arm_R: { x: -120 * DEG, z: -15 * DEG },
      forearm_R:   { x: -50 * DEG },
      hand_R:      { x: -15 * DEG },
    },
    release: {
      // Powerful chop down
      upper_arm_R: { x: -10 * DEG, z: -5 * DEG },
      forearm_R:   { x: -60 * DEG },
      hand_R:      { x: 12 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -32 * DEG, z: -12 * DEG },
      forearm_R:   { x: -25 * DEG },
      hand_R:      { x: -5 * DEG, z: -10 * DEG },
    },
  },
  [AttackDirection.Underhand as number]: {
    windup: {
      upper_arm_R: { x: 25 * DEG, z: -30 * DEG },
      forearm_R:   { x: -5 * DEG },
      hand_R:      { x: 15 * DEG },
    },
    release: {
      upper_arm_R: { x: -100 * DEG, z: -12 * DEG },
      forearm_R:   { x: -15 * DEG },
      hand_R:      { x: -10 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -32 * DEG, z: -12 * DEG },
      forearm_R:   { x: -25 * DEG },
      hand_R:      { x: -5 * DEG, z: -10 * DEG },
    },
  },
  [AttackDirection.Stab as number]: {
    windup: {
      upper_arm_R: { x: -50 * DEG, z: -15 * DEG },
      forearm_R:   { x: -85 * DEG },
      hand_R:      { x: -10 * DEG },
    },
    release: {
      upper_arm_R: { x: -65 * DEG, z: -5 * DEG },
      forearm_R:   { x: -5 * DEG },
      hand_R:      { x: 5 * DEG },
    },
    recovery: {
      upper_arm_R: { x: -32 * DEG, z: -12 * DEG },
      forearm_R:   { x: -25 * DEG },
      hand_R:      { x: -5 * DEG, z: -10 * DEG },
    },
  },
};

const BATTLEAXE_BLOCKS: Record<number, Pose> = {
  [BlockDirection.Left as number]: {
    upper_arm_R: { x: -55 * DEG, z: 38 * DEG, y: -22 * DEG },
    forearm_R:   { x: -42 * DEG },
    hand_R:      { z: 18 * DEG },
  },
  [BlockDirection.Right as number]: {
    upper_arm_R: { x: -55 * DEG, z: -42 * DEG, y: 22 * DEG },
    forearm_R:   { x: -42 * DEG },
    hand_R:      { z: -18 * DEG },
  },
  [BlockDirection.Top as number]: {
    upper_arm_R: { x: -108 * DEG, z: -10 * DEG },
    forearm_R:   { x: -22 * DEG },
    hand_R:      { x: -8 * DEG },
  },
  [BlockDirection.Bottom as number]: {
    upper_arm_R: { x: 10 * DEG, z: -20 * DEG },
    forearm_R:   { x: -15 * DEG },
    hand_R:      { x: 8 * DEG },
  },
};

const BATTLEAXE_PARRY: Pose = {
  upper_arm_R: { x: -65 * DEG, z: -20 * DEG },
  forearm_R:   { x: -35 * DEG },
  hand_R:      { z: 8 * DEG, x: -5 * DEG },
};

const BATTLEAXE_STUNNED: Pose = {
  upper_arm_R: { x: 18 * DEG, z: -15 * DEG },
  forearm_R:   { x: -5 * DEG },
  hand_R:      { z: 15 * DEG },
};

const BATTLEAXE_HITSTUN: Pose = {
  upper_arm_R: { x: 10 * DEG },
  forearm_R:   { x: -10 * DEG },
  hand_R:      { z: -8 * DEG },
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
    case CombatState.Riposte:
      return anims.attacks[direction as number]?.windup ?? anims.idle;

    case CombatState.Release:
      return anims.attacks[direction as number]?.release ?? anims.idle;

    case CombatState.Recovery:
    case CombatState.Feint:
      return anims.attacks[direction as number]?.recovery ?? anims.idle;

    case CombatState.Block:
      return anims.blocks[direction as number] ?? anims.idle;

    case CombatState.ParryWindow:
      return anims.parry;

    case CombatState.Clash:
    case CombatState.Stunned:
      return anims.stunned;

    case CombatState.HitStun:
      return anims.hitStun;

    default:
      return anims.idle;
  }
}
