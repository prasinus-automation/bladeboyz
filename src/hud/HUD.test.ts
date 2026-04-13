import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Health, Stamina, CombatStateComp } from '../ecs/components';
import { CombatState } from '../combat/states';
import { HUD } from './HUD';

function createTestEntity(world: any): number {
  const eid = addEntity(world);
  addComponent(world, Health, eid);
  addComponent(world, Stamina, eid);
  addComponent(world, CombatStateComp, eid);
  Health.current[eid] = 75;
  Health.max[eid] = 100;
  Stamina.current[eid] = 60;
  Stamina.max[eid] = 100;
  CombatStateComp.state[eid] = CombatState.Idle;
  CombatStateComp.ticksRemaining[eid] = 0;
  return eid;
}

describe('HUD', () => {
  let hud: HUD;
  let world: any;

  beforeEach(() => {
    world = createWorld();
    // jsdom provides document/body
    hud = new HUD();
  });

  afterEach(() => {
    hud.dispose();
  });

  it('creates health bar element in DOM', () => {
    expect(document.getElementById('health-bar')).not.toBeNull();
  });

  it('creates stamina bar element in DOM', () => {
    expect(document.getElementById('stamina-bar')).not.toBeNull();
  });

  it('creates FSM state label element in DOM', () => {
    expect(document.getElementById('fsm-state-label')).not.toBeNull();
  });

  it('creates FPS counter element in DOM', () => {
    expect(document.getElementById('fps-counter')).not.toBeNull();
  });

  it('FSM label is hidden by default', () => {
    const el = document.getElementById('fsm-state-label')!;
    expect(el.style.display).toBe('none');
  });

  it('toggles FSM label on F4 keydown', () => {
    const el = document.getElementById('fsm-state-label')!;
    expect(el.style.display).toBe('none');

    // Press F4
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' }));
    expect(el.style.display).toBe('block');

    // Press F4 again
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' }));
    expect(el.style.display).toBe('none');
  });

  it('updates without throwing', () => {
    const eid = createTestEntity(world);
    expect(() => hud.update(1 / 60, eid)).not.toThrow();
  });

  it('updates FPS counter text', () => {
    const eid = createTestEntity(world);
    hud.update(1 / 60, eid); // ~60 FPS
    const fpsEl = document.getElementById('fps-counter')!;
    expect(fpsEl.textContent).toMatch(/\d+ FPS/);
  });

  it('cleans up DOM on dispose', () => {
    hud.dispose();
    expect(document.getElementById('health-bar')).toBeNull();
    expect(document.getElementById('stamina-bar')).toBeNull();
    expect(document.getElementById('fsm-state-label')).toBeNull();
    expect(document.getElementById('fps-counter')).toBeNull();
  });

  it('toggleFps hides and shows the counter', () => {
    const fpsEl = document.getElementById('fps-counter')!;
    expect(fpsEl.style.display).not.toBe('none');

    hud.toggleFps();
    expect(fpsEl.style.display).toBe('none');

    hud.toggleFps();
    expect(fpsEl.style.display).toBe('block');
  });
});
