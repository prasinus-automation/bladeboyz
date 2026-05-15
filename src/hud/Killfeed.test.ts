import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import {
  Killfeed,
  ENTRY_LIFE_MS,
  FADE_DURATION_MS,
  MAX_VISIBLE,
} from './Killfeed';
import { Player, IsNPC, IsTrainingDummy } from '../ecs/components';
import { EventBus } from '../events/EventBus';
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

function emitDeath(world: GameWorld, victimEid: number, killerEid: number, weaponId = 0): void {
  EventBus.emit('DeathEvent', {
    victimEid,
    killerEid,
    weaponId,
    bodyRegion: 0,
    tick: 0,
  });
  EventBus.flush();
}

describe('Killfeed', () => {
  let world: GameWorld;
  let now = 0;
  let feed: Killfeed;

  beforeEach(() => {
    EventBus.clear();
    now = 0;
    world = makeWorld();
    const playerEid = addEntity(world.ecs);
    addComponent(world.ecs, Player, playerEid);
    world.playerEntity = playerEid;
    feed = new Killfeed(world, { now: () => now });
  });

  afterEach(() => {
    feed.dispose();
    EventBus.clear();
  });

  it('creates a #killfeed container in the DOM', () => {
    expect(document.getElementById('killfeed')).not.toBeNull();
  });

  it('starts with zero entries', () => {
    expect(feed.entryCount).toBe(0);
  });

  it('appends an entry on a DeathEvent', () => {
    emitDeath(world, world.playerEntity, 999); // unknown killer
    expect(feed.entryCount).toBe(1);
    const text = feed.entryTexts[0];
    expect(text).toContain('You');
    expect(text).toContain('Unknown');
    expect(text).toContain('Longsword'); // weaponId=0 → Longsword
  });

  it('renders weapon name in italic via <em> with class "killfeed-weapon"', () => {
    emitDeath(world, world.playerEntity, 999);
    const em = document
      .getElementById('killfeed')!
      .querySelector('em.killfeed-weapon');
    expect(em).not.toBeNull();
    expect(em!.textContent).toBe('Longsword');
  });

  it('formats suicides as "<victim> died" (no killer / no weapon)', () => {
    emitDeath(world, world.playerEntity, 0);
    expect(feed.entryCount).toBe(1);
    expect(feed.entryTexts[0]).toBe('You died');
    // No weapon span on suicides.
    const em = document
      .getElementById('killfeed')!
      .querySelector('em.killfeed-weapon');
    expect(em).toBeNull();
  });

  it('shows up to MAX_VISIBLE entries simultaneously', () => {
    for (let i = 0; i < MAX_VISIBLE; i++) {
      emitDeath(world, world.playerEntity, 999);
    }
    expect(feed.entryCount).toBe(MAX_VISIBLE);
    const list = document.getElementById('killfeed')!.children;
    expect(list.length).toBe(MAX_VISIBLE);
  });

  it('evicts the oldest entry when a 6th arrives (cap stays at MAX_VISIBLE)', () => {
    for (let i = 0; i < MAX_VISIBLE; i++) {
      emitDeath(world, world.playerEntity, 999, 0); // weaponId=0 → Longsword
    }
    // Push a distinguishable entry — weaponId=1 ('Mace').
    emitDeath(world, world.playerEntity, 999, 1);
    expect(feed.entryCount).toBe(MAX_VISIBLE);
    // The newest should be present, the oldest dropped.
    const last = feed.entryTexts[MAX_VISIBLE - 1];
    expect(last).toContain('Mace');
  });

  it('fades entries after ENTRY_LIFE_MS via opacity = 0', () => {
    emitDeath(world, world.playerEntity, 999);
    const entry = document.getElementById('killfeed')!.children[0] as HTMLElement;
    expect(entry.style.opacity).toBe('1');

    // Just under the life threshold — no fade yet.
    now = ENTRY_LIFE_MS - 1;
    feed.update();
    expect(entry.style.opacity).toBe('1');

    // Right at threshold — fade kicks in.
    now = ENTRY_LIFE_MS;
    feed.update();
    expect(entry.style.opacity).toBe('0');
  });

  it('removes entries from the DOM after the fade completes', () => {
    emitDeath(world, world.playerEntity, 999);
    expect(feed.entryCount).toBe(1);

    now = ENTRY_LIFE_MS + FADE_DURATION_MS - 1;
    feed.update();
    expect(feed.entryCount).toBe(1); // still in DOM during the fade

    now = ENTRY_LIFE_MS + FADE_DURATION_MS;
    feed.update();
    expect(feed.entryCount).toBe(0);
    expect(document.getElementById('killfeed')!.children.length).toBe(0);
  });

  it('multiple entries fade independently in chronological order', () => {
    emitDeath(world, world.playerEntity, 999); // entry A @ t=0
    now = 1000;
    emitDeath(world, world.playerEntity, 999); // entry B @ t=1000

    // At t = ENTRY_LIFE_MS + FADE_DURATION_MS, only A should be GC'd.
    now = ENTRY_LIFE_MS + FADE_DURATION_MS;
    feed.update();
    expect(feed.entryCount).toBe(1);

    // At t = 1000 + ENTRY_LIFE_MS + FADE_DURATION_MS, B is also GC'd.
    now = 1000 + ENTRY_LIFE_MS + FADE_DURATION_MS;
    feed.update();
    expect(feed.entryCount).toBe(0);
  });

  it('renders dummy victims as "Dummy <eid>"', () => {
    const dummyEid = addEntity(world.ecs);
    addComponent(world.ecs, IsNPC, dummyEid);
    addComponent(world.ecs, IsTrainingDummy, dummyEid);
    emitDeath(world, dummyEid, world.playerEntity);
    expect(feed.entryTexts[0]).toContain('You');
    expect(feed.entryTexts[0]).toContain(`Dummy ${dummyEid}`);
  });

  it('cleans up DOM on dispose', () => {
    emitDeath(world, world.playerEntity, 999);
    expect(feed.entryCount).toBe(1);
    feed.dispose();
    expect(document.getElementById('killfeed')).toBeNull();
  });

  it('dispose unsubscribes — further events do not throw or re-create entries', () => {
    feed.dispose();
    expect(() => emitDeath(world, world.playerEntity, 999)).not.toThrow();
    expect(document.getElementById('killfeed')).toBeNull();
  });
});
