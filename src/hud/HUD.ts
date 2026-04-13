/**
 * HUD — Main HUD manager that owns all HUD sub-elements.
 *
 * Coordinates updates for:
 * - Health bar
 * - Stamina bar
 * - FSM state label (togglable with F4)
 * - FPS counter (togglable, top-right)
 * - Crosshair (CSS-only, always visible)
 *
 * All HUD elements are HTML overlays with pointer-events: none.
 */

import { Health, Stamina, CombatStateComponent } from '../ecs/components';
import { COMBAT_STATE_NAMES } from '../combat/states';
import { fsmRegistry } from '../combat/CombatFSM';
import { HealthBar } from './HealthBar';
import { StaminaBar } from './StaminaBar';

/** Direction names for debug display */
const ATTACK_DIR_NAMES: Record<number, string> = {
  0: 'Left', 1: 'Right', 2: 'Overhead', 3: 'Underhand', 4: 'Stab',
};
const BLOCK_DIR_NAMES: Record<number, string> = {
  0: 'Left', 1: 'Right', 2: 'Top', 3: 'Bottom',
};

export class HUD {
  private healthBar: HealthBar;
  private staminaBar: StaminaBar;

  // FSM state label
  private fsmLabel: HTMLElement;
  private fsmVisible = false;

  // FPS counter
  private fpsEl: HTMLElement;
  private fpsVisible = true;
  private fpsSmoothed = 60;
  /** Exponential moving average smoothing factor (higher = more responsive) */
  private readonly fpsSmoothAlpha = 0.1;

  constructor() {
    this.healthBar = new HealthBar();
    this.staminaBar = new StaminaBar();

    // FSM state label (toggled with F4)
    this.fsmLabel = document.createElement('div');
    this.fsmLabel.id = 'fsm-state-label';
    this.fsmLabel.style.cssText = `
      position: fixed;
      top: 40px;
      left: 50%;
      transform: translateX(-50%);
      color: #ff0;
      font-family: monospace;
      font-size: 14px;
      z-index: 10;
      pointer-events: none;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
      display: none;
    `;
    document.body.appendChild(this.fsmLabel);

    // FPS counter (top-right, reuse existing #camera-mode-indicator style area)
    this.fpsEl = document.createElement('div');
    this.fpsEl.id = 'fps-counter';
    this.fpsEl.style.cssText = `
      position: fixed;
      top: 24px;
      right: 8px;
      color: #0f0;
      font-family: monospace;
      font-size: 12px;
      z-index: 10;
      pointer-events: none;
    `;
    document.body.appendChild(this.fpsEl);

    // Listen for F4 toggle
    this._onKeyDown = this._onKeyDown.bind(this);
    document.addEventListener('keydown', this._onKeyDown);
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'F4') {
      e.preventDefault();
      this.fsmVisible = !this.fsmVisible;
      this.fsmLabel.style.display = this.fsmVisible ? 'block' : 'none';
    }
  }

  /**
   * Update HUD every frame.
   * @param dt - Frame delta time in seconds
   * @param playerEntity - Player entity ID
   */
  update(dt: number, playerEntity: number): void {
    // Update health bar
    const hp = Health.current[playerEntity];
    const hpMax = Health.max[playerEntity];
    if (hpMax !== undefined && hpMax > 0) {
      this.healthBar.update(hp, hpMax);
    }

    // Update stamina bar
    const stam = Stamina.current[playerEntity];
    const stamMax = Stamina.max[playerEntity];
    if (stamMax !== undefined && stamMax > 0) {
      this.staminaBar.update(stam, stamMax);
    }

    // Update FSM state label (enhanced with turncap + direction)
    if (this.fsmVisible) {
      const stateNum = CombatStateComponent.state[playerEntity] ?? 0;
      const stateName = COMBAT_STATE_NAMES[stateNum] ?? 'Unknown';
      const ticksLeft = CombatStateComponent.ticksRemaining[playerEntity] ?? 0;
      const atkDir = CombatStateComponent.attackDirection[playerEntity] ?? 0;
      const blkDir = CombatStateComponent.blockDirection[playerEntity] ?? 0;

      const fsm = fsmRegistry.get(playerEntity);
      const turncap = fsm ? fsm.getCurrentTurncap() : Infinity;
      const turncapStr = turncap === Infinity ? 'none' : `${(turncap * 60).toFixed(1)} rad/s`;
      const dirStr = stateNum >= 4 && stateNum <= 5
        ? `Block: ${BLOCK_DIR_NAMES[blkDir] ?? blkDir}`
        : `Atk: ${ATTACK_DIR_NAMES[atkDir] ?? atkDir}`;

      this.fsmLabel.textContent =
        `${stateName} [${ticksLeft}] | ${dirStr} | Cap: ${turncapStr}`;
    }

    // Update FPS counter (exponential moving average)
    if (dt > 0) {
      const instantFps = 1 / dt;
      this.fpsSmoothed =
        this.fpsSmoothed + this.fpsSmoothAlpha * (instantFps - this.fpsSmoothed);
    }
    if (this.fpsVisible) {
      this.fpsEl.textContent = `${Math.round(this.fpsSmoothed)} FPS`;
    }
  }

  /** Toggle FPS counter visibility */
  toggleFps(): void {
    this.fpsVisible = !this.fpsVisible;
    this.fpsEl.style.display = this.fpsVisible ? 'block' : 'none';
  }

  /** Clean up DOM elements and event listeners */
  dispose(): void {
    document.removeEventListener('keydown', this._onKeyDown);
    this.healthBar.dispose();
    this.staminaBar.dispose();
    this.fsmLabel.remove();
    this.fpsEl.remove();
  }
}
