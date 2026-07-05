/**
 * Remote player entities — the client-side puppets for other people in a
 * multiplayer match.
 *
 * A remote player is a VISUAL combatant: character model, weapon model,
 * hitbox sensors (so the LOCAL player's tracers connect and generate
 * damage claims), health (server-echoed, drives the head health bar), and
 * a CombatStateComp mirror (drives swing/block animation through the
 * regular AnimationSystem). It has NO TracerTag (its swings are resolved
 * by its own client), no MovementIntent (position comes from the network),
 * and none of the lifecycle tags — the server owns its HP/death/respawn.
 *
 * Position/yaw are interpolated ~100 ms behind the newest server state so
 * motion is smooth at any packet cadence (standard snapshot interpolation;
 * doc 01 §5).
 */

import * as THREE from 'three';
import { addEntity, addComponent, removeEntity, defineQuery } from 'bitecs';
import {
  Position,
  PreviousPosition,
  Rotation,
  PreviousRotation,
  CharacterModel,
  Health,
  Stamina,
  Hitboxes,
  CombatStateComp,
  CombatStateComponent,
  AnimationComp,
  HitReactComp,
  RemotePlayer,
  IsNPC,
  meshRegistry,
  hitboxColliderRegistry,
} from '../ecs/components';
import { createCharacterModel } from '../rendering/CharacterModel';
import { createHitboxes } from '../ecs/systems/HitboxSystem';
import { colliderToHitbox } from '../ecs/systems/TracerSystem';
import { weaponModelFactories } from '../rendering/WeaponModels';
import { weaponIdToName } from '../ecs/systems/CombatSystem';
import { CombatState } from '../combat/states';
import { GROUND_TOP_Y, CHARACTER_CONTROLLER_OFFSET } from '../core/types';
import type { GameWorld } from '../core/types';
import type { NetPlayerState } from './protocol';

/** Interpolation delay: render remote players this far in the past. */
const INTERP_DELAY_MS = 120;

/** Buffered network sample for interpolation. */
interface NetSample {
  at: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface RemotePlayerData {
  netId: string;
  name: string;
  samples: NetSample[];
  /** Currently attached weapon model id (swap on change). */
  weaponId: number;
}

/** eid → remote metadata (side-table; bitECS can't hold strings). */
export const remotePlayerRegistry = new Map<number, RemotePlayerData>();
/** netId → eid reverse lookup. */
export const remoteByNetId = new Map<string, number>();

const remoteQuery = defineQuery([RemotePlayer, Position]);

export function createRemotePlayer(
  world: GameWorld,
  netId: string,
  name: string,
  spawn: { x: number; z: number; yaw: number; holdBelowArena?: boolean },
): number {
  const eid = addEntity(world.ecs);
  // `holdBelowArena`: roster-join puppets whose real position is unknown
  // until their first state sample park 30 m under the floor so their
  // hitboxes can't soak local tracer hits at a bogus origin position.
  const y = spawn.holdBelowArena
    ? -30
    : GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET;

  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, PreviousPosition, eid);
  addComponent(world.ecs, Rotation, eid);
  addComponent(world.ecs, PreviousRotation, eid);
  addComponent(world.ecs, CharacterModel, eid);
  addComponent(world.ecs, Health, eid);
  addComponent(world.ecs, Stamina, eid);
  addComponent(world.ecs, Hitboxes, eid);
  addComponent(world.ecs, CombatStateComp, eid);
  addComponent(world.ecs, CombatStateComponent, eid);
  addComponent(world.ecs, AnimationComp, eid);
  addComponent(world.ecs, HitReactComp, eid);
  addComponent(world.ecs, RemotePlayer, eid);
  // IsNPC: reuses the non-local-combatant chrome — head health bar
  // ([IsNPC, Health] query) and floating damage numbers. Remote players
  // are NOT IsTrainingDummy (no auto-regen, no K-reset).
  addComponent(world.ecs, IsNPC, eid);

  Position.x[eid] = spawn.x;
  Position.y[eid] = y;
  Position.z[eid] = spawn.z;
  PreviousPosition.x[eid] = spawn.x;
  PreviousPosition.y[eid] = y;
  PreviousPosition.z[eid] = spawn.z;
  Rotation.y[eid] = spawn.yaw;
  Health.current[eid] = 100;
  Health.max[eid] = 100;
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;
  CombatStateComponent.state[eid] = CombatState.Idle;

  // Distinct silhouette color per remote (hash of netId) — teal-to-purple
  // band, away from local blue / dummy red / bot orange.
  let hash = 0;
  for (let i = 0; i < netId.length; i++) hash = (hash * 31 + netId.charCodeAt(i)) >>> 0;
  const hue = 0.45 + (hash % 40) / 100; // 0.45..0.85
  const color = new THREE.Color().setHSL(hue, 0.55, 0.5).getHex();

  const { group, skeleton, bones } = createCharacterModel(color);
  group.position.set(spawn.x, y, spawn.z);
  group.rotation.y = spawn.yaw;
  CharacterModel.id[eid] = eid;
  meshRegistry.set(eid, { group, skeleton, bones });
  world.scene.add(group);

  createHitboxes(world, eid, skeleton, bones);

  remotePlayerRegistry.set(eid, { netId, name, samples: [], weaponId: -1 });
  remoteByNetId.set(netId, eid);
  applyRemoteWeapon(eid, 0);
  return eid;
}

export function removeRemotePlayer(world: GameWorld, eid: number): void {
  const data = remotePlayerRegistry.get(eid);
  if (data) remoteByNetId.delete(data.netId);
  remotePlayerRegistry.delete(eid);

  const modelData = meshRegistry.get(eid);
  if (modelData) {
    world.scene.remove(modelData.group);
    modelData.group.traverse((obj) => {
      const o = obj as unknown as {
        geometry?: { dispose: () => void };
        material?: { dispose: () => void } | Array<{ dispose: () => void }>;
      };
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    meshRegistry.delete(eid);
  }
  const colliderMap = hitboxColliderRegistry.get(eid);
  if (colliderMap) {
    for (const [, sensor] of colliderMap) {
      colliderToHitbox.delete(sensor.handle);
      const rb = sensor.parent();
      if (rb) world.physicsWorld.removeRigidBody(rb);
    }
    hitboxColliderRegistry.delete(eid);
  }
  removeEntity(world.ecs, eid);
}

export function removeAllRemotePlayers(world: GameWorld): void {
  for (const eid of Array.from(remotePlayerRegistry.keys())) {
    removeRemotePlayer(world, eid);
  }
}

/** Swap the weapon model on a remote player's weapon_attach bone. */
export function applyRemoteWeapon(eid: number, weaponId: number): void {
  const data = remotePlayerRegistry.get(eid);
  if (!data || data.weaponId === weaponId) return;
  const modelData = meshRegistry.get(eid);
  const bone = modelData?.bones['weapon_attach'];
  if (!bone) return;
  while (bone.children.length > 0) bone.remove(bone.children[0]);
  const factory = weaponModelFactories[weaponIdToName[weaponId] ?? 'Longsword'];
  if (factory) bone.add(factory().group);
  data.weaponId = weaponId;
}

/** Ingest one server state sample for a remote player. */
export function pushRemoteState(eid: number, s: NetPlayerState, now: number): void {
  const data = remotePlayerRegistry.get(eid);
  if (!data) return;
  data.samples.push({ at: now, x: s.p.x, y: s.p.y, z: s.p.z, yaw: s.yaw });
  // Keep ~1 s of history.
  while (data.samples.length > 30) data.samples.shift();

  // Camera pitch → chest lean during attack states (AnimationSystem §7.5).
  // Applied directly (not interpolated) so the lean stays locked to the
  // same sample as the combat-state mirror below — the swing pose and the
  // aim tilt come from one packet, no skew between them.
  Rotation.x[eid] = s.pitch;

  // Combat-state mirror → AnimationSystem drives the swing/block pose.
  CombatStateComp.state[eid] = s.cs.s;
  CombatStateComp.direction[eid] = s.cs.d;
  CombatStateComp.phaseT[eid] = s.cs.pt;
  CombatStateComp.phaseTotal[eid] = 100;
  CombatStateComp.phaseElapsed[eid] = Math.round(s.cs.pt * 100);
  CombatStateComp.weaponId[eid] = s.cs.w;
  // Mirror onto CombatStateComponent so attacker-side block judgment
  // (NetDamageInterceptor) can read replicated Blocking state/direction.
  CombatStateComponent.state[eid] = s.cs.s;
  CombatStateComponent.blockDirection[eid] = s.cs.d;
  CombatStateComponent.attackDirection[eid] = s.cs.d;
  CombatStateComponent.weaponId[eid] = s.cs.w;
  applyRemoteWeapon(eid, s.cs.w);
}

/**
 * Interpolate remote player positions/yaw toward `now - INTERP_DELAY_MS`.
 * Runs each fixed tick BEFORE hitboxSystem so hitboxes track the puppet.
 */
export function remotePlayerSystem(world: GameWorld, now: number): void {
  const eids = remoteQuery(world.ecs);
  const renderAt = now - INTERP_DELAY_MS;

  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i];
    const data = remotePlayerRegistry.get(eid);
    if (!data || data.samples.length === 0) continue;

    PreviousPosition.x[eid] = Position.x[eid];
    PreviousPosition.y[eid] = Position.y[eid];
    PreviousPosition.z[eid] = Position.z[eid];
    PreviousRotation.y[eid] = Rotation.y[eid];

    const samples = data.samples;
    // Find the pair straddling renderAt.
    let a = samples[0];
    let b = samples[samples.length - 1];
    for (let k = 0; k < samples.length - 1; k++) {
      if (samples[k].at <= renderAt && samples[k + 1].at >= renderAt) {
        a = samples[k];
        b = samples[k + 1];
        break;
      }
    }
    let x: number;
    let y: number;
    let z: number;
    let yaw: number;
    if (renderAt <= a.at) {
      ({ x, y, z, yaw } = a);
    } else if (renderAt >= b.at) {
      // Newer than the buffer — hold the last sample (no extrapolation).
      ({ x, y, z, yaw } = b);
    } else {
      const t = (renderAt - a.at) / Math.max(1, b.at - a.at);
      x = a.x + (b.x - a.x) * t;
      y = a.y + (b.y - a.y) * t;
      z = a.z + (b.z - a.z) * t;
      // Shortest-arc yaw interpolation.
      let dy = b.yaw - a.yaw;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      yaw = a.yaw + dy * t;
    }

    Position.x[eid] = x;
    Position.y[eid] = y;
    Position.z[eid] = z;
    Rotation.y[eid] = yaw;
  }
}

export function getRemotePlayerEids(world: GameWorld): number[] {
  return Array.from(remoteQuery(world.ecs));
}

/** Display name for HUD chrome (killfeed, death screen, scoreboard). */
export function getRemoteName(eid: number): string | null {
  return remotePlayerRegistry.get(eid)?.name ?? null;
}
