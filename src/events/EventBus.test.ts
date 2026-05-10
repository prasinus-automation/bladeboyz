import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from './EventBus';

describe('EventBus', () => {
  beforeEach(() => {
    EventBus.clear();
  });

  describe('emit + flush', () => {
    it('events are NOT delivered until flush()', () => {
      const handler = vi.fn();
      EventBus.on('DamageDealt', handler);

      EventBus.emit('DamageDealt', {
        victimEid: 1,
        attackerEid: 2,
        amount: 10,
        bodyRegion: 0,
        weaponId: 0,
        attackDirection: 0,
        isLethal: false,
        tick: 1,
      });

      expect(handler).not.toHaveBeenCalled();

      EventBus.flush();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('handler receives the exact payload that was emitted', () => {
      const handler = vi.fn();
      EventBus.on('DeathEvent', handler);

      const payload = {
        victimEid: 7,
        killerEid: 9,
        weaponId: 2,
        bodyRegion: 1,
        tick: 42,
      };
      EventBus.emit('DeathEvent', payload);
      EventBus.flush();

      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('flush is a no-op when the queue is empty', () => {
      const handler = vi.fn();
      EventBus.on('DeathEvent', handler);
      EventBus.flush();
      expect(handler).not.toHaveBeenCalled();
    });

    it('multiple emits are all delivered on the next flush in order', () => {
      const calls: number[] = [];
      EventBus.on('DamageDealt', (p) => calls.push(p.amount));

      EventBus.emit('DamageDealt', {
        victimEid: 1, attackerEid: 2, amount: 1, bodyRegion: 0, weaponId: 0, attackDirection: 0, isLethal: false, tick: 0,
      });
      EventBus.emit('DamageDealt', {
        victimEid: 1, attackerEid: 2, amount: 2, bodyRegion: 0, weaponId: 0, attackDirection: 0, isLethal: false, tick: 0,
      });
      EventBus.emit('DamageDealt', {
        victimEid: 1, attackerEid: 2, amount: 3, bodyRegion: 0, weaponId: 0, attackDirection: 0, isLethal: false, tick: 0,
      });

      EventBus.flush();
      expect(calls).toEqual([1, 2, 3]);
    });
  });

  describe('multiple subscribers', () => {
    it('all subscribers receive the event', () => {
      const a = vi.fn();
      const b = vi.fn();
      const c = vi.fn();
      EventBus.on('DeathEvent', a);
      EventBus.on('DeathEvent', b);
      EventBus.on('DeathEvent', c);

      EventBus.emit('DeathEvent', {
        victimEid: 1, killerEid: 0, weaponId: 0, bodyRegion: 0, tick: 0,
      });
      EventBus.flush();

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
      expect(c).toHaveBeenCalledTimes(1);
    });

    it('subscribers for different event types are isolated', () => {
      const damageHandler = vi.fn();
      const deathHandler = vi.fn();
      EventBus.on('DamageDealt', damageHandler);
      EventBus.on('DeathEvent', deathHandler);

      EventBus.emit('DamageDealt', {
        victimEid: 1, attackerEid: 2, amount: 1, bodyRegion: 0, weaponId: 0, attackDirection: 0, isLethal: false, tick: 0,
      });
      EventBus.flush();

      expect(damageHandler).toHaveBeenCalledTimes(1);
      expect(deathHandler).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('unsubscribed handlers stop receiving events', () => {
      const handler = vi.fn();
      const unsub = EventBus.on('DeathEvent', handler);

      EventBus.emit('DeathEvent', {
        victimEid: 1, killerEid: 0, weaponId: 0, bodyRegion: 0, tick: 0,
      });
      EventBus.flush();
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();

      EventBus.emit('DeathEvent', {
        victimEid: 2, killerEid: 0, weaponId: 0, bodyRegion: 0, tick: 0,
      });
      EventBus.flush();
      expect(handler).toHaveBeenCalledTimes(1); // still 1
    });

    it('unsubscribing one handler does not affect siblings', () => {
      const a = vi.fn();
      const b = vi.fn();
      const unsubA = EventBus.on('DeathEvent', a);
      EventBus.on('DeathEvent', b);

      unsubA();

      EventBus.emit('DeathEvent', {
        victimEid: 1, killerEid: 0, weaponId: 0, bodyRegion: 0, tick: 0,
      });
      EventBus.flush();

      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe is idempotent (calling twice is safe)', () => {
      const handler = vi.fn();
      const unsub = EventBus.on('DeathEvent', handler);
      unsub();
      expect(() => unsub()).not.toThrow();
    });

    it('unsubscribing during dispatch removes only the target handler', () => {
      const a = vi.fn();
      let unsubB: (() => void) | null = null;
      const b = vi.fn(() => unsubB!());
      const c = vi.fn();
      EventBus.on('DeathEvent', a);
      unsubB = EventBus.on('DeathEvent', b);
      EventBus.on('DeathEvent', c);

      EventBus.emit('DeathEvent', {
        victimEid: 1, killerEid: 0, weaponId: 0, bodyRegion: 0, tick: 0,
      });
      EventBus.flush();

      // All three see the first event
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
      expect(c).toHaveBeenCalledTimes(1);

      // Second event: b is gone
      EventBus.emit('DeathEvent', {
        victimEid: 2, killerEid: 0, weaponId: 0, bodyRegion: 0, tick: 0,
      });
      EventBus.flush();
      expect(a).toHaveBeenCalledTimes(2);
      expect(b).toHaveBeenCalledTimes(1);
      expect(c).toHaveBeenCalledTimes(2);
    });
  });

  describe('clear', () => {
    it('clear() removes all subscribers', () => {
      const handler = vi.fn();
      EventBus.on('DeathEvent', handler);

      EventBus.clear();

      EventBus.emit('DeathEvent', {
        victimEid: 1, killerEid: 0, weaponId: 0, bodyRegion: 0, tick: 0,
      });
      EventBus.flush();
      expect(handler).not.toHaveBeenCalled();
    });

    it('clear() drops queued events', () => {
      EventBus.emit('DeathEvent', {
        victimEid: 1, killerEid: 0, weaponId: 0, bodyRegion: 0, tick: 0,
      });
      expect(EventBus.pendingCount()).toBe(1);
      EventBus.clear();
      expect(EventBus.pendingCount()).toBe(0);
    });
  });

  describe('error isolation', () => {
    it('a throwing handler does not stop sibling handlers', () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const a = vi.fn(() => { throw new Error('boom'); });
        const b = vi.fn();
        EventBus.on('DeathEvent', a);
        EventBus.on('DeathEvent', b);

        EventBus.emit('DeathEvent', {
          victimEid: 1, killerEid: 0, weaponId: 0, bodyRegion: 0, tick: 0,
        });
        EventBus.flush();

        expect(b).toHaveBeenCalledTimes(1);
        expect(errSpy).toHaveBeenCalled();
      } finally {
        errSpy.mockRestore();
      }
    });
  });

  describe('re-emit during dispatch', () => {
    it('events emitted by a handler land on the next flush, not the current one', () => {
      const calls: string[] = [];
      let reentered = false;
      EventBus.on('DamageDealt', (p) => {
        calls.push(`damage-${p.amount}`);
        if (!reentered) {
          reentered = true;
          // re-emit a death event during dispatch
          EventBus.emit('DeathEvent', {
            victimEid: p.victimEid, killerEid: 0, weaponId: 0, bodyRegion: 0, tick: 0,
          });
        }
      });
      EventBus.on('DeathEvent', () => {
        calls.push('death');
      });

      EventBus.emit('DamageDealt', {
        victimEid: 1, attackerEid: 2, amount: 5, bodyRegion: 0, weaponId: 0, attackDirection: 0, isLethal: false, tick: 0,
      });

      EventBus.flush();
      // Death NOT delivered yet because it was re-emitted DURING flush
      expect(calls).toEqual(['damage-5']);

      EventBus.flush();
      // Now the death event lands
      expect(calls).toEqual(['damage-5', 'death']);
    });
  });
});
