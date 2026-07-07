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
  MovementState,
} from '../ecs/components';
import { createCharacterModel } from '../rendering/CharacterModel';
import { createHitboxes } from '../ecs/systems/HitboxSystem';
import { colliderToHitbox } from '../ecs/systems/TracerSystem';
import { weaponModelFactories } from '../rendering/WeaponModels';
import { weaponIdToName } from '../ecs/systems/CombatSystem';
import { CombatState } from '../combat/states';
import { CHARACTER_CONTROLLER_OFFSET, WALK_SPEED, FIXED_TIMESTEP } from '../core/types';
import type { GameWorld } from '../core/types';
import { getGroundHeightAt } from '../arena/types';
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
  /**
   * Last combat state seen on the wire (#224). Used to detect state
   * transitions — specifically the entry into Blocking — so the free-running
   * block-hold clock is reset on entry only, never on an in-place
   * block-direction morph.
   */
  prevCombatState: number;
  /**
   * Wall-clock ms (`now`) at which this remote entered its current Blocking
   * hold (#224). Blocking has no bounded duration on the wire (`pt` is always
   * 0), so `phaseElapsed` is reconstructed locally as `(now - blockStartMs)`
   * → the #218 living-guard motion animates for spectators instead of
   * freezing. Meaningless outside Blocking.
   */
  blockStartMs: number;
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
    : getGroundHeightAt(world.arena, spawn.x, spawn.z) +
      CHARACTER_CONTROLLER_OFFSET;

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
  // MovementState so AnimationSystem's locomotion layer animates remote
  // legs (#goal-2026-07 locomotion pass) — without it speedFactor reads 0
  // and remotes GLIDE across the arena in the idle leg pose.
  addComponent(world.ecs, MovementState, eid);
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
  MovementState.grounded[eid] = 1;
  MovementState.sprinting[eid] = 0;
  MovementState.crouching[eid] = 0;
  MovementState.speedFactor[eid] = 0;
  MovementState.verticalVelocity[eid] = 0;

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

  remotePlayerRegistry.set(eid, {
    netId,
    name,
    samples: [],
    weaponId: -1,
    prevCombatState: CombatState.Idle,
    blockStartMs: 0,
  });
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
  const incomingState = s.cs.s;
  // Detect the entry into Blocking to (re)start the free-running block clock.
  // Keyed on STATE transitions ONLY — a mid-hold block-direction change
  // (`setBlockDirection`, an in-place morph) keeps the same state and MUST
  // NOT reset the counter (#224 parity rule).
  if (
    data.prevCombatState !== incomingState &&
    incomingState === CombatState.Blocking
  ) {
    data.blockStartMs = now;
  }
  data.prevCombatState = incomingState;

  CombatStateComp.state[eid] = s.cs.s;
  CombatStateComp.direction[eid] = s.cs.d;
  CombatStateComp.weaponId[eid] = s.cs.w;
  if (incomingState === CombatState.Blocking) {
    // Blocking is unbounded — mirror the LOCAL player's Blocking semantics
    // exactly: phaseTotal 0, phaseT 0. `phaseElapsed` is a client-local
    // free-running clock owned by `remotePlayerSystem` (advanced per frame,
    // not per snapshot, so the living-guard breathing stays smooth). See #224.
    CombatStateComp.phaseTotal[eid] = 0;
    CombatStateComp.phaseT[eid] = 0;
  } else {
    // Bounded states (Windup/Release/Recovery/HitStun/Parry): reconstruct the
    // synthetic 0..100 phase from the wire fraction, unchanged from before.
    CombatStateComp.phaseT[eid] = s.cs.pt;
    CombatStateComp.phaseTotal[eid] = 100;
    CombatStateComp.phaseElapsed[eid] = Math.round(s.cs.pt * 100);
  }
  // Mirror onto CombatStateComponent so attacker-side block judgment
  // (NetDamageInterceptor) can read replicated Blocking state/direction.
  CombatStateComponent.state[eid] = s.cs.s;
  CombatStateComponent.blockDirection[eid] = s.cs.d;
  CombatStateComponent.attackDirection[eid] = s.cs.d;
  CombatStateComponent.weaponId[eid] = s.cs.w;
  applyRemoteWeapon(eid, s.cs.w);
}

/**
 * Derive locomotion state from one tick of interpolated remote motion
 * (#goal-2026-07 locomotion pass). Pure so it's unit-testable: takes the
 * tick displacement and the current smoothed speed factor, returns the
 * new MovementState values. Remote packets carry no gait flags — the
 * planar velocity of the puppet is the ground truth the local viewer
 * perceives anyway. The low-pass (0.3/tick) keeps sample jitter from
 * making the legs stutter.
 */
export function deriveRemoteGait(
  dx: number,
  dy: number,
  dz: number,
  currentSpeedFactor: number,
): { speedFactor: number; sprinting: 0 | 1; grounded: 0 | 1 } {
  const planarSpeed = Math.sqrt(dx * dx + dz * dz) / FIXED_TIMESTEP;
  const targetFactor = Math.min(1, planarSpeed / WALK_SPEED);
  return {
    speedFactor:
      currentSpeedFactor + (targetFactor - currentSpeedFactor) * 0.3,
    sprinting: planarSpeed > WALK_SPEED * 1.15 ? 1 : 0,
    // Airborne when the puppet moves vertically faster than slope/step
    // noise — drives the jump pose instead of moon-glide legs.
    grounded: Math.abs(dy / FIXED_TIMESTEP) > 3 ? 0 : 1,
  };
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

    // ── Derive locomotion state from the interpolated motion ──
    const gait = deriveRemoteGait(
      Position.x[eid] - PreviousPosition.x[eid],
      Position.y[eid] - PreviousPosition.y[eid],
      Position.z[eid] - PreviousPosition.z[eid],
      MovementState.speedFactor[eid],
    );
    MovementState.speedFactor[eid] = gait.speedFactor;
    MovementState.sprinting[eid] = gait.sprinting;
    MovementState.grounded[eid] = gait.grounded;

    // ── Free-running block-hold clock (#224) ──
    // Blocking carries no elapsed value on the wire, so drive `phaseElapsed`
    // from wall-clock time held. Per-frame (not per-snapshot) advancement is
    // the point — it feeds #218's `computeBlockHoldOffsets`, which needs a
    // smoothly-increasing tick count to animate the living-guard breathing.
    if (CombatStateComp.state[eid] === CombatState.Blocking) {
      const heldTicks = Math.round(
        (now - data.blockStartMs) / (FIXED_TIMESTEP * 1000),
      );
      CombatStateComp.phaseElapsed[eid] = Math.max(0, heldTicks);
    }
  }
}

export function getRemotePlayerEids(world: GameWorld): number[] {
  return Array.from(remoteQuery(world.ecs));
}

/** Display name for HUD chrome (killfeed, death screen, scoreboard). */
export function getRemoteName(eid: number): string | null {
  return remotePlayerRegistry.get(eid)?.name ?? null;
}
