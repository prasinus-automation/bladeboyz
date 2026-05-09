import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createWorld, addEntity, addComponent } from 'bitecs';
import {
  CharacterModel,
  CombatStateComp,
  AnimationComp,
  HitReactComp,
  MovementState,
  meshRegistry,
} from '../components';
import { animationSystem, resetAnimationSystem } from './AnimationSystem';
import {
  CombatState,
  MovementState as MovementStateEnum,
} from '../../combat/states';
import { Direction } from '../../combat/directions';
import { createCharacterModel } from '../../rendering/CharacterModel';
import { resetFixedTick, advanceFixedTick } from '../../core/tickCounter';
import type { GameWorld } from '../../core/types';

/**
 * Create a minimal GameWorld mock for testing the animation system.
 * Only needs the ECS world — animation system doesn't touch physics/renderer.
 */
function createTestWorld(): GameWorld {
  return {
    ecs: createWorld(),
    scene: new THREE.Scene(),
    rapier: null as any,
    physicsWorld: null as any,
    renderer: null as any,
    camera: null as any,
    playerEntity: 0,
  };
}

/**
 * Create a test entity with all components the animation system reads.
 */
function createTestEntity(world: GameWorld): number {
  const eid = addEntity(world.ecs);
  addComponent(world.ecs, CharacterModel, eid);
  addComponent(world.ecs, CombatStateComp, eid);
  addComponent(world.ecs, AnimationComp, eid);
  addComponent(world.ecs, MovementState, eid);
  addComponent(world.ecs, HitReactComp, eid);

  // Create character model and register
  const { group, skeleton, bones } = createCharacterModel(0x888888);
  CharacterModel.id[eid] = eid;
  meshRegistry.set(eid, { group, skeleton, bones });

  // Initialize combat state to idle
  CombatStateComp.state[eid] = CombatState.Idle;
  CombatStateComp.direction[eid] = 0;
  CombatStateComp.phaseElapsed[eid] = 0;
  CombatStateComp.phaseTotal[eid] = 0;
  CombatStateComp.phaseT[eid] = 0;

  // Initialize animation state
  AnimationComp.crossfadeT[eid] = 1; // start fully blended
  AnimationComp.movementState[eid] = MovementStateEnum.Idle;
  AnimationComp.walkCycle[eid] = 0;
  AnimationComp.prevCombatState[eid] = CombatState.Idle;
  AnimationComp.prevDirection[eid] = 0;

  // MovementState defaults: idle, grounded, not crouching
  MovementState.speedFactor[eid] = 0;
  MovementState.grounded[eid] = 1;
  MovementState.crouching[eid] = 0;
  MovementState.sprinting[eid] = 0;

  // HitReactComp defaults: inactive
  HitReactComp.active[eid] = 0;
  HitReactComp.magnitude[eid] = 0;

  return eid;
}

describe('AnimationSystem', () => {
  let world: GameWorld;
  let eid: number;

  beforeEach(() => {
    resetAnimationSystem();
    resetFixedTick();
    world = createTestWorld();
    eid = createTestEntity(world);
  });

  it('runs without errors for an idle entity', () => {
    expect(() => animationSystem(world, 1 / 60)).not.toThrow();
  });

  it('applies idle pose to bones', () => {
    // Run a few frames to let the crossfade converge to 1.
    for (let i = 0; i < 10; i++) {
      animationSystem(world, 1 / 60);
    }

    const modelData = meshRegistry.get(CharacterModel.id[eid])!;
    const shoulderR = modelData.bones['shoulder_R'];

    // In idle pose, shoulder_R should have non-identity quaternion
    const isIdentity = shoulderR.quaternion.equals(new THREE.Quaternion());
    expect(isIdentity).toBe(false);
  });

  it('changes bone rotations when combat state changes to Windup', () => {
    // First settle into idle
    for (let i = 0; i < 5; i++) {
      animationSystem(world, 1 / 60);
    }

    const modelData = meshRegistry.get(CharacterModel.id[eid])!;
    const shoulderR = modelData.bones['shoulder_R'];
    const idleQuat = shoulderR.quaternion.clone();

    // Change to Windup Left
    CombatStateComp.state[eid] = CombatState.Windup;
    CombatStateComp.direction[eid] = Direction.Left;
    CombatStateComp.phaseElapsed[eid] = 3;
    CombatStateComp.phaseTotal[eid] = 7;
    CombatStateComp.phaseT[eid] = 3 / 7;

    // Run animation
    for (let i = 0; i < 10; i++) {
      animationSystem(world, 1 / 60);
    }

    // Shoulder should have moved from idle position
    const windupQuat = shoulderR.quaternion.clone();
    expect(windupQuat.equals(idleQuat)).toBe(false);
  });

  it('resets crossfadeT on state transition', () => {
    // Start idle
    animationSystem(world, 1 / 60);
    expect(AnimationComp.crossfadeT[eid]).toBeGreaterThan(0);

    // Change state
    CombatStateComp.state[eid] = CombatState.Windup;
    CombatStateComp.direction[eid] = Direction.Right;

    animationSystem(world, 1 / 60);

    // crossfadeT should have been reset to 0 then increased by dt/CROSSFADE_DURATION_SEC.
    // dt=1/60 ≈ 0.0167, CROSSFADE_DURATION_SEC=0.08 → crossfadeT ≈ 0.208.
    expect(AnimationComp.crossfadeT[eid]).toBeGreaterThan(0);
    expect(AnimationComp.crossfadeT[eid]).toBeLessThan(0.5);
  });

  it('reads movement state from MovementState component (not Velocity)', () => {
    // No movement → idle
    MovementState.speedFactor[eid] = 0;
    MovementState.grounded[eid] = 1;
    animationSystem(world, 1 / 60);
    expect(AnimationComp.movementState[eid]).toBe(MovementStateEnum.Idle);

    // Walking — moderate speed factor
    MovementState.speedFactor[eid] = 0.5;
    animationSystem(world, 1 / 60);
    expect(AnimationComp.movementState[eid]).toBe(MovementStateEnum.Walking);

    // Running — high speed factor
    MovementState.speedFactor[eid] = 1.0;
    animationSystem(world, 1 / 60);
    expect(AnimationComp.movementState[eid]).toBe(MovementStateEnum.Running);
  });

  it('detects jumping state from MovementState.grounded', () => {
    MovementState.speedFactor[eid] = 0.5;
    MovementState.grounded[eid] = 0; // airborne
    animationSystem(world, 1 / 60);
    expect(AnimationComp.movementState[eid]).toBe(MovementStateEnum.Jumping);
  });

  it('detects crouching state from MovementState.crouching', () => {
    MovementState.speedFactor[eid] = 0;
    MovementState.grounded[eid] = 1;
    MovementState.crouching[eid] = 1;
    animationSystem(world, 1 / 60);
    expect(AnimationComp.movementState[eid]).toBe(MovementStateEnum.Crouching);
  });

  it('accumulates walk cycle when moving', () => {
    MovementState.speedFactor[eid] = 0.5; // walking

    const initialCycle = AnimationComp.walkCycle[eid];
    animationSystem(world, 1 / 60);

    expect(AnimationComp.walkCycle[eid]).toBeGreaterThan(initialCycle);
  });

  it('walk cycle wraps around to prevent float overflow', () => {
    MovementState.speedFactor[eid] = 0.5;
    AnimationComp.walkCycle[eid] = Math.PI * 2 - 0.01;

    animationSystem(world, 1 / 60);

    // Should have wrapped back below 2π.
    expect(AnimationComp.walkCycle[eid]).toBeLessThan(Math.PI * 2);
  });

  it('handles all 4 attack directions without errors', () => {
    // FSM v2 (#88, #131): 4 directions — Underhand removed.
    const directions = [
      Direction.Left,
      Direction.Right,
      Direction.Overhead,
      Direction.Stab,
    ];

    for (const dir of directions) {
      CombatStateComp.state[eid] = CombatState.Windup;
      CombatStateComp.direction[eid] = dir;
      CombatStateComp.phaseTotal[eid] = 7;
      CombatStateComp.phaseElapsed[eid] = 3;
      CombatStateComp.phaseT[eid] = 3 / 7;

      expect(() => animationSystem(world, 1 / 60)).not.toThrow();
    }
  });

  it('handles all 4 block directions without errors', () => {
    const directions = [
      Direction.Left,
      Direction.Right,
      Direction.Overhead,
      Direction.Stab,
    ];

    for (const dir of directions) {
      CombatStateComp.state[eid] = CombatState.Blocking;
      CombatStateComp.direction[eid] = dir;

      expect(() => animationSystem(world, 1 / 60)).not.toThrow();
    }
  });

  it('handles all combat states without errors', () => {
    // FSM v2 (#135): only the 7 surviving states need coverage.
    const states = [
      CombatState.Idle,
      CombatState.Windup,
      CombatState.Release,
      CombatState.Recovery,
      CombatState.Blocking,
      CombatState.Parry,
      CombatState.HitStun,
    ];

    for (const state of states) {
      CombatStateComp.state[eid] = state;
      expect(() => animationSystem(world, 1 / 60)).not.toThrow();
    }
  });

  it('applies breathing sway in idle state', () => {
    CombatStateComp.state[eid] = CombatState.Idle;
    MovementState.speedFactor[eid] = 0;

    const modelData = meshRegistry.get(CharacterModel.id[eid])!;
    const chest = modelData.bones['chest'];

    // Run a few frames to let idle settle
    for (let i = 0; i < 5; i++) {
      animationSystem(world, 1 / 60);
    }
    const quat1 = chest.quaternion.clone();

    // Run more frames — breathing should cause slight variation
    for (let i = 0; i < 30; i++) {
      animationSystem(world, 1 / 60);
    }
    const quat2 = chest.quaternion.clone();

    // The quaternions should differ slightly due to breathing
    const dot = Math.abs(quat1.dot(quat2));
    expect(dot).toBeLessThan(1.0);
    expect(dot).toBeGreaterThan(0.99); // very subtle movement
  });

  it('upper/lower body split: combat state affects arms, movement affects legs', () => {
    CombatStateComp.state[eid] = CombatState.Windup;
    CombatStateComp.direction[eid] = Direction.Overhead;
    CombatStateComp.phaseTotal[eid] = 10;
    CombatStateComp.phaseElapsed[eid] = 5;
    CombatStateComp.phaseT[eid] = 0.5;
    MovementState.speedFactor[eid] = 0.5; // walking

    // Run several frames to converge
    for (let i = 0; i < 15; i++) {
      animationSystem(world, 1 / 60);
    }

    const modelData = meshRegistry.get(CharacterModel.id[eid])!;

    // Upper body should be affected by combat (overhead windup = arms raised)
    const shoulderR = modelData.bones['shoulder_R'];
    expect(shoulderR.quaternion.equals(new THREE.Quaternion())).toBe(false);

    // Lower body should be affected by movement (walking = legs moving)
    const thighL = modelData.bones['thigh_L'];
    expect(thighL.quaternion.equals(new THREE.Quaternion())).toBe(false);
  });

  it('skips entities without mesh data in registry', () => {
    const eid2 = addEntity(world.ecs);
    addComponent(world.ecs, CharacterModel, eid2);
    addComponent(world.ecs, CombatStateComp, eid2);
    addComponent(world.ecs, AnimationComp, eid2);
    addComponent(world.ecs, MovementState, eid2);
    addComponent(world.ecs, HitReactComp, eid2);
    CharacterModel.id[eid2] = 999; // not in registry

    expect(() => animationSystem(world, 1 / 60)).not.toThrow();
  });

  it('Release uses arc-driven swing — bone rotation is f(phaseT)', () => {
    // Settle into Windup first so the snapshot captures the windup-end pose.
    CombatStateComp.state[eid] = CombatState.Windup;
    CombatStateComp.direction[eid] = Direction.Overhead;
    CombatStateComp.phaseT[eid] = 1;
    for (let i = 0; i < 30; i++) animationSystem(world, 1 / 60);

    const modelData = meshRegistry.get(CharacterModel.id[eid])!;
    const shoulderR = modelData.bones['shoulder_R'];

    // Enter Release at phaseT = 0.0 — settle for crossfade.
    CombatStateComp.state[eid] = CombatState.Release;
    CombatStateComp.phaseT[eid] = 0.0;
    for (let i = 0; i < 30; i++) animationSystem(world, 1 / 60);
    const releaseStart = shoulderR.quaternion.clone();

    // Jump phaseT to 1.0 — same call into the system.
    CombatStateComp.phaseT[eid] = 1.0;
    for (let i = 0; i < 30; i++) animationSystem(world, 1 / 60);
    const releaseEnd = shoulderR.quaternion.clone();

    // The arc should produce DIFFERENT rotations at phaseT=0 vs phaseT=1.
    expect(releaseStart.equals(releaseEnd)).toBe(false);
  });

  it('hit-react lean tilts spine when HitReactComp is active', () => {
    // Settle into HitStun
    CombatStateComp.state[eid] = CombatState.HitStun;
    CombatStateComp.phaseTotal[eid] = 30;
    CombatStateComp.phaseElapsed[eid] = 0;
    CombatStateComp.phaseT[eid] = 0;
    HitReactComp.active[eid] = 0; // inactive first
    for (let i = 0; i < 5; i++) animationSystem(world, 1 / 60);

    const modelData = meshRegistry.get(CharacterModel.id[eid])!;
    const spine = modelData.bones['spine'];
    const inactiveQuat = spine.quaternion.clone();

    // Activate hit-react — hit from front (dirZ = -1 in local space, since
    // forward is -Z in Three.js).
    HitReactComp.active[eid] = 1;
    HitReactComp.magnitude[eid] = 1.0;
    HitReactComp.dirX[eid] = 0;
    HitReactComp.dirY[eid] = 0;
    HitReactComp.dirZ[eid] = -1;
    HitReactComp.spawnedAtTick[eid] = 0;
    HitReactComp.durationTicks[eid] = 30;
    advanceFixedTick(); // tick 1 — within duration, near peak
    advanceFixedTick(); // tick 2
    advanceFixedTick(); // tick 3

    animationSystem(world, 1 / 60);
    const activeQuat = spine.quaternion.clone();

    // Spine should have moved due to the lean overlay.
    expect(activeQuat.equals(inactiveQuat)).toBe(false);
  });

  it('hit-react does not apply when HitReactComp.active = 0', () => {
    CombatStateComp.state[eid] = CombatState.HitStun;
    CombatStateComp.phaseTotal[eid] = 30;
    CombatStateComp.phaseT[eid] = 0.5;
    HitReactComp.active[eid] = 0; // explicitly cleared
    HitReactComp.magnitude[eid] = 1.0;
    HitReactComp.dirZ[eid] = -1;

    // Run frames; capture spine quaternion. With active=0, the hit-react
    // overlay is skipped — the spine reflects only the static HITSTUN_POSE.
    for (let i = 0; i < 30; i++) animationSystem(world, 1 / 60);
    const modelData = meshRegistry.get(CharacterModel.id[eid])!;
    const spine = modelData.bones['spine'];
    const noLean = spine.quaternion.clone();

    // Now activate the hit-react and tick a few frames forward so its
    // peak shows. The spine should now differ from the no-lean baseline.
    HitReactComp.active[eid] = 1;
    HitReactComp.spawnedAtTick[eid] = 0;
    HitReactComp.durationTicks[eid] = 30;
    advanceFixedTick();
    advanceFixedTick();
    advanceFixedTick();
    animationSystem(world, 1 / 60);
    const withLean = spine.quaternion.clone();

    expect(withLean.equals(noLean)).toBe(false);
  });

  it('integration: full Windup → Release → Recovery cycle drives bone rotations', () => {
    const modelData = meshRegistry.get(CharacterModel.id[eid])!;
    const shoulderR = modelData.bones['shoulder_R'];

    // Idle → settle.
    for (let i = 0; i < 30; i++) animationSystem(world, 1 / 60);
    const idleQuat = shoulderR.quaternion.clone();

    // Windup phase: ramp phaseT 0 → 1 across 8 frames.
    CombatStateComp.state[eid] = CombatState.Windup;
    CombatStateComp.direction[eid] = Direction.Overhead;
    for (let i = 0; i <= 8; i++) {
      CombatStateComp.phaseT[eid] = i / 8;
      animationSystem(world, 1 / 60);
    }
    const windupEnd = shoulderR.quaternion.clone();
    expect(windupEnd.equals(idleQuat)).toBe(false);

    // Release phase: ramp phaseT 0 → 1 across 6 frames (arc swing).
    CombatStateComp.state[eid] = CombatState.Release;
    for (let i = 0; i <= 6; i++) {
      CombatStateComp.phaseT[eid] = i / 6;
      animationSystem(world, 1 / 60);
    }
    const releaseEnd = shoulderR.quaternion.clone();
    expect(releaseEnd.equals(windupEnd)).toBe(false);

    // Recovery phase: pose returns toward idle.
    CombatStateComp.state[eid] = CombatState.Recovery;
    for (let i = 0; i <= 10; i++) {
      CombatStateComp.phaseT[eid] = i / 10;
      animationSystem(world, 1 / 60);
    }
    const recoveryEnd = shoulderR.quaternion.clone();
    // At end of Recovery the arm should be back near idle (Recovery pose
    // IS IDLE_POSE in `AnimationData.ts`).
    expect(recoveryEnd.equals(releaseEnd)).toBe(false);
  });

  it('phase progress is frame-rate independent (deterministic from phaseT)', () => {
    // Same phaseT on two separate "runs" with different dt values should
    // produce visually consistent (close) quaternions once the crossfade
    // has settled.
    const modelData = meshRegistry.get(CharacterModel.id[eid])!;
    const shoulderR = modelData.bones['shoulder_R'];

    // Run 1: 144 Hz framerate.
    CombatStateComp.state[eid] = CombatState.Windup;
    CombatStateComp.direction[eid] = Direction.Right;
    CombatStateComp.phaseT[eid] = 0.5;
    for (let i = 0; i < 30; i++) animationSystem(world, 1 / 144);
    const fast = shoulderR.quaternion.clone();

    // Reset, run 2: 30 Hz framerate.
    resetAnimationSystem();
    world = createTestWorld();
    eid = createTestEntity(world);
    CombatStateComp.state[eid] = CombatState.Windup;
    CombatStateComp.direction[eid] = Direction.Right;
    CombatStateComp.phaseT[eid] = 0.5;
    for (let i = 0; i < 30; i++) animationSystem(world, 1 / 30);

    const slow = meshRegistry.get(CharacterModel.id[eid])!.bones['shoulder_R']
      .quaternion.clone();

    // After the crossfade has fully settled (≈ 5 frames @ 144Hz, 3 @ 30Hz),
    // bone quaternion is f(phaseT) only. Both runs converge to the same pose.
    const dot = Math.abs(fast.dot(slow));
    expect(dot).toBeGreaterThan(0.999);
  });

  it('legs and arms do NOT fight: combat windup leaves legs free for movement', () => {
    // The legacy bug: combat pose for upper body would slerp legs toward
    // identity even while the walk cycle was driving them. The rebuild's
    // layer-ownership rule means legs are owned ONLY by movement.

    // Combat: Overhead windup (arms way up).
    CombatStateComp.state[eid] = CombatState.Windup;
    CombatStateComp.direction[eid] = Direction.Overhead;
    CombatStateComp.phaseT[eid] = 0.5;
    // Movement: walking.
    MovementState.speedFactor[eid] = 0.5;

    for (let i = 0; i < 30; i++) animationSystem(world, 1 / 60);

    const modelData = meshRegistry.get(CharacterModel.id[eid])!;
    // Walk cycle should be running — thigh quaternions are NOT identity
    // because the walk cycle drives them via setFromEuler each frame.
    const thighL = modelData.bones['thigh_L'];
    expect(thighL.quaternion.equals(new THREE.Quaternion())).toBe(false);
  });
});
