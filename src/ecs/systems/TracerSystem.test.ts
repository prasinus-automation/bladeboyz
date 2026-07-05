import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeSweepQuaternion } from './TracerSystem';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

/** Rotate a fresh copy of `v` by `q` (never mutates inputs). */
function rotated(v: THREE.Vector3, q: THREE.Quaternion): THREE.Vector3 {
  return v.clone().applyQuaternion(q);
}

function dir(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).normalize();
}

describe('computeSweepQuaternion', () => {
  // Directions exercising every branch: horizontal, vertical (±Y),
  // near-vertical, antiparallel, near-antiparallel, and a diagonal.
  const cases: Array<[string, THREE.Vector3]> = [
    ['forward +Z', dir(0, 0, 1)],
    ['horizontal +X', dir(1, 0, 0)],
    ['horizontal -X', dir(-1, 0, 0)],
    ['diagonal (1,0,-1)', dir(1, 0, -1)],
    ['vertical up (0,1,0)', dir(0, 1, 0)],
    ['vertical down (0,-1,0)', dir(0, -1, 0)],
    ['near-vertical (0.01,1,0.01)', dir(0.01, 1, 0.01)],
    ['antiparallel (0,0,-1)', dir(0, 0, -1)],
    ['near-antiparallel (0.001,0,-1)', dir(0.001, 0, -1)],
  ];

  it('rotates (0,0,1) onto sweepDir for every direction (within 1e-6)', () => {
    for (const [name, d] of cases) {
      const q = computeSweepQuaternion(d, new THREE.Quaternion());
      const result = rotated(FORWARD, q);
      expect(result.x, name).toBeCloseTo(d.x, 6);
      expect(result.y, name).toBeCloseTo(d.y, 6);
      expect(result.z, name).toBeCloseTo(d.z, 6);
    }
  });

  it('produces unit-length, NaN-free quaternions for all degenerate cases', () => {
    for (const [name, d] of cases) {
      const q = computeSweepQuaternion(d, new THREE.Quaternion());
      expect(Number.isNaN(q.x), name).toBe(false);
      expect(Number.isNaN(q.y), name).toBe(false);
      expect(Number.isNaN(q.z), name).toBe(false);
      expect(Number.isNaN(q.w), name).toBe(false);
      expect(q.length(), name).toBeCloseTo(1, 6);
    }
  });

  it('is deterministic — identical inputs yield identical components', () => {
    for (const [name, d] of cases) {
      const a = computeSweepQuaternion(d, new THREE.Quaternion());
      const b = computeSweepQuaternion(d, new THREE.Quaternion());
      expect(a.x, name).toBe(b.x);
      expect(a.y, name).toBe(b.y);
      expect(a.z, name).toBe(b.z);
      expect(a.w, name).toBe(b.w);
    }
  });

  it('vertical up uses the WORLD_X-referenced basis (local X → (0,0,1))', () => {
    // For sweepDir=(0,1,0): ref=WORLD_X, xAxis = WORLD_X × zAxis = (0,0,1).
    const q = computeSweepQuaternion(dir(0, 1, 0), new THREE.Quaternion());
    const localX = rotated(new THREE.Vector3(1, 0, 0), q);
    expect(localX.x).toBeCloseTo(0, 6);
    expect(localX.y).toBeCloseTo(0, 6);
    expect(localX.z).toBeCloseTo(1, 6);
  });

  it('vertical down uses the WORLD_X-referenced basis (local X → (0,0,-1))', () => {
    // For sweepDir=(0,-1,0): xAxis = WORLD_X × (0,-1,0) = (0,0,-1).
    const q = computeSweepQuaternion(dir(0, -1, 0), new THREE.Quaternion());
    const localX = rotated(new THREE.Vector3(1, 0, 0), q);
    expect(localX.x).toBeCloseTo(0, 6);
    expect(localX.y).toBeCloseTo(0, 6);
    expect(localX.z).toBeCloseTo(-1, 6);
  });

  it('keeps thickness axis in the up hemisphere for horizontal swings (yAxis·UP > 0)', () => {
    const horizontals: Array<[string, THREE.Vector3]> = [
      ['+X', dir(1, 0, 0)],
      ['-X', dir(-1, 0, 0)],
      ['forward +Z', dir(0, 0, 1)],
      ['diagonal (1,0,-1)', dir(1, 0, -1)],
    ];
    for (const [name, d] of horizontals) {
      const q = computeSweepQuaternion(d, new THREE.Quaternion());
      const localY = rotated(new THREE.Vector3(0, 1, 0), q);
      expect(localY.dot(UP), name).toBeGreaterThan(0);
    }
  });

  it('writes into the provided out quaternion and returns it', () => {
    const out = new THREE.Quaternion();
    const ret = computeSweepQuaternion(dir(1, 0, 0), out);
    expect(ret).toBe(out);
  });

  it('does not mutate the input sweepDir', () => {
    const d = dir(0.01, 1, 0.01);
    const before = d.clone();
    computeSweepQuaternion(d, new THREE.Quaternion());
    expect(d.x).toBe(before.x);
    expect(d.y).toBe(before.y);
    expect(d.z).toBe(before.z);
  });
});
