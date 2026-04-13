import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import {
  Position, PreviousPosition, Rotation, PreviousRotation,
  Velocity, Player, PhysicsBody, MovementState,
} from '../components';
import {
  createMovementSystem,
  registerPhysicsBody,
  resetMovementState,
} from './MovementSystem';
import {
  WALK_SPEED, SPRINT_MULTIPLIER, CROUCH_MULTIPLIER,
  GRAVITY, JUMP_VELOCITY, FIXED_TIMESTEP, ACCELERATION_TIME,
} from '../../core/types';

/* ─── Mock factories ─── */

function createMockCharacterController() {
  return {
    enableAutostep: vi.fn(),
    enableSnapToGround: vi.fn(),
    setApplyImpulsesToDynamicBodies: vi.fn(),
    computeColliderMovement: vi.fn(),
    computedMovement: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
    computedGrounded: vi.fn().mockReturnValue(true),
  };
}

function createMockBody(x = 0, y = 0, z = 0) {
  return {
    translation: vi.fn().mockReturnValue({ x, y, z }),
    setNextKinematicTranslation: vi.fn(),
  };
}

function createMockCollider() {
  return { handle: vi.fn() };
}

function createMockInput(overrides: Record<string, boolean> = {}) {
  return {
    isKeyDown: vi.fn((code: string) => overrides[code] ?? false),
    isPointerLocked: true,
    getMouseDelta: vi.fn().mockReturnValue({ x: 0, y: 0 }),
    getScrollDelta: vi.fn().mockReturnValue(0),
  } as any;
}

function createMockCameraController(yaw = 0, pitch = 0) {
  return {
    getYaw: vi.fn().mockReturnValue(yaw),
    getPitch: vi.fn().mockReturnValue(pitch),
  } as any;
}

/* ─── Test entity helper ─── */

const BODY_HANDLE = 42;
const COLLIDER_HANDLE = 43;

function createTestEntity(
  ecsWorld: any,
  opts: { grounded?: number; speedFactor?: number; x?: number; y?: number; z?: number } = {},
): number {
  const eid = addEntity(ecsWorld);
  addComponent(ecsWorld, Player, eid);
  addComponent(ecsWorld, Position, eid);
  addComponent(ecsWorld, PreviousPosition, eid);
  addComponent(ecsWorld, Rotation, eid);
  addComponent(ecsWorld, PreviousRotation, eid);
  addComponent(ecsWorld, Velocity, eid);
  addComponent(ecsWorld, PhysicsBody, eid);
  addComponent(ecsWorld, MovementState, eid);

  Position.x[eid] = opts.x ?? 0;
  Position.y[eid] = opts.y ?? 1;
  Position.z[eid] = opts.z ?? 0;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Velocity.z[eid] = 0;
  PhysicsBody.bodyHandle[eid] = BODY_HANDLE;
  PhysicsBody.colliderHandle[eid] = COLLIDER_HANDLE;
  MovementState.grounded[eid] = opts.grounded ?? 1;
  MovementState.sprinting[eid] = 0;
  MovementState.crouching[eid] = 0;
  MovementState.speedFactor[eid] = opts.speedFactor ?? 0;

  return eid;
}

/* ─── Tests ─── */

describe('MovementSystem', () => {
  let ecsWorld: any;
  let mockController: ReturnType<typeof createMockCharacterController>;
  let mockBody: ReturnType<typeof createMockBody>;
  let mockCollider: ReturnType<typeof createMockCollider>;
  let mockInput: ReturnType<typeof createMockInput>;
  let mockCamera: ReturnType<typeof createMockCameraController>;
  let movementSystem: (dt: number) => void;

  const accelRate = 1.0 / Math.max(ACCELERATION_TIME / FIXED_TIMESTEP, 1);

  /**
   * Helper: make computedMovement pass through the desired movement.
   * Captures the args from computeColliderMovement and returns them from computedMovement.
   */
  function enablePassthroughMovement() {
    mockController.computeColliderMovement.mockImplementation((_collider: any, movement: any) => {
      mockController.computedMovement.mockReturnValue({ x: movement.x, y: movement.y, z: movement.z });
    });
  }

  function setup(
    inputOverrides: Record<string, boolean> = {},
    cameraYaw = 0,
    cameraPitch = 0,
    entityOpts: Parameters<typeof createTestEntity>[1] = {},
  ) {
    resetMovementState();
    ecsWorld = createWorld();
    mockController = createMockCharacterController();
    mockBody = createMockBody(entityOpts?.x ?? 0, entityOpts?.y ?? 1, entityOpts?.z ?? 0);
    mockCollider = createMockCollider();
    mockInput = createMockInput(inputOverrides);
    mockCamera = createMockCameraController(cameraYaw, cameraPitch);

    const gameWorld = {
      ecs: ecsWorld,
      physicsWorld: {
        createCharacterController: vi.fn().mockReturnValue(mockController),
      },
      rapier: {
        Vector3: vi.fn().mockImplementation((x: number, y: number, z: number) => ({ x, y, z })),
      },
    } as any;

    const eid = createTestEntity(ecsWorld, entityOpts);

    registerPhysicsBody(BODY_HANDLE, mockBody as any, COLLIDER_HANDLE, mockCollider as any);
    movementSystem = createMovementSystem(gameWorld, mockInput, mockCamera);
    enablePassthroughMovement();

    return eid;
  }

  beforeEach(() => {
    resetMovementState();
  });

  /* ─── WASD input → correct horizontal velocity ─── */

  describe('WASD input relative to camera yaw', () => {
    it('moves forward (-Z) when W pressed at yaw=0', () => {
      const eid = setup({ KeyW: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);

      // At yaw=0: forward (-Z) → moveX = -sin(0)*1 = 0, moveZ = -cos(0)*1 = -1
      // Body translation returns (0,1,0), so newPos.z = 0 + desiredZ
      const desiredZ = -1 * WALK_SPEED * 1.0 * FIXED_TIMESTEP;
      expect(Position.z[eid]).toBeCloseTo(desiredZ, 4);
    });

    it('moves backward (+Z) when S pressed at yaw=0', () => {
      const eid = setup({ KeyS: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);

      // forward = -1 → moveZ = -(-1)*cos(0) = 1
      const callArgs = (mockBody.setNextKinematicTranslation as any).mock.calls[0][0];
      expect(callArgs.z).toBeGreaterThan(0);
    });

    it('strafes right (+X rotated) when D pressed at yaw=0', () => {
      const eid = setup({ KeyD: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);

      // strafe=1 → moveX = cos(0)*1 = 1
      const callArgs = (mockBody.setNextKinematicTranslation as any).mock.calls[0][0];
      expect(callArgs.x).toBeGreaterThan(0);
    });

    it('strafes left (-X) when A pressed at yaw=0', () => {
      const eid = setup({ KeyA: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);

      const callArgs = (mockBody.setNextKinematicTranslation as any).mock.calls[0][0];
      expect(callArgs.x).toBeLessThan(0);
    });

    it('rotates movement direction by camera yaw', () => {
      const yaw = Math.PI / 2; // 90 degrees: forward should become +X
      const eid = setup({ KeyW: true }, yaw, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);

      // At yaw=PI/2: moveX = -sin(PI/2)*1 = -1, moveZ = -cos(PI/2)*1 ≈ 0
      const callArgs = (mockBody.setNextKinematicTranslation as any).mock.calls[0][0];
      expect(callArgs.x).toBeLessThan(-0.01);
      expect(Math.abs(callArgs.z)).toBeLessThan(0.01);
    });

    it('does not move when no WASD keys pressed', () => {
      const eid = setup({}, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);

      // With no input, speedFactor decelerates but horizontal movement = 0
      const callArgs = (mockBody.setNextKinematicTranslation as any).mock.calls[0][0];
      expect(callArgs.x).toBeCloseTo(0, 5);
      expect(callArgs.z).toBeCloseTo(0, 5);
    });
  });

  /* ─── Sprint multiplier ─── */

  describe('sprint multiplier', () => {
    it('applies sprint multiplier when Shift + forward', () => {
      const eid = setup({ KeyW: true, ShiftLeft: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.sprinting[eid]).toBe(1);

      const speed = WALK_SPEED * SPRINT_MULTIPLIER;
      const expectedZ = -1 * speed * FIXED_TIMESTEP;
      const callArgs = (mockBody.setNextKinematicTranslation as any).mock.calls[0][0];
      // newPos.z = bodyTranslation.z(0) + correctedMovement.z
      expect(callArgs.z).toBeCloseTo(expectedZ, 4);
    });

    it('does NOT sprint when going backward with Shift', () => {
      const eid = setup({ KeyS: true, ShiftLeft: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.sprinting[eid]).toBe(0);
    });

    it('does NOT sprint when crouching overrides', () => {
      const eid = setup({ KeyW: true, ShiftLeft: true, ControlLeft: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.sprinting[eid]).toBe(0);
      expect(MovementState.crouching[eid]).toBe(1);
    });

    it('does NOT sprint when only strafing (no forward)', () => {
      const eid = setup({ KeyD: true, ShiftLeft: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.sprinting[eid]).toBe(0);
    });
  });

  /* ─── Crouch multiplier ─── */

  describe('crouch multiplier', () => {
    it('applies crouch multiplier when Ctrl pressed', () => {
      const eid = setup({ KeyW: true, ControlLeft: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.crouching[eid]).toBe(1);

      const speed = WALK_SPEED * CROUCH_MULTIPLIER;
      const expectedZ = -1 * speed * FIXED_TIMESTEP;
      const callArgs = (mockBody.setNextKinematicTranslation as any).mock.calls[0][0];
      expect(callArgs.z - 0).toBeCloseTo(expectedZ, 4);
    });

    it('uses right Ctrl as well', () => {
      const eid = setup({ KeyW: true, ControlRight: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.crouching[eid]).toBe(1);
    });
  });

  /* ─── Jump ─── */

  describe('jump', () => {
    it('sets vertical velocity to JUMP_VELOCITY when Space pressed while grounded', () => {
      const eid = setup({ Space: true }, 0, 0, { grounded: 1 });
      movementSystem(FIXED_TIMESTEP);
      expect(Velocity.y[eid]).toBe(JUMP_VELOCITY);
    });

    it('does NOT jump when airborne', () => {
      const eid = setup({ Space: true }, 0, 0, { grounded: 0 });
      // Set some downward velocity to confirm it's not overwritten
      Velocity.y[eid] = -5;
      movementSystem(FIXED_TIMESTEP);
      // Should have gravity applied, not JUMP_VELOCITY
      expect(Velocity.y[eid]).not.toBe(JUMP_VELOCITY);
    });

    it('sets grounded to 0 after jumping', () => {
      const eid = setup({ Space: true }, 0, 0, { grounded: 1 });
      // Make character controller say NOT grounded after jump
      mockController.computedGrounded.mockReturnValue(false);
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.grounded[eid]).toBe(0);
    });
  });

  /* ─── Gravity ─── */

  describe('gravity', () => {
    it('applies gravity when airborne', () => {
      const eid = setup({}, 0, 0, { grounded: 0 });
      Velocity.y[eid] = 0;
      movementSystem(FIXED_TIMESTEP);

      expect(Velocity.y[eid]).toBeCloseTo(GRAVITY * FIXED_TIMESTEP, 5);
    });

    it('accumulates gravity over multiple ticks', () => {
      const eid = setup({}, 0, 0, { grounded: 0 });
      mockController.computedGrounded.mockReturnValue(false);
      Velocity.y[eid] = 0;

      movementSystem(FIXED_TIMESTEP);
      movementSystem(FIXED_TIMESTEP);

      expect(Velocity.y[eid]).toBeCloseTo(GRAVITY * FIXED_TIMESTEP * 2, 4);
    });

    it('does NOT apply gravity when grounded', () => {
      const eid = setup({}, 0, 0, { grounded: 1 });
      Velocity.y[eid] = 0;
      movementSystem(FIXED_TIMESTEP);

      expect(Velocity.y[eid]).toBe(0);
    });

    it('resets downward velocity to 0 when grounded', () => {
      const eid = setup({}, 0, 0, { grounded: 1 });
      Velocity.y[eid] = -5;
      movementSystem(FIXED_TIMESTEP);

      expect(Velocity.y[eid]).toBe(0);
    });
  });

  /* ─── Diagonal movement normalization ─── */

  describe('diagonal movement normalization', () => {
    it('normalizes diagonal movement so speed equals straight-line speed', () => {
      // Forward only
      const eid1 = setup({ KeyW: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);
      const forwardArgs = (mockBody.setNextKinematicTranslation as any).mock.calls[0][0];
      const forwardDist = Math.sqrt(forwardArgs.x ** 2 + forwardArgs.z ** 2);

      // Forward + strafe (diagonal)
      const eid2 = setup({ KeyW: true, KeyD: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);
      const diagArgs = (mockBody.setNextKinematicTranslation as any).mock.calls[0][0];
      const diagDist = Math.sqrt(diagArgs.x ** 2 + diagArgs.z ** 2);

      // Distances should be approximately equal (normalized)
      expect(diagDist).toBeCloseTo(forwardDist, 4);
    });
  });

  /* ─── Acceleration ramp ─── */

  describe('acceleration ramp', () => {
    it('speedFactor increases each tick with input', () => {
      const eid = setup({ KeyW: true }, 0, 0, { speedFactor: 0 });

      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.speedFactor[eid]).toBeCloseTo(accelRate, 5);

      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.speedFactor[eid]).toBeCloseTo(accelRate * 2, 5);
    });

    it('speedFactor caps at 1.0', () => {
      const eid = setup({ KeyW: true }, 0, 0, { speedFactor: 0 });

      // Run enough ticks to exceed 1.0
      for (let i = 0; i < 20; i++) {
        movementSystem(FIXED_TIMESTEP);
      }
      expect(MovementState.speedFactor[eid]).toBe(1.0);
    });

    it('reaches full speed within ACCELERATION_TIME', () => {
      const eid = setup({ KeyW: true }, 0, 0, { speedFactor: 0 });

      const ticksNeeded = Math.ceil(1.0 / accelRate);
      for (let i = 0; i < ticksNeeded; i++) {
        movementSystem(FIXED_TIMESTEP);
      }
      expect(MovementState.speedFactor[eid]).toBeCloseTo(1.0, 3);
    });
  });

  /* ─── Deceleration on input release ─── */

  describe('deceleration on input release', () => {
    it('speedFactor decreases when no input', () => {
      const eid = setup({}, 0, 0, { speedFactor: 1.0 });

      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.speedFactor[eid]).toBeCloseTo(1.0 - accelRate * 2, 5);
    });

    it('decelerates at 2x the acceleration rate', () => {
      const eid = setup({}, 0, 0, { speedFactor: 1.0 });

      movementSystem(FIXED_TIMESTEP);
      const decelAmount = 1.0 - MovementState.speedFactor[eid];

      // Decel should be 2x accel rate
      expect(decelAmount).toBeCloseTo(accelRate * 2, 5);
    });

    it('speedFactor floors at 0.0', () => {
      const eid = setup({}, 0, 0, { speedFactor: 0.1 });

      for (let i = 0; i < 20; i++) {
        movementSystem(FIXED_TIMESTEP);
      }
      expect(MovementState.speedFactor[eid]).toBe(0);
    });
  });

  /* ─── Grounded state detection ─── */

  describe('grounded state detection', () => {
    it('sets grounded=1 when character controller reports grounded', () => {
      const eid = setup({}, 0, 0, { grounded: 0 });
      mockController.computedGrounded.mockReturnValue(true);

      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.grounded[eid]).toBe(1);
    });

    it('sets grounded=0 when character controller reports airborne', () => {
      const eid = setup({}, 0, 0, { grounded: 1 });
      mockController.computedGrounded.mockReturnValue(false);

      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.grounded[eid]).toBe(0);
    });
  });

  /* ─── Previous position/rotation saving ─── */

  describe('previous position saving', () => {
    it('copies current position to PreviousPosition before updating', () => {
      const eid = setup({ KeyW: true }, 0, 0, { x: 5, y: 10, z: 15, speedFactor: 1 });

      movementSystem(FIXED_TIMESTEP);

      expect(PreviousPosition.x[eid]).toBe(5);
      expect(PreviousPosition.y[eid]).toBe(10);
      expect(PreviousPosition.z[eid]).toBe(15);
    });

    it('copies current rotation to PreviousRotation before updating', () => {
      const eid = setup({}, 0, 0);
      Rotation.x[eid] = 0.5;
      Rotation.y[eid] = 1.0;
      Rotation.z[eid] = 0.25;

      movementSystem(FIXED_TIMESTEP);

      expect(PreviousRotation.x[eid]).toBeCloseTo(0.5, 5);
      expect(PreviousRotation.y[eid]).toBeCloseTo(1.0, 5);
      expect(PreviousRotation.z[eid]).toBeCloseTo(0.25, 5);
    });
  });

  /* ─── Camera yaw/pitch stored in Rotation ─── */

  describe('rotation sync with camera', () => {
    it('stores camera yaw in Rotation.y', () => {
      const yaw = 1.234;
      const eid = setup({}, yaw);
      movementSystem(FIXED_TIMESTEP);
      expect(Rotation.y[eid]).toBeCloseTo(yaw, 5);
    });

    it('stores camera pitch in Rotation.x', () => {
      const pitch = -0.567;
      const eid = setup({}, 0, pitch);
      movementSystem(FIXED_TIMESTEP);
      expect(Rotation.x[eid]).toBeCloseTo(pitch, 5);
    });
  });

  /* ─── Rapier integration ─── */

  describe('Rapier character controller integration', () => {
    it('calls computeColliderMovement with the correct collider and movement', () => {
      const eid = setup({ KeyW: true }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);

      expect(mockController.computeColliderMovement).toHaveBeenCalledTimes(1);
      const [collider, movement] = mockController.computeColliderMovement.mock.calls[0];
      expect(collider).toBe(mockCollider);
      expect(movement).toHaveProperty('x');
      expect(movement).toHaveProperty('y');
      expect(movement).toHaveProperty('z');
    });

    it('uses corrected movement from computedMovement for final position', () => {
      const eid = setup({ KeyW: true }, 0, 0, { speedFactor: 1 });

      // Simulate wall collision: controller blocks Z movement
      mockController.computeColliderMovement.mockImplementation(() => {
        mockController.computedMovement.mockReturnValue({ x: 0, y: 0, z: 0 });
      });

      movementSystem(FIXED_TIMESTEP);

      // Position should not change in Z since corrected movement is 0
      const callArgs = (mockBody.setNextKinematicTranslation as any).mock.calls[0][0];
      expect(callArgs.z).toBeCloseTo(0, 5); // body started at z=0
    });
  });
});
