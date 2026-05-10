/**
 * HUD — Main HUD manager that owns all HUD sub-elements.
 *
 * Coordinates updates for:
 * - Health bar
 * - Stamina bar
 * - FPS counter (togglable, top-right)
 * - Crosshair (CSS-only, always visible)
 *
 * Note: F4 / FSM debug overlay is owned by `src/rendering/DebugRenderer.ts`
 * (issue #172 deleted the duplicate F4 handler that lived here).
 *
 * All HUD elements are HTML overlays with pointer-events: none.
 */

import { Health, Stamina } from '../ecs/components';
import { HealthBar } from './HealthBar';
import { StaminaBar } from './StaminaBar';
import { DirectionIndicator } from './DirectionIndicator';
import { GoldCounter } from './GoldCounter';
import { DeathScreen } from './DeathScreen';
import { Killfeed } from './Killfeed';
import { Scoreboard } from './Scoreboard';
import { theme } from './theme';
import type { GameWorld } from '../core/types';

export class HUD {
  private healthBar: HealthBar;
  private staminaBar: StaminaBar;
  private dirIndicator: DirectionIndicator;
  private goldCounter: GoldCounter;

  /**
   * Spawn/death/respawn HUD modules (issue #137). Instantiated only when a
   * `GameWorld` is supplied at construction time — they need world.ecs +
   * world.playerEntity for ECS reads and EventBus subscription. Older HUD
   * tests (and any other caller that omits `world`) get a HUD without these
   * three overlays.
   */
  private deathScreen: DeathScreen | null = null;
  private killfeed: Killfeed | null = null;
  private scoreboard: Scoreboard | null = null;

  // FPS counter
  private fpsEl: HTMLElement;
  private fpsVisible = true;
  private fpsSmoothed = 60;
  /** Exponential moving average smoothing factor (higher = more responsive) */
  private readonly fpsSmoothAlpha = 0.1;

  /**
   * @param world - Optional GameWorld. When provided, HUD instantiates
   *   `DeathScreen`, `Killfeed`, and `Scoreboard` (issue #137). When omitted
   *   (legacy callers / unit tests that don't need them), those overlays
   *   are skipped — the rest of the HUD continues to work.
   */
  constructor(world?: GameWorld) {
    this.healthBar = new HealthBar();
    this.staminaBar = new StaminaBar();
    this.dirIndicator = new DirectionIndicator();
    this.goldCounter = new GoldCounter();
    if (world) {
      this.deathScreen = new DeathScreen(world);
      this.killfeed = new Killfeed(world);
      this.scoreboard = new Scoreboard(world);
    }

    // FPS counter (top-right, reuse existing #camera-mode-indicator style area)
    this.fpsEl = document.createElement('div');
    this.fpsEl.id = 'fps-counter';
    this.fpsEl.style.cssText = `
      position: fixed;
      top: 24px;
      right: 8px;
      color: ${theme.status.good};
      font-family: ${theme.font};
      font-size: 12px;
      z-index: ${theme.z.hud};
      pointer-events: none;
    `;
    document.body.appendChild(this.fpsEl);
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

    // Update directional crosshair indicator
    this.dirIndicator.update(playerEntity);

    // Spawn/death/respawn overlays (issue #137). Each call is a no-op when
    // its respective state is unchanged — DeathScreen only writes the DOM
    // when DeadTag toggles or the integer-second countdown ticks; Killfeed
    // only walks live entries; Scoreboard caches its last K/D/Gold tuple.
    if (this.deathScreen) this.deathScreen.update();
    if (this.killfeed) this.killfeed.update();
    if (this.scoreboard) this.scoreboard.update();

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
    this.healthBar.dispose();
    this.staminaBar.dispose();
    this.dirIndicator.dispose();
    this.goldCounter.dispose();
    if (this.deathScreen) this.deathScreen.dispose();
    if (this.killfeed) this.killfeed.dispose();
    if (this.scoreboard) this.scoreboard.dispose();
    this.fpsEl.remove();
  }
}
