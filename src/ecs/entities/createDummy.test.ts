import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWorld, hasComponent, addComponent } from 'bitecs';
import * as THREE from 'three';
import {
  Position,
  Rotation,
  Health,
  Stamina,
  CharacterModel,
  Hitboxes,
  PhysicsBody,
  CombatStateComponent,
  meshRegistry,
  hitboxColliderRegistry,
} from '../components';
import {
  activeDummies,
  dummyLastHitTick,
  toggleDummyBlock,
  cycleDummyBlockDirection,
  resetAllDummies,
  tickDummyHealthReset,
  recordDummyHit,
} from './createDummy';
import { CombatState } from '../../combat/states';
import { BlockDirection } from '../../combat/directions';
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  GROUND_TOP_Y,
  CHARACTER_CONTROLLER_OFFSET,
} from '../../core/types';

/**
 * Tests for createDummy and dummy management functions.
 *
 * Note: createDummy itself requires Rapier WASM + Three.js scene, so we test
 * the management functions (toggleBlock, cycleDirection, resetAll, healthReset)
 * using mocked ECS state.
 */

// Helper: set up a fake dummy in the ECS arrays (no Rapier/Three needed)
function setupFakeDummy(eid: number): void {
  // Push into activeDummies if not already there
  if (!activeDummies.includes(eid)) {
    activeDummies.push(eid);
  }
  // Set component values directly on the typed arrays
  Health.current[eid] = 100;
  Health.max[eid] = 100;
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;
  CombatStateComponent.state[eid] = CombatState.Idle;
  CombatStateComponent.blockDirection[eid] = BlockDirection.Top;
  CombatStateComponent.ticksRemaining[eid] = 0;
  dummyLastHitTick.set(eid, -999);
}

function clearDummies(): void {
  activeDummies.length = 0;
  dummyLastHitTick.clear();
}

describe('Dummy management functions', () => {
  beforeEach(() => {
    clearDummies();
  });

  describe('toggleDummyBlock', () => {
    it('should toggle dummy from Idle to Block', () => {
      setupFakeDummy(100);
      const result = toggleDummyBlock();
      expect(CombatStateComponent.state[100]).toBe(CombatState.Block);
      expect(result).toContain('Block');
    });

    it('should toggle dummy from Block back to Idle', () => {
      setupFakeDummy(100);
      CombatStateComponent.state[100] = CombatState.Block;
      const result = toggleDummyBlock();
      expect(CombatStateComponent.state[100]).toBe(CombatState.Idle);
      expect(result).toBe('Idle');
    });

    it('should return "No dummies" when no dummies exist', () => {
      expect(toggleDummyBlock()).toBe('No dummies');
    });

    it('should toggle all dummies at once', () => {
      setupFakeDummy(100);
      setupFakeDummy(101);
      toggleDummyBlock();
      expect(CombatStateComponent.state[100]).toBe(CombatState.Block);
      expect(CombatStateComponent.state[101]).toBe(CombatState.Block);
    });
  });

  describe('cycleDummyBlockDirection', () => {
    it('should cycle from Top to Bottom', () => {
      setupFakeDummy(100);
      CombatStateComponent.blockDirection[100] = BlockDirection.Top;
      const result = cycleDummyBlockDirection();
      expect(result).toBe('Bottom');
      expect(CombatStateComponent.blockDirection[100]).toBe(BlockDirection.Bottom);
    });

    it('should cycle through all directions and wrap around', () => {
      setupFakeDummy(100);
      CombatStateComponent.blockDirection[100] = BlockDirection.Top;

      cycleDummyBlockDirection(); // Top -> Bottom
      expect(CombatStateComponent.blockDirection[100]).toBe(BlockDirection.Bottom);

      cycleDummyBlockDirection(); // Bottom -> Left
      expect(CombatStateComponent.blockDirection[100]).toBe(BlockDirection.Left);

      cycleDummyBlockDirection(); // Left -> Right
      expect(CombatStateComponent.blockDirection[100]).toBe(BlockDirection.Right);

      cycleDummyBlockDirection(); // Right -> Top (wrap)
      expect(CombatStateComponent.blockDirection[100]).toBe(BlockDirection.Top);
    });

    it('should return "No dummies" when no dummies exist', () => {
      expect(cycleDummyBlockDirection()).toBe('No dummies');
    });
  });

  describe('resetAllDummies', () => {
    it('should reset health, stamina, and state', () => {
      setupFakeDummy(100);
      Health.current[100] = 30;
      Stamina.current[100] = 20;
      CombatStateComponent.state[100] = CombatState.HitStun;
      CombatStateComponent.ticksRemaining[100] = 15;

      // resetAllDummies needs a GameWorld but only uses activeDummies array
      resetAllDummies({} as any);

      expect(Health.current[100]).toBe(100);
      expect(Stamina.current[100]).toBe(100);
      expect(CombatStateComponent.state[100]).toBe(CombatState.Idle);
      expect(CombatStateComponent.ticksRemaining[100]).toBe(0);
    });
  });

  describe('tickDummyHealthReset', () => {
    it('should reset health after enough ticks without being hit', () => {
      setupFakeDummy(100);
      Health.current[100] = 50;
      dummyLastHitTick.set(100, 0);

      // Tick 180+ times (3 seconds at 60Hz)
      for (let i = 0; i < 200; i++) {
        tickDummyHealthReset();
      }

      expect(Health.current[100]).toBe(100);
    });

    it('should not reset health if dummy was recently hit', () => {
      setupFakeDummy(100);
      Health.current[100] = 50;

      // Record a recent hit
      recordDummyHit(100);

      // Only tick a few times
      for (let i = 0; i < 10; i++) {
        tickDummyHealthReset();
      }

      expect(Health.current[100]).toBe(50);
    });
  });
});

/* ──────────────────────────────────────────────────────────
 * Feet-origin + fixed-body convention tests (issue #104)
 *
 * Mocks Rapier just enough to record body / collider creation calls
 * and runs the real createDummy factory.
 * ────────────────────────────────────────────────────────── */

interface CapturedBody {
  translation: { x: number; y: number; z: number };
  type: 'kinematicPositionBased' | 'fixed';
  handle: number;
}
interface CapturedCollider {
  shape: 'capsule' | 'cuboid';
  args: number[];
  translation?: { x: number; y: number; z: number };
  isSensor: boolean;
  bodyHandle: number;
  handle: number;
}

function createRapierMock(rayHitToi = 50 - GROUND_TOP_Y) {
  const bodies: CapturedBody[] = [];
  const colliders: CapturedCollider[] = [];

  function makeRigidBodyDesc(type: 'kinematicPositionBased' | 'fixed') {
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

  function makeColliderDesc(
    shape: 'capsule' | 'cuboid',
    args: number[],
  ): any {
    const desc: any = {
      shape,
      args,
      translation: undefined as { x: number; y: number; z: number } | undefined,
      isSensor: false,
      setTranslation(x: number, y: number, z: number) {
        desc.translation = { x, y, z };
        return desc;
      },
      setSensor(v: boolean) {
        desc.isSensor = v;
        return desc;
      },
    };
    return desc;
  }

  let nextHandle = 1;

  return {
    bodies,
    colliders,
    rapier: {
      RigidBodyDesc: {
        kinematicPositionBased: () => makeRigidBodyDesc('kinematicPositionBased'),
        fixed: () => makeRigidBodyDesc('fixed'),
      },
      ColliderDesc: {
        capsule: (halfHeight: number, radius: number) =>
          makeColliderDesc('capsule', [halfHeight, radius]),
        cuboid: (hx: number, hy: number, hz: number) =>
          makeColliderDesc('cuboid', [hx, hy, hz]),
      },
      Vector3: vi.fn().mockImplementation((x: number, y: number, z: number) => ({ x, y, z })),
      Ray: vi.fn().mockImplementation((origin: any, dir: any) => ({ origin, dir })),
    },
    physicsWorld: {
      createRigidBody: vi.fn((desc: any) => {
        const handle = nextHandle++;
        bodies.push({ translation: desc.translation, type: desc.type, handle });
        return { handle, translation: () => desc.translation };
      }),
      createCollider: vi.fn((desc: any, body: any) => {
        const handle = nextHandle++;
        colliders.push({
          shape: desc.shape,
          args: desc.args,
          translation: desc.translation,
          isSensor: desc.isSensor,
          bodyHandle: body.handle,
          handle,
        });
        return { handle };
      }),
      castRay: vi.fn().mockReturnValue({ timeOfImpact: rayHitToi }),
    },
    scene: new THREE.Scene(),
  };
}

function makeGameWorld() {
  const mock = createRapierMock();
  return {
    mock,
    world: {
      ecs: createWorld(),
      rapier: mock.rapier,
      physicsWorld: mock.physicsWorld,
      scene: mock.scene,
    } as any,
  };
}

describe('createDummy — feet-origin + fixed-body convention (issue #104)', () => {
  beforeEach(() => {
    activeDummies.length = 0;
    dummyLastHitTick.clear();
    meshRegistry.clear();
    hitboxColliderRegistry.clear();
  });

  it('creates a FIXED body (not kinematic) with feet at GROUND_TOP_Y + epsilon', async () => {
    const { mock, world } = makeGameWorld();
    const { createDummy } = await import('./createDummy');

    createDummy(world, 0, -3);

    // The first body is the dummy's main capsule body (the 6 hitbox bodies
    // come later via createHitboxes and are kinematicPositionBased).
    const dummyBody = mock.bodies[0];
    expect(dummyBody.type).toBe('fixed');
    expect(dummyBody.translation.x).toBe(0);
    expect(dummyBody.translation.z).toBe(-3);
    expect(dummyBody.translation.y).toBeCloseTo(
      GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET,
      5,
    );
  });

  it('main capsule collider has the same upward offset as the player', async () => {
    const { mock, world } = makeGameWorld();
    const { createDummy } = await import('./createDummy');
    createDummy(world, 0, -3);

    const dummyBodyHandle = mock.bodies[0].handle;
    const dummyCapsule = mock.colliders.find(
      (c) => c.shape === 'capsule' && c.bodyHandle === dummyBodyHandle,
    );
    expect(dummyCapsule).toBeDefined();
    expect(dummyCapsule!.args).toEqual([CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]);
    expect(dummyCapsule!.translation).toEqual({
      x: 0,
      y: CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT,
      z: 0,
    });
    // Dummy capsule is NOT a sensor (it's a static obstacle the player collides with)
    expect(dummyCapsule!.isSensor).toBe(false);
  });

  it('attaches PhysicsBody component with correct handles', async () => {
    const { mock, world } = makeGameWorld();
    const { createDummy } = await import('./createDummy');
    const eid = createDummy(world, 0, -3);

    expect(hasComponent(world.ecs, PhysicsBody, eid)).toBe(true);

    const dummyBody = mock.bodies[0];
    const dummyCapsule = mock.colliders.find(
      (c) => c.shape === 'capsule' && c.bodyHandle === dummyBody.handle,
    );
    expect(PhysicsBody.bodyHandle[eid]).toBe(dummyBody.handle);
    expect(PhysicsBody.colliderHandle[eid]).toBe(dummyCapsule!.handle);
  });

  it('mesh group placed at feet (Position) with no Y offset', async () => {
    const { world } = makeGameWorld();
    const { createDummy } = await import('./createDummy');
    const eid = createDummy(world, 2.5, -4.5);

    const modelData = meshRegistry.get(eid);
    expect(modelData).toBeDefined();
    expect(modelData!.group.position.x).toBe(2.5);
    expect(modelData!.group.position.z).toBe(-4.5);
    expect(modelData!.group.position.y).toBeCloseTo(
      GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET,
      5,
    );
    // Position component matches mesh
    expect(Position.y[eid]).toBeCloseTo(modelData!.group.position.y, 5);
  });

  it('explicit y override skips the spawnAtGround raycast', async () => {
    const { mock, world } = makeGameWorld();
    const { createDummy } = await import('./createDummy');
    const eid = createDummy(world, 0, -3, 0xcc4444, 9.0);

    expect(mock.physicsWorld.castRay).not.toHaveBeenCalled();
    expect(Position.y[eid]).toBeCloseTo(9.0, 5);
  });
});
