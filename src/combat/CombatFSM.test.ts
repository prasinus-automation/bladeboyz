/**
 * Tests for the CombatFSM — the per-entity combat state machine.
 *
 * Pure logic tests: no Three.js, no Rapier, no DOM.
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
    [AttackDirection.Underhand]: 7,
    [AttackDirection.Stab]: 5,
  };

  return {
    name: 'TestSword',
    damage: {
      [AttackDirection.Left]: { head: 50, torso: 35, limb: 25 },
      [AttackDirection.Right]: { head: 50, torso: 35, limb: 25 },
      [AttackDirection.Overhead]: { head: 55, torso: 40, limb: 25 },
      [AttackDirection.Underhand]: { head: 45, torso: 35, limb: 25 },
      [AttackDirection.Stab]: { head: 45, torso: 40, limb: 20 },
    },
    windup: { ...defaultTicks },
    release: {
      [AttackDirection.Left]: 4,
      [AttackDirection.Right]: 4,
      [AttackDirection.Overhead]: 5,
      [AttackDirection.Underhand]: 4,
      [AttackDirection.Stab]: 3,
    },
    recovery: {
      [AttackDirection.Left]: 12,
      [AttackDirection.Right]: 12,
      [AttackDirection.Overhead]: 15,
      [AttackDirection.Underhand]: 13,
      [AttackDirection.Stab]: 10,
    },
    comboRecovery: {
      [AttackDirection.Left]: 8,
      [AttackDirection.Right]: 8,
      [AttackDirection.Overhead]: 10,
      [AttackDirection.Underhand]: 9,
      [AttackDirection.Stab]: 6,
    },
    parryWindow: 6,
    staminaCost: { attack: 15, block: 10, parry: 5, feint: 20 },
    turncap: { windup: 0.08, release: 0.03, recovery: 0.05 },
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

describe('CombatFSM', () => {
  let weapon: WeaponConfig;
  let fsm: CombatFSM;

  beforeEach(() => {
    weapon = createTestWeapon();
    fsm = new CombatFSM(weapon);
  });

  // ── Initial state ──────────────────────────────────

  describe('initial state', () => {
    it('starts in Idle', () => {
      expect(fsm.state).toBe(CombatState.Idle);
      expect(fsm.ticksRemaining).toBe(0);
    });

    it('has no turncap in Idle', () => {
      expect(fsm.getCurrentTurncap()).toBe(Infinity);
    });
  });

  // ── Attack chain: Idle → Windup → Release → Recovery → Idle ──

  describe('attack chain', () => {
    it('transitions from Idle to Windup on attack', () => {
      const result = fsm.transition(CombatInput.Attack, AttackDirection.Left);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Windup);
      expect(fsm.attackDirection).toBe(AttackDirection.Left);
      expect(fsm.ticksRemaining).toBe(weapon.windup[AttackDirection.Left]);
    });

    it('auto-transitions Windup → Release when timer expires', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      const windupTicks = weapon.windup[AttackDirection.Left];
      tickN(fsm, windupTicks);

      expect(fsm.state).toBe(CombatState.Release);
      expect(fsm.ticksRemaining).toBe(weapon.release[AttackDirection.Left]);
    });

    it('auto-transitions Release → Recovery → Idle', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Stab);
      const windup = weapon.windup[AttackDirection.Stab];
      const release = weapon.release[AttackDirection.Stab];
      const recovery = weapon.recovery[AttackDirection.Stab];

      tickN(fsm, windup); // → Release
      expect(fsm.state).toBe(CombatState.Release);

      tickN(fsm, release); // → Recovery
      expect(fsm.state).toBe(CombatState.Recovery);
      expect(fsm.ticksRemaining).toBe(recovery);

      tickN(fsm, recovery); // → Idle
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('uses correct ticks per attack direction', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Overhead);
      expect(fsm.ticksRemaining).toBe(weapon.windup[AttackDirection.Overhead]);
    });

    it('emits attack stamina event on Windup', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('attack');
    });
  });

  // ── Block + Parry ──────────────────────────────────

  describe('block and parry', () => {
    it('transitions Idle → ParryWindow → Block', () => {
      fsm.transition(CombatInput.Block, undefined, BlockDirection.Left);
      expect(fsm.state).toBe(CombatState.ParryWindow);
      expect(fsm.blockDirection).toBe(BlockDirection.Left);
      expect(fsm.ticksRemaining).toBe(weapon.parryWindow);

      tickN(fsm, weapon.parryWindow);
      expect(fsm.state).toBe(CombatState.Block);
      expect(fsm.ticksRemaining).toBe(0); // Block is held, no timer
    });

    it('returns to Idle on ReleaseBlock from Block', () => {
      fsm.transition(CombatInput.Block, undefined, BlockDirection.Top);
      tickN(fsm, weapon.parryWindow); // → Block

      fsm.transition(CombatInput.ReleaseBlock);
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('returns to Idle on ReleaseBlock from ParryWindow', () => {
      fsm.transition(CombatInput.Block, undefined, BlockDirection.Top);
      expect(fsm.state).toBe(CombatState.ParryWindow);

      fsm.transition(CombatInput.ReleaseBlock);
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('cannot block from non-Idle states', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      const result = fsm.transition(CombatInput.Block, undefined, BlockDirection.Top);
      expect(result).toBe(false);
      expect(fsm.state).toBe(CombatState.Windup);
    });

    it('ParryTriggered transitions to Riposte', () => {
      fsm.transition(CombatInput.Block, undefined, BlockDirection.Top);
      expect(fsm.state).toBe(CombatState.ParryWindow);

      const result = fsm.transition(CombatInput.ParryTriggered);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Riposte);
    });

    it('Riposte auto-transitions to Release when timer expires', () => {
      fsm.transition(CombatInput.Block, undefined, BlockDirection.Top);
      fsm.transition(CombatInput.ParryTriggered);
      expect(fsm.state).toBe(CombatState.Riposte);

      tickN(fsm, fsm.ticksRemaining);
      expect(fsm.state).toBe(CombatState.Release);
    });

    it('BlockedHit emits block stamina event', () => {
      fsm.transition(CombatInput.Block, undefined, BlockDirection.Top);
      tickN(fsm, weapon.parryWindow); // → Block

      fsm.transition(CombatInput.BlockedHit);
      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('block');
    });

    it('ParryTriggered emits parry stamina event', () => {
      fsm.transition(CombatInput.Block, undefined, BlockDirection.Top);
      fsm.transition(CombatInput.ParryTriggered);

      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('parry');
    });
  });

  // ── Feint ──────────────────────────────────────────

  describe('feint', () => {
    it('transitions Windup → Feint on feint input', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      fsm.drainStaminaEvents(); // clear attack event

      const result = fsm.transition(CombatInput.Feint);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Feint);
    });

    it('Feint auto-transitions to Recovery → Idle', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      fsm.transition(CombatInput.Feint);

      // Feint has ~3 tick duration
      tickN(fsm, 3); // → Recovery
      expect(fsm.state).toBe(CombatState.Recovery);

      tickN(fsm, weapon.recovery[AttackDirection.Left]); // → Idle
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('feint emits feint stamina event', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      fsm.drainStaminaEvents(); // clear attack event

      fsm.transition(CombatInput.Feint);
      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('feint');
    });

    it('cannot feint from non-Windup states', () => {
      expect(fsm.transition(CombatInput.Feint)).toBe(false);
    });
  });

  // ── Morph ──────────────────────────────────────────

  describe('morph (direction change during windup)', () => {
    it('changes attack direction and restarts windup timer', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, 2); // advance a couple ticks

      const result = fsm.transition(CombatInput.Attack, AttackDirection.Overhead);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Windup);
      expect(fsm.attackDirection).toBe(AttackDirection.Overhead);
      expect(fsm.ticksRemaining).toBe(weapon.windup[AttackDirection.Overhead]);
    });

    it('does not morph to the same direction', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, 2);

      const result = fsm.transition(CombatInput.Attack, AttackDirection.Left);
      expect(result).toBe(false);
    });
  });

  // ── Combo ──────────────────────────────────────────

  describe('combo buffering', () => {
    it('buffers attack during Recovery and chains to Windup', () => {
      // Complete a full attack to get to Recovery
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]); // → Release
      tickN(fsm, weapon.release[AttackDirection.Left]); // → Recovery
      expect(fsm.state).toBe(CombatState.Recovery);

      // Buffer a combo attack
      const result = fsm.transition(CombatInput.Attack, AttackDirection.Right);
      expect(result).toBe(true);

      // Complete recovery → should chain into Windup
      tickN(fsm, weapon.recovery[AttackDirection.Left]);
      expect(fsm.state).toBe(CombatState.Windup);
      expect(fsm.attackDirection).toBe(AttackDirection.Right);
    });

    it('combo Windup emits a new attack stamina event', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      tickN(fsm, weapon.release[AttackDirection.Left]);
      fsm.drainStaminaEvents(); // clear prior events

      fsm.transition(CombatInput.Attack, AttackDirection.Right);
      tickN(fsm, weapon.recovery[AttackDirection.Left]); // → Windup (combo)

      const events = fsm.drainStaminaEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('attack');
    });
  });

  // ── HitStun ────────────────────────────────────────

  describe('HitStun', () => {
    it('HitReceived transitions to HitStun from Idle', () => {
      const result = fsm.transition(CombatInput.HitReceived);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.HitStun);
      expect(fsm.ticksRemaining).toBe(weapon.hitStunTicks);
    });

    it('HitStun auto-transitions to Recovery → Idle', () => {
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

    it('HitReceived clears combo buffer', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      tickN(fsm, weapon.release[AttackDirection.Left]);
      // Buffer a combo
      fsm.transition(CombatInput.Attack, AttackDirection.Right);

      // Get hit during recovery
      fsm.transition(CombatInput.HitReceived);
      expect(fsm.state).toBe(CombatState.HitStun);

      // After HitStun + Recovery, should go to Idle (not combo)
      tickN(fsm, weapon.hitStunTicks);
      expect(fsm.state).toBe(CombatState.Recovery);
      tickN(fsm, weapon.recovery[fsm.attackDirection]);
      expect(fsm.state).toBe(CombatState.Idle);
    });

    it('cannot receive hit while already in HitStun', () => {
      fsm.transition(CombatInput.HitReceived);
      const result = fsm.transition(CombatInput.HitReceived);
      expect(result).toBe(false);
    });
  });

  // ── WasParried (attacker gets stunned) ─────────────

  describe('WasParried', () => {
    it('transitions Release → Stunned on WasParried', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]); // → Release

      const result = fsm.transition(CombatInput.WasParried);
      expect(result).toBe(true);
      expect(fsm.state).toBe(CombatState.Stunned);
      expect(fsm.ticksRemaining).toBe(weapon.parryStunTicks);
    });

    it('Stunned auto-transitions to Recovery → Idle', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      fsm.transition(CombatInput.WasParried);

      tickN(fsm, weapon.parryStunTicks); // → Recovery
      expect(fsm.state).toBe(CombatState.Recovery);
    });
  });

  // ── Turncap ────────────────────────────────────────

  describe('turncap', () => {
    it('returns windup turncap during Windup', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      expect(fsm.getCurrentTurncap()).toBe(weapon.turncap.windup);
    });

    it('returns release turncap during Release', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      expect(fsm.getCurrentTurncap()).toBe(weapon.turncap.release);
    });

    it('returns recovery turncap during Recovery', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      tickN(fsm, weapon.release[AttackDirection.Left]);
      expect(fsm.getCurrentTurncap()).toBe(weapon.turncap.recovery);
    });

    it('returns release turncap during Riposte', () => {
      fsm.transition(CombatInput.Block, undefined, BlockDirection.Top);
      fsm.transition(CombatInput.ParryTriggered);
      expect(fsm.getCurrentTurncap()).toBe(weapon.turncap.release);
    });

    it('returns Infinity during Block', () => {
      fsm.transition(CombatInput.Block, undefined, BlockDirection.Top);
      tickN(fsm, weapon.parryWindow);
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

    it('allows Feint from Windup', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      expect(fsm.canTransition(CombatInput.Feint)).toBe(true);
    });

    it('disallows Feint from Idle', () => {
      expect(fsm.canTransition(CombatInput.Feint)).toBe(false);
    });

    it('allows Attack (combo) from Recovery', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, weapon.windup[AttackDirection.Left]);
      tickN(fsm, weapon.release[AttackDirection.Left]);
      expect(fsm.canTransition(CombatInput.Attack)).toBe(true);
    });
  });

  // ── Reset ──────────────────────────────────────────

  describe('reset', () => {
    it('resets to Idle with no pending events', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      tickN(fsm, 2);
      fsm.reset();

      expect(fsm.state).toBe(CombatState.Idle);
      expect(fsm.ticksRemaining).toBe(0);
      expect(fsm.drainStaminaEvents()).toHaveLength(0);
    });
  });

  // ── getStaminaCostType ─────────────────────────────

  describe('getStaminaCostType', () => {
    it('returns attack during Windup', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      expect(fsm.getStaminaCostType()).toBe('attack');
    });

    it('returns null during Idle', () => {
      expect(fsm.getStaminaCostType()).toBeNull();
    });

    it('returns block during Block', () => {
      fsm.transition(CombatInput.Block, undefined, BlockDirection.Top);
      tickN(fsm, weapon.parryWindow);
      expect(fsm.getStaminaCostType()).toBe('block');
    });

    it('returns feint during Feint', () => {
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      fsm.transition(CombatInput.Feint);
      expect(fsm.getStaminaCostType()).toBe('feint');
    });
  });

  // ── Weapon config ──────────────────────────────────

  describe('weapon config', () => {
    it('can swap weapon config', () => {
      const newWeapon = createTestWeapon({ name: 'TestAxe' });
      fsm.setWeaponConfig(newWeapon);
      expect(fsm.weaponConfig.name).toBe('TestAxe');
    });
  });
});
