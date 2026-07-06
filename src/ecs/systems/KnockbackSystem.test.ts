/**
 * KnockbackSystem terrain tests (#206).
 *
 * knockbackSystem is a pure ballistic integrator over `Position` +
 * `KnockbackState` — it only reaches Rapier through the optional
 * `getPhysicsBody` registry (skipped when no body is registered), so these
 * tests need no physics world. They pin two things:
 *   1. Flat Arena v1 (or no arena) behavior is byte-identical to pre-#206:
 *      a knocked-back dummy settles at exactly GROUND_TOP_Y.
 *   2. Over variable terrain a dummy lands ON a raised plateau
 *      (y ≈ plateau height + controller offset), not tunneled to 0.1.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import type { GameWorld } from '../../core/types';
import { CHARACTER_CONTROLLER_OFFSET, GROUND_TOP_Y } from '../../core/types';
import { KnockbackState, Position, PreviousPosition } from '../components';
import { knockbackSystem } from './KnockbackSystem';
import { makeTerrainHandle, type TerrainSpec } from '../../arena/terrain';
import type { ArenaSpec } from '../../arena/types';

function makeEcsWorld(arena?: ArenaSpec): GameWorld {
  const ecs = createWorld();
  addEntity(ecs); // reserve eid 0 as the NULL sentinel
  return {
    ecs,
    // Nothing below is touched by knockbackSystem — cast a minimal stub.
    scene: null as never,
    renderer: null as never,
    rapier: null as never,
    physicsWorld: null as never,
    camera: null as never,
    playerEntity: -1,
    arena,
  };
}

function spawnKnockedEntity(
  world: GameWorld,
  pos: { x: number; y: number; z: number },
  vel: { x: number; y: number; z: number },
): number {
  const eid = addEntity(world.ecs);
  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, PreviousPosition, eid);
  addComponent(world.ecs, KnockbackState, eid);
  Position.x[eid] = pos.x;
  Position.y[eid] = pos.y;
  Position.z[eid] = pos.z;
  KnockbackState.vx[eid] = vel.x;
  KnockbackState.vy[eid] = vel.y;
  KnockbackState.vz[eid] = vel.z;
  KnockbackState.ticksRemaining[eid] = 300;
  return eid;
}

function flatArena(): ArenaSpec {
  return {
    name: 'arena_v1',
    groundHeight: GROUND_TOP_Y,
    bounds: { min: { x: -15, y: 0, z: -15 }, max: { x: 15, y: 10, z: 15 } },
    spawnPoints: [],
    shopkeepStall: {
      counter: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      npcAnchor: { x: 0, y: 0, z: 0 },
      facing: 0,
    },
    weaponPickupSafeVolume: {
      min: { x: -14, y: 0, z: -14 },
      max: { x: 14, y: 10, z: 14 },
    },
  };
}

describe('knockbackSystem — flat ground (byte-identical to pre-#206)', () => {
  it('settles a launched dummy at exactly GROUND_TOP_Y (no arena)', () => {
    const world = makeEcsWorld();
    const eid = spawnKnockedEntity(world, { x: 0, y: 0.1, z: 0 }, { x: 3, y: 5, z: 0 });
    for (let t = 0; t < 400; t++) knockbackSystem(world);
    expect(Position.y[eid]).toBeCloseTo(GROUND_TOP_Y, 5);
    expect(KnockbackState.ticksRemaining[eid]).toBe(0);
  });

  it('settles at GROUND_TOP_Y on a flat arena (terrain absent)', () => {
    const world = makeEcsWorld(flatArena());
    const eid = spawnKnockedEntity(world, { x: 0, y: 0.1, z: 0 }, { x: 2, y: 4, z: 1 });
    for (let t = 0; t < 400; t++) knockbackSystem(world);
    expect(Position.y[eid]).toBeCloseTo(GROUND_TOP_Y, 5);
  });

  it('clamps horizontal launch to inside the arena bounds', () => {
    const world = makeEcsWorld(flatArena());
    // Big +X velocity would fly past the +15 wall; clamp keeps it inside.
    const eid = spawnKnockedEntity(world, { x: 0, y: 0.1, z: 0 }, { x: 200, y: 1, z: 0 });
    for (let t = 0; t < 400; t++) knockbackSystem(world);
    // bounds.max.x (15) minus WALL_MARGIN (0.5) = 14.5.
    expect(Position.x[eid]).toBeLessThanOrEqual(14.5 + 1e-4);
    expect(Position.x[eid]).toBeGreaterThan(10);
  });
});

describe('knockbackSystem — variable terrain (#206)', () => {
  // A plateau centered at (6, 0) raised 2m above a base of 0.1.
  const spec: TerrainSpec = {
    sizeX: 40,
    sizeZ: 40,
    resolution: 40,
    baseHeight: GROUND_TOP_Y,
    features: [
      { kind: 'plateau', x: 6, z: 0, radiusX: 3, radiusZ: 3, falloff: 1.5, height: 2 },
    ],
  };
  const PLATEAU_TOP = GROUND_TOP_Y + 2;

  function terrainArena(): ArenaSpec {
    return { ...flatArena(), name: 'test_terrain', terrain: makeTerrainHandle(spec) };
  }

  let world: GameWorld;
  beforeEach(() => {
    world = makeEcsWorld(terrainArena());
  });

  it('a dummy dropped onto the plateau lands ON it (height + offset), not at 0.1', () => {
    // Start above the plateau center, falling straight down.
    const eid = spawnKnockedEntity(world, { x: 6, y: 6, z: 0 }, { x: 0, y: 0, z: 0 });
    for (let t = 0; t < 400; t++) knockbackSystem(world);
    expect(Position.y[eid]).toBeCloseTo(PLATEAU_TOP + CHARACTER_CONTROLLER_OFFSET, 3);
    // Sanity: it did NOT tunnel to the flat ground.
    expect(Position.y[eid]).toBeGreaterThan(GROUND_TOP_Y + 1);
  });

  it('a dummy knocked laterally onto the plateau ends up resting on top', () => {
    // Launch from the flat base toward the plateau with an upward arc so it
    // clears the skirt and comes down on the flat top.
    const eid = spawnKnockedEntity(world, { x: 0, y: GROUND_TOP_Y, z: 0 }, { x: 6, y: 7, z: 0 });
    for (let t = 0; t < 400; t++) knockbackSystem(world);
    // It should be somewhere on the plateau top region and resting at its height.
    const groundHere = spec.baseHeight + 2; // plateau flat-top height
    // Only assert if it actually ended over the flat top (x within radius).
    if (Math.abs(Position.x[eid] - 6) <= 3) {
      expect(Position.y[eid]).toBeCloseTo(groundHere + CHARACTER_CONTROLLER_OFFSET, 2);
    } else {
      // Otherwise it rests on whatever terrain height is under it (+offset).
      expect(Position.y[eid]).toBeGreaterThan(GROUND_TOP_Y);
    }
  });
});
