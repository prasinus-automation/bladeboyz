import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { addMedievalProps } from './props';
import type { ArenaSpec } from './types';
import type { GameWorld } from '../core/types';

/**
 * Tests for `addMedievalProps()` — map-wide Arena v2 dressing (issue #208).
 *
 * We use a flat (terrain-absent) ArenaSpec so `getGroundHeightAt` returns a
 * constant ground height, and a Rapier mock that captures cuboid colliders so
 * we can assert placement + the collider policy (≥0.4 m tall props get a 1:1
 * collider; thin decorative trim is mesh-only).
 */

interface CapturedBody {
  translation: { x: number; y: number; z: number };
  handle: number;
}
interface CapturedCollider {
  args: number[];
  bodyHandle: number;
}

function createRapierMock() {
  const bodies: CapturedBody[] = [];
  const colliders: CapturedCollider[] = [];
  let nextHandle = 1;
  function makeRigidBodyDesc() {
    const desc: any = {
      translation: { x: 0, y: 0, z: 0 },
      setTranslation(x: number, y: number, z: number) {
        desc.translation = { x, y, z };
        return desc;
      },
    };
    return desc;
  }
  return {
    bodies,
    colliders,
    rapier: {
      RigidBodyDesc: { fixed: () => makeRigidBodyDesc() },
      ColliderDesc: {
        cuboid: (hx: number, hy: number, hz: number) => ({
          shape: 'cuboid' as const,
          args: [hx, hy, hz],
        }),
      },
    } as unknown as GameWorld['rapier'],
    physicsWorld: {
      createRigidBody: vi.fn((desc: any) => {
        const handle = nextHandle++;
        bodies.push({ translation: desc.translation, handle });
        return { handle };
      }),
      createCollider: vi.fn((desc: any, body: any) => {
        colliders.push({ args: desc.args, bodyHandle: body.handle });
        return { handle: nextHandle++ };
      }),
    } as unknown as GameWorld['physicsWorld'],
  };
}

const GROUND = 0.5;

function makeArena(): ArenaSpec {
  return {
    name: 'arena_v2',
    groundHeight: GROUND, // terrain absent → getGroundHeightAt returns this
    bounds: {
      min: { x: -50, y: 0, z: -50 },
      max: { x: 50, y: 30, z: 50 },
    },
    spawnPoints: [],
    shopkeepStall: {
      counter: {
        min: { x: -1.5, y: GROUND, z: 32.75 },
        max: { x: 1.5, y: GROUND + 1, z: 33.25 },
      },
      npcAnchor: { x: 0, y: GROUND + 0.02, z: 34 },
      facing: Math.PI,
    },
    weaponPickupSafeVolume: {
      min: { x: -49.5, y: 0, z: -49.5 },
      max: { x: 49.5, y: 20, z: 49.5 },
    },
  };
}

describe('addMedievalProps (Arena v2 props, #208)', () => {
  let world: GameWorld;
  let rapierMock: ReturnType<typeof createRapierMock>;

  beforeEach(() => {
    rapierMock = createRapierMock();
    world = {
      scene: new THREE.Scene(),
      ecs: {} as GameWorld['ecs'],
      renderer: {} as GameWorld['renderer'],
      rapier: rapierMock.rapier,
      physicsWorld: rapierMock.physicsWorld,
      camera: new THREE.PerspectiveCamera(),
      playerEntity: -1,
    } as GameWorld;
  });

  it('places several collidable props and returns a handle each', () => {
    const handles = addMedievalProps(world, makeArena());
    expect(handles.length).toBeGreaterThanOrEqual(10);
    expect(rapierMock.colliders).toHaveLength(handles.length);
  });

  it('every collidable prop is ≥0.4 m tall (thin trim is mesh-only)', () => {
    addMedievalProps(world, makeArena());
    for (const c of rapierMock.colliders) {
      const fullHeight = c.args[1] * 2; // half-extent → full
      expect(fullHeight).toBeGreaterThanOrEqual(0.4);
    }
  });

  it('rests every collidable prop on the ground (bottom == ground height)', () => {
    addMedievalProps(world, makeArena());
    const bodyById = new Map(rapierMock.bodies.map((b) => [b.handle, b]));
    for (const c of rapierMock.colliders) {
      const b = bodyById.get(c.bodyHandle)!;
      const bottom = b.translation.y - c.args[1];
      expect(bottom).toBeCloseTo(GROUND, 6);
    }
  });

  it('keeps every prop well inside the arena bounds', () => {
    addMedievalProps(world, makeArena());
    const bodyById = new Map(rapierMock.bodies.map((b) => [b.handle, b]));
    for (const c of rapierMock.colliders) {
      const b = bodyById.get(c.bodyHandle)!;
      expect(Math.abs(b.translation.x) + c.args[0]).toBeLessThan(50);
      expect(Math.abs(b.translation.z) + c.args[2]).toBeLessThan(50);
    }
  });

  it('builds the market stall at the shopkeep counter location', () => {
    addMedievalProps(world, makeArena());
    // The counter is the 3 m-wide, 1 m-tall box near the shopkeep anchor.
    const counter = rapierMock.colliders.find(
      (c) =>
        Math.abs(c.args[0] * 2 - 3) < 1e-6 && Math.abs(c.args[1] * 2 - 1) < 1e-6,
    );
    expect(counter).toBeDefined();
    const bodyById = new Map(rapierMock.bodies.map((b) => [b.handle, b]));
    const b = bodyById.get(counter!.bodyHandle)!;
    expect(b.translation.x).toBeCloseTo(0, 6);
    expect(b.translation.z).toBeGreaterThan(30); // gatehouse approach (+Z)
  });
});
