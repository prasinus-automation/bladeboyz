import { COMBAT_STATE_NAMES } from '../combat/states';
import type { CombatFSM } from '../combat/CombatFSM';

const DIRECTION_NAMES: Record<number, string> = {
  0: 'None',
  1: 'Left',
  2: 'Right',
  3: 'Overhead',
  4: 'Stab',
};

/**
 * F4-toggled debug overlay showing combat FSM state.
 * Pure HTML overlay — no Three.js sprites (per AGENTS.md spec).
 */
export class DebugOverlay {
  private container: HTMLDivElement;
  private visible = false;
  private fsm: CombatFSM | null = null;
  private fpsCounter = 0;
  private fpsDisplay = 0;
  private fpsTimer = 0;

  // DOM refs
  private stateEl: HTMLSpanElement;
  private ticksEl: HTMLSpanElement;
  private turncapEl: HTMLSpanElement;
  private directionEl: HTMLSpanElement;
  private fpsEl: HTMLSpanElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'debug-overlay';
    this.container.style.cssText = `
      position: fixed;
      top: 8px;
      left: 8px;
      background: rgba(0, 0, 0, 0.75);
      color: #0f0;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      padding: 8px 12px;
      border-radius: 4px;
      z-index: 9999;
      display: none;
      line-height: 1.6;
      pointer-events: none;
    `;

    this.stateEl = this.createRow('State');
    this.ticksEl = this.createRow('Ticks');
    this.turncapEl = this.createRow('Turncap');
    this.directionEl = this.createRow('Direction');
    this.fpsEl = this.createRow('FPS');

    document.body.appendChild(this.container);

    // F4 toggle
    document.addEventListener('keydown', this.onKeyDown);
  }

  /** Set the FSM to display */
  setFSM(fsm: CombatFSM): void {
    this.fsm = fsm;
  }

  /** Call every frame to update display */
  update(dt: number): void {
    // FPS counting
    this.fpsCounter++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 1) {
      this.fpsDisplay = this.fpsCounter;
      this.fpsCounter = 0;
      this.fpsTimer -= 1;
    }

    if (!this.visible || !this.fsm) return;

    const state = this.fsm.getCurrentState();
    const ticks = this.fsm.getTicksRemaining();
    const turncap = this.fsm.getCurrentTurncap();
    const dir = this.fsm.getAttackDirection();

    this.stateEl.textContent = COMBAT_STATE_NAMES[state] ?? `Unknown(${state})`;
    this.ticksEl.textContent = `${ticks}`;
    this.turncapEl.textContent = turncap >= 100 ? '∞' : `${(turncap * 60).toFixed(1)} rad/s`;
    this.directionEl.textContent = DIRECTION_NAMES[dir] ?? `Unknown(${dir})`;
    this.fpsEl.textContent = `${this.fpsDisplay}`;
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.container.remove();
  }

  // ── Private ─────────────────────────────────────────────

  private createRow(label: string): HTMLSpanElement {
    const row = document.createElement('div');
    const labelSpan = document.createElement('span');
    labelSpan.style.color = '#888';
    labelSpan.textContent = `${label}: `;
    const valueSpan = document.createElement('span');
    valueSpan.textContent = '—';
    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    this.container.appendChild(row);
    return valueSpan;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F4') {
      e.preventDefault();
      this.visible = !this.visible;
      this.container.style.display = this.visible ? 'block' : 'none';
    }
  };
}
