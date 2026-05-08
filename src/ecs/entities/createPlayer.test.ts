import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWorld, hasComponent } from 'bitecs';
import * as THREE from 'three';
import { weaponIdToName } from '../systems/CombatSystem';
import { weaponModelFactories } from '../../rendering/WeaponModels';
import {
  Position,
  PreviousPosition,
  MovementState,
  MovementIntent,
  PhysicsBody,
  meshRegistry,
  hitboxColliderRegistry,
} from '../components';
import { resetMovementState } from '../systems/MovementSystem';
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  GROUND_TOP_Y,
  CHARACTER_CONTROLLER_OFFSET,
} from '../../core/types';

/**
 * Tests for createPlayer.
 *
 * The previous test file only validated weapon-name lookup. After issue
 * #104 we test the full factory by mocking Rapier just enough to capture
 * the ColliderDesc / RigidBodyDesc calls — the spec values that matter
 * (capsule offset, body translation, MovementIntent component) are
 * directly observable from the mock.
 */

/* ──────────────────────────────────────────────────────────
 * Pure-data sanity tests (kept from pre-#104 file)
 * ────────────────────────────────────────────────────────── */

describe('createPlayer defaults', () => {
  it('Dagger is at index 2 in weaponIdToName', () => {
    expect(weaponIdToName.indexOf('Dagger')).toBe(2);
  });

  it('weaponIdToName contains all 4 weapons', () => {
    expect(weaponIdToName).toEqual(['Longsword', 'Mace', 'Dagger', 'Battleaxe']);
  });

  it('all weapons have model factories registered in WeaponModels', () => {
    for (const name of weaponIdToName) {
      expect(weaponModelFactories[name]).toBeDefined();
      expect(typeof weaponModelFactories[name]).toBe('function');
    }
  });
});

/* ──────────────────────────────────────────────────────────
 * Feet-origin convention tests (issue #104)
 *
 * Builds a fully mocked Rapier world that records every RigidBodyDesc /
 * ColliderDesc creation, then runs the real createPlayer factory and
 * inspects the captured calls.
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

function createRapierMock() {
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
      // Used by spawnAtGround. Always reports a hit on the ground top so
      // the resolved feet Y becomes GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET.
      castRay: vi.fn().mockReturnValue({ timeOfImpact: 50 - GROUND_TOP_Y }),
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

describe('createPlayer — feet-origin convention (issue #104)', () => {
  beforeEach(() => {
    resetMovementState();
    meshRegistry.clear();
    hitboxColliderRegistry.clear();
  });

  it('creates a kinematicPositionBased body at the FEET (y = GROUND_TOP_Y + epsilon)', async () => {
    const { mock, world } = makeGameWorld();

    const { createPlayer } = await import('./createPlayer');
    createPlayer(world);

    // The first body created by createPlayer is the player's main capsule
    // body (the 6 hitbox bodies created later in createHitboxes are also
    // kinematicPositionBased, but they're created AFTER and at translation
    // {0,0,0} — they're positioned by hitboxSystem each tick).
    const playerBody = mock.bodies[0];
    expect(playerBody.type).toBe('kinematicPositionBased');
    expect(playerBody.translation.y).toBeCloseTo(
      GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET,
      5,
    );
  });

  it('main capsule collider is offset upward inside the body so bottom = body origin', async () => {
    const { mock, world } = makeGameWorld();
    const { createPlayer } = await import('./createPlayer');
    createPlayer(world);

    // The first collider attached to the player body is the capsule
    const playerBodyHandle = mock.bodies[0].handle;
    const playerCapsule = mock.colliders.find(
      (c) => c.shape === 'capsule' && c.bodyHandle === playerBodyHandle,
    );
    expect(playerCapsule).toBeDefined();

    expect(playerCapsule!.args).toEqual([CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]);

    const expectedOffset = CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT;
    expect(playerCapsule!.translation).toEqual({
      x: 0,
      y: expectedOffset,
      z: 0,
    });
    // 0.3 + 0.7 = 1.0 — sanity check the magic number
    expect(expectedOffset).toBeCloseTo(1.0, 5);
  });

  it('attaches MovementIntent and PhysicsBody components to the player', async () => {
    const { world } = makeGameWorld();
    const { createPlayer } = await import('./createPlayer');
    const { eid } = createPlayer(world);

    expect(hasComponent(world.ecs, MovementIntent, eid)).toBe(true);
    expect(hasComponent(world.ecs, PhysicsBody, eid)).toBe(true);
    expect(hasComponent(world.ecs, MovementState, eid)).toBe(true);
  });

  it('initializes MovementIntent fields to zero', async () => {
    const { world } = makeGameWorld();
    const { createPlayer } = await import('./createPlayer');
    const { eid } = createPlayer(world);

    expect(MovementIntent.moveX[eid]).toBe(0);
    expect(MovementIntent.moveZ[eid]).toBe(0);
    expect(MovementIntent.sprint[eid]).toBe(0);
    expect(MovementIntent.crouch[eid]).toBe(0);
    expect(MovementIntent.jumpRequested[eid]).toBe(0);
  });

  it('initializes Position and PreviousPosition to feet Y', async () => {
    const { world } = makeGameWorld();
    const { createPlayer } = await import('./createPlayer');
    const { eid } = createPlayer(world);

    const expectedY = GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET;
    expect(Position.y[eid]).toBeCloseTo(expectedY, 5);
    expect(PreviousPosition.y[eid]).toBeCloseTo(expectedY, 5);
  });

  it('mesh group placed at feet position (no offset)', async () => {
    const { world } = makeGameWorld();
    const { createPlayer } = await import('./createPlayer');
    const { mesh } = createPlayer(world);

    const expectedY = GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET;
    expect(mesh.position.y).toBeCloseTo(expectedY, 5);
    expect(mesh.position.x).toBe(0);
    expect(mesh.position.z).toBe(0);
  });

  it('explicit y override skips the spawnAtGround raycast', async () => {
    const { mock, world } = makeGameWorld();
    const { createPlayer } = await import('./createPlayer');
    const { eid } = createPlayer(world, { x: 2, y: 7.5, z: -1 });

    // castRay must not be called when an explicit Y is provided
    expect(mock.physicsWorld.castRay).not.toHaveBeenCalled();
    expect(Position.y[eid]).toBeCloseTo(7.5, 5);
  });
});
