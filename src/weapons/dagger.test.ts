import { describe, it, expect } from 'vitest';
import { weaponConfigs } from './WeaponConfig';
import { Direction } from '../combat/directions';
import './dagger';

// FSM v2 (#88, #131): 4 attack directions — Underhand removed.
const ALL_DIRS = [
  Direction.Left,
  Direction.Right,
  Direction.Overhead,
  Direction.Stab,
] as const;

describe('Dagger weapon config', () => {
  it('is registered in weaponConfigs', () => {
    expect(weaponConfigs['Dagger']).toBeDefined();
  });

  it('has name "Dagger"', () => {
    expect(weaponConfigs['Dagger'].name).toBe('Dagger');
  });

  it('has damage for all 4 attack directions', () => {
    const dmg = weaponConfigs['Dagger'].damage;
    for (const dir of ALL_DIRS) {
      expect(dmg[dir]).toBeDefined();
      expect(dmg[dir].head).toBeGreaterThan(0);
      expect(dmg[dir].torso).toBeGreaterThan(0);
      expect(dmg[dir].limb).toBeGreaterThan(0);
    }
  });

  it('has windup, release, recovery, comboRecovery for all 4 directions', () => {
    const cfg = weaponConfigs['Dagger'];
    for (const dir of ALL_DIRS) {
      expect(cfg.windup[dir]).toBeGreaterThan(0);
      expect(cfg.release[dir]).toBeGreaterThan(0);
      expect(cfg.recovery[dir]).toBeGreaterThan(0);
      expect(cfg.comboRecovery[dir]).toBeGreaterThan(0);
    }
  });

  it('has fast timings (windup <= 16 ticks)', () => {
    const cfg = weaponConfigs['Dagger'];
    for (const dir of ALL_DIRS) {
      expect(cfg.windup[dir]).toBeLessThanOrEqual(16);
    }
  });

  it('has low damage (head <= 25)', () => {
    const cfg = weaponConfigs['Dagger'];
    for (const dir of ALL_DIRS) {
      expect(cfg.damage[dir].head).toBeLessThanOrEqual(25);
    }
  });

  it('has very short range (0.35)', () => {
    expect(weaponConfigs['Dagger'].range).toBe(0.35);
  });

  it('has low stamina attack cost (<= 10)', () => {
    expect(weaponConfigs['Dagger'].staminaCost.attack).toBeLessThanOrEqual(10);
  });

  it('has low block stamina drain (8)', () => {
    expect(weaponConfigs['Dagger'].blockStaminaDrain).toBe(8);
  });

  it('has 2 tracer points', () => {
    expect(weaponConfigs['Dagger'].tracerPoints).toHaveLength(2);
  });

  it('has all required fields', () => {
    const cfg = weaponConfigs['Dagger'];
    expect(cfg.parryWindow).toBeGreaterThan(0);
    expect(cfg.parryRecovery).toBeGreaterThan(0);          // FSM v2 (#131)
    expect(cfg.blockBreakStunTicks).toBeGreaterThan(0);    // FSM v2 (#131)
    expect(cfg.staminaCost.block).toBeGreaterThan(0);
    expect(cfg.staminaCost.parry).toBeGreaterThan(0);
    // staminaCost.feint is optional in FSM v2 (no Feint state)
    expect(cfg.turncap.windup).toBeGreaterThan(0);
    expect(cfg.turncap.release).toBeGreaterThan(0);
    expect(cfg.turncap.recovery).toBeGreaterThan(0);
    expect(cfg.turncap.hitStun).toBeGreaterThan(0);        // FSM v2 (#131)
    expect(cfg.parryStunTicks).toBeGreaterThan(0);
    expect(cfg.hitStunTicks).toBeGreaterThan(0);
  });

  it('has FSM v2 schema values', () => {
    const cfg = weaponConfigs['Dagger'];
    expect(cfg.parryRecovery).toBe(8);
    expect(cfg.blockBreakStunTicks).toBe(24);
    // 2026-07 fluidity pass: hitStun cap raised 0.005 → 0.02 (dazed, not frozen).
    expect(cfg.turncap.hitStun).toBe(0.02);
  });
});
