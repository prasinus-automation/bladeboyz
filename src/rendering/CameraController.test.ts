import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CameraController, CameraMode } from './CameraController';
import { Position, PreviousPosition, Rotation, PreviousRotation, MovementState } from '../ecs/components';
import { addEntity, addComponent, createWorld } from 'bitecs';
import { MAX_PITCH } from '../core/types';

// Mock Three.js PerspectiveCamera
function createMockCamera() {
  return {
    position: { x: 0, y: 0, z: 0, set: vi.fn() },
    rotation: { x: 0, y: 0, z: 0, order: 'XYZ', set: vi.fn() },
    lookAt: vi.fn(),
    aspect: 1,
    updateProjectionMatrix: vi.fn(),
  } as any;
}

// Mock InputManager
function createMockInput(overrides: any = {}) {
  return {
    isPointerLocked: true,
    getMouseDelta: vi.fn().mockReturnValue({ x: 0, y: 0 }),
    getScrollDelta: vi.fn().mockReturnValue(0),
    isKeyDown: vi.fn().mockReturnValue(false),
    ...overrides,
  } as any;
}

describe('CameraController', () => {
  let camera: any;
  let input: any;
  let controller: CameraController;
  let eid: number;
  let eventListeners: Record<string, Function[]>;

  beforeEach(() => {
    // Capture window event listeners
    eventListeners = {};
    vi.spyOn(window, 'addEventListener').mockImplementation((event: string, handler: any) => {
      if (!eventListeners[event]) eventListeners[event] = [];
      eventListeners[event].push(handler);
    });
    vi.spyOn(document, 'getElementById').mockReturnValue(null);

    camera = createMockCamera();
    input = createMockInput();
    controller = new CameraController(camera, input);

    // Create test entity with required components
    const world = createWorld();
    eid = addEntity(world);
    addComponent(world, Position, eid);
    addComponent(world, PreviousPosition, eid);
    addComponent(world, Rotation, eid);
    addComponent(world, PreviousRotation, eid);
    addComponent(world, MovementState, eid);

    Position.x[eid] = 0;
    Position.y[eid] = 1;
    Position.z[eid] = 0;
    PreviousPosition.x[eid] = 0;
    PreviousPosition.y[eid] = 1;
    PreviousPosition.z[eid] = 0;
    MovementState.crouching[eid] = 0;
  });

  it('starts in first-person mode', () => {
    expect(controller.getMode()).toBe(CameraMode.FirstPerson);
  });

  it('toggles to third-person mode', () => {
    controller.toggleMode();
    expect(controller.getMode()).toBe(CameraMode.ThirdPerson);
  });

  it('toggles back to first-person', () => {
    controller.toggleMode();
    controller.toggleMode();
    expect(controller.getMode()).toBe(CameraMode.FirstPerson);
  });

  it('responds to F5 keydown', () => {
    const f5Handlers = eventListeners['keydown'] || [];
    expect(f5Handlers.length).toBeGreaterThan(0);

    // Fire F5 event
    const event = { code: 'F5', preventDefault: vi.fn() };
    for (const handler of f5Handlers) {
      handler(event);
    }
    expect(controller.getMode()).toBe(CameraMode.ThirdPerson);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  describe('processInput', () => {
    it('does nothing when pointer is not locked', () => {
      input.isPointerLocked = false;
      input.getMouseDelta.mockReturnValue({ x: 100, y: 100 });

      controller.processInput();
      expect(controller.getYaw()).toBe(0);
      expect(controller.getPitch()).toBe(0);
    });

    it('updates yaw and pitch from mouse delta', () => {
      input.getMouseDelta.mockReturnValue({ x: 10, y: 5 });

      controller.processInput();
      // yaw = -dx * sensitivity = -10 * 0.002 = -0.02
      expect(controller.getYaw()).toBeCloseTo(-0.02, 4);
      // pitch = -dy * sensitivity = -5 * 0.002 = -0.01
      expect(controller.getPitch()).toBeCloseTo(-0.01, 4);
    });

    it('clamps pitch to max range', () => {
      // Large upward mouse movement
      input.getMouseDelta.mockReturnValue({ x: 0, y: -100000 });
      controller.processInput();
      expect(controller.getPitch()).toBeLessThanOrEqual(MAX_PITCH);
      expect(controller.getPitch()).toBeCloseTo(MAX_PITCH, 2);
    });

    it('clamps pitch to min range', () => {
      input.getMouseDelta.mockReturnValue({ x: 0, y: 100000 });
      controller.processInput();
      expect(controller.getPitch()).toBeGreaterThanOrEqual(-MAX_PITCH);
      expect(controller.getPitch()).toBeCloseTo(-MAX_PITCH, 2);
    });

    it('respects maxTurnRate limiter', () => {
      controller.maxTurnRate = 1.0; // 1 rad/s
      input.getMouseDelta.mockReturnValue({ x: 10000, y: 0 });

      controller.processInput();
      // maxDelta per tick = 1.0 * (1/60) ≈ 0.0167
      expect(Math.abs(controller.getYaw())).toBeLessThanOrEqual(1.0 / 60 + 0.001);
    });
  });

  describe('updateCamera', () => {
    it('positions camera at eye height in first-person', () => {
      controller.updateCamera(eid, 1.0);
      expect(camera.position.set).toHaveBeenCalledWith(
        0, // x
        expect.closeTo(2.6, 1), // y + eyeHeight (1 + 1.6)
        0, // z
      );
    });

    it('interpolates position with alpha', () => {
      PreviousPosition.x[eid] = 0;
      Position.x[eid] = 10;

      controller.updateCamera(eid, 0.5);
      // x should be lerped: 0 + (10-0)*0.5 = 5
      expect(camera.position.set).toHaveBeenCalledWith(
        expect.closeTo(5, 1),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('uses lower eye height when crouching', () => {
      MovementState.crouching[eid] = 1;
      controller.updateCamera(eid, 1.0);
      // Eye height should be crouch height (1.0) instead of normal (1.6)
      expect(camera.position.set).toHaveBeenCalledWith(
        0,
        expect.closeTo(2.0, 1), // y(1) + crouchEyeHeight(1.0)
        0,
      );
    });

    it('uses lookAt in third-person mode', () => {
      controller.toggleMode();
      controller.updateCamera(eid, 1.0);
      expect(camera.lookAt).toHaveBeenCalled();
    });
  });

  describe('player mesh visibility', () => {
    it('hides mesh in first-person', () => {
      const mesh = { visible: true };
      controller.setPlayerMesh(mesh as any);
      expect(mesh.visible).toBe(false); // FPS mode hides mesh
    });

    it('shows mesh in third-person', () => {
      const mesh = { visible: true };
      controller.setPlayerMesh(mesh as any);
      controller.toggleMode();
      expect(mesh.visible).toBe(true);
    });
  });
});
