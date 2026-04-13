const FIXED_DT = 1 / 60; // 60 Hz fixed timestep
const MAX_FRAME_TIME = 0.25; // clamp to prevent spiral of death

export interface GameLoopCallbacks {
  fixedUpdate(dt: number): void;
  update(dt: number): void;
  render(alpha: number): void;
}

/**
 * Fixed-timestep game loop with variable render.
 * Uses a custom accumulator — NOT Three.js Clock.getDelta().
 */
export function startGameLoop(callbacks: GameLoopCallbacks): void {
  let previousTime = performance.now() / 1000;
  let accumulator = 0;

  function loop(): void {
    const currentTime = performance.now() / 1000;
    let frameTime = currentTime - previousTime;
    previousTime = currentTime;

    if (frameTime > MAX_FRAME_TIME) {
      frameTime = MAX_FRAME_TIME;
    }

    accumulator += frameTime;

    // Fixed update at 60Hz
    while (accumulator >= FIXED_DT) {
      callbacks.fixedUpdate(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    // Variable-rate update
    callbacks.update(frameTime);

    // Render with interpolation alpha
    const alpha = accumulator / FIXED_DT;
    callbacks.render(alpha);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

export { FIXED_DT };
