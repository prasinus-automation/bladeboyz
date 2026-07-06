/**
 * Terrain engine tests (#206).
 *
 * Three layers:
 *   1. Pure sampler — determinism, bounds clamping, feature composition.
 *      No physics needed.
 *   2. Heightfield ↔ sampler PARITY — real Rapier: raycast down at 20+ points
 *      over a non-trivial spec (1 plateau + 2 hills) and assert the collider
 *      surface matches `sampleTerrainHeight` within 0.05m. This pins the
 *      Rapier column-major / row↔col orientation convention (the AGENTS "do
 *      not trust intuition" gotcha).
 *   3. Character controller on a SLOPE — real Rapier: a kinematic capsule
 *      climbs a ≤45° ramp and is blocked by a >45° wall.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  sampleTerrainHeight,
  buildTerrainHeights,
  createTerrainCollider,
  makeTerrainHandle,
  type TerrainSpec,
} from './terrain';
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CHARACTER_CONTROLLER_OFFSET,
  MAX_SLOPE_CLIMB_ANGLE,
  MIN_SLOPE_SLIDE_ANGLE,
  AUTOSTEP_MAX_HEIGHT,
  AUTOSTEP_MIN_WIDTH,
  SNAP_TO_GROUND_DISTANCE,
  FIXED_TIMESTEP,
  GRAVITY,
} from '../core/types';

/* ────────────────────────────────────────────────────────────────────────
 * 1. Pure sampler
 * ──────────────────────────────────────────────────────────────────────── */

describe('sampleTerrainHeight (pure)', () => {
  const spec: TerrainSpec = {
    sizeX: 40,
    sizeZ: 40,
    resolution: 40,
    baseHeight: 0.5,
    features: [
      { kind: 'plateau', x: -8, z: 6, radiusX: 4, radiusZ: 3, falloff: 3, height: 3 },
      { kind: 'hill', x: 10, z: -8, radius: 6, height: 2.5 },
      { kind: 'hill', x: 4, z: 10, radius: 4, height: 1.5 },
    ],
  };

  it('is deterministic: same (spec, x, z) → same output', () => {
    for (const [x, z] of [[0, 0], [-8, 6], [10, -8], [3.3, -1.7], [19, -19]]) {
      const a = sampleTerrainHeight(spec, x, z);
      const b = sampleTerrainHeight(spec, x, z);
      expect(a).toBe(b);
    }
  });

  it('returns base height in flat regions away from all features', () => {
    // (18, 18) corner is far from every feature footprint.
    expect(sampleTerrainHeight(spec, 18, 18)).toBeCloseTo(0.5, 6);
  });

  it('plateau flat top reads base + plateau height', () => {
    // Center of the plateau — inside the flat top.
    expect(sampleTerrainHeight(spec, -8, 6)).toBeCloseTo(0.5 + 3, 6);
    // Still inside the flat-top rectangle (|dx|≤radiusX, |dz|≤radiusZ).
    expect(sampleTerrainHeight(spec, -8 + 3.9, 6 + 2.9)).toBeCloseTo(0.5 + 3, 6);
  });

  it('hill peak reads base + hill height and decays to base at the rim', () => {
    expect(sampleTerrainHeight(spec, 10, -8)).toBeCloseTo(0.5 + 2.5, 6);
    // Just outside the radius → back to base.
    expect(sampleTerrainHeight(spec, 10 + 6.001, -8)).toBeCloseTo(0.5, 5);
  });

  it('clamps outside the terrain rectangle to the edge height (no NaN/extrapolation)', () => {
    const halfX = spec.sizeX / 2;
    const edge = sampleTerrainHeight(spec, halfX, 5);
    const beyond = sampleTerrainHeight(spec, halfX + 100, 5);
    expect(Number.isFinite(beyond)).toBe(true);
    expect(beyond).toBe(edge);
  });

  it('plateau with falloff:0 is a vertical wall (full height on top, base just outside)', () => {
    const wallSpec: TerrainSpec = {
      sizeX: 20,
      sizeZ: 20,
      resolution: 20,
      baseHeight: 0.1,
      features: [
        { kind: 'plateau', x: 0, z: 0, radiusX: 2, radiusZ: 2, falloff: 0, height: 3 },
      ],
    };
    // On the flat top (inside the rectangle) → full height.
    expect(sampleTerrainHeight(wallSpec, 0, 0)).toBeCloseTo(0.1 + 3, 6);
    expect(sampleTerrainHeight(wallSpec, 2, 2)).toBeCloseTo(0.1 + 3, 6);
    // Just outside the rectangle → drops straight to base (vertical wall).
    expect(sampleTerrainHeight(wallSpec, 2.0001, 0)).toBeCloseTo(0.1, 6);
  });

  it('features overlap additively', () => {
    // A spec where a hill and a plateau overlap at a point.
    const overlap: TerrainSpec = {
      sizeX: 20,
      sizeZ: 20,
      resolution: 20,
      baseHeight: 1,
      features: [
        { kind: 'plateau', x: 0, z: 0, radiusX: 2, radiusZ: 2, falloff: 1, height: 2 },
        { kind: 'hill', x: 0, z: 0, radius: 5, height: 3 },
      ],
    };
    // At the shared center: base + plateau(full) + hill(peak) = 1 + 2 + 3.
    expect(sampleTerrainHeight(overlap, 0, 0)).toBeCloseTo(6, 6);
  });

  it('ramp rises linearly along its axis and is flat outside the corridor', () => {
    const rampSpec: TerrainSpec = {
      sizeX: 20,
      sizeZ: 20,
      resolution: 20,
      baseHeight: 0,
      features: [
        { kind: 'ramp', x: 0, z: 0, dirX: 1, dirZ: 0, length: 8, halfWidth: 2, height: 4 },
      ],
    };
    expect(sampleTerrainHeight(rampSpec, -4, 0)).toBeCloseTo(0, 6); // bottom
    expect(sampleTerrainHeight(rampSpec, 0, 0)).toBeCloseTo(2, 6); // midpoint
    expect(sampleTerrainHeight(rampSpec, 4, 0)).toBeCloseTo(4, 6); // top
    expect(sampleTerrainHeight(rampSpec, 8, 0)).toBeCloseTo(4, 6); // flat past top
    expect(sampleTerrainHeight(rampSpec, 0, 5)).toBeCloseTo(0, 6); // outside corridor
  });
});

describe('buildTerrainHeights', () => {
  const spec: TerrainSpec = {
    sizeX: 20,
    sizeZ: 20,
    resolution: 4,
    baseHeight: 0.5,
    features: [{ kind: 'hill', x: 0, z: 0, radius: 8, height: 2 }],
  };

  it('has (resolution+1)² entries', () => {
    const h = buildTerrainHeights(spec);
    expect(h.length).toBe((spec.resolution + 1) * (spec.resolution + 1));
  });

  it('vertex (row i, col j) at column-major index equals sampleTerrainHeight at that (x,z)', () => {
    const h = buildTerrainHeights(spec);
    const n = spec.resolution + 1;
    for (let j = 0; j < n; j++) {
      const x = (j / spec.resolution - 0.5) * spec.sizeX;
      for (let i = 0; i < n; i++) {
        const z = (i / spec.resolution - 0.5) * spec.sizeZ;
        expect(h[j * n + i]).toBeCloseTo(sampleTerrainHeight(spec, x, z), 5);
      }
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 2 + 3. Real-Rapier tests
 * ──────────────────────────────────────────────────────────────────────── */

let rapierReady = false;
beforeAll(async () => {
  if (!rapierReady) {
    await RAPIER.init();
    rapierReady = true;
  }
});

function makeWorld() {
  const physicsWorld = new RAPIER.World(new RAPIER.Vector3(0, GRAVITY, 0));
  return { rapier: RAPIER, physicsWorld };
}

describe('heightfield ↔ sampler parity (real Rapier)', () => {
  const spec: TerrainSpec = {
    sizeX: 40,
    sizeZ: 40,
    // 0.25m cells. Fine enough that linear-interp error (heightfield surface
    // is piecewise-linear between vertices; sampleTerrainHeight is analytic)
    // stays well under 0.05m even on the steep hill flanks (observed ≈0.012m).
    resolution: 160,
    baseHeight: 0.5,
    features: [
      { kind: 'plateau', x: -8, z: 6, radiusX: 4, radiusZ: 3, falloff: 3, height: 3 },
      { kind: 'hill', x: 10, z: -8, radius: 6, height: 2.5 },
      { kind: 'hill', x: 4, z: 10, radius: 4, height: 1.5 },
    ],
  };

  it('raycast-down at 20+ points matches sampleTerrainHeight within 0.05m', () => {
    const world = makeWorld();
    createTerrainCollider(world, spec);
    world.physicsWorld.step();

    // Asymmetric grid — a transposed/mirrored heightfield fails off-axis (the
    // plateau at (-8,6) and hills at (10,-8)/(4,10) are all distinct). Points
    // are deliberately MID-CELL (offset in eighths of a meter): a strictly
    // vertical Rapier heightfield raycast that lands exactly on a cell
    // vertex/edge can miss the surface — casting through cell interiors is the
    // reliable path. That's a raycast-precision quirk, not a geometry bug (the
    // controller-vs-slope tests below confirm the surface is solid).
    const xs = [-15.875, -8.125, -3.625, 0.375, 4.375, 9.875, 13.625];
    const zs = [-13.625, -7.875, -2.375, 0.625, 6.125, 10.875];
    const points: Array<[number, number]> = [];
    for (const x of xs) for (const z of zs) points.push([x, z]);
    expect(points.length).toBeGreaterThanOrEqual(20);

    const CAST_Y = 20;
    let checked = 0;
    for (const [x, z] of points) {
      const ray = new RAPIER.Ray(
        new RAPIER.Vector3(x, CAST_Y, z),
        new RAPIER.Vector3(0, -1, 0),
      );
      const hit = world.physicsWorld.castRay(ray, 40, true);
      expect(hit).not.toBeNull();
      const hitY = CAST_Y - hit!.timeOfImpact;
      const expected = sampleTerrainHeight(spec, x, z);
      expect(Math.abs(hitY - expected)).toBeLessThan(0.05);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  it('makeTerrainHandle.sample matches sampleTerrainHeight', () => {
    const handle = makeTerrainHandle(spec);
    expect(handle.sample(-8, 6)).toBe(sampleTerrainHeight(spec, -8, 6));
    expect(handle.spec).toBe(spec);
  });
});

describe('character controller on a heightfield slope (real Rapier)', () => {
  /**
   * Drive a kinematic capsule forward along +X for `ticks` and return how far
   * up it climbed. Mirrors MovementSystem's controller config (offset,
   * autostep, slope angles, snap-to-ground). `spec` is the ground terrain.
   */
  function climbRun(
    spec: TerrainSpec,
    startX: number,
    ticks: number,
  ): { startY: number; endY: number; endX: number } {
    const world = makeWorld();
    createTerrainCollider(world, spec);

    const startY = sampleTerrainHeight(spec, startX, 0) + CHARACTER_CONTROLLER_OFFSET;
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      startX,
      startY,
      0,
    );
    const body = world.physicsWorld.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.capsule(
      CAPSULE_HALF_HEIGHT,
      CAPSULE_RADIUS,
    ).setTranslation(0, CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT, 0);
    const collider = world.physicsWorld.createCollider(colliderDesc, body);

    const controller = world.physicsWorld.createCharacterController(
      CHARACTER_CONTROLLER_OFFSET,
    );
    controller.enableAutostep(AUTOSTEP_MAX_HEIGHT, AUTOSTEP_MIN_WIDTH, true);
    controller.enableSnapToGround(SNAP_TO_GROUND_DISTANCE);
    controller.setMaxSlopeClimbAngle(MAX_SLOPE_CLIMB_ANGLE);
    controller.setMinSlopeSlideAngle(MIN_SLOPE_SLIDE_ANGLE);

    const WALK = 4.0; // m/s forward
    for (let t = 0; t < ticks; t++) {
      const desired = {
        x: WALK * FIXED_TIMESTEP,
        y: GRAVITY * FIXED_TIMESTEP * FIXED_TIMESTEP, // small downward pull
        z: 0,
      };
      controller.computeColliderMovement(collider, desired);
      const mv = controller.computedMovement();
      const p = body.translation();
      const next = { x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z };
      body.setNextKinematicTranslation(next);
      world.physicsWorld.step();
    }
    const end = body.translation();
    return { startY, endY: end.y, endX: end.x };
  }

  it('climbs a ≤45° ramp (feet rise as it walks up)', () => {
    // dir +X, length 10, height 6 → atan(6/10) ≈ 31° < 45°.
    const spec: TerrainSpec = {
      sizeX: 40,
      sizeZ: 40,
      resolution: 80,
      baseHeight: 0,
      features: [
        { kind: 'ramp', x: 0, z: 0, dirX: 1, dirZ: 0, length: 10, halfWidth: 4, height: 6 },
      ],
    };
    const { startY, endY, endX } = climbRun(spec, -5, 200);
    // It advanced up the ramp and gained height.
    expect(endX).toBeGreaterThan(-4);
    expect(endY).toBeGreaterThan(startY + 0.5);
  });

  it('is blocked by a >45° wall (does not climb the steep face)', () => {
    // dir +X, length 2, height 6 → atan(6/2) ≈ 72° > 45°: a near-wall.
    const spec: TerrainSpec = {
      sizeX: 40,
      sizeZ: 40,
      resolution: 120,
      baseHeight: 0,
      features: [
        { kind: 'ramp', x: 0, z: 0, dirX: 1, dirZ: 0, length: 2, halfWidth: 4, height: 6 },
      ],
    };
    // Start just before the steep face (ramp base at x=-1).
    const { startY, endY } = climbRun(spec, -3, 200);
    // The slide threshold stops it well short of the 6m top.
    expect(endY).toBeLessThan(startY + 3);
  });
});
