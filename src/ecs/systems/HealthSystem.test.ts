import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent, hasComponent } from 'bitecs';
import { Health, DeadTag, RespawnPending } from '../components';
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

  describe('death detection (issue #130: component-based)', () => {
    it('detects death when health reaches 0', () => {
      const eid = createTestEntity(world, 5);
      queueDamage({ target: eid, amount: 10 });
      const result = healthSystemTick(world);
      expect(result.died).toContain(eid);
      expect(isDead(world, eid)).toBe(true);
    });

    it('does not detect death when health is above 0', () => {
      const eid = createTestEntity(world, 50);
      queueDamage({ target: eid, amount: 10 });
      const result = healthSystemTick(world);
      expect(result.died).not.toContain(eid);
      expect(isDead(world, eid)).toBe(false);
    });

    it('adds DeadTag component on death', () => {
      const eid = createTestEntity(world, 5);
      queueDamage({ target: eid, amount: 10 });
      healthSystemTick(world);
      expect(hasComponent(world, DeadTag, eid)).toBe(true);
    });

    it('adds RespawnPending component with full timer on death', () => {
      const eid = createTestEntity(world, 5);
      queueDamage({ target: eid, amount: 10 });
      healthSystemTick(world);
      expect(hasComponent(world, RespawnPending, eid)).toBe(true);
      expect(RespawnPending.ticksRemaining[eid]).toBe(RESPAWN_DELAY_TICKS);
    });

    it('does not double-fire died event for an already-dead entity', () => {
      const eid = createTestEntity(world, 5);
      queueDamage({ target: eid, amount: 10 });
      const first = healthSystemTick(world);
      expect(first.died).toContain(eid);

      const second = healthSystemTick(world);
      expect(second.died).not.toContain(eid);
    });
  });

  describe('respawn (issue #130: 180 ticks = 3 seconds)', () => {
    it('RESPAWN_DELAY_TICKS is 180 (3.0s @ 60Hz)', () => {
      expect(RESPAWN_DELAY_TICKS).toBe(180);
    });

    it('signals respawn after RESPAWN_DELAY_TICKS', () => {
      const eid = createTestEntity(world, 5, 100);
      queueDamage({ target: eid, amount: 10 });
      healthSystemTick(world); // dies, starts respawn timer

      // Tick through respawn delay
      for (let i = 0; i < RESPAWN_DELAY_TICKS - 1; i++) {
        const result = healthSystemTick(world);
        expect(result.respawned).not.toContain(eid);
      }

      // Final tick — respawn signaled
      const result = healthSystemTick(world);
      expect(result.respawned).toContain(eid);
      // HP is NOT restored here (#130: that's processRespawns' job in issue B).
      expect(Health.current[eid]).toBe(0);
    });

    it('decrements RespawnPending.ticksRemaining each tick', () => {
      const eid = createTestEntity(world, 5);
      queueDamage({ target: eid, amount: 10 });
      healthSystemTick(world); // tick 0: dies, ticksRemaining = 180

      expect(RespawnPending.ticksRemaining[eid]).toBe(RESPAWN_DELAY_TICKS);

      healthSystemTick(world);
      expect(RespawnPending.ticksRemaining[eid]).toBe(RESPAWN_DELAY_TICKS - 1);

      healthSystemTick(world);
      expect(RespawnPending.ticksRemaining[eid]).toBe(RESPAWN_DELAY_TICKS - 2);
    });

    it('does not respawn before delay expires', () => {
      const eid = createTestEntity(world, 5, 100);
      queueDamage({ target: eid, amount: 10 });
      healthSystemTick(world);

      // Tick 50 times (not enough — delay is 180)
      for (let i = 0; i < 50; i++) {
        healthSystemTick(world);
      }
      expect(isDead(world, eid)).toBe(true);
      expect(Health.current[eid]).toBe(0);
    });

    it('clamps RespawnPending.ticksRemaining at 0 after respawn signal', () => {
      const eid = createTestEntity(world, 5, 100);
      queueDamage({ target: eid, amount: 10 });
      healthSystemTick(world);
      // Tick all the way to 0
      for (let i = 0; i < RESPAWN_DELAY_TICKS; i++) {
        healthSystemTick(world);
      }
      expect(RespawnPending.ticksRemaining[eid]).toBe(0);
      // Defensive: subsequent ticks should not underflow the ui16. Until
      // processRespawns removes the components, healthSystemTick should
      // keep returning the eid in `respawned` (the cleanup hook is responsible
      // for removing the components).
      const after = healthSystemTick(world);
      expect(RespawnPending.ticksRemaining[eid]).toBe(0);
      expect(after.respawned).toContain(eid);
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

    it('isDead is per-entity (one entity dying does not flag others)', () => {
      const eid1 = createTestEntity(world, 5);
      const eid2 = createTestEntity(world, 100);

      queueDamage({ target: eid1, amount: 10 });
      healthSystemTick(world);

      expect(isDead(world, eid1)).toBe(true);
      expect(isDead(world, eid2)).toBe(false);
    });
  });
});
