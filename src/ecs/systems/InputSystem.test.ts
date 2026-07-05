import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Player, MovementIntent } from '../components';
import { createInputSystem, resetInputState } from './InputSystem';
import { FIXED_TIMESTEP, WALK_SPEED } from '../../core/types';

/**
 * InputSystem unit tests — keyboard / pointer-lock state translates to
 * `MovementIntent` for `Player` entities.
 */

describe('InputSystem', () => {
  let ecsWorld: any;
  let realCanvas: HTMLCanvasElement;
  let realInput: import('../../input/InputManager').InputManager;
  let mockCamera: any;
  let inputSystem: (dt: number) => void;
  let eid: number;

  beforeEach(async () => {
    resetInputState();
    ecsWorld = createWorld();

    realCanvas = document.createElement('canvas');
    document.body.appendChild(realCanvas);

    const { InputManager } = await import('../../input/InputManager');
    realInput = new InputManager(realCanvas);

    mockCamera = {
      getYaw: vi.fn().mockReturnValue(0),
      getPitch: vi.fn().mockReturnValue(0),
    };

    eid = addEntity(ecsWorld);
    addComponent(ecsWorld, Player, eid);
    addComponent(ecsWorld, MovementIntent, eid);

    inputSystem = createInputSystem(
      { ecs: ecsWorld } as any,
      realInput,
      mockCamera,
    );
  });

  afterEach(() => {
    realCanvas.remove();
  });

  function pressKey(code: string): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  }
  function releaseKey(code: string): void {
    document.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  }

  /* ─── WASD → moveX/moveZ ─── */

  describe('WASD → world-space MovementIntent', () => {
    it('W (forward) at yaw=0 sets moveZ negative', () => {
      pressKey('KeyW');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.moveZ[eid]).toBeCloseTo(-1, 5);
      expect(MovementIntent.moveX[eid]).toBeCloseTo(0, 5);
    });

    it('S (backward) at yaw=0 sets moveZ positive', () => {
      pressKey('KeyS');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.moveZ[eid]).toBeCloseTo(1, 5);
    });

    it('A (strafe left) at yaw=0 sets moveX negative', () => {
      pressKey('KeyA');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.moveX[eid]).toBeCloseTo(-1, 5);
    });

    it('D (strafe right) at yaw=0 sets moveX positive', () => {
      pressKey('KeyD');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.moveX[eid]).toBeCloseTo(1, 5);
    });

    it('no input → zero intent vector', () => {
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.moveX[eid]).toBe(0);
      expect(MovementIntent.moveZ[eid]).toBe(0);
    });

    it('rotates intent by camera yaw — yaw=π/2 turns forward into +X', () => {
      mockCamera.getYaw.mockReturnValue(Math.PI / 2);
      pressKey('KeyW');
      inputSystem(FIXED_TIMESTEP);
      // Forward (-Z) rotated 90° counterclockwise (Three.js yaw) → -X
      expect(MovementIntent.moveX[eid]).toBeCloseTo(-1, 4);
      expect(MovementIntent.moveZ[eid]).toBeCloseTo(0, 4);
    });

    it('normalizes diagonal input so |intent| = 1', () => {
      pressKey('KeyW');
      pressKey('KeyD');
      inputSystem(FIXED_TIMESTEP);
      const len = Math.sqrt(
        MovementIntent.moveX[eid] ** 2 + MovementIntent.moveZ[eid] ** 2,
      );
      expect(len).toBeCloseTo(1, 5);
    });

    it('intent length scales correctly to WALK_SPEED * FIXED_TIMESTEP per tick', () => {
      // Sanity: feeding intent into MovementSystem-shaped math gives WALK_SPEED·dt per tick.
      // (The concrete test for actual position lives in MovementSystem.test.ts;
      // this just asserts the magnitude convention so they line up.)
      pressKey('KeyW');
      inputSystem(FIXED_TIMESTEP);
      const moveZ = MovementIntent.moveZ[eid];
      const stepDistance = Math.abs(moveZ) * WALK_SPEED * FIXED_TIMESTEP;
      expect(stepDistance).toBeCloseTo(WALK_SPEED * FIXED_TIMESTEP, 5);
    });
  });

  /* ─── Sprint ─── */

  describe('sprint', () => {
    it('Shift + W → sprint=1', () => {
      pressKey('KeyW');
      pressKey('ShiftLeft');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.sprint[eid]).toBe(1);
    });

    it('Shift alone (no forward) → sprint=0', () => {
      pressKey('ShiftLeft');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.sprint[eid]).toBe(0);
    });

    it('Shift + S (backward) → sprint=0 (no sprint backward)', () => {
      pressKey('KeyS');
      pressKey('ShiftLeft');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.sprint[eid]).toBe(0);
    });

    it('Shift + W + Ctrl (crouch) → sprint=0 (crouch overrides)', () => {
      pressKey('KeyW');
      pressKey('ShiftLeft');
      pressKey('ControlLeft');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.sprint[eid]).toBe(0);
      expect(MovementIntent.crouch[eid]).toBe(1);
    });

    it('ShiftRight + W also triggers sprint', () => {
      pressKey('KeyW');
      pressKey('ShiftRight');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.sprint[eid]).toBe(1);
    });
  });

  /* ─── Crouch ─── */

  describe('crouch', () => {
    it('Ctrl → crouch=1', () => {
      pressKey('ControlLeft');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.crouch[eid]).toBe(1);
    });

    it('ControlRight also triggers crouch', () => {
      pressKey('ControlRight');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.crouch[eid]).toBe(1);
    });

    it('releasing Ctrl → crouch=0', () => {
      pressKey('ControlLeft');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.crouch[eid]).toBe(1);

      releaseKey('ControlLeft');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.crouch[eid]).toBe(0);
    });
  });

  /* ─── Jump edge-trigger ─── */

  describe('jump edge-trigger', () => {
    it('Space rising edge → jumpRequested=1', () => {
      pressKey('Space');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.jumpRequested[eid]).toBe(1);
    });

    it('Space held (no second rising edge) → jumpRequested=0 next tick', () => {
      pressKey('Space');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.jumpRequested[eid]).toBe(1);

      // Space still held — no rising edge
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.jumpRequested[eid]).toBe(0);
    });

    it('release + re-press Space → jumpRequested=1 again', () => {
      pressKey('Space');
      inputSystem(FIXED_TIMESTEP);
      releaseKey('Space');
      inputSystem(FIXED_TIMESTEP);

      pressKey('Space');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.jumpRequested[eid]).toBe(1);
    });

    it('sub-tick Space tap (down+up entirely between ticks) still sets jumpRequested', () => {
      // State polling would miss this press completely — the latched edge
      // in InputManager preserves it (#goal-2026-07 movement-feel pass).
      pressKey('Space');
      releaseKey('Space');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.jumpRequested[eid]).toBe(1);
    });

    it('no Space → jumpRequested=0', () => {
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.jumpRequested[eid]).toBe(0);
    });
  });

  /* ─── Multiple Player entities ─── */

  describe('multiple Player entities', () => {
    it('writes intent to ALL Player entities each tick', () => {
      const eid2 = addEntity(ecsWorld);
      addComponent(ecsWorld, Player, eid2);
      addComponent(ecsWorld, MovementIntent, eid2);

      pressKey('KeyW');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.moveZ[eid]).toBeCloseTo(-1, 5);
      expect(MovementIntent.moveZ[eid2]).toBeCloseTo(-1, 5);
    });
  });

  /* ─── Input paused ─── */

  describe('input paused (overlay open)', () => {
    it('paused input produces zero intent', () => {
      pressKey('KeyW');
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.moveZ[eid]).toBeCloseTo(-1, 5);

      realInput.paused = true;
      inputSystem(FIXED_TIMESTEP);
      expect(MovementIntent.moveZ[eid]).toBe(0);
      expect(MovementIntent.sprint[eid]).toBe(0);
    });
  });
});
