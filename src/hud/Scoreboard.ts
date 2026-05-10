/**
 * Scoreboard — persistent K/D/Gold display for the local player.
 *
 * Reads the player's `Score` component (`kills`, `deaths`, `goldThisLife`)
 * each frame. Tab-key full scoreboard with all players is OUT OF SCOPE
 * here — that's deferred to #98.
 *
 * Positioning sits below the existing top-left HUD elements (e.g. health bar
 * at bottom-center, but the player-status HUD will eventually live up here).
 * Z-index 10 keeps it above the world but below modal overlays (200+) and
 * below the death screen (50).
 *
 * Defensive: if the player entity has no `Score` component (test fixtures
 * sometimes skip it) the scoreboard renders the empty placeholder string
 * rather than crashing on a TypedArray read.
 *
 * Issue #137. Part of #93. Design doc: `docs/spawn-death-respawn.md`.
 */

import { hasComponent } from 'bitecs';
import { Score } from '../ecs/components';
import type { GameWorld } from '../core/types';

const PLACEHOLDER = 'K: 0  D: 0  Gold: 0';

export class Scoreboard {
  private container: HTMLElement;
  private label: HTMLElement;
  /** Cached values to avoid touching the DOM every frame when nothing changed. */
  private lastKills = -1;
  private lastDeaths = -1;
  private lastGold = -1;

  constructor(private world: GameWorld) {
    this.container = document.createElement('div');
    this.container.id = 'scoreboard';
    this.container.style.cssText = `
      position: fixed;
      top: 16px;
      left: 16px;
      padding: 4px 10px;
      background: rgba(0, 0, 0, 0.55);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 3px;
      color: #fff;
      font-family: monospace;
      font-size: 13px;
      z-index: 10;
      pointer-events: none;
      text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.85);
      white-space: pre;
    `;
    this.label = document.createElement('span');
    this.label.textContent = PLACEHOLDER;
    this.container.appendChild(this.label);
    document.body.appendChild(this.container);
  }

  /** Per-frame update. Reads the player's Score component; cheap when stale. */
  update(): void {
    const playerEid = this.world.playerEntity;
    if (playerEid === 0 || !hasComponent(this.world.ecs, Score, playerEid)) {
      // No player or no Score component yet — keep the placeholder visible.
      // This also covers the brief boot window between world creation and
      // createPlayer() in main.ts.
      if (this.lastKills !== -1 || this.lastDeaths !== -1 || this.lastGold !== -1) {
        this.lastKills = -1;
        this.lastDeaths = -1;
        this.lastGold = -1;
        this.label.textContent = PLACEHOLDER;
      }
      return;
    }
    const k = Score.kills[playerEid];
    const d = Score.deaths[playerEid];
    const g = Score.goldThisLife[playerEid];
    if (k === this.lastKills && d === this.lastDeaths && g === this.lastGold) {
      return;
    }
    this.lastKills = k;
    this.lastDeaths = d;
    this.lastGold = g;
    this.label.textContent = `K: ${k}  D: ${d}  Gold: ${g}`;
  }

  /** Test helper: currently-rendered text. */
  get text(): string {
    return this.label.textContent ?? '';
  }

  dispose(): void {
    this.container.remove();
  }
}
