import { FIXED_TIMESTEP, MAX_SUBSTEPS } from './types';

export type FixedUpdateFn = (dt: number) => void;
export type UpdateFn = (dt: number) => void;
export type RenderFn = (alpha: number) => void;

/**
 * Fixed-timestep game loop with variable-rate rendering.
 * - fixedUpdate runs at 60Hz for deterministic physics/combat
 * - update runs at frame rate for animation blending
 * - render runs at frame rate with interpolation alpha
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private rafId = 0;

  public fixedUpdate: FixedUpdateFn = () => {};
  public update: UpdateFn = () => {};
  public render: RenderFn = () => {};
  public onFrameEnd: () => void = () => {};

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now() / 1000;
    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick(nowMs: number): void {
    if (!this.running) return;

    const now = nowMs / 1000;
    let frameTime = now - this.lastTime;
    this.lastTime = now;

    // Clamp large frame times (e.g. after tab switch)
    if (frameTime > 0.25) frameTime = 0.25;

    this.accumulator += frameTime;

    let steps = 0;
    while (this.accumulator >= FIXED_TIMESTEP && steps < MAX_SUBSTEPS) {
      this.fixedUpdate(FIXED_TIMESTEP);
      this.accumulator -= FIXED_TIMESTEP;
      steps++;
    }

    this.update(frameTime);

    const alpha = this.accumulator / FIXED_TIMESTEP;
    this.render(alpha);

    this.onFrameEnd();

    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }
}
