/**
 * PickupPrompt — HUD overlay shown when a weapon pickup is in range.
 *
 * Shown when:
 *   1. There is at least one `WeaponPickup` within `PICKUP_RADIUS` (1.5m)
 *      of the player (3D Euclidean — same metric as `InteractionSystem`).
 *   2. The player's combat FSM is in `Idle` (you can't pick up mid-swing).
 *
 * Hidden otherwise. Hidden also when pointer lock is released (any modal
 * overlay open — inventory/shop/menu) for visual parity with
 * `DirectionIndicator`.
 *
 * Pure HTML overlay — `pointer-events: none` so the player never blocks
 * interaction with the canvas through the prompt. Updated each render frame
 * from `loop.update(dt)` after `pickupRenderer`.
 *
 * The "press E" affordance is wired into the existing KeyE handler in
 * `main.ts` by sibling issue #121 — this module is read-only.
 */

import { Position } from '../ecs/components';
import { pickupRegistry } from '../inventory/PickupRegistry';
import { fsmRegistry } from '../combat/CombatFSM';
import { CombatState } from '../combat/states';
import { PICKUP_RADIUS } from '../ecs/systems/WeaponPickupSystem';

/** Squared radius — avoids a sqrt per pickup in the tight loop. */
const PICKUP_RADIUS_SQ = PICKUP_RADIUS * PICKUP_RADIUS;

export class PickupPrompt {
  private container: HTMLElement;
  private nameSpan: HTMLElement;
  /** Last-rendered weapon name; skip DOM writes when unchanged. */
  private lastName: string | null = null;
  /** Last-rendered visibility; skip DOM writes when unchanged. */
  private lastVisible: boolean = false;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'pickup-prompt';
    this.container.style.cssText = `
      position: fixed;
      bottom: 40%;
      left: 50%;
      transform: translateX(-50%);
      pointer-events: none;
      z-index: 12;
      padding: 6px 14px;
      background: rgba(0, 0, 0, 0.55);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 4px;
      color: #fff;
      font-family: monospace;
      font-size: 16px;
      letter-spacing: 0.5px;
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      display: none;
      white-space: nowrap;
    `;

    // Static template: "Press [E] to pick up <strong>{name}</strong>"
    // The weapon name node is the only thing that changes per-frame.
    const lead = document.createElement('span');
    lead.innerHTML = 'Press <kbd style="' +
      'padding: 1px 5px; ' +
      'background: rgba(255, 255, 255, 0.12); ' +
      'border: 1px solid rgba(255, 255, 255, 0.35); ' +
      'border-radius: 3px; ' +
      'font-family: inherit; ' +
      'font-size: 13px;' +
    '">E</kbd> to pick up ';
    this.container.appendChild(lead);

    this.nameSpan = document.createElement('strong');
    this.nameSpan.style.fontWeight = '600';
    this.container.appendChild(this.nameSpan);

    document.body.appendChild(this.container);
  }

  /**
   * Update prompt visibility and text.
   *
   * @param playerEid Player entity id — read for Position + FSM.
   */
  update(playerEid: number): void {
    // Modal-overlay gate (parity with DirectionIndicator). Pointer lock is
    // released on inventory/shop open — hide the prompt then.
    const locked = document.pointerLockElement != null;

    let visible = false;
    let weaponName: string | null = null;

    if (locked) {
      const fsm = fsmRegistry.get(playerEid);
      const isIdle = fsm !== undefined && fsm.state === CombatState.Idle;

      if (isIdle && pickupRegistry.size > 0) {
        const px = Position.x[playerEid];
        const py = Position.y[playerEid];
        const pz = Position.z[playerEid];

        let closestSq = PICKUP_RADIUS_SQ + 1; // sentinel just past radius
        let closestName: string | null = null;
        for (const [eid, data] of pickupRegistry) {
          const dx = Position.x[eid] - px;
          const dy = Position.y[eid] - py;
          const dz = Position.z[eid] - pz;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq <= PICKUP_RADIUS_SQ && distSq < closestSq) {
            closestSq = distSq;
            closestName = data.weaponName;
          }
        }
        if (closestName !== null) {
          visible = true;
          weaponName = closestName;
        }
      }
    }

    // Apply DOM changes only when the rendered state actually changed —
    // textContent writes trigger style recalc and are needlessly expensive
    // every frame.
    if (visible !== this.lastVisible) {
      this.container.style.display = visible ? 'block' : 'none';
      this.lastVisible = visible;
    }
    if (visible && weaponName !== this.lastName) {
      this.nameSpan.textContent = weaponName;
      this.lastName = weaponName;
    }
  }

  /** Tear down DOM. */
  dispose(): void {
    this.container.remove();
  }
}
