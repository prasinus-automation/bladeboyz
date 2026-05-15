import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWorld, addEntity, addComponent, removeComponent } from 'bitecs';
import { DeathScreen, getDisplayName } from './DeathScreen';
import {
  DeadTag,
  RespawnPending,
  Player,
  IsNPC,
  IsTrainingDummy,
} from '../ecs/components';
import { EventBus } from '../events/EventBus';
import type { GameWorld } from '../core/types';

/** Build a minimal stand-in for `GameWorld` — only `ecs` + `playerEntity` are read. */
function makeStubWorld(): GameWorld {
  const ecs = createWorld();
  return {
    ecs,
    // The other fields are typed but never accessed by DeathScreen in these tests.
    scene: undefined as any,
    renderer: undefined as any,
    rapier: undefined as any,
    physicsWorld: undefined as any,
    camera: undefined as any,
    playerEntity: 0,
  };
}

describe('DeathScreen', () => {
  let world: GameWorld;
  let screen: DeathScreen;
  let playerEid: number;

  beforeEach(() => {
    EventBus.clear();
    world = makeStubWorld();
    playerEid = addEntity(world.ecs);
    addComponent(world.ecs, Player, playerEid);
    world.playerEntity = playerEid;
    screen = new DeathScreen(world);
  });

  afterEach(() => {
    screen.dispose();
    EventBus.clear();
  });

  it('creates a #death-screen element in the DOM', () => {
    expect(document.getElementById('death-screen')).not.toBeNull();
  });

  it('is hidden by default', () => {
    const el = document.getElementById('death-screen')!;
    expect(el.style.display).toBe('none');
    expect(screen.isVisible).toBe(false);
  });

  it('becomes visible when the player has DeadTag', () => {
    addComponent(world.ecs, DeadTag, playerEid);
    addComponent(world.ecs, RespawnPending, playerEid);
    RespawnPending.ticksRemaining[playerEid] = 180;
    screen.update();
    const el = document.getElementById('death-screen')!;
    expect(el.style.display).toBe('flex');
    expect(screen.isVisible).toBe(true);
  });

  it('hides again when DeadTag is removed (RespawnEvent path)', () => {
    addComponent(world.ecs, DeadTag, playerEid);
    addComponent(world.ecs, RespawnPending, playerEid);
    RespawnPending.ticksRemaining[playerEid] = 180;
    screen.update();
    expect(screen.isVisible).toBe(true);

    removeComponent(world.ecs, DeadTag, playerEid);
    removeComponent(world.ecs, RespawnPending, playerEid);
    screen.update();
    expect(screen.isVisible).toBe(false);
    expect(document.getElementById('death-screen')!.style.display).toBe('none');
  });

  it('shows "Killed by ..." line populated from DeathEvent', () => {
    EventBus.emit('DeathEvent', {
      victimEid: playerEid,
      killerEid: 999, // a fake killer (no Player tag → "Unknown")
      weaponId: 0, // 'Longsword' (index 0 in weaponIdToName)
      bodyRegion: 0,
      tick: 0,
    });
    EventBus.flush();
    const line = document.getElementById('death-screen-killed-by')!;
    expect(line.textContent).toBe('Killed by Unknown with Longsword');
  });

  it('uses "the void" + suicide phrasing when killerEid === 0', () => {
    EventBus.emit('DeathEvent', {
      victimEid: playerEid,
      killerEid: 0,
      weaponId: 0,
      bodyRegion: 0,
      tick: 0,
    });
    EventBus.flush();
    const line = document.getElementById('death-screen-killed-by')!;
    expect(line.textContent).toBe('Killed by the void');
  });

  it('ignores DeathEvents for OTHER entities', () => {
    EventBus.emit('DeathEvent', {
      victimEid: 12345, // some other entity, not the player
      killerEid: 0,
      weaponId: 0,
      bodyRegion: 0,
      tick: 0,
    });
    EventBus.flush();
    const line = document.getElementById('death-screen-killed-by')!;
    expect(line.textContent).toBe('');
  });

  it('countdown decrements based on RespawnPending.ticksRemaining', () => {
    addComponent(world.ecs, DeadTag, playerEid);
    addComponent(world.ecs, RespawnPending, playerEid);
    const countdownEl = document.getElementById('death-screen-countdown')!;

    RespawnPending.ticksRemaining[playerEid] = 180; // 3.0 s
    screen.update();
    expect(countdownEl.textContent).toBe('3');

    RespawnPending.ticksRemaining[playerEid] = 121; // ceil(2.016) = 3
    screen.update();
    expect(countdownEl.textContent).toBe('3');

    RespawnPending.ticksRemaining[playerEid] = 120; // exactly 2 s
    screen.update();
    expect(countdownEl.textContent).toBe('2');

    RespawnPending.ticksRemaining[playerEid] = 1; // ceil(1/60) = 1
    screen.update();
    expect(countdownEl.textContent).toBe('1');

    RespawnPending.ticksRemaining[playerEid] = 0;
    screen.update();
    expect(countdownEl.textContent).toBe('0');
  });

  it('countdown clamps to 0 if RespawnPending is missing entirely', () => {
    addComponent(world.ecs, DeadTag, playerEid);
    // No RespawnPending — defensive case
    screen.update();
    expect(document.getElementById('death-screen-countdown')!.textContent).toBe('0');
  });

  it('hides on RespawnEvent (DeadTag also removed)', () => {
    addComponent(world.ecs, DeadTag, playerEid);
    addComponent(world.ecs, RespawnPending, playerEid);
    screen.update();
    expect(screen.isVisible).toBe(true);

    EventBus.emit('RespawnEvent', { eid: playerEid, spawnPointId: 1, tick: 0 });
    EventBus.flush();
    // RespawnEvent itself doesn't flip visibility — DeadTag does. Simulate
    // the post-respawn state where DeadTag has been removed.
    removeComponent(world.ecs, DeadTag, playerEid);
    screen.update();
    expect(screen.isVisible).toBe(false);
  });

  it('cleans up on dispose', () => {
    screen.dispose();
    expect(document.getElementById('death-screen')).toBeNull();
  });

  it('dispose stops listening to subsequent DeathEvents', () => {
    screen.dispose();
    // Should not throw despite the DOM element being gone.
    expect(() => {
      EventBus.emit('DeathEvent', {
        victimEid: playerEid,
        killerEid: 0,
        weaponId: 0,
        bodyRegion: 0,
        tick: 0,
      });
      EventBus.flush();
    }).not.toThrow();
  });

  it('does not crash when playerEntity is 0 (no player created yet)', () => {
    const w = makeStubWorld();
    const s = new DeathScreen(w);
    expect(() => s.update()).not.toThrow();
    expect(s.isVisible).toBe(false);
    s.dispose();
  });
});

describe('getDisplayName', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = {
      ecs: createWorld(),
      scene: undefined as any,
      renderer: undefined as any,
      rapier: undefined as any,
      physicsWorld: undefined as any,
      camera: undefined as any,
      playerEntity: 0,
    };
  });

  it('returns "the void" for eid 0', () => {
    expect(getDisplayName(world, 0)).toBe('the void');
  });

  it('returns "You" for the local player', () => {
    const eid = addEntity(world.ecs);
    addComponent(world.ecs, Player, eid);
    world.playerEntity = eid;
    expect(getDisplayName(world, eid)).toBe('You');
  });

  it('returns "Player" for any other Player-tagged entity', () => {
    const meEid = addEntity(world.ecs);
    addComponent(world.ecs, Player, meEid);
    world.playerEntity = meEid;
    const otherEid = addEntity(world.ecs);
    addComponent(world.ecs, Player, otherEid);
    expect(getDisplayName(world, otherEid)).toBe('Player');
  });

  it('returns "Dummy <id>" for entities tagged IsTrainingDummy', () => {
    const dummyEid = addEntity(world.ecs);
    addComponent(world.ecs, IsNPC, dummyEid);
    addComponent(world.ecs, IsTrainingDummy, dummyEid);
    expect(getDisplayName(world, dummyEid)).toBe(`Dummy ${dummyEid}`);
  });

  it('returns "Unknown" as the fallback', () => {
    expect(getDisplayName(world, 999)).toBe('Unknown');
  });
});
