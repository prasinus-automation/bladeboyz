/**
 * GoldCounter — top-right HUD display showing the player's gold balance.
 *
 * Subscribes to `Wallet.onGoldChange` in the constructor; unsubscribes on
 * `dispose()`. Inline-styled per the existing HUD convention (see HealthBar).
 *
 * Positioned ~16px from the right edge and just below the small debug
 * indicators (camera mode + FPS) that already live at the very top-right.
 * z-index 10 keeps it above the world but below modal overlays
 * (InventoryPanel uses z-index 200+).
 *
 * A brief color pulse on change makes the counter feel responsive without
 * introducing a heavyweight tween library.
 */
import { getGold, onGoldChange } from '../economy/Wallet';

const NORMAL_COLOR = '#ffd24a';
const PULSE_COLOR = '#fff7c0';
const PULSE_DURATION_MS = 150;

export class GoldCounter {
  private container: HTMLElement;
  private label: HTMLElement;
  private unsubscribe: () => void;
  private pulseTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'gold-counter';
    this.container.style.cssText = `
      position: fixed;
      top: 48px;
      right: 16px;
      padding: 4px 10px;
      background: rgba(0, 0, 0, 0.55);
      border: 1px solid rgba(255, 210, 74, 0.5);
      border-radius: 3px;
      color: ${NORMAL_COLOR};
      font-family: monospace;
      font-size: 14px;
      font-weight: bold;
      z-index: 10;
      pointer-events: none;
      text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.8);
      transition: color ${PULSE_DURATION_MS}ms ease-out;
    `;

    this.label = document.createElement('span');
    this.container.appendChild(this.label);
    document.body.appendChild(this.container);

    // Render initial value
    this.render(getGold());

    // Subscribe; remember the unsubscribe fn so dispose() can detach cleanly
    this.unsubscribe = onGoldChange((newBalance) => {
      this.render(newBalance);
      this.pulse();
    });
  }

  private render(gold: number): void {
    this.label.textContent = `Gold: ${gold}`;
  }

  private pulse(): void {
    this.container.style.color = PULSE_COLOR;
    if (this.pulseTimeout !== null) {
      clearTimeout(this.pulseTimeout);
    }
    this.pulseTimeout = setTimeout(() => {
      this.container.style.color = NORMAL_COLOR;
      this.pulseTimeout = null;
    }, PULSE_DURATION_MS);
  }

  /** Remove from DOM and stop listening to wallet changes. */
  dispose(): void {
    this.unsubscribe();
    if (this.pulseTimeout !== null) {
      clearTimeout(this.pulseTimeout);
      this.pulseTimeout = null;
    }
    this.container.remove();
  }
}
