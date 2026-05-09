import RAPIER from '@dimforge/rapier3d-compat';
import { defineQuery, hasComponent } from 'bitecs';
import {
  Position,
  PreviousPosition,
  Rotation,
  PreviousRotation,
  Velocity,
  Player,
  PhysicsBody,
  MovementState,
  MovementIntent,
  DeadTag,
} from '../components';
import { CameraController } from '../../rendering/CameraController';
import type { GameWorld } from '../../core/types';
import {
  WALK_SPEED,
  SPRINT_MULTIPLIER,
  CROUCH_MULTIPLIER,
  GRAVITY,
  JUMP_VELOCITY,
  CHARACTER_CONTROLLER_OFFSET,
  ACCELERATION_TIME,
  FIXED_TIMESTEP,
  MAX_SLOPE_CLIMB_ANGLE,
  MIN_SLOPE_SLIDE_ANGLE,
  AUTOSTEP_MAX_HEIGHT,
  AUTOSTEP_MIN_WIDTH,
  SNAP_TO_GROUND_DISTANCE,
} from '../../core/types';

const playerQuery = defineQuery([
  Player,
  Position,
  MovementIntent,
  MovementState,
  PhysicsBody,
]);

// Rapier character controller (created once)
let characterController: RAPIER.KinematicCharacterController | null = null;

/** Lookup: entity ID -> Rapier RigidBody */
const bodyByEid = new Map<number, RAPIER.RigidBody>();
/** Lookup: entity ID -> Rapier Collider */
const colliderByEid = new Map<number, RAPIER.Collider>();

/** Tick counter (used for MovementState.lastJumpTick). */
let movementTick = 0;

/**
 * Reset module-level state. Used by tests to ensure clean isolation.
 */
export function resetMovementState(): void {
  characterController = null;
  bodyByEid.clear();
  colliderByEid.clear();
  movementTick = 0;
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
 * MovementSystem — applies `MovementIntent` to kinematic character bodies.
 *
 * Reads:
 *  - `MovementIntent` (world-space normalized direction + sprint/crouch/jump flags)
 *  - `MovementState.verticalVelocity` (gravity/jump bookkeeping)
 *  - `MovementState.grounded` (set last tick by the controller)
 *
 * Writes:
 *  - `Position` (post-physics, read back from `body.translation()` to avoid
 *    divergence if Rapier clamps the kinematic step)
 *  - `MovementState.{grounded, sprinting, crouching, speedFactor, verticalVelocity}`
 *  - `Rotation.{x, y}` from camera yaw/pitch (so other systems get a stable yaw)
 *  - Clears `MovementIntent.jumpRequested` after consumption.
 *
 * Tick contract: runs AFTER `inputSystem()` and BEFORE `physicsWorld.step()`.
 * Mesh sync is NOT in this system — it runs in `loop.render(alpha)` with
 * interpolation between PreviousPosition and Position so the visual model
 * doesn't snap at 60Hz.
 */
export function createMovementSystem(world: GameWorld, cameraController: CameraController) {
  // Create kinematic character controller
  characterController = world.physicsWorld.createCharacterController(CHARACTER_CONTROLLER_OFFSET);
  characterController.enableAutostep(AUTOSTEP_MAX_HEIGHT, AUTOSTEP_MIN_WIDTH, true);
  characterController.enableSnapToGround(SNAP_TO_GROUND_DISTANCE);
  characterController.setApplyImpulsesToDynamicBodies(true);
  characterController.setMaxSlopeClimbAngle(MAX_SLOPE_CLIMB_ANGLE);
  characterController.setMinSlopeSlideAngle(MIN_SLOPE_SLIDE_ANGLE);

  const accelRate = 1.0 / Math.max(ACCELERATION_TIME / FIXED_TIMESTEP, 1); // per tick

  return function movementSystem(_dt: number): void {
    movementTick++;
    const entities = playerQuery(world.ecs);

    for (let i = 0; i < entities.length; i++) {
      const eid = entities[i];

      // Dead entities (player or bot) don't read intent and don't move.
      // processDeaths zeroed Velocity; Position stays put. The kinematic
      // body stays at its last live translation until processRespawns
      // teleports it to a fresh spawn point.
      if (hasComponent(world.ecs, DeadTag, eid)) continue;

      const body = bodyByEid.get(eid);
      const collider = colliderByEid.get(eid);

      if (!body || !collider || !characterController) continue;

      // Save previous position for render-time interpolation
      PreviousPosition.x[eid] = Position.x[eid];
      PreviousPosition.y[eid] = Position.y[eid];
      PreviousPosition.z[eid] = Position.z[eid];
      PreviousRotation.x[eid] = Rotation.x[eid];
      PreviousRotation.y[eid] = Rotation.y[eid];
      PreviousRotation.z[eid] = Rotation.z[eid];

      // Read intent (world-space direction, already normalized + yaw-rotated by InputSystem)
      const moveX = MovementIntent.moveX[eid];
      const moveZ = MovementIntent.moveZ[eid];
      const sprintIntent = MovementIntent.sprint[eid] === 1;
      const crouchIntent = MovementIntent.crouch[eid] === 1;
      const jumpIntent = MovementIntent.jumpRequested[eid] === 1;

      // Mirror sprint/crouch flags onto MovementState so HUD/animation can
      // read a single source of truth without poking MovementIntent.
      MovementState.sprinting[eid] = sprintIntent ? 1 : 0;
      MovementState.crouching[eid] = crouchIntent ? 1 : 0;

      // Determine speed multiplier
      let speedMult = 1.0;
      if (MovementState.sprinting[eid]) {
        speedMult = SPRINT_MULTIPLIER;
      } else if (MovementState.crouching[eid]) {
        speedMult = CROUCH_MULTIPLIER;
      }

      // Acceleration ramp — has horizontal input?
      const hasInput = moveX !== 0 || moveZ !== 0;
      if (hasInput) {
        MovementState.speedFactor[eid] = Math.min(1.0, MovementState.speedFactor[eid] + accelRate);
      } else {
        // Decelerate faster for snappy stop
        MovementState.speedFactor[eid] = Math.max(
          0.0,
          MovementState.speedFactor[eid] - accelRate * 2,
        );
      }

      const speed = WALK_SPEED * speedMult * MovementState.speedFactor[eid];

      // Ground detection from previous tick
      const wasGrounded = MovementState.grounded[eid] === 1;

      // Vertical velocity: gravity + jump
      if (!wasGrounded) {
        MovementState.verticalVelocity[eid] += GRAVITY * FIXED_TIMESTEP;
      } else {
        // On ground, clamp downward velocity
        if (MovementState.verticalVelocity[eid] < 0) {
          MovementState.verticalVelocity[eid] = 0;
        }
        // Edge-triggered jump
        if (jumpIntent) {
          MovementState.verticalVelocity[eid] = JUMP_VELOCITY;
          MovementState.grounded[eid] = 0;
          MovementState.lastJumpTick[eid] = movementTick;
        }
      }
      // Consume the jump intent regardless of grounded — InputSystem will
      // re-set it next tick if Space is still on the rising edge (it won't be
      // unless the user lets go and presses again).
      MovementIntent.jumpRequested[eid] = 0;

      // Transitional bridge: mirror verticalVelocity to legacy Velocity.y
      // so AnimationSystem's airborne pose detection keeps working until
      // it migrates to read MovementState.verticalVelocity directly.
      // See AGENTS.md "Out of scope" note in #104 — animation locomotion
      // is a separate issue.
      Velocity.y[eid] = MovementState.verticalVelocity[eid];

      // Compute desired movement (world space, scaled to one fixed-tick worth)
      const desiredX = moveX * speed * FIXED_TIMESTEP;
      const desiredY = MovementState.verticalVelocity[eid] * FIXED_TIMESTEP;
      const desiredZ = moveZ * speed * FIXED_TIMESTEP;

      const desiredMovement = new world.rapier.Vector3(desiredX, desiredY, desiredZ);

      // Use character controller for collision resolution
      characterController.computeColliderMovement(collider, desiredMovement);
      const correctedMovement = characterController.computedMovement();

      // Apply movement to body (advance one fixed-tick worth)
      const currentPos = body.translation();
      const newPos = new world.rapier.Vector3(
        currentPos.x + correctedMovement.x,
        currentPos.y + correctedMovement.y,
        currentPos.z + correctedMovement.z,
      );
      body.setNextKinematicTranslation(newPos);

      // Update grounded state from character controller
      MovementState.grounded[eid] = characterController.computedGrounded() ? 1 : 0;

      // Sync ECS Position from the body's *post-write* translation. Rapier
      // exposes the kinematic next-translation immediately via .translation()
      // on bodies created with `kinematicPositionBased`, so this avoids any
      // chance of ECS Position diverging from Rapier when the controller
      // clamps the step (e.g. wall-slide).
      const finalPos = body.translation();
      Position.x[eid] = finalPos.x;
      Position.y[eid] = finalPos.y;
      Position.z[eid] = finalPos.z;

      // Store camera yaw/pitch in entity rotation for animation/HUD
      Rotation.y[eid] = cameraController.getYaw();
      Rotation.x[eid] = cameraController.getPitch();
    }
  };
}
