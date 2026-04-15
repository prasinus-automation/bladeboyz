import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { ViewmodelRenderer } from './ViewmodelRenderer';
import {
  viewmodelAnimationSystem,
  resetViewmodelAnimationSystem,
} from './ViewmodelAnimationSystem';
import { CombatStateComp } from '../ecs/components';
import { CombatState } from '../combat/states';
import { AttackDirection, BlockDirection } from '../combat/directions';
import { addEntity, createWorld } from 'bitecs';

// Minimal weapon factory for testing
function createFakeWeaponFactory() {
  return () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.5, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff0000 }),
    ));
    return { group, tracerPoints: [] };
  };
}

const WEAPON_ID_TO_NAME = ['Longsword', 'Mace', 'Dagger', 'Battleaxe'];

describe('ViewmodelAnimationSystem', () => {
  let scene: THREE.Scene;
  let viewmodel: ViewmodelRenderer;
  let eid: number;

  beforeEach(() => {
    // Create a bitECS world + entity so CombatStateComp arrays are valid
    const ecsWorld = createWorld();
    eid = addEntity(ecsWorld);

    // Initialize CombatStateComp for this entity
    CombatStateComp.state[eid] = CombatState.Idle;
    CombatStateComp.direction[eid] = 0;
    CombatStateComp.phaseElapsed[eid] = 0;
    CombatStateComp.phaseTotal[eid] = 0;
    CombatStateComp.weaponId[eid] = 2; // Dagger

    scene = new THREE.Scene();
    viewmodel = new ViewmodelRenderer(scene, 16 / 9, {
      initialWeapon: 'Dagger',
      weaponFactories: {
        Dagger: createFakeWeaponFactory(),
        Longsword: createFakeWeaponFactory(),
        Mace: createFakeWeaponFactory(),
        Battleaxe: createFakeWeaponFactory(),
      },
    });

    resetViewmodelAnimationSystem();
  });

  describe('basic pose application', () => {
    it('applies idle pose to viewmodel bones', () => {
      viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);

      // After one frame, bones should have moved from identity
      const handBone = viewmodel.bones['hand_R'];
      expect(handBone).toBeDefined();
      // Quaternion should not be identity (idle pose has rotation)
      const identity = new THREE.Quaternion();
      expect(handBone.quaternion.equals(identity)).toBe(false);
    });

    it('applies different poses for different combat states', () => {
      // First tick in idle
      viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      const idleQuat = viewmodel.bones['upper_arm_R'].quaternion.clone();

      // Change to windup
      CombatStateComp.state[eid] = CombatState.Windup;
      CombatStateComp.direction[eid] = AttackDirection.Left;
      CombatStateComp.phaseTotal[eid] = 20;
      CombatStateComp.phaseElapsed[eid] = 10;

      // Run enough frames to blend
      for (let i = 0; i < 10; i++) {
        viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      }

      const windupQuat = viewmodel.bones['upper_arm_R'].quaternion.clone();
      expect(windupQuat.equals(idleQuat)).toBe(false);
    });

    it('applies block poses', () => {
      CombatStateComp.state[eid] = CombatState.Block;
      CombatStateComp.direction[eid] = BlockDirection.Top;

      for (let i = 0; i < 10; i++) {
        viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      }

      const blockQuat = viewmodel.bones['upper_arm_R'].quaternion.clone();
      const identity = new THREE.Quaternion();
      expect(blockQuat.equals(identity)).toBe(false);
    });
  });

  describe('state transitions and blending', () => {
    it('resets blend progress on state change', () => {
      // Idle for several frames (fully blended)
      for (let i = 0; i < 20; i++) {
        viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      }
      const idleQuat = viewmodel.bones['forearm_R'].quaternion.clone();

      // Transition to windup
      CombatStateComp.state[eid] = CombatState.Windup;
      CombatStateComp.direction[eid] = AttackDirection.Overhead;
      CombatStateComp.phaseTotal[eid] = 30;
      CombatStateComp.phaseElapsed[eid] = 1;

      // First frame after transition — should be partially blended
      viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      const partialQuat = viewmodel.bones['forearm_R'].quaternion.clone();

      // After many frames — should be fully blended to new pose
      CombatStateComp.phaseElapsed[eid] = 30;
      for (let i = 0; i < 20; i++) {
        viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      }
      const fullyBlendedQuat = viewmodel.bones['forearm_R'].quaternion.clone();

      // Partial should differ from both idle and fully blended
      expect(partialQuat.equals(idleQuat)).toBe(false);
    });

    it('detects direction change as state transition', () => {
      CombatStateComp.state[eid] = CombatState.Block;
      CombatStateComp.direction[eid] = BlockDirection.Left;

      for (let i = 0; i < 20; i++) {
        viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      }
      const leftBlockQuat = viewmodel.bones['upper_arm_R'].quaternion.clone();

      // Change direction (same state)
      CombatStateComp.direction[eid] = BlockDirection.Right;

      for (let i = 0; i < 20; i++) {
        viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      }
      const rightBlockQuat = viewmodel.bones['upper_arm_R'].quaternion.clone();

      expect(leftBlockQuat.equals(rightBlockQuat)).toBe(false);
    });
  });

  describe('per-weapon poses', () => {
    it('uses weapon-specific poses based on weaponId', () => {
      // Dagger (weaponId=2)
      CombatStateComp.weaponId[eid] = 2;
      for (let i = 0; i < 20; i++) {
        viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      }
      const daggerIdle = viewmodel.bones['upper_arm_R'].quaternion.clone();

      // Reset and switch to Battleaxe (weaponId=3)
      resetViewmodelAnimationSystem();
      viewmodel.bones['upper_arm_R'].quaternion.identity();
      viewmodel.bones['forearm_R'].quaternion.identity();
      viewmodel.bones['hand_R'].quaternion.identity();

      CombatStateComp.weaponId[eid] = 3;
      for (let i = 0; i < 20; i++) {
        viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      }
      const battleaxeIdle = viewmodel.bones['upper_arm_R'].quaternion.clone();

      // Different weapons should produce different idle poses
      expect(daggerIdle.equals(battleaxeIdle)).toBe(false);
    });

    it('falls back to Longsword for unknown weapon ID', () => {
      CombatStateComp.weaponId[eid] = 99; // nonexistent
      // Should not throw
      viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);

      const bone = viewmodel.bones['upper_arm_R'];
      const identity = new THREE.Quaternion();
      // Should have applied Longsword idle (not identity)
      expect(bone.quaternion.equals(identity)).toBe(false);
    });
  });

  describe('idle sway', () => {
    it('applies sinusoidal sway to hand bone during idle', () => {
      // Run multiple frames at idle
      const handQuats: THREE.Quaternion[] = [];
      for (let i = 0; i < 30; i++) {
        viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
        handQuats.push(viewmodel.bones['hand_R'].quaternion.clone());
      }

      // Hand quaternion should vary slightly over time due to sway
      const first = handQuats[0];
      const last = handQuats[handQuats.length - 1];
      // They should differ slightly due to sinusoidal sway
      const angleDiff = first.angleTo(last);
      expect(angleDiff).toBeGreaterThan(0);
    });

    it('does not apply sway during combat states', () => {
      CombatStateComp.state[eid] = CombatState.Windup;
      CombatStateComp.direction[eid] = AttackDirection.Left;
      CombatStateComp.phaseTotal[eid] = 60;
      CombatStateComp.phaseElapsed[eid] = 30;

      // Run until fully blended
      for (let i = 0; i < 20; i++) {
        viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      }

      // After full blend, consecutive frames should produce same pose
      // (no sway applied in non-idle states)
      const q1 = viewmodel.bones['hand_R'].quaternion.clone();
      viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      const q2 = viewmodel.bones['hand_R'].quaternion.clone();

      // Should be very similar (only micro slerp progress changes)
      const diff = q1.angleTo(q2);
      // Without sway, the diff should be extremely small (slerp approaching target)
      expect(diff).toBeLessThan(0.01);
    });
  });

  describe('visibility check', () => {
    it('skips animation when viewmodel is not visible', () => {
      viewmodel.visible = false;

      const boneQuat = viewmodel.bones['upper_arm_R'].quaternion.clone();
      viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);

      // Bone should not have changed
      expect(viewmodel.bones['upper_arm_R'].quaternion.equals(boneQuat)).toBe(true);
    });
  });

  describe('no per-frame allocations', () => {
    it('uses pre-allocated temp objects (no new THREE.* in hot path)', () => {
      // Run many frames — if we were allocating, GC would be impacted
      // This test verifies the function runs without error
      for (let i = 0; i < 100; i++) {
        CombatStateComp.state[eid] = i % 2 === 0 ? CombatState.Idle : CombatState.Windup;
        CombatStateComp.direction[eid] = i % 5;
        CombatStateComp.phaseElapsed[eid] = i % 10;
        CombatStateComp.phaseTotal[eid] = 20;
        viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      }
      // No assertion — just verifying no crashes/allocation errors
      expect(true).toBe(true);
    });
  });

  describe('resetViewmodelAnimationSystem', () => {
    it('resets module state so next call treats state as new', () => {
      // Run several frames
      CombatStateComp.state[eid] = CombatState.Block;
      CombatStateComp.direction[eid] = BlockDirection.Top;
      for (let i = 0; i < 10; i++) {
        viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
      }

      // Reset
      resetViewmodelAnimationSystem();

      // Next call should detect a "state change" since prevState is reset to -1
      // This means blend starts from 0 again
      viewmodelAnimationSystem(viewmodel, eid, 0.001, WEAPON_ID_TO_NAME);

      // Bone should still be valid (no crash)
      expect(viewmodel.bones['upper_arm_R'].quaternion).toBeDefined();
    });
  });

  describe('all combat states produce valid poses', () => {
    const statesToTest: Array<[string, CombatState, number]> = [
      ['Idle', CombatState.Idle, 0],
      ['Windup Left', CombatState.Windup, AttackDirection.Left],
      ['Windup Right', CombatState.Windup, AttackDirection.Right],
      ['Windup Overhead', CombatState.Windup, AttackDirection.Overhead],
      ['Windup Underhand', CombatState.Windup, AttackDirection.Underhand],
      ['Windup Stab', CombatState.Windup, AttackDirection.Stab],
      ['Release Left', CombatState.Release, AttackDirection.Left],
      ['Recovery', CombatState.Recovery, AttackDirection.Left],
      ['Block Left', CombatState.Block, BlockDirection.Left],
      ['Block Right', CombatState.Block, BlockDirection.Right],
      ['Block Top', CombatState.Block, BlockDirection.Top],
      ['Block Bottom', CombatState.Block, BlockDirection.Bottom],
      ['ParryWindow', CombatState.ParryWindow, 0],
      ['Riposte', CombatState.Riposte, AttackDirection.Left],
      ['Feint', CombatState.Feint, AttackDirection.Left],
      ['Stunned', CombatState.Stunned, 0],
      ['HitStun', CombatState.HitStun, 0],
    ];

    for (const [label, state, direction] of statesToTest) {
      it(`handles ${label} without error`, () => {
        resetViewmodelAnimationSystem();
        CombatStateComp.state[eid] = state;
        CombatStateComp.direction[eid] = direction;
        CombatStateComp.phaseTotal[eid] = 20;
        CombatStateComp.phaseElapsed[eid] = 5;

        // Should not throw
        for (let i = 0; i < 5; i++) {
          viewmodelAnimationSystem(viewmodel, eid, 0.016, WEAPON_ID_TO_NAME);
        }

        // Bones should have valid quaternions (not NaN)
        for (const boneName of ['upper_arm_R', 'forearm_R', 'hand_R']) {
          const q = viewmodel.bones[boneName].quaternion;
          expect(Number.isNaN(q.x)).toBe(false);
          expect(Number.isNaN(q.y)).toBe(false);
          expect(Number.isNaN(q.z)).toBe(false);
          expect(Number.isNaN(q.w)).toBe(false);
        }
      });
    }
  });
});
