import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { WorldLabel } from './WorldLabel';
import { Position } from '../ecs/components';
import { shopkeepRegistry } from '../ecs/entities/createShopkeep';

/**
 * WorldLabel tests (jsdom) — verifies the world-anchored HTML projection,
 * nameplate text, and prompt visibility logic. We don't need a full
 * Three.js render — only a camera with valid matrices.
 */

describe('WorldLabel', () => {
  let camera: THREE.PerspectiveCamera;
  let worldLabel: WorldLabel;

  beforeEach(() => {
    // Clean any leftovers
    const existing = document.getElementById('world-label-container');
    if (existing) existing.remove();
    shopkeepRegistry.clear();

    camera = new THREE.PerspectiveCamera(78, 1, 0.1, 1000);
    camera.position.set(0, 1.6, 5);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld(true);

    worldLabel = new WorldLabel(camera);
  });

  afterEach(() => {
    worldLabel.dispose();
    shopkeepRegistry.clear();
  });

  it('creates the wrapper container', () => {
    expect(document.getElementById('world-label-container')).not.toBeNull();
  });

  it('creates a nameplate + prompt for each registered shopkeep', () => {
    const eid = 50;
    Position.x[eid] = 0;
    Position.y[eid] = 1.1;
    Position.z[eid] = 0;
    shopkeepRegistry.set(eid, { name: 'Bob', interactRadius: 2.5 });

    worldLabel.update(null);

    const wrapper = document.getElementById('world-label-container')!;
    // 1 nameplate + 1 prompt
    expect(wrapper.children.length).toBe(2);
  });

  it('renders the nameplate text from shopkeepRegistry.name', () => {
    const eid = 50;
    Position.x[eid] = 0;
    Position.y[eid] = 1.1;
    Position.z[eid] = 0;
    shopkeepRegistry.set(eid, { name: 'Greta', interactRadius: 2.5 });

    worldLabel.update(null);

    const nameplate = document.querySelector('.world-label-nameplate') as HTMLElement;
    expect(nameplate).not.toBeNull();
    expect(nameplate.textContent).toBe('Greta');
  });

  it('hides both labels when shopkeep is behind the camera', () => {
    const eid = 50;
    // Camera is at (0, 1.6, 5) looking toward origin (-Z direction).
    // Place shopkeep BEHIND the camera (positive Z, beyond camera position).
    Position.x[eid] = 0;
    Position.y[eid] = 1.1;
    Position.z[eid] = 20;
    shopkeepRegistry.set(eid, { name: 'Bob', interactRadius: 2.5 });

    worldLabel.update(null);

    const nameplate = document.querySelector('.world-label-nameplate') as HTMLElement;
    const prompt = document.querySelector('.world-label-prompt') as HTMLElement;
    expect(nameplate.style.display).toBe('none');
    expect(prompt.style.display).toBe('none');
  });

  it('hides the prompt when nearbyInteractableEid does NOT match', () => {
    const eid = 50;
    Position.x[eid] = 0;
    Position.y[eid] = 1.1;
    Position.z[eid] = 0;
    shopkeepRegistry.set(eid, { name: 'Bob', interactRadius: 2.5 });

    worldLabel.update(null); // not in range

    const prompt = document.querySelector('.world-label-prompt') as HTMLElement;
    expect(prompt.style.display).toBe('none');
  });

  it('shows the prompt when nearbyInteractableEid matches the shopkeep', () => {
    const eid = 50;
    Position.x[eid] = 0;
    Position.y[eid] = 1.1;
    Position.z[eid] = 0;
    shopkeepRegistry.set(eid, { name: 'Bob', interactRadius: 2.5 });

    worldLabel.update(eid);

    const prompt = document.querySelector('.world-label-prompt') as HTMLElement;
    expect(prompt.style.display).toBe('');
    expect(prompt.textContent).toBe('Press [E] to shop');
  });

  it('positions the nameplate at projected screen coords', () => {
    const eid = 50;
    Position.x[eid] = 0;
    Position.y[eid] = 1.1;
    Position.z[eid] = 0;
    shopkeepRegistry.set(eid, { name: 'Bob', interactRadius: 2.5 });

    worldLabel.update(null);

    const nameplate = document.querySelector('.world-label-nameplate') as HTMLElement;
    // Should have explicit pixel left/top set
    expect(nameplate.style.left).toMatch(/px$/);
    expect(nameplate.style.top).toMatch(/px$/);
  });

  it('toggles prompt visibility across calls (in range → out → in)', () => {
    const eid = 50;
    Position.x[eid] = 0;
    Position.y[eid] = 1.1;
    Position.z[eid] = 0;
    shopkeepRegistry.set(eid, { name: 'Bob', interactRadius: 2.5 });

    worldLabel.update(eid);
    let prompt = document.querySelector('.world-label-prompt') as HTMLElement;
    expect(prompt.style.display).toBe('');

    worldLabel.update(null);
    prompt = document.querySelector('.world-label-prompt') as HTMLElement;
    expect(prompt.style.display).toBe('none');

    worldLabel.update(eid);
    prompt = document.querySelector('.world-label-prompt') as HTMLElement;
    expect(prompt.style.display).toBe('');
  });

  it('removes labels for shopkeeps that have been deleted', () => {
    const eid = 50;
    Position.x[eid] = 0;
    Position.y[eid] = 1.1;
    Position.z[eid] = 0;
    shopkeepRegistry.set(eid, { name: 'Bob', interactRadius: 2.5 });

    worldLabel.update(null);
    let wrapper = document.getElementById('world-label-container')!;
    expect(wrapper.children.length).toBe(2);

    shopkeepRegistry.delete(eid);
    worldLabel.update(null);
    wrapper = document.getElementById('world-label-container')!;
    expect(wrapper.children.length).toBe(0);
  });

  it('clean up on dispose', () => {
    worldLabel.dispose();
    expect(document.getElementById('world-label-container')).toBeNull();
  });
});
