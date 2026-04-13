import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Stamina, CombatStateComp } from '../components';
import { CombatState, BLOCK_BREAK_STUN_TICKS } from '../../combat/states';
import {
  staminaSystemTick,
  queueStaminaCost,
  resetStaminaTracking,
  STAMINA_REGEN_PER_TICK,
  REGEN_DELAY_TICKS,
} from './StaminaSystem';
import type { WeaponConfig } from '../../weapons/WeaponConfig';

/** Minimal mock weapon config for testing */
const mockWeapon: WeaponConfig = {
  name: 'test-sword',
  damage: {} as any,
  windup: {} as any,
  release: {} as any,
  recovery: {} as any,
  comboRecovery: {} as any,
  parryWindow: 8,
  staminaCost: { attack: 15, block: 10, parry: 5, feint: 20 },
  turncap: {} as any,
  tracerPoints: [],
  range: 1.0,
};

function createTestEntity(world: any, stamina = 100, maxStamina = 100, state = CombatState.Idle): number {
  const eid = addEntity(world);
  addComponent(world, Stamina, eid);
  addComponent(world, CombatStateComp, eid);
  Stamina.current[eid] = stamina;
  Stamina.max[eid] = maxStamina;
  CombatStateComp.state[eid] = state;
  CombatStateComp.ticksRemaining[eid] = 0;
  CombatStateComp.weaponId[eid] = 0;
  return eid;
}

describe('StaminaSystem', () => {
  let world: any;

  beforeEach(() => {
    world = createWorld();
    resetStaminaTracking();
  });

  describe('stamina cost deduction', () => {
    it('deducts attack cost from stamina', () => {
      const eid = createTestEntity(world, 100, 100, CombatState.Windup);
      queueStaminaCost({ entity: eid, type: 'attack', weaponConfig: mockWeapon });
      staminaSystemTick(world);
      expect(Stamina.current[eid]).toBe(85); // 100 - 15
    });

    it('deducts block cost from stamina', () => {
      const eid = createTestEntity(world, 100, 100, CombatState.Block);
      queueStaminaCost({ entity: eid, type: 'block', weaponConfig: mockWeapon });
      staminaSystemTick(world);
      expect(Stamina.current[eid]).toBe(90); // 100 - 10
    });

    it('deducts parry cost from stamina', () => {
      const eid = createTestEntity(world, 100, 100, CombatState.ParryWindow);
      queueStaminaCost({ entity: eid, type: 'parry', weaponConfig: mockWeapon });
      staminaSystemTick(world);
      expect(Stamina.current[eid]).toBe(95); // 100 - 5
    });

    it('deducts feint cost from stamina', () => {
      const eid = createTestEntity(world, 100, 100, CombatState.Idle);
      queueStaminaCost({ entity: eid, type: 'feint', weaponConfig: mockWeapon });
      staminaSystemTick(world);
      expect(Stamina.current[eid]).toBe(80); // 100 - 20
    });

    it('clamps stamina to 0 (never goes negative)', () => {
      const eid = createTestEntity(world, 5, 100, CombatState.Windup);
      queueStaminaCost({ entity: eid, type: 'attack', weaponConfig: mockWeapon });
      staminaSystemTick(world);
      expect(Stamina.current[eid]).toBe(0);
    });

    it('handles multiple cost events in one tick', () => {
      const eid = createTestEntity(world, 100, 100, CombatState.Block);
      queueStaminaCost({ entity: eid, type: 'block', weaponConfig: mockWeapon });
      queueStaminaCost({ entity: eid, type: 'block', weaponConfig: mockWeapon });
      staminaSystemTick(world);
      expect(Stamina.current[eid]).toBe(80); // 100 - 10 - 10
    });
  });

  describe('block break → Stunned', () => {
    it('transitions to Stunned when stamina hits 0 while blocking', () => {
      const eid = createTestEntity(world, 5, 100, CombatState.Block);
      queueStaminaCost({ entity: eid, type: 'block', weaponConfig: mockWeapon });
      const broken = staminaSystemTick(world);
      expect(CombatStateComp.state[eid]).toBe(CombatState.Stunned);
      expect(CombatStateComp.ticksRemaining[eid]).toBe(BLOCK_BREAK_STUN_TICKS);
      expect(broken).toContain(eid);
    });

    it('transitions to Stunned when stamina hits 0 during ParryWindow', () => {
      const eid = createTestEntity(world, 3, 100, CombatState.ParryWindow);
      queueStaminaCost({ entity: eid, type: 'parry', weaponConfig: mockWeapon });
      const broken = staminaSystemTick(world);
      expect(CombatStateComp.state[eid]).toBe(CombatState.Stunned);
      expect(broken).toContain(eid);
    });

    it('does NOT stun if stamina hits 0 while NOT blocking', () => {
      const eid = createTestEntity(world, 5, 100, CombatState.Windup);
      queueStaminaCost({ entity: eid, type: 'attack', weaponConfig: mockWeapon });
      const broken = staminaSystemTick(world);
      expect(CombatStateComp.state[eid]).toBe(CombatState.Windup); // unchanged
      expect(broken).not.toContain(eid);
    });

    it('sets stun duration to 30 ticks', () => {
      const eid = createTestEntity(world, 1, 100, CombatState.Block);
      queueStaminaCost({ entity: eid, type: 'block', weaponConfig: mockWeapon });
      staminaSystemTick(world);
      expect(CombatStateComp.ticksRemaining[eid]).toBe(30);
    });
  });

  describe('passive regeneration', () => {
    it('does NOT regen within the delay period', () => {
      const eid = createTestEntity(world, 50, 100, CombatState.Idle);

      // Tick 59 times (just under 1 second delay)
      for (let i = 0; i < REGEN_DELAY_TICKS - 1; i++) {
        staminaSystemTick(world);
      }
      expect(Stamina.current[eid]).toBe(50); // no regen yet
    });

    it('starts regen after idle delay (60 ticks)', () => {
      const eid = createTestEntity(world, 50, 100, CombatState.Idle);

      // Tick through delay period
      for (let i = 0; i < REGEN_DELAY_TICKS; i++) {
        staminaSystemTick(world);
      }

      // Now should start regenerating
      staminaSystemTick(world);
      expect(Stamina.current[eid]).toBeGreaterThan(50);
    });

    it('regens at ~5 stamina per second (5/60 per tick)', () => {
      const eid = createTestEntity(world, 50, 100, CombatState.Idle);

      // Pass delay
      for (let i = 0; i < REGEN_DELAY_TICKS; i++) {
        staminaSystemTick(world);
      }

      const before = Stamina.current[eid];
      staminaSystemTick(world);
      const after = Stamina.current[eid];
      expect(after - before).toBeCloseTo(STAMINA_REGEN_PER_TICK, 5);
    });

    it('does not regen above max', () => {
      const eid = createTestEntity(world, 99.99, 100, CombatState.Idle);

      // Pass delay + regen ticks
      for (let i = 0; i < REGEN_DELAY_TICKS + 10; i++) {
        staminaSystemTick(world);
      }
      expect(Stamina.current[eid]).toBeLessThanOrEqual(100);
    });

    it('does not regen while attacking (non-idle state)', () => {
      const eid = createTestEntity(world, 50, 100, CombatState.Release);

      // Pass well beyond delay
      for (let i = 0; i < REGEN_DELAY_TICKS + 30; i++) {
        staminaSystemTick(world);
      }
      expect(Stamina.current[eid]).toBe(50); // no regen during Release
    });

    it('does not regen while blocking', () => {
      const eid = createTestEntity(world, 50, 100, CombatState.Block);

      for (let i = 0; i < REGEN_DELAY_TICKS + 30; i++) {
        staminaSystemTick(world);
      }
      expect(Stamina.current[eid]).toBe(50);
    });

    it('resets delay counter after a stamina cost', () => {
      const eid = createTestEntity(world, 80, 100, CombatState.Idle);

      // Pass delay
      for (let i = 0; i < REGEN_DELAY_TICKS + 5; i++) {
        staminaSystemTick(world);
      }
      const regenValue = Stamina.current[eid];
      expect(regenValue).toBeGreaterThan(80);

      // Now consume stamina
      queueStaminaCost({ entity: eid, type: 'attack', weaponConfig: mockWeapon });
      staminaSystemTick(world);

      const afterCost = Stamina.current[eid];

      // Tick without reaching delay — should NOT regen
      for (let i = 0; i < REGEN_DELAY_TICKS - 1; i++) {
        staminaSystemTick(world);
      }
      expect(Stamina.current[eid]).toBe(afterCost);
    });

    it('allows regen during Recovery state (post-attack)', () => {
      const eid = createTestEntity(world, 50, 100, CombatState.Recovery);

      for (let i = 0; i < REGEN_DELAY_TICKS + 5; i++) {
        staminaSystemTick(world);
      }
      expect(Stamina.current[eid]).toBeGreaterThan(50);
    });
  });

  describe('multiple entities', () => {
    it('handles independent stamina tracking per entity', () => {
      const eid1 = createTestEntity(world, 100, 100, CombatState.Idle);
      const eid2 = createTestEntity(world, 50, 100, CombatState.Block);

      queueStaminaCost({ entity: eid2, type: 'block', weaponConfig: mockWeapon });
      staminaSystemTick(world);

      expect(Stamina.current[eid1]).toBe(100); // untouched
      expect(Stamina.current[eid2]).toBe(40); // 50 - 10
    });
  });
});
