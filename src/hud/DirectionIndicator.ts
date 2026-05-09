/**
 * DirectionIndicator — Mordhau-style compass-rose overlay around the crosshair.
 *
 * FSM v2 (#139): single unified `Direction` enum (4 values: Overhead=0,
 * Left=1, Right=2, Stab=3). The HUD draws 3 active arrow wedges (Overhead /
 * Left / Right) plus a center ring for Stab. The old `Bottom` wedge is
 * gone — it was reachable in v1 only via `BlockDirection.Bottom`, which
 * was deleted along with `Underhand` when the direction enum was unified.
 *
 * Highlights the active direction based on combat state:
 *   - Idle: dim white preview of current mouse-detected direction
 *   - Windup/Release: red/orange highlight on committed attack direction
 *   - Blocking/Parry: blue/cyan highlight on committed block direction
 *
 * Hidden when pointer lock is released (inventory/menus open).
 * All elements are HTML/CSS with pointer-events: none.
 */

import { CombatStateComp } from '../ecs/components';

// Direction enums are const enum so we duplicate the numeric values here
// to avoid import issues (const enums are erased at compile time).
// Direction (FSM v2 #139): Overhead=0, Left=1, Right=2, Stab=3
// CombatState (FSM v2 #135): Idle=0, Windup=1, Release=2, Recovery=3,
//                            Blocking=4, Parry=5, HitStun=6

const DIR_OVERHEAD = 0;
const DIR_LEFT = 1;
const DIR_RIGHT = 2;
const DIR_STAB = 3;

/**
 * Map a `Direction` enum value to its arrow index in the `arrows` array.
 * Returns -1 for `Stab` (which uses the center ring instead).
 *
 * Arrow array layout (preserved from v1 for HTML/CSS stability): index 0
 * = left, 1 = right, 2 = top (Overhead). The unified enum's numeric values
 * don't line up with arrow indices anymore, so this lookup is required.
 */
function arrowIndexForDirection(dir: number): number {
  switch (dir) {
    case DIR_LEFT: return 0;
    case DIR_RIGHT: return 1;
    case DIR_OVERHEAD: return 2;
    default: return -1; // Stab (or unknown) → no arrow
  }
}

/** Combat states where attack direction is shown actively */
const ATTACK_ACTIVE_STATES = new Set([1, 2]); // Windup, Release
/** Combat states where block direction is shown actively */
const BLOCK_ACTIVE_STATES = new Set([4, 5]); // Blocking, Parry

/** Color constants */
const COLOR_IDLE = 'rgba(255, 255, 255, 0.35)';
const COLOR_ATTACK = '#ff4444';
const COLOR_BLOCK = '#44aaff';
const COLOR_DIM = 'rgba(255, 255, 255, 0.12)';
const COLOR_STAB_IDLE = 'rgba(255, 255, 255, 0.25)';
const COLOR_STAB_ACTIVE = '#ff4444';
const COLOR_STAB_BLOCK = '#44aaff';

/** Arrow size/offset config */
const ARROW_SIZE = 8;
const ARROW_OFFSET = 18;

export class DirectionIndicator {
  private container: HTMLElement;
  /** [left, right, top] — Bottom wedge is gone in FSM v2 (#139). */
  private arrows: HTMLElement[] = [];
  private stabRing: HTMLElement;

  constructor() {
    // Container centered on screen (same as crosshair)
    this.container = document.createElement('div');
    this.container.id = 'direction-indicator';
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 11;
      width: 0;
      height: 0;
    `;

    // Three directional arrows as CSS triangles (Overhead/Left/Right).
    // Bottom wedge dropped in FSM v2 (#139).
    const configs: { dir: string; dx: number; dy: number; rotation: number }[] = [
      { dir: 'left',  dx: -ARROW_OFFSET, dy: 0,             rotation: 90  },
      { dir: 'right', dx:  ARROW_OFFSET, dy: 0,             rotation: 270 },
      { dir: 'top',   dx: 0,             dy: -ARROW_OFFSET, rotation: 180 },
    ];

    for (const cfg of configs) {
      const el = document.createElement('div');
      el.dataset.dir = cfg.dir;
      el.style.cssText = `
        position: absolute;
        left: ${cfg.dx - ARROW_SIZE / 2}px;
        top: ${cfg.dy - ARROW_SIZE / 2}px;
        width: 0;
        height: 0;
        border-left: ${ARROW_SIZE / 2}px solid transparent;
        border-right: ${ARROW_SIZE / 2}px solid transparent;
        border-bottom: ${ARROW_SIZE}px solid ${COLOR_DIM};
        transform: rotate(${cfg.rotation}deg);
        transition: border-bottom-color 0.08s ease;
      `;
      this.container.appendChild(el);
      this.arrows.push(el);
    }

    // Center stab ring
    this.stabRing = document.createElement('div');
    this.stabRing.dataset.dir = 'stab';
    const ringSize = 10;
    this.stabRing.style.cssText = `
      position: absolute;
      left: ${-ringSize / 2}px;
      top: ${-ringSize / 2}px;
      width: ${ringSize}px;
      height: ${ringSize}px;
      border: 1.5px solid ${COLOR_DIM};
      border-radius: 50%;
      transition: border-color 0.08s ease;
    `;
    this.container.appendChild(this.stabRing);

    document.body.appendChild(this.container);
  }

  /**
   * Update indicator state each frame.
   * @param playerEid - Player entity ID
   */
  update(playerEid: number): void {
    // Hide when pointer lock is not active (menus/inventory open)
    const locked = document.pointerLockElement != null;
    this.container.style.display = locked ? 'block' : 'none';
    if (!locked) return;

    // FSM v2 (#139): single unified `direction` field on CombatStateComp.
    // The semantic interpretation depends on `state` (block in defensive
    // states, attack otherwise), but the numeric value is already correct
    // for either — same enum, same numbers.
    const state = CombatStateComp.state[playerEid] ?? 0;
    const direction = CombatStateComp.direction[playerEid] ?? 0;

    const isAttackActive = ATTACK_ACTIVE_STATES.has(state);
    const isBlockActive = BLOCK_ACTIVE_STATES.has(state);
    const isIdle = state === 0; // CombatState.Idle

    // Pick highlight color for the active direction.
    let activeColor = COLOR_IDLE;
    if (isAttackActive) activeColor = COLOR_ATTACK;
    else if (isBlockActive) activeColor = COLOR_BLOCK;

    const showActive = isAttackActive || isBlockActive || isIdle;
    const isStab = direction === DIR_STAB;
    const arrowIdx = isStab ? -1 : arrowIndexForDirection(direction);

    // Update arrow colors. arrows[0]=left, arrows[1]=right, arrows[2]=top.
    for (let i = 0; i < this.arrows.length; i++) {
      this.arrows[i].style.borderBottomColor =
        showActive && i === arrowIdx ? activeColor : COLOR_DIM;
    }

    // Update stab ring. Three states: dim (not stab), idle (stab in Idle),
    // attack (stab in Windup/Release), block (stab in Blocking/Parry).
    if (showActive && isStab) {
      let stabColor = COLOR_STAB_IDLE;
      if (isAttackActive) stabColor = COLOR_STAB_ACTIVE;
      else if (isBlockActive) stabColor = COLOR_STAB_BLOCK;
      this.stabRing.style.borderColor = stabColor;
    } else {
      this.stabRing.style.borderColor = COLOR_DIM;
    }
  }

  /** Remove from DOM */
  dispose(): void {
    this.container.remove();
  }
}
