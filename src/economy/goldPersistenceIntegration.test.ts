/**
 * Integration test for the gold persistence wiring (#105).
 *
 * Covers the slice that crosses module boundaries:
 *  - `awardGold` → `saveGold` (debounced write)
 *  - `getOrCreatePlayerId` → `attachPlayerIdentity` → `loadGold` (read-back)
 *  - Refresh-survives-a-kill: kill awards gold, flush, re-read with the
 *    same player id yields the new balance.
 *
 * The single-module tests in `playerIdentity.test.ts` and
 * `goldPersistence.test.ts` exercise the units in isolation. This file
 * is the integration check that the wiring in `goldEconomy.ts` actually
 * routes awards into the persistence layer for an entity that had
 * `attachPlayerIdentity` called on it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Gold, Player } from '../ecs/components';
import { awardGold, awardGoldOnKill, resetGoldEconomyListeners } from './goldEconomy';
import { resetWallet } from './Wallet';
import {
  attachPlayerIdentity,
  getOrCreatePlayerId,
  clearPlayerIdentityRegistry,
} from './playerIdentity';
import {
  loadGold,
  flushGoldWrites,
  goldStorageKey,
  resetGoldPersistence,
} from './goldPersistence';

function makePlayer(world: any, initialGold = 0): number {
  const eid = addEntity(world);
  addComponent(world, Player, eid);
  addComponent(world, Gold, eid);
  Gold.amount[eid] = initialGold;
  return eid;
}

describe('gold persistence integration', () => {
  let world: any;

  beforeEach(() => {
    localStorage.clear();
    resetGoldEconomyListeners();
    resetWallet();
    clearPlayerIdentityRegistry();
    resetGoldPersistence();
    vi.useFakeTimers();
    world = createWorld();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('awardGold writes to localStorage for an entity with an attached identity', () => {
    const eid = makePlayer(world, 100);
    const playerId = attachPlayerIdentity(eid);

    awardGold(eid, 25, 'kill');
    flushGoldWrites();

    expect(localStorage.getItem(goldStorageKey(playerId))).toBe('125');
    expect(loadGold(playerId)).toBe(125);
  });

  it('awardGold is a no-op on persistence for entities without an identity', () => {
    const eid = makePlayer(world, 0);
    // Do NOT call attachPlayerIdentity — simulate a bot or a test path.
    awardGold(eid, 25, 'kill');
    flushGoldWrites();

    // No localStorage entry should exist for any id.
    expect(localStorage.length).toBe(0);
  });

  it('awardGoldOnKill (full attribution pipeline) persists the new balance', () => {
    const attacker = makePlayer(world, 50);
    const victim = makePlayer(world, 0);
    const playerId = attachPlayerIdentity(attacker);

    const newBalance = awardGoldOnKill(world, victim, attacker);
    flushGoldWrites();

    expect(newBalance).toBe(75); // 50 + GOLD_PER_KILL (25)
    expect(loadGold(playerId)).toBe(75);
  });

  it('coalesces a flurry of kills into a single localStorage write', () => {
    const eid = makePlayer(world, 0);
    attachPlayerIdentity(eid);
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    // 8 kills in quick succession.
    for (let i = 0; i < 8; i++) {
      awardGold(eid, 25, 'kill');
    }
    flushGoldWrites();

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(Gold.amount[eid]).toBe(200);
  });

  it('refresh-survives-a-kill: persisted balance loads on a fresh process', () => {
    // Phase 1: simulate a session that earns gold.
    const eid1 = makePlayer(world, 100);
    const playerId = attachPlayerIdentity(eid1);
    awardGold(eid1, 25, 'kill');
    flushGoldWrites();

    // Phase 2: simulate a page reload. Clear the in-process state but
    // leave localStorage intact.
    clearPlayerIdentityRegistry();
    resetGoldPersistence();

    // A new "session" gets the SAME player id from localStorage.
    const reloadedId = getOrCreatePlayerId();
    expect(reloadedId).toBe(playerId);

    // And `loadGold` returns the new balance.
    expect(loadGold(reloadedId)).toBe(125);
  });

  it('a beforeunload-style flush persists the latest pending award', () => {
    const eid = makePlayer(world, 0);
    attachPlayerIdentity(eid);
    awardGold(eid, 25, 'kill');
    // Don't run timers — simulate a tab close that arrives mid-debounce.
    flushGoldWrites();
    expect(Gold.amount[eid]).toBe(25);
  });

  it('does not crash when localStorage.setItem throws on every award', () => {
    const eid = makePlayer(world, 0);
    // attachPlayerIdentity itself writes to localStorage (the bb_player_id
    // key). Set it up first under a working setItem, then break setItem
    // for the persistence layer's writes. Otherwise the identity write
    // would consume the single-warning gate before the persistence write
    // gets a chance to warn.
    attachPlayerIdentity(eid);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 10 awards in a row — must not throw and warns at most once.
    for (let i = 0; i < 10; i++) {
      awardGold(eid, 25, 'kill');
    }
    flushGoldWrites();

    expect(Gold.amount[eid]).toBe(250); // in-memory balance unaffected
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
