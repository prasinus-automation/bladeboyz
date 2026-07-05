import { describe, it, expect } from 'vitest';
import { weaponConfigs } from './WeaponConfig';
import { Direction } from '../combat/directions';
import './rapier';

const ALL_DIRS = [
  Direction.Left,
  Direction.Right,
  Direction.Overhead,
  Direction.Stab,
] as const;

describe('Rapier weapon config', () => {
  it('is registered in weaponConfigs', () => {
    expect(weaponConfigs['Rapier']).toBeDefined();
  });

  it('has name "Rapier"', () => {
    expect(weaponConfigs['Rapier'].name).toBe('Rapier');
  });

  it('has damage for all 4 attack directions', () => {
    const dmg = weaponConfigs['Rapier'].damage;
    for (const dir of ALL_DIRS) {
      expect(dmg[dir]).toBeDefined();
      expect(dmg[dir].head).toBeGreaterThan(0);
      expect(dmg[dir].torso).toBeGreaterThan(0);
      expect(dmg[dir].limb).toBeGreaterThan(0);
    }
  });

  it('has windup, release, recovery, comboRecovery for all 4 directions', () => {
    const cfg = weaponConfigs['Rapier'];
    for (const dir of ALL_DIRS) {
      expect(cfg.windup[dir]).toBeGreaterThan(0);
      expect(cfg.release[dir]).toBeGreaterThan(0);
      expect(cfg.recovery[dir]).toBeGreaterThan(0);
      expect(cfg.comboRecovery[dir]).toBeGreaterThan(0);
    }
  });

  it('the stab is its fastest and hardest-hitting attack (the identity)', () => {
    const cfg = weaponConfigs['Rapier'];
    for (const dir of [Direction.Left, Direction.Right, Direction.Overhead]) {
      expect(cfg.windup[Direction.Stab]).toBeLessThan(cfg.windup[dir]);
      expect(cfg.damage[Direction.Stab].head).toBeGreaterThan(cfg.damage[dir].head);
    }
  });

  it('has the fastest stab windup in the arsenal (9 ticks)', () => {
    expect(weaponConfigs['Rapier'].windup[Direction.Stab]).toBe(9);
  });

  it('has the longest parry window (15 ticks)', () => {
    expect(weaponConfigs['Rapier'].parryWindow).toBe(15);
  });

  it('has negligible knockback (a poke, not a shove)', () => {
    const kb = weaponConfigs['Rapier'].knockback;
    expect(kb).toBeDefined();
    expect(kb!.force).toBeLessThan(1);
  });

  it('has 4 tracer points and range 1.6', () => {
    expect(weaponConfigs['Rapier'].tracerPoints).toHaveLength(4);
    expect(weaponConfigs['Rapier'].range).toBe(1.6);
  });

  it('recovery turncap is uncapped (2026-07 fluidity contract)', () => {
    expect(weaponConfigs['Rapier'].turncap.recovery).toBe(Infinity);
  });
});
