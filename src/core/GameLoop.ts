import type { GameLoopCallbacks } from './types';

/** Fixed tick rate in Hz */
export const TICK_RATE = 60;

/** Duration of one fixed tick in seconds */
export const TICK_DURATION = 1 / TICK_RATE;

/** Duration of one fixed tick in milliseconds */
const TICK_DURATION_MS = 1000 / TICK_RATE;

/** Maximum accumulated time before clamping (spiral-of-death protection) */
const MAX_ACCUMULATOR_MS = TICK_DURATION_MS * 8;

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  private callbacks: GameLoopCallbacks;

  constructor(callbacks: GameLoopCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame((t) => this.loop(t));
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private loop(timestamp: number): void {
    if (!this.running) return;

    let frameTime = timestamp - this.lastTime;
    this.lastTime = timestamp;

    // Spiral-of-death protection: clamp max accumulated time
    if (frameTime > MAX_ACCUMULATOR_MS) {
      frameTime = MAX_ACCUMULATOR_MS;
    }

    this.accumulator += frameTime;

    // Fixed timestep updates at 60Hz
    while (this.accumulator >= TICK_DURATION_MS) {
      this.callbacks.fixedUpdate(TICK_DURATION);
      this.accumulator -= TICK_DURATION_MS;
    }

    // Interpolation factor for smooth rendering
    const alpha = this.accumulator / TICK_DURATION_MS;

    // Variable-rate update
    this.callbacks.update(frameTime / 1000);

    // Render with interpolation
    this.callbacks.render(alpha);

    this.rafId = requestAnimationFrame((t) => this.loop(t));
  }
}
