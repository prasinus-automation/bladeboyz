/**
 * Procedural Animation System.
 *
 * Runs in `update(dt)` (variable rate) for smooth blending.
 * Reads combat FSM state from fixedUpdate to drive upper body animations.
 * Reads velocity to drive lower body movement animations.
 *
 * Architecture:
 * - Upper body (spine, arms, head) driven by combat state + direction
 * - Lower body (legs) driven by movement state + velocity
 * - Smooth blending via quaternion slerp between poses
 * - Animation data is separate (see AnimationData.ts)
 * - Never modifies FSM state — read-only from FSM's perspective
 */

import * as THREE from 'three';
import { defineQuery } from 'bitecs';
import {
  CharacterModel,
  CombatStateComp,
  AnimationComp,
  Velocity,
  meshRegistry,
} from '../components';
import { CombatState, MovementState } from '../../combat/states';
import {
  getCombatPose,
  getMovementParams,
  UPPER_BODY_BONES,
  LOWER_BODY_BONES,
  SHARED_BONES,
  IDLE_POSE,
  type Pose,
  type BoneRotation,
} from '../../animation/AnimationData';
import { FIXED_TIMESTEP as FIXED_DT } from '../../core/types';
import type { GameWorld } from '../../core/types';

// ── Constants ────────────────────────────────────────────

/** Default blend speed (seconds) for smooth transitions */
const DEFAULT_BLEND_DURATION = 0.08; // ~80ms crossfade

/** Breathing sway amplitude (radians) and frequency (Hz) */
const BREATH_AMPLITUDE = 0.008;
const BREATH_FREQUENCY = 0.4;

/** Speed thresholds for movement state detection */
const WALK_SPEED_THRESHOLD = 0.5;
const RUN_SPEED_THRESHOLD = 5.0;

// ── Reusable temp objects (avoid GC pressure) ────────────

const _tempQuat = new THREE.Quaternion();
const _targetQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _prevQuat = new THREE.Quaternion();

// ── Query ────────────────────────────────────────────────

const animatedQuery = defineQuery([CharacterModel, CombatStateComp, AnimationComp]);

// ── Helper: convert BoneRotation to Quaternion ───────────

function boneRotationToQuat(rot: BoneRotation, out: THREE.Quaternion): THREE.Quaternion {
  _euler.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0, 'XYZ');
  return out.setFromEuler(_euler);
}

// ── Helper: get the identity quaternion ──────────────────

const IDENTITY_QUAT = new THREE.Quaternion();

// ── Helper: detect movement state from velocity ──────────

function detectMovementState(
  vx: number,
  _vy: number,
  vz: number,
  isGrounded: boolean,
  isCrouching: boolean,
): MovementState {
  if (!isGrounded) return MovementState.Jumping;
  if (isCrouching) return MovementState.Crouching;

  const horizontalSpeed = Math.sqrt(vx * vx + vz * vz);
  if (horizontalSpeed > RUN_SPEED_THRESHOLD) return MovementState.Running;
  if (horizontalSpeed > WALK_SPEED_THRESHOLD) return MovementState.Walking;
  return MovementState.Idle;
}

function movementStateToKey(state: MovementState): string {
  switch (state) {
    case MovementState.Walking: return 'walk';
    case MovementState.Running: return 'run';
    case MovementState.Jumping: return 'jump';
    case MovementState.Crouching: return 'crouch';
    default: return 'idle';
  }
}

// ── Helper: apply a pose to upper or lower body bones ────

function applyPoseToBones(
  bones: Record<string, THREE.Bone>,
  pose: Pose,
  boneSet: ReadonlySet<string>,
  blendFactor: number,
): void {
  for (const boneName of boneSet) {
    const bone = bones[boneName];
    if (!bone) continue;

    const rotation = pose[boneName];
    if (rotation) {
      boneRotationToQuat(rotation, _targetQuat);
    } else {
      // No rotation specified — blend toward identity (rest pose)
      _targetQuat.copy(IDENTITY_QUAT);
    }

    bone.quaternion.slerp(_targetQuat, blendFactor);
  }
}

// ── Helper: apply sinusoidal walk/run cycle to legs ──────

function applyWalkCycle(
  bones: Record<string, THREE.Bone>,
  walkCycle: number,
  legSwing: number,
  armSwing: number,
  blendFactor: number,
): void {
  const sinPhase = Math.sin(walkCycle);
  const cosPhase = Math.cos(walkCycle);

  // Legs: alternating swing (thighs pitch forward/back)
  const legBones: Array<[string, string, number]> = [
    ['thigh_L', 'shin_L', sinPhase],
    ['thigh_R', 'shin_R', -sinPhase],
  ];

  for (const [thighName, shinName, phase] of legBones) {
    const thigh = bones[thighName];
    const shin = bones[shinName];
    if (thigh) {
      _euler.set(phase * legSwing, 0, 0, 'XYZ');
      _targetQuat.setFromEuler(_euler);
      thigh.quaternion.slerp(_targetQuat, blendFactor);
    }
    if (shin) {
      // Shin bends forward more when leg is behind (positive phase = extending back)
      const shinBend = Math.max(0, phase) * legSwing * 0.8;
      _euler.set(shinBend, 0, 0, 'XYZ');
      _targetQuat.setFromEuler(_euler);
      shin.quaternion.slerp(_targetQuat, blendFactor);
    }
  }

  // Arms: counter-swing (only when not in combat — handled by caller)
  if (armSwing > 0) {
    const armBones: Array<[string, number]> = [
      ['shoulder_L', -sinPhase],
      ['shoulder_R', sinPhase],
    ];
    for (const [name, phase] of armBones) {
      const bone = bones[name];
      if (bone) {
        _euler.set(phase * armSwing, 0, 0, 'XYZ');
        _targetQuat.setFromEuler(_euler);
        bone.quaternion.slerp(_targetQuat, blendFactor);
      }
    }
  }
}

// ── Main System ──────────────────────────────────────────

/** Elapsed time accumulator for breathing animation */
let _elapsedTime = 0;

/**
 * Animation system — call in update(dt) for smooth variable-rate blending.
 *
 * @param world - The game world
 * @param dt - Frame delta time in seconds (variable rate)
 */
export function animationSystem(world: GameWorld, dt: number): void {
  _elapsedTime += dt;
  const entities = animatedQuery(world.ecs);

  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    const modelData = meshRegistry.get(CharacterModel.id[eid]);
    if (!modelData) continue;

    const { bones } = modelData;

    // ── Read combat state ──
    const combatState = CombatStateComp.state[eid] as CombatState;
    const direction = CombatStateComp.direction[eid];
    const phaseElapsed = CombatStateComp.phaseElapsed[eid];
    const phaseTotal = CombatStateComp.phaseTotal[eid];

    // ── Detect state transitions ──
    const prevState = AnimationComp.prevCombatState[eid] as CombatState;
    const prevDir = AnimationComp.prevDirection[eid];
    const stateChanged = combatState !== prevState || direction !== prevDir;

    if (stateChanged) {
      // Reset blend progress on state change for smooth transition
      AnimationComp.upperBlend[eid] = 0;
      AnimationComp.prevCombatState[eid] = combatState;
      AnimationComp.prevDirection[eid] = direction;
    }

    // ── Calculate blend factors ──
    // Phase-based blend: ramp 0→1 over the phase duration
    let phaseBlend = 1;
    if (phaseTotal > 0) {
      const phaseSeconds = phaseTotal * FIXED_DT;
      const elapsedSeconds = phaseElapsed * FIXED_DT;
      phaseBlend = Math.min(1, elapsedSeconds / phaseSeconds);
    }

    // Time-based blend for crossfade on state transitions
    let upperBlend = AnimationComp.upperBlend[eid];
    upperBlend = Math.min(1, upperBlend + dt / DEFAULT_BLEND_DURATION);
    AnimationComp.upperBlend[eid] = upperBlend;

    // Use the faster of phase blend or crossfade blend
    const effectiveUpperBlend = Math.max(phaseBlend, upperBlend);

    // ── Get target upper body pose ──
    const combatPose = getCombatPose(combatState, direction);

    // ── Apply upper body combat animation ──
    applyPoseToBones(bones, combatPose, UPPER_BODY_BONES, effectiveUpperBlend);

    // ── Movement state detection ──
    const vx = Velocity.x[eid] ?? 0;
    const vy = Velocity.y[eid] ?? 0;
    const vz = Velocity.z[eid] ?? 0;
    const horizontalSpeed = Math.sqrt(vx * vx + vz * vz);

    // Simple grounded/crouching detection — for now assume grounded if vy ~= 0
    const isGrounded = Math.abs(vy) < 0.5;
    const isCrouching = false; // TODO: read from input/movement component

    const movState = detectMovementState(vx, vy, vz, isGrounded, isCrouching);
    AnimationComp.movementState[eid] = movState;

    const movKey = movementStateToKey(movState);
    const movParams = getMovementParams(movKey);

    // ── Lower body blend ──
    let lowerBlend = AnimationComp.lowerBlend[eid];
    lowerBlend = Math.min(1, lowerBlend + dt / DEFAULT_BLEND_DURATION);
    AnimationComp.lowerBlend[eid] = lowerBlend;

    // ── Apply movement base pose to lower body ──
    if (Object.keys(movParams.basePose).length > 0) {
      applyPoseToBones(bones, movParams.basePose, LOWER_BODY_BONES, lowerBlend);
    }

    // ── Walk/run cycle ──
    if (movParams.legSwing > 0 && horizontalSpeed > WALK_SPEED_THRESHOLD) {
      // Accumulate walk cycle phase based on distance traveled
      let walkCycle = AnimationComp.walkCycle[eid];
      walkCycle += dt * movParams.cycleSpeed * (horizontalSpeed / 4); // normalize to walk speed
      // Wrap at 2*PI to prevent float overflow
      if (walkCycle > Math.PI * 2) walkCycle -= Math.PI * 2;
      AnimationComp.walkCycle[eid] = walkCycle;

      // Only apply arm swing from walk cycle if in idle combat state
      const armSwing = combatState === CombatState.Idle ? movParams.armSwing : 0;

      applyWalkCycle(bones, walkCycle, movParams.legSwing, armSwing, lowerBlend);
    } else {
      // Reset walk cycle smoothly when stopped
      applyPoseToBones(bones, movParams.basePose, LOWER_BODY_BONES, lowerBlend);
    }

    // ── Shared bones (spine) — blend combat + movement ──
    for (const boneName of SHARED_BONES) {
      const bone = bones[boneName];
      if (!bone) continue;

      // Combat pose for this bone
      const combatRot = combatPose[boneName];
      const movRot = movParams.basePose[boneName];

      if (combatRot && movRot) {
        // Both want to affect this bone — average the quaternions
        boneRotationToQuat(combatRot, _targetQuat);
        boneRotationToQuat(movRot, _prevQuat);
        // Blend: 60% combat, 40% movement for shared bones
        _prevQuat.slerp(_targetQuat, 0.6);
        bone.quaternion.slerp(_prevQuat, effectiveUpperBlend);
      }
      // If only one has it, it was already applied by the respective pass
    }

    // ── Idle breathing (subtle sway) ──
    if (combatState === CombatState.Idle && movState === MovementState.Idle) {
      const breathSway = Math.sin(_elapsedTime * Math.PI * 2 * BREATH_FREQUENCY) * BREATH_AMPLITUDE;
      const chestBone = bones['chest'];
      if (chestBone) {
        _euler.set(breathSway, 0, breathSway * 0.5, 'XYZ');
        _tempQuat.setFromEuler(_euler);
        chestBone.quaternion.multiply(_tempQuat);
      }
    }
  }
}

/**
 * Reset the animation system elapsed time.
 * Useful for testing.
 */
export function resetAnimationSystem(): void {
  _elapsedTime = 0;
}
