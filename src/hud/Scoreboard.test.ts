import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Scoreboard } from './Scoreboard';
import { Score } from '../ecs/components';
import type { GameWorld } from '../core/types';

function makeWorld(): GameWorld {
  return {
    ecs: createWorld(),
    scene: undefined as any,
    renderer: undefined as any,
    rapier: undefined as any,
    physicsWorld: undefined as any,
    camera: undefined as any,
    playerEntity: 0,
  };
}

describe('Scoreboard', () => {
  let world: GameWorld;
  let scoreboard: Scoreboard;
  let playerEid: number;

  beforeEach(() => {
    world = makeWorld();
    playerEid = addEntity(world.ecs);
    addComponent(world.ecs, Score, playerEid);
    Score.kills[playerEid] = 0;
    Score.deaths[playerEid] = 0;
    Score.goldThisLife[playerEid] = 0;
    world.playerEntity = playerEid;
    scoreboard = new Scoreboard(world);
  });

  afterEach(() => {
    scoreboard.dispose();
  });

  it('creates a #scoreboard element in the DOM', () => {
    expect(document.getElementById('scoreboard')).not.toBeNull();
  });

  it('shows the placeholder before update() is called', () => {
    expect(scoreboard.text).toBe('K: 0  D: 0  Gold: 0');
  });

  it('renders the player Score after update()', () => {
    Score.kills[playerEid] = 12;
    Score.deaths[playerEid] = 4;
    Score.goldThisLife[playerEid] = 250;
    scoreboard.update();
    expect(scoreboard.text).toBe('K: 12  D: 4  Gold: 250');
  });

  it('reflects subsequent Score changes on later updates', () => {
    scoreboard.update();
    expect(scoreboard.text).toBe('K: 0  D: 0  Gold: 0');

    Score.kills[playerEid] = 1;
    scoreboard.update();
    expect(scoreboard.text).toBe('K: 1  D: 0  Gold: 0');

    Score.deaths[playerEid] = 2;
    Score.goldThisLife[playerEid] = 99;
    scoreboard.update();
    expect(scoreboard.text).toBe('K: 1  D: 2  Gold: 99');
  });

  it('does NOT crash when the player has no Score component', () => {
    const emptyWorld = makeWorld();
    const noScoreEid = addEntity(emptyWorld.ecs);
    emptyWorld.playerEntity = noScoreEid;
    const sb = new Scoreboard(emptyWorld);
    expect(() => sb.update()).not.toThrow();
    expect(sb.text).toBe('K: 0  D: 0  Gold: 0');
    sb.dispose();
  });

  it('does NOT crash when playerEntity === 0', () => {
    const w = makeWorld();
    const sb = new Scoreboard(w);
    expect(() => sb.update()).not.toThrow();
    expect(sb.text).toBe('K: 0  D: 0  Gold: 0');
    sb.dispose();
  });

  it('cleans up DOM on dispose', () => {
    scoreboard.dispose();
    expect(document.getElementById('scoreboard')).toBeNull();
  });

  it('handles large gold values (ui32 range)', () => {
    Score.goldThisLife[playerEid] = 1_000_000;
    scoreboard.update();
    expect(scoreboard.text).toBe('K: 0  D: 0  Gold: 1000000');
  });
});
