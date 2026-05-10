/**
 * Killfeed — top-right stack of recent kills.
 *
 * Subscribes to `DeathEvent` on the EventBus. Each entry shows
 * `<killerName> <weapon> <victimName>` with the weapon name in italic. For
 * suicides (killerEid === 0) the line is `<victimName> died`.
 *
 * Entries fade out after ENTRY_LIFE_MS (5 s) via a CSS opacity transition;
 * we set a `fading` class once the fade window opens, then hard-remove the
 * DOM node after the fade completes. The visible cap is MAX_VISIBLE (5) — a
 * 6th arriving entry evicts the oldest immediately.
 *
 * Pure event-driven: no per-frame ECS reads. `update()` only walks the entry
 * list to evict stale ones — call from the HUD render loop.
 *
 * Issue #137. Part of #93. Design doc: `docs/spawn-death-respawn.md`.
 */

import { EventBus } from '../events/EventBus';
import type { DeathEventPayload } from '../events/types';
import { getDisplayName } from './DeathScreen';
import type { GameWorld } from '../core/types';
import { weaponIdToName } from '../ecs/systems/CombatSystem';

/** How long a fresh entry stays at full opacity, in ms. */
export const ENTRY_LIFE_MS = 5000;
/** Fade duration after `ENTRY_LIFE_MS` elapses, in ms. */
export const FADE_DURATION_MS = 500;
/** Max simultaneously-visible entries. A new entry beyond this evicts the oldest. */
export const MAX_VISIBLE = 5;

interface KillfeedEntry {
  el: HTMLElement;
  /** Wall-clock ms when the entry was created. */
  createdAt: number;
  /** Whether the CSS `fading` style has been applied. */
  faded: boolean;
}

export class Killfeed {
  private container: HTMLElement;
  private entries: KillfeedEntry[] = [];
  private unsubDeath: () => void;
  /** `performance.now`-style clock; injectable for tests. */
  private now: () => number;

  constructor(private world: GameWorld, options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => performance.now());

    this.container = document.createElement('div');
    this.container.id = 'killfeed';
    this.container.style.cssText = `
      position: fixed;
      top: 80px;
      right: 16px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      pointer-events: none;
      z-index: 11;
      font-family: monospace;
      font-size: 13px;
      color: #fff;
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.85);
    `;
    document.body.appendChild(this.container);

    this.unsubDeath = EventBus.on('DeathEvent', (payload: DeathEventPayload) => {
      this.appendEntry(payload);
    });
  }

  private appendEntry(payload: DeathEventPayload): void {
    const victim = getDisplayName(this.world, payload.victimEid);
    const killer = getDisplayName(this.world, payload.killerEid);

    const el = document.createElement('div');
    el.className = 'killfeed-entry';
    el.style.cssText = `
      padding: 3px 8px;
      background: rgba(0, 0, 0, 0.55);
      border-left: 2px solid #f88;
      border-radius: 2px;
      opacity: 1;
      transition: opacity ${FADE_DURATION_MS}ms ease-out;
    `;

    if (payload.killerEid === 0) {
      // Suicide / environmental death.
      el.textContent = `${victim} died`;
    } else {
      const weaponName =
        weaponIdToName[payload.weaponId] ?? 'unknown weapon';
      // Render killer + italic weapon + victim. Each piece is a separate
      // node so the text content is structured for tests / assistive tech.
      const killerSpan = document.createElement('span');
      killerSpan.className = 'killfeed-killer';
      killerSpan.textContent = killer;
      const weaponSpan = document.createElement('em');
      weaponSpan.className = 'killfeed-weapon';
      weaponSpan.style.cssText = 'margin: 0 6px; color: #ffd24a; font-style: italic;';
      weaponSpan.textContent = weaponName;
      const victimSpan = document.createElement('span');
      victimSpan.className = 'killfeed-victim';
      victimSpan.textContent = victim;
      el.appendChild(killerSpan);
      el.appendChild(weaponSpan);
      el.appendChild(victimSpan);
    }

    this.container.appendChild(el);
    this.entries.push({ el, createdAt: this.now(), faded: false });

    // Enforce max-visible cap. A 6th entry evicts the oldest IMMEDIATELY
    // (no fade) — stay at exactly MAX_VISIBLE in the DOM.
    while (this.entries.length > MAX_VISIBLE) {
      const oldest = this.entries.shift()!;
      oldest.el.remove();
    }
  }

  /**
   * Per-frame update. Promotes expired entries to `fading`, then removes any
   * that have fully faded. Cheap when nothing changed — no DOM writes.
   */
  update(): void {
    if (this.entries.length === 0) return;
    const t = this.now();

    // Walk in array order; we only ever remove from the front of the list
    // because entries are appended in chronological order.
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const age = t - entry.createdAt;
      if (!entry.faded && age >= ENTRY_LIFE_MS) {
        entry.faded = true;
        entry.el.style.opacity = '0';
      }
    }

    // Garbage-collect entries past full-fade. Splice from the front.
    while (
      this.entries.length > 0 &&
      t - this.entries[0].createdAt >= ENTRY_LIFE_MS + FADE_DURATION_MS
    ) {
      const expired = this.entries.shift()!;
      expired.el.remove();
    }
  }

  /** Visible-entry count (test helper). */
  get entryCount(): number {
    return this.entries.length;
  }

  /** Test helper: read the rendered text of all live entries in order. */
  get entryTexts(): string[] {
    return this.entries.map((e) => e.el.textContent ?? '');
  }

  dispose(): void {
    this.unsubDeath();
    for (const entry of this.entries) entry.el.remove();
    this.entries.length = 0;
    this.container.remove();
  }
}
