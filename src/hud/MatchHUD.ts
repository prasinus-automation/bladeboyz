/**
 * MatchHUD — multiplayer match chrome: the top-center countdown timer, the
 * hold-Tab scoreboard, and the match-end standings overlay.
 *
 * Pure consumer of `NetworkSystem.matchState` (polled each render frame —
 * the payloads are tiny and DOM writes are diffed). Hidden entirely
 * outside multiplayer mode.
 */

import { theme } from './theme';
import type { MatchState } from '../net/NetworkSystem';

export class MatchHUD {
  private timerEl: HTMLDivElement;
  private boardEl: HTMLDivElement;
  private endEl: HTMLDivElement;
  private tabHeld = false;
  private active = false;
  private lastTimerText = '';
  private lastBoardHtml = '';
  private lastEndHtml = '';
  private keydown: (e: KeyboardEvent) => void;
  private keyup: (e: KeyboardEvent) => void;

  constructor(private getState: () => MatchState | null) {
    this.timerEl = document.createElement('div');
    this.timerEl.id = 'match-timer';
    this.timerEl.style.cssText = `
      position: fixed;
      top: 12px; left: 50%;
      transform: translateX(-50%);
      font-family: ${theme.font};
      font-size: 22px;
      letter-spacing: 3px;
      color: ${theme.text.primary};
      background: ${theme.bg.panel};
      border: 1px solid ${theme.border.default};
      padding: 6px 18px;
      z-index: ${theme.z.hud};
      display: none;
      pointer-events: none;
    `;
    document.body.appendChild(this.timerEl);

    this.boardEl = document.createElement('div');
    this.boardEl.id = 'match-scoreboard';
    this.boardEl.style.cssText = `
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      min-width: 380px;
      font-family: ${theme.font};
      font-size: 15px;
      color: ${theme.text.primary};
      background: ${theme.bg.panel};
      border: 1px solid ${theme.border.accent};
      padding: 16px 24px;
      z-index: ${theme.z.hud + 5};
      display: none;
      pointer-events: none;
    `;
    document.body.appendChild(this.boardEl);

    this.endEl = document.createElement('div');
    this.endEl.id = 'match-end';
    this.endEl.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      font-family: ${theme.font};
      color: ${theme.text.primary};
      background: rgba(0, 0, 0, 0.65);
      z-index: 60;
      pointer-events: none;
    `;
    document.body.appendChild(this.endEl);

    // Hold-Tab scoreboard. preventDefault so the browser doesn't move
    // focus out of the canvas while pointer-locked.
    this.keydown = (e: KeyboardEvent) => {
      if (e.code === 'Tab' && this.active) {
        e.preventDefault();
        this.tabHeld = true;
      }
    };
    this.keyup = (e: KeyboardEvent) => {
      if (e.code === 'Tab') this.tabHeld = false;
    };
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
  }

  /** Toggle multiplayer chrome on/off (mode switches). */
  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.timerEl.style.display = 'none';
      this.boardEl.style.display = 'none';
      this.endEl.style.display = 'none';
      this.tabHeld = false;
    }
  }

  update(): void {
    if (!this.active) return;
    const state = this.getState();
    if (!state) return;

    // ── Timer ──
    const total = Math.max(0, Math.ceil(state.remainingMs / 1000));
    const mm = Math.floor(total / 60);
    const ss = String(total % 60).padStart(2, '0');
    const timerText = state.live
      ? `${mm}:${ss}`
      : state.finalStandings
        ? `NEXT MATCH ${mm}:${ss}`
        : `${mm}:${ss}`;
    const full = state.connected ? timerText : 'CONNECTING…';
    if (full !== this.lastTimerText) {
      this.lastTimerText = full;
      this.timerEl.textContent = full;
    }
    this.timerEl.style.display = 'block';

    // ── Scoreboard (hold Tab) ──
    if (this.tabHeld && !state.finalStandings) {
      const html = this.renderBoard('SCOREBOARD', state);
      if (html !== this.lastBoardHtml) {
        this.lastBoardHtml = html;
        this.boardEl.innerHTML = html;
      }
      this.boardEl.style.display = 'block';
    } else {
      this.boardEl.style.display = 'none';
    }

    // ── Match end ──
    if (state.finalStandings) {
      const html =
        `<div style="font-size:32px;letter-spacing:6px;border-bottom:2px solid ${theme.border.accent};padding-bottom:8px;">MATCH OVER</div>` +
        `<div style="background:${theme.bg.panel};border:1px solid ${theme.border.default};padding:16px 24px;min-width:380px;">${this.rows(
          state.finalStandings,
          state.myNetId,
        )}</div>` +
        `<div style="font-size:14px;color:${theme.text.muted};">next match starting…</div>`;
      if (html !== this.lastEndHtml) {
        this.lastEndHtml = html;
        this.endEl.innerHTML = html;
      }
      this.endEl.style.display = 'flex';
    } else {
      this.endEl.style.display = 'none';
    }
  }

  private renderBoard(title: string, state: MatchState): string {
    return (
      `<div style="font-size:18px;letter-spacing:4px;border-bottom:1px solid ${theme.border.accent};padding-bottom:6px;margin-bottom:8px;">${title}</div>` +
      this.rows(state.scores, state.myNetId)
    );
  }

  private rows(
    rows: Array<{ id: string; name: string; kills: number; deaths: number }>,
    myId: string,
  ): string {
    const header = `<div style="display:flex;justify-content:space-between;color:${theme.text.muted};font-size:12px;letter-spacing:2px;"><span>PLAYER</span><span>K / D</span></div>`;
    const body = rows
      .map((r) => {
        const me = r.id === myId;
        const esc = r.name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return `<div style="display:flex;justify-content:space-between;gap:24px;padding:3px 0;${
          me ? `color:${theme.text.accent};font-weight:bold;` : ''
        }"><span>${esc}${me ? ' (you)' : ''}</span><span>${r.kills} / ${r.deaths}</span></div>`;
      })
      .join('');
    return header + body;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    this.timerEl.remove();
    this.boardEl.remove();
    this.endEl.remove();
  }
}
