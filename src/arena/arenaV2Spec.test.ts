/**
 * Arena v2 shared-spec tests (issue #207).
 *
 * Two layers:
 *   1. Pure spec — material zones, plateau contract, spawn-table invariants.
 *      No physics.
 *   2. Real-Rapier integration — build the v2 heightfield collider and raycast
 *      down at plateau / hill / open-grass points, asserting the collision
 *      surface matches `sampleTerrainHeight` (a dropped entity rests on the
 *      visible mesh, which is built from the same sampler at the same grid).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { sampleTerrainHeight, createTerrainCollider } from './terrain';
import { GRAVITY, CHARACTER_CONTROLLER_OFFSET } from '../core/types';
import {
  TERRAIN_SPEC_V2,
  sampleTerrainZone,
  ARENA_V2_SPAWNS,
  spawnGroundY,
  BASE_HEIGHT,
  PLATEAU_HALF_EXTENT,
  PLATEAU_SKIRT_FALLOFF,
  PLATEAU_TOP_Y,
  MAP_HALF,
} from './arenaV2Spec';

/* ────────────────────────────────────────────────────────────────────────
 * 1. Material zones (pure)
 * ──────────────────────────────────────────────────────────────────────── */

describe('sampleTerrainZone', () => {
  it('reads STONE across the whole plateau flat top', () => {
    expect(sampleTerrainZone(0, 0)).toBe('stone');
    expect(sampleTerrainZone(18, 18)).toBe('stone'); // flat-top corner
    expect(sampleTerrainZone(-17, 5)).toBe('stone');
  });

  it('reads DIRT on the cardinal paths beyond the plateau', () => {
    expect(sampleTerrainZone(30, 0)).toBe('dirt'); // +X path
    expect(sampleTerrainZone(-30, 0)).toBe('dirt'); // -X path
    expect(sampleTerrainZone(0, 30)).toBe('dirt'); // +Z path
    expect(sampleTerrainZone(0, -30)).toBe('dirt'); // -Z path
  });

  it('reads GRASS in the open field away from plateau and paths', () => {
    expect(sampleTerrainZone(30, 30)).toBe('grass');
    expect(sampleTerrainZone(-40, 20)).toBe('grass');
  });

  it('exposes at least 3 distinct zone colors', () => {
    const zones = new Set([
      sampleTerrainZone(0, 0),
      sampleTerrainZone(30, 0),
      sampleTerrainZone(30, 30),
    ]);
    expect(zones.size).toBe(3);
  });

  it('is deterministic', () => {
    expect(sampleTerrainZone(12.3, -4.7)).toBe(sampleTerrainZone(12.3, -4.7));
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 2. Plateau contract (issue #208 depends on these exact numbers)
 * ──────────────────────────────────────────────────────────────────────── */

describe('central plateau contract', () => {
  it('flat top is 36×36 m (|x|,|z| ≤ 18) at y ≈ 4.0', () => {
    expect(PLATEAU_HALF_EXTENT).toBe(18);
    expect(PLATEAU_TOP_Y).toBeCloseTo(4.0, 6);
    // Sampled height is flat across the entire top.
    expect(sampleTerrainHeight(TERRAIN_SPEC_V2, 0, 0)).toBeCloseTo(4.0, 6);
    expect(sampleTerrainHeight(TERRAIN_SPEC_V2, 17.9, -17.9)).toBeCloseTo(4.0, 6);
  });

  it('skirt falls back to base height by r ≈ 26 (18 + 8)', () => {
    expect(PLATEAU_SKIRT_FALLOFF).toBe(8);
    // Just past the skirt along an axis (|x| = 18 + 8 = 26) → back to base.
    expect(sampleTerrainHeight(TERRAIN_SPEC_V2, 26.01, 0)).toBeCloseTo(
      BASE_HEIGHT,
      5,
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 3. Spawn-table invariants
 * ──────────────────────────────────────────────────────────────────────── */

describe('ARENA_V2_SPAWNS', () => {
  it('has 10 spawns', () => {
    expect(ARENA_V2_SPAWNS).toHaveLength(10);
  });

  it('every spawn is OUTSIDE the plateau footprint (no plateau height contribution)', () => {
    for (const s of ARENA_V2_SPAWNS) {
      const h = sampleTerrainHeight(TERRAIN_SPEC_V2, s.x, s.z);
      // Open, flat terrain: base height only (no plateau, no hill).
      expect(h).toBeCloseTo(BASE_HEIGHT, 6);
    }
  });

  it('every spawn is inside the walls (|x|,|z| < 50)', () => {
    for (const s of ARENA_V2_SPAWNS) {
      expect(Math.abs(s.x)).toBeLessThan(MAP_HALF);
      expect(Math.abs(s.z)).toBeLessThan(MAP_HALF);
    }
  });

  it('every spawn faces the map center (yaw = atan2(-x, -z))', () => {
    for (const s of ARENA_V2_SPAWNS) {
      expect(s.yaw).toBeCloseTo(Math.atan2(-s.x, -s.z), 6);
    }
  });

  it('spawnGroundY resolves to terrain height + offset', () => {
    const { x, z } = ARENA_V2_SPAWNS[0];
    expect(spawnGroundY(x, z, CHARACTER_CONTROLLER_OFFSET)).toBeCloseTo(
      BASE_HEIGHT + CHARACTER_CONTROLLER_OFFSET,
      6,
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 4. Heightfield ↔ sampler parity on the REAL v2 spec (real Rapier)
 * ──────────────────────────────────────────────────────────────────────── */

describe('Arena v2 heightfield ↔ visible-surface parity (real Rapier)', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('raycast-down rests on the sampled surface at plateau / hill / grass points', () => {
    const physicsWorld = new RAPIER.World(new RAPIER.Vector3(0, GRAVITY, 0));
    createTerrainCollider({ rapier: RAPIER, physicsWorld }, TERRAIN_SPEC_V2);
    physicsWorld.step();

    // Mid-cell offsets (cells ≈ 0.78 m): a strictly vertical heightfield
    // raycast that lands exactly on a cell vertex/edge can miss — cast through
    // cell interiors (the #206 gotcha).
    const points: Array<[number, number]> = [
      [0.31, 0.29], // plateau top (~4.0)
      [39.13, 0.27], // +X dirt path, open (~0.5)
      [0.19, 45.71], // near a hill peak (~6.x)
      [-30.37, 25.13], // open grass (~0.5)
      [12.41, 37.19], // at a spawn ring point (~0.5)
    ];

    const CAST_Y = 40;
    for (const [x, z] of points) {
      const ray = new RAPIER.Ray(
        new RAPIER.Vector3(x, CAST_Y, z),
        new RAPIER.Vector3(0, -1, 0),
      );
      const hit = physicsWorld.castRay(ray, 80, true);
      expect(hit).not.toBeNull();
      const hitY = CAST_Y - hit!.timeOfImpact;
      const expected = sampleTerrainHeight(TERRAIN_SPEC_V2, x, z);
      expect(Math.abs(hitY - expected)).toBeLessThan(0.05);
    }
  });
});
