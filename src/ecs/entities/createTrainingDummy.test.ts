import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createWorld,
  hasComponent,
  removeComponent,
  defineQuery,
} from 'bitecs';
import * as THREE from 'three';
import {
  Position,
  Health,
  Stamina,
  CharacterModel,
  Hitboxes,
  PhysicsBody,
  CombatStateComponent,
  IsNPC,
  IsTrainingDummy,
  meshRegistry,
  hitboxColliderRegistry,
} from '../components';
import {
  createTrainingDummy,
  removeTrainingDummy,
  resetAllTrainingDummies,
  toggleTrainingDummyBlock,
  cycleTrainingDummyBlockDirection,
  tickTrainingDummyHealthReset,
  recordNpcHit,
  npcLastHitTick,
  HEALTH_RESET_TICKS,
  getTrainingDummyEids,
  getNpcEids,
  isNpc,
  isTrainingDummy,
} from './createTrainingDummy';
import { CombatState } from '../../combat/states';
import { Direction } from '../../combat/directions';
import { CombatFSM, fsmRegistry } from '../../combat/CombatFSM';
import { npcRegistry, clearNpcRegistry } from '../npcRegistry';
import {
  advanceFixedTick,
  resetFixedTick,
  getCurrentFixedTick,
} from '../../core/tickCounter';
import type { WeaponConfig } from '../../weapons/WeaponConfig';
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  GROUND_TOP_Y,
  CHARACTER_CONTROLLER_OFFSET,
} from '../../core/types';

// Side-effect imports — auto-register the real weapon configs so the
// default-starter-weapon assertions can exercise the production code path.
import '../../weapons/longsword';
import '../../weapons/mace';
import '../../weapons/dagger';
import '../../weapons/battleaxe';

/* ──────────────────────────────────────────────────────────
 * Tests for createTrainingDummy (issue #114)
 *
 * The factory itself requires Rapier WASM + Three.js scene; tests use a
 * minimal Rapier mock + a real createWorld + Three.js scene.
 * ────────────────────────────────────────────────────────── */

function makeTestWeapon(): WeaponConfig {
  const ticks = {
    [Direction.Left]: 6,
    [Direction.Right]: 6,
    [Direction.Overhead]: 8,
    [Direction.Stab]: 5,
  };
  return {
    name: 'TestSword',
    damage: {
      [Direction.Left]: { head: 50, torso: 35, limb: 25 },
      [Direction.Right]: { head: 50, torso: 35, limb: 25 },
      [Direction.Overhead]: { head: 55, torso: 40, limb: 25 },
      [Direction.Stab]: { head: 45, torso: 40, limb: 20 },
    },
    windup: { ...ticks },
    release: {
      [Direction.Left]: 4,
      [Direction.Right]: 4,
      [Direction.Overhead]: 5,
      [Direction.Stab]: 3,
    },
    recovery: {
      [Direction.Left]: 12,
      [Direction.Right]: 12,
      [Direction.Overhead]: 15,
      [Direction.Stab]: 10,
    },
    comboRecovery: {
      [Direction.Left]: 8,
      [Direction.Right]: 8,
      [Direction.Overhead]: 10,
      [Direction.Stab]: 6,
    },
    parryWindow: 6,
    parryRecovery: 10,
    blockBreakStunTicks: 28,
    staminaCost: { attack: 15, block: 10, parry: 5 },
    turncap: { windup: 0.08, release: 0.03, recovery: 0.05, hitStun: 0.005 },
    tracerPoints: [[0, 0.5, 0]],
    range: 1.4,
    blockStaminaDrain: 10,
    parryStunTicks: 40,
    hitStunTicks: 30,
  };
}

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

  function makeColliderDesc(shape: 'capsule' | 'cuboid', args: number[]) {
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
      Vector3: vi
        .fn()
        .mockImplementation((x: number, y: number, z: number) => ({ x, y, z })),
      Ray: vi
        .fn()
        .mockImplementation((origin: any, dir: any) => ({ origin, dir })),
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
      playerEntity: 0,
      camera: undefined as any,
      renderer: undefined as any,
    } as any,
  };
}

beforeEach(() => {
  meshRegistry.clear();
  hitboxColliderRegistry.clear();
  fsmRegistry.clear();
  clearNpcRegistry();
  npcLastHitTick.clear();
  resetFixedTick();
});

afterEach(() => {
  meshRegistry.clear();
  hitboxColliderRegistry.clear();
  fsmRegistry.clear();
  clearNpcRegistry();
  npcLastHitTick.clear();
  resetFixedTick();
});

describe('createTrainingDummy — physics + tagging contract (issue #114)', () => {
  it('attaches IsNPC and IsTrainingDummy tags', () => {
    const { world } = makeGameWorld();
    const { eid } = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    expect(hasComponent(world.ecs, IsNPC, eid)).toBe(true);
    expect(hasComponent(world.ecs, IsTrainingDummy, eid)).toBe(true);
  });

  it('attaches PhysicsBody, Health, Stamina, Hitboxes', () => {
    const { world } = makeGameWorld();
    const { eid } = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    expect(hasComponent(world.ecs, PhysicsBody, eid)).toBe(true);
    expect(hasComponent(world.ecs, Health, eid)).toBe(true);
    expect(hasComponent(world.ecs, Stamina, eid)).toBe(true);
    expect(hasComponent(world.ecs, Hitboxes, eid)).toBe(true);
    expect(hasComponent(world.ecs, CharacterModel, eid)).toBe(true);
  });

  it('creates a FIXED body (not kinematic) with feet at GROUND_TOP_Y + epsilon when Y is raycast-resolved', () => {
    const { mock, world } = makeGameWorld();
    createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    const dummyBody = mock.bodies[0];
    expect(dummyBody.type).toBe('fixed');
    expect(dummyBody.translation.x).toBe(0);
    expect(dummyBody.translation.z).toBe(-3);
    expect(dummyBody.translation.y).toBeCloseTo(
      GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET,
      5,
    );
  });

  it('main capsule collider has the same upward offset as the player', () => {
    const { mock, world } = makeGameWorld();
    createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });

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

  it('mesh group placed at feet (Position) with no Y offset', () => {
    const { world } = makeGameWorld();
    const { eid } = createTrainingDummy(world, {
      spawnPos: { x: 2.5, z: -4.5 },
    });
    const modelData = meshRegistry.get(eid);
    expect(modelData).toBeDefined();
    expect(modelData!.group.position.x).toBe(2.5);
    expect(modelData!.group.position.z).toBe(-4.5);
    expect(modelData!.group.position.y).toBeCloseTo(
      GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET,
      5,
    );
    expect(Position.y[eid]).toBeCloseTo(modelData!.group.position.y, 5);
  });

  it('explicit y override skips the spawnAtGround raycast', () => {
    const { mock, world } = makeGameWorld();
    const { eid } = createTrainingDummy(world, {
      spawnPos: { x: 0, y: 9.0, z: -3 },
    });

    expect(mock.physicsWorld.castRay).not.toHaveBeenCalled();
    expect(Position.y[eid]).toBeCloseTo(9.0, 5);
  });

  it('registers an NpcMeta entry in npcRegistry', () => {
    const { world } = makeGameWorld();
    const { eid } = createTrainingDummy(world, { spawnPos: { x: 1, z: -2 } });
    const meta = npcRegistry.get(eid);
    expect(meta).toBeDefined();
    expect(meta!.kind).toBe('training-dummy');
    expect(meta!.spawnPos.x).toBe(1);
    expect(meta!.spawnPos.z).toBe(-2);
  });

  it('default starting weapon is Dagger (registered in fsmRegistry)', () => {
    const { world } = makeGameWorld();
    const { eid } = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    expect(fsmRegistry.has(eid)).toBe(true);
  });

  it('startingWeapon: null leaves the dummy unarmed (no FSM registered)', () => {
    const { world } = makeGameWorld();
    const { eid } = createTrainingDummy(world, {
      spawnPos: { x: 0, z: -3 },
      startingWeapon: null,
    });
    expect(fsmRegistry.has(eid)).toBe(false);
  });

  it('facing rotates the mesh', () => {
    const { world } = makeGameWorld();
    const facing = Math.PI / 2;
    const { mesh } = createTrainingDummy(world, {
      spawnPos: { x: 0, z: -3 },
      facing,
    });
    expect(mesh.rotation.y).toBeCloseTo(facing, 5);
  });

  it('sets HP=Stamina=100 and Idle state', () => {
    const { world } = makeGameWorld();
    const { eid } = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    expect(Health.current[eid]).toBe(100);
    expect(Health.max[eid]).toBe(100);
    expect(Stamina.current[eid]).toBe(100);
    expect(Stamina.max[eid]).toBe(100);
    expect(CombatStateComponent.state[eid]).toBe(CombatState.Idle);
  });
});

describe('removeTrainingDummy', () => {
  it('removes the dummy from registries and the ECS world', () => {
    const { world } = makeGameWorld();
    const { eid } = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    expect(npcRegistry.has(eid)).toBe(true);
    expect(meshRegistry.has(eid)).toBe(true);

    removeTrainingDummy(world, eid);
    expect(npcRegistry.has(eid)).toBe(false);
    expect(meshRegistry.has(eid)).toBe(false);
    expect(npcLastHitTick.has(eid)).toBe(false);
  });

  it('is safe to call with an unknown eid', () => {
    const { world } = makeGameWorld();
    expect(() => removeTrainingDummy(world, 99999)).not.toThrow();
  });
});

describe('resetAllTrainingDummies — tag-driven', () => {
  it('K reset queries IsTrainingDummy (not a hardcoded array)', () => {
    const { world } = makeGameWorld();
    const a = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    const b = createTrainingDummy(world, { spawnPos: { x: 1, z: -3 } });

    Health.current[a.eid] = 30;
    Health.current[b.eid] = 30;
    Stamina.current[a.eid] = 20;
    Stamina.current[b.eid] = 20;
    CombatStateComponent.state[a.eid] = CombatState.HitStun;
    CombatStateComponent.ticksRemaining[a.eid] = 15;

    resetAllTrainingDummies(world);

    expect(Health.current[a.eid]).toBe(100);
    expect(Health.current[b.eid]).toBe(100);
    expect(Stamina.current[a.eid]).toBe(100);
    expect(Stamina.current[b.eid]).toBe(100);
    expect(CombatStateComponent.state[a.eid]).toBe(CombatState.Idle);
    expect(CombatStateComponent.ticksRemaining[a.eid]).toBe(0);
  });

  it('removing IsTrainingDummy from an entity excludes it from K reset', () => {
    const { world } = makeGameWorld();
    const a = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    const b = createTrainingDummy(world, { spawnPos: { x: 1, z: -3 } });

    Health.current[a.eid] = 30;
    Health.current[b.eid] = 30;

    // Strip the IsTrainingDummy tag from `a` — should now be excluded.
    removeComponent(world.ecs, IsTrainingDummy, a.eid);

    resetAllTrainingDummies(world);

    expect(Health.current[a.eid]).toBe(30); // untouched
    expect(Health.current[b.eid]).toBe(100);
  });
});

describe('toggleTrainingDummyBlock + cycleTrainingDummyBlockDirection', () => {
  function spawnDummyWithFsm(world: any): number {
    const { eid } = createTrainingDummy(world, {
      spawnPos: { x: 0, z: -3 },
      startingWeapon: null, // skip the auto-registered FSM
    });
    // Replace with our test FSM so we don't depend on the real weapon configs
    fsmRegistry.set(eid, new CombatFSM(makeTestWeapon()));
    CombatStateComponent.state[eid] = CombatState.Idle;
    CombatStateComponent.blockDirection[eid] = Direction.Overhead;
    CombatStateComponent.ticksRemaining[eid] = 0;
    return eid;
  }

  it('toggles dummy from Idle → Blocking and back', () => {
    const { world } = makeGameWorld();
    const eid = spawnDummyWithFsm(world);

    let result = toggleTrainingDummyBlock(world);
    expect(CombatStateComponent.state[eid]).toBe(CombatState.Blocking);
    expect(result).toContain('Block');

    result = toggleTrainingDummyBlock(world);
    expect(CombatStateComponent.state[eid]).toBe(CombatState.Idle);
    expect(result).toBe('Idle');
  });

  it('returns "No dummies" when no dummies exist', () => {
    const { world } = makeGameWorld();
    expect(toggleTrainingDummyBlock(world)).toBe('No dummies');
    expect(cycleTrainingDummyBlockDirection(world)).toBe('No dummies');
  });

  it('cycles direction Overhead → Stab → Left → Right → Overhead', () => {
    const { world } = makeGameWorld();
    const eid = spawnDummyWithFsm(world);

    expect(cycleTrainingDummyBlockDirection(world)).toBe('Stab');
    expect(CombatStateComponent.blockDirection[eid]).toBe(Direction.Stab);

    expect(cycleTrainingDummyBlockDirection(world)).toBe('Left');
    expect(CombatStateComponent.blockDirection[eid]).toBe(Direction.Left);

    expect(cycleTrainingDummyBlockDirection(world)).toBe('Right');
    expect(CombatStateComponent.blockDirection[eid]).toBe(Direction.Right);

    expect(cycleTrainingDummyBlockDirection(world)).toBe('Overhead');
    expect(CombatStateComponent.blockDirection[eid]).toBe(Direction.Overhead);
  });
});

describe('tickTrainingDummyHealthReset + recordNpcHit', () => {
  it('regenerates HP after HEALTH_RESET_TICKS ticks of no-hit', () => {
    const { world } = makeGameWorld();
    const { eid } = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });

    Health.current[eid] = 50;
    // Re-stamp last-hit at the current tick so we have a definite zero point
    recordNpcHit(eid);

    // Advance fewer than HEALTH_RESET_TICKS — no regen
    for (let i = 0; i < HEALTH_RESET_TICKS - 1; i++) advanceFixedTick();
    tickTrainingDummyHealthReset(world);
    expect(Health.current[eid]).toBe(50);

    // One more tick → regen
    advanceFixedTick();
    tickTrainingDummyHealthReset(world);
    expect(Health.current[eid]).toBe(100);
  });

  it('does NOT regen recently-hit dummies', () => {
    const { world } = makeGameWorld();
    const { eid } = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });

    Health.current[eid] = 40;
    recordNpcHit(eid);

    for (let i = 0; i < 10; i++) {
      advanceFixedTick();
      tickTrainingDummyHealthReset(world);
    }
    expect(Health.current[eid]).toBe(40);
  });

  it('records hit tick at the current fixed tick', () => {
    const { world } = makeGameWorld();
    const { eid } = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });

    advanceFixedTick();
    advanceFixedTick();
    advanceFixedTick();

    recordNpcHit(eid);
    expect(npcLastHitTick.get(eid)).toBe(getCurrentFixedTick());
  });
});

describe('iteration helpers', () => {
  it('getTrainingDummyEids returns only IsTrainingDummy entities', () => {
    const { world } = makeGameWorld();
    const a = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    const b = createTrainingDummy(world, { spawnPos: { x: 1, z: -3 } });

    const eids = getTrainingDummyEids(world);
    expect(eids).toEqual(expect.arrayContaining([a.eid, b.eid]));
    expect(eids.length).toBe(2);
  });

  it('getNpcEids returns every IsNPC entity', () => {
    const { world } = makeGameWorld();
    const a = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    expect(getNpcEids(world)).toContain(a.eid);
  });

  it('isNpc and isTrainingDummy predicates match the component tags', () => {
    const { world } = makeGameWorld();
    const a = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    expect(isNpc(world, a.eid)).toBe(true);
    expect(isTrainingDummy(world, a.eid)).toBe(true);
  });
});

describe('IsNPC tag — generalization (issue #114)', () => {
  it('every training dummy carries IsNPC AND IsTrainingDummy', () => {
    const { world } = makeGameWorld();
    const a = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    expect(hasComponent(world.ecs, IsNPC, a.eid)).toBe(true);
    expect(hasComponent(world.ecs, IsTrainingDummy, a.eid)).toBe(true);
  });

  it('IsNPC query covers training dummies', () => {
    const { world } = makeGameWorld();
    const a = createTrainingDummy(world, { spawnPos: { x: 0, z: -3 } });
    const b = createTrainingDummy(world, { spawnPos: { x: 1, z: -3 } });
    const npcQuery = defineQuery([IsNPC]);
    const eids = Array.from(npcQuery(world.ecs));
    expect(eids).toEqual(expect.arrayContaining([a.eid, b.eid]));
  });
});
