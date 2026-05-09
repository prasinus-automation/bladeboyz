import { describe, it, expect } from 'vitest';
import {
  ARC_SWING_PARAMS,
  ARC_SWING_OWNED_BONES,
  computeArcSwingPose,
} from './arcSwing';
import { Direction } from '../combat/directions';

describe('arcSwing', () => {
  describe('ARC_SWING_PARAMS', () => {
    it('has params for all 4 active directions', () => {
      // Direction.Underhand was retired in #131/#139 — only 4 keys here.
      const directions = [
        Direction.Overhead,
        Direction.Left,
        Direction.Right,
        Direction.Stab,
      ];
      for (const dir of directions) {
        expect(ARC_SWING_PARAMS[dir as number]).toBeDefined();
      }
    });

    it('Left and Right are mirrored on the Z axis', () => {
      const left = ARC_SWING_PARAMS[Direction.Left as number];
      const right = ARC_SWING_PARAMS[Direction.Right as number];
      // Z component is mirrored — left's start = -right's start, etc.
      expect(left.shoulderStart.z).toBe(-(right.shoulderStart.z ?? 0));
      expect(left.shoulderEnd.z).toBe(-(right.shoulderEnd.z ?? 0));
    });

    it('Overhead arc rotates the shoulder substantially around X', () => {
      const params = ARC_SWING_PARAMS[Direction.Overhead as number];
      // Start at -2.5, end at +1.0 — total sweep ≈ 3.5 rad (≈ 200°).
      const start = params.shoulderStart.x ?? 0;
      const end = params.shoulderEnd.x ?? 0;
      expect(Math.abs(end - start)).toBeGreaterThan(2.0);
    });
  });

  describe('computeArcSwingPose', () => {
    it('returns the start values at t=0', () => {
      const pose = computeArcSwingPose(Direction.Overhead, 0);
      const params = ARC_SWING_PARAMS[Direction.Overhead as number];
      expect(pose.shoulder_R?.x).toBeCloseTo(params.shoulderStart.x ?? 0, 6);
      expect(pose.forearm_R?.x).toBeCloseTo(params.forearmStart.x ?? 0, 6);
    });

    it('returns the end values at t=1', () => {
      const pose = computeArcSwingPose(Direction.Overhead, 1);
      const params = ARC_SWING_PARAMS[Direction.Overhead as number];
      expect(pose.shoulder_R?.x).toBeCloseTo(params.shoulderEnd.x ?? 0, 6);
      expect(pose.forearm_R?.x).toBeCloseTo(params.forearmEnd.x ?? 0, 6);
    });

    it('returns midpoint values at t=0.5', () => {
      const pose = computeArcSwingPose(Direction.Overhead, 0.5);
      const params = ARC_SWING_PARAMS[Direction.Overhead as number];
      const expectedX =
        ((params.shoulderStart.x ?? 0) + (params.shoulderEnd.x ?? 0)) / 2;
      expect(pose.shoulder_R?.x).toBeCloseTo(expectedX, 6);
    });

    it('clamps t below 0', () => {
      const a = computeArcSwingPose(Direction.Left, -0.5);
      const b = computeArcSwingPose(Direction.Left, 0);
      expect(a.shoulder_R?.z).toBe(b.shoulder_R?.z);
    });

    it('clamps t above 1', () => {
      const a = computeArcSwingPose(Direction.Left, 2);
      const b = computeArcSwingPose(Direction.Left, 1);
      expect(a.shoulder_R?.z).toBe(b.shoulder_R?.z);
    });

    it('always returns shoulder_R, forearm_R, and hand_R', () => {
      for (const dir of [
        Direction.Overhead,
        Direction.Left,
        Direction.Right,
        Direction.Stab,
      ]) {
        const pose = computeArcSwingPose(dir, 0.5);
        expect(pose.shoulder_R).toBeDefined();
        expect(pose.forearm_R).toBeDefined();
        expect(pose.hand_R).toBeDefined();
      }
    });

    it('includes spine for Overhead/Left/Right (chest follow-through)', () => {
      expect(computeArcSwingPose(Direction.Overhead, 0.5).spine).toBeDefined();
      expect(computeArcSwingPose(Direction.Left, 0.5).spine).toBeDefined();
      expect(computeArcSwingPose(Direction.Right, 0.5).spine).toBeDefined();
    });

    it('does NOT include spine for Stab (no follow-through on a thrust)', () => {
      const pose = computeArcSwingPose(Direction.Stab, 0.5);
      expect(pose.spine).toBeUndefined();
    });

    it('falls back to Stab arc for unknown directions', () => {
      const fallback = computeArcSwingPose(99 as Direction, 0.5);
      const stab = computeArcSwingPose(Direction.Stab, 0.5);
      expect(fallback.shoulder_R?.x).toBe(stab.shoulder_R?.x);
      expect(fallback.forearm_R?.x).toBe(stab.forearm_R?.x);
    });

    it('all returned BoneRotation values are finite numbers', () => {
      for (const dir of [
        Direction.Overhead,
        Direction.Left,
        Direction.Right,
        Direction.Stab,
      ]) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const pose = computeArcSwingPose(dir, t);
          for (const bone of Object.values(pose)) {
            for (const axis of ['x', 'y', 'z'] as const) {
              const v = bone[axis];
              if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
            }
          }
        }
      }
    });
  });

  describe('ARC_SWING_OWNED_BONES', () => {
    it('includes shoulder_R, forearm_R, hand_R', () => {
      expect(ARC_SWING_OWNED_BONES.has('shoulder_R')).toBe(true);
      expect(ARC_SWING_OWNED_BONES.has('forearm_R')).toBe(true);
      expect(ARC_SWING_OWNED_BONES.has('hand_R')).toBe(true);
    });

    it('does NOT include left-arm bones', () => {
      expect(ARC_SWING_OWNED_BONES.has('shoulder_L')).toBe(false);
      expect(ARC_SWING_OWNED_BONES.has('forearm_L')).toBe(false);
    });

    it('does NOT include weapon_attach (preserved by per-weapon grip)', () => {
      expect(ARC_SWING_OWNED_BONES.has('weapon_attach')).toBe(false);
    });
  });
});
