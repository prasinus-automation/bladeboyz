/**
 * Gold economy — single chokepoint for all gold mutations.
 *
 * All gold writes go through `awardGold` / `spendGold` so that the future
 * server-authoritative path (Phase 2, post #92) can be swapped in by replacing
 * this file. See `docs/gold-currency.md` §1, §2, §7 for the full contract.
 *
 * MVP scope:
 * - Award 25 gold per attribution-confirmed kill.
 * - Skip self-kills, environmental deaths, non-player attackers, posthumous hits.
 * - No streak bonuses, no assists.
 *
 * Persistence (#105) and HUD (#108) are wired on top of this module.
 */

import { hasComponent, type IWorld } from 'bitecs';
import { Gold, Player } from '../ecs/components';

/** Flat gold reward per kill — exported so other modules / tests don't hard-code. */
export const GOLD_PER_KILL = 25;

/** Reasons an `awardGold` call may carry. Loose string — extend as new sources land. */
export type AwardReason = 'kill' | 'admin';

/** Listener payload for `onGoldAwarded`. Fires AFTER the balance is updated. */
export interface GoldAwardedEvent {
  playerEid: number;
  amount: number;
  newBalance: number;
  reason: AwardReason;
}

type GoldAwardedListener = (event: GoldAwardedEvent) => void;

const listeners: GoldAwardedListener[] = [];

/** Subscribe to gold-award events (HUD, persistence layer). */
export function onGoldAwarded(fn: GoldAwardedListener): void {
  listeners.push(fn);
}

/** Unsubscribe (mostly for tests). */
export function offGoldAwarded(fn: GoldAwardedListener): void {
  const idx = listeners.indexOf(fn);
  if (idx >= 0) listeners.splice(idx, 1);
}

/** Reset listeners (test helper). */
export function resetGoldEconomyListeners(): void {
  listeners.length = 0;
}

/**
 * Award gold to a player. Returns the new balance.
 *
 * Caller is responsible for ensuring `playerEid` actually has the `Gold`
 * component and the `Player` tag — `awardGoldOnKill` enforces this for the
 * kill path. Direct callers (e.g. admin commands, tests) should validate
 * upstream.
 *
 * Negative or zero amounts are no-ops (return current balance unchanged) so
 * that future heuristics that compute their own amounts can opt into a clean
 * "no reward" outcome without conditionals at the call site.
 */
export function awardGold(playerEid: number, amount: number, reason: AwardReason): number {
  const current = Gold.amount[playerEid] ?? 0;
  if (amount <= 0) return current;

  const newBalance = current + amount;
  Gold.amount[playerEid] = newBalance;

  // Notify subscribers AFTER balance is updated so listeners (HUD, persistence)
  // see the new amount immediately.
  const event: GoldAwardedEvent = {
    playerEid,
    amount,
    newBalance,
    reason,
  };
  for (let i = 0; i < listeners.length; i++) {
    listeners[i](event);
  }
  return newBalance;
}

/**
 * Award gold for a kill, applying all attribution rules.
 *
 * Returns the attacker's new balance, or `null` if no gold was awarded
 * (rule-violation, not an error).
 *
 * Rules (per `docs/gold-currency.md` §2):
 * 1. Skip if there is no attacker (environmental death) — `attackerEid === undefined`.
 * 2. Skip self-kills (`attackerEid === victimEid`).
 * 3. Skip if attacker is not a `Player` — only player kills earn gold.
 * 4. Skip if attacker doesn't have a `Gold` component (defensive — shouldn't
 *    happen since players are spawned with one, but cheap to check).
 *
 * The "already-dead" guard lives upstream in `HealthSystem.queueDamage` —
 * posthumous damage events are skipped and never produce a `KillEvent`.
 */
export function awardGoldOnKill(
  world: IWorld,
  victimEid: number,
  attackerEid: number | undefined,
): number | null {
  // Rule 1: environmental death — no attacker
  if (attackerEid === undefined) return null;

  // Rule 2: self-kill
  if (attackerEid === victimEid) return null;

  // Rule 3: only Player attackers earn gold
  if (!hasComponent(world, Player, attackerEid)) return null;

  // Rule 4: defensive — attacker must have Gold component
  if (!hasComponent(world, Gold, attackerEid)) return null;

  return awardGold(attackerEid, GOLD_PER_KILL, 'kill');
}
