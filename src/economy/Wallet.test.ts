import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getGold,
  addGold,
  spendGold,
  setGold,
  onGoldChange,
  resetWallet,
} from './Wallet';

describe('Wallet', () => {
  beforeEach(() => {
    resetWallet();
  });

  describe('getGold', () => {
    it('returns the default starting balance (200) on a fresh wallet', () => {
      expect(getGold()).toBe(200);
    });
  });

  describe('addGold', () => {
    it('increases the balance', () => {
      addGold(50);
      expect(getGold()).toBe(250);
    });

    it('ignores zero or negative amounts', () => {
      addGold(0);
      expect(getGold()).toBe(200);
      addGold(-10);
      expect(getGold()).toBe(200);
    });
  });

  describe('spendGold', () => {
    it('returns true and deducts when funds are sufficient', () => {
      const ok = spendGold(80);
      expect(ok).toBe(true);
      expect(getGold()).toBe(120);
    });

    it('returns false and does NOT deduct when funds are insufficient', () => {
      setGold(50);
      const ok = spendGold(100);
      expect(ok).toBe(false);
      expect(getGold()).toBe(50); // balance unchanged
    });

    it('returns false at the exact threshold of insufficiency', () => {
      setGold(99);
      const ok = spendGold(100);
      expect(ok).toBe(false);
      expect(getGold()).toBe(99);
    });

    it('allows spending the entire balance', () => {
      setGold(100);
      const ok = spendGold(100);
      expect(ok).toBe(true);
      expect(getGold()).toBe(0);
    });
  });

  describe('setGold', () => {
    it('overwrites the balance', () => {
      setGold(42);
      expect(getGold()).toBe(42);
    });

    it('clamps negative values to 0', () => {
      setGold(-5);
      expect(getGold()).toBe(0);
    });
  });

  describe('onGoldChange', () => {
    it('fires when addGold mutates the balance', () => {
      const cb = vi.fn();
      onGoldChange(cb);
      addGold(10);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(210);
    });

    it('fires when spendGold succeeds', () => {
      const cb = vi.fn();
      onGoldChange(cb);
      spendGold(50);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(150);
    });

    it('does NOT fire when spendGold fails (insufficient funds)', () => {
      setGold(10);
      const cb = vi.fn();
      onGoldChange(cb);
      const ok = spendGold(100);
      expect(ok).toBe(false);
      expect(cb).not.toHaveBeenCalled();
    });

    it('fires when setGold mutates the balance', () => {
      const cb = vi.fn();
      onGoldChange(cb);
      setGold(500);
      expect(cb).toHaveBeenCalledWith(500);
    });

    it('returns an unsubscribe function that stops further callbacks', () => {
      const cb = vi.fn();
      const unsub = onGoldChange(cb);

      addGold(10);
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();
      addGold(10);
      addGold(10);
      expect(cb).toHaveBeenCalledTimes(1); // still 1, no more after unsub
    });

    it('supports multiple subscribers independently', () => {
      const a = vi.fn();
      const b = vi.fn();
      const unsubA = onGoldChange(a);
      onGoldChange(b);

      addGold(5);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);

      unsubA();
      addGold(5);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(2);
    });

    it('unsubscribe is idempotent (calling it twice is safe)', () => {
      const cb = vi.fn();
      const unsub = onGoldChange(cb);
      unsub();
      expect(() => unsub()).not.toThrow();
    });
  });
});
