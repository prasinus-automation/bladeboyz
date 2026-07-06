import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { createArenaV2 } from './createArenaV2';
import { spawnPointRegistry, clearSpawnPoints } from '../world/SpawnPoints';
import type { GameWorld } from '../core/types';
import { CHARACTER_CONTROLLER_OFFSET } from '../core/types';
import { sampleTerrainHeight } from './terrain';
import {
  TERRAIN_SPEC_V2,
  ARENA_V2_SPAWNS,
  ZONE_COLORS,
  BASE_HEIGHT,
} from './arenaV2Spec';

/**
 * Tests for `createArenaV2()` — Arena v2 (issue #207).
 *
 * The Rapier mock captures both cuboid (walls) and heightfield (terrain)
 * collider descriptors so we can assert the collider inventory without a real
 * WASM world. THREE runs natively (as in createArena.test.ts).
 */

interface CapturedBody {
  type: 'fixed';
  translation: { x: number; y: number; z: number };
  handle: number;
}
interface CapturedCollider {
  shape: 'cuboid' | 'heightfield';
  args: unknown[];
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

  return {
    bodies,
    colliders,
    rapier: {
      Vector3: class {
        constructor(
          public x: number,
          public y: number,
          public z: number,
        ) {}
      },
      RigidBodyDesc: {
        fixed: () => makeRigidBodyDesc('fixed'),
      },
      ColliderDesc: {
        cuboid: (hx: number, hy: number, hz: number) => ({
          shape: 'cuboid' as const,
          args: [hx, hy, hz],
        }),
        heightfield: (
          nrows: number,
          ncols: number,
          heights: Float32Array,
          scale: unknown,
        ) => ({
          shape: 'heightfield' as const,
          args: [nrows, ncols, heights, scale],
        }),
      },
    } as unknown as GameWorld['rapier'],
    physicsWorld: {
      createRigidBody: vi.fn((desc: any) => {
        const handle = nextHandle++;
        bodies.push({ type: desc.type, translation: desc.translation, handle });
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

function makeWorldFixture() {
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
    } as GameWorld,
  };
}

describe('createArenaV2 (Arena v2, #207)', () => {
  let world: GameWorld;
  let rapierMock: ReturnType<typeof createRapierMock>;

  beforeEach(() => {
    const fixture = makeWorldFixture();
    world = fixture.world;
    rapierMock = fixture.rapierMock;
    clearSpawnPoints();
  });

  /* ── Lighting ── */
  describe('lighting rig', () => {
    it('adds one ambient, one hemisphere, one directional light', () => {
      createArenaV2(world);
      const ambients = world.scene.children.filter(
        (c) => c instanceof THREE.AmbientLight,
      );
      const hemis = world.scene.children.filter(
        (c) => c instanceof THREE.HemisphereLight,
      );
      const dirs = world.scene.children.filter(
        (c) => c instanceof THREE.DirectionalLight,
      );
      expect(ambients).toHaveLength(1);
      expect(hemis).toHaveLength(1);
      expect(dirs).toHaveLength(1);
      expect((ambients[0] as THREE.AmbientLight).intensity).toBe(0.35);
    });

    it('repositions the directional sun to (60, 80, 40), aimed at origin', () => {
      createArenaV2(world);
      const sun = world.scene.children.find(
        (c) => c instanceof THREE.DirectionalLight,
      ) as THREE.DirectionalLight;
      expect(sun.position.x).toBe(60);
      expect(sun.position.y).toBe(80);
      expect(sun.position.z).toBe(40);
      expect(sun.target.position.x).toBe(0);
      expect(world.scene.children.includes(sun.target)).toBe(true);
    });

    it('does not enable shadows on any light', () => {
      createArenaV2(world);
      for (const child of world.scene.children) {
        if (child instanceof THREE.Light) {
          expect(
            (child as THREE.Light & { castShadow?: boolean }).castShadow,
          ).toBeFalsy();
        }
      }
    });
  });

  /* ── Colliders ── */
  describe('colliders', () => {
    it('creates one heightfield terrain collider + four cuboid walls', () => {
      createArenaV2(world);
      const heightfields = rapierMock.colliders.filter(
        (c) => c.shape === 'heightfield',
      );
      const cuboids = rapierMock.colliders.filter((c) => c.shape === 'cuboid');
      expect(heightfields).toHaveLength(1);
      expect(cuboids).toHaveLength(4);
      // Heightfield vertex count = (resolution+1)².
      const heights = heightfields[0].args[2] as Float32Array;
      const n = TERRAIN_SPEC_V2.resolution + 1;
      expect(heights.length).toBe(n * n);
    });

    it('places the 4 boundary walls at ±50.25', () => {
      createArenaV2(world);
      const wallTranslations = rapierMock.bodies.map((b) => b.translation);
      expect(wallTranslations).toContainEqual({ x: 0, y: 1.5, z: -50.25 });
      expect(wallTranslations).toContainEqual({ x: 0, y: 1.5, z: 50.25 });
      expect(wallTranslations).toContainEqual({ x: 50.25, y: 1.5, z: 0 });
      expect(wallTranslations).toContainEqual({ x: -50.25, y: 1.5, z: 0 });
    });
  });

  /* ── Terrain mesh (vertex-color zones) ── */
  describe('terrain visual mesh', () => {
    function getTerrainMesh(): THREE.Mesh {
      const mesh = world.scene.children.find(
        (c) =>
          c instanceof THREE.Mesh &&
          (c as THREE.Mesh).geometry instanceof THREE.PlaneGeometry,
      ) as THREE.Mesh;
      return mesh;
    }

    it('adds a displaced, vertex-colored PlaneGeometry mesh', () => {
      createArenaV2(world);
      const mesh = getTerrainMesh();
      expect(mesh).toBeDefined();
      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat.vertexColors).toBe(true);
      expect(mat.flatShading).toBe(true);
      expect(mesh.geometry.getAttribute('color')).toBeDefined();
    });

    it('displaces terrain vertices to the sampled height (plateau reads ~4)', () => {
      createArenaV2(world);
      const mesh = getTerrainMesh();
      const pos = mesh.geometry.getAttribute('position');
      // The center vertex of an even-segment plane sits at (0,0). Find any
      // vertex at (0,0) and check its y equals the plateau height.
      let found = false;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getX(i)) < 1e-6 && Math.abs(pos.getZ(i)) < 1e-6) {
          expect(pos.getY(i)).toBeCloseTo(
            sampleTerrainHeight(TERRAIN_SPEC_V2, 0, 0),
            5,
          );
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });

    it('has at least 3 distinct vertex colors and the plateau center reads as stone', () => {
      createArenaV2(world);
      const mesh = getTerrainMesh();
      const pos = mesh.geometry.getAttribute('position');
      const col = mesh.geometry.getAttribute('color');
      const seen = new Set<string>();
      const stone = new THREE.Color(ZONE_COLORS.stone);
      let centerIsStone = false;
      for (let i = 0; i < pos.count; i++) {
        const key = `${col.getX(i).toFixed(4)},${col.getY(i).toFixed(4)},${col
          .getZ(i)
          .toFixed(4)}`;
        seen.add(key);
        if (Math.abs(pos.getX(i)) < 1e-6 && Math.abs(pos.getZ(i)) < 1e-6) {
          centerIsStone =
            Math.abs(col.getX(i) - stone.r) < 1e-3 &&
            Math.abs(col.getY(i) - stone.g) < 1e-3 &&
            Math.abs(col.getZ(i) - stone.b) < 1e-3;
        }
      }
      expect(seen.size).toBeGreaterThanOrEqual(3);
      expect(centerIsStone).toBe(true);
    });
  });

  /* ── Spawn points ── */
  describe('spawn points', () => {
    it('returns 10 spawn points with ids s1..s10', () => {
      const spec = createArenaV2(world);
      expect(spec.spawnPoints).toHaveLength(10);
      expect(spec.spawnPoints.map((s) => s.id)).toEqual(
        Array.from({ length: 10 }, (_, i) => `s${i + 1}`),
      );
    });

    it('spawn x/z/yaw match the shared ARENA_V2_SPAWNS table', () => {
      const spec = createArenaV2(world);
      spec.spawnPoints.forEach((sp, i) => {
        expect(sp.position.x).toBe(ARENA_V2_SPAWNS[i].x);
        expect(sp.position.z).toBe(ARENA_V2_SPAWNS[i].z);
        expect(sp.facing).toBeCloseTo(ARENA_V2_SPAWNS[i].yaw, 6);
      });
    });

    it('each spawn y ≈ terrain height + controller offset', () => {
      const spec = createArenaV2(world);
      for (const sp of spec.spawnPoints) {
        const expected =
          sampleTerrainHeight(TERRAIN_SPEC_V2, sp.position.x, sp.position.z) +
          CHARACTER_CONTROLLER_OFFSET;
        expect(sp.position.y).toBeCloseTo(expected, 6);
        // Open, flat terrain (outside plateau footprint).
        expect(sp.position.y).toBeCloseTo(
          BASE_HEIGHT + CHARACTER_CONTROLLER_OFFSET,
          6,
        );
      }
    });

    it('every spawn is inside bounds', () => {
      const spec = createArenaV2(world);
      for (const sp of spec.spawnPoints) {
        expect(sp.position.x).toBeGreaterThan(spec.bounds.min.x);
        expect(sp.position.x).toBeLessThan(spec.bounds.max.x);
        expect(sp.position.z).toBeGreaterThan(spec.bounds.min.z);
        expect(sp.position.z).toBeLessThan(spec.bounds.max.z);
      }
    });

    it('registers 10 spawn points into the world registry (ids 1..10)', () => {
      createArenaV2(world);
      expect(spawnPointRegistry.size).toBe(10);
      for (let i = 1; i <= 10; i++) {
        expect(spawnPointRegistry.get(i)).toBeDefined();
      }
    });
  });

  /* ── ArenaSpec ── */
  describe('ArenaSpec', () => {
    it('is named arena_v2 and carries the terrain handle', () => {
      const spec = createArenaV2(world);
      expect(spec.name).toBe('arena_v2');
      expect(spec.terrain).toBeDefined();
      expect(spec.terrain!.sample(0, 0)).toBeCloseTo(
        sampleTerrainHeight(TERRAIN_SPEC_V2, 0, 0),
        6,
      );
    });

    it('bounds are the inside-walls AABB (±50) with 0..30 headroom', () => {
      const spec = createArenaV2(world);
      expect(spec.bounds.min).toEqual({ x: -50, y: 0, z: -50 });
      expect(spec.bounds.max).toEqual({ x: 50, y: 30, z: 50 });
    });

    it('weapon-pickup safe volume y-max is 20 (contains plateau + future ramparts)', () => {
      const spec = createArenaV2(world);
      expect(spec.weaponPickupSafeVolume.max.y).toBe(20);
      expect(spec.weaponPickupSafeVolume.min).toEqual({
        x: -49.5,
        y: 0,
        z: -49.5,
      });
    });

    it('places the shopkeep stall off the plateau on the +Z approach', () => {
      const spec = createArenaV2(world);
      expect(spec.shopkeepStall.npcAnchor.z).toBeGreaterThan(26); // past skirt
      expect(spec.shopkeepStall.npcAnchor.x).toBe(0);
    });
  });
});
