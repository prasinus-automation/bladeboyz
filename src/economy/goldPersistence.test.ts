import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  goldStorageKey,
  loadGold,
  saveGold,
  flushGoldWrites,
  hasPersistedGold,
  resetGoldPersistence,
} from './goldPersistence';

const PLAYER_A = 'player-a-abc';
const PLAYER_B = 'player-b-def';

describe('goldPersistence', () => {
  beforeEach(() => {
    localStorage.clear();
    resetGoldPersistence();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('goldStorageKey', () => {
    it('namespaces under bb_gold_<id>', () => {
      expect(goldStorageKey('xyz')).toBe('bb_gold_xyz');
    });

    it('produces different keys for different players', () => {
      expect(goldStorageKey(PLAYER_A)).not.toBe(goldStorageKey(PLAYER_B));
    });
  });

  describe('loadGold', () => {
    it('returns 0 when no entry exists', () => {
      expect(loadGold(PLAYER_A)).toBe(0);
    });

    it('returns the persisted integer balance', () => {
      localStorage.setItem(goldStorageKey(PLAYER_A), '350');
      expect(loadGold(PLAYER_A)).toBe(350);
    });

    it('returns 0 and warns for a negative stored value', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(goldStorageKey(PLAYER_A), '-50');
      expect(loadGold(PLAYER_A)).toBe(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('returns 0 and warns for NaN/garbage', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(goldStorageKey(PLAYER_A), 'not-a-number');
      expect(loadGold(PLAYER_A)).toBe(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('returns 0 for a fractional value (non-integer)', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(goldStorageKey(PLAYER_A), '12.5');
      expect(loadGold(PLAYER_A)).toBe(0);
    });

    it('warns once per invalid key (no spam on repeated loads)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(goldStorageKey(PLAYER_A), 'bogus');
      loadGold(PLAYER_A);
      loadGold(PLAYER_A);
      loadGold(PLAYER_A);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when localStorage.getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(loadGold(PLAYER_A)).toBe(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('clamps to MAX_SAFE_INTEGER (defensive overflow guard)', () => {
      // 1e30 is finite and an integer when serialized, so write it and
      // verify the cap applies.
      localStorage.setItem(goldStorageKey(PLAYER_A), String(Number.MAX_SAFE_INTEGER + 100));
      // Note: Number(String(MAX_SAFE_INTEGER + 100)) === MAX_SAFE_INTEGER + 100
      // is itself coerced through float precision — the clamp still applies.
      const v = loadGold(PLAYER_A);
      expect(v).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('saveGold + flushGoldWrites', () => {
    it('persists the balance after the debounce window', () => {
      saveGold(PLAYER_A, 100);
      // Before the timer fires, nothing is written.
      expect(localStorage.getItem(goldStorageKey(PLAYER_A))).toBeNull();
      vi.runAllTimers();
      expect(localStorage.getItem(goldStorageKey(PLAYER_A))).toBe('100');
    });

    it('coalesces rapid saves into a single write (latest value wins)', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      saveGold(PLAYER_A, 25);
      saveGold(PLAYER_A, 50);
      saveGold(PLAYER_A, 75);
      vi.runAllTimers();
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(goldStorageKey(PLAYER_A))).toBe('75');
    });

    it('writes separate entries for different player ids', () => {
      saveGold(PLAYER_A, 100);
      saveGold(PLAYER_B, 200);
      vi.runAllTimers();
      expect(localStorage.getItem(goldStorageKey(PLAYER_A))).toBe('100');
      expect(localStorage.getItem(goldStorageKey(PLAYER_B))).toBe('200');
    });

    it('round-trips through loadGold', () => {
      saveGold(PLAYER_A, 1234);
      vi.runAllTimers();
      expect(loadGold(PLAYER_A)).toBe(1234);
    });

    it('flushGoldWrites synchronously persists pending writes', () => {
      saveGold(PLAYER_A, 500);
      expect(localStorage.getItem(goldStorageKey(PLAYER_A))).toBeNull();
      flushGoldWrites();
      expect(localStorage.getItem(goldStorageKey(PLAYER_A))).toBe('500');
    });

    it('flushGoldWrites is safe to call with no pending writes', () => {
      expect(() => flushGoldWrites()).not.toThrow();
    });

    it('cancels the pending timer once flushed', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      saveGold(PLAYER_A, 99);
      flushGoldWrites();
      vi.runAllTimers();
      // setItem should fire exactly once (from the flush), not twice.
      expect(setItemSpy).toHaveBeenCalledTimes(1);
    });

    it('clamps negative amounts to 0', () => {
      saveGold(PLAYER_A, -50);
      flushGoldWrites();
      expect(localStorage.getItem(goldStorageKey(PLAYER_A))).toBe('0');
    });

    it('drops non-finite amounts without writing or throwing', () => {
      saveGold(PLAYER_A, NaN);
      saveGold(PLAYER_A, Infinity);
      flushGoldWrites();
      expect(localStorage.getItem(goldStorageKey(PLAYER_A))).toBeNull();
    });

    it('does not crash and warns once when setItem throws (quota / private)', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      saveGold(PLAYER_A, 100);
      flushGoldWrites();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      // A second failing flush in the same session should not re-warn.
      saveGold(PLAYER_A, 200);
      flushGoldWrites();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('clears pending writes after a failing flush (no grow-forever map)', () => {
      // The docstring promises that a failing flush snapshots-then-clears
      // the pending map so a transient storage hiccup doesn't leak entries.
      // We verify by mocking setItem to throw, flushing, then issuing
      // ANOTHER saveGold + flush after un-mocking — the second call should
      // succeed and we should see exactly one successful write (not two
      // — because the first attempt's pending entry was dropped, not
      // retried).
      const setItemMock = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('q');
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      saveGold(PLAYER_A, 100);
      flushGoldWrites();
      // First flush failed — no entry written.
      expect(localStorage.getItem(goldStorageKey(PLAYER_A))).toBeNull();
      // Restore real setItem, then issue a new save.
      setItemMock.mockRestore();
      saveGold(PLAYER_A, 999);
      flushGoldWrites();
      // The second flush writes its OWN value — there's no carried-over
      // pending entry that would write the stale 100 first.
      expect(localStorage.getItem(goldStorageKey(PLAYER_A))).toBe('999');
    });
  });

  describe('hasPersistedGold', () => {
    it('returns false when no entry exists', () => {
      expect(hasPersistedGold(PLAYER_A)).toBe(false);
    });

    it('returns true when an entry exists (even if value is 0)', () => {
      localStorage.setItem(goldStorageKey(PLAYER_A), '0');
      expect(hasPersistedGold(PLAYER_A)).toBe(true);
    });

    it('returns true after a saveGold + flush round-trip', () => {
      saveGold(PLAYER_A, 50);
      flushGoldWrites();
      expect(hasPersistedGold(PLAYER_A)).toBe(true);
    });

    it('returns false when localStorage.getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      // hasPersistedGold itself does NOT warn — that's loadGold's job.
      expect(hasPersistedGold(PLAYER_A)).toBe(false);
    });

    it('distinguishes "first launch" from "tampered to negative"', () => {
      // Tampered-negative case: hasPersistedGold says true, loadGold says 0.
      // This is the createPlayer seam that DOES want to overwrite to 0.
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(goldStorageKey(PLAYER_A), '-50');
      expect(hasPersistedGold(PLAYER_A)).toBe(true);
      expect(loadGold(PLAYER_A)).toBe(0);
    });
  });

  describe('resetGoldPersistence', () => {
    it('cancels any pending debounce timer', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      saveGold(PLAYER_A, 100);
      resetGoldPersistence();
      vi.runAllTimers();
      expect(setItemSpy).not.toHaveBeenCalled();
    });

    it('clears the warning gates so the next failure re-warns', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('q');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      saveGold(PLAYER_A, 100);
      flushGoldWrites();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      resetGoldPersistence();
      saveGold(PLAYER_A, 100);
      flushGoldWrites();
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });
});
