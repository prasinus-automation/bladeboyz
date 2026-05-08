import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createArena } from './createArena';
import type { GameWorld } from '../core/types';

/**
 * Tests for `createArena()` — the lighting-only stub from issue #117.
 *
 * These tests focus on the lighting rig and the ArenaSpec shape. Geometry,
 * spawn points, and the shopkeep stall are stubbed out (zero-volume) and
 * filled in by #112; tests for those fields belong to that PR.
 */

/**
 * Build a minimal `GameWorld`-shaped fixture sufficient for `createArena()`.
 * Only `scene` is touched by the lighting code; the rest are stubs so the
 * type matches without instantiating Rapier (which would force WASM init).
 */
function makeWorldFixture(): GameWorld {
  return {
    scene: new THREE.Scene(),
    // Casts: createArena() does not read these, but the GameWorld type
    // requires them. Tests for geometry (#112) will need a real fixture.
    ecs: {} as GameWorld['ecs'],
    renderer: {} as GameWorld['renderer'],
    rapier: {} as GameWorld['rapier'],
    physicsWorld: {} as GameWorld['physicsWorld'],
    camera: new THREE.PerspectiveCamera(),
    playerEntity: -1,
  };
}

describe('createArena (lighting stub, #117)', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = makeWorldFixture();
  });

  describe('lighting rig', () => {
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
      // Three.js requires the target be in the scene graph for its world
      // matrix to update; otherwise the light points in the wrong direction.
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
      // v1 deliberately ships without shadows — see docs/arena-v1.md.
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

  describe('ArenaSpec stub', () => {
    it('returns an ArenaSpec with name "arena_v1"', () => {
      const spec = createArena(world);
      expect(spec.name).toBe('arena_v1');
    });

    it('groundHeight is 0.1 (preserves SPAWN_HEIGHT math in core/types.ts)', () => {
      const spec = createArena(world);
      expect(spec.groundHeight).toBe(0.1);
    });

    it('returns the full ArenaSpec shape (geometry fields stubbed for #112)', () => {
      const spec = createArena(world);
      // bounds present and zero-volume
      expect(spec.bounds).toBeDefined();
      expect(spec.bounds.min).toEqual({ x: 0, y: 0, z: 0 });
      expect(spec.bounds.max).toEqual({ x: 0, y: 0, z: 0 });
      // spawnPoints present and empty (#112 fills with 6 points)
      expect(Array.isArray(spec.spawnPoints)).toBe(true);
      expect(spec.spawnPoints).toHaveLength(0);
      // shopkeepStall present and zero-volume
      expect(spec.shopkeepStall).toBeDefined();
      expect(spec.shopkeepStall.npcAnchor).toEqual({ x: 0, y: 0, z: 0 });
      expect(spec.shopkeepStall.facing).toBe(0);
      // weaponPickupSafeVolume present and zero-volume
      expect(spec.weaponPickupSafeVolume).toBeDefined();
    });
  });
});
