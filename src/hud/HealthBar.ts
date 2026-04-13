/**
 * HealthBar — HTML overlay showing current/max health.
 *
 * Color-coded: green (>60%) → yellow (30-60%) → red (<30%).
 * Uses simple CSS width transitions for smooth animation.
 */

export class HealthBar {
  private container: HTMLElement;
  private fill: HTMLElement;
  private label: HTMLElement;

  constructor() {
    // Create container
    this.container = document.createElement('div');
    this.container.id = 'health-bar';
    this.container.style.cssText = `
      position: fixed;
      bottom: 40px;
      left: 50%;
      transform: translateX(-50%);
      width: 200px;
      height: 16px;
      background: rgba(0, 0, 0, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.3);
      z-index: 10;
      pointer-events: none;
    `;

    // Create fill bar
    this.fill = document.createElement('div');
    this.fill.style.cssText = `
      width: 100%;
      height: 100%;
      background: #44cc44;
      transition: width 0.15s ease-out;
    `;
    this.container.appendChild(this.fill);

    // Create label
    this.label = document.createElement('div');
    this.label.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-family: monospace;
      font-size: 10px;
      text-shadow: 1px 1px 1px rgba(0,0,0,0.8);
    `;
    this.container.appendChild(this.label);

    document.body.appendChild(this.container);
  }

  /** Update health bar display */
  update(current: number, max: number): void {
    const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    this.fill.style.width = `${pct * 100}%`;

    // Color coding
    if (pct > 0.6) {
      this.fill.style.background = '#44cc44'; // green
    } else if (pct > 0.3) {
      this.fill.style.background = '#cccc44'; // yellow
    } else {
      this.fill.style.background = '#cc4444'; // red
    }

    this.label.textContent = `${Math.ceil(current)} / ${Math.ceil(max)}`;
  }

  /** Remove from DOM */
  dispose(): void {
    this.container.remove();
  }
}
