import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { createCharacterModel, createLongswordModel } from './CharacterModel';

describe('createCharacterModel', () => {
  it('returns group, skeleton, and bones', () => {
    const result = createCharacterModel();
    expect(result.group).toBeDefined();
    expect(result.skeleton).toBeDefined();
    expect(result.bones).toBeDefined();
  });

  it('has all required bones', () => {
    const { bones } = createCharacterModel();
    const requiredBones = [
      'root',
      'spine',
      'chest',
      'neck',
      'head',
      'shoulder_L',
      'shoulder_R',
      'upper_arm_L',
      'upper_arm_R',
      'forearm_L',
      'forearm_R',
      'hand_L',
      'hand_R',
      'thigh_L',
      'thigh_R',
      'shin_L',
      'shin_R',
      'foot_L',
      'foot_R',
      'weapon_attach',
    ];
    for (const name of requiredBones) {
      expect(bones[name], `Missing bone: ${name}`).toBeDefined();
    }
  });

  it('accepts a custom color', () => {
    const result = createCharacterModel(0xff0000);
    expect(result.group).toBeDefined();
    // Model should be created without errors with custom color
  });

  it('skeleton has correct number of bones', () => {
    const { skeleton, bones } = createCharacterModel();
    expect(skeleton.bones.length).toBe(Object.keys(bones).length);
  });

  it('weapon_attach bone is a child of hand_R', () => {
    const { bones } = createCharacterModel();
    expect(bones['weapon_attach'].parent).toBe(bones['hand_R']);
  });

  it('character is roughly 1.8 units tall', () => {
    const { group } = createCharacterModel();
    // Update matrices so bounding box is accurate
    group.updateMatrixWorld(true);

    // The root bone positions give us the overall height
    // Head top should be ~1.8, feet at ~0
    // We check via the bone positions
    const { bones } = createCharacterModel();
    const headBone = bones['head'];
    const footBone = bones['foot_L'];

    // Compute approximate positions by traversing bone chain
    let headY = 0;
    let current: THREE.Object3D | null = headBone;
    while (current && current !== bones['root']) {
      headY += current.position.y;
      current = current.parent;
    }

    // Head bone + head size should be ~1.8
    // Allow reasonable tolerance (±0.3)
    expect(headY).toBeGreaterThan(1.2);
    expect(headY).toBeLessThan(2.1);
  });
});

describe('createLongswordModel', () => {
  it('returns group and tracer points', () => {
    const result = createLongswordModel();
    expect(result.group).toBeDefined();
    expect(result.tracerPoints).toBeDefined();
  });

  it('has at least 4 tracer points', () => {
    const { tracerPoints } = createLongswordModel();
    expect(tracerPoints.length).toBeGreaterThanOrEqual(4);
  });

  it('tracer points are ordered base to tip (increasing Y)', () => {
    const { tracerPoints } = createLongswordModel();
    for (let i = 1; i < tracerPoints.length; i++) {
      expect(tracerPoints[i].y).toBeGreaterThan(tracerPoints[i - 1].y);
    }
  });

  it('sword group has 3 children (grip, guard, blade)', () => {
    const { group } = createLongswordModel();
    expect(group.children.length).toBe(3);
  });
});
