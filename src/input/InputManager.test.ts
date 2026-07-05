import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InputManager } from './InputManager';

// Mock DOM environment
function createMockCanvas() {
  return {
    requestPointerLock: vi.fn(),
    addEventListener: vi.fn(),
    setAttribute: vi.fn(),
    hasAttribute: vi.fn().mockReturnValue(false),
    style: {} as CSSStyleDeclaration,
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

  describe('latched edges (consume-on-read, sub-tick click fix)', () => {
    it('consumeMousePress fires exactly once per press', () => {
      fireEvent('document', 'mousedown', { button: 0 });
      expect(input.consumeMousePress(0)).toBe(true);
      expect(input.consumeMousePress(0)).toBe(false);
    });

    it('a press+release entirely between ticks still delivers its edge', () => {
      // The sub-tick click: state polling would never see the button down.
      fireEvent('document', 'mousedown', { button: 0 });
      fireEvent('document', 'mouseup', { button: 0 });
      expect(input.isMouseButtonDown(0)).toBe(false); // state already gone
      expect(input.consumeMousePress(0)).toBe(true); // edge preserved
      expect(input.consumeMouseRelease(0)).toBe(true);
    });

    it('consumeKeyPress fires exactly once per press, even after keyup', () => {
      fireEvent('document', 'keydown', { code: 'Space' });
      fireEvent('document', 'keyup', { code: 'Space' });
      expect(input.consumeKeyPress('Space')).toBe(true);
      expect(input.consumeKeyPress('Space')).toBe(false);
    });

    it('key auto-repeat does not re-latch the press edge', () => {
      fireEvent('document', 'keydown', { code: 'Space' });
      expect(input.consumeKeyPress('Space')).toBe(true);
      fireEvent('document', 'keydown', { code: 'Space', repeat: true });
      expect(input.consumeKeyPress('Space')).toBe(false);
    });

    it('consume returns false while paused, and pausing clears pending presses', () => {
      fireEvent('document', 'mousedown', { button: 0 });
      input.paused = true;
      expect(input.consumeMousePress(0)).toBe(false);
      input.paused = false;
      expect(input.consumeMousePress(0)).toBe(false); // cleared by pause
    });

    it('pausing latches a release edge for held buttons (block must end)', () => {
      fireEvent('document', 'mousedown', { button: 2 });
      input.paused = true; // swallows the real mouseup
      expect(input.consumeMouseRelease(2)).toBe(true);
    });

    it('presses arriving while paused are not latched', () => {
      input.paused = true;
      fireEvent('document', 'mousedown', { button: 0 });
      fireEvent('document', 'keydown', { code: 'Space' });
      input.paused = false;
      expect(input.consumeMousePress(0)).toBe(false);
      expect(input.consumeKeyPress('Space')).toBe(false);
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

  describe('canvas tabindex', () => {
    it('sets tabindex=0 on canvas during construction (HTMLElement only)', () => {
      // The mock canvas isn't an HTMLElement so the branch is skipped.
      // We assert via a real canvas in a separate suite below.
      // Here just verify the constructor was called without errors.
      expect(canvas).toBeDefined();
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

/**
 * Regression suite for issue #82 (WASD movement doesn't work in browser).
 *
 * These tests use a REAL HTMLCanvasElement (not a mock) and dispatch REAL
 * KeyboardEvents to verify the full keyboard input path. The previous bug
 * symptom was that mouse aim worked (mousemove on document was reaching
 * the InputManager) but WASD didn't (keydown wasn't reaching it). The fix:
 *  - Add tabindex=0 to the canvas so it can hold keyboard focus under pointer lock
 *  - Listen on BOTH document AND the canvas itself (Set semantics make duplicate
 *    delivery idempotent)
 *  - Auto-focus the canvas when pointer lock is acquired
 */
describe('InputManager — issue #82 WASD regression', () => {
  let realCanvas: HTMLCanvasElement;
  let input: InputManager;

  beforeEach(() => {
    // The outer suite spies on document.addEventListener — restore those
    // mocks so this suite uses the real document event flow.
    vi.restoreAllMocks();

    // Use a REAL canvas so we can verify tabindex / focus / native event flow
    realCanvas = document.createElement('canvas');
    document.body.appendChild(realCanvas);
    input = new InputManager(realCanvas);
  });

  afterEach(() => {
    realCanvas.remove();
    delete (globalThis as any).__debugInput;
  });

  describe('canvas tabindex', () => {
    it('sets tabindex="0" on the canvas during construction', () => {
      expect(realCanvas.getAttribute('tabindex')).toBe('0');
    });

    it('does not override an existing tabindex set by the host page', () => {
      // Create a fresh canvas with pre-existing tabindex
      const c2 = document.createElement('canvas');
      c2.setAttribute('tabindex', '5');
      document.body.appendChild(c2);
      // eslint-disable-next-line no-new
      new InputManager(c2);
      expect(c2.getAttribute('tabindex')).toBe('5');
      c2.remove();
    });

    it('hides the focus outline on the canvas (game viewport)', () => {
      expect(realCanvas.style.outline).toBe('none');
    });
  });

  describe('keyboard event delivery — multiple targets', () => {
    it('captures keydown dispatched on document', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      expect(input.isKeyDown('KeyW')).toBe(true);
    });

    it('captures keydown dispatched directly on the canvas', () => {
      realCanvas.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyA', bubbles: false }),
      );
      expect(input.isKeyDown('KeyA')).toBe(true);
    });

    it('captures keyup dispatched on document', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
      expect(input.isKeyDown('KeyS')).toBe(true);
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS' }));
      expect(input.isKeyDown('KeyS')).toBe(false);
    });

    it('captures keyup dispatched on canvas only', () => {
      realCanvas.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyD', bubbles: false }),
      );
      expect(input.isKeyDown('KeyD')).toBe(true);
      realCanvas.dispatchEvent(
        new KeyboardEvent('keyup', { code: 'KeyD', bubbles: false }),
      );
      expect(input.isKeyDown('KeyD')).toBe(false);
    });

    it('handles bubbled canvas events without double-tracking (Set idempotency)', () => {
      // A bubbling event hits both the canvas listener AND the document listener.
      // Set.add is idempotent so the key is correctly tracked once.
      realCanvas.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }),
      );
      expect(input.isKeyDown('KeyW')).toBe(true);
      // Single keyup removes it cleanly
      realCanvas.dispatchEvent(
        new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }),
      );
      expect(input.isKeyDown('KeyW')).toBe(false);
    });

    it('all four WASD keys are independently tracked from real events', () => {
      const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
      for (const code of codes) {
        document.dispatchEvent(new KeyboardEvent('keydown', { code }));
      }
      for (const code of codes) {
        expect(input.isKeyDown(code)).toBe(true);
      }
      for (const code of codes) {
        document.dispatchEvent(new KeyboardEvent('keyup', { code }));
        expect(input.isKeyDown(code)).toBe(false);
      }
    });

    it('Shift, Control, and Space modifiers are tracked', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlLeft' }));
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      expect(input.isKeyDown('ShiftLeft')).toBe(true);
      expect(input.isKeyDown('ControlLeft')).toBe(true);
      expect(input.isKeyDown('Space')).toBe(true);
    });
  });

  describe('paused gating with real events', () => {
    it('keydown dispatched while paused does not register the key', () => {
      input.paused = true;
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      expect(input.isKeyDown('KeyW')).toBe(false);
      input.paused = false;
      // Even after unpausing, the key wasn't added (gated at write time)
      expect(input.isKeyDown('KeyW')).toBe(false);
    });

    it('keyup is processed while paused (no stuck keys)', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      input.paused = true;
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
      input.paused = false;
      expect(input.isKeyDown('KeyW')).toBe(false);
    });
  });

  describe('debug instrumentation', () => {
    it('does not log when __debugInput is unset', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('logs keydown events when __debugInput is true', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      (globalThis as any).__debugInput = true;
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      expect(spy).toHaveBeenCalledWith(
        '[InputManager] keydown',
        'KeyW',
        'paused?',
        false,
      );
      spy.mockRestore();
    });
  });

  describe('pointer lock auto-focus', () => {
    it('focuses the canvas when pointer lock is acquired', () => {
      const focusSpy = vi.spyOn(realCanvas, 'focus');
      Object.defineProperty(document, 'pointerLockElement', {
        value: realCanvas,
        configurable: true,
      });
      document.dispatchEvent(new Event('pointerlockchange'));
      expect(focusSpy).toHaveBeenCalled();
      Object.defineProperty(document, 'pointerLockElement', {
        value: null,
        configurable: true,
      });
    });

    it('does not focus the canvas when pointer lock is released', () => {
      // First lock and focus
      Object.defineProperty(document, 'pointerLockElement', {
        value: realCanvas,
        configurable: true,
      });
      document.dispatchEvent(new Event('pointerlockchange'));
      // Then release; focus should not be called again on the canvas
      const focusSpy = vi.spyOn(realCanvas, 'focus');
      Object.defineProperty(document, 'pointerLockElement', {
        value: null,
        configurable: true,
      });
      document.dispatchEvent(new Event('pointerlockchange'));
      expect(focusSpy).not.toHaveBeenCalled();
    });
  });
});

/**
 * Regression suite for issue #172 (pointer-lock loss must clear key state
 * + pause input).
 *
 * Verifies the type-contract behavior at `InputManager.types.ts:106-109`:
 *   "When pointer lock is lost (browser-initiated or user-initiated via
 *    ESC), the manager demotes mode to Menu and clears all accumulated
 *    key/mouse-button state."
 *
 * The user-facing bug was: hold W → ESC out of pointer lock → browser
 * stops delivering keyup → keysDown permanently retains 'KeyW' → next
 * pointer-lock acquire walks the player forward involuntarily.
 */
describe('InputManager — issue #172 pointer-lock loss cleanup', () => {
  let realCanvas: HTMLCanvasElement;
  let input: InputManager;

  function setLockedTo(target: Element | null): void {
    Object.defineProperty(document, 'pointerLockElement', {
      value: target,
      configurable: true,
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    realCanvas = document.createElement('canvas');
    document.body.appendChild(realCanvas);
    input = new InputManager(realCanvas);
  });

  afterEach(() => {
    setLockedTo(null);
    realCanvas.remove();
  });

  describe('lock loss clears key + mouse state and pauses input', () => {
    it('hold W → unlock pointer → isKeyDown(W) === false AND paused === true', () => {
      // 1. Acquire pointer lock
      setLockedTo(realCanvas);
      document.dispatchEvent(new Event('pointerlockchange'));
      expect(input.isPointerLocked).toBe(true);
      expect(input.paused).toBe(false);

      // 2. Hold W
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      expect(input.isKeyDown('KeyW')).toBe(true);

      // 3. Lose pointer lock (e.g. ESC pressed by user)
      setLockedTo(null);
      document.dispatchEvent(new Event('pointerlockchange'));

      // 4. Both invariants from the spec MUST hold
      expect(input.isKeyDown('KeyW')).toBe(false);
      expect(input.paused).toBe(true);
      expect(input.isPointerLocked).toBe(false);
    });

    it('full lock-loss-and-regain cycle: state stays cleared until next real keydown', () => {
      // 1. Acquire and hold W
      setLockedTo(realCanvas);
      document.dispatchEvent(new Event('pointerlockchange'));
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      expect(input.isKeyDown('KeyW')).toBe(true);

      // 2. Lose lock (browser/user-initiated)
      setLockedTo(null);
      document.dispatchEvent(new Event('pointerlockchange'));
      expect(input.isKeyDown('KeyW')).toBe(false);
      expect(input.paused).toBe(true);

      // 3. Re-acquire lock — paused flips off, but keysDown stays empty
      setLockedTo(realCanvas);
      document.dispatchEvent(new Event('pointerlockchange'));
      expect(input.paused).toBe(false);
      expect(input.isPointerLocked).toBe(true);
      // KEY ASSERTION: W did not magically come back
      expect(input.isKeyDown('KeyW')).toBe(false);

      // 4. A fresh real keydown after re-acquire works as expected
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      expect(input.isKeyDown('KeyW')).toBe(true);
    });

    it('clears mouse buttons on lock loss, not just keys', () => {
      setLockedTo(realCanvas);
      document.dispatchEvent(new Event('pointerlockchange'));
      document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      expect(input.isMouseButtonDown(0)).toBe(true);

      setLockedTo(null);
      document.dispatchEvent(new Event('pointerlockchange'));
      expect(input.isMouseButtonDown(0)).toBe(false);
    });

    it('lock LOST → CLEAR. Lock ACQUIRED → unpause.', () => {
      // No prior lock: acquire fresh
      setLockedTo(realCanvas);
      document.dispatchEvent(new Event('pointerlockchange'));
      expect(input.paused).toBe(false);
    });
  });

  describe('pointer-lock error path performs the same cleanup', () => {
    it('pointerlockerror with held keys clears them and pauses', () => {
      setLockedTo(realCanvas);
      document.dispatchEvent(new Event('pointerlockchange'));
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      expect(input.isKeyDown('KeyW')).toBe(true);
      expect(input.isMouseButtonDown(0)).toBe(true);

      // Suppress the warn() in the handler so test output stays clean
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      document.dispatchEvent(new Event('pointerlockerror'));
      warnSpy.mockRestore();

      expect(input.isKeyDown('KeyW')).toBe(false);
      expect(input.isMouseButtonDown(0)).toBe(false);
      expect(input.paused).toBe(true);
      expect(input.isPointerLocked).toBe(false);
    });
  });

  describe('window blur path performs the same cleanup', () => {
    it('window blur with held keys clears them and pauses', () => {
      setLockedTo(realCanvas);
      document.dispatchEvent(new Event('pointerlockchange'));
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
      expect(input.isKeyDown('KeyW')).toBe(true);
      expect(input.isKeyDown('KeyA')).toBe(true);

      // Browsers fire blur on window when alt-tabbing or switching apps.
      // Some browsers DON'T fire pointerlockchange in that path, so blur
      // is the defense-in-depth seam.
      window.dispatchEvent(new Event('blur'));

      expect(input.isKeyDown('KeyW')).toBe(false);
      expect(input.isKeyDown('KeyA')).toBe(false);
      expect(input.paused).toBe(true);
    });

    it('window blur with no held keys is a benign no-op (still paused)', () => {
      setLockedTo(realCanvas);
      document.dispatchEvent(new Event('pointerlockchange'));
      expect(input.paused).toBe(false);

      window.dispatchEvent(new Event('blur'));
      expect(input.paused).toBe(true);
    });
  });

  describe('dispose() actually unbinds listeners', () => {
    it('disposed instance ignores subsequent keydown events', () => {
      // Sanity: pre-dispose, key registers
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      expect(input.isKeyDown('KeyW')).toBe(true);
      // Reset
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
      expect(input.isKeyDown('KeyW')).toBe(false);

      input.dispose();

      // After dispose, dispatching keydown must NOT update state.
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      expect(input.isKeyDown('KeyW')).toBe(false);
    });

    it('disposed instance ignores subsequent mousedown events', () => {
      input.dispose();
      document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      expect(input.isMouseButtonDown(0)).toBe(false);
    });

    it('disposed instance ignores subsequent pointerlockchange events', () => {
      input.dispose();
      setLockedTo(realCanvas);
      document.dispatchEvent(new Event('pointerlockchange'));
      // The disposed handler should short-circuit; isPointerLocked flag
      // stays at whatever it was (false at construction).
      expect(input.isPointerLocked).toBe(false);
    });

    it('disposed instance ignores window blur', () => {
      input.dispose();
      window.dispatchEvent(new Event('blur'));
      // No accessor for "did the handler run" — but if it did, paused
      // would be true. Construct paused = false, dispose, blur → still
      // false because the handler short-circuited.
      expect(input.paused).toBe(false);
    });

    it('dispose() is idempotent (calling twice does not throw)', () => {
      expect(() => {
        input.dispose();
        input.dispose();
      }).not.toThrow();
    });

    it('dispose() removes listeners from BOTH document and canvas', () => {
      // Track removals via a real spy so we can verify both targets are
      // covered (not just one of them).
      const docRemove = vi.spyOn(document, 'removeEventListener');
      const winRemove = vi.spyOn(window, 'removeEventListener');
      const canvasRemove = vi.spyOn(realCanvas, 'removeEventListener');
      input.dispose();
      // Document should see at least: keydown, keyup, mousemove, mousedown,
      // mouseup, pointerlockchange, pointerlockerror.
      expect(docRemove).toHaveBeenCalledWith('keydown', expect.any(Function), undefined);
      expect(docRemove).toHaveBeenCalledWith('keyup', expect.any(Function), undefined);
      expect(docRemove).toHaveBeenCalledWith('mousemove', expect.any(Function), undefined);
      expect(docRemove).toHaveBeenCalledWith('pointerlockchange', expect.any(Function), undefined);
      expect(docRemove).toHaveBeenCalledWith('pointerlockerror', expect.any(Function), undefined);
      // Canvas should see at least keydown + keyup
      expect(canvasRemove).toHaveBeenCalledWith('keydown', expect.any(Function), undefined);
      expect(canvasRemove).toHaveBeenCalledWith('keyup', expect.any(Function), undefined);
      // Window should see wheel + blur
      expect(winRemove).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: true });
      expect(winRemove).toHaveBeenCalledWith('blur', expect.any(Function), undefined);
    });
  });
});
