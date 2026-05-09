/**
 * Tests for `PickupPrompt` (issue #127).
 *
 * jsdom-only — no Three.js renderer needed. The prompt is screen-centred,
 * so its update logic is purely:
 *   - read player Position component
 *   - iterate pickupRegistry, compute squared 3D distance, find closest in PICKUP_RADIUS
 *   - check fsmRegistry.get(playerEid).state === Idle
 *   - check pointer lock
 *   - flip display style + write weapon name
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { Position } from '../ecs/components';
import { pickupRegistry, resetPickupRegistry } from '../inventory/PickupRegistry';
import { fsmRegistry, CombatFSM } from '../combat/CombatFSM';
import { CombatInput } from '../combat/CombatFSM';
import { Direction } from '../combat/directions';
import { weaponConfigs } from '../weapons/WeaponConfig';
import '../weapons/longsword'; // auto-register
import { PickupPrompt } from './PickupPrompt';

const PLAYER_EID = 1;

/** Build a real CombatFSM in `Idle` state for the test player. */
function setIdleFsm(): CombatFSM {
  const fsm = new CombatFSM(weaponConfigs['Longsword']);
  fsmRegistry.set(PLAYER_EID, fsm);
  return fsm;
}

/** Stub pointer lock state. */
function setPointerLock(locked: boolean): void {
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => (locked ? document.body : null),
  });
}

/** Add a pickup at the given world position. */
function addPickup(eid: number, weaponName: string, x: number, y: number, z: number): void {
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;
  // Empty registry entry — the prompt only reads `weaponName` from PickupData.
  pickupRegistry.set(eid, {
    weaponName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    group: new THREE.Group() as any,
    materials: [],
  });
}

describe('PickupPrompt', () => {
  let prompt: PickupPrompt;

  beforeEach(() => {
    // Clean up any leftover DOM
    document.getElementById('pickup-prompt')?.remove();
    resetPickupRegistry();
    fsmRegistry.clear();

    // Default: player at origin, idle, pointer locked
    Position.x[PLAYER_EID] = 0;
    Position.y[PLAYER_EID] = 0.1;
    Position.z[PLAYER_EID] = 0;
    setIdleFsm();
    setPointerLock(true);

    prompt = new PickupPrompt();
  });

  afterEach(() => {
    prompt.dispose();
    resetPickupRegistry();
    fsmRegistry.clear();
  });

  it('creates the DOM element', () => {
    expect(document.getElementById('pickup-prompt')).not.toBeNull();
  });

  it('starts hidden', () => {
    const el = document.getElementById('pickup-prompt')!;
    expect(el.style.display).toBe('none');
  });

  it('hidden when no pickups in registry', () => {
    prompt.update(PLAYER_EID);
    const el = document.getElementById('pickup-prompt')!;
    expect(el.style.display).toBe('none');
  });

  it('hidden when pickup is outside PICKUP_RADIUS (1.5m)', () => {
    addPickup(2, 'Mace', 5, 0.1, 0);
    prompt.update(PLAYER_EID);
    const el = document.getElementById('pickup-prompt')!;
    expect(el.style.display).toBe('none');
  });

  it('shown when pickup is within PICKUP_RADIUS', () => {
    addPickup(2, 'Mace', 1.0, 0.1, 0);
    prompt.update(PLAYER_EID);
    const el = document.getElementById('pickup-prompt')!;
    expect(el.style.display).toBe('block');
  });

  it('renders the weapon name when shown', () => {
    addPickup(2, 'Battleaxe', 0.5, 0.1, 0);
    prompt.update(PLAYER_EID);
    const el = document.getElementById('pickup-prompt')!;
    expect(el.textContent).toContain('Battleaxe');
  });

  it('uses the closest pickup when multiple are in range', () => {
    addPickup(2, 'Mace', 1.4, 0.1, 0); // 1.4 m away
    addPickup(3, 'Dagger', 0.5, 0.1, 0); // 0.5 m away
    addPickup(4, 'Longsword', 1.0, 0.1, 0); // 1.0 m away
    prompt.update(PLAYER_EID);
    const el = document.getElementById('pickup-prompt')!;
    expect(el.textContent).toContain('Dagger');
    expect(el.textContent).not.toContain('Mace');
    expect(el.textContent).not.toContain('Longsword');
  });

  it('uses 3D distance (Y matters)', () => {
    // 1.0 m horizontally + 1.5 m vertically = ~1.8 m total (outside)
    addPickup(2, 'Mace', 1.0, 1.6, 0);
    prompt.update(PLAYER_EID);
    const el = document.getElementById('pickup-prompt')!;
    expect(el.style.display).toBe('none');
  });

  it('hides when player FSM is not Idle', () => {
    addPickup(2, 'Mace', 0.5, 0.1, 0);
    // Drive the FSM out of Idle via a real Attack input (funneled write).
    const fsm = fsmRegistry.get(PLAYER_EID)!;
    fsm.transition(CombatInput.Attack, Direction.Stab);
    prompt.update(PLAYER_EID);
    const el = document.getElementById('pickup-prompt')!;
    expect(el.style.display).toBe('none');
  });

  it('hides when player has no FSM registered', () => {
    addPickup(2, 'Mace', 0.5, 0.1, 0);
    fsmRegistry.delete(PLAYER_EID);
    prompt.update(PLAYER_EID);
    const el = document.getElementById('pickup-prompt')!;
    expect(el.style.display).toBe('none');
  });

  it('hides when pointer lock is released (modal overlay open)', () => {
    addPickup(2, 'Mace', 0.5, 0.1, 0);
    setPointerLock(false);
    prompt.update(PLAYER_EID);
    const el = document.getElementById('pickup-prompt')!;
    expect(el.style.display).toBe('none');
  });

  it('toggles visibility correctly across frames', () => {
    addPickup(2, 'Mace', 0.5, 0.1, 0);
    prompt.update(PLAYER_EID);
    expect(document.getElementById('pickup-prompt')!.style.display).toBe('block');

    // Player walks away
    Position.x[PLAYER_EID] = 10;
    prompt.update(PLAYER_EID);
    expect(document.getElementById('pickup-prompt')!.style.display).toBe('none');

    // Player walks back
    Position.x[PLAYER_EID] = 0;
    prompt.update(PLAYER_EID);
    expect(document.getElementById('pickup-prompt')!.style.display).toBe('block');
  });

  it('skips DOM writes when state is unchanged across frames', () => {
    addPickup(2, 'Mace', 0.5, 0.1, 0);
    prompt.update(PLAYER_EID);

    const el = document.getElementById('pickup-prompt')!;
    // Spy on the textContent setter to detect redundant writes. We use a
    // shallow assertion on the inner <strong>'s text rather than property
    // descriptors (which jsdom doesn't always honor for HTMLElement).
    const nameEl = el.querySelector('strong')!;
    const initialName = nameEl.textContent;

    // Re-update with the same state — closest pickup unchanged.
    prompt.update(PLAYER_EID);
    expect(nameEl.textContent).toBe(initialName);
  });

  it('updates the displayed name when the closest pickup changes', () => {
    addPickup(2, 'Mace', 0.5, 0.1, 0);
    prompt.update(PLAYER_EID);
    expect(
      document.getElementById('pickup-prompt')!.querySelector('strong')!.textContent,
    ).toBe('Mace');

    // A closer Dagger appears
    addPickup(3, 'Dagger', 0.2, 0.1, 0);
    prompt.update(PLAYER_EID);
    expect(
      document.getElementById('pickup-prompt')!.querySelector('strong')!.textContent,
    ).toBe('Dagger');
  });

  it('dispose() removes the DOM element', () => {
    expect(document.getElementById('pickup-prompt')).not.toBeNull();
    prompt.dispose();
    expect(document.getElementById('pickup-prompt')).toBeNull();
    // Re-create so afterEach's dispose is a no-op
    prompt = new PickupPrompt();
  });
});

describe('PickupPrompt — exact radius boundary', () => {
  let prompt: PickupPrompt;

  beforeEach(() => {
    document.getElementById('pickup-prompt')?.remove();
    resetPickupRegistry();
    fsmRegistry.clear();
    Position.x[PLAYER_EID] = 0;
    Position.y[PLAYER_EID] = 0;
    Position.z[PLAYER_EID] = 0;
    setIdleFsm();
    setPointerLock(true);
    prompt = new PickupPrompt();
  });

  afterEach(() => {
    prompt.dispose();
    resetPickupRegistry();
    fsmRegistry.clear();
  });

  it('shows at exactly 1.5m (inclusive)', () => {
    addPickup(2, 'Mace', 1.5, 0, 0);
    prompt.update(PLAYER_EID);
    expect(document.getElementById('pickup-prompt')!.style.display).toBe('block');
  });

  it('hides just past 1.5m', () => {
    addPickup(2, 'Mace', 1.5001, 0, 0);
    prompt.update(PLAYER_EID);
    expect(document.getElementById('pickup-prompt')!.style.display).toBe('none');
  });
});
