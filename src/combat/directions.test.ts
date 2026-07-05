/**
 * Tests for the unified `Direction` enum + detection algorithm (FSM v2 #139).
 *
 * `detectDirectionFromDeltas` is the pure helper — exercised in isolation
 * here. `detectDirection` (the InputManager-aware wrapper) is exercised via
 * `CombatSystem` integration tests + a small smoke test below using a
 * partial mock InputManager.
 */

import { describe, it, expect } from 'vitest';
import {
  Direction,
  DEFAULT_DIRECTION_CONFIG,
  detectDirection,
  detectDirectionFromDeltas,
  forceStab,
} from './directions';
import type { InputManager } from '../input/InputManager';

describe('Direction enum (FSM v2 #139)', () => {
  it('has 4 contiguous values 0..3', () => {
    expect(Direction.Overhead).toBe(0);
    expect(Direction.Left).toBe(1);
    expect(Direction.Right).toBe(2);
    expect(Direction.Stab).toBe(3);
  });
});

describe('detectDirectionFromDeltas', () => {
  it('returns Stab when magnitude is below stabThreshold', () => {
    // Default threshold is 12 px; (3, 4) → magnitude 5.
    expect(detectDirectionFromDeltas(3, 4)).toBe(Direction.Stab);
  });

  it('returns Stab for exactly zero movement', () => {
    expect(detectDirectionFromDeltas(0, 0)).toBe(Direction.Stab);
  });

  it('returns Left for dominant horizontal-left motion', () => {
    expect(detectDirectionFromDeltas(-50, 0)).toBe(Direction.Left);
    // Slight vertical component, still horizontally dominant.
    expect(detectDirectionFromDeltas(-50, 10)).toBe(Direction.Left);
  });

  it('returns Right for dominant horizontal-right motion', () => {
    expect(detectDirectionFromDeltas(50, 0)).toBe(Direction.Right);
    expect(detectDirectionFromDeltas(50, -10)).toBe(Direction.Right);
  });

  it('returns Overhead for dominant upward motion (dy < 0)', () => {
    // Y-axis in screen coords: down is positive, up is negative.
    expect(detectDirectionFromDeltas(0, -50)).toBe(Direction.Overhead);
    expect(detectDirectionFromDeltas(10, -50)).toBe(Direction.Overhead);
  });

  it('returns Stab for dominant downward motion (dy > 0)', () => {
    // FSM v2 #139: vertical-down motion was Underhand in v1, folds into
    // Stab in 4-direction mode.
    expect(detectDirectionFromDeltas(0, 50)).toBe(Direction.Stab);
    expect(detectDirectionFromDeltas(-10, 50)).toBe(Direction.Stab);
  });

  it('returns Stab when neither axis dominates by axisRatio', () => {
    // (30, 30) — magnitude well above threshold but neither dominant.
    expect(detectDirectionFromDeltas(30, 30)).toBe(Direction.Stab);
    // (-25, 25) — diagonal, ambiguous.
    expect(detectDirectionFromDeltas(-25, 25)).toBe(Direction.Stab);
  });

  it('respects the axisRatio cutoff exactly', () => {
    // axisRatio = 1.2: |dx| > 1.2·|dy| ⇒ horizontal.
    // (24, 20): 24 / 20 = 1.2 — NOT >, so falls through to ambiguous.
    expect(detectDirectionFromDeltas(24, 20)).toBe(Direction.Stab);
    // (25, 20): 25 / 20 = 1.25 > 1.2 → horizontal.
    expect(detectDirectionFromDeltas(25, 20)).toBe(Direction.Right);
  });

  it('honors a custom config', () => {
    const strict = { ...DEFAULT_DIRECTION_CONFIG, stabThreshold: 100 };
    // (50, 0) is normally Right but threshold is now 100.
    expect(detectDirectionFromDeltas(50, 0, strict)).toBe(Direction.Stab);
  });
});

describe('detectDirection (InputManager wrapper)', () => {
  function mockInputManager(dx: number, dy: number): InputManager {
    return {
      getAccumulatedDelta(_windowMs: number) {
        return { dx, dy };
      },
    } as unknown as InputManager;
  }

  it('reads from getAccumulatedDelta and classifies', () => {
    expect(detectDirection(mockInputManager(0, 0))).toBe(Direction.Stab);
    expect(detectDirection(mockInputManager(-45, 0))).toBe(Direction.Left);
    expect(detectDirection(mockInputManager(0, -45))).toBe(Direction.Overhead);
    expect(detectDirection(mockInputManager(45, 0))).toBe(Direction.Right);
  });

  it('uses the configured bufferWindowMs when calling getAccumulatedDelta', () => {
    let observedWindow = -1;
    const im = {
      getAccumulatedDelta(windowMs: number) {
        observedWindow = windowMs;
        return { dx: 0, dy: 0 };
      },
    } as unknown as InputManager;
    detectDirection(im, { ...DEFAULT_DIRECTION_CONFIG, bufferWindowMs: 250 });
    expect(observedWindow).toBe(250);
  });

  it('defaults bufferWindowMs to 100', () => {
    let observedWindow = -1;
    const im = {
      getAccumulatedDelta(windowMs: number) {
        observedWindow = windowMs;
        return { dx: 0, dy: 0 };
      },
    } as unknown as InputManager;
    detectDirection(im);
    expect(observedWindow).toBe(100);
  });
});

describe('forceStab', () => {
  it('returns Direction.Stab', () => {
    expect(forceStab()).toBe(Direction.Stab);
  });
});
