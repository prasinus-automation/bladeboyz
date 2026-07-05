import { describe, it, expect } from 'vitest';
import {
  isDebugDummyKey,
  shouldDispatchDebugKey,
  DEBUG_DUMMY_KEY_CODES,
} from './debugKeyGate';

describe('debugKeyGate (issue #172)', () => {
  describe('isDebugDummyKey', () => {
    it('recognises T / Y / J / K', () => {
      for (const code of ['KeyT', 'KeyY', 'KeyJ', 'KeyK']) {
        expect(isDebugDummyKey(code)).toBe(true);
      }
    });

    it('does not recognise other keys', () => {
      for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Escape', 'F4', 'KeyI']) {
        expect(isDebugDummyKey(code)).toBe(false);
      }
    });

    it('exposes the canonical set so callers can audit it', () => {
      expect(DEBUG_DUMMY_KEY_CODES.size).toBe(5);
      expect(DEBUG_DUMMY_KEY_CODES.has('KeyB')).toBe(true); // warmup bot toggle (#119)
    });
  });

  describe('shouldDispatchDebugKey', () => {
    const canvas = document.createElement('canvas');

    it('passes through non-debug keys regardless of state', () => {
      // Even when paused + no pointer lock, KeyW (or any non-debug key)
      // is not the gate's responsibility.
      expect(shouldDispatchDebugKey('KeyW', true, null, canvas)).toBe(true);
      expect(shouldDispatchDebugKey('KeyI', true, null, canvas)).toBe(true);
      expect(shouldDispatchDebugKey('Escape', false, canvas, canvas)).toBe(true);
    });

    it('blocks debug keys when input.paused is true', () => {
      // Even with pointer lock held, a paused input means an overlay is up.
      expect(shouldDispatchDebugKey('KeyT', true, canvas, canvas)).toBe(false);
      expect(shouldDispatchDebugKey('KeyY', true, canvas, canvas)).toBe(false);
      expect(shouldDispatchDebugKey('KeyJ', true, canvas, canvas)).toBe(false);
      expect(shouldDispatchDebugKey('KeyK', true, canvas, canvas)).toBe(false);
    });

    it('blocks debug keys when pointer lock is not held', () => {
      expect(shouldDispatchDebugKey('KeyT', false, null, canvas)).toBe(false);
      expect(shouldDispatchDebugKey('KeyY', false, null, canvas)).toBe(false);
      expect(shouldDispatchDebugKey('KeyJ', false, null, canvas)).toBe(false);
      expect(shouldDispatchDebugKey('KeyK', false, null, canvas)).toBe(false);
    });

    it('blocks debug keys when pointer lock is held by some OTHER element', () => {
      const otherEl = document.createElement('div');
      expect(shouldDispatchDebugKey('KeyT', false, otherEl, canvas)).toBe(false);
    });

    it('passes debug keys only when unpaused AND lock held by canvas', () => {
      expect(shouldDispatchDebugKey('KeyT', false, canvas, canvas)).toBe(true);
      expect(shouldDispatchDebugKey('KeyY', false, canvas, canvas)).toBe(true);
      expect(shouldDispatchDebugKey('KeyJ', false, canvas, canvas)).toBe(true);
      expect(shouldDispatchDebugKey('KeyK', false, canvas, canvas)).toBe(true);
    });
  });
});
