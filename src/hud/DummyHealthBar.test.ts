import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { DummyHealthBar } from './DummyHealthBar';
import { Health, meshRegistry } from '../ecs/components';
import { activeDummies } from '../ecs/entities/createDummy';

describe('DummyHealthBar', () => {
  let camera: THREE.PerspectiveCamera;
  let healthBar: DummyHealthBar;

  beforeEach(() => {
    const existing = document.getElementById('dummy-healthbar-container');
    if (existing) existing.remove();
    activeDummies.length = 0;

    camera = new THREE.PerspectiveCamera(78, 1, 0.1, 1000);
    camera.position.set(0, 1.6, 5);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld(true);

    healthBar = new DummyHealthBar(camera);
  });

  afterEach(() => {
    healthBar.dispose();
    activeDummies.length = 0;
    meshRegistry.clear();
  });

  it('should create the wrapper container', () => {
    const container = document.getElementById('dummy-healthbar-container');
    expect(container).not.toBeNull();
  });

  it('should create a health bar for an active dummy', () => {
    const eid = 200;
    activeDummies.push(eid);
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
    const eid = 200;
    activeDummies.push(eid);
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
    const eid = 200;
    activeDummies.push(eid);
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
