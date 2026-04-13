/**
 * Procedural animation pose data.
 *
 * All animations are defined as target bone rotations (Euler angles in radians).
 * The AnimationSystem interpolates between poses using quaternion slerp.
 *
 * Architecture: animation data is separate from the system —
 * poses are plain data objects, looked up by FSM state + direction.
 */

import { CombatState } from '../combat/states';
import { AttackDirection, BlockDirection } from '../combat/directions';

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

/** Subtle "ready" stance — sword held in front at mid-guard */
export const IDLE_POSE: Pose = {
  shoulder_R: { x: -15 * DEG, z: -20 * DEG },
  upper_arm_R: { x: -40 * DEG },
  forearm_R: { x: -30 * DEG },
  shoulder_L: { x: -10 * DEG, z: 20 * DEG },
  upper_arm_L: { x: -30 * DEG },
  forearm_L: { x: -20 * DEG },
  spine: { x: 2 * DEG },
};

// ── Combat Animations (5 directions × 3 phases) ─────────

const ATTACK_ANIMATIONS: Record<number, CombatAnimation> = {
  // ── Left Swing ──
  [AttackDirection.Left as number]: {
    windup: {
      // Sword pulled to the right, torso rotated right
      chest: { y: 40 * DEG },
      shoulder_R: { x: -20 * DEG, z: -60 * DEG, y: 30 * DEG },
      upper_arm_R: { x: -70 * DEG, z: -30 * DEG },
      forearm_R: { x: -20 * DEG },
      shoulder_L: { x: -10 * DEG, z: 15 * DEG },
      upper_arm_L: { x: -20 * DEG },
    },
    release: {
      // Sweep left — torso rotates left, arm sweeps across
      chest: { y: -40 * DEG },
      shoulder_R: { x: -10 * DEG, z: 40 * DEG, y: -40 * DEG },
      upper_arm_R: { x: -50 * DEG, z: 30 * DEG },
      forearm_R: { x: -10 * DEG },
      shoulder_L: { x: -10 * DEG, z: 10 * DEG },
      upper_arm_L: { x: -20 * DEG },
    },
    recovery: IDLE_POSE,
  },

  // ── Right Swing ──
  [AttackDirection.Right as number]: {
    windup: {
      // Sword pulled to the left, torso rotated left
      chest: { y: -40 * DEG },
      shoulder_R: { x: -20 * DEG, z: 50 * DEG, y: -30 * DEG },
      upper_arm_R: { x: -70 * DEG, z: 30 * DEG },
      forearm_R: { x: -20 * DEG },
      shoulder_L: { x: -15 * DEG, z: 25 * DEG },
      upper_arm_L: { x: -30 * DEG },
    },
    release: {
      // Sweep right — torso rotates right, arm sweeps across
      chest: { y: 40 * DEG },
      shoulder_R: { x: -10 * DEG, z: -50 * DEG, y: 40 * DEG },
      upper_arm_R: { x: -50 * DEG, z: -30 * DEG },
      forearm_R: { x: -10 * DEG },
      shoulder_L: { x: -10 * DEG, z: 15 * DEG },
      upper_arm_L: { x: -20 * DEG },
    },
    recovery: IDLE_POSE,
  },

  // ── Overhead ──
  [AttackDirection.Overhead as number]: {
    windup: {
      // Sword raised high above head
      chest: { x: -10 * DEG },
      shoulder_R: { x: -160 * DEG, z: -15 * DEG },
      upper_arm_R: { x: -10 * DEG },
      forearm_R: { x: -30 * DEG },
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
      shoulder_L: { x: -20 * DEG, z: 10 * DEG },
      upper_arm_L: { x: -30 * DEG },
      forearm_L: { x: -30 * DEG },
    },
    recovery: IDLE_POSE,
  },

  // ── Underhand ──
  [AttackDirection.Underhand as number]: {
    windup: {
      // Sword low, behind/below
      chest: { x: 10 * DEG },
      shoulder_R: { x: 20 * DEG, z: -30 * DEG },
      upper_arm_R: { x: 30 * DEG },
      forearm_R: { x: -10 * DEG },
      shoulder_L: { x: 10 * DEG, z: 20 * DEG },
      upper_arm_L: { x: 10 * DEG },
    },
    release: {
      // Sweep upward
      chest: { x: -10 * DEG },
      shoulder_R: { x: -120 * DEG, z: -15 * DEG },
      upper_arm_R: { x: -20 * DEG },
      forearm_R: { x: -20 * DEG },
      shoulder_L: { x: -80 * DEG, z: 10 * DEG },
      upper_arm_L: { x: -10 * DEG },
    },
    recovery: IDLE_POSE,
  },

  // ── Stab ──
  [AttackDirection.Stab as number]: {
    windup: {
      // Sword pulled back, arm chambered
      chest: { y: 20 * DEG },
      shoulder_R: { x: -60 * DEG, z: -15 * DEG },
      upper_arm_R: { x: -20 * DEG },
      forearm_R: { x: -90 * DEG },
      shoulder_L: { x: -40 * DEG, z: 20 * DEG },
      upper_arm_L: { x: -20 * DEG },
      forearm_L: { x: -30 * DEG },
    },
    release: {
      // Thrust forward — arm extends
      chest: { y: 5 * DEG, x: 5 * DEG },
      shoulder_R: { x: -80 * DEG, z: -5 * DEG },
      upper_arm_R: { x: -10 * DEG },
      forearm_R: { x: -5 * DEG },
      shoulder_L: { x: -20 * DEG, z: 15 * DEG },
      upper_arm_L: { x: -15 * DEG },
      forearm_L: { x: -10 * DEG },
    },
    recovery: IDLE_POSE,
  },
};

// ── Block Poses (4 directions) ───────────────────────────

const BLOCK_POSES: Record<number, BlockPose> = {
  [BlockDirection.Left as number]: {
    // Sword angled to the left to catch incoming swings
    chest: { y: -20 * DEG },
    shoulder_R: { x: -60 * DEG, z: 30 * DEG, y: -20 * DEG },
    upper_arm_R: { x: -40 * DEG },
    forearm_R: { x: -50 * DEG },
    shoulder_L: { x: -50 * DEG, z: 25 * DEG },
    upper_arm_L: { x: -30 * DEG },
    forearm_L: { x: -40 * DEG },
  },
  [BlockDirection.Right as number]: {
    // Sword angled to the right
    chest: { y: 20 * DEG },
    shoulder_R: { x: -60 * DEG, z: -40 * DEG, y: 20 * DEG },
    upper_arm_R: { x: -40 * DEG },
    forearm_R: { x: -50 * DEG },
    shoulder_L: { x: -40 * DEG, z: 15 * DEG },
    upper_arm_L: { x: -20 * DEG },
    forearm_L: { x: -30 * DEG },
  },
  [BlockDirection.Top as number]: {
    // Sword held high horizontally above head
    shoulder_R: { x: -150 * DEG, z: -10 * DEG },
    upper_arm_R: { x: -10 * DEG },
    forearm_R: { x: -20 * DEG },
    shoulder_L: { x: -130 * DEG, z: 10 * DEG },
    upper_arm_L: { x: -10 * DEG },
    forearm_L: { x: -30 * DEG },
  },
  [BlockDirection.Bottom as number]: {
    // Sword held low to catch underhand attacks
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

export const PARRY_POSE: Pose = {
  chest: { x: -10 * DEG },
  shoulder_R: { x: -80 * DEG, z: -20 * DEG },
  upper_arm_R: { x: -20 * DEG },
  forearm_R: { x: -40 * DEG },
};

// ── Stunned pose ─────────────────────────────────────────

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
export function getAttackAnimation(direction: AttackDirection): CombatAnimation {
  return ATTACK_ANIMATIONS[direction as number] ?? ATTACK_ANIMATIONS[AttackDirection.Stab as number];
}

/**
 * Get the block pose for a given block direction.
 */
export function getBlockPose(direction: BlockDirection): BlockPose {
  return BLOCK_POSES[direction as number] ?? BLOCK_POSES[BlockDirection.Top as number];
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
    case CombatState.Riposte: // riposte uses windup pose of the attack
      return getAttackAnimation(direction as AttackDirection).windup;

    case CombatState.Release:
      return getAttackAnimation(direction as AttackDirection).release;

    case CombatState.Recovery:
    case CombatState.Feint: // feint snaps to recovery
      return getAttackAnimation(direction as AttackDirection).recovery;

    case CombatState.Block:
      return getBlockPose(direction as BlockDirection);

    case CombatState.ParryWindow:
      return PARRY_POSE;

    case CombatState.Clash:
    case CombatState.Stunned:
      return STUNNED_POSE;

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

// ── Upper/Lower body bone sets ───────────────────────────

/** Bones controlled by combat (upper body) animations */
export const UPPER_BODY_BONES: ReadonlySet<string> = new Set([
  'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upper_arm_L', 'forearm_L', 'hand_L',
  'shoulder_R', 'upper_arm_R', 'forearm_R', 'hand_R',
  'weapon_attach',
]);

/** Bones controlled by movement (lower body) animations */
export const LOWER_BODY_BONES: ReadonlySet<string> = new Set([
  'thigh_L', 'shin_L', 'foot_L',
  'thigh_R', 'shin_R', 'foot_R',
]);

/** Bones shared between upper and lower — blended from both */
export const SHARED_BONES: ReadonlySet<string> = new Set([
  'spine',
]);
