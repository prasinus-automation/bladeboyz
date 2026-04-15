import { describe, it, expect } from 'vitest';
import { weaponConfigs } from './WeaponConfig';
import { AttackDirection } from '../combat/directions';
import './mace';

const ALL_DIRS = [
  AttackDirection.Left,
  AttackDirection.Right,
  AttackDirection.Overhead,
  AttackDirection.Underhand,
  AttackDirection.Stab,
] as const;

describe('Mace weapon config', () => {
  it('is registered in weaponConfigs', () => {
    expect(weaponConfigs['Mace']).toBeDefined();
  });

  it('has name "Mace"', () => {
    expect(weaponConfigs['Mace'].name).toBe('Mace');
  });

  it('has damage for all 5 attack directions', () => {
    const dmg = weaponConfigs['Mace'].damage;
    for (const dir of ALL_DIRS) {
      expect(dmg[dir]).toBeDefined();
      expect(dmg[dir].head).toBeGreaterThan(0);
      expect(dmg[dir].torso).toBeGreaterThan(0);
      expect(dmg[dir].limb).toBeGreaterThan(0);
    }
  });

  it('has windup, release, recovery, comboRecovery for all 5 directions', () => {
    const cfg = weaponConfigs['Mace'];
    for (const dir of ALL_DIRS) {
      expect(cfg.windup[dir]).toBeGreaterThan(0);
      expect(cfg.release[dir]).toBeGreaterThan(0);
      expect(cfg.recovery[dir]).toBeGreaterThan(0);
      expect(cfg.comboRecovery[dir]).toBeGreaterThan(0);
    }
  });

  it('has slow timings (windup >= 17 ticks)', () => {
    const cfg = weaponConfigs['Mace'];
    for (const dir of ALL_DIRS) {
      expect(cfg.windup[dir]).toBeGreaterThanOrEqual(17);
    }
  });

  it('has high damage (head >= 42)', () => {
    const cfg = weaponConfigs['Mace'];
    for (const dir of ALL_DIRS) {
      expect(cfg.damage[dir].head).toBeGreaterThanOrEqual(42);
    }
  });

  it('has short range (0.6)', () => {
    expect(weaponConfigs['Mace'].range).toBe(0.6);
  });

  it('has high stamina attack cost (18+)', () => {
    expect(weaponConfigs['Mace'].staminaCost.attack).toBeGreaterThanOrEqual(18);
  });

  it('has high block stamina drain (25+)', () => {
    expect(weaponConfigs['Mace'].blockStaminaDrain).toBeGreaterThanOrEqual(25);
  });

  it('has 3 tracer points on the head', () => {
    expect(weaponConfigs['Mace'].tracerPoints).toHaveLength(3);
  });

  it('has all required fields', () => {
    const cfg = weaponConfigs['Mace'];
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
