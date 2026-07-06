/**
 * Tests for `src/world/SpawnPoints.ts` — the spawn-point registry and the
 * `selectSpawnPoint` weighted-random algorithm. Issue #134.
 *
 * The algorithm is deterministic given (a) the registered spawn points,
 * (b) the enemy positions, and (c) the `random: () => number` hook. We
 * inject a stub random in every test so no assertion depends on
 * Math.random's distribution.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { addEntity, addComponent, createWorld, type IWorld } from 'bitecs';
import { Position } from '../ecs/components';
import {
  spawnPointRegistry,
  registerSpawnPoint,
  clearSpawnPoints,
  selectSpawnPoint,
  seedPlaceholderSpawnPoints,
  type SpawnPoint,
} from './SpawnPoints';
import { SPAWN_HEIGHT } from '../core/types';

/** Stub random that returns a fixed sequence (cycles when exhausted). */
function makeStubRandom(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** Place a Position component on a fresh eid. */
function makeEnemyAt(
  ecs: IWorld,
  x: number,
  y: number,
  z: number,
): number {
  const eid = addEntity(ecs);
  addComponent(ecs, Position, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;
  return eid;
}

describe('SpawnPoints registry', () => {
  beforeEach(() => {
    clearSpawnPoints();
  });

  it('starts empty', () => {
    expect(spawnPointRegistry.size).toBe(0);
  });

  it('registerSpawnPoint stores by id', () => {
    registerSpawnPoint({ id: 1, position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    registerSpawnPoint({ id: 2, position: { x: 5, y: 0, z: 0 }, yaw: Math.PI });
    expect(spawnPointRegistry.size).toBe(2);
    expect(spawnPointRegistry.get(1)).toEqual({
      id: 1,
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
    });
  });

  it('registerSpawnPoint overwrites a duplicate id', () => {
    registerSpawnPoint({ id: 7, position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    registerSpawnPoint({ id: 7, position: { x: 1, y: 1, z: 1 }, yaw: 1 });
    expect(spawnPointRegistry.size).toBe(1);
    expect(spawnPointRegistry.get(7)?.position.x).toBe(1);
  });

  it('clearSpawnPoints empties the registry', () => {
    registerSpawnPoint({ id: 1, position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    clearSpawnPoints();
    expect(spawnPointRegistry.size).toBe(0);
  });
});

describe('selectSpawnPoint', () => {
  let ecs: IWorld;

  beforeEach(() => {
    clearSpawnPoints();
    ecs = createWorld();
  });

  it('returns null when registry is empty', () => {
    const result = selectSpawnPoint({ enemies: [] });
    expect(result).toBeNull();
  });

  describe('no enemies → uniform random', () => {
    it('picks the first when random returns 0', () => {
      registerSpawnPoint({ id: 1, position: { x: 1, y: 0, z: 0 }, yaw: 0 });
      registerSpawnPoint({ id: 2, position: { x: 2, y: 0, z: 0 }, yaw: 0 });
      registerSpawnPoint({ id: 3, position: { x: 3, y: 0, z: 0 }, yaw: 0 });

      const result = selectSpawnPoint({
        enemies: [],
        random: makeStubRandom(0),
      });
      // candidates iteration order is insertion order for a Map
      expect(result?.id).toBe(1);
    });

    it('picks the last when random returns just under 1', () => {
      registerSpawnPoint({ id: 1, position: { x: 1, y: 0, z: 0 }, yaw: 0 });
      registerSpawnPoint({ id: 2, position: { x: 2, y: 0, z: 0 }, yaw: 0 });
      registerSpawnPoint({ id: 3, position: { x: 3, y: 0, z: 0 }, yaw: 0 });

      const result = selectSpawnPoint({
        enemies: [],
        random: makeStubRandom(0.999),
      });
      expect(result?.id).toBe(3);
    });

    it('picks the middle when random returns 0.5 (3 candidates)', () => {
      registerSpawnPoint({ id: 1, position: { x: 1, y: 0, z: 0 }, yaw: 0 });
      registerSpawnPoint({ id: 2, position: { x: 2, y: 0, z: 0 }, yaw: 0 });
      registerSpawnPoint({ id: 3, position: { x: 3, y: 0, z: 0 }, yaw: 0 });

      const result = selectSpawnPoint({
        enemies: [],
        random: makeStubRandom(0.5),
      });
      // floor(0.5 * 3) = 1 → middle entry
      expect(result?.id).toBe(2);
    });

    it('uses Math.random by default', () => {
      registerSpawnPoint({ id: 42, position: { x: 0, y: 0, z: 0 }, yaw: 0 });
      // Single-candidate registry: Math.random's value doesn't affect outcome.
      const result = selectSpawnPoint({ enemies: [] });
      expect(result?.id).toBe(42);
    });
  });

  describe('enemies clustered near one point → that point excluded', () => {
    it('filters out the dangerous point and picks from the safe set', () => {
      // Two spawn points: one safely far from the cluster, one inside it.
      registerSpawnPoint({
        id: 1,
        position: { x: 100, y: 0, z: 100 }, // safe
        yaw: 0,
      });
      registerSpawnPoint({
        id: 2,
        position: { x: 0, y: 0, z: 0 }, // dangerous
        yaw: 0,
      });

      // Cluster of three enemies near (0, 0, 0)
      const e1 = makeEnemyAt(ecs, 0, 0, 0);
      const e2 = makeEnemyAt(ecs, 1, 0, 1);
      const e3 = makeEnemyAt(ecs, -1, 0, -1);

      const result = selectSpawnPoint({
        enemies: [e1, e2, e3],
        random: makeStubRandom(0), // pick first of safe set
      });
      // Only id=1 clears the 8.0 default safe distance.
      expect(result?.id).toBe(1);
    });

    it('still picks the single safe point regardless of random', () => {
      registerSpawnPoint({
        id: 1,
        position: { x: 50, y: 0, z: 50 }, // safe
        yaw: 0,
      });
      registerSpawnPoint({
        id: 2,
        position: { x: 0, y: 0, z: 0 }, // dangerous (enemy on top)
        yaw: 0,
      });
      const enemy = makeEnemyAt(ecs, 0, 0, 0);

      // Try multiple random values — only id=1 is in the safe set, so
      // random's value can only index into a size-1 array.
      for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
        const result = selectSpawnPoint({
          enemies: [enemy],
          random: makeStubRandom(r),
        });
        expect(result?.id).toBe(1);
      }
    });

    it('respects a custom minEnemyDistance', () => {
      registerSpawnPoint({ id: 1, position: { x: 5, y: 0, z: 0 }, yaw: 0 });
      registerSpawnPoint({ id: 2, position: { x: 20, y: 0, z: 0 }, yaw: 0 });
      const enemy = makeEnemyAt(ecs, 0, 0, 0);

      // With a large threshold (15), only id=2 clears it.
      const result = selectSpawnPoint({
        enemies: [enemy],
        minEnemyDistance: 15,
        random: makeStubRandom(0),
      });
      expect(result?.id).toBe(2);
    });
  });

  describe('all candidates within minEnemyDistance → max-min fallback', () => {
    it('returns the candidate furthest from its nearest enemy', () => {
      registerSpawnPoint({ id: 1, position: { x: 0, y: 0, z: 0 }, yaw: 0 });
      registerSpawnPoint({ id: 2, position: { x: 1, y: 0, z: 0 }, yaw: 0 });
      registerSpawnPoint({ id: 3, position: { x: 5, y: 0, z: 0 }, yaw: 0 });

      // Enemy at origin: distances are 0, 1, 5 — none clear the 8.0 threshold.
      // Max-min fallback should pick id=3 (furthest).
      const enemy = makeEnemyAt(ecs, 0, 0, 0);

      const result = selectSpawnPoint({
        enemies: [enemy],
        random: makeStubRandom(0), // ignored on the fallback path
      });
      expect(result?.id).toBe(3);
    });

    it('uses 3D distance (Y matters, not just X/Z)', () => {
      // Two candidates at the same X/Z but different Y; enemy at one of them.
      registerSpawnPoint({ id: 1, position: { x: 0, y: 0, z: 0 }, yaw: 0 });
      registerSpawnPoint({ id: 2, position: { x: 0, y: 4, z: 0 }, yaw: 0 });
      const enemy = makeEnemyAt(ecs, 0, 0, 0);

      // Enemy at (0,0,0): id=1 distance 0, id=2 distance 4. Both within 8.0
      // threshold → max-min fallback → id=2.
      const result = selectSpawnPoint({ enemies: [enemy] });
      expect(result?.id).toBe(2);
    });

    it('first wins on exact tie under max-min', () => {
      registerSpawnPoint({ id: 1, position: { x: 0, y: 0, z: 0 }, yaw: 0 });
      registerSpawnPoint({ id: 2, position: { x: 4, y: 0, z: 0 }, yaw: 0 });
      // Enemy equidistant from both candidates (at midpoint).
      const enemy = makeEnemyAt(ecs, 2, 0, 0);

      const result = selectSpawnPoint({ enemies: [enemy] });
      // Both have distToNearest = 2; first one (insertion order) wins.
      expect(result?.id).toBe(1);
    });
  });

  describe('multi-enemy distance is the NEAREST enemy', () => {
    it('rejects a point that is far from one enemy but close to another', () => {
      registerSpawnPoint({ id: 1, position: { x: 0, y: 0, z: 0 }, yaw: 0 });
      registerSpawnPoint({ id: 2, position: { x: 100, y: 0, z: 100 }, yaw: 0 });

      // Enemies: one far from id=1, one ON id=1
      const farEnemy = makeEnemyAt(ecs, 50, 0, 50);
      const closeEnemy = makeEnemyAt(ecs, 0, 0, 0);

      const result = selectSpawnPoint({
        enemies: [farEnemy, closeEnemy],
        random: makeStubRandom(0),
      });
      // id=1 nearest = closeEnemy (dist 0). id=2 nearest = farEnemy
      // (dist sqrt(50²+50²) ≈ 70.7). Only id=2 clears 8.0.
      expect(result?.id).toBe(2);
    });
  });
});

describe('seedPlaceholderSpawnPoints', () => {
  beforeEach(() => clearSpawnPoints());

  it('registers exactly 4 corner points', () => {
    seedPlaceholderSpawnPoints();
    expect(spawnPointRegistry.size).toBe(4);
  });

  it('places points at (±10, SPAWN_HEIGHT, ±10)', () => {
    seedPlaceholderSpawnPoints();
    const positions = Array.from(spawnPointRegistry.values()).map(
      (sp) => sp.position,
    );
    const expected = [
      { x: 10, y: SPAWN_HEIGHT, z: 10 },
      { x: 10, y: SPAWN_HEIGHT, z: -10 },
      { x: -10, y: SPAWN_HEIGHT, z: 10 },
      { x: -10, y: SPAWN_HEIGHT, z: -10 },
    ];
    expect(positions).toEqual(expect.arrayContaining(expected));
  });

  it('uses 1-based ids so 0 stays as the sentinel', () => {
    seedPlaceholderSpawnPoints();
    const ids = Array.from(spawnPointRegistry.values())
      .map((sp) => sp.id)
      .sort();
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it('each spawn`s world forward vector points at the origin', () => {
    seedPlaceholderSpawnPoints();
    for (const sp of spawnPointRegistry.values()) {
      // forward = (-sin yaw, -cos yaw) under the project convention.
      const fwdX = -Math.sin(sp.yaw);
      const fwdZ = -Math.cos(sp.yaw);
      // Unit vector from the spawn toward the origin (0,0).
      const toX = -sp.position.x;
      const toZ = -sp.position.z;
      const len = Math.hypot(toX, toZ);
      // dot(forward, normalize(origin - pos)) ≈ 1 iff forward points at origin.
      const dot = (fwdX * toX + fwdZ * toZ) / len;
      expect(dot).toBeCloseTo(1, 5);
    }
  });

  it('the (10,_,10) corner faces the origin specifically (yaw = π/4)', () => {
    seedPlaceholderSpawnPoints();
    const corner = Array.from(spawnPointRegistry.values()).find(
      (sp) => sp.position.x === 10 && sp.position.z === 10,
    );
    expect(corner).toBeDefined();
    // yawTowards(10, 10) = atan2(10, 10) = π/4 → forward (-sin, -cos) = (-√½,-√½)
    // which points toward (0,0) from (10,10). (The old -3π/4 faced AWAY.)
    expect(corner!.yaw).toBeCloseTo(Math.PI * 0.25, 5);
  });
});

describe('selectSpawnPoint with the placeholder set', () => {
  let ecs: IWorld;

  beforeEach(() => {
    clearSpawnPoints();
    seedPlaceholderSpawnPoints();
    ecs = createWorld();
  });

  it('all four corners are far enough apart to all be safe with one enemy', () => {
    // Enemy at origin: distance to each corner is sqrt(10² + 10²) ≈ 14.14,
    // which clears the 8.0 default threshold. All four are safe.
    const enemy = makeEnemyAt(ecs, 0, 0, 0);
    const visited = new Set<number>();
    for (let r = 0; r < 100; r++) {
      const result = selectSpawnPoint({
        enemies: [enemy],
        random: makeStubRandom(r / 100),
      });
      if (result) visited.add(result.id);
    }
    // We should have hit all 4 corners across the range of randoms.
    expect(visited.size).toBe(4);
  });

  it('cluster on one corner forces selection elsewhere', () => {
    // Pile three enemies on the (10, _, 10) corner.
    const e1 = makeEnemyAt(ecs, 10, SPAWN_HEIGHT, 10);
    const e2 = makeEnemyAt(ecs, 11, SPAWN_HEIGHT, 10);
    const e3 = makeEnemyAt(ecs, 10, SPAWN_HEIGHT, 11);

    // Sample many random values; (10,10) should never come up as the chosen
    // safe spawn — distance to nearest enemy is < 8.0 there.
    for (let r = 0; r < 100; r++) {
      const result: SpawnPoint | null = selectSpawnPoint({
        enemies: [e1, e2, e3],
        random: makeStubRandom(r / 100),
      });
      expect(result).not.toBeNull();
      expect(
        !(result!.position.x === 10 && result!.position.z === 10),
      ).toBe(true);
    }
  });
});
