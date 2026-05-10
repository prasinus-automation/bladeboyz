import { describe, it, expect } from 'vitest';
import { CombatState, MovementState, COMBAT_STATE_NAMES } from './states';

describe('Combat States (FSM v2)', () => {
  it('CombatState enum has the v2 7-state values', () => {
    // Numeric values are the wire format and are read by HUD/DirectionIndicator
    // by literal number — keep them stable across the migration.
    expect(CombatState.Idle).toBe(0);
    expect(CombatState.Windup).toBe(1);
    expect(CombatState.Release).toBe(2);
    expect(CombatState.Recovery).toBe(3);
    expect(CombatState.Blocking).toBe(4);
    expect(CombatState.Parry).toBe(5);
    expect(CombatState.HitStun).toBe(6);
  });

  it('has human-readable names for all states', () => {
    expect(COMBAT_STATE_NAMES[CombatState.Idle]).toBe('Idle');
    expect(COMBAT_STATE_NAMES[CombatState.Windup]).toBe('Windup');
    expect(COMBAT_STATE_NAMES[CombatState.Release]).toBe('Release');
    expect(COMBAT_STATE_NAMES[CombatState.Recovery]).toBe('Recovery');
    expect(COMBAT_STATE_NAMES[CombatState.Blocking]).toBe('Blocking');
    expect(COMBAT_STATE_NAMES[CombatState.Parry]).toBe('Parry');
    expect(COMBAT_STATE_NAMES[CombatState.HitStun]).toBe('HitStun');
  });

  it('MovementState enum has all expected values', () => {
    expect(MovementState.Idle).toBe(0);
    expect(MovementState.Walking).toBe(1);
    expect(MovementState.Running).toBe(2);
    expect(MovementState.Jumping).toBe(3);
    expect(MovementState.Crouching).toBe(4);
  });
});
