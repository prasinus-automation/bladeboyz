/**
 * End-to-end combat integration test — REAL physics, REAL scene graph.
 *
 * Every other test in the suite mocks Rapier and/or the Three.js scene,
 * which is how 1500+ tests stayed green while the actual game could not
 * land a hit. This file boots the real pipeline:
 *
 *   RAPIER.init() → real World → real createPlayer / createTrainingDummy
 *   → real CombatSystem (fake InputManager driving mouse state)
 *   → physicsWorld.step() → hitboxSystem → TracerSystem → DamageSystem
 *   → animationSystem (moves the bones the tracers ride on)
 *
 * and asserts that swinging a weapon at a dummy standing in front of the
 * player actually reduces the dummy's HP.
 *
 * Tick order mirrors main.ts exactly (fixedUpdate body, then the
 * variable-rate update + render-phase mesh sync).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld, addEntity } from 'bitecs';

import type { GameWorld } from '../core/types';
import { FIXED_TIMESTEP } from '../core/types';
import { createPlayer } from '../ecs/entities/createPlayer';
import {
  createTrainingDummy,
  tickTrainingDummyHealthReset,
  npcLastHitTick,
} from '../ecs/entities/createTrainingDummy';
import { createNpcDamageObserver } from '../ecs/systems/NpcDamageObserver';
import type { FloatingDamage } from '../hud/FloatingDamage';
import { createCombatSystem, resetCombatInputState, weaponIdToName } from '../ecs/systems/CombatSystem';
import { hitboxSystem } from '../ecs/systems/HitboxSystem';
import {
  TracerSystem,
  weaponConfigMap,
  weaponBoneMap,
  colliderToHitbox,
  tracerStates,
} from '../ecs/systems/TracerSystem';
import { DamageSystem, clearDamageAttribution } from '../ecs/systems/DamageSystem';
import { knockbackSystem } from '../ecs/systems/KnockbackSystem';
import { animationSystem, resetAnimationSystem } from '../ecs/systems/AnimationSystem';
import { createFSM, fsmRegistry } from '../combat/CombatFSM';
import { CombatState } from '../combat/states';
import { Direction } from '../combat/directions';
import { weaponConfigs } from '../weapons/WeaponConfig';
import {
  Health,
  Position,
  Rotation,
  CombatStateComponent,
  meshRegistry,
  hitboxColliderRegistry,
} from '../ecs/components';
import { advanceFixedTick, resetFixedTick } from '../core/tickCounter';
import { createMovementSystem, resetMovementState } from '../ecs/systems/MovementSystem';
import {
  KnockbackState,
  MovementIntent,
  MovementState,
} from '../ecs/components';
import { EventBus } from '../events/EventBus';
import { npcRegistry } from '../ecs/npcRegistry';

// Weapon configs auto-register on import
import '../weapons/longsword';
import '../weapons/mace';
import '../weapons/dagger';
import '../weapons/battleaxe';
import '../weapons/zweihander';
import '../weapons/warhammer';
import '../weapons/spear';
import '../weapons/katana';
import '../weapons/scythe';
import '../weapons/yeeter';

// ── Fake InputManager ────────────────────────────────────
// Only the surface CombatSystem + detectDirection consume.

class FakeInput {
  // Held-state + latched edges, mirroring the real InputManager. The
  // `buttons` facade keeps the historical `input.buttons.add/delete` call
  // sites working while also latching press/release edges for the
  // consume-on-read API CombatSystem now uses.
  private _held = new Set<number>();
  private _pressed = new Set<number>();
  private _released = new Set<number>();
  buttons = {
    add: (b: number) => {
      this._held.add(b);
      this._pressed.add(b);
    },
    delete: (b: number) => {
      this._held.delete(b);
      this._released.add(b);
    },
    has: (b: number) => this._held.has(b),
  };
  avgDelta = { dx: 0, dy: 0 };

  isMouseButtonDown(btn: number): boolean {
    return this._held.has(btn);
  }
  consumeMousePress(btn: number): boolean {
    return this._pressed.delete(btn);
  }
  consumeMouseRelease(btn: number): boolean {
    return this._released.delete(btn);
  }
  consumeKeyPress(_code: string): boolean {
    return false;
  }
  getAccumulatedDelta(_windowMs?: number): { dx: number; dy: number } {
    return { ...this.avgDelta };
  }
  getAverageDelta(_windowMs?: number): { dx: number; dy: number } {
    return { ...this.avgDelta };
  }
  getMouseDelta(): { dx: number; dy: number } {
    return { ...this.avgDelta };
  }
}

// ── World bootstrap ──────────────────────────────────────

let rapierReady = false;

function makeWorld(): GameWorld {
  const physicsWorld = new RAPIER.World(new RAPIER.Vector3(0, -20, 0));

  // Arena-like ground: fixed cuboid, top surface at y = 0.1 (GROUND_TOP_Y)
  const groundBody = physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(15, 0.1, 15).setTranslation(0, 0, 0),
    groundBody,
  );

  const ecs = createWorld();
  // Reserve eid 0 as the NULL entity — mirrors createGameWorld. The event
  // schema's "0 = no entity" sentinel (killerEid, targetEid) is only sound
  // if nothing real ever gets id 0.
  addEntity(ecs);
  return {
    ecs,
    scene: new THREE.Scene(),
    renderer: null as unknown as THREE.WebGLRenderer,
    rapier: RAPIER,
    physicsWorld,
    camera: new THREE.PerspectiveCamera(),
    playerEntity: -1,
  };
}

function clearRegistries(): void {
  meshRegistry.clear();
  fsmRegistry.clear();
  hitboxColliderRegistry.clear();
  weaponBoneMap.clear();
  colliderToHitbox.clear();
  tracerStates.clear();
  npcRegistry.clear();
  clearDamageAttribution();
  npcLastHitTick.clear();
  EventBus.clear();
  resetAnimationSystem();
  resetMovementState();
  resetCombatInputState();
  resetFixedTick();
  // weaponConfigMap mirrors main.ts population
  weaponConfigMap.clear();
  for (const [name, config] of Object.entries(weaponConfigs)) {
    const idx = weaponIdToName.indexOf(name);
    if (idx >= 0) weaponConfigMap.set(idx, config);
  }
}

// ── Harness ──────────────────────────────────────────────

interface Harness {
  world: GameWorld;
  input: FakeInput;
  playerEid: number;
  dummyEid: number;
  tick: () => void;
  runTicks: (n: number) => void;
}

function buildHarness(opts: {
  dummyPos: { x: number; z: number };
  playerYaw?: number;
  weapon?: string;
}): Harness {
  const world = makeWorld();
  const input = new FakeInput();
  const weapon = opts.weapon ?? 'Longsword';

  const { eid: playerEid, mesh: playerMesh } = createPlayer(
    world,
    { x: 0, z: 0 },
    { startingWeapon: weapon },
  );
  world.playerEntity = playerEid;
  createFSM(playerEid, weaponConfigs[weapon]);

  const yaw = opts.playerYaw ?? 0;
  Rotation.y[playerEid] = yaw;

  const { eid: dummyEid } = createTrainingDummy(world, {
    spawnPos: opts.dummyPos,
    color: 0xcc4444,
  });

  // CameraController stub: combat system only reads turncap sync; movement
  // is not run in this harness (entities stand still).
  const cameraStub = { maxTurnRate: Infinity } as never;
  const combatSystem = createCombatSystem(world.ecs, input as never, cameraStub);

  // Real NpcDamageObserver with a stub HUD sink. Load-bearing: it records
  // NPC hit ticks; without it `tickTrainingDummyHealthReset` heals every
  // wound back to full instantly (the original never-worked wiring polled
  // DamageEvent entities that were already consumed — see the observer's
  // docstring). The harness runs the FULL loop so that bug class stays
  // caught.
  const floatingStub = { spawn: () => {} } as unknown as FloatingDamage;
  const npcDamageObserver = createNpcDamageObserver(world, floatingStub);

  const tick = (): void => {
    advanceFixedTick();
    combatSystem();
    world.physicsWorld.step();
    hitboxSystem(world);
    // Regen check BEFORE hit detection — mirrors main.ts ordering (a
    // post-DamageSystem regen check heals fresh wounds the same tick).
    tickTrainingDummyHealthReset(world);
    TracerSystem(world, FIXED_TIMESTEP);
    DamageSystem(world, FIXED_TIMESTEP);
    knockbackSystem(world);
    npcDamageObserver(FIXED_TIMESTEP);
    EventBus.flush();

    // Variable-rate phase (main.ts loop.update): animation moves bones.
    animationSystem(world, FIXED_TIMESTEP);

    // Render-phase mesh sync (main.ts loop.render): position copy.
    const pm = meshRegistry.get(playerEid);
    if (pm) {
      pm.group.position.set(
        Position.x[playerEid],
        Position.y[playerEid],
        Position.z[playerEid],
      );
      pm.group.rotation.y = Rotation.y[playerEid];
    }
  };

  return {
    world,
    input,
    playerEid,
    dummyEid,
    tick,
    runTicks: (n: number) => {
      for (let i = 0; i < n; i++) tick();
    },
  };
}

/** Click LMB with a mouse-motion buffer that reads as `direction`. */
function attack(h: Harness, direction: Direction): void {
  // Buffer deltas chosen to satisfy detectDirectionFromDeltas thresholds.
  switch (direction) {
    case Direction.Overhead:
      h.input.avgDelta = { dx: 0, dy: -40 };
      break;
    case Direction.Left:
      h.input.avgDelta = { dx: -40, dy: 0 };
      break;
    case Direction.Right:
      h.input.avgDelta = { dx: 40, dy: 0 };
      break;
    case Direction.Stab:
      h.input.avgDelta = { dx: 0, dy: 0 };
      break;
  }
  h.input.buttons.add(0);
  h.tick(); // edge-detected press this tick
  h.input.buttons.delete(0);
}

// ── Tests ────────────────────────────────────────────────

beforeAll(async () => {
  if (!rapierReady) {
    await RAPIER.init();
    rapierReady = true;
  }
});

beforeEach(() => {
  clearRegistries();
});

// Heavy real-physics E2E: hundreds of fixed ticks of real Rapier per case.
// Under full-suite parallel CPU contention these blow the default 5 s
// budget (QA repro on PR #192) — give them an explicit generous timeout.
describe('combat end-to-end (real Rapier, real scene graph)', { timeout: 30_000 }, () => {
  it('overhead longsword swing damages a dummy standing in front', () => {
    // Player at origin faces -Z (yaw 0). Dummy 1.2m in front.
    const h = buildHarness({ dummyPos: { x: 0, z: -1.2 } });

    // Let hitboxes settle (they spawn at origin and teleport onto bones).
    h.runTicks(3);
    expect(Health.current[h.dummyEid]).toBe(100);

    attack(h, Direction.Overhead);

    // Windup(25) + Release(15) + margin
    h.runTicks(60);

    expect(CombatStateComponent.state[h.playerEid]).not.toBe(CombatState.Windup);
    expect(Health.current[h.dummyEid]).toBeLessThan(100);
  });

  it('left slash damages the dummy too', () => {
    const h = buildHarness({ dummyPos: { x: 0, z: -1.2 } });
    h.runTicks(3);
    attack(h, Direction.Left);
    h.runTicks(60);
    expect(Health.current[h.dummyEid]).toBeLessThan(100);
  });

  it('stab damages the dummy', () => {
    const h = buildHarness({ dummyPos: { x: 0, z: -1.2 } });
    h.runTicks(3);
    attack(h, Direction.Stab);
    h.runTicks(60);
    expect(Health.current[h.dummyEid]).toBeLessThan(100);
  });

  it('swing misses a dummy standing behind the player', () => {
    const h = buildHarness({ dummyPos: { x: 0, z: 3.0 } });
    h.runTicks(3);
    attack(h, Direction.Overhead);
    h.runTicks(60);
    expect(Health.current[h.dummyEid]).toBe(100);
  });

  it('damage persists (dummy auto-regen waits 3s after the last hit)', () => {
    const h = buildHarness({ dummyPos: { x: 0, z: -1.2 } });
    h.runTicks(3);
    attack(h, Direction.Overhead);
    h.runTicks(60);
    const hpAfterHit = Health.current[h.dummyEid];
    expect(hpAfterHit).toBeLessThan(100);
    // 1s later the wound is still open (regen needs 180 hit-free ticks)...
    h.runTicks(60);
    expect(Health.current[h.dummyEid]).toBe(hpAfterHit);
    // ...and after the full 3s window the dummy heals back to full.
    h.runTicks(180);
    expect(Health.current[h.dummyEid]).toBe(100);
  });

  it('battleaxe hit sends the dummy flying away from the attacker', () => {
    const h = buildHarness({
      dummyPos: { x: 0, z: -1.2 },
      weapon: 'Battleaxe',
    });
    h.runTicks(3);
    const zBefore = Position.z[h.dummyEid];

    attack(h, Direction.Overhead);
    // Battleaxe overhead: windup 30 + release ~16 + flight time
    h.runTicks(120);

    expect(Health.current[h.dummyEid]).toBeLessThan(100);
    // Launched AWAY from the player (further along -Z) by a real distance.
    const displacement = zBefore - Position.z[h.dummyEid];
    expect(displacement).toBeGreaterThan(1.0);
    // And it must come back down to the ground, not float forever.
    expect(Position.y[h.dummyEid]).toBeLessThan(0.2);
  });

  it('dagger hit barely moves the dummy', () => {
    // Daggers are short — stand almost touching the target.
    const h = buildHarness({
      dummyPos: { x: 0, z: -0.75 },
      weapon: 'Dagger',
    });
    h.runTicks(3);
    const zBefore = Position.z[h.dummyEid];

    attack(h, Direction.Stab);
    h.runTicks(120);

    expect(Health.current[h.dummyEid]).toBeLessThan(100);
    const displacement = Math.abs(zBefore - Position.z[h.dummyEid]);
    expect(displacement).toBeLessThan(0.5);
  });

  it('every registered weapon can land a hit on a dummy at mid-range', () => {
    // The one test that keeps future weapons honest: each entry in
    // weaponIdToName must be able to connect. Range-appropriate spacing:
    // short weapons get a close dummy, polearms get a far one.
    const spacing: Record<string, number> = {
      Dagger: 0.75,
      Mace: 0.9,
      Warhammer: 0.9,
      Katana: 1.0,
      Longsword: 1.2,
      Battleaxe: 1.2,
      // The scythe blade rides a ~2m ring — inside it is the SAFE zone.
      Scythe: 2.0,
      Zweihander: 1.5,
      Yeeter: 1.4,
      Spear: 1.8,
    };
    for (const weapon of weaponIdToName) {
      clearRegistries();
      const h = buildHarness({
        dummyPos: { x: 0, z: -(spacing[weapon] ?? 1.0) },
        weapon,
      });
      h.runTicks(3);
      // Each weapon leads with its signature attack: Spear thrusts, the
      // Scythe sweeps horizontally (its perpendicular blade makes vertical
      // chops awkward — true to the tool), everything else chops.
      const dir =
        weapon === 'Spear'
          ? Direction.Stab
          : weapon === 'Scythe'
            ? Direction.Left
            : Direction.Overhead;
      attack(h, dir);
      h.runTicks(90);
      expect(
        Health.current[h.dummyEid],
        `${weapon} failed to damage the dummy`,
      ).toBeLessThan(100);
    }
  });

  it('warhammer launches the dummy dramatically further than a longsword shove', () => {
    const run = (weapon: string): number => {
      clearRegistries();
      const h = buildHarness({ dummyPos: { x: 0, z: -1.0 }, weapon });
      h.runTicks(3);
      const zBefore = Position.z[h.dummyEid];
      attack(h, Direction.Overhead);
      h.runTicks(180);
      return zBefore - Position.z[h.dummyEid];
    };
    const hammer = run('Warhammer');
    const sword = run('Longsword');
    expect(hammer).toBeGreaterThan(2.5);
    expect(hammer).toBeGreaterThan(sword * 2);
  });

  it('knocked-back player is displaced and loses movement control until it expires', () => {
    const h = buildHarness({ dummyPos: { x: 5, z: 5 } });
    const camStub = {
      getYaw: () => 0,
      getPitch: () => 0,
      maxTurnRate: Infinity,
    } as never;
    const movementSystem = createMovementSystem(h.world, camStub);

    // Settle onto the ground first.
    for (let i = 0; i < 10; i++) {
      movementSystem(FIXED_TIMESTEP);
      h.world.physicsWorld.step();
    }
    const zStart = Position.z[h.playerEid];

    // Simulate a heavy hit from the -Z side: launch toward +Z and up.
    KnockbackState.vx[h.playerEid] = 0;
    KnockbackState.vy[h.playerEid] = 4;
    KnockbackState.vz[h.playerEid] = 6;
    KnockbackState.ticksRemaining[h.playerEid] = 40;

    // Victim mashes forward (-Z) the whole time — control is locked, so
    // the knockback wins.
    for (let i = 0; i < 40; i++) {
      MovementIntent.moveZ[h.playerEid] = -1;
      movementSystem(FIXED_TIMESTEP);
      h.world.physicsWorld.step();
    }

    // Shoved along +Z despite holding forward, and went airborne.
    expect(Position.z[h.playerEid]).toBeGreaterThan(zStart + 1.0);
    expect(KnockbackState.ticksRemaining[h.playerEid]).toBe(0);

    // After expiry, input works again: run further ticks and confirm the
    // player can move back toward -Z.
    for (let i = 0; i < 60; i++) {
      MovementIntent.moveZ[h.playerEid] = -1;
      movementSystem(FIXED_TIMESTEP);
      h.world.physicsWorld.step();
    }
    expect(MovementState.grounded[h.playerEid]).toBe(1);
    expect(Position.z[h.playerEid]).toBeLessThan(zStart + 6);
  });

  it('player facing +X (yaw -90°) hits a dummy to their +X side', () => {
    // yaw = -PI/2 rotates forward (-Z) onto +X... verify convention:
    // forward = (sin(yaw)*-1? ) — canonical: yaw=0 → -Z; positive yaw turns
    // left (toward -X). So to face +X we need yaw = -PI/2.
    const h = buildHarness({
      dummyPos: { x: 1.2, z: 0 },
      playerYaw: -Math.PI / 2,
    });
    h.runTicks(3);
    attack(h, Direction.Overhead);
    h.runTicks(60);
    expect(Health.current[h.dummyEid]).toBeLessThan(100);
  });
});
