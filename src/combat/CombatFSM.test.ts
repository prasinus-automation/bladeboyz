/**
 * Tests for the CombatFSM — FSM v2 (issue #135).
 *
 * Pure logic tests: no Three.js, no Rapier, no DOM. Mocks `WeaponConfig`
 * directly so the test suite is independent of issue A's per-weapon data.
 *
 * Acceptance test list mirrors the canonical 27 cases in
 * `docs/combat-fsm-v2.md` §10 — those that apply to the FSM core. The
 * tracer/DamageSystem cases are owned by issue E.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CombatFSM, CombatInput, setFsmTraceEnabled, FSM_TRACE_ENABLED } from './CombatFSM';
import { CombatState } from './states';
import { Direction } from './directions';
import { resetFixedTick, advanceFixedTick } from '../core/tickCounter';
import type { WeaponConfig } from '../weapons/WeaponConfig';

// ── Test weapon config ───────────────────────────────────

function createTestWeapon(overrides: Partial<WeaponConfig> = {}): WeaponConfig {
  const defaultTicks = {
    [Direction.Left]: 6,
    [Direction.Right]: 6,
    [Direction.Overhead]: 8,
    [Direction.Stab]: 5,
  };

  return {
    name: 'TestSword',
    damage: {
      [Direction.Left]: { head: 50, torso: 35, limb: 25 },
      [Direction.Right]: { head: 50, torso: 35, limb: 25 },
      [Direction.Overhead]: { head: 55, torso: 40, limb: 25 },
      [Direction.Stab]: { head: 45, torso: 40, limb: 20 },
    },
    windup: { ...defaultTicks },
    release: {
      [Direction.Left]: 4,
      [Direction.Right]: 4,
      [Direction.Overhead]: 5,
      [Direction.Stab]: 3,
    },
    recovery: {
      [Direction.Left]: 12,
      [Direction.Right]: 12,
      [Direction.Overhead]: 15,
      [Direction.Stab]: 10,
    },
    comboRecovery: {
      [Direction.Left]: 8,
      [Direction.Right]: 8,
      [Direction.Overhead]: 10,
      [Direction.Stab]: 6,
    },
    parryWindow: 6,
    parryRecovery: 10,
    blockBreakStunTicks: 28,
    staminaCost: { attack: 15, block: 10, parry: 5 },
    turncap: { windup: 0.08, release: 0.03, recovery: 0.05, hitStun: 0.005 },
    tracerPoints: [[0, 0.5, 0]],
    range: 1.4,
    blockStaminaDrain: 10,
    parryStunTicks: 40,
    hitStunTicks: 30,
    ...overrides,
  };
}

// ── Helper: advance FSM by N ticks ───────────────────────

function tickN(fsm: CombatFSM, n: number): void {
  for (let i = 0; i < n; i++) {
    fsm.tick();
  }
}

// ── Tests ────────────────────────────────────────────────

describe('CombatFSM (v2)', () => {
  let weapon: WeaponConfig;
  let fsm: CombatFSM;

  beforeEach(() => {
    // Silence dev-mode FSM trace logs by default — they're noisy in CI
    // output and irrelevant to most pre-#174 tests. The dev-mode logging
    // suite below explicitly opts back in via setFsmTraceEnabled(true).
    setFsmTraceEnabled(false);
    weapon = createTestWeapon();
    fsm = new CombatFSM(weapon);
  });

  afterEach(() => {
    // Restore the documented default for any test that re-imports this
    // module's binding (vitest runs files in isolation, but be explicit).
    setFsmTraceEnabled(true);
  });

  // ── Initial state ──────────────────────────────────

  describe('initial state', () => {
    it('starts in Idle with phaseElapsed/phaseTotal both 0', () => {
      expect(fsm.state).toBe(CombatState.Idle);
      expect(fsm.phaseElapsed).toBe(0);
      expect(fsm.phaseTotal).toBe(0);
      expect(fsm.ticksRemaining).toBe(0);
    });

    it('has Infinity turncap in Idle', () => {
      expect(fsm.getCurrentTurncap()).toBe(Infinity);
    });

    it('parryActive is false initially', () => {
      expect(fsm.parryActive).toBe(false);
    });

    it('isComboRecovery is false initially', () => {
      expect(fsm.isComboRecovery).toBe(false);
    });
  });

  // ── Attack chain: Idle → Windup → Release → Recovery → Idle ──

  describe('attack chain', () => {
    it('Idle → Windup on Attack(dir) when stamina sufficient', () => {
      const result = fsm.transition(CombatInput.Attack, Direction.Left);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Windup);
      expect(fsm.attackDirection).toBe(Direction.Left);
      expect(fsm.phaseTotal).toBe(weapon.windup[Direction.Left]);
      expect(fsm.phaseElapsed).toBe(0);
    });

    it('Windup auto-transitions to Release after windup[dir] ticks', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      const windupTicks = weapon.windup[Direction.Left];
      tickN(fsm, windupTicks);

      expect(fsm.state).toBe(CombatState.Release);
      expect(fsm.phaseTotal).toBe(weapon.release[Direction.Left]);
      expect(fsm.phaseElapsed).toBe(0);
    });

    it('Release auto-transitions to Recovery after release[dir] ticks', () => {
      fsm.transition(CombatInput.Attack, Direction.Stab);
      const windup = weapon.windup[Direction.Stab];
      const release = weapon.release[Direction.Stab];
      const recovery = weapon.recovery[Direction.Stab];

      tickN(fsm, windup); // → Release
      expect(fsm.state).toBe(CombatState.Release);

      tickN(fsm, release); // → Recovery
      expect(fsm.state).toBe(CombatState.Recovery);
      expect(fsm.phaseTotal).toBe(recovery);

      tickN(fsm, recovery); // → Idle
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('uses correct ticks per attack direction', () => {
      fsm.transition(CombatInput.Attack, Direction.Overhead);
      expect(fsm.phaseTotal).toBe(weapon.windup[Direction.Overhead]);
    });

    it('emits attack stamina event on Windup entry', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('attack');
    });

    it('attack charges stamina even if the swing whiffs (no hit landed)', () => {
      // Acceptance test #18: Windup entry charges `staminaCost.attack`
      // unconditionally — no hit dispatch is required to debit the cost.
      fsm.transition(CombatInput.Attack, Direction.Left);
      expect(fsm.drainStaminaEvents()).toHaveLength(1);
      // Drive the entire chain without any hit input — no further events.
      tickN(fsm, weapon.windup[Direction.Left]);
      tickN(fsm, weapon.release[Direction.Left]);
      tickN(fsm, weapon.recovery[Direction.Left]);
      expect(fsm.drainStaminaEvents()).toHaveLength(0);
    });
  });

  // ── Morph (direction change during Windup) ─────────

  describe('Windup morph', () => {
    it('Attack(newDir) during Windup restarts windup timer with new direction', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, 2);
      // Drain the initial attack event so we can check morph emits none.
      fsm.drainStaminaEvents();

      const result = fsm.transition(CombatInput.Attack, Direction.Overhead);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Windup);
      expect(fsm.attackDirection).toBe(Direction.Overhead);
      expect(fsm.phaseTotal).toBe(weapon.windup[Direction.Overhead]);
      expect(fsm.phaseElapsed).toBe(0);
    });

    it('morph does NOT charge extra stamina', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      fsm.drainStaminaEvents(); // clear initial attack event

      fsm.transition(CombatInput.Attack, Direction.Overhead);
      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(0);
    });

    it('morph to same direction is a no-op (returns false)', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, 2);
      const elapsedBefore = fsm.phaseElapsed;

      const result = fsm.transition(CombatInput.Attack, Direction.Left);
      expect(result).toBe(false);
      expect(fsm.phaseElapsed).toBe(elapsedBefore);
    });
  });

  // ── Combo buffering ────────────────────────────────

  describe('combo buffering', () => {
    it('Attack during Recovery sets isComboRecovery and chains to Windup on phase end', () => {
      // Acceptance test #6: Recovery uses `comboRecovery[dir]` when LMB
      // pressed during recovery.
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, weapon.windup[Direction.Left]); // → Release
      tickN(fsm, weapon.release[Direction.Left]); // → Recovery
      expect(fsm.state).toBe(CombatState.Recovery);
      expect(fsm.isComboRecovery).toBe(false); // first recovery is normal

      // Buffer a combo Attack — the *next* recovery will be a comboRecovery.
      const result = fsm.transition(CombatInput.Attack, Direction.Right);
      expect(result).toBe(true);
      expect(fsm.isComboRecovery).toBe(true);

      // Complete recovery → should chain into Windup (no Idle transition).
      tickN(fsm, weapon.recovery[Direction.Left]);
      expect(fsm.state).toBe(CombatState.Windup);
      expect(fsm.attackDirection).toBe(Direction.Right);
    });

    it('combo Recovery uses comboRecovery[dir] timing, not full recovery', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, weapon.windup[Direction.Left]);
      tickN(fsm, weapon.release[Direction.Left]);
      // Buffer the combo
      fsm.transition(CombatInput.Attack, Direction.Right);
      // Complete first Recovery → second Windup (combo-flagged)
      tickN(fsm, weapon.recovery[Direction.Left]);
      tickN(fsm, weapon.windup[Direction.Right]);
      tickN(fsm, weapon.release[Direction.Right]);

      expect(fsm.state).toBe(CombatState.Recovery);
      expect(fsm.phaseTotal).toBe(weapon.comboRecovery[Direction.Right]);
    });

    it('combo Windup emits a fresh attack stamina event', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, weapon.windup[Direction.Left]);
      tickN(fsm, weapon.release[Direction.Left]);
      fsm.drainStaminaEvents(); // clear initial attack event

      fsm.transition(CombatInput.Attack, Direction.Right);
      tickN(fsm, weapon.recovery[Direction.Left]); // → Windup (combo)

      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('attack');
    });

    it('isComboRecovery resets to false on Idle entry', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, weapon.windup[Direction.Left]);
      tickN(fsm, weapon.release[Direction.Left]);
      fsm.transition(CombatInput.Attack, Direction.Right);
      // Drive the combo all the way through to Idle.
      tickN(fsm, weapon.recovery[Direction.Left]); // → Windup #2
      tickN(fsm, weapon.windup[Direction.Right]); // → Release #2
      tickN(fsm, weapon.release[Direction.Right]); // → Recovery #2
      tickN(fsm, weapon.comboRecovery[Direction.Right]); // → Idle

      expect(fsm.state).toBe(CombatState.Idle);
      expect(fsm.isComboRecovery).toBe(false);
    });

    it('Recovery → Idle on phase end when no combo buffered', () => {
      fsm.transition(CombatInput.Attack, Direction.Stab);
      tickN(fsm, weapon.windup[Direction.Stab]);
      tickN(fsm, weapon.release[Direction.Stab]);
      tickN(fsm, weapon.recovery[Direction.Stab]);
      expect(fsm.state).toBe(CombatState.Idle);
    });
  });

  // ── Block + Parry ──────────────────────────────────

  describe('block and parry', () => {
    it('Idle → Blocking on Block(dir) and blockingEntryWasJustPress is true', () => {
      const result = fsm.transition(CombatInput.Block, Direction.Left);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Blocking);
      expect(fsm.blockDirection).toBe(Direction.Left);
      expect(fsm.blockingEntryWasJustPress).toBe(true);
      expect(fsm.phaseElapsed).toBe(0);
      // Blocking has no fixed duration — phaseTotal is 0.
      expect(fsm.phaseTotal).toBe(0);
    });

    it('parryActive is true while in Blocking AND elapsed ≤ parryWindow', () => {
      fsm.transition(CombatInput.Block, Direction.Overhead);
      expect(fsm.parryActive).toBe(true);
      // Tick within the window — still active.
      tickN(fsm, weapon.parryWindow);
      expect(fsm.parryActive).toBe(true);
      // One more tick and we're past the window.
      tickN(fsm, 1);
      expect(fsm.parryActive).toBe(false);
    });

    it('Blocking → Idle on ReleaseBlock', () => {
      fsm.transition(CombatInput.Block, Direction.Overhead);
      const result = fsm.transition(CombatInput.ReleaseBlock);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('Blocking + BlockedHit stays in Blocking and drains block stamina', () => {
      fsm.transition(CombatInput.Block, Direction.Overhead);
      fsm.drainStaminaEvents();

      const result = fsm.transition(CombatInput.BlockedHit);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Blocking);
      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('block');
    });

    it('Blocking + ParryTriggered transitions to Parry and drains parry stamina', () => {
      fsm.transition(CombatInput.Block, Direction.Overhead);
      fsm.drainStaminaEvents();

      const result = fsm.transition(CombatInput.ParryTriggered);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Parry);
      expect(fsm.phaseTotal).toBe(weapon.parryRecovery);
      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('parry');
    });

    it('Parry phase end → Blocking when RMB still held (the common case)', () => {
      fsm.transition(CombatInput.Block, Direction.Overhead);
      fsm.transition(CombatInput.ParryTriggered);
      expect(fsm.state).toBe(CombatState.Parry);

      tickN(fsm, weapon.parryRecovery);
      expect(fsm.state).toBe(CombatState.Blocking);
      // Re-entry from Parry MUST NOT reopen the parry window — that would
      // let a defender cheese parry forever.
      expect(fsm.blockingEntryWasJustPress).toBe(false);
      expect(fsm.parryActive).toBe(false);
    });

    it('Parry phase end → Idle when RMB was released during Parry', () => {
      fsm.transition(CombatInput.Block, Direction.Overhead);
      fsm.transition(CombatInput.ParryTriggered);
      const released = fsm.transition(CombatInput.ReleaseBlock);
      expect(released).toBe(true);
      // FSM stays in Parry — release-during-Parry only stages the post-end route.
      expect(fsm.state).toBe(CombatState.Parry);

      tickN(fsm, weapon.parryRecovery);
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('Block + BlockBreak transitions to HitStun for blockBreakStunTicks', () => {
      fsm.transition(CombatInput.Block, Direction.Overhead);
      const result = fsm.transition(CombatInput.BlockBreak);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.HitStun);
      expect(fsm.phaseTotal).toBe(weapon.blockBreakStunTicks);
    });

    it('cannot Block from non-Idle/Recovery states', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      const result = fsm.transition(CombatInput.Block, Direction.Overhead);
      expect(result).toBe(false);
      expect(fsm.state).toBe(CombatState.Windup);
    });

    it('Block from Recovery transitions to Blocking (with fresh parry window)', () => {
      fsm.transition(CombatInput.Attack, Direction.Stab);
      tickN(fsm, weapon.windup[Direction.Stab]);
      tickN(fsm, weapon.release[Direction.Stab]);
      expect(fsm.state).toBe(CombatState.Recovery);

      const result = fsm.transition(CombatInput.Block, Direction.Right);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Blocking);
      expect(fsm.blockDirection).toBe(Direction.Right);
      expect(fsm.blockingEntryWasJustPress).toBe(true);
    });
  });

  // ── HitStun ────────────────────────────────────────

  describe('HitStun', () => {
    it('HitReceived from Idle transitions to HitStun for hitStunTicks', () => {
      const result = fsm.transition(CombatInput.HitReceived);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.HitStun);
      expect(fsm.phaseTotal).toBe(weapon.hitStunTicks);
    });

    it('HitStun phase end → Recovery → Idle', () => {
      fsm.transition(CombatInput.HitReceived);
      tickN(fsm, weapon.hitStunTicks); // → Recovery
      expect(fsm.state).toBe(CombatState.Recovery);

      tickN(fsm, weapon.recovery[fsm.attackDirection]); // → Idle
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('HitReceived during Windup interrupts to HitStun', () => {
      fsm.transition(CombatInput.Attack, Direction.Overhead);
      tickN(fsm, 2);
      fsm.transition(CombatInput.HitReceived);
      expect(fsm.state).toBe(CombatState.HitStun);
    });

    it('HitReceived during Recovery clears combo buffer', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, weapon.windup[Direction.Left]);
      tickN(fsm, weapon.release[Direction.Left]);
      fsm.transition(CombatInput.Attack, Direction.Right); // buffered
      expect(fsm.isComboRecovery).toBe(true);

      fsm.transition(CombatInput.HitReceived);
      expect(fsm.state).toBe(CombatState.HitStun);
      expect(fsm.isComboRecovery).toBe(false);

      // After HitStun → Recovery → Idle, no chained Windup.
      tickN(fsm, weapon.hitStunTicks);
      expect(fsm.state).toBe(CombatState.Recovery);
      tickN(fsm, weapon.recovery[fsm.attackDirection]);
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('cannot receive a fresh HitReceived while already in HitStun', () => {
      fsm.transition(CombatInput.HitReceived);
      const result = fsm.transition(CombatInput.HitReceived);
      expect(result).toBe(false);
    });
  });

  // ── WasParried (attacker takes parry penalty) ─────

  describe('WasParried', () => {
    it('Release + WasParried → HitStun for parryStunTicks', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, weapon.windup[Direction.Left]); // → Release

      const result = fsm.transition(CombatInput.WasParried);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.HitStun);
      expect(fsm.phaseTotal).toBe(weapon.parryStunTicks);
    });

    it('HitStun(parried) → Recovery → Idle', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, weapon.windup[Direction.Left]);
      fsm.transition(CombatInput.WasParried);

      tickN(fsm, weapon.parryStunTicks); // → Recovery
      expect(fsm.state).toBe(CombatState.Recovery);
    });

    it('WasParried is rejected from non-Release states', () => {
      // From Idle
      expect(fsm.transition(CombatInput.WasParried)).toBe(false);
      // From Windup
      fsm.transition(CombatInput.Attack, Direction.Left);
      expect(fsm.transition(CombatInput.WasParried)).toBe(false);
      expect(fsm.state).toBe(CombatState.Windup);
    });
  });

  // ── BlockedHit (attacker bounces off block) ───────

  describe('BlockedHit on attacker', () => {
    it('Release + BlockedHit forces attacker into Recovery (no extra stamina)', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, weapon.windup[Direction.Left]); // → Release
      fsm.drainStaminaEvents();

      const result = fsm.transition(CombatInput.BlockedHit);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Recovery);
      expect(fsm.phaseTotal).toBe(weapon.recovery[Direction.Left]);
      // Attacker did not pay block stamina (defender does).
      expect(fsm.drainStaminaEvents()).toHaveLength(0);
    });
  });

  // ── Turncap ────────────────────────────────────────

  describe('turncap', () => {
    it('returns weapon.turncap.windup during Windup', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      expect(fsm.getCurrentTurncap()).toBe(weapon.turncap.windup);
    });

    it('returns weapon.turncap.release during Release', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, weapon.windup[Direction.Left]);
      expect(fsm.getCurrentTurncap()).toBe(weapon.turncap.release);
    });

    it('returns weapon.turncap.recovery during Recovery', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, weapon.windup[Direction.Left]);
      tickN(fsm, weapon.release[Direction.Left]);
      expect(fsm.getCurrentTurncap()).toBe(weapon.turncap.recovery);
    });

    it('returns weapon.turncap.hitStun during HitStun (regression test)', () => {
      // Acceptance test #27 — the new HitStun cap from issue A.
      fsm.transition(CombatInput.HitReceived);
      expect(fsm.getCurrentTurncap()).toBe(weapon.turncap.hitStun);
    });

    it('returns Infinity during Blocking', () => {
      fsm.transition(CombatInput.Block, Direction.Overhead);
      expect(fsm.getCurrentTurncap()).toBe(Infinity);
    });

    it('returns Infinity during Parry (defender is rewarded)', () => {
      fsm.transition(CombatInput.Block, Direction.Overhead);
      fsm.transition(CombatInput.ParryTriggered);
      expect(fsm.getCurrentTurncap()).toBe(Infinity);
    });
  });

  // ── canTransition ──────────────────────────────────

  describe('canTransition', () => {
    it('allows Attack from Idle', () => {
      expect(fsm.canTransition(CombatInput.Attack)).toBe(true);
    });

    it('allows Block from Idle', () => {
      expect(fsm.canTransition(CombatInput.Block)).toBe(true);
    });

    it('disallows Block from Windup', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      expect(fsm.canTransition(CombatInput.Block)).toBe(false);
    });

    it('allows Attack (combo) from Recovery', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, weapon.windup[Direction.Left]);
      tickN(fsm, weapon.release[Direction.Left]);
      expect(fsm.canTransition(CombatInput.Attack)).toBe(true);
    });

    it('allows ParryTriggered from Blocking only', () => {
      expect(fsm.canTransition(CombatInput.ParryTriggered)).toBe(false);
      fsm.transition(CombatInput.Block, Direction.Overhead);
      expect(fsm.canTransition(CombatInput.ParryTriggered)).toBe(true);
    });

    it('allows BlockBreak from Blocking only', () => {
      expect(fsm.canTransition(CombatInput.BlockBreak)).toBe(false);
      fsm.transition(CombatInput.Block, Direction.Overhead);
      expect(fsm.canTransition(CombatInput.BlockBreak)).toBe(true);
    });
  });

  // ── Phase tracking ─────────────────────────────────

  describe('phaseElapsed / phaseTotal', () => {
    it('increments phaseElapsed by 1 each tick during Windup', () => {
      // Acceptance test #24: phaseElapsed increments every tick during
      // animatable states.
      fsm.transition(CombatInput.Attack, Direction.Overhead);
      expect(fsm.phaseElapsed).toBe(0);
      fsm.tick();
      expect(fsm.phaseElapsed).toBe(1);
      fsm.tick();
      expect(fsm.phaseElapsed).toBe(2);
    });

    it('phaseTotal is 0 in Idle and Blocking', () => {
      expect(fsm.phaseTotal).toBe(0);
      fsm.transition(CombatInput.Block, Direction.Overhead);
      expect(fsm.phaseTotal).toBe(0);
    });

    it('getPhaseT is 0 → 1 monotonically during a fixed-duration phase', () => {
      fsm.transition(CombatInput.Attack, Direction.Overhead);
      const total = weapon.windup[Direction.Overhead];
      expect(fsm.getPhaseT()).toBe(0);
      const half = Math.floor(total / 2);
      tickN(fsm, half);
      expect(fsm.getPhaseT()).toBeCloseTo(half / total, 5);
    });

    it('getPhaseT is 0 in Idle and Blocking (no fixed duration)', () => {
      expect(fsm.getPhaseT()).toBe(0);
      fsm.transition(CombatInput.Block, Direction.Overhead);
      tickN(fsm, 3);
      expect(fsm.getPhaseT()).toBe(0);
    });

    it('ticksRemaining is the v1-compat shim (phaseTotal − phaseElapsed)', () => {
      fsm.transition(CombatInput.Attack, Direction.Stab);
      const total = weapon.windup[Direction.Stab];
      expect(fsm.ticksRemaining).toBe(total);
      tickN(fsm, 2);
      expect(fsm.ticksRemaining).toBe(total - 2);
    });
  });

  // ── direction getter (forward-compat with issue D) ─

  describe('direction getter', () => {
    it('returns attack direction in attack states', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      expect(fsm.direction).toBe(Direction.Left);
    });

    it('returns block direction in defensive states', () => {
      fsm.transition(CombatInput.Block, Direction.Right);
      expect(fsm.direction).toBe(Direction.Right);
      fsm.transition(CombatInput.ParryTriggered);
      expect(fsm.direction).toBe(Direction.Right);
    });
  });

  // ── Reset ──────────────────────────────────────────

  describe('reset', () => {
    it('returns to Idle and clears all transient state', () => {
      fsm.transition(CombatInput.Attack, Direction.Left);
      tickN(fsm, 2);
      fsm.reset();

      expect(fsm.state).toBe(CombatState.Idle);
      expect(fsm.phaseElapsed).toBe(0);
      expect(fsm.phaseTotal).toBe(0);
      expect(fsm.isComboRecovery).toBe(false);
      expect(fsm.blockingEntryWasJustPress).toBe(false);
      expect(fsm.drainStaminaEvents()).toHaveLength(0);
    });
  });

  // ── Weapon config swap ─────────────────────────────

  describe('weapon config', () => {
    it('can swap weapon config without changing state', () => {
      const newWeapon = createTestWeapon({ name: 'TestAxe' });
      fsm.setWeaponConfig(newWeapon);
      expect(fsm.weaponConfig.name).toBe('TestAxe');
      expect(fsm.state).toBe(CombatState.Idle);
    });
  });

  // ── setBlockDirection ──────────────────────────────

  describe('setBlockDirection', () => {
    it('updates blockDirection without changing state', () => {
      fsm.setBlockDirection(Direction.Right);
      expect(fsm.blockDirection).toBe(Direction.Right);
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('preserves phaseElapsed when called mid-block', () => {
      fsm.transition(CombatInput.Block, Direction.Overhead);
      tickN(fsm, 2);
      const elapsedBefore = fsm.phaseElapsed;
      fsm.setBlockDirection(Direction.Left);
      expect(fsm.blockDirection).toBe(Direction.Left);
      expect(fsm.phaseElapsed).toBe(elapsedBefore);
    });
  });

  // ── Invariant: only _transitionTo writes _state ───

  // Acceptance test #26 from `docs/combat-fsm-v2.md` §10: no source line in
  // `CombatFSM.ts` assigns `this._state =` outside the central
  // `_transitionTo` helper. Static-analysis test; loads the file source
  // via Vite's `?raw` query loader so we don't need `@types/node`.
  describe('invariant: _state is only written through _transitionTo', () => {
    it('CombatFSM.ts has no `this._state =` assignments outside _transitionTo', async () => {
      // `?raw` is a Vite/vitest build-time loader that returns the file
      // contents as a string. The dynamic-import path string is opaque to
      // tsc, which is fine — vitest resolves it at test time.
      const mod = (await import(/* @vite-ignore */ './CombatFSM.ts?raw')) as {
        default: string;
      };
      const source: string = mod.default;
      const lines = source.split('\n');
      const offenders: { line: number; text: string }[] = [];
      let inTransitionTo = false;
      let braceDepth = 0;
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        if (/private _transitionTo\s*\(/.test(text)) {
          inTransitionTo = true;
          braceDepth = (text.match(/\{/g)?.length ?? 0) - (text.match(/\}/g)?.length ?? 0);
          continue;
        }
        if (inTransitionTo) {
          braceDepth += (text.match(/\{/g)?.length ?? 0) - (text.match(/\}/g)?.length ?? 0);
          if (braceDepth <= 0) inTransitionTo = false;
          continue;
        }
        // Match assignment `this._state =` but NOT comparison
        // `this._state ===` / `this._state ==`. Skip block-comment lines
        // (`*` indent). No real production line outside `_transitionTo`
        // should hit this.
        if (/this\._state\s*=(?!=)/.test(text) && !/^\s*\*/.test(text)) {
          offenders.push({ line: i + 1, text: text.trim() });
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  // ── Dev-mode transition logging (#174) ──────────────────

  // Acceptance criteria:
  //   - npm run dev shows `[FSM] N Idle → Windup (input: Attack, dir: Left, tick: T)`
  //     on every swing transition.
  //   - npm run build produces output with zero references to the [FSM] log
  //     string (tree-shaken in prod). Verified via static analysis below.
  describe('dev-mode transition logging (#174)', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // vitest runs with `import.meta.env.DEV === true` by default. We assert
      // the precondition explicitly so this suite fails loudly if some future
      // vitest config flips DEV off.
      expect(import.meta.env.DEV).toBe(true);
      // Make sure prior tests didn't leave the toggle off.
      setFsmTraceEnabled(true);
      resetFixedTick();
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
      // Restore default for the rest of the suite.
      setFsmTraceEnabled(true);
    });

    it('emits a [FSM] log line on Idle → Windup', () => {
      // Use createFSM so the eid (123) is threaded through.
      const eid = 123;
      const f = new CombatFSM(weapon, eid);
      f.transition(CombatInput.Attack, Direction.Left);

      // Find the [FSM] entry. console.log may be called by other code,
      // so search the call list.
      const fsmCalls = logSpy.mock.calls.filter((args) => args[0] === '[FSM]');
      expect(fsmCalls.length).toBeGreaterThanOrEqual(1);
      // First Idle → Windup transition for this entity.
      const firstCall = fsmCalls[0];
      expect(firstCall).toContain(eid);
      expect(firstCall).toContain('Idle');
      expect(firstCall).toContain('→');
      expect(firstCall).toContain('Windup');
      expect(firstCall).toContain('Attack');
      expect(firstCall).toContain('Left');
      // Tick value comes from getCurrentFixedTick(); we reset it so it is 0.
      expect(firstCall).toContain(0);
    });

    it('logs `auto` for phase-end auto-transitions (Windup → Release)', () => {
      const f = new CombatFSM(weapon, 7);
      f.transition(CombatInput.Attack, Direction.Left);
      logSpy.mockClear();

      // Tick out the Windup phase so it auto-transitions to Release.
      tickN(f, weapon.windup[Direction.Left]);

      const fsmCalls = logSpy.mock.calls.filter((args) => args[0] === '[FSM]');
      expect(fsmCalls.length).toBeGreaterThanOrEqual(1);
      const lastCall = fsmCalls[fsmCalls.length - 1];
      expect(lastCall).toContain('Windup');
      expect(lastCall).toContain('Release');
      // No external input → label is 'auto', NOT a CombatInput name.
      expect(lastCall).toContain('auto');
    });

    it('includes the current fixed tick from the shared counter', () => {
      const f = new CombatFSM(weapon, 1);
      // Advance the tick counter so it is non-zero — simulates a real game
      // session where some ticks have already elapsed before this swing.
      advanceFixedTick();
      advanceFixedTick();
      advanceFixedTick();
      f.transition(CombatInput.Attack, Direction.Left);

      const fsmCalls = logSpy.mock.calls.filter((args) => args[0] === '[FSM]');
      expect(fsmCalls.length).toBeGreaterThanOrEqual(1);
      // Tick value should appear in the call args (3 after three advances).
      expect(fsmCalls[0]).toContain(3);
    });

    it('FSM_TRACE_ENABLED toggle silences logs', () => {
      setFsmTraceEnabled(false);
      const f = new CombatFSM(weapon, 1);
      f.transition(CombatInput.Attack, Direction.Left);
      const fsmCalls = logSpy.mock.calls.filter((args) => args[0] === '[FSM]');
      expect(fsmCalls.length).toBe(0);
    });

    it('uses the eid threaded through createFSM(eid, …)', () => {
      // Construct without the eid arg → defaults to 0.
      const f0 = new CombatFSM(weapon);
      f0.transition(CombatInput.Attack, Direction.Left);
      const calls0 = logSpy.mock.calls.filter((args) => args[0] === '[FSM]');
      expect(calls0[0]).toContain(0); // eid default
      logSpy.mockClear();

      const f99 = new CombatFSM(weapon, 99);
      f99.transition(CombatInput.Attack, Direction.Left);
      const calls99 = logSpy.mock.calls.filter((args) => args[0] === '[FSM]');
      expect(calls99[0]).toContain(99);
    });

    it('source: every [FSM] reference sits inside an `import.meta.env.DEV` guard', async () => {
      // Tree-shake contract — Vite drops `import.meta.env.DEV`-guarded blocks
      // when DEV === false, so as long as every `[FSM]` literal lives inside
      // such a guard, the prod bundle will not contain the string. This is a
      // cheaper and more reliable check than running `npm run build` here.
      const mod = (await import(/* @vite-ignore */ './CombatFSM.ts?raw')) as {
        default: string;
      };
      const source: string = mod.default;
      const lines = source.split('\n');

      // Track guard depth: increments on `if (import.meta.env.DEV …)`/ifs that
      // open in the same line, decrements when the matching close-brace is seen.
      // Simple brace counting is enough for the small number of guarded blocks
      // we have today.
      type Block = { startLine: number; endBraceDepth: number };
      const openGuards: Block[] = [];
      let braceDepth = 0;
      const offenders: { line: number; text: string }[] = [];

      for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        const opens = (text.match(/\{/g)?.length ?? 0);
        const closes = (text.match(/\}/g)?.length ?? 0);

        // Detect a new guard opening on this line. The pattern accepts both
        //   `if (import.meta.env.DEV)`
        // and the longer
        //   `if (import.meta.env.DEV && FSM_TRACE_ENABLED)`.
        if (/if\s*\(\s*import\.meta\.env\.DEV/.test(text)) {
          // The brace immediately following the condition opens the guard
          // body. We anchor the guard's lifetime to the brace depth AFTER
          // this line: the guard closes when depth returns to that value.
          openGuards.push({ startLine: i + 1, endBraceDepth: braceDepth });
        }
        braceDepth += opens - closes;
        // Pop any guards whose body has closed.
        while (openGuards.length > 0 && braceDepth <= openGuards[openGuards.length - 1].endBraceDepth) {
          openGuards.pop();
        }

        // Skip block-comment continuation lines (`*` indented) and any line
        // that DECLARES the dev guard itself or its tree-shake docs.
        if (/^\s*\*/.test(text)) continue;
        if (!text.includes('[FSM]')) continue;
        if (openGuards.length === 0) {
          offenders.push({ line: i + 1, text: text.trim() });
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  // ── phaseTotal=0 watchdog (#174) ────────────────────────

  describe('phaseTotal=0 watchdog (#174)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      setFsmTraceEnabled(true);
      // Silence transition logs — the watchdog tests assert on warn output.
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      setFsmTraceEnabled(true);
    });

    it('falls back to phaseTotal=1 when weapon.windup[dir] is 0', () => {
      const broken = createTestWeapon({
        windup: { ...weapon.windup, [Direction.Overhead]: 0 },
      });
      const f = new CombatFSM(broken, 1);
      f.transition(CombatInput.Attack, Direction.Overhead);
      // phaseTotal must NOT be 0 — that would freeze the FSM.
      expect(f.phaseTotal).toBe(1);
      expect(f.state).toBe(CombatState.Windup);
    });

    it('emits a console.warn naming the weapon and direction', () => {
      const broken = createTestWeapon({
        name: 'BrokenSword',
        windup: { ...weapon.windup, [Direction.Overhead]: 0 },
      });
      const f = new CombatFSM(broken, 1);
      f.transition(CombatInput.Attack, Direction.Overhead);
      const warnings = warnSpy.mock.calls.filter((args) => args[0] === '[FSM] phaseTotal=0 in');
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('Windup');
      expect(warnings[0]).toContain('BrokenSword');
      expect(warnings[0]).toContain('Overhead');
    });

    it('FSM auto-progresses (does NOT freeze) past the broken phase', () => {
      const broken = createTestWeapon({
        windup: { ...weapon.windup, [Direction.Left]: 0 },
      });
      const f = new CombatFSM(broken, 1);
      f.transition(CombatInput.Attack, Direction.Left);
      // After the watchdog: phaseTotal=1, so one tick advances out of Windup.
      f.tick();
      expect(f.state).toBe(CombatState.Release);
    });

    it('also fires for release[dir]=0 and recovery[dir]=0', () => {
      const broken = createTestWeapon({
        release: { ...weapon.release, [Direction.Right]: 0 },
        recovery: { ...weapon.recovery, [Direction.Right]: 0 },
      });
      const f = new CombatFSM(broken, 1);
      f.transition(CombatInput.Attack, Direction.Right);
      // Tick out Windup → enter Release (phaseTotal would be 0 → bumped to 1).
      tickN(f, weapon.windup[Direction.Right]);
      expect(f.state).toBe(CombatState.Release);
      expect(f.phaseTotal).toBe(1);
      // Tick out Release → enter Recovery (also bumped to 1).
      f.tick();
      expect(f.state).toBe(CombatState.Recovery);
      expect(f.phaseTotal).toBe(1);
      // Each broken phase entry produced one warning.
      const warnings = warnSpy.mock.calls.filter((args) => args[0] === '[FSM] phaseTotal=0 in');
      expect(warnings.length).toBe(2);
    });

    it('does NOT warn when weapon timings are healthy', () => {
      const f = new CombatFSM(weapon, 1);
      f.transition(CombatInput.Attack, Direction.Left);
      tickN(f, weapon.windup[Direction.Left]);
      tickN(f, weapon.release[Direction.Left]);
      tickN(f, weapon.recovery[Direction.Left]);
      const warnings = warnSpy.mock.calls.filter((args) => args[0] === '[FSM] phaseTotal=0 in');
      expect(warnings.length).toBe(0);
    });

    it('safety fallback runs even with FSM_TRACE_ENABLED=false (silent fallback)', () => {
      setFsmTraceEnabled(false);
      const broken = createTestWeapon({
        windup: { ...weapon.windup, [Direction.Overhead]: 0 },
      });
      const f = new CombatFSM(broken, 1);
      f.transition(CombatInput.Attack, Direction.Overhead);
      // Fallback still runs (safety is unconditional); warn is suppressed.
      expect(f.phaseTotal).toBe(1);
      const warnings = warnSpy.mock.calls.filter((args) => args[0] === '[FSM] phaseTotal=0 in');
      expect(warnings.length).toBe(0);
    });
  });

  // ── Test-only API surface (#174) ────────────────────────

  describe('FSM_TRACE_ENABLED export (#174)', () => {
    afterEach(() => {
      setFsmTraceEnabled(true);
    });

    it('reads true under vitest (which runs with import.meta.env.DEV=true)', () => {
      // Reset to the documented default before reading — earlier suites'
      // afterEach hooks already do this, but be explicit.
      setFsmTraceEnabled(true);
      expect(FSM_TRACE_ENABLED).toBe(true);
    });

    it('setFsmTraceEnabled(false) flips the runtime flag and silences logs', () => {
      setFsmTraceEnabled(false);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const f = new CombatFSM(weapon, 1);
      f.transition(CombatInput.Attack, Direction.Left);
      const fsmCalls = spy.mock.calls.filter((args) => args[0] === '[FSM]');
      expect(fsmCalls.length).toBe(0);
      spy.mockRestore();
    });
  });
});
