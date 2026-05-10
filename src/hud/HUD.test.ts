import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Health, Stamina, CombatStateComponent } from '../ecs/components';
import { CombatState } from '../combat/states';
import { HUD } from './HUD';

function createTestEntity(world: any): number {
  const eid = addEntity(world);
  addComponent(world, Health, eid);
  addComponent(world, Stamina, eid);
  addComponent(world, CombatStateComponent, eid);
  Health.current[eid] = 75;
  Health.max[eid] = 100;
  Stamina.current[eid] = 60;
  Stamina.max[eid] = 100;
  CombatStateComponent.state[eid] = CombatState.Idle;
  CombatStateComponent.ticksRemaining[eid] = 0;
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

  it('creates FPS counter element in DOM', () => {
    expect(document.getElementById('fps-counter')).not.toBeNull();
  });

  // Issue #172: HUD's F4 / FSM-state-label was a duplicate of the
  // DebugRenderer's F4 (FSM overlay). Both registered separate keydown
  // listeners that called preventDefault() and toggled independent state.
  // The HUD-side handler + label have been removed; F4 is now owned solely
  // by `src/rendering/DebugRenderer.ts`.
  it('does not register an F4 keydown listener (HUD side has no fsm-state-label)', () => {
    // The fsm-state-label is gone entirely.
    expect(document.getElementById('fsm-state-label')).toBeNull();
  });

  it('F4 keydown does not preventDefault from HUD (DebugRenderer is the sole owner)', () => {
    // Construct a fresh keydown event with preventDefault spied. After the
    // HUD's listener removal, dispatching F4 with no DebugRenderer attached
    // must NOT call preventDefault — because the HUD no longer registers a
    // listener at all. This catches a regression where someone re-adds the
    // duplicate F4 handler in HUD.ts.
    const evt = new KeyboardEvent('keydown', { code: 'F4', cancelable: true });
    const preventSpy = vi.spyOn(evt, 'preventDefault');
    document.dispatchEvent(evt);
    expect(preventSpy).not.toHaveBeenCalled();
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
