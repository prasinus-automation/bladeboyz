/**
 * Orientation regression tests (#219).
 *
 * The third-person character was authored facing +Z (back-to-front), with
 * the sword hanging toward the camera at yaw=0. Root cause: `Rx(θ)·(0,-1,0)
 * = (0,-cosθ,-sinθ)`, so a POSITIVE X rotation swings a -Y-hanging limb
 * toward world-forward (-Z) — but several keyframe poses and the toe
 * geometry were authored to the opposite (wrong) claim.
 *
 * These tests assert direction using REAL three.js world transforms (build
 * the model, apply the pose, `updateWorldMatrix`, read world-Z) rather than
 * re-deriving the pose formula — the lesson from #212, where a
 * formula-vs-formula test tautologically "passed" while the character
 * rendered backwards for weeks.
 *
 * Convention under test: at `group.rotation.y = 0` the character faces -Z
 * (away from the camera), so a correctly-authored forward guard/blade
 * resolves the right hand + `weapon_attach` to **world-z < 0**.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCharacterModel } from '../rendering/CharacterModel';
import {
  IDLE_POSE,
  PARRY_POSE,
  HITSTUN_POSE,
  STUNNED_POSE,
  getAttackAnimation,
  getBlockPose,
  type Pose,
} from './AnimationData';
import { computeArcSwingPose } from './arcSwing';
import { Direction } from '../combat/directions';

/** Apply a Pose to a fresh model and return the world-Z of `boneName`. */
function boneWorldZ(pose: Pose, boneName: string, yaw = 0): number {
  const { group, bones } = createCharacterModel();
  group.rotation.y = yaw;
  // Reset every bone, then apply the pose's Euler deltas (XYZ) — this
  // mirrors what `applyPoseLayer` does when fully blended (easedT = 1).
  for (const b of Object.values(bones)) b.quaternion.identity();
  for (const [name, rot] of Object.entries(pose)) {
    const b = bones[name];
    if (!b) continue;
    b.quaternion.setFromEuler(
      new THREE.Euler(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0, 'XYZ'),
    );
  }
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  bones[boneName].getWorldPosition(v);
  return v.z;
}

describe('character facing convention (#219)', () => {
  describe('idle guard — sword in front, not at the camera', () => {
    it('resolves hand_R to the forward (-Z) hemisphere at yaw=0', () => {
      expect(boneWorldZ(IDLE_POSE, 'hand_R')).toBeLessThan(0);
    });

    it('resolves weapon_attach to the forward (-Z) hemisphere at yaw=0', () => {
      // This is the "floating sword pointing at the camera" acceptance:
      // the weapon grip point must be in front of the character.
      expect(boneWorldZ(IDLE_POSE, 'weapon_attach')).toBeLessThan(0);
    });

    it('follows body yaw — facing +Z (yaw=π) puts the guard toward +Z', () => {
      // Sanity that the pose is body-relative, not world-hardcoded: rotate
      // the character 180° and the forward guard swings to the +Z side.
      expect(boneWorldZ(IDLE_POSE, 'weapon_attach', Math.PI)).toBeGreaterThan(0);
    });
  });

  describe('block poses read on the forward side', () => {
    it('Overhead block: hand_R is forward (-Z) — corrected in #219', () => {
      expect(boneWorldZ(getBlockPose(Direction.Overhead), 'hand_R')).toBeLessThan(0);
    });

    // Left/Right/Stab were already corrected for -Z in #139; pin them so a
    // future blanket-negate can't regress them back into +Z.
    it('Left block forearm_R is forward (-Z)', () => {
      expect(boneWorldZ(getBlockPose(Direction.Left), 'forearm_R')).toBeLessThan(0);
    });

    it('Right block forearm_R is forward (-Z)', () => {
      expect(boneWorldZ(getBlockPose(Direction.Right), 'forearm_R')).toBeLessThan(0);
    });

    it('Stab block forearm_R is forward (-Z)', () => {
      expect(boneWorldZ(getBlockPose(Direction.Stab), 'forearm_R')).toBeLessThan(0);
    });
  });

  describe('parry / hitstun / stunned', () => {
    it('parry blade-catch is forward (-Z) — corrected in #219', () => {
      expect(boneWorldZ(PARRY_POSE, 'hand_R')).toBeLessThan(0);
    });

    it('hitstun flinch guard stays forward (-Z) — NOT flipped', () => {
      expect(boneWorldZ(HITSTUN_POSE, 'hand_R')).toBeLessThan(0);
    });

    it('stunned guard stays forward (-Z) — NOT flipped', () => {
      expect(boneWorldZ(STUNNED_POSE, 'hand_R')).toBeLessThan(0);
    });
  });

  describe('attack windups preserve arc-swing continuity (NOT flipped)', () => {
    // The windup keyframe must chamber on the SAME hemisphere the arc-swing
    // Release begins in, or the windup→Release crossfade pops. We compare
    // signs of hand_R world-z rather than pinning magnitudes.
    const arcStartZ = (d: Direction) => boneWorldZ(computeArcSwingPose(d, 0), 'hand_R');

    it('Overhead windup starts forward (-Z), matching the arc start', () => {
      expect(boneWorldZ(getAttackAnimation(Direction.Overhead).windup, 'hand_R')).toBeLessThan(0);
      expect(arcStartZ(Direction.Overhead)).toBeLessThan(0);
    });

    it('Left windup chambers on the same lateral side as the arc start', () => {
      const windup = boneWorldZ(getAttackAnimation(Direction.Left).windup, 'hand_R');
      expect(Math.sign(windup)).toBe(Math.sign(arcStartZ(Direction.Left)));
    });

    it('Right windup chambers on the same lateral side as the arc start', () => {
      const windup = boneWorldZ(getAttackAnimation(Direction.Right).windup, 'hand_R');
      expect(Math.sign(windup)).toBe(Math.sign(arcStartZ(Direction.Right)));
    });

    it('Stab windup chambers BACK (+Z) and the arc thrusts FORWARD (-Z)', () => {
      // Intentional hemisphere change: the stab pulls the hand back to the
      // hip (windup, +Z) then extends forward (Release arc, -Z). The
      // crossfade IS the thrust — this is not a mirroring bug.
      expect(boneWorldZ(getAttackAnimation(Direction.Stab).windup, 'hand_R')).toBeGreaterThan(0);
      expect(arcStartZ(Direction.Stab)).toBeLessThan(0);
    });
  });

  describe('foot geometry points toes forward (-Z)', () => {
    it('both foot meshes are offset toward -Z', () => {
      const { group } = createCharacterModel();
      group.updateMatrixWorld(true);
      // Feet are the only parts with a non-trivial local z geometry offset
      // (all other body boxes are centered at z=0). Collect meshes whose
      // geometry bounding-box centre has |z| above a small threshold.
      const footCenterZs: number[] = [];
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        mesh.geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        mesh.geometry.boundingBox!.getCenter(center);
        if (Math.abs(center.z) > 0.02) footCenterZs.push(center.z);
      });
      expect(footCenterZs.length).toBe(2); // left + right foot
      for (const z of footCenterZs) expect(z).toBeLessThan(0);
    });
  });
});
