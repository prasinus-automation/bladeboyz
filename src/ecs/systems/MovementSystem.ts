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
 * Look up the Rapier RigidBody registered for an entity, or undefined if
 * the entity has no physics body (or hasn't been registered yet).
 *
 * Use this rather than `world.physicsWorld.getRigidBody(PhysicsBody.bodyHandle[eid])`:
 * Rapier handles are composite floats that get truncated into the ui32
 * `PhysicsBody.bodyHandle` slot, so that lookup path is lossy. Our eid →
 * body Map is the source of truth (set by `registerPhysicsBody` at entity
 * creation).
 *
 * Added for #134 so `processRespawns` can call `setNextKinematicTranslation`
 * on a respawning entity's body. Future systems that need to teleport or
 * impulse an entity should use this same accessor.
 */
export function getPhysicsBody(eid: number): RAPIER.RigidBody | undefined {
  return bodyByEid.get(eid);
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
  // Snap-to-ground intentionally NOT enabled. Rapier's snap mechanism
  // pulls the kinematic body so the collider bottom touches the ground
  // (gap = 0), which puts the player inside the controller-offset skin
  // and makes `computeColliderMovement` clamp ALL axes (including
  // horizontal) to zero on the next tick. On a flat arena (#112) snap
  // isn't doing useful work yet anyway; re-enable (or implement a
  // custom slope-aware snap) when slopes/stairs land.
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

      if (!body || !collider || !characterController) {
        continue;
      }

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

      // Use character controller for collision resolution.
      //
      // QueryFilterFlags.EXCLUDE_SENSORS is critical: HitboxSystem creates
      // six sensor colliders (head/torso/arms/legs) on kinematicPositionBased
      // bodies that get repositioned every tick to the player's bone world
      // positions — i.e. INSIDE the player's own capsule. Without this
      // filter, Rapier's KCC includes those sensors as obstacles, sees the
      // capsule penetrating them, and clamps `correctedMovement` to (0,0,0)
      // on every axis (including horizontal) — the exact "WASD does
      // nothing while feet animate" symptom. Sensors should never block
      // physical motion anyway; they're for damage/trigger detection.
      characterController.computeColliderMovement(
        collider,
        desiredMovement,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      );
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

      // Sync ECS Position from the just-queued next translation. Rapier's
      // `body.translation()` returns the LAST-COMMITTED translation, NOT the
      // value queued by `setNextKinematicTranslation` — that lives in
      // `body.nextTranslation()`. Since `world.step()` runs AFTER this
      // system, reading `translation()` here gives us the stale pre-step
      // value and Position would lag the body by a tick (or, when the
      // physics step skips committing for any reason, never advance at all).
      // The character controller has already clamped `correctedMovement`
      // against obstacles, so `newPos` is the authoritative target.
      Position.x[eid] = newPos.x;
      Position.y[eid] = newPos.y;
      Position.z[eid] = newPos.z;

      // Store camera yaw/pitch in entity rotation for animation/HUD
      Rotation.y[eid] = cameraController.getYaw();
      Rotation.x[eid] = cameraController.getPitch();
    }
  };
}
