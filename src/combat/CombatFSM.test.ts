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

import { describe, it, expect, beforeEach } from 'vitest';
import { CombatFSM, CombatInput } from './CombatFSM';
import { CombatState } from './states';
import { AttackDirection, BlockDirection } from './directions';
import type { WeaponConfig } from '../weapons/WeaponConfig';

// ── Test weapon config ───────────────────────────────────

function createTestWeapon(overrides: Partial<WeaponConfig> = {}): WeaponConfig {
  const defaultTicks = {
    [AttackDirection.Left]: 6,
    [AttackDirection.Right]: 6,
    [AttackDirection.Overhead]: 8,
    [AttackDirection.Stab]: 5,
  };

  return {
    name: 'TestSword',
    damage: {
      [AttackDirection.Left]: { head: 50, torso: 35, limb: 25 },
      [AttackDirection.Right]: { head: 50, torso: 35, limb: 25 },
      [AttackDirection.Overhead]: { head: 55, torso: 40, limb: 25 },
      [AttackDirection.Stab]: { head: 45, torso: 40, limb: 20 },
    },
    windup: { ...defaultTicks },
    release: {
      [AttackDirection.Left]: 4,
      [AttackDirection.Right]: 4,
      [AttackDirection.Overhead]: 5,
      [AttackDirection.Stab]: 3,
    },
    recovery: {
      [AttackDirection.Left]: 12,
      [AttackDirection.Right]: 12,
      [AttackDirection.Overhead]: 15,
      [AttackDirection.Stab]: 10,
    },
    comboRecovery: {
      [AttackDirection.Left]: 8,
      [AttackDirection.Right]: 8,
      [AttackDirection.Overhead]: 10,
      [AttackDirection.Stab]: 6,
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
    weapon = createTestWeapon();
    fsm = new CombatFSM(weapon);
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
      const result = fsm.transition(CombatInput.Attack, AttackDirection.Left);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Windup);
      expect(fsm.attackDirection).toBe(AttackDirection.Left);
      expect(fsm.phaseTotal).toBe(weapon.windup[AttackDirection.Left]);
      expect(fsm.phaseElapsed).toBe(0);
    });

    it('Windup auto-transitions to Release after windup[dir] ticks', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      const windupTicks = weapon.windup[AttackDirection.Left];
      tickN(fsm, windupTicks);

      expect(fsm.state).toBe(CombatState.Release);
      expect(fsm.phaseTotal).toBe(weapon.release[AttackDirection.Left]);
      expect(fsm.phaseElapsed).toBe(0);
    });

    it('Release auto-transitions to Recovery after release[dir] ticks', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Stab);
      const windup = weapon.windup[AttackDirection.Stab];
      const release = weapon.release[AttackDirection.Stab];
      const recovery = weapon.recovery[AttackDirection.Stab];

      tickN(fsm, windup); // → Release
      expect(fsm.state).toBe(CombatState.Release);

      tickN(fsm, release); // → Recovery
      expect(fsm.state).toBe(CombatState.Recovery);
      expect(fsm.phaseTotal).toBe(recovery);

      tickN(fsm, recovery); // → Idle
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('uses correct ticks per attack direction', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Overhead);
      expect(fsm.phaseTotal).toBe(weapon.windup[AttackDirection.Overhead]);
    });

    it('emits attack stamina event on Windup entry', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('attack');
    });

    it('attack charges stamina even if the swing whiffs (no hit landed)', () => {
      // Acceptance test #18: Windup entry charges `staminaCost.attack`
      // unconditionally — no hit dispatch is required to debit the cost.
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      expect(fsm.drainStaminaEvents()).toHaveLength(1);
      // Drive the entire chain without any hit input — no further events.
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      tickN(fsm, weapon.release[AttackDirection.Left]);
      tickN(fsm, weapon.recovery[AttackDirection.Left]);
      expect(fsm.drainStaminaEvents()).toHaveLength(0);
    });
  });

  // ── Morph (direction change during Windup) ─────────

  describe('Windup morph', () => {
    it('Attack(newDir) during Windup restarts windup timer with new direction', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, 2);
      // Drain the initial attack event so we can check morph emits none.
      fsm.drainStaminaEvents();

      const result = fsm.transition(CombatInput.Attack, AttackDirection.Overhead);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Windup);
      expect(fsm.attackDirection).toBe(AttackDirection.Overhead);
      expect(fsm.phaseTotal).toBe(weapon.windup[AttackDirection.Overhead]);
      expect(fsm.phaseElapsed).toBe(0);
    });

    it('morph does NOT charge extra stamina', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      fsm.drainStaminaEvents(); // clear initial attack event

      fsm.transition(CombatInput.Attack, AttackDirection.Overhead);
      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(0);
    });

    it('morph to same direction is a no-op (returns false)', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, 2);
      const elapsedBefore = fsm.phaseElapsed;

      const result = fsm.transition(CombatInput.Attack, AttackDirection.Left);
      expect(result).toBe(false);
      expect(fsm.phaseElapsed).toBe(elapsedBefore);
    });
  });

  // ── Combo buffering ────────────────────────────────

  describe('combo buffering', () => {
    it('Attack during Recovery sets isComboRecovery and chains to Windup on phase end', () => {
      // Acceptance test #6: Recovery uses `comboRecovery[dir]` when LMB
      // pressed during recovery.
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]); // → Release
      tickN(fsm, weapon.release[AttackDirection.Left]); // → Recovery
      expect(fsm.state).toBe(CombatState.Recovery);
      expect(fsm.isComboRecovery).toBe(false); // first recovery is normal

      // Buffer a combo Attack — the *next* recovery will be a comboRecovery.
      const result = fsm.transition(CombatInput.Attack, AttackDirection.Right);
      expect(result).toBe(true);
      expect(fsm.isComboRecovery).toBe(true);

      // Complete recovery → should chain into Windup (no Idle transition).
      tickN(fsm, weapon.recovery[AttackDirection.Left]);
      expect(fsm.state).toBe(CombatState.Windup);
      expect(fsm.attackDirection).toBe(AttackDirection.Right);
    });

    it('combo Recovery uses comboRecovery[dir] timing, not full recovery', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      tickN(fsm, weapon.release[AttackDirection.Left]);
      // Buffer the combo
      fsm.transition(CombatInput.Attack, AttackDirection.Right);
      // Complete first Recovery → second Windup (combo-flagged)
      tickN(fsm, weapon.recovery[AttackDirection.Left]);
      tickN(fsm, weapon.windup[AttackDirection.Right]);
      tickN(fsm, weapon.release[AttackDirection.Right]);

      expect(fsm.state).toBe(CombatState.Recovery);
      expect(fsm.phaseTotal).toBe(weapon.comboRecovery[AttackDirection.Right]);
    });

    it('combo Windup emits a fresh attack stamina event', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      tickN(fsm, weapon.release[AttackDirection.Left]);
      fsm.drainStaminaEvents(); // clear initial attack event

      fsm.transition(CombatInput.Attack, AttackDirection.Right);
      tickN(fsm, weapon.recovery[AttackDirection.Left]); // → Windup (combo)

      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('attack');
    });

    it('isComboRecovery resets to false on Idle entry', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      tickN(fsm, weapon.release[AttackDirection.Left]);
      fsm.transition(CombatInput.Attack, AttackDirection.Right);
      // Drive the combo all the way through to Idle.
      tickN(fsm, weapon.recovery[AttackDirection.Left]); // → Windup #2
      tickN(fsm, weapon.windup[AttackDirection.Right]); // → Release #2
      tickN(fsm, weapon.release[AttackDirection.Right]); // → Recovery #2
      tickN(fsm, weapon.comboRecovery[AttackDirection.Right]); // → Idle

      expect(fsm.state).toBe(CombatState.Idle);
      expect(fsm.isComboRecovery).toBe(false);
    });

    it('Recovery → Idle on phase end when no combo buffered', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Stab);
      tickN(fsm, weapon.windup[AttackDirection.Stab]);
      tickN(fsm, weapon.release[AttackDirection.Stab]);
      tickN(fsm, weapon.recovery[AttackDirection.Stab]);
      expect(fsm.state).toBe(CombatState.Idle);
    });
  });

  // ── Block + Parry ──────────────────────────────────

  describe('block and parry', () => {
    it('Idle → Blocking on Block(dir) and blockingEntryWasJustPress is true', () => {
      const result = fsm.transition(CombatInput.Block, BlockDirection.Left);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Blocking);
      expect(fsm.blockDirection).toBe(BlockDirection.Left);
      expect(fsm.blockingEntryWasJustPress).toBe(true);
      expect(fsm.phaseElapsed).toBe(0);
      // Blocking has no fixed duration — phaseTotal is 0.
      expect(fsm.phaseTotal).toBe(0);
    });

    it('parryActive is true while in Blocking AND elapsed ≤ parryWindow', () => {
      fsm.transition(CombatInput.Block, BlockDirection.Top);
      expect(fsm.parryActive).toBe(true);
      // Tick within the window — still active.
      tickN(fsm, weapon.parryWindow);
      expect(fsm.parryActive).toBe(true);
      // One more tick and we're past the window.
      tickN(fsm, 1);
      expect(fsm.parryActive).toBe(false);
    });

    it('Blocking → Idle on ReleaseBlock', () => {
      fsm.transition(CombatInput.Block, BlockDirection.Top);
      const result = fsm.transition(CombatInput.ReleaseBlock);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('Blocking + BlockedHit stays in Blocking and drains block stamina', () => {
      fsm.transition(CombatInput.Block, BlockDirection.Top);
      fsm.drainStaminaEvents();

      const result = fsm.transition(CombatInput.BlockedHit);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Blocking);
      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('block');
    });

    it('Blocking + ParryTriggered transitions to Parry and drains parry stamina', () => {
      fsm.transition(CombatInput.Block, BlockDirection.Top);
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
      fsm.transition(CombatInput.Block, BlockDirection.Top);
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
      fsm.transition(CombatInput.Block, BlockDirection.Top);
      fsm.transition(CombatInput.ParryTriggered);
      const released = fsm.transition(CombatInput.ReleaseBlock);
      expect(released).toBe(true);
      // FSM stays in Parry — release-during-Parry only stages the post-end route.
      expect(fsm.state).toBe(CombatState.Parry);

      tickN(fsm, weapon.parryRecovery);
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('Block + BlockBreak transitions to HitStun for blockBreakStunTicks', () => {
      fsm.transition(CombatInput.Block, BlockDirection.Top);
      const result = fsm.transition(CombatInput.BlockBreak);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.HitStun);
      expect(fsm.phaseTotal).toBe(weapon.blockBreakStunTicks);
    });

    it('cannot Block from non-Idle/Recovery states', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      const result = fsm.transition(CombatInput.Block, BlockDirection.Top);
      expect(result).toBe(false);
      expect(fsm.state).toBe(CombatState.Windup);
    });

    it('Block from Recovery transitions to Blocking (with fresh parry window)', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Stab);
      tickN(fsm, weapon.windup[AttackDirection.Stab]);
      tickN(fsm, weapon.release[AttackDirection.Stab]);
      expect(fsm.state).toBe(CombatState.Recovery);

      const result = fsm.transition(CombatInput.Block, BlockDirection.Right);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Blocking);
      expect(fsm.blockDirection).toBe(BlockDirection.Right);
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
      fsm.transition(CombatInput.Attack, AttackDirection.Overhead);
      tickN(fsm, 2);
      fsm.transition(CombatInput.HitReceived);
      expect(fsm.state).toBe(CombatState.HitStun);
    });

    it('HitReceived during Recovery clears combo buffer', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      tickN(fsm, weapon.release[AttackDirection.Left]);
      fsm.transition(CombatInput.Attack, AttackDirection.Right); // buffered
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
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]); // → Release

      const result = fsm.transition(CombatInput.WasParried);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.HitStun);
      expect(fsm.phaseTotal).toBe(weapon.parryStunTicks);
    });

    it('HitStun(parried) → Recovery → Idle', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      fsm.transition(CombatInput.WasParried);

      tickN(fsm, weapon.parryStunTicks); // → Recovery
      expect(fsm.state).toBe(CombatState.Recovery);
    });

    it('WasParried is rejected from non-Release states', () => {
      // From Idle
      expect(fsm.transition(CombatInput.WasParried)).toBe(false);
      // From Windup
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      expect(fsm.transition(CombatInput.WasParried)).toBe(false);
      expect(fsm.state).toBe(CombatState.Windup);
    });
  });

  // ── BlockedHit (attacker bounces off block) ───────

  describe('BlockedHit on attacker', () => {
    it('Release + BlockedHit forces attacker into Recovery (no extra stamina)', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]); // → Release
      fsm.drainStaminaEvents();

      const result = fsm.transition(CombatInput.BlockedHit);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Recovery);
      expect(fsm.phaseTotal).toBe(weapon.recovery[AttackDirection.Left]);
      // Attacker did not pay block stamina (defender does).
      expect(fsm.drainStaminaEvents()).toHaveLength(0);
    });
  });

  // ── Turncap ────────────────────────────────────────

  describe('turncap', () => {
    it('returns weapon.turncap.windup during Windup', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      expect(fsm.getCurrentTurncap()).toBe(weapon.turncap.windup);
    });

    it('returns weapon.turncap.release during Release', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      expect(fsm.getCurrentTurncap()).toBe(weapon.turncap.release);
    });

    it('returns weapon.turncap.recovery during Recovery', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      tickN(fsm, weapon.release[AttackDirection.Left]);
      expect(fsm.getCurrentTurncap()).toBe(weapon.turncap.recovery);
    });

    it('returns weapon.turncap.hitStun during HitStun (regression test)', () => {
      // Acceptance test #27 — the new HitStun cap from issue A.
      fsm.transition(CombatInput.HitReceived);
      expect(fsm.getCurrentTurncap()).toBe(weapon.turncap.hitStun);
    });

    it('returns Infinity during Blocking', () => {
      fsm.transition(CombatInput.Block, BlockDirection.Top);
      expect(fsm.getCurrentTurncap()).toBe(Infinity);
    });

    it('returns Infinity during Parry (defender is rewarded)', () => {
      fsm.transition(CombatInput.Block, BlockDirection.Top);
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
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      expect(fsm.canTransition(CombatInput.Block)).toBe(false);
    });

    it('allows Attack (combo) from Recovery', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      tickN(fsm, weapon.release[AttackDirection.Left]);
      expect(fsm.canTransition(CombatInput.Attack)).toBe(true);
    });

    it('allows ParryTriggered from Blocking only', () => {
      expect(fsm.canTransition(CombatInput.ParryTriggered)).toBe(false);
      fsm.transition(CombatInput.Block, BlockDirection.Top);
      expect(fsm.canTransition(CombatInput.ParryTriggered)).toBe(true);
    });

    it('allows BlockBreak from Blocking only', () => {
      expect(fsm.canTransition(CombatInput.BlockBreak)).toBe(false);
      fsm.transition(CombatInput.Block, BlockDirection.Top);
      expect(fsm.canTransition(CombatInput.BlockBreak)).toBe(true);
    });
  });

  // ── Phase tracking ─────────────────────────────────

  describe('phaseElapsed / phaseTotal', () => {
    it('increments phaseElapsed by 1 each tick during Windup', () => {
      // Acceptance test #24: phaseElapsed increments every tick during
      // animatable states.
      fsm.transition(CombatInput.Attack, AttackDirection.Overhead);
      expect(fsm.phaseElapsed).toBe(0);
      fsm.tick();
      expect(fsm.phaseElapsed).toBe(1);
      fsm.tick();
      expect(fsm.phaseElapsed).toBe(2);
    });

    it('phaseTotal is 0 in Idle and Blocking', () => {
      expect(fsm.phaseTotal).toBe(0);
      fsm.transition(CombatInput.Block, BlockDirection.Top);
      expect(fsm.phaseTotal).toBe(0);
    });

    it('getPhaseT is 0 → 1 monotonically during a fixed-duration phase', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Overhead);
      const total = weapon.windup[AttackDirection.Overhead];
      expect(fsm.getPhaseT()).toBe(0);
      const half = Math.floor(total / 2);
      tickN(fsm, half);
      expect(fsm.getPhaseT()).toBeCloseTo(half / total, 5);
    });

    it('getPhaseT is 0 in Idle and Blocking (no fixed duration)', () => {
      expect(fsm.getPhaseT()).toBe(0);
      fsm.transition(CombatInput.Block, BlockDirection.Top);
      tickN(fsm, 3);
      expect(fsm.getPhaseT()).toBe(0);
    });

    it('ticksRemaining is the v1-compat shim (phaseTotal − phaseElapsed)', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Stab);
      const total = weapon.windup[AttackDirection.Stab];
      expect(fsm.ticksRemaining).toBe(total);
      tickN(fsm, 2);
      expect(fsm.ticksRemaining).toBe(total - 2);
    });
  });

  // ── direction getter (forward-compat with issue D) ─

  describe('direction getter', () => {
    it('returns attack direction in attack states', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      expect(fsm.direction).toBe(AttackDirection.Left);
    });

    it('returns block direction in defensive states', () => {
      fsm.transition(CombatInput.Block, BlockDirection.Right);
      expect(fsm.direction).toBe(BlockDirection.Right);
      fsm.transition(CombatInput.ParryTriggered);
      expect(fsm.direction).toBe(BlockDirection.Right);
    });
  });

  // ── Reset ──────────────────────────────────────────

  describe('reset', () => {
    it('returns to Idle and clears all transient state', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
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
      fsm.setBlockDirection(BlockDirection.Right);
      expect(fsm.blockDirection).toBe(BlockDirection.Right);
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('preserves phaseElapsed when called mid-block', () => {
      fsm.transition(CombatInput.Block, BlockDirection.Top);
      tickN(fsm, 2);
      const elapsedBefore = fsm.phaseElapsed;
      fsm.setBlockDirection(BlockDirection.Left);
      expect(fsm.blockDirection).toBe(BlockDirection.Left);
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
});
