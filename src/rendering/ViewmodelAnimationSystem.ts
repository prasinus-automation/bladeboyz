/**
 * Viewmodel Animation System — drives first-person arm bone poses.
 *
 * Runs in `update(dt)` (variable rate) for smooth blending.
 * Reads the player's combat state from ECS and applies per-weapon poses
 * to the ViewmodelRenderer's bone hierarchy via quaternion slerp.
 *
 * This is NOT a bitECS query-based system — it operates on a single
 * player entity's viewmodel (Three.js objects), so it lives in
 * src/rendering/ rather than src/ecs/systems/.
 */

import * as THREE from 'three';
import { CombatStateComp } from '../ecs/components';
import { CombatState } from '../combat/states';
import { getViewmodelPose } from '../animation/ViewmodelAnimationData';
import { FIXED_TIMESTEP } from '../core/types';
import type { ViewmodelRenderer } from './ViewmodelRenderer';
import type { BoneRotation } from '../animation/AnimationData';

// ── Constants ────────────────────────────────────────────

/** Crossfade duration on state transitions (seconds) — matches AnimationSystem */
const BLEND_DURATION = 0.08;

/** Idle sway amplitude (radians) — gentle FPS weapon bob */
const IDLE_SWAY_AMPLITUDE = 0.005;

/** Idle sway frequency (Hz) */
const IDLE_SWAY_FREQUENCY = 0.6;

// ── Pre-allocated temp objects (avoid GC pressure) ───────

const _targetQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _swayQuat = new THREE.Quaternion();

// ── Module-level state (single player, single viewmodel) ─

let prevState: number = -1;
let prevDirection: number = -1;
let blendProgress = 1; // start fully blended
let elapsedTime = 0;

// ── Helpers ──────────────────────────────────────────────

/** Convert BoneRotation euler angles to quaternion (same as AnimationSystem) */
function boneRotationToQuat(rot: BoneRotation, out: THREE.Quaternion): THREE.Quaternion {
  _euler.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0, 'XYZ');
  return out.setFromEuler(_euler);
}

// Identity quaternion for bones with no rotation specified
const IDENTITY_QUAT = new THREE.Quaternion();

// Viewmodel bone names that we animate (weapon_attach keeps its construction rotation)
const VIEWMODEL_BONE_NAMES = ['upper_arm_R', 'forearm_R', 'hand_R'] as const;

// ── Main System Function ─────────────────────────────────

/**
 * Drive viewmodel bone poses based on the player's combat state.
 *
 * Call in the variable-rate update(dt) loop, after animationSystem().
 *
 * @param viewmodel - The ViewmodelRenderer instance
 * @param playerEid - Player entity ID (to read CombatStateComp)
 * @param dt - Frame delta time in seconds (variable rate)
 * @param weaponIdToName - Weapon ID → name mapping array
 */
export function viewmodelAnimationSystem(
  viewmodel: ViewmodelRenderer,
  playerEid: number,
  dt: number,
  weaponIdToName: string[],
): void {
  if (!viewmodel.visible) return;

  elapsedTime += dt;

  // ── Read combat state from ECS ──
  const combatState = CombatStateComp.state[playerEid] as CombatState;
  const direction = CombatStateComp.direction[playerEid];
  const phaseElapsed = CombatStateComp.phaseElapsed[playerEid];
  const phaseTotal = CombatStateComp.phaseTotal[playerEid];
  const weaponId = CombatStateComp.weaponId[playerEid];

  // ── Map weapon ID to name ──
  const weaponName = weaponIdToName[weaponId] ?? 'Longsword';

  // ── Look up target pose ──
  const targetPose = getViewmodelPose(weaponName, combatState, direction);

  // ── Detect state transitions ──
  const stateChanged = combatState !== prevState || direction !== prevDirection;
  if (stateChanged) {
    blendProgress = 0;
    prevState = combatState;
    prevDirection = direction;
  }

  // ── Calculate blend factors ──
  // Phase-based blend: ramp 0→1 over the combat phase duration
  let phaseBlend = 1;
  if (phaseTotal > 0) {
    const phaseSeconds = phaseTotal * FIXED_TIMESTEP;
    const elapsedSeconds = phaseElapsed * FIXED_TIMESTEP;
    phaseBlend = Math.min(1, elapsedSeconds / phaseSeconds);
  }

  // Time-based crossfade blend on state transitions
  blendProgress = Math.min(1, blendProgress + dt / BLEND_DURATION);

  // Use the faster of phase blend or crossfade blend
  const effectiveBlend = Math.max(phaseBlend, blendProgress);

  // ── Apply poses to viewmodel bones via quaternion slerp ──
  const { bones } = viewmodel;

  for (const boneName of VIEWMODEL_BONE_NAMES) {
    const bone = bones[boneName];
    if (!bone) continue;

    const rotation = targetPose[boneName];
    if (rotation) {
      boneRotationToQuat(rotation, _targetQuat);
    } else {
      _targetQuat.copy(IDENTITY_QUAT);
    }

    bone.quaternion.slerp(_targetQuat, effectiveBlend);
  }

  // ── Idle sway — subtle weapon bob when in Idle state ──
  if (combatState === CombatState.Idle) {
    const handBone = bones['hand_R'];
    if (handBone) {
      const sway = Math.sin(elapsedTime * Math.PI * 2 * IDLE_SWAY_FREQUENCY) * IDLE_SWAY_AMPLITUDE;
      _euler.set(sway, 0, 0, 'XYZ');
      _swayQuat.setFromEuler(_euler);
      handBone.quaternion.multiply(_swayQuat);
    }

    // Tiny forearm z-axis sway for subtle life
    const forearmBone = bones['forearm_R'];
    if (forearmBone) {
      const forearmSway = Math.sin(elapsedTime * Math.PI * 2 * IDLE_SWAY_FREQUENCY + 0.5) * IDLE_SWAY_AMPLITUDE * 0.5;
      _euler.set(0, 0, forearmSway, 'XYZ');
      _swayQuat.setFromEuler(_euler);
      forearmBone.quaternion.multiply(_swayQuat);
    }
  }
}

/**
 * Reset viewmodel animation state.
 * Useful for testing and when changing player entities.
 */
export function resetViewmodelAnimationSystem(): void {
  prevState = -1;
  prevDirection = -1;
  blendProgress = 1;
  elapsedTime = 0;
}
