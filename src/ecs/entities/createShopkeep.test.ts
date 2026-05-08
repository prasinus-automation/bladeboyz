import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createWorld } from 'bitecs';
import {
  Position,
  Rotation,
  CharacterModel,
  meshRegistry,
} from '../components';
import {
  createShopkeep,
  removeShopkeep,
  shopkeepRegistry,
  DEFAULT_INTERACT_RADIUS,
} from './createShopkeep';
import type { GameWorld } from '../../core/types';

/**
 * createShopkeep tests — verify factory adds the right components,
 * registers ShopkeepData, and adds the mesh to the scene.
 *
 * The shopkeep entity intentionally has no Rapier body, so we don't need
 * to initialize the WASM physics world here — just an ECS world + Three
 * scene.
 */

function makeMinimalWorld(): GameWorld {
  return {
    ecs: createWorld(),
    scene: new THREE.Scene(),
    // Unused by createShopkeep — present only for type compatibility.
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

describe('createShopkeep', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = makeMinimalWorld();
    shopkeepRegistry.clear();
    meshRegistry.clear();
  });

  it('returns a numeric entity id', () => {
    const eid = createShopkeep(world, 8, 1.1, 8);
    expect(typeof eid).toBe('number');
    expect(eid).toBeGreaterThanOrEqual(0);
  });

  it('writes Position to the ECS component', () => {
    const eid = createShopkeep(world, 8, 1.1, -3);
    expect(Position.x[eid]).toBeCloseTo(8);
    expect(Position.y[eid]).toBeCloseTo(1.1);
    expect(Position.z[eid]).toBeCloseTo(-3);
  });

  it('faces toward the arena center (origin) by default', () => {
    const eid = createShopkeep(world, 8, 1.1, 8);
    // Yaw=0 looks down -Z; for spawn at (8, *, 8) facing origin,
    // the yaw should be atan2(-8, -8) = -3π/4
    expect(Rotation.y[eid]).toBeCloseTo(Math.atan2(-8, -8));
  });

  it('registers ShopkeepData in shopkeepRegistry', () => {
    const eid = createShopkeep(world, 8, 1.1, 8);
    const data = shopkeepRegistry.get(eid);
    expect(data).toBeDefined();
    expect(data!.name).toBe('Shopkeep');
    expect(data!.interactRadius).toBe(DEFAULT_INTERACT_RADIUS);
  });

  it('honors a custom name option', () => {
    const eid = createShopkeep(world, 0, 1.1, 0, { name: 'Bob the Smith' });
    expect(shopkeepRegistry.get(eid)!.name).toBe('Bob the Smith');
  });

  it('honors a custom interactRadius option', () => {
    const eid = createShopkeep(world, 0, 1.1, 0, { interactRadius: 5 });
    expect(shopkeepRegistry.get(eid)!.interactRadius).toBe(5);
  });

  it('adds the mesh group to the scene', () => {
    const eid = createShopkeep(world, 0, 1.1, 0);
    const modelData = meshRegistry.get(eid);
    expect(modelData).toBeDefined();
    expect(world.scene.children).toContain(modelData!.group);
  });

  it('positions the mesh group at the spawn coordinates', () => {
    const eid = createShopkeep(world, 8, 1.1, -3);
    const modelData = meshRegistry.get(eid)!;
    expect(modelData.group.position.x).toBeCloseTo(8);
    expect(modelData.group.position.y).toBeCloseTo(1.1);
    expect(modelData.group.position.z).toBeCloseTo(-3);
  });

  it('sets CharacterModel.id to the entity id', () => {
    const eid = createShopkeep(world, 0, 1.1, 0);
    expect(CharacterModel.id[eid]).toBe(eid);
  });

  it('does NOT add combat components (uses hasComponent check)', async () => {
    // Shopkeeps are non-combatants. Verify Health/Hitboxes/CombatStateComp
    // are NOT attached using bitECS's hasComponent.
    const { hasComponent } = await import('bitecs');
    const { Health, Stamina, Hitboxes, CombatStateComp } =
      await import('../components');
    const eid = createShopkeep(world, 0, 1.1, 0);
    expect(hasComponent(world.ecs, Health, eid)).toBe(false);
    expect(hasComponent(world.ecs, Stamina, eid)).toBe(false);
    expect(hasComponent(world.ecs, Hitboxes, eid)).toBe(false);
    expect(hasComponent(world.ecs, CombatStateComp, eid)).toBe(false);
  });
});

describe('removeShopkeep', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = makeMinimalWorld();
    shopkeepRegistry.clear();
    meshRegistry.clear();
  });

  it('removes the entry from shopkeepRegistry', () => {
    const eid = createShopkeep(world, 0, 1.1, 0);
    expect(shopkeepRegistry.has(eid)).toBe(true);
    removeShopkeep(world, eid);
    expect(shopkeepRegistry.has(eid)).toBe(false);
  });

  it('removes the mesh group from the scene', () => {
    const eid = createShopkeep(world, 0, 1.1, 0);
    const group = meshRegistry.get(eid)!.group;
    expect(world.scene.children).toContain(group);
    removeShopkeep(world, eid);
    expect(world.scene.children).not.toContain(group);
  });

  it('removes the mesh entry from meshRegistry', () => {
    const eid = createShopkeep(world, 0, 1.1, 0);
    expect(meshRegistry.has(eid)).toBe(true);
    removeShopkeep(world, eid);
    expect(meshRegistry.has(eid)).toBe(false);
  });
});
