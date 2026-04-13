import { AttackDirection, BodyRegion, CombatState } from '../combat/states';
import type { WeaponConfig } from './WeaponConfig';
import { weaponConfigs } from './WeaponConfig';

/**
 * Longsword — balanced two-handed weapon.
 * Tracer points run from hilt to tip along the blade in weapon-local space (Y-up).
 */
export const longsword: WeaponConfig = {
  name: 'longsword',
  length: 1.2,

  // 4 tracer sample points from near-hilt to blade tip
  tracerPoints: [
    [0, 0.15, 0],   // near hilt
    [0, 0.45, 0],   // lower blade
    [0, 0.80, 0],   // upper blade
    [0, 1.15, 0],   // blade tip
  ],

  timing: {
    [AttackDirection.Left]: {
      windupTicks: 20,
      releaseTicks: 16,
      recoveryTicks: 25,
      comboRecoveryTicks: 14,
      feintWindowTicks: 10,
      morphWindowTicks: 8,
    },
    [AttackDirection.Right]: {
      windupTicks: 20,
      releaseTicks: 16,
      recoveryTicks: 25,
      comboRecoveryTicks: 14,
      feintWindowTicks: 10,
      morphWindowTicks: 8,
    },
    [AttackDirection.Overhead]: {
      windupTicks: 24,
      releaseTicks: 14,
      recoveryTicks: 28,
      comboRecoveryTicks: 16,
      feintWindowTicks: 12,
      morphWindowTicks: 8,
    },
    [AttackDirection.Underhand]: {
      windupTicks: 18,
      releaseTicks: 18,
      recoveryTicks: 24,
      comboRecoveryTicks: 14,
      feintWindowTicks: 9,
      morphWindowTicks: 7,
    },
    [AttackDirection.Stab]: {
      windupTicks: 22,
      releaseTicks: 12,
      recoveryTicks: 26,
      comboRecoveryTicks: 15,
      feintWindowTicks: 11,
      morphWindowTicks: 9,
    },
  },

  damage: {
    [AttackDirection.Left]: {
      [BodyRegion.Head]: 55,
      [BodyRegion.Torso]: 40,
      [BodyRegion.LeftArm]: 30,
      [BodyRegion.RightArm]: 30,
      [BodyRegion.LeftLeg]: 25,
      [BodyRegion.RightLeg]: 25,
    },
    [AttackDirection.Right]: {
      [BodyRegion.Head]: 55,
      [BodyRegion.Torso]: 40,
      [BodyRegion.LeftArm]: 30,
      [BodyRegion.RightArm]: 30,
      [BodyRegion.LeftLeg]: 25,
      [BodyRegion.RightLeg]: 25,
    },
    [AttackDirection.Overhead]: {
      [BodyRegion.Head]: 70,
      [BodyRegion.Torso]: 50,
      [BodyRegion.LeftArm]: 35,
      [BodyRegion.RightArm]: 35,
      [BodyRegion.LeftLeg]: 20,
      [BodyRegion.RightLeg]: 20,
    },
    [AttackDirection.Underhand]: {
      [BodyRegion.Head]: 40,
      [BodyRegion.Torso]: 35,
      [BodyRegion.LeftArm]: 25,
      [BodyRegion.RightArm]: 25,
      [BodyRegion.LeftLeg]: 35,
      [BodyRegion.RightLeg]: 35,
    },
    [AttackDirection.Stab]: {
      [BodyRegion.Head]: 65,
      [BodyRegion.Torso]: 50,
      [BodyRegion.LeftArm]: 28,
      [BodyRegion.RightArm]: 28,
      [BodyRegion.LeftLeg]: 22,
      [BodyRegion.RightLeg]: 22,
    },
  },

  staminaCost: 20,
  blockStaminaDrain: 25,
  parryStunTicks: 40,
  hitStunTicks: 30,

  turncaps: {
    [CombatState.Idle]: 1.0,
    [CombatState.Windup]: 0.6,
    [CombatState.Release]: 0.35,
    [CombatState.Recovery]: 0.5,
    [CombatState.Block]: 0.7,
    [CombatState.ParryWindow]: 0.7,
    [CombatState.HitStun]: 0.2,
    [CombatState.Stunned]: 0.1,
  },
};

// Register in global registry
weaponConfigs.set(longsword.name, longsword);
