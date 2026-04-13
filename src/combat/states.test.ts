import { describe, it, expect } from 'vitest';
import { CombatState, MovementState, COMBAT_STATE_NAMES, BLOCK_BREAK_STUN_TICKS } from './states';

describe('Combat States', () => {
  it('CombatState enum has all expected values', () => {
    expect(CombatState.Idle).toBe(0);
    expect(CombatState.Windup).toBe(1);
    expect(CombatState.Release).toBe(2);
    expect(CombatState.Recovery).toBe(3);
    expect(CombatState.Block).toBe(4);
    expect(CombatState.ParryWindow).toBe(5);
    expect(CombatState.Riposte).toBe(6);
    expect(CombatState.Feint).toBe(7);
    expect(CombatState.Clash).toBe(8);
    expect(CombatState.Stunned).toBe(9);
    expect(CombatState.HitStun).toBe(10);
  });

  it('has human-readable names for all states', () => {
    expect(COMBAT_STATE_NAMES[CombatState.Idle]).toBe('Idle');
    expect(COMBAT_STATE_NAMES[CombatState.Stunned]).toBe('Stunned');
    expect(COMBAT_STATE_NAMES[CombatState.HitStun]).toBe('HitStun');
  });

  it('sets block break stun to 30 ticks', () => {
    expect(BLOCK_BREAK_STUN_TICKS).toBe(30);
  });

  it('MovementState enum has all expected values', () => {
    expect(MovementState.Idle).toBe(0);
    expect(MovementState.Walking).toBe(1);
    expect(MovementState.Running).toBe(2);
    expect(MovementState.Jumping).toBe(3);
    expect(MovementState.Crouching).toBe(4);
  });
});
