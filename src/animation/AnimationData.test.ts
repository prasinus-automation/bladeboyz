import { describe, it, expect } from 'vitest';
import {
  getCombatPose,
  getAttackAnimation,
  getBlockPose,
  getMovementParams,
  IDLE_POSE,
  PARRY_POSE,
  STUNNED_POSE,
  HITSTUN_POSE,
  UPPER_BODY_BONES,
  LOWER_BODY_BONES,
  SHARED_BONES,
  MOVEMENT_PARAMS,
  type CombatAnimation,
  type Pose,
} from './AnimationData';
import { CombatState } from '../combat/states';
import { Direction } from '../combat/directions';

describe('AnimationData', () => {
  describe('getAttackAnimation', () => {
    it('returns animations for all 4 attack directions', () => {
      // FSM v2 (#88, #131): 4 directions — Underhand removed.
      const directions = [
        Direction.Left,
        Direction.Right,
        Direction.Overhead,
        Direction.Stab,
      ];

      for (const dir of directions) {
        const anim = getAttackAnimation(dir);
        expect(anim).toBeDefined();
        expect(anim.windup).toBeDefined();
        expect(anim.release).toBeDefined();
        expect(anim.recovery).toBeDefined();
      }
    });

    it('each phase has bone rotations defined', () => {
      const anim = getAttackAnimation(Direction.Left);

      // Windup should have shoulder and arm rotations
      expect(Object.keys(anim.windup).length).toBeGreaterThan(0);
      expect(Object.keys(anim.release).length).toBeGreaterThan(0);
      expect(Object.keys(anim.recovery).length).toBeGreaterThan(0);
    });

    it('recovery poses return to idle', () => {
      // All 4 directions should recover to idle (FSM v2 — Underhand removed).
      const directions = [
        Direction.Left,
        Direction.Right,
        Direction.Overhead,
        Direction.Stab,
      ];

      for (const dir of directions) {
        const anim = getAttackAnimation(dir);
        expect(anim.recovery).toBe(IDLE_POSE);
      }
    });

    it('left and right swings have mirrored chest rotations', () => {
      const left = getAttackAnimation(Direction.Left);
      const right = getAttackAnimation(Direction.Right);

      // In windup, left swing pulls chest right, right swing pulls chest left
      const leftWindupChest = left.windup['chest'];
      const rightWindupChest = right.windup['chest'];

      expect(leftWindupChest).toBeDefined();
      expect(rightWindupChest).toBeDefined();
      if (leftWindupChest?.y !== undefined && rightWindupChest?.y !== undefined) {
        // Should be opposite signs
        expect(Math.sign(leftWindupChest.y)).toBe(-Math.sign(rightWindupChest.y));
      }
    });
  });

  describe('getBlockPose', () => {
    it('returns poses for all 4 block directions', () => {
      const directions = [
        Direction.Left,
        Direction.Right,
        Direction.Overhead,
        Direction.Stab,
      ];

      for (const dir of directions) {
        const pose = getBlockPose(dir);
        expect(pose).toBeDefined();
        expect(Object.keys(pose).length).toBeGreaterThan(0);
      }
    });

    it('top block has arms raised high', () => {
      const topBlock = getBlockPose(Direction.Overhead);
      const shoulderR = topBlock['shoulder_R'];
      expect(shoulderR).toBeDefined();
      // shoulder_R x should be very negative (arms raised)
      if (shoulderR?.x !== undefined) {
        expect(shoulderR.x).toBeLessThan(-Math.PI / 4); // < -45 degrees
      }
    });
  });

  describe('getCombatPose', () => {
    it('returns idle pose for Idle state', () => {
      const pose = getCombatPose(CombatState.Idle, 0);
      expect(pose).toBe(IDLE_POSE);
    });

    it('returns windup pose for Windup state', () => {
      const pose = getCombatPose(CombatState.Windup, Direction.Left);
      const anim = getAttackAnimation(Direction.Left);
      expect(pose).toBe(anim.windup);
    });

    it('returns release pose for Release state', () => {
      const pose = getCombatPose(CombatState.Release, Direction.Overhead);
      const anim = getAttackAnimation(Direction.Overhead);
      expect(pose).toBe(anim.release);
    });

    it('returns recovery pose for Recovery state', () => {
      const pose = getCombatPose(CombatState.Recovery, Direction.Stab);
      const anim = getAttackAnimation(Direction.Stab);
      expect(pose).toBe(anim.recovery);
    });

    it('returns block pose for Blocking state', () => {
      // FSM v2 (#135): `Block` was renamed to `Blocking` and `ParryWindow`
      // is gone — block-pose lookup now keys off the single `Blocking` state.
      const pose = getCombatPose(CombatState.Blocking, Direction.Left);
      expect(pose).toBe(getBlockPose(Direction.Left));
    });

    it('returns parry pose for Parry state', () => {
      // FSM v2 (#135): `ParryWindow` collapsed into Blocking; the standalone
      // `Parry` state is the brief locked pose AFTER a successful parry.
      const pose = getCombatPose(CombatState.Parry, 0);
      expect(pose).toBe(PARRY_POSE);
    });

    it('returns hitstun pose for HitStun state', () => {
      // FSM v2 (#135): `Stunned` (parry penalty) and `Clash` were both
      // collapsed into `HitStun`. The single state covers all stun durations.
      expect(getCombatPose(CombatState.HitStun, 0)).toBe(HITSTUN_POSE);
      // Defensive: STUNNED_POSE is still exported but unreachable via getCombatPose.
      expect(STUNNED_POSE).toBeDefined();
    });
  });

  describe('Movement parameters', () => {
    it('has parameters for all movement types', () => {
      const keys = ['idle', 'walk', 'run', 'crouch', 'jump'];
      for (const key of keys) {
        const params = getMovementParams(key);
        expect(params).toBeDefined();
        expect(typeof params.legSwing).toBe('number');
        expect(typeof params.armSwing).toBe('number');
        expect(typeof params.cycleSpeed).toBe('number');
        expect(params.basePose).toBeDefined();
      }
    });

    it('walk has smaller swing than run', () => {
      const walk = getMovementParams('walk');
      const run = getMovementParams('run');
      expect(run.legSwing).toBeGreaterThan(walk.legSwing);
      expect(run.armSwing).toBeGreaterThan(walk.armSwing);
    });

    it('idle has zero leg/arm swing', () => {
      const idle = getMovementParams('idle');
      expect(idle.legSwing).toBe(0);
      expect(idle.armSwing).toBe(0);
    });

    it('crouch has lowered stance pose', () => {
      const crouch = getMovementParams('crouch');
      expect(crouch.basePose['spine']).toBeDefined();
      expect(crouch.basePose['thigh_L']).toBeDefined();
    });

    it('fallback returns idle params for unknown key', () => {
      const unknown = getMovementParams('nonexistent');
      expect(unknown).toBe(MOVEMENT_PARAMS['idle']);
    });
  });

  describe('Bone sets', () => {
    it('upper body bones include arm and torso bones', () => {
      expect(UPPER_BODY_BONES.has('chest')).toBe(true);
      expect(UPPER_BODY_BONES.has('shoulder_R')).toBe(true);
      expect(UPPER_BODY_BONES.has('upper_arm_R')).toBe(true);
      expect(UPPER_BODY_BONES.has('forearm_R')).toBe(true);
      expect(UPPER_BODY_BONES.has('hand_R')).toBe(true);
      // weapon_attach is intentionally excluded — it's a leaf bone whose
      // rotation is set at construction time and must not be overwritten by animation
      expect(UPPER_BODY_BONES.has('weapon_attach')).toBe(false);
    });

    it('lower body bones include leg bones', () => {
      expect(LOWER_BODY_BONES.has('thigh_L')).toBe(true);
      expect(LOWER_BODY_BONES.has('shin_L')).toBe(true);
      expect(LOWER_BODY_BONES.has('foot_L')).toBe(true);
      expect(LOWER_BODY_BONES.has('thigh_R')).toBe(true);
      expect(LOWER_BODY_BONES.has('shin_R')).toBe(true);
      expect(LOWER_BODY_BONES.has('foot_R')).toBe(true);
    });

    it('spine is a shared bone', () => {
      expect(SHARED_BONES.has('spine')).toBe(true);
    });

    it('upper and lower sets do not overlap except shared', () => {
      for (const bone of LOWER_BODY_BONES) {
        if (!SHARED_BONES.has(bone)) {
          expect(UPPER_BODY_BONES.has(bone)).toBe(false);
        }
      }
    });
  });

  describe('Pose data integrity', () => {
    it('IDLE_POSE has arm positions for sword guard', () => {
      expect(IDLE_POSE['shoulder_R']).toBeDefined();
      expect(IDLE_POSE['upper_arm_R']).toBeDefined();
      expect(IDLE_POSE['forearm_R']).toBeDefined();
    });

    it('all bone rotations have valid number values', () => {
      function validatePose(pose: Pose, label: string) {
        for (const [bone, rot] of Object.entries(pose)) {
          if (rot.x !== undefined) expect(typeof rot.x).toBe('number');
          if (rot.y !== undefined) expect(typeof rot.y).toBe('number');
          if (rot.z !== undefined) expect(typeof rot.z).toBe('number');
        }
      }

      validatePose(IDLE_POSE, 'idle');
      validatePose(PARRY_POSE, 'parry');
      validatePose(STUNNED_POSE, 'stunned');
      validatePose(HITSTUN_POSE, 'hitstun');

      // Validate all attack animations (FSM v2 #139: 4 directions, 0..3)
      for (const dir of [0, 1, 2, 3]) {
        const anim = getAttackAnimation(dir as Direction);
        validatePose(anim.windup, `attack ${dir} windup`);
        validatePose(anim.release, `attack ${dir} release`);
      }

      // Validate all block poses (FSM v2 #139: same 4 directions)
      for (const dir of [0, 1, 2, 3]) {
        const pose = getBlockPose(dir as Direction);
        validatePose(pose, `block ${dir}`);
      }
    });
  });
});
