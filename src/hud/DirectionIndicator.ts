/**
 * DirectionIndicator — Mordhau-style compass-rose overlay around the crosshair.
 *
 * Shows 4 cardinal direction wedges (Left, Right, Overhead, Underhand) plus a
 * center ring for Stab. Highlights the active direction based on combat state:
 *   - Idle: dim white preview of current mouse-detected direction
 *   - Windup/Release: red/orange highlight on committed attack direction
 *   - Block/ParryWindow: blue/cyan highlight on committed block direction
 *
 * Hidden when pointer lock is released (inventory/menus open).
 * All elements are HTML/CSS with pointer-events: none.
 */

import { CombatStateComponent } from '../ecs/components';

// Direction enums are const enum so we duplicate the numeric values here
// to avoid import issues (const enums are erased at compile time).
// AttackDirection: Left=0, Right=1, Overhead=2, Underhand=3, Stab=4
// BlockDirection: Left=0, Right=1, Top=2, Bottom=3
// CombatState: Idle=0, Windup=1, Release=2, Recovery=3, Block=4, ParryWindow=5,
//              Riposte=6, Feint=7, Clash=8, Stunned=9, HitStun=10

const enum DirIndex {
  Left = 0,
  Right = 1,
  Top = 2,    // Overhead (attack) / Top (block)
  Bottom = 3, // Underhand (attack) / Bottom (block)
}

/** Combat states where attack direction is shown actively */
const ATTACK_ACTIVE_STATES = new Set([1, 2]); // Windup, Release
/** Combat states where block direction is shown actively */
const BLOCK_ACTIVE_STATES = new Set([4, 5]); // Block, ParryWindow

/** Color constants */
const COLOR_IDLE = 'rgba(255, 255, 255, 0.35)';
const COLOR_ATTACK = '#ff4444';
const COLOR_BLOCK = '#44aaff';
const COLOR_DIM = 'rgba(255, 255, 255, 0.12)';
const COLOR_STAB_IDLE = 'rgba(255, 255, 255, 0.25)';
const COLOR_STAB_ACTIVE = '#ff4444';

/** Arrow size/offset config */
const ARROW_SIZE = 8;
const ARROW_OFFSET = 18;

export class DirectionIndicator {
  private container: HTMLElement;
  private arrows: HTMLElement[] = []; // [left, right, top, bottom]
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

    // Create 4 directional arrows as CSS triangles
    const configs: { dir: string; dx: number; dy: number; rotation: number }[] = [
      { dir: 'left',   dx: -ARROW_OFFSET, dy: 0,             rotation: 90  },
      { dir: 'right',  dx:  ARROW_OFFSET, dy: 0,             rotation: 270 },
      { dir: 'top',    dx: 0,             dy: -ARROW_OFFSET,  rotation: 180 },
      { dir: 'bottom', dx: 0,             dy:  ARROW_OFFSET,  rotation: 0   },
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

    const state = CombatStateComponent.state[playerEid] ?? 0;
    const atkDir = CombatStateComponent.attackDirection[playerEid] ?? 0;
    const blkDir = CombatStateComponent.blockDirection[playerEid] ?? 0;

    const isAttackActive = ATTACK_ACTIVE_STATES.has(state);
    const isBlockActive = BLOCK_ACTIVE_STATES.has(state);
    const isIdle = state === 0; // CombatState.Idle

    // Determine which direction index is active and what color to use
    let activeDir = -1;
    let activeColor = COLOR_IDLE;
    let isStab = false;

    if (isAttackActive) {
      // Attack: map AttackDirection to arrow index or stab
      if (atkDir === 4) {
        // Stab
        isStab = true;
      } else {
        activeDir = atkDir; // Left=0, Right=1, Overhead=2, Underhand=3 maps directly
      }
      activeColor = COLOR_ATTACK;
    } else if (isBlockActive) {
      // Block: map BlockDirection to arrow index
      activeDir = blkDir; // Left=0, Right=1, Top=2, Bottom=3 maps directly
      activeColor = COLOR_BLOCK;
    } else if (isIdle) {
      // Idle preview from current attack direction
      if (atkDir === 4) {
        isStab = true;
      } else {
        activeDir = atkDir;
      }
      activeColor = COLOR_IDLE;
    }

    // Update arrow colors
    for (let i = 0; i < 4; i++) {
      const arrow = this.arrows[i];
      if (i === activeDir) {
        arrow.style.borderBottomColor = activeColor;
      } else {
        arrow.style.borderBottomColor = COLOR_DIM;
      }
    }

    // Update stab ring
    if (isStab) {
      const stabColor = isAttackActive ? COLOR_STAB_ACTIVE : COLOR_STAB_IDLE;
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
