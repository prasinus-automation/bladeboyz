import RAPIER from '@dimforge/rapier3d-compat';
import { defineQuery } from 'bitecs';
import {
  Position,
  PreviousPosition,
  Rotation,
  PreviousRotation,
  Velocity,
  Player,
  PhysicsBody,
  MovementState,
} from '../components';
import { InputManager } from '../../input/InputManager';
import { CameraController } from '../../rendering/CameraController';
import type { GameWorld } from '../../core/types';
import {
  WALK_SPEED,
  SPRINT_MULTIPLIER,
  CROUCH_MULTIPLIER,
  GRAVITY,
  JUMP_VELOCITY,
  GROUND_CAST_DISTANCE,
  CHARACTER_CONTROLLER_OFFSET,
  ACCELERATION_TIME,
  FIXED_TIMESTEP,
} from '../../core/types';

const playerQuery = defineQuery([Player, Position, Velocity, PhysicsBody, MovementState]);

// Rapier character controller (created once)
let characterController: RAPIER.KinematicCharacterController | null = null;

/** Lookup: entity ID -> Rapier RigidBody */
const bodyByEid = new Map<number, RAPIER.RigidBody>();
/** Lookup: entity ID -> Rapier Collider */
const colliderByEid = new Map<number, RAPIER.Collider>();

/**
 * Reset module-level state. Used by tests to ensure clean isolation.
 */
export function resetMovementState(): void {
  characterController = null;
  bodyByEid.clear();
  colliderByEid.clear();
}

/**
 * Register a physics body/collider pair for an entity.
 * Called from entity factories after creating Rapier bodies.
 *
 * Keyed by ECS entity ID instead of Rapier handles, because Rapier
 * handles are non-integer floats that get truncated in bitECS ui32 arrays.
 */
export function registerPhysicsBody(
  eid: number,
  body: RAPIER.RigidBody,
  collider: RAPIER.Collider,
): void {
  bodyByEid.set(eid, body);
  colliderByEid.set(eid, collider);
}

/**
 * MovementSystem — WASD movement with Rapier kinematic character controller.
 *
 * - Reads input for movement direction (relative to camera yaw)
 * - Sprint (Shift), crouch (Ctrl), jump (Space)
 * - Applies gravity when airborne
 * - Uses Rapier character controller for collision resolution
 * - Short acceleration ramp for snappy feel
 */
export function createMovementSystem(
  world: GameWorld,
  input: InputManager,
  cameraController: CameraController,
) {
  // Create kinematic character controller
  characterController = world.physicsWorld.createCharacterController(CHARACTER_CONTROLLER_OFFSET);
  characterController.enableAutostep(0.3, 0.2, true);
  characterController.enableSnapToGround(0.3);
  characterController.setApplyImpulsesToDynamicBodies(true);

  const accelRate = 1.0 / Math.max(ACCELERATION_TIME / FIXED_TIMESTEP, 1); // per tick

  return function movementSystem(_dt: number): void {
    const entities = playerQuery(world.ecs);

    for (let i = 0; i < entities.length; i++) {
      const eid = entities[i];
      const body = bodyByEid.get(eid);
      const collider = colliderByEid.get(eid);

      if (!body || !collider || !characterController) continue;

      // Save previous position for interpolation
      PreviousPosition.x[eid] = Position.x[eid];
      PreviousPosition.y[eid] = Position.y[eid];
      PreviousPosition.z[eid] = Position.z[eid];
      PreviousRotation.x[eid] = Rotation.x[eid];
      PreviousRotation.y[eid] = Rotation.y[eid];
      PreviousRotation.z[eid] = Rotation.z[eid];

      // Read input
      const forward = (input.isKeyDown('KeyW') ? 1 : 0) - (input.isKeyDown('KeyS') ? 1 : 0);
      const strafe = (input.isKeyDown('KeyD') ? 1 : 0) - (input.isKeyDown('KeyA') ? 1 : 0);
      const wantSprint = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight');
      const wantCrouch = input.isKeyDown('ControlLeft') || input.isKeyDown('ControlRight');
      const wantJump = input.isKeyDown('Space');

      // Update movement state
      MovementState.sprinting[eid] = (wantSprint && !wantCrouch && forward > 0) ? 1 : 0;
      MovementState.crouching[eid] = wantCrouch ? 1 : 0;

      // Determine speed multiplier
      let speedMult = 1.0;
      if (MovementState.sprinting[eid]) {
        speedMult = SPRINT_MULTIPLIER;
      } else if (MovementState.crouching[eid]) {
        speedMult = CROUCH_MULTIPLIER;
      }

      // Calculate movement direction relative to camera yaw
      const yaw = cameraController.getYaw();
      const sinYaw = Math.sin(yaw);
      const cosYaw = Math.cos(yaw);

      let moveX = 0;
      let moveZ = 0;

      if (forward !== 0 || strafe !== 0) {
        // Forward is -Z in Three.js convention
        moveX = strafe * cosYaw - forward * sinYaw;
        moveZ = -strafe * sinYaw - forward * cosYaw;

        // Normalize diagonal movement
        const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (len > 0) {
          moveX /= len;
          moveZ /= len;
        }
      }

      // Acceleration ramp
      const hasInput = forward !== 0 || strafe !== 0;
      if (hasInput) {
        MovementState.speedFactor[eid] = Math.min(1.0, MovementState.speedFactor[eid] + accelRate);
      } else {
        // Decelerate faster for snappy stop
        MovementState.speedFactor[eid] = Math.max(0.0, MovementState.speedFactor[eid] - accelRate * 2);
      }

      const speed = WALK_SPEED * speedMult * MovementState.speedFactor[eid];

      // Ground detection via character controller grounding
      const wasGrounded = MovementState.grounded[eid] === 1;

      // Apply gravity
      if (!wasGrounded) {
        Velocity.y[eid] += GRAVITY * FIXED_TIMESTEP;
      } else {
        // On ground, reset downward velocity
        if (Velocity.y[eid] < 0) {
          Velocity.y[eid] = 0;
        }

        // Jump
        if (wantJump) {
          Velocity.y[eid] = JUMP_VELOCITY;
          MovementState.grounded[eid] = 0;
        }
      }

      // Compute desired movement
      const desiredX = moveX * speed * FIXED_TIMESTEP;
      const desiredY = Velocity.y[eid] * FIXED_TIMESTEP;
      const desiredZ = moveZ * speed * FIXED_TIMESTEP;

      const desiredMovement = new world.rapier.Vector3(desiredX, desiredY, desiredZ);

      // Use character controller for collision resolution
      characterController.computeColliderMovement(collider, desiredMovement);
      const correctedMovement = characterController.computedMovement();

      // Apply movement to body
      const currentPos = body.translation();
      const newPos = new world.rapier.Vector3(
        currentPos.x + correctedMovement.x,
        currentPos.y + correctedMovement.y,
        currentPos.z + correctedMovement.z,
      );
      body.setNextKinematicTranslation(newPos);

      // Update grounded state from character controller
      MovementState.grounded[eid] = characterController.computedGrounded() ? 1 : 0;

      // Sync ECS position from physics
      Position.x[eid] = newPos.x;
      Position.y[eid] = newPos.y;
      Position.z[eid] = newPos.z;

      // Store camera yaw in entity rotation for other systems
      Rotation.y[eid] = cameraController.getYaw();
      Rotation.x[eid] = cameraController.getPitch();
    }
  };
}
