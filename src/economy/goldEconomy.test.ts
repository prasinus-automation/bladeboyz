import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Gold, Player } from '../ecs/components';
import {
  GOLD_PER_KILL,
  awardGold,
  awardGoldOnKill,
  onGoldAwarded,
  resetGoldEconomyListeners,
  type GoldAwardedEvent,
} from './goldEconomy';

function createPlayerEntity(world: any, initialGold = 0): number {
  const eid = addEntity(world);
  addComponent(world, Player, eid);
  addComponent(world, Gold, eid);
  Gold.amount[eid] = initialGold;
  return eid;
}

function createDummyEntity(world: any): number {
  // Dummies have no Player tag and no Gold component
  return addEntity(world);
}

describe('goldEconomy', () => {
  let world: any;

  beforeEach(() => {
    world = createWorld();
    resetGoldEconomyListeners();
  });

  describe('GOLD_PER_KILL', () => {
    it('is 25 (frozen by spec — issue #105 reads this constant)', () => {
      expect(GOLD_PER_KILL).toBe(25);
    });
  });

  describe('awardGold', () => {
    it('increments Gold.amount by the awarded amount', () => {
      const eid = createPlayerEntity(world, 10);
      const newBalance = awardGold(eid, 25, 'kill');
      expect(newBalance).toBe(35);
      expect(Gold.amount[eid]).toBe(35);
    });

    it('returns 0+amount when player started with 0 gold', () => {
      const eid = createPlayerEntity(world, 0);
      expect(awardGold(eid, 25, 'kill')).toBe(25);
      expect(Gold.amount[eid]).toBe(25);
    });

    it('is a no-op for non-positive amounts', () => {
      const eid = createPlayerEntity(world, 50);
      expect(awardGold(eid, 0, 'admin')).toBe(50);
      expect(awardGold(eid, -10, 'admin')).toBe(50);
      expect(Gold.amount[eid]).toBe(50);
    });

    it('fires onGoldAwarded after balance is updated', () => {
      const eid = createPlayerEntity(world, 100);
      const events: GoldAwardedEvent[] = [];
      onGoldAwarded((e) => events.push(e));

      awardGold(eid, 25, 'kill');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        playerEid: eid,
        amount: 25,
        newBalance: 125,
        reason: 'kill',
      });
    });

    it('does not fire onGoldAwarded for no-op awards', () => {
      const eid = createPlayerEntity(world, 50);
      const events: GoldAwardedEvent[] = [];
      onGoldAwarded((e) => events.push(e));

      awardGold(eid, 0, 'admin');
      awardGold(eid, -5, 'admin');

      expect(events).toHaveLength(0);
    });
  });

  describe('awardGoldOnKill', () => {
    it('awards GOLD_PER_KILL when a Player kills a non-player entity', () => {
      const player = createPlayerEntity(world, 0);
      const dummy = createDummyEntity(world);

      const newBalance = awardGoldOnKill(world, dummy, player);

      expect(newBalance).toBe(25);
      expect(Gold.amount[player]).toBe(25);
    });

    it('returns null and does not award gold for self-kill', () => {
      const player = createPlayerEntity(world, 100);

      const result = awardGoldOnKill(world, player, player);

      expect(result).toBeNull();
      expect(Gold.amount[player]).toBe(100); // unchanged
    });

    it('returns null and does not award gold for environmental death (no attacker)', () => {
      const player = createPlayerEntity(world, 100);
      const dummy = createDummyEntity(world);

      const result = awardGoldOnKill(world, dummy, undefined);

      expect(result).toBeNull();
      expect(Gold.amount[player]).toBe(100);
    });

    it('returns null when attacker is not a Player (e.g. dummy kills dummy)', () => {
      const attackerDummy = createDummyEntity(world);
      const victimDummy = createDummyEntity(world);

      const result = awardGoldOnKill(world, victimDummy, attackerDummy);

      expect(result).toBeNull();
    });

    it('returns null when attacker has Player tag but no Gold component (defensive)', () => {
      // Synthesize a "player" with no Gold component — should never happen
      // in production but we want a defensive return rather than a crash.
      const eid = addEntity(world);
      addComponent(world, Player, eid);
      // intentionally no Gold component

      const dummy = createDummyEntity(world);
      const result = awardGoldOnKill(world, dummy, eid);

      expect(result).toBeNull();
    });

    it('fires onGoldAwarded with reason="kill" on a successful kill', () => {
      const player = createPlayerEntity(world, 0);
      const dummy = createDummyEntity(world);
      const events: GoldAwardedEvent[] = [];
      onGoldAwarded((e) => events.push(e));

      awardGoldOnKill(world, dummy, player);

      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe('kill');
      expect(events[0].amount).toBe(GOLD_PER_KILL);
      expect(events[0].newBalance).toBe(25);
    });

    it('does not fire onGoldAwarded when the kill is rejected by a rule', () => {
      const player = createPlayerEntity(world, 0);
      const events: GoldAwardedEvent[] = [];
      onGoldAwarded((e) => events.push(e));

      // self-kill
      awardGoldOnKill(world, player, player);
      // env death
      awardGoldOnKill(world, player, undefined);
      // non-player attacker
      const dummy = createDummyEntity(world);
      awardGoldOnKill(world, player, dummy);

      expect(events).toHaveLength(0);
    });
  });
});
