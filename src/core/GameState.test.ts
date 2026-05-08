/**
 * GameStateManager — unit tests
 */
import { describe, it, expect, vi } from 'vitest';
import { GameState, GameStateManager, GAME_STATE_NAMES } from './GameState';

describe('GameStateManager', () => {
  describe('initial state', () => {
    it('defaults to MAIN_MENU', () => {
      const gsm = new GameStateManager();
      expect(gsm.state).toBe(GameState.MAIN_MENU);
    });
  });

  describe('state transitions', () => {
    it('updates state when set to a different value', () => {
      const gsm = new GameStateManager();
      gsm.state = GameState.PLAYING;
      expect(gsm.state).toBe(GameState.PLAYING);
    });

    it('supports all three states', () => {
      const gsm = new GameStateManager();
      gsm.state = GameState.PLAYING;
      expect(gsm.state).toBe(GameState.PLAYING);
      gsm.state = GameState.PAUSED;
      expect(gsm.state).toBe(GameState.PAUSED);
      gsm.state = GameState.MAIN_MENU;
      expect(gsm.state).toBe(GameState.MAIN_MENU);
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('fires listener on state change', () => {
      const gsm = new GameStateManager();
      const fn = vi.fn();
      gsm.subscribe(fn);
      gsm.state = GameState.PLAYING;
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(GameState.PLAYING);
    });

    it('does not fire listener on equal-value write', () => {
      const gsm = new GameStateManager();
      const fn = vi.fn();
      gsm.subscribe(fn);
      // Default is MAIN_MENU; setting MAIN_MENU again is a no-op
      gsm.state = GameState.MAIN_MENU;
      expect(fn).not.toHaveBeenCalled();
    });

    it('fires multiple listeners in subscription order', () => {
      const gsm = new GameStateManager();
      const calls: string[] = [];
      gsm.subscribe(() => calls.push('a'));
      gsm.subscribe(() => calls.push('b'));
      gsm.subscribe(() => calls.push('c'));
      gsm.state = GameState.PLAYING;
      expect(calls).toEqual(['a', 'b', 'c']);
    });

    it('returns an unsubscribe function that stops further calls', () => {
      const gsm = new GameStateManager();
      const fn = vi.fn();
      const unsub = gsm.subscribe(fn);
      gsm.state = GameState.PLAYING;
      expect(fn).toHaveBeenCalledTimes(1);
      unsub();
      gsm.state = GameState.PAUSED;
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('listenerCount tracks subscribers', () => {
      const gsm = new GameStateManager();
      expect(gsm.listenerCount).toBe(0);
      const u1 = gsm.subscribe(() => {});
      const u2 = gsm.subscribe(() => {});
      expect(gsm.listenerCount).toBe(2);
      u1();
      expect(gsm.listenerCount).toBe(1);
      u2();
      expect(gsm.listenerCount).toBe(0);
    });

    it('listener that unsubscribes itself during dispatch does not break iteration', () => {
      const gsm = new GameStateManager();
      const calls: string[] = [];
      let unsubA: (() => void) | null = null;
      unsubA = gsm.subscribe(() => {
        calls.push('a');
        unsubA?.();
      });
      gsm.subscribe(() => calls.push('b'));
      gsm.state = GameState.PLAYING;
      expect(calls).toEqual(['a', 'b']);
    });

    it('listener that throws does not prevent other listeners firing', () => {
      const gsm = new GameStateManager();
      const calls: string[] = [];
      // Suppress noisy console.error for this test
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      gsm.subscribe(() => {
        calls.push('a');
        throw new Error('boom');
      });
      gsm.subscribe(() => calls.push('b'));
      gsm.state = GameState.PLAYING;
      expect(calls).toEqual(['a', 'b']);
      errSpy.mockRestore();
    });
  });

  describe('GAME_STATE_NAMES', () => {
    it('has a label for every state value', () => {
      expect(GAME_STATE_NAMES[GameState.MAIN_MENU]).toBe('MAIN_MENU');
      expect(GAME_STATE_NAMES[GameState.PLAYING]).toBe('PLAYING');
      expect(GAME_STATE_NAMES[GameState.PAUSED]).toBe('PAUSED');
    });
  });
});
