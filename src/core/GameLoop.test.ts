import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameLoop } from './GameLoop';

describe('GameLoop', () => {
  let loop: GameLoop;
  let mockRaf: (cb: FrameRequestCallback) => number;
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    rafCallbacks = [];
    let idCounter = 1;

    mockRaf = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return idCounter++;
    });
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(mockRaf);
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(vi.fn());
    vi.spyOn(performance, 'now').mockReturnValue(0);

    loop = new GameLoop();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls fixedUpdate at fixed timestep', () => {
    const fixedUpdate = vi.fn();
    loop.fixedUpdate = fixedUpdate;
    loop.update = vi.fn();
    loop.render = vi.fn();

    // Start the loop
    loop.start();

    // Simulate 20ms frame (should trigger 1 fixedUpdate at 16.67ms)
    const cb = rafCallbacks[rafCallbacks.length - 1];
    vi.spyOn(performance, 'now').mockReturnValue(20);
    cb(20);

    expect(fixedUpdate).toHaveBeenCalledTimes(1);
    expect(fixedUpdate).toHaveBeenCalledWith(expect.closeTo(1 / 60, 4));
  });

  it('calls render with interpolation alpha', () => {
    const render = vi.fn();
    loop.fixedUpdate = vi.fn();
    loop.update = vi.fn();
    loop.render = render;

    loop.start();

    const cb = rafCallbacks[rafCallbacks.length - 1];
    vi.spyOn(performance, 'now').mockReturnValue(20);
    cb(20);

    expect(render).toHaveBeenCalledTimes(1);
    // Alpha should be the leftover accumulator / FIXED_TIMESTEP
    expect(render).toHaveBeenCalledWith(expect.any(Number));
  });

  it('calls onFrameEnd after render', () => {
    const callOrder: string[] = [];
    loop.fixedUpdate = () => callOrder.push('fixed');
    loop.update = () => callOrder.push('update');
    loop.render = () => callOrder.push('render');
    loop.onFrameEnd = () => callOrder.push('frameEnd');

    loop.start();
    const cb = rafCallbacks[rafCallbacks.length - 1];
    vi.spyOn(performance, 'now').mockReturnValue(20);
    cb(20);

    expect(callOrder).toEqual(['fixed', 'update', 'render', 'frameEnd']);
  });

  it('stops when stop() is called', () => {
    loop.start();
    loop.stop();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it('clamps large frame times to prevent spiral of death', () => {
    const fixedUpdate = vi.fn();
    loop.fixedUpdate = fixedUpdate;
    loop.update = vi.fn();
    loop.render = vi.fn();

    loop.start();

    // Simulate 1 second gap (tab switch scenario)
    const cb = rafCallbacks[rafCallbacks.length - 1];
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    cb(1000);

    // Should be clamped: 250ms / 16.67ms ≈ 15 steps max, but MAX_SUBSTEPS=5
    expect(fixedUpdate.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
