import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createWorld, hasComponent } from 'bitecs';
import { Position, WeaponPickup } from '../components';
import {
  createWeaponPickup,
  removeWeaponPickup,
} from './createWeaponPickup';
import {
  pickupRegistry,
  resetPickupRegistry,
} from '../../inventory/PickupRegistry';
import { weaponIdToName } from '../systems/CombatSystem';
import { weaponModelFactories } from '../../rendering/WeaponModels';
import type { GameWorld } from '../../core/types';

/**
 * Tests for createWeaponPickup / removeWeaponPickup.
 *
 * No Rapier needed — pickups have no physics body. We just need an ECS
 * world + Three.js scene, like createShopkeep.test.ts.
 */

function makeMinimalWorld(): GameWorld {
  return {
    ecs: createWorld(),
    scene: new THREE.Scene(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderer: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rapier: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    physicsWorld: {} as any,
    camera: new THREE.PerspectiveCamera(),
    playerEntity: 0,
  };
}

/** Snapshot of weaponIdToName so tests can mutate it without leaking. */
let savedWeaponIdToName: string[] = [];

function resetWeaponIdTable(): void {
  weaponIdToName.length = 0;
  weaponIdToName.push('Longsword', 'Mace', 'Dagger', 'Battleaxe');
}

describe('createWeaponPickup', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = makeMinimalWorld();
    resetPickupRegistry();
    savedWeaponIdToName = [...weaponIdToName];
    resetWeaponIdTable();
  });

  afterEach(() => {
    weaponIdToName.length = 0;
    weaponIdToName.push(...savedWeaponIdToName);
  });

  it('returns a numeric entity id', () => {
    const eid = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 1, y: 0.1, z: -2 },
      spawnTick: 0,
      despawnTick: 600,
    });
    expect(typeof eid).toBe('number');
    expect(eid).toBeGreaterThanOrEqual(0);
  });

  it('writes Position component values', () => {
    const eid = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 3, y: 0.5, z: -1.5 },
      spawnTick: 10,
      despawnTick: 500,
    });
    expect(Position.x[eid]).toBeCloseTo(3);
    expect(Position.y[eid]).toBeCloseTo(0.5);
    expect(Position.z[eid]).toBeCloseTo(-1.5);
  });

  it('attaches the WeaponPickup component', () => {
    const eid = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 0, y: 0, z: 0 },
      spawnTick: 0,
      despawnTick: 600,
    });
    expect(hasComponent(world.ecs, WeaponPickup, eid)).toBe(true);
  });

  it('writes WeaponPickup numeric fields (weaponId from weaponIdToName)', () => {
    // Mace is index 1 in weaponIdToName
    const eid = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 0, y: 0, z: 0 },
      spawnTick: 42,
      despawnTick: 642,
    });
    expect(WeaponPickup.weaponId[eid]).toBe(1);
    expect(WeaponPickup.spawnTick[eid]).toBe(42);
    expect(WeaponPickup.despawnTick[eid]).toBe(642);
  });

  it('resolves weaponId for each canonical weapon', () => {
    const cases: Array<[string, number]> = [
      ['Longsword', 0],
      ['Mace', 1],
      ['Dagger', 2],
      ['Battleaxe', 3],
    ];
    for (const [name, expectedId] of cases) {
      const eid = createWeaponPickup(world, {
        weaponName: name,
        position: { x: 0, y: 0, z: 0 },
        spawnTick: 0,
        despawnTick: 1,
      });
      expect(WeaponPickup.weaponId[eid]).toBe(expectedId);
    }
  });

  it('adds the mesh group to the scene at the requested position', () => {
    const eid = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 4, y: 0.1, z: -2 },
      spawnTick: 0,
      despawnTick: 600,
    });
    const data = pickupRegistry.get(eid)!;
    expect(world.scene.children).toContain(data.group);
    expect(data.group.position.x).toBeCloseTo(4);
    expect(data.group.position.y).toBeCloseTo(0.1);
    expect(data.group.position.z).toBeCloseTo(-2);
  });

  it('lays the mesh flat (Mace: rotation.x = -PI/2)', () => {
    // Per-weapon orientation polish (#127) lives in `createGroundPickupModel`
    // in WeaponModels.ts; Mace inherits the default `-π/2` X-rotation. See
    // WeaponModels.test.ts for per-weapon orientation coverage.
    const eid = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 0, y: 0, z: 0 },
      spawnTick: 0,
      despawnTick: 1,
    });
    const data = pickupRegistry.get(eid)!;
    expect(data.group.rotation.x).toBeCloseTo(-Math.PI / 2);
  });

  it('populates pickupRegistry with weaponName, group, materials', () => {
    const eid = createWeaponPickup(world, {
      weaponName: 'Battleaxe',
      position: { x: 0, y: 0, z: 0 },
      spawnTick: 0,
      despawnTick: 1,
    });
    const data = pickupRegistry.get(eid);
    expect(data).toBeDefined();
    expect(data!.weaponName).toBe('Battleaxe');
    expect(data!.group).toBeInstanceOf(THREE.Group);
    expect(Array.isArray(data!.materials)).toBe(true);
    expect(data!.materials.length).toBeGreaterThan(0);
    // Materials should be unique (no duplicates from shared instances)
    expect(new Set(data!.materials).size).toBe(data!.materials.length);
  });

  it('throws on unknown weapon (factory not registered)', () => {
    expect(() =>
      createWeaponPickup(world, {
        weaponName: 'NonExistent',
        position: { x: 0, y: 0, z: 0 },
        spawnTick: 0,
        despawnTick: 1,
      }),
    ).toThrow(/NonExistent/);
  });

  it('falls back to weaponId=0 when weapon name not in weaponIdToName', () => {
    // Empty the id table so any name resolves to -1 → fallback 0.
    // The rendering-side weaponModelFactories is still populated, so we can
    // still spawn a pickup; only the numeric weaponId is affected.
    weaponIdToName.length = 0;
    const eid = createWeaponPickup(world, {
      weaponName: 'Dagger',
      position: { x: 0, y: 0, z: 0 },
      spawnTick: 0,
      despawnTick: 1,
    });
    expect(WeaponPickup.weaponId[eid]).toBe(0);
    // pickupRegistry.weaponName is still the source of truth
    expect(pickupRegistry.get(eid)!.weaponName).toBe('Dagger');
  });

  it('rendering weaponModelFactories has all four canonical weapons populated', () => {
    // Smoke test: createWeaponPickup depends on this registry. Sub-issue #B
    // will replace `createGroundPickupModel` with a real implementation that
    // also goes through this registry, so it's a stable pre-condition.
    expect(weaponModelFactories['Longsword']).toBeDefined();
    expect(weaponModelFactories['Mace']).toBeDefined();
    expect(weaponModelFactories['Dagger']).toBeDefined();
    expect(weaponModelFactories['Battleaxe']).toBeDefined();
  });
});

describe('removeWeaponPickup', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = makeMinimalWorld();
    resetPickupRegistry();
    savedWeaponIdToName = [...weaponIdToName];
    resetWeaponIdTable();
  });

  afterEach(() => {
    weaponIdToName.length = 0;
    weaponIdToName.push(...savedWeaponIdToName);
  });

  it('removes the entry from pickupRegistry', () => {
    const eid = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 0, y: 0, z: 0 },
      spawnTick: 0,
      despawnTick: 1,
    });
    expect(pickupRegistry.has(eid)).toBe(true);
    removeWeaponPickup(world, eid);
    expect(pickupRegistry.has(eid)).toBe(false);
  });

  it('removes the mesh group from the scene', () => {
    const eid = createWeaponPickup(world, {
      weaponName: 'Mace',
      position: { x: 0, y: 0, z: 0 },
      spawnTick: 0,
      despawnTick: 1,
    });
    const group = pickupRegistry.get(eid)!.group;
    expect(world.scene.children).toContain(group);
    removeWeaponPickup(world, eid);
    expect(world.scene.children).not.toContain(group);
  });

  it('disposes geometries and materials', () => {
    const eid = createWeaponPickup(world, {
      weaponName: 'Battleaxe',
      position: { x: 0, y: 0, z: 0 },
      spawnTick: 0,
      despawnTick: 1,
    });
    const data = pickupRegistry.get(eid)!;

    // Wrap dispose calls on each material/geometry to track invocations.
    const disposed: string[] = [];
    data.group.traverse((obj) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = obj as any;
      if (o.geometry) {
        const orig = o.geometry.dispose.bind(o.geometry);
        o.geometry.dispose = () => {
          disposed.push('geom');
          orig();
        };
      }
      if (o.material) {
        const mat = o.material;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wrap = (m: any) => {
          const orig = m.dispose.bind(m);
          m.dispose = () => {
            disposed.push('mat');
            orig();
          };
        };
        if (Array.isArray(mat)) mat.forEach(wrap);
        else wrap(mat);
      }
    });

    removeWeaponPickup(world, eid);
    expect(disposed.length).toBeGreaterThan(0);
    expect(disposed).toContain('geom');
    expect(disposed).toContain('mat');
  });

  it('is a no-op for an unknown eid (does not throw)', () => {
    expect(() => removeWeaponPickup(world, 9999)).not.toThrow();
  });
});
