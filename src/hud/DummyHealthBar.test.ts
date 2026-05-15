import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import * as THREE from 'three';
import { DummyHealthBar } from './DummyHealthBar';
import { Health, IsNPC, IsTrainingDummy, meshRegistry } from '../ecs/components';
import type { GameWorld } from '../core/types';

function makeStubWorld(): GameWorld {
  return {
    ecs: createWorld(),
    scene: undefined as any,
    renderer: undefined as any,
    rapier: undefined as any,
    physicsWorld: undefined as any,
    camera: undefined as any,
    playerEntity: 0,
  };
}

function tagAsTrainingDummy(world: GameWorld): number {
  const eid = addEntity(world.ecs);
  addComponent(world.ecs, IsNPC, eid);
  addComponent(world.ecs, IsTrainingDummy, eid);
  return eid;
}

describe('DummyHealthBar', () => {
  let camera: THREE.PerspectiveCamera;
  let world: GameWorld;
  let healthBar: DummyHealthBar;

  beforeEach(() => {
    const existing = document.getElementById('dummy-healthbar-container');
    if (existing) existing.remove();

    camera = new THREE.PerspectiveCamera(78, 1, 0.1, 1000);
    camera.position.set(0, 1.6, 5);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld(true);

    world = makeStubWorld();
    healthBar = new DummyHealthBar(camera, world);
  });

  afterEach(() => {
    healthBar.dispose();
    meshRegistry.clear();
  });

  it('should create the wrapper container', () => {
    const container = document.getElementById('dummy-healthbar-container');
    expect(container).not.toBeNull();
  });

  it('should create a health bar for an active dummy', () => {
    const eid = tagAsTrainingDummy(world);
    Health.current[eid] = 100;
    Health.max[eid] = 100;

    // Create minimal mesh data
    const group = new THREE.Group();
    group.position.set(0, 0, -3);
    group.updateMatrixWorld(true);
    meshRegistry.set(eid, {
      group,
      skeleton: new THREE.Skeleton([]),
      bones: {},
    });

    healthBar.update();

    const container = document.getElementById('dummy-healthbar-container');
    expect(container!.children.length).toBe(1);
  });

  it('should show full health bar at 100%', () => {
    const eid = tagAsTrainingDummy(world);
    Health.current[eid] = 100;
    Health.max[eid] = 100;

    const group = new THREE.Group();
    group.position.set(0, 0, -3);
    group.updateMatrixWorld(true);
    meshRegistry.set(eid, {
      group,
      skeleton: new THREE.Skeleton([]),
      bones: {},
    });

    healthBar.update();

    const container = document.getElementById('dummy-healthbar-container');
    const bar = container!.children[0] as HTMLDivElement;
    const fill = bar.children[0] as HTMLDivElement;
    expect(fill.style.width).toBe('100%');
  });

  it('should reflect reduced health', () => {
    const eid = tagAsTrainingDummy(world);
    Health.current[eid] = 50;
    Health.max[eid] = 100;

    const group = new THREE.Group();
    group.position.set(0, 0, -3);
    group.updateMatrixWorld(true);
    meshRegistry.set(eid, {
      group,
      skeleton: new THREE.Skeleton([]),
      bones: {},
    });

    healthBar.update();

    const container = document.getElementById('dummy-healthbar-container');
    const bar = container!.children[0] as HTMLDivElement;
    const fill = bar.children[0] as HTMLDivElement;
    expect(fill.style.width).toBe('50%');
  });

  it('should clean up on dispose', () => {
    healthBar.dispose();
    expect(document.getElementById('dummy-healthbar-container')).toBeNull();
  });
});
