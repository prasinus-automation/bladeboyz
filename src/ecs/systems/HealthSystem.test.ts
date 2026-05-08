import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Health } from '../components';
import {
  healthSystemTick,
  queueDamage,
  resetHealthTracking,
  isDead,
  RESPAWN_DELAY_TICKS,
} from './HealthSystem';

function createTestEntity(world: any, hp = 100, maxHp = 100): number {
  const eid = addEntity(world);
  addComponent(world, Health, eid);
  Health.current[eid] = hp;
  Health.max[eid] = maxHp;
  return eid;
}

describe('HealthSystem', () => {
  let world: any;

  beforeEach(() => {
    world = createWorld();
    resetHealthTracking();
  });

  describe('damage processing', () => {
    it('reduces health by damage amount', () => {
      const eid = createTestEntity(world);
      queueDamage({ target: eid, amount: 30 });
      healthSystemTick(world);
      expect(Health.current[eid]).toBe(70);
    });

    it('clamps health to 0 (never goes negative)', () => {
      const eid = createTestEntity(world, 10);
      queueDamage({ target: eid, amount: 50 });
      healthSystemTick(world);
      expect(Health.current[eid]).toBe(0);
    });

    it('processes multiple damage events', () => {
      const eid = createTestEntity(world);
      queueDamage({ target: eid, amount: 20 });
      queueDamage({ target: eid, amount: 15 });
      healthSystemTick(world);
      expect(Health.current[eid]).toBe(65); // 100 - 20 - 15
    });

    it('ignores damage to already-dead entities', () => {
      const eid = createTestEntity(world, 5);
      queueDamage({ target: eid, amount: 10 }); // kills
      healthSystemTick(world);
      expect(Health.current[eid]).toBe(0);

      // Try to damage again while dead
      queueDamage({ target: eid, amount: 30 });
      healthSystemTick(world);
      expect(Health.current[eid]).toBe(0); // still 0, no double-kill
    });
  });

  describe('death detection', () => {
    it('detects death when health reaches 0', () => {
      const eid = createTestEntity(world, 5);
      queueDamage({ target: eid, amount: 10 });
      const result = healthSystemTick(world);
      expect(result.died).toContain(eid);
      expect(isDead(eid)).toBe(true);
    });

    it('does not detect death when health is above 0', () => {
      const eid = createTestEntity(world, 50);
      queueDamage({ target: eid, amount: 10 });
      const result = healthSystemTick(world);
      expect(result.died).not.toContain(eid);
      expect(isDead(eid)).toBe(false);
    });
  });

  describe('respawn', () => {
    it('respawns after RESPAWN_DELAY_TICKS (120 ticks = 2 seconds)', () => {
      const eid = createTestEntity(world, 5, 100);
      queueDamage({ target: eid, amount: 10 });
      healthSystemTick(world); // dies, starts respawn timer

      // Tick through respawn delay
      for (let i = 0; i < RESPAWN_DELAY_TICKS - 1; i++) {
        const result = healthSystemTick(world);
        expect(result.respawned).not.toContain(eid);
      }

      // Final tick — respawn
      const result = healthSystemTick(world);
      expect(result.respawned).toContain(eid);
      expect(Health.current[eid]).toBe(100); // reset to max
      expect(isDead(eid)).toBe(false);
    });

    it('does not respawn before delay expires', () => {
      const eid = createTestEntity(world, 5, 100);
      queueDamage({ target: eid, amount: 10 });
      healthSystemTick(world);

      // Tick 50 times (not enough)
      for (let i = 0; i < 50; i++) {
        healthSystemTick(world);
      }
      expect(isDead(eid)).toBe(true);
      expect(Health.current[eid]).toBe(0);
    });
  });

  describe('multiple entities', () => {
    it('handles damage to different entities independently', () => {
      const eid1 = createTestEntity(world, 100);
      const eid2 = createTestEntity(world, 50);

      queueDamage({ target: eid1, amount: 30 });
      healthSystemTick(world);

      expect(Health.current[eid1]).toBe(70);
      expect(Health.current[eid2]).toBe(50); // untouched
    });
  });

  describe('kill attribution', () => {
    it('emits a KillEvent with the attacker when victim dies from attributed damage', () => {
      const victim = createTestEntity(world, 5);
      const attacker = createTestEntity(world, 100);

      queueDamage({ target: victim, amount: 10, attackerEid: attacker });
      const result = healthSystemTick(world);

      expect(result.died).toContain(victim);
      expect(result.kills).toEqual([{ victimEid: victim, attackerEid: attacker }]);
    });

    it('emits a KillEvent with attackerEid=undefined for environmental death', () => {
      const victim = createTestEntity(world, 5);

      // No attackerEid passed
      queueDamage({ target: victim, amount: 10 });
      const result = healthSystemTick(world);

      expect(result.died).toContain(victim);
      expect(result.kills).toHaveLength(1);
      expect(result.kills[0].victimEid).toBe(victim);
      expect(result.kills[0].attackerEid).toBeUndefined();
    });

    it('attributes the kill to the LAST attacker when multiple attackers hit in the same tick', () => {
      const victim = createTestEntity(world, 100);
      const a1 = createTestEntity(world, 100);
      const a2 = createTestEntity(world, 100);

      queueDamage({ target: victim, amount: 50, attackerEid: a1 });
      queueDamage({ target: victim, amount: 60, attackerEid: a2 }); // killing blow
      const result = healthSystemTick(world);

      expect(result.died).toContain(victim);
      expect(result.kills).toEqual([{ victimEid: victim, attackerEid: a2 }]);
    });

    it('does NOT emit a KillEvent for non-fatal damage', () => {
      const victim = createTestEntity(world, 100);
      const attacker = createTestEntity(world, 100);

      queueDamage({ target: victim, amount: 30, attackerEid: attacker });
      const result = healthSystemTick(world);

      expect(result.died).toEqual([]);
      expect(result.kills).toEqual([]);
    });

    it('does not leak attacker attribution across ticks', () => {
      const victim1 = createTestEntity(world, 100);
      const victim2 = createTestEntity(world, 5);
      const attacker = createTestEntity(world, 100);

      // Tick 1: non-fatal hit on victim1 — attacker recorded but no death
      queueDamage({ target: victim1, amount: 20, attackerEid: attacker });
      let result = healthSystemTick(world);
      expect(result.kills).toEqual([]);

      // Tick 2: victim2 dies from environmental damage — must NOT inherit
      // attacker from tick 1's transient map.
      queueDamage({ target: victim2, amount: 10 });
      result = healthSystemTick(world);
      expect(result.died).toContain(victim2);
      expect(result.kills).toHaveLength(1);
      expect(result.kills[0].attackerEid).toBeUndefined();
    });

    it('skips attribution for damage to already-dead entities (already-dead guard)', () => {
      const victim = createTestEntity(world, 5);
      const a1 = createTestEntity(world, 100);
      const a2 = createTestEntity(world, 100);

      // Tick 1: a1 lands the kill
      queueDamage({ target: victim, amount: 10, attackerEid: a1 });
      let result = healthSystemTick(world);
      expect(result.kills).toEqual([{ victimEid: victim, attackerEid: a1 }]);

      // Tick 2: a2 tries to land posthumous damage — must NOT reattribute
      queueDamage({ target: victim, amount: 10, attackerEid: a2 });
      result = healthSystemTick(world);
      expect(result.died).toEqual([]); // already dead, not detected again
      expect(result.kills).toEqual([]);
    });
  });
});
