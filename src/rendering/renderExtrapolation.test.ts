import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Position, PreviousPosition } from '../ecs/components';
import { extrapolateRenderPosition } from './renderExtrapolation';

describe('extrapolateRenderPosition', () => {
  let eid: number;
  const out = { x: 0, y: 0, z: 0 };

  beforeEach(() => {
    const world = createWorld();
    eid = addEntity(world);
    addComponent(world, Position, eid);
    addComponent(world, PreviousPosition, eid);
    Position.x[eid] = 0;
    Position.y[eid] = 0;
    Position.z[eid] = 0;
    PreviousPosition.x[eid] = 0;
    PreviousPosition.y[eid] = 0;
    PreviousPosition.z[eid] = 0;
  });

  it('extrapolates horizontal motion ahead of the last tick', () => {
    PreviousPosition.x[eid] = 0;
    Position.x[eid] = 10;
    extrapolateRenderPosition(eid, 0.5, out);
    // Renders T + alpha, not T-1 + alpha: 10 + (10-0)*0.5
    expect(out.x).toBeCloseTo(15, 5);
  });

  it('is exact at alpha=0 (tick boundary renders the committed state)', () => {
    PreviousPosition.z[eid] = 2;
    Position.z[eid] = 4;
    extrapolateRenderPosition(eid, 0, out);
    expect(out.z).toBeCloseTo(4, 5);
  });

  it('stationary entity renders exactly at Position for any alpha', () => {
    Position.x[eid] = 3;
    PreviousPosition.x[eid] = 3;
    Position.y[eid] = 1;
    PreviousPosition.y[eid] = 1;
    extrapolateRenderPosition(eid, 0.7, out);
    expect(out.x).toBeCloseTo(3, 5);
    expect(out.y).toBeCloseTo(1, 5);
  });

  it('extrapolates ascending Y (snappy jump launch)', () => {
    PreviousPosition.y[eid] = 1;
    Position.y[eid] = 2;
    extrapolateRenderPosition(eid, 0.5, out);
    expect(out.y).toBeCloseTo(2.5, 5);
  });

  it('interpolates descending Y — never renders below the committed height', () => {
    PreviousPosition.y[eid] = 2;
    Position.y[eid] = 1;
    extrapolateRenderPosition(eid, 0.5, out);
    // lerp(2, 1, 0.5) = 1.5; extrapolation would have predicted 0.5,
    // below the landing surface.
    expect(out.y).toBeCloseTo(1.5, 5);
    expect(out.y).toBeGreaterThanOrEqual(Position.y[eid]);
  });
});
