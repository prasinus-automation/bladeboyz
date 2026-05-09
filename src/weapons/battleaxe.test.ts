import { describe, it, expect } from 'vitest';
import { weaponConfigs } from './WeaponConfig';
import { AttackDirection } from '../combat/directions';
import './battleaxe';

// FSM v2 (#88, #131): 4 attack directions — Underhand removed.
const ALL_DIRS = [
  AttackDirection.Left,
  AttackDirection.Right,
  AttackDirection.Overhead,
  AttackDirection.Stab,
] as const;

describe('Battleaxe weapon config', () => {
  it('is registered in weaponConfigs', () => {
    expect(weaponConfigs['Battleaxe']).toBeDefined();
  });

  it('has name "Battleaxe"', () => {
    expect(weaponConfigs['Battleaxe'].name).toBe('Battleaxe');
  });

  it('has damage for all 4 attack directions', () => {
    const dmg = weaponConfigs['Battleaxe'].damage;
    for (const dir of ALL_DIRS) {
      expect(dmg[dir]).toBeDefined();
      expect(dmg[dir].head).toBeGreaterThan(0);
      expect(dmg[dir].torso).toBeGreaterThan(0);
      expect(dmg[dir].limb).toBeGreaterThan(0);
    }
  });

  it('has windup, release, recovery, comboRecovery for all 4 directions', () => {
    const cfg = weaponConfigs['Battleaxe'];
    for (const dir of ALL_DIRS) {
      expect(cfg.windup[dir]).toBeGreaterThan(0);
      expect(cfg.release[dir]).toBeGreaterThan(0);
      expect(cfg.recovery[dir]).toBeGreaterThan(0);
      expect(cfg.comboRecovery[dir]).toBeGreaterThan(0);
    }
  });

  it('has very slow timings (windup >= 19 ticks)', () => {
    const cfg = weaponConfigs['Battleaxe'];
    for (const dir of ALL_DIRS) {
      expect(cfg.windup[dir]).toBeGreaterThanOrEqual(19);
    }
  });

  it('has highest damage (head >= 55)', () => {
    const cfg = weaponConfigs['Battleaxe'];
    for (const dir of ALL_DIRS) {
      expect(cfg.damage[dir].head).toBeGreaterThanOrEqual(55);
    }
  });

  it('has long range (1.2)', () => {
    expect(weaponConfigs['Battleaxe'].range).toBe(1.2);
  });

  it('has very high stamina attack cost (22+)', () => {
    expect(weaponConfigs['Battleaxe'].staminaCost.attack).toBeGreaterThanOrEqual(22);
  });

  it('has high block stamina drain (30+)', () => {
    expect(weaponConfigs['Battleaxe'].blockStaminaDrain).toBeGreaterThanOrEqual(30);
  });

  it('has 4 tracer points on the axe head', () => {
    expect(weaponConfigs['Battleaxe'].tracerPoints).toHaveLength(4);
  });

  it('has all required fields', () => {
    const cfg = weaponConfigs['Battleaxe'];
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
    const cfg = weaponConfigs['Battleaxe'];
    expect(cfg.parryRecovery).toBe(16);
    expect(cfg.blockBreakStunTicks).toBe(42);
    expect(cfg.turncap.hitStun).toBe(0.005);
  });
});
