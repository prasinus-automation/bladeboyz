import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  applyPoseLayer,
  smoothstepEase,
  CROSSFADE_DURATION_SEC,
} from './poseBlending';
import type { Pose } from './AnimationData';

describe('poseBlending', () => {
  describe('CROSSFADE_DURATION_SEC', () => {
    it('matches the legacy 80ms crossfade window', () => {
      expect(CROSSFADE_DURATION_SEC).toBe(0.08);
    });
  });

  describe('smoothstepEase', () => {
    it('returns 0 at t=0', () => {
      expect(smoothstepEase(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(smoothstepEase(1)).toBe(1);
    });

    it('returns 0.5 at t=0.5', () => {
      expect(smoothstepEase(0.5)).toBeCloseTo(0.5, 6);
    });

    it('clamps inputs below 0', () => {
      expect(smoothstepEase(-0.5)).toBe(0);
      expect(smoothstepEase(-1)).toBe(0);
    });

    it('clamps inputs above 1', () => {
      expect(smoothstepEase(1.5)).toBe(1);
      expect(smoothstepEase(2)).toBe(1);
    });

    it('matches the cubic Hermite formula 3t² - 2t³', () => {
      for (const t of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
        const expected = 3 * t * t - 2 * t * t * t;
        expect(smoothstepEase(t)).toBeCloseTo(expected, 6);
      }
    });

    it('is monotonically increasing', () => {
      let prev = -1;
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const v = smoothstepEase(t);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    });
  });

  describe('applyPoseLayer', () => {
    function makeBone(): THREE.Bone {
      return new THREE.Bone();
    }

    it('slerps bone from prev quaternion toward target pose', () => {
      const bone = makeBone();
      bone.name = 'shoulder_R';
      const bones = { shoulder_R: bone };

      // Prev pose snapshot: identity.
      const prev: Record<string, THREE.Quaternion> = {
        shoulder_R: new THREE.Quaternion(),
      };

      // Target pose: 90° X rotation.
      const target: Pose = { shoulder_R: { x: Math.PI / 2 } };

      // At easedT = 0.5, bone should be halfway.
      applyPoseLayer(bones, prev, target, 0.5, new Set(['shoulder_R']));

      const expected = new THREE.Quaternion();
      expected.slerp(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(Math.PI / 2, 0, 0, 'XYZ'),
        ),
        0.5,
      );

      expect(bone.quaternion.x).toBeCloseTo(expected.x, 5);
      expect(bone.quaternion.y).toBeCloseTo(expected.y, 5);
      expect(bone.quaternion.z).toBeCloseTo(expected.z, 5);
      expect(bone.quaternion.w).toBeCloseTo(expected.w, 5);
    });

    it('does NOT slerp from live bone state — uses the snapshot', () => {
      // This is the bug fix from §10.1 of the spec doc. Pre-set the bone
      // to a non-identity rotation. The slerp source must be `prev`,
      // NOT the bone's current quaternion.
      const bone = makeBone();
      const live = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.5, 0.5, 0, 'XYZ'),
      );
      bone.quaternion.copy(live);
      const bones = { shoulder_R: bone };

      // Snapshot is identity (different from live).
      const prev: Record<string, THREE.Quaternion> = {
        shoulder_R: new THREE.Quaternion(),
      };

      // Apply at easedT = 1 — should land EXACTLY on the target, not
      // somewhere between live and target.
      const target: Pose = { shoulder_R: { x: 0.3 } };
      applyPoseLayer(bones, prev, target, 1.0, new Set(['shoulder_R']));

      const expected = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.3, 0, 0, 'XYZ'),
      );
      expect(bone.quaternion.x).toBeCloseTo(expected.x, 5);
      expect(bone.quaternion.y).toBeCloseTo(expected.y, 5);
      expect(bone.quaternion.z).toBeCloseTo(expected.z, 5);
      expect(bone.quaternion.w).toBeCloseTo(expected.w, 5);
    });

    it('lands exactly at target when easedT = 1', () => {
      const bone = makeBone();
      const bones = { shoulder_R: bone };
      const prev = { shoulder_R: new THREE.Quaternion() };
      const target: Pose = { shoulder_R: { z: 0.4 } };

      applyPoseLayer(bones, prev, target, 1.0, new Set(['shoulder_R']));

      const expected = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, 0, 0.4, 'XYZ'),
      );
      expect(bone.quaternion.equals(expected)).toBe(true);
    });

    it('lands exactly at prev snapshot when easedT = 0', () => {
      const bone = makeBone();
      const bones = { shoulder_R: bone };
      const snapshotQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.2, 0, 0, 'XYZ'),
      );
      const prev = { shoulder_R: snapshotQuat.clone() };
      const target: Pose = { shoulder_R: { x: Math.PI / 2 } };

      applyPoseLayer(bones, prev, target, 0.0, new Set(['shoulder_R']));

      expect(bone.quaternion.x).toBeCloseTo(snapshotQuat.x, 5);
      expect(bone.quaternion.y).toBeCloseTo(snapshotQuat.y, 5);
      expect(bone.quaternion.z).toBeCloseTo(snapshotQuat.z, 5);
      expect(bone.quaternion.w).toBeCloseTo(snapshotQuat.w, 5);
    });

    it('slerps owned bones missing from currentPose toward identity', () => {
      const bone = makeBone();
      const bones = { shoulder_R: bone };
      // Prev snapshot is non-identity.
      const snapshotQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(1.0, 0, 0, 'XYZ'),
      );
      const prev = { shoulder_R: snapshotQuat.clone() };
      // currentPose has NO entry for shoulder_R but it IS in the owned set.
      const empty: Pose = {};

      applyPoseLayer(bones, prev, empty, 1.0, new Set(['shoulder_R']));

      // Should land at identity (rest pose).
      expect(bone.quaternion.equals(new THREE.Quaternion())).toBe(true);
    });

    it('does NOT touch bones outside ownedBoneSet', () => {
      const ownedBone = makeBone();
      const offlimitsBone = makeBone();
      const presetQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.7, 0, 0, 'XYZ'),
      );
      offlimitsBone.quaternion.copy(presetQuat);

      const bones = {
        shoulder_R: ownedBone,
        thigh_L: offlimitsBone,
      };
      const prev = {
        shoulder_R: new THREE.Quaternion(),
        thigh_L: new THREE.Quaternion(),
      };
      const target: Pose = {
        shoulder_R: { x: 0.5 },
        thigh_L: { x: 0.5 }, // would write if owned, but it's NOT in the set
      };

      applyPoseLayer(bones, prev, target, 1.0, new Set(['shoulder_R']));

      // shoulder_R was written.
      expect(ownedBone.quaternion.equals(new THREE.Quaternion())).toBe(false);
      // thigh_L kept its preset rotation untouched.
      expect(offlimitsBone.quaternion.equals(presetQuat)).toBe(true);
    });

    it('handles missing prev snapshot entry by treating as identity', () => {
      const bone = makeBone();
      const bones = { shoulder_R: bone };
      // No entry for shoulder_R in prev — should fall back to identity.
      const prev: Record<string, THREE.Quaternion> = {};
      const target: Pose = { shoulder_R: { x: 0.4 } };

      applyPoseLayer(bones, prev, target, 1.0, new Set(['shoulder_R']));

      const expected = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.4, 0, 0, 'XYZ'),
      );
      expect(bone.quaternion.equals(expected)).toBe(true);
    });

    it('skips bones not present in the bones map', () => {
      const bones: Record<string, THREE.Bone> = {};
      const prev = { shoulder_R: new THREE.Quaternion() };
      const target: Pose = { shoulder_R: { x: 0.4 } };

      // Should not throw — the missing bone is silently skipped.
      expect(() =>
        applyPoseLayer(bones, prev, target, 1.0, new Set(['shoulder_R'])),
      ).not.toThrow();
    });

    it('writes multiple bones in a single call', () => {
      const a = makeBone();
      const b = makeBone();
      const bones = { shoulder_R: a, forearm_R: b };
      const prev = {
        shoulder_R: new THREE.Quaternion(),
        forearm_R: new THREE.Quaternion(),
      };
      const target: Pose = {
        shoulder_R: { x: 0.3 },
        forearm_R: { z: 0.2 },
      };
      applyPoseLayer(
        bones,
        prev,
        target,
        1.0,
        new Set(['shoulder_R', 'forearm_R']),
      );

      expect(a.quaternion.equals(new THREE.Quaternion())).toBe(false);
      expect(b.quaternion.equals(new THREE.Quaternion())).toBe(false);
    });
  });
});
