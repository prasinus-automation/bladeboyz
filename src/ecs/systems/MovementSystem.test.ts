import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import {
  Position, PreviousPosition, Rotation, PreviousRotation,
  Velocity, Player, PhysicsBody, MovementState, MovementIntent, DeadTag,
} from '../components';
import {
  createMovementSystem,
  registerPhysicsBody,
  resetMovementState,
} from './MovementSystem';
import { createInputSystem, resetInputState } from './InputSystem';
import {
  WALK_SPEED, SPRINT_MULTIPLIER, CROUCH_MULTIPLIER,
  GRAVITY, JUMP_VELOCITY, FIXED_TIMESTEP, ACCELERATION_TIME,
  JUMP_BUFFER_TICKS, COYOTE_TICKS,
  MAX_SLOPE_CLIMB_ANGLE, MIN_SLOPE_SLIDE_ANGLE,
} from '../../core/types';

/* ─── Mock factories ─── */

function createMockCharacterController() {
  return {
    enableAutostep: vi.fn(),
    enableSnapToGround: vi.fn(),
    setApplyImpulsesToDynamicBodies: vi.fn(),
    setMaxSlopeClimbAngle: vi.fn(),
    setMinSlopeSlideAngle: vi.fn(),
    computeColliderMovement: vi.fn(),
    computedMovement: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
    computedGrounded: vi.fn().mockReturnValue(true),
  };
}

function createMockBody(x = 0, y = 0, z = 0) {
  let pos = { x, y, z };
  return {
    translation: vi.fn(() => pos),
    setNextKinematicTranslation: vi.fn((next: { x: number; y: number; z: number }) => {
      pos = { x: next.x, y: next.y, z: next.z };
    }),
  };
}

function createMockCollider() {
  return { handle: vi.fn() };
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
  addComponent(ecsWorld, MovementIntent, eid);

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
  MovementState.verticalVelocity[eid] = 0;
  MovementState.lastJumpTick[eid] = -1;
  // bitecs component arrays are global across worlds — reset the jump
  // buffer/coyote bookkeeping so state can't leak between tests.
  MovementState.lastGroundedTick[eid] = 0;
  MovementState.jumpBufferTick[eid] = 0;
  MovementIntent.moveX[eid] = 0;
  MovementIntent.moveZ[eid] = 0;
  MovementIntent.sprint[eid] = 0;
  MovementIntent.crouch[eid] = 0;
  MovementIntent.jumpRequested[eid] = 0;

  return eid;
}

/* ─── Tests ─── */

describe('MovementSystem', () => {
  let ecsWorld: any;
  let mockController: ReturnType<typeof createMockCharacterController>;
  let mockBody: ReturnType<typeof createMockBody>;
  let mockCollider: ReturnType<typeof createMockCollider>;
  let mockCamera: ReturnType<typeof createMockCameraController>;
  let movementSystem: (dt: number) => void;

  const accelRate = 1.0 / Math.max(ACCELERATION_TIME / FIXED_TIMESTEP, 1);

  /**
   * Helper: make computedMovement pass through the desired movement.
   */
  function enablePassthroughMovement() {
    mockController.computeColliderMovement.mockImplementation((_collider: any, movement: any) => {
      mockController.computedMovement.mockReturnValue({ x: movement.x, y: movement.y, z: movement.z });
    });
  }

  function setup(
    intentOverrides: Partial<{
      moveX: number; moveZ: number; sprint: number; crouch: number; jumpRequested: number;
    }> = {},
    cameraYaw = 0,
    cameraPitch = 0,
    entityOpts: Parameters<typeof createTestEntity>[1] = {},
  ) {
    resetMovementState();
    ecsWorld = createWorld();
    mockController = createMockCharacterController();
    mockBody = createMockBody(entityOpts?.x ?? 0, entityOpts?.y ?? 1, entityOpts?.z ?? 0);
    mockCollider = createMockCollider();
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

    // Apply MovementIntent overrides
    if (intentOverrides.moveX !== undefined) MovementIntent.moveX[eid] = intentOverrides.moveX;
    if (intentOverrides.moveZ !== undefined) MovementIntent.moveZ[eid] = intentOverrides.moveZ;
    if (intentOverrides.sprint !== undefined) MovementIntent.sprint[eid] = intentOverrides.sprint;
    if (intentOverrides.crouch !== undefined) MovementIntent.crouch[eid] = intentOverrides.crouch;
    if (intentOverrides.jumpRequested !== undefined) MovementIntent.jumpRequested[eid] = intentOverrides.jumpRequested;

    registerPhysicsBody(eid, mockBody as any, mockCollider as any);
    movementSystem = createMovementSystem(gameWorld, mockCamera);
    enablePassthroughMovement();

    return eid;
  }

  beforeEach(() => {
    resetMovementState();
  });

  /* ─── Slope/step config (issue #104) ─── */

  describe('character controller configuration', () => {
    it('configures slope climb and slide angles', () => {
      setup();
      expect(mockController.setMaxSlopeClimbAngle).toHaveBeenCalledWith(MAX_SLOPE_CLIMB_ANGLE);
      expect(mockController.setMinSlopeSlideAngle).toHaveBeenCalledWith(MIN_SLOPE_SLIDE_ANGLE);
    });

    it('enables autostep but NOT snap-to-ground', () => {
      // Snap-to-ground is intentionally disabled — see MovementSystem.ts
      // comment for the controller-offset interaction that makes
      // computeColliderMovement clamp horizontal motion to zero on flat
      // ground. Re-enable when slopes/stairs need it.
      setup();
      expect(mockController.enableAutostep).toHaveBeenCalled();
      expect(mockController.enableSnapToGround).not.toHaveBeenCalled();
    });
  });

  /* ─── Intent → movement direction ─── */

  describe('MovementIntent → world-space movement', () => {
    it('applies +Z movement when MovementIntent.moveZ = 1', () => {
      const eid = setup({ moveZ: 1 }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);

      const expectedZ = 1 * WALK_SPEED * 1.0 * FIXED_TIMESTEP;
      expect(Position.z[eid]).toBeCloseTo(expectedZ, 4);
    });

    it('applies -Z movement when MovementIntent.moveZ = -1 (forward)', () => {
      const eid = setup({ moveZ: -1 }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);

      const expectedZ = -WALK_SPEED * FIXED_TIMESTEP;
      expect(Position.z[eid]).toBeCloseTo(expectedZ, 4);
    });

    it('applies +X movement when MovementIntent.moveX = 1 (strafe right)', () => {
      const eid = setup({ moveX: 1 }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);

      expect(Position.x[eid]).toBeCloseTo(WALK_SPEED * FIXED_TIMESTEP, 4);
    });

    it('does not move when intent is zero', () => {
      const eid = setup({}, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);

      const callArgs = (mockBody.setNextKinematicTranslation as any).mock.calls[0][0];
      expect(callArgs.x).toBeCloseTo(0, 5);
      expect(callArgs.z).toBeCloseTo(0, 5);
    });
  });

  /* ─── Sprint multiplier ─── */

  describe('sprint multiplier', () => {
    it('applies sprint multiplier when MovementIntent.sprint = 1', () => {
      const eid = setup({ moveZ: -1, sprint: 1 }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.sprinting[eid]).toBe(1);

      const expectedZ = -WALK_SPEED * SPRINT_MULTIPLIER * FIXED_TIMESTEP;
      expect(Position.z[eid]).toBeCloseTo(expectedZ, 4);
    });
  });

  /* ─── Crouch multiplier ─── */

  describe('crouch multiplier', () => {
    it('applies crouch multiplier when MovementIntent.crouch = 1', () => {
      const eid = setup({ moveZ: -1, crouch: 1 }, 0, 0, { speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.crouching[eid]).toBe(1);

      const expectedZ = -WALK_SPEED * CROUCH_MULTIPLIER * FIXED_TIMESTEP;
      expect(Position.z[eid]).toBeCloseTo(expectedZ, 4);
    });
  });

  /* ─── Jump (now uses MovementState.verticalVelocity) ─── */

  describe('jump', () => {
    it('sets verticalVelocity to JUMP_VELOCITY when jumpRequested && grounded', () => {
      const eid = setup({ jumpRequested: 1 }, 0, 0, { grounded: 1 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.verticalVelocity[eid]).toBe(JUMP_VELOCITY);
    });

    it('does NOT jump when airborne', () => {
      const eid = setup({ jumpRequested: 1 }, 0, 0, { grounded: 0 });
      MovementState.verticalVelocity[eid] = -5;
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.verticalVelocity[eid]).not.toBe(JUMP_VELOCITY);
    });

    it('clears MovementIntent.jumpRequested after consumption', () => {
      const eid = setup({ jumpRequested: 1 }, 0, 0, { grounded: 1 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementIntent.jumpRequested[eid]).toBe(0);
    });

    it('records lastJumpTick on a successful jump', () => {
      const eid = setup({ jumpRequested: 1 }, 0, 0, { grounded: 1 });
      expect(MovementState.lastJumpTick[eid]).toBe(-1);
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.lastJumpTick[eid]).toBeGreaterThan(0);
    });
  });

  /* ─── Jump buffering + coyote time (#goal-2026-07) ─── */

  describe('jump buffer', () => {
    it('a press while airborne executes on landing within JUMP_BUFFER_TICKS', () => {
      const eid = setup({ jumpRequested: 1 }, 0, 0, { grounded: 0 });
      mockController.computedGrounded.mockReturnValue(false);
      movementSystem(FIXED_TIMESTEP); // airborne: press banked, no jump
      expect(MovementState.verticalVelocity[eid]).not.toBe(JUMP_VELOCITY);

      // Land two ticks later — controller reports grounded.
      mockController.computedGrounded.mockReturnValue(true);
      movementSystem(FIXED_TIMESTEP); // landing tick: grounded flag set
      movementSystem(FIXED_TIMESTEP); // buffered press fires
      expect(MovementState.verticalVelocity[eid]).toBe(JUMP_VELOCITY);
    });

    it('a press older than JUMP_BUFFER_TICKS is forgotten', () => {
      const eid = setup({ jumpRequested: 1 }, 0, 0, { grounded: 0 });
      mockController.computedGrounded.mockReturnValue(false);
      // Stay airborne past the buffer window.
      for (let i = 0; i < JUMP_BUFFER_TICKS + 2; i++) {
        movementSystem(FIXED_TIMESTEP);
      }
      mockController.computedGrounded.mockReturnValue(true);
      movementSystem(FIXED_TIMESTEP);
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.verticalVelocity[eid]).not.toBe(JUMP_VELOCITY);
    });
  });

  describe('coyote time', () => {
    it('a jump pressed just after walking off a ledge still fires', () => {
      const eid = setup({}, 0, 0, { grounded: 1 });
      movementSystem(FIXED_TIMESTEP); // grounded tick (records lastGroundedTick)

      // Walk off the ledge: airborne now.
      mockController.computedGrounded.mockReturnValue(false);
      MovementState.grounded[eid] = 0;
      movementSystem(FIXED_TIMESTEP); // 1 tick airborne, falling

      MovementIntent.jumpRequested[eid] = 1;
      movementSystem(FIXED_TIMESTEP); // within COYOTE_TICKS of last ground
      expect(MovementState.verticalVelocity[eid]).toBe(JUMP_VELOCITY);
    });

    it('does NOT fire after COYOTE_TICKS have passed', () => {
      const eid = setup({}, 0, 0, { grounded: 1 });
      movementSystem(FIXED_TIMESTEP);

      mockController.computedGrounded.mockReturnValue(false);
      MovementState.grounded[eid] = 0;
      for (let i = 0; i < COYOTE_TICKS + 1; i++) {
        movementSystem(FIXED_TIMESTEP);
      }

      MovementIntent.jumpRequested[eid] = 1;
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.verticalVelocity[eid]).not.toBe(JUMP_VELOCITY);
    });

    it('does NOT grant a second boost after a real jump (no coyote double-jump)', () => {
      const eid = setup({ jumpRequested: 1 }, 0, 0, { grounded: 1 });
      // The jump leaves the ground, so the controller reports airborne
      // from this tick's movement onward.
      mockController.computedGrounded.mockReturnValue(false);
      movementSystem(FIXED_TIMESTEP); // jumps off the ground
      expect(MovementState.verticalVelocity[eid]).toBe(JUMP_VELOCITY);

      // Immediately press again while rising, still inside the coyote window.
      MovementIntent.jumpRequested[eid] = 1;
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.verticalVelocity[eid]).toBeLessThan(JUMP_VELOCITY);
    });
  });

  /* ─── Gravity (verticalVelocity) ─── */

  describe('gravity', () => {
    it('applies gravity to verticalVelocity when airborne', () => {
      const eid = setup({}, 0, 0, { grounded: 0 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.verticalVelocity[eid]).toBeCloseTo(GRAVITY * FIXED_TIMESTEP, 5);
    });

    it('accumulates gravity over multiple ticks', () => {
      const eid = setup({}, 0, 0, { grounded: 0 });
      mockController.computedGrounded.mockReturnValue(false);

      movementSystem(FIXED_TIMESTEP);
      movementSystem(FIXED_TIMESTEP);

      expect(MovementState.verticalVelocity[eid]).toBeCloseTo(GRAVITY * FIXED_TIMESTEP * 2, 4);
    });

    it('does NOT accumulate gravity when grounded', () => {
      const eid = setup({}, 0, 0, { grounded: 1 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.verticalVelocity[eid]).toBe(0);
    });

    it('clamps downward verticalVelocity to 0 when grounded', () => {
      const eid = setup({}, 0, 0, { grounded: 1 });
      MovementState.verticalVelocity[eid] = -5;
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.verticalVelocity[eid]).toBe(0);
    });
  });

  /* ─── Acceleration ramp ─── */

  describe('acceleration ramp', () => {
    it('speedFactor increases each tick with input', () => {
      const eid = setup({ moveZ: -1 }, 0, 0, { speedFactor: 0 });

      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.speedFactor[eid]).toBeCloseTo(accelRate, 5);

      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.speedFactor[eid]).toBeCloseTo(accelRate * 2, 5);
    });

    it('speedFactor caps at 1.0', () => {
      const eid = setup({ moveZ: -1 }, 0, 0, { speedFactor: 0 });
      for (let i = 0; i < 20; i++) movementSystem(FIXED_TIMESTEP);
      expect(MovementState.speedFactor[eid]).toBe(1.0);
    });
  });

  describe('deceleration on input release', () => {
    it('speedFactor decays at 2x accel rate when input cleared', () => {
      const eid = setup({}, 0, 0, { speedFactor: 1.0 });
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.speedFactor[eid]).toBeCloseTo(1.0 - accelRate * 2, 5);
    });

    it('speedFactor floors at 0', () => {
      const eid = setup({}, 0, 0, { speedFactor: 0.1 });
      for (let i = 0; i < 20; i++) movementSystem(FIXED_TIMESTEP);
      expect(MovementState.speedFactor[eid]).toBe(0);
    });
  });

  /* ─── Grounded state detection ─── */

  describe('grounded state detection', () => {
    it('sets grounded=1 when controller reports grounded', () => {
      const eid = setup({}, 0, 0, { grounded: 0 });
      mockController.computedGrounded.mockReturnValue(true);
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.grounded[eid]).toBe(1);
    });

    it('sets grounded=0 when controller reports airborne', () => {
      const eid = setup({}, 0, 0, { grounded: 1 });
      mockController.computedGrounded.mockReturnValue(false);
      movementSystem(FIXED_TIMESTEP);
      expect(MovementState.grounded[eid]).toBe(0);
    });
  });

  /* ─── Position read-back from body.translation() ─── */

  describe('Position is read back from body.translation post-write', () => {
    it('Position equals body.translation() AFTER setNextKinematicTranslation', () => {
      const eid = setup({ moveZ: -1 }, 0, 0, { speedFactor: 1 });

      movementSystem(FIXED_TIMESTEP);

      // The mockBody passes through setNextKinematicTranslation -> translation,
      // so post-write translation should equal the corrected movement.
      expect(Position.z[eid]).toBeCloseTo(-WALK_SPEED * FIXED_TIMESTEP, 4);
    });
  });

  /* ─── Previous position saving ─── */

  describe('previous position saving', () => {
    it('copies current Position to PreviousPosition before updating', () => {
      const eid = setup({ moveZ: -1 }, 0, 0, { x: 5, y: 10, z: 15, speedFactor: 1 });
      movementSystem(FIXED_TIMESTEP);

      expect(PreviousPosition.x[eid]).toBe(5);
      expect(PreviousPosition.y[eid]).toBe(10);
      expect(PreviousPosition.z[eid]).toBe(15);
    });
  });

  /* ─── DeadTag early-out (issue #130) ─── */

  describe('DeadTag early-out', () => {
    it('skips position update when entity has DeadTag', () => {
      const eid = setup({ moveZ: -1 }, 0, 0, { speedFactor: 1, x: 0, y: 1, z: 0 });
      // Add DeadTag — system should skip this entity entirely
      addComponent(ecsWorld, DeadTag, eid);

      const beforeX = Position.x[eid];
      const beforeZ = Position.z[eid];
      movementSystem(FIXED_TIMESTEP);

      expect(Position.x[eid]).toBe(beforeX);
      expect(Position.z[eid]).toBe(beforeZ);
      // setNextKinematicTranslation must NOT have been called
      expect(mockBody.setNextKinematicTranslation).not.toHaveBeenCalled();
    });

    it('does not consume jump intent when entity has DeadTag', () => {
      const eid = setup({ jumpRequested: 1 }, 0, 0, { grounded: 1 });
      addComponent(ecsWorld, DeadTag, eid);
      movementSystem(FIXED_TIMESTEP);
      // jumpRequested should still be 1 (system early-outed before clearing it)
      expect(MovementIntent.jumpRequested[eid]).toBe(1);
    });

    it('does not apply gravity to dead airborne entities', () => {
      const eid = setup({}, 0, 0, { grounded: 0 });
      addComponent(ecsWorld, DeadTag, eid);
      MovementState.verticalVelocity[eid] = 0;
      movementSystem(FIXED_TIMESTEP);
      // No gravity tick
      expect(MovementState.verticalVelocity[eid]).toBe(0);
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
});

/* ──────────────────────────────────────────────────────────
 * Issue #82 + #104 end-to-end regression
 *
 * Full keyboard → InputSystem → MovementSystem → Position chain.
 * Mocks only the Rapier physics layer; uses a real InputManager and
 * real KeyboardEvents dispatched via jsdom. Catches WASD-doesn't-move
 * regressions across the whole input pipeline.
 * ────────────────────────────────────────────────────────── */

describe('MovementSystem — issues #82 + #104 WASD end-to-end regression', () => {
  let ecsWorld: any;
  let realInput: import('../../input/InputManager').InputManager;
  let realCanvas: HTMLCanvasElement;
  let mockController: ReturnType<typeof createMockCharacterController>;
  let mockBody: ReturnType<typeof createMockBody>;
  let mockCollider: ReturnType<typeof createMockCollider>;
  let mockCamera: ReturnType<typeof createMockCameraController>;
  let inputSystem: (dt: number) => void;
  let movementSystem: (dt: number) => void;
  let eid: number;

  beforeEach(async () => {
    resetMovementState();
    resetInputState();
    ecsWorld = createWorld();

    realCanvas = document.createElement('canvas');
    document.body.appendChild(realCanvas);

    const { InputManager } = await import('../../input/InputManager');
    realInput = new InputManager(realCanvas);

    mockController = createMockCharacterController();
    mockBody = createMockBody(0, 1, 0);
    mockCollider = createMockCollider();
    mockCamera = createMockCameraController(0, 0);

    mockController.computeColliderMovement.mockImplementation(
      (_collider: any, movement: any) => {
        mockController.computedMovement.mockReturnValue({
          x: movement.x,
          y: movement.y,
          z: movement.z,
        });
      },
    );

    const gameWorld = {
      ecs: ecsWorld,
      physicsWorld: {
        createCharacterController: vi.fn().mockReturnValue(mockController),
      },
      rapier: {
        Vector3: vi
          .fn()
          .mockImplementation((x: number, y: number, z: number) => ({ x, y, z })),
      },
    } as any;

    eid = addEntity(ecsWorld);
    addComponent(ecsWorld, Player, eid);
    addComponent(ecsWorld, Position, eid);
    addComponent(ecsWorld, PreviousPosition, eid);
    addComponent(ecsWorld, Rotation, eid);
    addComponent(ecsWorld, PreviousRotation, eid);
    addComponent(ecsWorld, Velocity, eid);
    addComponent(ecsWorld, PhysicsBody, eid);
    addComponent(ecsWorld, MovementState, eid);
    addComponent(ecsWorld, MovementIntent, eid);

    Position.x[eid] = 0;
    Position.y[eid] = 1;
    Position.z[eid] = 0;
    MovementState.grounded[eid] = 1;
    MovementState.speedFactor[eid] = 1; // skip the accel ramp

    registerPhysicsBody(eid, mockBody as any, mockCollider as any);
    inputSystem = createInputSystem(gameWorld, realInput, mockCamera);
    movementSystem = createMovementSystem(gameWorld, mockCamera);
  });

  afterEach(() => {
    realCanvas.remove();
  });

  function pressKey(code: string, target: 'document' | 'canvas' = 'document'): void {
    const evt = new KeyboardEvent('keydown', { code, bubbles: true });
    if (target === 'canvas') realCanvas.dispatchEvent(evt);
    else document.dispatchEvent(evt);
  }
  function releaseKey(code: string, target: 'document' | 'canvas' = 'document'): void {
    const evt = new KeyboardEvent('keyup', { code, bubbles: true });
    if (target === 'canvas') realCanvas.dispatchEvent(evt);
    else document.dispatchEvent(evt);
  }

  function tick(): void {
    inputSystem(FIXED_TIMESTEP);
    movementSystem(FIXED_TIMESTEP);
  }

  it('REGRESSION: pressing W moves player forward (-Z)', () => {
    pressKey('KeyW');
    expect(realInput.isKeyDown('KeyW')).toBe(true);

    tick();

    expect(Position.z[eid]).toBeLessThan(0);
    expect(Position.z[eid]).toBeCloseTo(-WALK_SPEED * FIXED_TIMESTEP, 4);
  });

  it('REGRESSION: pressing S moves player backward (+Z)', () => {
    pressKey('KeyS');
    tick();
    expect(Position.z[eid]).toBeGreaterThan(0);
  });

  it('REGRESSION: pressing A strafes left (-X)', () => {
    pressKey('KeyA');
    tick();
    expect(Position.x[eid]).toBeLessThan(0);
  });

  it('REGRESSION: pressing D strafes right (+X)', () => {
    pressKey('KeyD');
    tick();
    expect(Position.x[eid]).toBeGreaterThan(0);
  });

  it('REGRESSION: WASD events dispatched directly on canvas also move player', () => {
    pressKey('KeyW', 'canvas');
    expect(realInput.isKeyDown('KeyW')).toBe(true);
    tick();
    expect(Position.z[eid]).toBeLessThan(0);
  });

  it('REGRESSION: releasing W stops the player from continuing forward', () => {
    pressKey('KeyW');
    tick();
    const zAfterPress = Position.z[eid];
    expect(zAfterPress).toBeLessThan(0);

    releaseKey('KeyW');
    for (let i = 0; i < 10; i++) tick();

    const zAfterRelease = Position.z[eid];
    tick();
    expect(Position.z[eid]).toBeCloseTo(zAfterRelease, 4);
  });

  it('REGRESSION: Shift while moving forward triggers sprint', () => {
    pressKey('KeyW');
    pressKey('ShiftLeft');
    tick();
    expect(MovementState.sprinting[eid]).toBe(1);
  });

  it('REGRESSION: Ctrl triggers crouch', () => {
    pressKey('ControlLeft');
    tick();
    expect(MovementState.crouching[eid]).toBe(1);
  });

  it('REGRESSION: Space triggers jump when grounded (verticalVelocity > 0)', () => {
    pressKey('Space');
    tick();
    expect(MovementState.verticalVelocity[eid]).toBeGreaterThan(0);
  });

  it('REGRESSION: Space pressed and held only jumps once (edge-trigger)', () => {
    // Frame 1: Space rising edge → jump fires
    pressKey('Space');
    tick();
    expect(MovementState.verticalVelocity[eid]).toBe(JUMP_VELOCITY);

    // Force grounded to remain so a second jump WOULD fire if input wasn't edge-triggered
    mockController.computedGrounded.mockReturnValue(true);
    MovementState.verticalVelocity[eid] = 0;
    MovementState.grounded[eid] = 1;

    // Frame 2: Space still held but no rising edge — no second jump
    tick();
    expect(MovementState.verticalVelocity[eid]).toBe(0);

    // Release + re-press → new rising edge → jump again
    releaseKey('Space');
    tick();
    pressKey('Space');
    tick();
    expect(MovementState.verticalVelocity[eid]).toBe(JUMP_VELOCITY);
  });

  it('REGRESSION: pause→unpause cycle does not stick keys (issue #72 still fixed)', () => {
    pressKey('KeyW');
    expect(realInput.isKeyDown('KeyW')).toBe(true);

    realInput.paused = true;
    releaseKey('KeyW');
    realInput.paused = false;

    expect(realInput.isKeyDown('KeyW')).toBe(false);

    tick();
    tick();
    const zBefore = Position.z[eid];
    tick();
    expect(Position.z[eid]).toBeCloseTo(zBefore, 4);
  });
});
