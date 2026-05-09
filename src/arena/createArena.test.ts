import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { createArena } from './createArena';
import {
  spawnPointRegistry,
  clearSpawnPoints,
  registerSpawnPoint,
} from '../world/SpawnPoints';
import type { GameWorld } from '../core/types';

/**
 * Tests for `createArena()` — Arena v1 (issues #91 / #112).
 *
 * Two surfaces under test:
 *   1. The lighting rig (issue #117 — already shipped, not regressed).
 *   2. The 9 static props, 6 spawn points, ArenaSpec shape (#112).
 *
 * The Rapier mock captures every `RigidBodyDesc.fixed()` /
 * `ColliderDesc.cuboid()` call so we can pin extents per the design doc
 * inventory table without spinning up a real WASM physics world.
 */

interface CapturedBody {
  type: 'fixed';
  translation: { x: number; y: number; z: number };
  handle: number;
}
interface CapturedCollider {
  shape: 'cuboid';
  args: number[]; // [hx, hy, hz]
  bodyHandle: number;
  handle: number;
}

function createRapierMock() {
  const bodies: CapturedBody[] = [];
  const colliders: CapturedCollider[] = [];
  let nextHandle = 1;

  function makeRigidBodyDesc(type: 'fixed') {
    const desc: any = {
      type,
      translation: { x: 0, y: 0, z: 0 },
      setTranslation(x: number, y: number, z: number) {
        desc.translation = { x, y, z };
        return desc;
      },
    };
    return desc;
  }

  function makeColliderDesc(shape: 'cuboid', args: number[]): any {
    return { shape, args };
  }

  return {
    bodies,
    colliders,
    rapier: {
      RigidBodyDesc: {
        fixed: () => makeRigidBodyDesc('fixed'),
      },
      ColliderDesc: {
        cuboid: (hx: number, hy: number, hz: number) =>
          makeColliderDesc('cuboid', [hx, hy, hz]),
      },
    } as unknown as GameWorld['rapier'],
    physicsWorld: {
      createRigidBody: vi.fn((desc: any) => {
        const handle = nextHandle++;
        bodies.push({
          type: desc.type,
          translation: desc.translation,
          handle,
        });
        return { handle };
      }),
      createCollider: vi.fn((desc: any, body: any) => {
        const handle = nextHandle++;
        colliders.push({
          shape: desc.shape,
          args: desc.args,
          bodyHandle: body.handle,
          handle,
        });
        return { handle };
      }),
    } as unknown as GameWorld['physicsWorld'],
  };
}

function makeWorldFixture(): {
  world: GameWorld;
  rapierMock: ReturnType<typeof createRapierMock>;
} {
  const rapierMock = createRapierMock();
  return {
    rapierMock,
    world: {
      scene: new THREE.Scene(),
      ecs: {} as GameWorld['ecs'],
      renderer: {} as GameWorld['renderer'],
      rapier: rapierMock.rapier,
      physicsWorld: rapierMock.physicsWorld,
      camera: new THREE.PerspectiveCamera(),
      playerEntity: -1,
    },
  };
}

describe('createArena (Arena v1, #112)', () => {
  let world: GameWorld;
  let rapierMock: ReturnType<typeof createRapierMock>;

  beforeEach(() => {
    const fixture = makeWorldFixture();
    world = fixture.world;
    rapierMock = fixture.rapierMock;
    clearSpawnPoints();
  });

  /* ──────────────────────────────────────────────────────────
   * Lighting rig (regression — issue #117)
   * ────────────────────────────────────────────────────────── */
  describe('lighting rig (#117 regression)', () => {
    it('adds exactly one AmbientLight to the scene', () => {
      createArena(world);
      const ambients = world.scene.children.filter(
        (c) => c instanceof THREE.AmbientLight,
      ) as THREE.AmbientLight[];
      expect(ambients).toHaveLength(1);
    });

    it('AmbientLight matches the design doc (color 0xffffff, intensity 0.35)', () => {
      createArena(world);
      const ambient = world.scene.children.find(
        (c) => c instanceof THREE.AmbientLight,
      ) as THREE.AmbientLight | undefined;
      expect(ambient).toBeDefined();
      expect(ambient!.color.getHex()).toBe(0xffffff);
      expect(ambient!.intensity).toBe(0.35);
    });

    it('adds exactly one HemisphereLight to the scene', () => {
      createArena(world);
      const hemis = world.scene.children.filter(
        (c) => c instanceof THREE.HemisphereLight,
      ) as THREE.HemisphereLight[];
      expect(hemis).toHaveLength(1);
    });

    it('HemisphereLight matches the design doc (sky 0x87ceeb, ground 0x556b2f, intensity 0.5, position (0,50,0))', () => {
      createArena(world);
      const hemi = world.scene.children.find(
        (c) => c instanceof THREE.HemisphereLight,
      ) as THREE.HemisphereLight | undefined;
      expect(hemi).toBeDefined();
      expect(hemi!.color.getHex()).toBe(0x87ceeb);
      expect(hemi!.groundColor.getHex()).toBe(0x556b2f);
      expect(hemi!.intensity).toBe(0.5);
      expect(hemi!.position.x).toBe(0);
      expect(hemi!.position.y).toBe(50);
      expect(hemi!.position.z).toBe(0);
    });

    it('adds exactly one DirectionalLight to the scene', () => {
      createArena(world);
      const dirs = world.scene.children.filter(
        (c) => c instanceof THREE.DirectionalLight,
      ) as THREE.DirectionalLight[];
      expect(dirs).toHaveLength(1);
    });

    it('DirectionalLight matches the design doc (warm white 0xfff5e0, intensity 0.7, position (15,25,10))', () => {
      createArena(world);
      const sun = world.scene.children.find(
        (c) => c instanceof THREE.DirectionalLight,
      ) as THREE.DirectionalLight | undefined;
      expect(sun).toBeDefined();
      expect(sun!.color.getHex()).toBe(0xfff5e0);
      expect(sun!.intensity).toBe(0.7);
      expect(sun!.position.x).toBe(15);
      expect(sun!.position.y).toBe(25);
      expect(sun!.position.z).toBe(10);
    });

    it('DirectionalLight aims at the origin and has its target added to the scene', () => {
      createArena(world);
      const sun = world.scene.children.find(
        (c) => c instanceof THREE.DirectionalLight,
      ) as THREE.DirectionalLight | undefined;
      expect(sun).toBeDefined();
      expect(sun!.target.position.x).toBe(0);
      expect(sun!.target.position.y).toBe(0);
      expect(sun!.target.position.z).toBe(0);
      expect(world.scene.children.includes(sun!.target)).toBe(true);
    });

    it('does not enable shadows on any light', () => {
      createArena(world);
      for (const child of world.scene.children) {
        if (child instanceof THREE.Light) {
          expect((child as THREE.Light & { castShadow?: boolean }).castShadow).toBeFalsy();
        }
      }
    });

    it('does not modify scene.background (engine owns it, not the arena)', () => {
      world.scene.background = new THREE.Color(0x87ceeb);
      const before = world.scene.background;
      createArena(world);
      expect(world.scene.background).toBe(before);
    });
  });

  /* ──────────────────────────────────────────────────────────
   * Static geometry — 9 props (#112)
   * ────────────────────────────────────────────────────────── */
  describe('static geometry', () => {
    it('creates exactly 9 fixed rigid bodies and 9 cuboid colliders', () => {
      createArena(world);
      // Every prop is one body + one collider.
      expect(rapierMock.bodies).toHaveLength(9);
      expect(rapierMock.colliders).toHaveLength(9);
      for (const b of rapierMock.bodies) expect(b.type).toBe('fixed');
      for (const c of rapierMock.colliders) expect(c.shape).toBe('cuboid');
    });

    it('adds exactly 9 visible BoxGeometry meshes to the scene', () => {
      createArena(world);
      const boxes = world.scene.children.filter(
        (c) =>
          c instanceof THREE.Mesh && (c as THREE.Mesh).geometry instanceof THREE.BoxGeometry,
      );
      expect(boxes).toHaveLength(9);
    });

    it('mesh and collider extents are 1:1 (BoxGeometry full = ColliderDesc half × 2)', () => {
      createArena(world);
      const meshes = world.scene.children.filter(
        (c) =>
          c instanceof THREE.Mesh && (c as THREE.Mesh).geometry instanceof THREE.BoxGeometry,
      ) as THREE.Mesh[];

      // Bodies/colliders are pushed in the SAME ORDER as meshes (one
      // addStaticBox call writes one mesh + one body + one collider). Pair
      // them up positionally and assert the half-extent invariant.
      expect(meshes).toHaveLength(rapierMock.colliders.length);
      for (let i = 0; i < meshes.length; i++) {
        const geo = meshes[i].geometry as THREE.BoxGeometry;
        // BoxGeometry stores width/height/depth on `parameters`.
        const fullW = geo.parameters.width;
        const fullH = geo.parameters.height;
        const fullD = geo.parameters.depth;
        const [hx, hy, hz] = rapierMock.colliders[i].args;
        expect(hx).toBeCloseTo(fullW / 2, 5);
        expect(hy).toBeCloseTo(fullH / 2, 5);
        expect(hz).toBeCloseTo(fullD / 2, 5);
      }
    });

    it('mesh and rigid-body translations match (collider rides on body at body origin)', () => {
      createArena(world);
      const meshes = world.scene.children.filter(
        (c) =>
          c instanceof THREE.Mesh && (c as THREE.Mesh).geometry instanceof THREE.BoxGeometry,
      ) as THREE.Mesh[];

      expect(meshes).toHaveLength(rapierMock.bodies.length);
      for (let i = 0; i < meshes.length; i++) {
        expect(meshes[i].position.x).toBeCloseTo(rapierMock.bodies[i].translation.x, 5);
        expect(meshes[i].position.y).toBeCloseTo(rapierMock.bodies[i].translation.y, 5);
        expect(meshes[i].position.z).toBeCloseTo(rapierMock.bodies[i].translation.z, 5);
      }
    });

    it('ground is 30 × 0.2 × 30 at origin (top surface at y = 0.1 = GROUND_TOP_Y)', () => {
      createArena(world);
      // Ground is the first prop placed by createArena. Body translation
      // y=0 plus half-height 0.1 → top at y = 0.1.
      const groundBody = rapierMock.bodies[0];
      const groundCollider = rapierMock.colliders[0];
      expect(groundBody.translation).toEqual({ x: 0, y: 0, z: 0 });
      expect(groundCollider.args).toEqual([15, 0.1, 15]);
    });

    it('places the 4 perimeter walls at the documented positions and sizes', () => {
      createArena(world);
      // Walls 2..5 in placement order: N, S, E, W.
      const wallN = rapierMock.bodies[1];
      const wallS = rapierMock.bodies[2];
      const wallE = rapierMock.bodies[3];
      const wallW = rapierMock.bodies[4];
      expect(wallN.translation).toEqual({ x: 0, y: 1, z: -15.25 });
      expect(wallS.translation).toEqual({ x: 0, y: 1, z: 15.25 });
      expect(wallE.translation).toEqual({ x: 15.25, y: 1, z: 0 });
      expect(wallW.translation).toEqual({ x: -15.25, y: 1, z: 0 });

      // N/S walls are 30.5 × 2 × 0.5 → half-extents (15.25, 1, 0.25)
      expect(rapierMock.colliders[1].args).toEqual([15.25, 1, 0.25]);
      expect(rapierMock.colliders[2].args).toEqual([15.25, 1, 0.25]);
      // E/W walls are 0.5 × 2 × 30.5 → half-extents (0.25, 1, 15.25)
      expect(rapierMock.colliders[3].args).toEqual([0.25, 1, 15.25]);
      expect(rapierMock.colliders[4].args).toEqual([0.25, 1, 15.25]);
    });

    it('places the 2 cover pillars at (±5, 1.5, 0) sized 2 × 3 × 2', () => {
      createArena(world);
      const pillarA = rapierMock.bodies[5];
      const pillarB = rapierMock.bodies[6];
      expect(pillarA.translation).toEqual({ x: -5, y: 1.5, z: 0 });
      expect(pillarB.translation).toEqual({ x: 5, y: 1.5, z: 0 });
      expect(rapierMock.colliders[5].args).toEqual([1, 1.5, 1]);
      expect(rapierMock.colliders[6].args).toEqual([1, 1.5, 1]);
    });

    it('places the shop counter and shop back wall in the SW corner', () => {
      createArena(world);
      // Counter (3 × 1 × 0.5) at (-12, 0.5, 12).
      const counter = rapierMock.bodies[7];
      expect(counter.translation).toEqual({ x: -12, y: 0.5, z: 12 });
      expect(rapierMock.colliders[7].args).toEqual([1.5, 0.5, 0.25]);
      // Back wall (0.5 × 3 × 4) at (-13.25, 1.5, 12).
      const backWall = rapierMock.bodies[8];
      expect(backWall.translation).toEqual({ x: -13.25, y: 1.5, z: 12 });
      expect(rapierMock.colliders[8].args).toEqual([0.25, 1.5, 2]);
    });
  });

  /* ──────────────────────────────────────────────────────────
   * Spawn points (#112)
   * ────────────────────────────────────────────────────────── */
  describe('spawn points', () => {
    it('returns 6 spawn points with stable ids "s1".."s6"', () => {
      const spec = createArena(world);
      expect(spec.spawnPoints).toHaveLength(6);
      const ids = spec.spawnPoints.map((sp) => sp.id);
      expect(ids).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    });

    it('places spawn points at the documented coordinates (y = 0.1)', () => {
      const spec = createArena(world);
      const positions = spec.spawnPoints.map((sp) => sp.position);
      expect(positions[0]).toEqual({ x: -13, y: 0.1, z: 0 });
      expect(positions[1]).toEqual({ x: -7, y: 0.1, z: -9 });
      expect(positions[2]).toEqual({ x: 7, y: 0.1, z: -9 });
      expect(positions[3]).toEqual({ x: 13, y: 0.1, z: 0 });
      expect(positions[4]).toEqual({ x: -7, y: 0.1, z: 9 });
      expect(positions[5]).toEqual({ x: 7, y: 0.1, z: 9 });
    });

    it('all spawn points are inside arena bounds', () => {
      const spec = createArena(world);
      for (const sp of spec.spawnPoints) {
        expect(sp.position.x).toBeGreaterThan(spec.bounds.min.x);
        expect(sp.position.x).toBeLessThan(spec.bounds.max.x);
        expect(sp.position.z).toBeGreaterThan(spec.bounds.min.z);
        expect(sp.position.z).toBeLessThan(spec.bounds.max.z);
      }
    });

    it('spawn yaws face the arena center (atan2(-x, -z))', () => {
      const spec = createArena(world);
      // S1 at (-13, 0): faces +X (east). Yaw +π/2 by convention.
      expect(spec.spawnPoints[0].facing).toBeCloseTo(Math.PI / 2, 5);
      // S4 at (13, 0): faces -X (west). Yaw -π/2.
      expect(spec.spawnPoints[3].facing).toBeCloseTo(-Math.PI / 2, 5);
      // S2/S3/S5/S6 — interior spawns, facings derived from atan2.
      expect(spec.spawnPoints[1].facing).toBeCloseTo(Math.atan2(7, 9), 5);
      expect(spec.spawnPoints[2].facing).toBeCloseTo(Math.atan2(-7, 9), 5);
      expect(spec.spawnPoints[4].facing).toBeCloseTo(Math.atan2(7, -9), 5);
      expect(spec.spawnPoints[5].facing).toBeCloseTo(Math.atan2(-7, -9), 5);
    });

    it('S2 ↔ S5 and S3 ↔ S6 are mirror-symmetric across z = 0', () => {
      const spec = createArena(world);
      const s2 = spec.spawnPoints[1];
      const s5 = spec.spawnPoints[4];
      const s3 = spec.spawnPoints[2];
      const s6 = spec.spawnPoints[5];

      expect(s2.position.x).toBe(s5.position.x);
      expect(s2.position.z).toBe(-s5.position.z);
      expect(s3.position.x).toBe(s6.position.x);
      expect(s3.position.z).toBe(-s6.position.z);
    });

    it('registers spawn points into world/SpawnPoints.ts (numeric ids 1..6)', () => {
      createArena(world);
      // arena.spawnPoints carry string ids; the world registry uses numeric
      // ids (1-based so 0 stays the "no spawn point" sentinel).
      expect(spawnPointRegistry.size).toBe(6);
      for (let i = 1; i <= 6; i++) {
        const sp = spawnPointRegistry.get(i);
        expect(sp).toBeDefined();
        expect(sp!.id).toBe(i);
      }
      // Spot-check coord/yaw mirroring on s1.
      const s1 = spawnPointRegistry.get(1)!;
      expect(s1.position).toEqual({ x: -13, y: 0.1, z: 0 });
      expect(s1.yaw).toBeCloseTo(Math.PI / 2, 5);
    });

    it('clears stale placeholders before registering arena spawn points', () => {
      // Pre-seed a placeholder that should be wiped by createArena.
      registerSpawnPoint({
        id: 99,
        position: { x: 999, y: 999, z: 999 },
        yaw: 0,
      });
      expect(spawnPointRegistry.size).toBe(1);

      createArena(world);
      // Only the 6 arena spawn points should remain — the stale id=99 is gone.
      expect(spawnPointRegistry.size).toBe(6);
      expect(spawnPointRegistry.get(99)).toBeUndefined();
    });
  });

  /* ──────────────────────────────────────────────────────────
   * ArenaSpec — bounds, shopkeep stall, weapon-pickup safe volume (#112)
   * ────────────────────────────────────────────────────────── */
  describe('ArenaSpec', () => {
    it('returns name "arena_v1" and groundHeight 0.1', () => {
      const spec = createArena(world);
      expect(spec.name).toBe('arena_v1');
      expect(spec.groundHeight).toBe(0.1);
    });

    it('bounds are the inside-walls AABB (x/z ∈ ±15)', () => {
      const spec = createArena(world);
      expect(spec.bounds.min).toEqual({ x: -15, y: 0, z: -15 });
      expect(spec.bounds.max).toEqual({ x: 15, y: 10, z: 15 });
    });

    it('shopkeep stall counter AABB matches the documented placement', () => {
      const spec = createArena(world);
      expect(spec.shopkeepStall.counter.min).toEqual({
        x: -13.5,
        y: 0,
        z: 11.75,
      });
      expect(spec.shopkeepStall.counter.max).toEqual({
        x: -10.5,
        y: 1,
        z: 12.25,
      });
    });

    it('shopkeep NPC anchor sits behind the counter, feet on ground, facing north', () => {
      const spec = createArena(world);
      expect(spec.shopkeepStall.npcAnchor).toEqual({ x: -12, y: 0.1, z: 13 });
      expect(spec.shopkeepStall.facing).toBe(0);
    });

    it('weapon-pickup safe volume is bounds shrunk by 0.5m margin', () => {
      const spec = createArena(world);
      expect(spec.weaponPickupSafeVolume.min).toEqual({
        x: -14.5,
        y: 0,
        z: -14.5,
      });
      expect(spec.weaponPickupSafeVolume.max).toEqual({
        x: 14.5,
        y: 10,
        z: 14.5,
      });
    });
  });
});
