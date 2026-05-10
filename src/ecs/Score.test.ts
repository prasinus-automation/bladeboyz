import { describe, it, expect } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Score } from './components';

/**
 * Score is a thin per-entity counter component (kills/deaths/goldThisLife).
 * The actual increment logic lives in `processDeaths.ts` and is covered
 * by `processDeaths.test.ts`. These tests just pin the schema (existence,
 * default values, basic mutability) so a future field rename is caught
 * by the typecheck instead of mysteriously breaking score math.
 */
describe('Score component (issue #130)', () => {
  it('initializes to zero on a fresh entity', () => {
    const world = createWorld();
    const eid = addEntity(world);
    addComponent(world, Score, eid);

    expect(Score.kills[eid]).toBe(0);
    expect(Score.deaths[eid]).toBe(0);
    expect(Score.goldThisLife[eid]).toBe(0);
  });

  it('increments kills independently of deaths', () => {
    const world = createWorld();
    const eid = addEntity(world);
    addComponent(world, Score, eid);

    Score.kills[eid] = 5;
    expect(Score.kills[eid]).toBe(5);
    expect(Score.deaths[eid]).toBe(0);
  });

  it('keeps per-entity values isolated', () => {
    const world = createWorld();
    const a = addEntity(world);
    const b = addEntity(world);
    addComponent(world, Score, a);
    addComponent(world, Score, b);

    Score.kills[a] = 3;
    Score.deaths[b] = 7;

    expect(Score.kills[a]).toBe(3);
    expect(Score.kills[b]).toBe(0);
    expect(Score.deaths[a]).toBe(0);
    expect(Score.deaths[b]).toBe(7);
  });

  it('goldThisLife is a u32 (large values supported)', () => {
    const world = createWorld();
    const eid = addEntity(world);
    addComponent(world, Score, eid);
    Score.goldThisLife[eid] = 100_000;
    expect(Score.goldThisLife[eid]).toBe(100_000);
  });
});
