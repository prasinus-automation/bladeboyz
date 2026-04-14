import { describe, it, expect } from 'vitest';
import { weaponConfigs } from './WeaponConfig';
import { AttackDirection } from '../combat/directions';
import './dagger';

const ALL_DIRS = [
  AttackDirection.Left,
  AttackDirection.Right,
  AttackDirection.Overhead,
  AttackDirection.Underhand,
  AttackDirection.Stab,
] as const;

describe('Dagger weapon config', () => {
  it('is registered in weaponConfigs', () => {
    expect(weaponConfigs['Dagger']).toBeDefined();
  });

  it('has name "Dagger"', () => {
    expect(weaponConfigs['Dagger'].name).toBe('Dagger');
  });

  it('has damage for all 5 attack directions', () => {
    const dmg = weaponConfigs['Dagger'].damage;
    for (const dir of ALL_DIRS) {
      expect(dmg[dir]).toBeDefined();
      expect(dmg[dir].head).toBeGreaterThan(0);
      expect(dmg[dir].torso).toBeGreaterThan(0);
      expect(dmg[dir].limb).toBeGreaterThan(0);
    }
  });

  it('has windup, release, recovery, comboRecovery for all 5 directions', () => {
    const cfg = weaponConfigs['Dagger'];
    for (const dir of ALL_DIRS) {
      expect(cfg.windup[dir]).toBeGreaterThan(0);
      expect(cfg.release[dir]).toBeGreaterThan(0);
      expect(cfg.recovery[dir]).toBeGreaterThan(0);
      expect(cfg.comboRecovery[dir]).toBeGreaterThan(0);
    }
  });

  it('has fast timings (windup <= 8 ticks)', () => {
    const cfg = weaponConfigs['Dagger'];
    for (const dir of ALL_DIRS) {
      expect(cfg.windup[dir]).toBeLessThanOrEqual(8);
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
    expect(cfg.staminaCost.block).toBeGreaterThan(0);
    expect(cfg.staminaCost.parry).toBeGreaterThan(0);
    expect(cfg.staminaCost.feint).toBeGreaterThan(0);
    expect(cfg.turncap.windup).toBeGreaterThan(0);
    expect(cfg.turncap.release).toBeGreaterThan(0);
    expect(cfg.turncap.recovery).toBeGreaterThan(0);
    expect(cfg.parryStunTicks).toBeGreaterThan(0);
    expect(cfg.hitStunTicks).toBeGreaterThan(0);
  });
});
