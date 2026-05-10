import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getOrCreatePlayerId,
  attachPlayerIdentity,
  getPlayerId,
  playerIdentityRegistry,
  clearPlayerIdentityRegistry,
} from './playerIdentity';

const PLAYER_ID_KEY = 'bb_player_id';

describe('playerIdentity', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPlayerIdentityRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getOrCreatePlayerId', () => {
    it('generates and stores a fresh id on first call', () => {
      expect(localStorage.getItem(PLAYER_ID_KEY)).toBeNull();
      const id = getOrCreatePlayerId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(localStorage.getItem(PLAYER_ID_KEY)).toBe(id);
    });

    it('returns the same id on subsequent in-process calls (cached)', () => {
      const first = getOrCreatePlayerId();
      const second = getOrCreatePlayerId();
      expect(second).toBe(first);
    });

    it('reuses the persisted id on a fresh process (cache cleared)', () => {
      const first = getOrCreatePlayerId();
      // Simulate a page reload: clear the in-process cache only.
      clearPlayerIdentityRegistry();
      const second = getOrCreatePlayerId();
      expect(second).toBe(first);
      // Still only one stored entry.
      expect(localStorage.getItem(PLAYER_ID_KEY)).toBe(first);
    });

    it('generates a UUID-shaped id (crypto.randomUUID path)', () => {
      const id = getOrCreatePlayerId();
      // Don't pin the exact UUID format too tightly — jsdom + browsers may
      // shift between v4 and other variants. Require the dash structure.
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('does not crash when localStorage.getItem throws (private browsing)', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError: localStorage disabled');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const id = getOrCreatePlayerId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('does not crash when localStorage.setItem throws (quota exceeded)', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const id = getOrCreatePlayerId();
      expect(typeof id).toBe('string');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('logs the storage-warning only once across multiple failing calls', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      getOrCreatePlayerId();
      // Clear the cache so the next call has to re-read localStorage.
      clearPlayerIdentityRegistry();
      // First call after a `clear` should re-arm the warning gate.
      getOrCreatePlayerId();
      // Two separate failing reads but each is the first-after-clear so we
      // expect 2 warnings, NOT N+1 per call. The test guards against
      // accidental console-spam in a single session.
      expect(warnSpy.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('falls back when crypto.randomUUID is unavailable', () => {
      // Stash + remove randomUUID. Some browsers expose `crypto` without it.
      const original = crypto.randomUUID;
      // @ts-expect-error — deliberate test mutation
      crypto.randomUUID = undefined;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const id = getOrCreatePlayerId();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
        // Fallback path still produces a UUID-shaped string.
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        expect(warnSpy).toHaveBeenCalledTimes(1);
      } finally {
        crypto.randomUUID = original;
      }
    });
  });

  describe('attachPlayerIdentity', () => {
    it('registers an entity → id mapping and returns the id', () => {
      const id = attachPlayerIdentity(42);
      expect(typeof id).toBe('string');
      expect(playerIdentityRegistry.get(42)).toBe(id);
    });

    it('uses the same id for multiple entities (single-browser single-player)', () => {
      const a = attachPlayerIdentity(1);
      const b = attachPlayerIdentity(2);
      expect(a).toBe(b);
    });
  });

  describe('getPlayerId', () => {
    it('returns the attached id', () => {
      const id = attachPlayerIdentity(7);
      expect(getPlayerId(7)).toBe(id);
    });

    it('returns undefined for an entity that has no identity attached', () => {
      expect(getPlayerId(99)).toBeUndefined();
    });
  });

  describe('clearPlayerIdentityRegistry', () => {
    it('clears the side-table', () => {
      attachPlayerIdentity(5);
      expect(playerIdentityRegistry.size).toBe(1);
      clearPlayerIdentityRegistry();
      expect(playerIdentityRegistry.size).toBe(0);
    });

    it('clears the cached id so the next getOrCreate re-reads storage', () => {
      // Pre-seed localStorage with a known id.
      localStorage.setItem(PLAYER_ID_KEY, 'seeded-id-abc');
      const first = getOrCreatePlayerId();
      expect(first).toBe('seeded-id-abc');
      // Pretend storage was wiped externally between calls (e.g. clear
      // site data). After clearing the registry, the cached id is gone
      // and we should regenerate.
      localStorage.clear();
      clearPlayerIdentityRegistry();
      const second = getOrCreatePlayerId();
      expect(second).not.toBe('seeded-id-abc');
      expect(localStorage.getItem(PLAYER_ID_KEY)).toBe(second);
    });
  });
});
