/**
 * Tests for `pickupRenderer` (issue #127).
 *
 * Strategy: drive the renderer with hand-crafted `pickupRegistry` entries +
 * `WeaponPickup` component values, then assert on group rotation, position,
 * visibility, and material opacity for given (currentTick, despawnTick) pairs.
 *
 * Materials are real `MeshStandardMaterial` so we exercise the actual
 * `transparent`/`opacity` setters (no proxies).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createWorld } from 'bitecs';
import { WeaponPickup } from '../ecs/components';
import {
  pickupRegistry,
  resetPickupRegistry,
  type PickupData,
} from '../inventory/PickupRegistry';
import {
  pickupRenderer,
  DESPAWN_TICKS,
  BLINK_TICKS,
  PICKUP_RADIUS,
} from './PickupRenderer';
import type { GameWorld } from '../core/types';

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

/**
 * Factory that builds a real Three.js group with one mesh + one transparent
 * material. We use real Three.js objects rather than mocks so the renderer's
 * `material.transparent`/`opacity` setters and `group.userData` writes go
 * through the actual API.
 */
function makePickupData(): PickupData {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  mat.transparent = true; // mirrors createGroundPickupModel's sticky flip
  mat.opacity = 1;
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geom, mat);
  group.add(mesh);
  return { weaponName: 'Mace', group, materials: [mat] };
}

/** Stamp a pickup entry into the global registry + WeaponPickup component. */
function registerPickup(
  eid: number,
  spawnTick: number,
  despawnTick: number,
  baseY = 0.1,
): PickupData {
  const data = makePickupData();
  data.group.position.y = baseY;
  pickupRegistry.set(eid, data);
  WeaponPickup.spawnTick[eid] = spawnTick;
  WeaponPickup.despawnTick[eid] = despawnTick;
  return data;
}

describe('PickupRenderer constants', () => {
  // Pin the timeline values so #121 (which will eventually re-export them)
  // catches any unintended drift via test diff.
  it('DESPAWN_TICKS = 1800 (30s @ 60Hz)', () => {
    expect(DESPAWN_TICKS).toBe(1800);
  });

  it('BLINK_TICKS = 300 (5s @ 60Hz)', () => {
    expect(BLINK_TICKS).toBe(300);
  });

  it('PICKUP_RADIUS = 1.5 m', () => {
    expect(PICKUP_RADIUS).toBe(1.5);
  });
});

describe('pickupRenderer — spin', () => {
  let world: GameWorld;
  beforeEach(() => {
    resetPickupRegistry();
    world = makeMinimalWorld();
  });

  it('rotates group.rotation.y at 0.5 rad/s', () => {
    const data = registerPickup(1, 0, DESPAWN_TICKS);
    const initialY = data.group.rotation.y;
    pickupRenderer(world, 0, 1.0); // dt = 1s → +0.5 rad
    expect(data.group.rotation.y).toBeCloseTo(initialY + 0.5);
  });

  it('accumulates spin across multiple frames', () => {
    const data = registerPickup(1, 0, DESPAWN_TICKS);
    pickupRenderer(world, 0, 0.5);
    pickupRenderer(world, 1, 0.5);
    pickupRenderer(world, 2, 0.5);
    // 3 frames × 0.5s × 0.5 rad/s = 0.75 rad
    expect(data.group.rotation.y).toBeCloseTo(0.75);
  });
});

describe('pickupRenderer — bob', () => {
  let world: GameWorld;
  beforeEach(() => {
    resetPickupRegistry();
    world = makeMinimalWorld();
  });

  it('captures baseY on first frame and bobs around it', () => {
    const data = registerPickup(1, 0, DESPAWN_TICKS, 0.5);
    pickupRenderer(world, 0, 0.016);
    expect(data.group.userData.pickupBaseY).toBeCloseTo(0.5);
    // At tick=0, sin(0) = 0 → position = baseY exactly
    expect(data.group.position.y).toBeCloseTo(0.5);
  });

  it('peaks bob amplitude near 5cm', () => {
    const data = registerPickup(1, 0, DESPAWN_TICKS, 0.1);
    // Walk ticks until we cross both a peak and a trough. BOB_FREQ=2.0 rad/s,
    // dt per tick = 1/60s. Peak at sin(elapsedSec * 2) = 1 → elapsedSec = π/4.
    // Trough at elapsedSec = 3π/4 ≈ 2.36s → tick ≈ 142. Sample 240 ticks (4s)
    // so we're guaranteed at least one full oscillation regardless of the
    // discrete-tick alignment.
    let maxY = -Infinity;
    let minY = Infinity;
    for (let t = 0; t < 240; t++) {
      pickupRenderer(world, t, 0.016);
      maxY = Math.max(maxY, data.group.position.y);
      minY = Math.min(minY, data.group.position.y);
    }
    // Allow small numerical slack — the discrete tick sample may not hit the
    // exact extremum, so use 0.045 (1.0mm under nominal) as the floor.
    expect(maxY - 0.1).toBeGreaterThan(0.045);
    expect(maxY - 0.1).toBeLessThan(0.06);
    expect(0.1 - minY).toBeGreaterThan(0.045);
    expect(0.1 - minY).toBeLessThan(0.06);
  });
});

describe('pickupRenderer — fade window', () => {
  let world: GameWorld;
  beforeEach(() => {
    resetPickupRegistry();
    world = makeMinimalWorld();
  });

  it('opacity is 1.0 well before despawn (outside fade window)', () => {
    const data = registerPickup(1, 0, DESPAWN_TICKS); // despawn at 1800
    // ticksLeft = 1800 (>>> BLINK_TICKS=300)
    pickupRenderer(world, 0, 0.016);
    expect(data.materials[0].opacity).toBeCloseTo(1);
  });

  it('opacity is 1.0 at the boundary (ticksLeft === BLINK_TICKS)', () => {
    // currentTick = 1500, despawnTick = 1800 → ticksLeft = 300 = BLINK_TICKS
    // Fade ramp: t = 1.0 → opacity = 1.0
    const data = registerPickup(1, 0, 1800);
    pickupRenderer(world, 1500, 0.016);
    expect(data.materials[0].opacity).toBeCloseTo(1);
  });

  it('opacity is 0.3 at despawn moment (ticksLeft === 0)', () => {
    const data = registerPickup(1, 0, 1800);
    pickupRenderer(world, 1800, 0.016);
    expect(data.materials[0].opacity).toBeCloseTo(0.3);
  });

  it('opacity is 0.65 at midpoint of fade window (ticksLeft = 150)', () => {
    // (1.0 + 0.3) / 2 = 0.65
    const data = registerPickup(1, 0, 1800);
    pickupRenderer(world, 1650, 0.016);
    expect(data.materials[0].opacity).toBeCloseTo(0.65);
  });

  it('opacity clamps at 0.3 if currentTick overshoots despawnTick', () => {
    const data = registerPickup(1, 0, 1800);
    pickupRenderer(world, 1900, 0.016); // ticksLeft = -100
    expect(data.materials[0].opacity).toBeCloseTo(0.3);
  });

  it('material.transparent stays true throughout (sticky)', () => {
    const data = registerPickup(1, 0, 1800);
    pickupRenderer(world, 0, 0.016);
    expect(data.materials[0].transparent).toBe(true);
    pickupRenderer(world, 1500, 0.016);
    expect(data.materials[0].transparent).toBe(true);
    pickupRenderer(world, 1800, 0.016);
    expect(data.materials[0].transparent).toBe(true);
  });

  it('blink alternates group.visible at ~10Hz inside fade window', () => {
    const data = registerPickup(1, 0, 1800);
    // BLINK_PERIOD_TICKS = 6 → flip every 3 ticks. tick 1500 (in fade window):
    //   floor(1500/3) = 500 (even) → visible
    //   floor(1503/3) = 501 (odd)  → hidden
    pickupRenderer(world, 1500, 0.016);
    const v0 = data.group.visible;
    pickupRenderer(world, 1503, 0.016);
    const v1 = data.group.visible;
    expect(v0).not.toBe(v1);
  });

  it('group.visible is true outside fade window', () => {
    const data = registerPickup(1, 0, 1800);
    pickupRenderer(world, 0, 0.016);
    expect(data.group.visible).toBe(true);
  });

  it('restores opacity to 1.0 if a pickup leaves the fade window (defensive)', () => {
    // Hypothetical: despawnTick gets pushed out. Pickup should pop back to
    // full opacity rather than stay faded.
    const data = registerPickup(1, 0, 1800);
    pickupRenderer(world, 1700, 0.016); // in fade
    expect(data.materials[0].opacity).toBeLessThan(1);
    WeaponPickup.despawnTick[1] = 3600; // pushed out
    pickupRenderer(world, 1700, 0.016); // now ticksLeft = 1900, outside
    expect(data.materials[0].opacity).toBeCloseTo(1);
    expect(data.group.visible).toBe(true);
  });
});

describe('pickupRenderer — multi-pickup', () => {
  let world: GameWorld;
  beforeEach(() => {
    resetPickupRegistry();
    world = makeMinimalWorld();
  });

  it('processes multiple pickups independently', () => {
    const a = registerPickup(1, 0, 1800);
    const b = registerPickup(2, 1000, 2800); // different timeline
    pickupRenderer(world, 1700, 0.016);
    // a: ticksLeft = 100 → in fade
    expect(a.materials[0].opacity).toBeLessThan(1);
    // b: ticksLeft = 1100 → outside
    expect(b.materials[0].opacity).toBeCloseTo(1);
  });

  it('one pickup’s opacity does not affect another pickup’s materials', () => {
    const a = registerPickup(1, 0, 1800);
    const b = registerPickup(2, 0, 1800);
    // Materials must be distinct instances or the renderer would alias them.
    expect(a.materials[0]).not.toBe(b.materials[0]);
    pickupRenderer(world, 1800, 0.016);
    a.materials[0].opacity = 0.123; // simulate external mutation
    pickupRenderer(world, 1800, 0.016);
    expect(b.materials[0].opacity).toBeCloseTo(0.3);
  });
});
