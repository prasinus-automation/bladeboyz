import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createWorld, addEntity, addComponent } from 'bitecs';
import {
  CharacterModel,
  CombatStateComp,
  AnimationComp,
  Velocity,
  meshRegistry,
} from '../components';
import { animationSystem, resetAnimationSystem } from './AnimationSystem';
import { CombatState, MovementState } from '../../combat/states';
import { AttackDirection, BlockDirection } from '../../combat/directions';
import { createCharacterModel } from '../../rendering/CharacterModel';
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
 * Create a test entity with all required components for animation.
 */
function createTestEntity(world: GameWorld): number {
  const eid = addEntity(world.ecs);
  addComponent(world.ecs, CharacterModel, eid);
  addComponent(world.ecs, CombatStateComp, eid);
  addComponent(world.ecs, AnimationComp, eid);
  addComponent(world.ecs, Velocity, eid);

  // Create character model and register
  const { group, skeleton, bones } = createCharacterModel(0x888888);
  CharacterModel.id[eid] = eid;
  meshRegistry.set(eid, { group, skeleton, bones });

  // Initialize combat state to idle
  CombatStateComp.state[eid] = CombatState.Idle;
  CombatStateComp.direction[eid] = 0;
  CombatStateComp.phaseElapsed[eid] = 0;
  CombatStateComp.phaseTotal[eid] = 0;

  // Initialize animation state
  AnimationComp.upperBlend[eid] = 1; // start fully blended
  AnimationComp.lowerBlend[eid] = 1;
  AnimationComp.movementState[eid] = MovementState.Idle;
  AnimationComp.walkCycle[eid] = 0;
  AnimationComp.prevCombatState[eid] = CombatState.Idle;
  AnimationComp.prevDirection[eid] = 0;

  return eid;
}

describe('AnimationSystem', () => {
  let world: GameWorld;
  let eid: number;

  beforeEach(() => {
    resetAnimationSystem();
    world = createTestWorld();
    eid = createTestEntity(world);
  });

  it('runs without errors for an idle entity', () => {
    expect(() => animationSystem(world, 1 / 60)).not.toThrow();
  });

  it('applies idle pose to bones', () => {
    // Run a few frames to let blend converge
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
    CombatStateComp.direction[eid] = AttackDirection.Left;
    CombatStateComp.phaseElapsed[eid] = 3;
    CombatStateComp.phaseTotal[eid] = 7;

    // Run animation
    for (let i = 0; i < 10; i++) {
      animationSystem(world, 1 / 60);
    }

    // Shoulder should have moved from idle position
    const windupQuat = shoulderR.quaternion.clone();
    expect(windupQuat.equals(idleQuat)).toBe(false);
  });

  it('resets blend on state transition', () => {
    // Start idle
    animationSystem(world, 1 / 60);
    expect(AnimationComp.upperBlend[eid]).toBeGreaterThan(0);

    // Change state
    CombatStateComp.state[eid] = CombatState.Windup;
    CombatStateComp.direction[eid] = AttackDirection.Right;

    animationSystem(world, 1 / 60);

    // Blend should have been reset to 0 then increased by dt/blendDuration
    // dt=1/60 ≈ 0.0167, blendDuration=0.08, so blend ≈ 0.208
    expect(AnimationComp.upperBlend[eid]).toBeGreaterThan(0);
    expect(AnimationComp.upperBlend[eid]).toBeLessThan(0.5);
  });

  it('detects movement state from velocity', () => {
    // No velocity = idle
    Velocity.x[eid] = 0;
    Velocity.z[eid] = 0;
    animationSystem(world, 1 / 60);
    expect(AnimationComp.movementState[eid]).toBe(MovementState.Idle);

    // Walking speed
    Velocity.x[eid] = 2;
    Velocity.z[eid] = 0;
    animationSystem(world, 1 / 60);
    expect(AnimationComp.movementState[eid]).toBe(MovementState.Walking);

    // Running speed
    Velocity.x[eid] = 5.5;
    Velocity.z[eid] = 0;
    animationSystem(world, 1 / 60);
    expect(AnimationComp.movementState[eid]).toBe(MovementState.Running);
  });

  it('accumulates walk cycle when moving', () => {
    Velocity.x[eid] = 4; // walking speed
    Velocity.z[eid] = 0;

    const initialCycle = AnimationComp.walkCycle[eid];
    animationSystem(world, 1 / 60);

    expect(AnimationComp.walkCycle[eid]).toBeGreaterThan(initialCycle);
  });

  it('handles all 5 attack directions without errors', () => {
    const directions = [
      AttackDirection.Left,
      AttackDirection.Right,
      AttackDirection.Overhead,
      AttackDirection.Underhand,
      AttackDirection.Stab,
    ];

    for (const dir of directions) {
      CombatStateComp.state[eid] = CombatState.Windup;
      CombatStateComp.direction[eid] = dir;
      CombatStateComp.phaseTotal[eid] = 7;
      CombatStateComp.phaseElapsed[eid] = 3;

      expect(() => animationSystem(world, 1 / 60)).not.toThrow();
    }
  });

  it('handles all 4 block directions without errors', () => {
    const directions = [
      BlockDirection.Left,
      BlockDirection.Right,
      BlockDirection.Top,
      BlockDirection.Bottom,
    ];

    for (const dir of directions) {
      CombatStateComp.state[eid] = CombatState.Block;
      CombatStateComp.direction[eid] = dir;

      expect(() => animationSystem(world, 1 / 60)).not.toThrow();
    }
  });

  it('handles all combat states without errors', () => {
    const states = [
      CombatState.Idle,
      CombatState.Windup,
      CombatState.Release,
      CombatState.Recovery,
      CombatState.Block,
      CombatState.ParryWindow,
      CombatState.Riposte,
      CombatState.Feint,
      CombatState.Clash,
      CombatState.Stunned,
      CombatState.HitStun,
    ];

    for (const state of states) {
      CombatStateComp.state[eid] = state;
      expect(() => animationSystem(world, 1 / 60)).not.toThrow();
    }
  });

  it('applies breathing sway in idle state', () => {
    CombatStateComp.state[eid] = CombatState.Idle;
    Velocity.x[eid] = 0;
    Velocity.z[eid] = 0;

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
    // They should be very close (breathing is subtle) but not identical
    expect(dot).toBeLessThan(1.0);
    expect(dot).toBeGreaterThan(0.99); // very subtle movement
  });

  it('upper/lower body split: combat state affects arms, movement affects legs', () => {
    // Set combat to windup and movement to walking
    CombatStateComp.state[eid] = CombatState.Windup;
    CombatStateComp.direction[eid] = AttackDirection.Overhead;
    CombatStateComp.phaseTotal[eid] = 10;
    CombatStateComp.phaseElapsed[eid] = 5;
    Velocity.x[eid] = 3; // walking
    Velocity.z[eid] = 0;

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
    // Create entity with components but no mesh in registry
    const eid2 = addEntity(world.ecs);
    addComponent(world.ecs, CharacterModel, eid2);
    addComponent(world.ecs, CombatStateComp, eid2);
    addComponent(world.ecs, AnimationComp, eid2);
    addComponent(world.ecs, Velocity, eid2);
    CharacterModel.id[eid2] = 999; // not in registry

    // Should not throw
    expect(() => animationSystem(world, 1 / 60)).not.toThrow();
  });

  it('detects jumping state from vertical velocity', () => {
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 3; // airborne
    Velocity.z[eid] = 0;

    animationSystem(world, 1 / 60);
    expect(AnimationComp.movementState[eid]).toBe(MovementState.Jumping);
  });

  it('walk cycle wraps around to prevent float overflow', () => {
    Velocity.x[eid] = 4;
    AnimationComp.walkCycle[eid] = Math.PI * 2 - 0.01;

    animationSystem(world, 1 / 60);

    // Should have wrapped back
    expect(AnimationComp.walkCycle[eid]).toBeLessThan(Math.PI * 2);
  });
});
