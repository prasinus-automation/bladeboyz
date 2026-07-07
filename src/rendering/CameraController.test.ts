import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { CameraController, CameraMode } from './CameraController';
import { Position, PreviousPosition, Rotation, PreviousRotation, MovementState } from '../ecs/components';
import { addEntity, addComponent, createWorld } from 'bitecs';
import { MAX_PITCH, EYE_HEIGHT, THIRD_PERSON_DISTANCE } from '../core/types';

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

    it('respects maxTurnRate limiter (radians per fixed tick)', () => {
      // maxTurnRate is rad/TICK — the WeaponConfig turncap unit. The first
      // processInput call has no prior-frame timestamp, so it budgets
      // exactly one tick's worth (2026-07 unit fix: the old code divided
      // by 60 a second time, freezing the mouse during swings).
      controller.maxTurnRate = 0.05; // rad/tick ≈ 172°/s
      input.getMouseDelta.mockReturnValue({ x: 10000, y: 0 });

      controller.processInput();
      expect(Math.abs(controller.getYaw())).toBeLessThanOrEqual(0.05 + 0.001);
      expect(Math.abs(controller.getYaw())).toBeGreaterThan(0.05 - 0.01);
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

    it('extrapolates position with alpha (renders "now", not one tick ago)', () => {
      PreviousPosition.x[eid] = 0;
      Position.x[eid] = 10;

      controller.updateCamera(eid, 0.5);
      // x extrapolates the last tick's velocity forward:
      // 10 + (10-0)*0.5 = 15 (interpolation would give 5 — a tick behind)
      expect(camera.position.set).toHaveBeenCalledWith(
        expect.closeTo(15, 1),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('interpolates (not extrapolates) descending Y so landings never render below the last committed height', () => {
      PreviousPosition.y[eid] = 2;
      Position.y[eid] = 1;

      controller.updateCamera(eid, 0.5);
      // Descending: y interpolates 2 + (1-2)*0.5 = 1.5, + eye height 1.6
      expect(camera.position.set).toHaveBeenCalledWith(
        expect.any(Number),
        expect.closeTo(3.1, 1),
        expect.any(Number),
      );
    });

    it('extrapolates ascending Y (snappy jump launch)', () => {
      PreviousPosition.y[eid] = 1;
      Position.y[eid] = 2;

      controller.updateCamera(eid, 0.5);
      // Ascending: y extrapolates 2 + (2-1)*0.5 = 2.5, + eye height 1.6
      expect(camera.position.set).toHaveBeenCalledWith(
        expect.any(Number),
        expect.closeTo(4.1, 1),
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

  describe('third-person orbit polarity (#239)', () => {
    // The orbit target is player position + 80% eye height (CameraController
    // third-person branch). Player Y is 1 in this suite's beforeEach.
    const TARGET_Y = 1 + EYE_HEIGHT * 0.8;

    /**
     * Drive pitch through the real input path: deltaPitch = -delta.y *
     * sensitivity, so mouse-UP (negative delta.y) yields POSITIVE pitch
     * (pinned by the mouse-delta sign tests above — do not bypass them
     * by poking a private field).
     */
    function applyPitch(ctrl: CameraController, inp: any, pitch: number): void {
      inp.getMouseDelta.mockReturnValue({ x: 0, y: -pitch / ctrl.sensitivity });
      ctrl.processInput();
      expect(ctrl.getPitch()).toBeCloseTo(pitch, 4);
      inp.getMouseDelta.mockReturnValue({ x: 0, y: 0 });
    }

    it('positive pitch (mouse-up) places the camera BELOW the orbit target', () => {
      applyPitch(controller, input, 0.3);
      controller.toggleMode();
      controller.updateCamera(eid, 1.0);

      const [, camY] = camera.position.set.mock.lastCall;
      expect(camY).toBeLessThan(TARGET_Y);
      // Exact offset: target.y - sin(pitch) * orbitDistance
      expect(camY).toBeCloseTo(TARGET_Y - Math.sin(0.3) * THIRD_PERSON_DISTANCE, 4);
    });

    it('negative pitch (mouse-down) places the camera ABOVE the orbit target', () => {
      applyPitch(controller, input, -0.3);
      controller.toggleMode();
      controller.updateCamera(eid, 1.0);

      const [, camY] = camera.position.set.mock.lastCall;
      expect(camY).toBeGreaterThan(TARGET_Y);
      expect(camY).toBeCloseTo(TARGET_Y + Math.sin(0.3) * THIRD_PERSON_DISTANCE, 4);
    });

    it('at pitch=0 / yaw=0 the camera sits behind the character on the +Z side at eye-line height', () => {
      // Character forward is -Z (AGENTS.md Spatial Conventions), so "behind"
      // is +Z. Horizontal components must be unaffected by the vertical fix.
      controller.toggleMode();
      controller.updateCamera(eid, 1.0);

      const [camX, camY, camZ] = camera.position.set.mock.lastCall;
      expect(camX).toBeCloseTo(0, 4);
      expect(camY).toBeCloseTo(TARGET_Y, 4);
      expect(camZ).toBeCloseTo(THIRD_PERSON_DISTANCE, 4);
    });

    it('cross-mode polarity: FP and TP view directions have the same vertical sign for the same positive pitch', () => {
      // Real THREE camera so lookAt() and rotation actually produce world
      // transforms — asserting on real view vectors, not on the formula.
      const realCamera = new THREE.PerspectiveCamera();
      const realInput = createMockInput();
      const ctrl = new CameraController(realCamera, realInput);

      applyPitch(ctrl, realInput, 0.3);

      // First-person: reference polarity — mouse-up must look UP.
      ctrl.updateCamera(eid, 1.0);
      const fpDir = new THREE.Vector3();
      realCamera.getWorldDirection(fpDir);
      expect(fpDir.y).toBeGreaterThan(0);

      // Third-person with the SAME pitch must look up too.
      ctrl.toggleMode();
      ctrl.updateCamera(eid, 1.0);
      const tpDir = new THREE.Vector3();
      realCamera.getWorldDirection(tpDir);
      expect(tpDir.y).toBeGreaterThan(0);
      expect(Math.sign(tpDir.y)).toBe(Math.sign(fpDir.y));
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
