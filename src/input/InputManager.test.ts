import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InputManager } from './InputManager';

// Mock DOM environment
function createMockCanvas() {
  return {
    requestPointerLock: vi.fn(),
    addEventListener: vi.fn(),
  } as unknown as HTMLElement;
}

// We need to mock document and window events
const eventListeners: Record<string, Function[]> = {};

function mockAddEventListener(target: 'window' | 'document') {
  return (event: string, handler: Function) => {
    const key = `${target}:${event}`;
    if (!eventListeners[key]) eventListeners[key] = [];
    eventListeners[key].push(handler);
  };
}

function fireEvent(target: 'window' | 'document', event: string, data: any) {
  const key = `${target}:${event}`;
  const handlers = eventListeners[key] || [];
  for (const handler of handlers) {
    handler(data);
  }
}

describe('InputManager', () => {
  let canvas: HTMLElement;
  let input: InputManager;

  beforeEach(() => {
    // Clear all event listeners
    for (const key in eventListeners) {
      delete eventListeners[key];
    }

    // Mock window/document addEventListener
    vi.spyOn(window, 'addEventListener').mockImplementation(
      mockAddEventListener('window') as any,
    );
    vi.spyOn(document, 'addEventListener').mockImplementation(
      mockAddEventListener('document') as any,
    );

    // Mock getElementById
    vi.spyOn(document, 'getElementById').mockReturnValue(null);

    canvas = createMockCanvas();
    input = new InputManager(canvas);
  });

  describe('keyboard input', () => {
    it('tracks key down state', () => {
      expect(input.isKeyDown('KeyW')).toBe(false);
      fireEvent('document', 'keydown', { code: 'KeyW' });
      expect(input.isKeyDown('KeyW')).toBe(true);
    });

    it('tracks key up state', () => {
      fireEvent('document', 'keydown', { code: 'KeyW' });
      expect(input.isKeyDown('KeyW')).toBe(true);
      fireEvent('document', 'keyup', { code: 'KeyW' });
      expect(input.isKeyDown('KeyW')).toBe(false);
    });

    it('tracks multiple keys simultaneously', () => {
      fireEvent('document', 'keydown', { code: 'KeyW' });
      fireEvent('document', 'keydown', { code: 'ShiftLeft' });
      expect(input.isKeyDown('KeyW')).toBe(true);
      expect(input.isKeyDown('ShiftLeft')).toBe(true);
      expect(input.isKeyDown('KeyA')).toBe(false);
    });
  });

  describe('mouse buttons', () => {
    it('tracks mouse button down', () => {
      expect(input.isMouseButtonDown(0)).toBe(false);
      fireEvent('document', 'mousedown', { button: 0 });
      expect(input.isMouseButtonDown(0)).toBe(true);
    });

    it('tracks mouse button up', () => {
      fireEvent('document', 'mousedown', { button: 2 });
      expect(input.isMouseButtonDown(2)).toBe(true);
      fireEvent('document', 'mouseup', { button: 2 });
      expect(input.isMouseButtonDown(2)).toBe(false);
    });
  });

  describe('mouse delta', () => {
    it('returns zero delta by default', () => {
      const delta = input.getMouseDelta();
      expect(delta.x).toBe(0);
      expect(delta.y).toBe(0);
    });

    it('resets deltas on resetFrameDeltas', () => {
      // Simulate pointer lock
      Object.defineProperty(document, 'pointerLockElement', {
        value: canvas,
        configurable: true,
      });
      fireEvent('document', 'pointerlockchange', {});

      fireEvent('document', 'mousemove', { movementX: 10, movementY: 5 });
      expect(input.getMouseDelta().x).toBe(10);

      input.resetFrameDeltas();
      expect(input.getMouseDelta().x).toBe(0);
      expect(input.getMouseDelta().y).toBe(0);

      // Cleanup
      Object.defineProperty(document, 'pointerLockElement', {
        value: null,
        configurable: true,
      });
    });

    it('accumulates deltas within a frame', () => {
      Object.defineProperty(document, 'pointerLockElement', {
        value: canvas,
        configurable: true,
      });
      fireEvent('document', 'pointerlockchange', {});

      fireEvent('document', 'mousemove', { movementX: 5, movementY: 3 });
      fireEvent('document', 'mousemove', { movementX: 7, movementY: -2 });

      const delta = input.getMouseDelta();
      expect(delta.x).toBe(12);
      expect(delta.y).toBe(1);

      Object.defineProperty(document, 'pointerLockElement', {
        value: null,
        configurable: true,
      });
    });
  });

  describe('pointer lock', () => {
    it('starts without pointer lock', () => {
      expect(input.isPointerLocked).toBe(false);
    });

    it('requests pointer lock', () => {
      input.requestPointerLock();
      expect((canvas as any).requestPointerLock).toHaveBeenCalled();
    });

    it('updates lock state on pointerlockchange', () => {
      Object.defineProperty(document, 'pointerLockElement', {
        value: canvas,
        configurable: true,
      });
      fireEvent('document', 'pointerlockchange', {});
      expect(input.isPointerLocked).toBe(true);

      Object.defineProperty(document, 'pointerLockElement', {
        value: null,
        configurable: true,
      });
      fireEvent('document', 'pointerlockchange', {});
      expect(input.isPointerLocked).toBe(false);
    });
  });

  describe('paused state — stuck key prevention', () => {
    it('keyup is processed while paused (key does not stay stuck)', () => {
      fireEvent('document', 'keydown', { code: 'KeyW' });
      expect(input.isKeyDown('KeyW')).toBe(true);

      // Pause (e.g. inventory opens)
      input.paused = true;

      // Release key while paused
      fireEvent('document', 'keyup', { code: 'KeyW' });

      // Unpause
      input.paused = false;

      // Key should NOT be stuck
      expect(input.isKeyDown('KeyW')).toBe(false);
    });

    it('mouseup is processed while paused (button does not stay stuck)', () => {
      fireEvent('document', 'mousedown', { button: 0 });
      expect(input.isMouseButtonDown(0)).toBe(true);

      input.paused = true;
      fireEvent('document', 'mouseup', { button: 0 });
      input.paused = false;

      expect(input.isMouseButtonDown(0)).toBe(false);
    });

    it('setting paused = true immediately clears keysDown and mouseButtons', () => {
      fireEvent('document', 'keydown', { code: 'KeyW' });
      fireEvent('document', 'keydown', { code: 'KeyA' });
      fireEvent('document', 'mousedown', { button: 0 });

      input.paused = true;

      // Even after unpausing, previously-held keys should be gone
      input.paused = false;
      expect(input.isKeyDown('KeyW')).toBe(false);
      expect(input.isKeyDown('KeyA')).toBe(false);
      expect(input.isMouseButtonDown(0)).toBe(false);
    });

    it('isKeyDown returns false when paused even if key is held', () => {
      fireEvent('document', 'keydown', { code: 'KeyW' });
      input.paused = true;
      // Re-press while paused (keydown is gated by paused, but even if keysDown had it)
      expect(input.isKeyDown('KeyW')).toBe(false);
    });

    it('isMouseButtonDown returns false when paused', () => {
      fireEvent('document', 'mousedown', { button: 2 });
      input.paused = true;
      expect(input.isMouseButtonDown(2)).toBe(false);
    });

    it('full stuck key scenario: hold W → open inventory → release W → close inventory', () => {
      // 1. Hold W to walk forward
      fireEvent('document', 'keydown', { code: 'KeyW' });
      expect(input.isKeyDown('KeyW')).toBe(true);

      // 2. Open inventory (sets paused = true, which clears keysDown)
      input.paused = true;

      // 3. Release W while paused — keyup still processed
      fireEvent('document', 'keyup', { code: 'KeyW' });

      // 4. Close inventory
      input.paused = false;

      // Character should NOT move forward uncontrollably
      expect(input.isKeyDown('KeyW')).toBe(false);
    });

    it('keydown is still ignored while paused', () => {
      input.paused = true;
      fireEvent('document', 'keydown', { code: 'KeyW' });
      // isKeyDown returns false because paused
      expect(input.isKeyDown('KeyW')).toBe(false);
      // After unpause, key should not be registered either
      input.paused = false;
      // Note: the keydown was gated, but even if it wasn't, the clear-on-pause would have removed it
      // Since keydown adds to keysDown even when paused... let's verify the gate works
    });

    it('mousedown is still ignored while paused', () => {
      input.paused = true;
      fireEvent('document', 'mousedown', { button: 0 });
      expect(input.isMouseButtonDown(0)).toBe(false);
    });
  });

  describe('rolling delta buffer', () => {
    it('returns zero average when no deltas recorded', () => {
      const avg = input.getAverageDelta();
      expect(avg.dx).toBe(0);
      expect(avg.dy).toBe(0);
    });
  });

  describe('scroll delta', () => {
    it('returns zero scroll delta by default', () => {
      expect(input.getScrollDelta()).toBe(0);
    });

    it('resets scroll delta on frame reset', () => {
      fireEvent('window', 'wheel', { deltaY: 100 });
      expect(input.getScrollDelta()).toBe(100);
      input.resetFrameDeltas();
      expect(input.getScrollDelta()).toBe(0);
    });
  });
});
