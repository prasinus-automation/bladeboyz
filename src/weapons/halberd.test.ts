import { describe, it, expect } from 'vitest';
import { weaponConfigs } from './WeaponConfig';
import { Direction } from '../combat/directions';
import './halberd';

const ALL_DIRS = [
  Direction.Left,
  Direction.Right,
  Direction.Overhead,
  Direction.Stab,
] as const;

describe('Halberd weapon config', () => {
  it('is registered in weaponConfigs', () => {
    expect(weaponConfigs['Halberd']).toBeDefined();
  });

  it('has name "Halberd"', () => {
    expect(weaponConfigs['Halberd'].name).toBe('Halberd');
  });

  it('has damage for all 4 attack directions', () => {
    const dmg = weaponConfigs['Halberd'].damage;
    for (const dir of ALL_DIRS) {
      expect(dmg[dir]).toBeDefined();
      expect(dmg[dir].head).toBeGreaterThan(0);
      expect(dmg[dir].torso).toBeGreaterThan(0);
      expect(dmg[dir].limb).toBeGreaterThan(0);
    }
  });

  it('has windup, release, recovery, comboRecovery for all 4 directions', () => {
    const cfg = weaponConfigs['Halberd'];
    for (const dir of ALL_DIRS) {
      expect(cfg.windup[dir]).toBeGreaterThan(0);
      expect(cfg.release[dir]).toBeGreaterThan(0);
      expect(cfg.recovery[dir]).toBeGreaterThan(0);
      expect(cfg.comboRecovery[dir]).toBeGreaterThan(0);
    }
  });

  it('the overhead chop is its heaviest hit', () => {
    const cfg = weaponConfigs['Halberd'];
    for (const dir of [Direction.Left, Direction.Right, Direction.Stab]) {
      expect(cfg.damage[Direction.Overhead].head).toBeGreaterThan(cfg.damage[dir].head);
    }
    expect(cfg.damage[Direction.Overhead].head).toBe(60);
  });

  it('slashes are slow (windup >= 22) but the spike thrust is quick (14)', () => {
    const cfg = weaponConfigs['Halberd'];
    expect(cfg.windup[Direction.Left]).toBeGreaterThanOrEqual(22);
    expect(cfg.windup[Direction.Right]).toBeGreaterThanOrEqual(22);
    expect(cfg.windup[Direction.Stab]).toBe(14);
  });

  it('has polearm reach (range 2.2, tip tracer at y=2.15)', () => {
    const cfg = weaponConfigs['Halberd'];
    expect(cfg.range).toBe(2.2);
    const tip = cfg.tracerPoints[cfg.tracerPoints.length - 1];
    expect(tip[1]).toBe(2.15);
  });

  it('stays inside the server claim caps (damage <= 80, reach <= 7)', () => {
    const cfg = weaponConfigs['Halberd'];
    for (const dir of ALL_DIRS) {
      expect(cfg.damage[dir].head).toBeLessThanOrEqual(80);
    }
    expect(cfg.range).toBeLessThanOrEqual(7);
  });

  it('recovery turncap is uncapped (2026-07 fluidity contract)', () => {
    expect(weaponConfigs['Halberd'].turncap.recovery).toBe(Infinity);
  });
});
