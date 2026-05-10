import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GoldCounter } from './GoldCounter';
import { addGold, spendGold, setGold, resetWallet, getGold } from '../economy/Wallet';

describe('GoldCounter', () => {
  let counter: GoldCounter;

  beforeEach(() => {
    resetWallet();
    counter = new GoldCounter();
  });

  afterEach(() => {
    counter.dispose();
    resetWallet();
  });

  it('creates a #gold-counter element in the DOM', () => {
    expect(document.getElementById('gold-counter')).not.toBeNull();
  });

  it('renders the initial wallet value on construction', () => {
    const el = document.getElementById('gold-counter')!;
    expect(el.textContent).toBe(`Gold: ${getGold()}`);
  });

  it('updates the displayed value when the wallet changes via addGold', () => {
    addGold(50);
    const el = document.getElementById('gold-counter')!;
    expect(el.textContent).toBe('Gold: 250');
  });

  it('updates the displayed value when the wallet changes via spendGold', () => {
    spendGold(75);
    const el = document.getElementById('gold-counter')!;
    expect(el.textContent).toBe('Gold: 125');
  });

  it('updates the displayed value when the wallet changes via setGold', () => {
    setGold(999);
    const el = document.getElementById('gold-counter')!;
    expect(el.textContent).toBe('Gold: 999');
  });

  it('does NOT update when spendGold fails (insufficient funds)', () => {
    setGold(10); // forces re-render to "Gold: 10"
    spendGold(100); // fails
    const el = document.getElementById('gold-counter')!;
    expect(el.textContent).toBe('Gold: 10');
  });

  it('removes the element from the DOM on dispose', () => {
    counter.dispose();
    expect(document.getElementById('gold-counter')).toBeNull();
  });

  it('unsubscribes from Wallet on dispose — further changes do not throw', () => {
    counter.dispose();
    expect(() => addGold(50)).not.toThrow();
    // After dispose, no #gold-counter exists; the wallet still mutates fine.
    expect(getGold()).toBe(250);
    expect(document.getElementById('gold-counter')).toBeNull();
  });

  it('positions itself fixed in the top-right area', () => {
    const el = document.getElementById('gold-counter')!;
    expect(el.style.position).toBe('fixed');
    expect(el.style.right).toBe('16px');
  });
});
