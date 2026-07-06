/**
 * NetworkSystem — glues the NetClient to the ECS world during a
 * multiplayer match.
 *
 * Responsibilities:
 *  - Apply server messages: roster (spawn/remove remote puppets), state
 *    stream (interp buffers), authoritative HP echoes (local + remote),
 *    deaths (kill attribution + killfeed), respawns (teleports), the match
 *    clock/scoreboard/match-end payloads (stored on `matchState` for HUD).
 *  - Send the local player's state at CLIENT_SEND_HZ (driven from
 *    fixedUpdate via a tick accumulator — no wall-clock timers in src/).
 *  - Intercept DamageEvents that target remote players BETWEEN TracerSystem
 *    and DamageSystem: judge blocks against the victim's replicated combat
 *    state (attacker-side judgment, consistent with the attacker-authority
 *    trust model), convert survivors into `claim` messages, and delete the
 *    events so the local DamageSystem never double-applies.
 *
 * The local player's own simulation (movement, swings, knockback feel)
 * runs untouched — the server arbitrates HP/deaths/scores.
 */

import { defineQuery, hasComponent, addComponent, removeComponent, removeEntity } from 'bitecs';
import {
  DamageEvent,
  Health,
  Position,
  PreviousPosition,
  Rotation,
  RemotePlayer,
  KnockbackState,
  CombatStateComp,
  CombatStateComponent,
  DeadTag,
  RespawnPending,
} from '../ecs/components';
import { CombatState } from '../combat/states';
import { CombatInput, fsmRegistry } from '../combat/CombatFSM';
import { Direction } from '../combat/directions';
import { recordDamageAttribution } from '../ecs/systems/DamageSystem';
import { getPhysicsBody } from '../ecs/systems/MovementSystem';
import { EventBus } from '../events/EventBus';
import { getCurrentFixedTick } from '../core/tickCounter';
import { CHARACTER_CONTROLLER_OFFSET } from '../core/types';
import { getGroundHeightAt } from '../arena/types';
import { weaponConfigs } from '../weapons/WeaponConfig';
import { weaponIdToName } from '../ecs/systems/CombatSystem';
import { DEFAULT_KNOCKBACK } from '../weapons/WeaponConfig';
import type { GameWorld } from '../core/types';
import type { NetClient } from './NetClient';
import type { ServerMsg, NetScoreRow, NetSpawn } from './protocol';
import { CLIENT_SEND_HZ } from './protocol';
import {
  createRemotePlayer,
  removeRemotePlayer,
  removeAllRemotePlayers,
  remoteByNetId,
  remotePlayerRegistry,
  pushRemoteState,
  remotePlayerSystem,
} from './RemotePlayers';

/** Ticks between state sends (60 Hz fixed / 20 Hz send = 3). */
const SEND_INTERVAL_TICKS = Math.max(1, Math.round(60 / CLIENT_SEND_HZ));

/** HUD-consumable match state (clock, scores, lifecycle). */
export interface MatchState {
  connected: boolean;
  live: boolean;
  remainingMs: number;
  scores: NetScoreRow[];
  /** Non-null while the match-end standings screen should show. */
  finalStandings: NetScoreRow[] | null;
  myNetId: string;
  myName: string;
}

const damageEventQuery = defineQuery([DamageEvent]);

export class NetworkSystem {
  readonly matchState: MatchState = {
    connected: false,
    live: true,
    remainingMs: 0,
    scores: [],
    finalStandings: null,
    myNetId: '',
    myName: '',
  };

  private sendAccumulator = 0;

  constructor(
    private world: GameWorld,
    private client: NetClient,
    private playerEid: number,
  ) {
    client.onMessage = (msg) => this.handleMessage(msg);
    client.onStatus = (status) => {
      this.matchState.connected = status === 'connected';
      if (status === 'disconnected') {
        removeAllRemotePlayers(this.world);
      }
    };
  }

  // ── Inbound ────────────────────────────────────────────

  private handleMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome': {
        this.matchState.myNetId = msg.id;
        this.matchState.myName = msg.name;
        this.matchState.live = msg.match.live;
        this.matchState.remainingMs = msg.match.remainingMs;
        this.matchState.scores = msg.scores;
        this.matchState.finalStandings = null;
        this.teleportLocal(msg.spawn);
        // Spawn puppets for everyone already in the room.
        for (const p of msg.roster) {
          if (p.id === msg.id) continue;
          if (!remoteByNetId.has(p.id)) {
            // Spawn position is unknown until their first state sample —
            // hold the puppet (and its live hitboxes) far below the arena
            // instead of at the origin, where it could soak bogus local
            // tracer hits (QA note #4 on PR #193).
            createRemotePlayer(this.world, p.id, p.name, {
              x: 0,
              z: 0,
              yaw: 0,
              holdBelowArena: true,
            });
          }
        }
        break;
      }
      case 'playerJoined': {
        if (msg.id === this.client.myId) break;
        if (!remoteByNetId.has(msg.id)) {
          createRemotePlayer(this.world, msg.id, msg.name, msg.spawn);
        }
        break;
      }
      case 'playerLeft': {
        const eid = remoteByNetId.get(msg.id);
        if (eid !== undefined) removeRemotePlayer(this.world, eid);
        break;
      }
      case 'states': {
        const now = performance.now();
        for (const s of msg.s) {
          const eid = remoteByNetId.get(s.id);
          if (eid !== undefined) pushRemoteState(eid, s, now);
        }
        break;
      }
      case 'hp':
        this.applyHp(msg.id, msg.hp, msg.from, msg.dmg, msg.region, msg.w, msg.dir);
        break;
      case 'death': {
        const victimEid = this.eidFor(msg.victim);
        const killerEid = this.eidFor(msg.killer);
        if (victimEid === this.playerEid) {
          // LOCAL death — the server is the lifecycle authority in
          // multiplayer (the local healthSystemTick/processDeaths/
          // processRespawns pipeline is gated off in main.ts). Mirror the
          // essential parts here: death-state components (DeathScreen
          // reads DeadTag + RespawnPending for its countdown; Movement/
          // CombatSystem early-out on DeadTag), FSM reset, and the
          // killfeed DeathEvent with the attribution recorded in applyHp.
          Health.current[this.playerEid] = 0;
          if (!hasComponent(this.world.ecs, DeadTag, this.playerEid)) {
            addComponent(this.world.ecs, DeadTag, this.playerEid);
            addComponent(this.world.ecs, RespawnPending, this.playerEid);
            // Display-only countdown; the authoritative respawn is the
            // server's `respawn` message (~3 s, matching this).
            RespawnPending.ticksRemaining[this.playerEid] = 180;
          }
          fsmRegistry.get(this.playerEid)?.reset();
          EventBus.emit('DeathEvent', {
            victimEid,
            killerEid: killerEid ?? 0,
            weaponId: msg.w,
            bodyRegion: 0,
            tick: getCurrentFixedTick(),
          });
          break;
        }
        if (victimEid !== null) {
          Health.current[victimEid] = 0;
          // Remote victims: the local lifecycle pipeline never touches
          // them (gated off in MP + RemotePlayer exclusions in
          // healthSystemTick/processRespawns) — the server death message
          // IS their death. Emit the killfeed event directly.
          EventBus.emit('DeathEvent', {
            victimEid,
            killerEid: killerEid ?? 0,
            weaponId: msg.w,
            bodyRegion: 0,
            tick: getCurrentFixedTick(),
          });
        }
        break;
      }
      case 'respawn': {
        const eid = this.eidFor(msg.id);
        if (eid === this.playerEid) {
          this.teleportLocal(msg.spawn);
          Health.current[this.playerEid] = 100;
          // Server respawn = authoritative resurrection: clear the
          // death-state components (nothing else removes them in MP).
          if (hasComponent(this.world.ecs, DeadTag, this.playerEid)) {
            removeComponent(this.world.ecs, DeadTag, this.playerEid);
          }
          if (hasComponent(this.world.ecs, RespawnPending, this.playerEid)) {
            removeComponent(this.world.ecs, RespawnPending, this.playerEid);
          }
        } else if (eid !== null) {
          Health.current[eid] = 100;
          // Snap the puppet: clear stale interp samples so it doesn't
          // glide across the map to the new spawn.
          const data = remotePlayerRegistry.get(eid);
          if (data) data.samples.length = 0;
          Position.x[eid] = msg.spawn.x;
          // Server sends x/z/yaw only; resolve y from the shared deterministic
          // terrain sampler (flat GROUND_TOP_Y on Arena v1). Safe by design —
          // client and server agree on terrain geometry (#206).
          Position.y[eid] =
            getGroundHeightAt(this.world.arena, msg.spawn.x, msg.spawn.z) +
            CHARACTER_CONTROLLER_OFFSET;
          Position.z[eid] = msg.spawn.z;
          Rotation.y[eid] = msg.spawn.yaw;
        }
        break;
      }
      case 'scores':
        this.matchState.scores = msg.list;
        break;
      case 'clock':
        this.matchState.remainingMs = msg.remainingMs;
        this.matchState.live = msg.live;
        break;
      case 'matchEnd':
        this.matchState.live = false;
        this.matchState.finalStandings = msg.standings;
        this.matchState.remainingMs = msg.intermissionMs;
        break;
      case 'matchStart':
        this.matchState.live = true;
        this.matchState.finalStandings = null;
        this.matchState.remainingMs = msg.durationMs;
        break;
      default:
        break;
    }
  }

  private eidFor(netId: string): number | null {
    if (netId === this.client.myId) return this.playerEid;
    return remoteByNetId.get(netId) ?? null;
  }

  private teleportLocal(spawn: NetSpawn): void {
    const eid = this.playerEid;
    // Resolve y from the shared deterministic terrain sampler (flat
    // GROUND_TOP_Y on Arena v1) — server sends x/z/yaw only (#206).
    const y =
      getGroundHeightAt(this.world.arena, spawn.x, spawn.z) +
      CHARACTER_CONTROLLER_OFFSET;
    Position.x[eid] = spawn.x;
    Position.y[eid] = y;
    Position.z[eid] = spawn.z;
    // PreviousPosition too — otherwise the render lerp glides across the map.
    PreviousPosition.x[eid] = spawn.x;
    PreviousPosition.y[eid] = y;
    PreviousPosition.z[eid] = spawn.z;
    const body = getPhysicsBody(eid);
    if (body) {
      // IMMEDIATE setTranslation, NOT setNextKinematicTranslation: this
      // runs from a WebSocket callback, outside the fixedUpdate ordering.
      // A queued kinematic target only commits at the next physics step,
      // and MovementSystem reads the STALE `body.translation()` before
      // that step and re-queues its own value — silently discarding the
      // teleport (observed live: a joining client never left the boot
      // spawn). processRespawns can use the queued variant only because
      // it runs after MovementSystem and before step() every tick.
      body.setTranslation({ x: spawn.x, y, z: spawn.z }, true);
    }
    Rotation.y[eid] = spawn.yaw;
  }

  private applyHp(
    victimNetId: string,
    hp: number,
    fromNetId: string,
    dmg: number,
    region: number,
    weaponId: number,
    attackDir: number,
  ): void {
    const victimEid = this.eidFor(victimNetId);
    if (victimEid === null) return;
    const attackerEid = fromNetId ? this.eidFor(fromNetId) : null;

    Health.current[victimEid] = hp;

    if (victimEid === this.playerEid) {
      // Getting hit in multiplayer should FEEL like getting hit: record
      // attribution (killfeed credit if this kills us), flinch the FSM,
      // and take the weapon's knockback from the attacker's direction.
      if (attackerEid !== null) {
        recordDamageAttribution(this.playerEid, attackerEid, weaponId, region);
      }
      const fsm = fsmRegistry.get(this.playerEid);
      fsm?.transition(CombatInput.HitReceived);

      if (attackerEid !== null && hasComponent(this.world.ecs, KnockbackState, this.playerEid)) {
        const config = weaponConfigs[weaponIdToName[weaponId] ?? ''];
        const kb = config?.knockback ?? DEFAULT_KNOCKBACK;
        let ux = Position.x[this.playerEid] - Position.x[attackerEid];
        let uz = Position.z[this.playerEid] - Position.z[attackerEid];
        const len = Math.hypot(ux, uz);
        if (len > 1e-6) {
          ux /= len;
          uz /= len;
          KnockbackState.vx[this.playerEid] += ux * kb.force;
          KnockbackState.vz[this.playerEid] += uz * kb.force;
          KnockbackState.vy[this.playerEid] = Math.max(
            KnockbackState.vy[this.playerEid],
            kb.upward,
          );
          const speed =
            Math.hypot(KnockbackState.vx[this.playerEid], KnockbackState.vz[this.playerEid]) +
            KnockbackState.vy[this.playerEid];
          KnockbackState.ticksRemaining[this.playerEid] = Math.max(
            KnockbackState.ticksRemaining[this.playerEid],
            Math.min(60, Math.round(speed * 5)),
          );
        }
      }
    }

    // Floating damage numbers on any victim with the IsNPC chrome (remote
    // players have it) — reuse the DamageDealt fan-out.
    EventBus.emit('DamageDealt', {
      victimEid,
      attackerEid: attackerEid ?? 0,
      amount: dmg,
      bodyRegion: region,
      weaponId,
      attackDirection: attackDir as Direction,
      isLethal: hp <= 0,
      tick: getCurrentFixedTick(),
    });
  }

  // ── Per-tick work (call from fixedUpdate) ──────────────

  /**
   * Intercept local DamageEvents aimed at REMOTE players. Must run AFTER
   * TracerSystem and BEFORE DamageSystem in the fixedUpdate sequence.
   */
  interceptClaims(): void {
    const events = damageEventQuery(this.world.ecs);
    for (let i = 0; i < events.length; i++) {
      const eventEid = events[i];
      const targetEid = DamageEvent.targetEid[eventEid];
      if (!hasComponent(this.world.ecs, RemotePlayer, targetEid)) continue;

      const data = remotePlayerRegistry.get(targetEid);
      const attackDir = DamageEvent.attackDirection[eventEid] as Direction;

      // Attacker-side block judgment against the replicated combat state:
      // same-direction blocking rule as the local DamageSystem.
      const blocking =
        CombatStateComponent.state[targetEid] === CombatState.Blocking &&
        (CombatStateComponent.blockDirection[targetEid] as Direction) === attackDir;

      if (data && !blocking && this.matchState.live) {
        this.client.send({
          t: 'claim',
          v: data.netId,
          dmg: DamageEvent.damage[eventEid],
          w: CombatStateComponent.weaponId[this.playerEid],
          dir: attackDir,
          region: DamageEvent.bodyRegion[eventEid],
        });
      }
      // Consumed either way — the local DamageSystem must never apply
      // HP/hitstun to a server-owned entity.
      removeEntity(this.world.ecs, eventEid);
    }
  }

  /** Send the local player's state at CLIENT_SEND_HZ. */
  sendLocalState(): void {
    this.sendAccumulator++;
    if (this.sendAccumulator < SEND_INTERVAL_TICKS) return;
    this.sendAccumulator = 0;
    if (this.client.status !== 'connected') return;
    const eid = this.playerEid;
    if (hasComponent(this.world.ecs, DeadTag, eid)) return;
    this.client.send({
      t: 'state',
      p: { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] },
      yaw: Rotation.y[eid],
      // Camera pitch — MovementSystem stashes it in Rotation.x each tick.
      // Remotes lean their chest by this so their swing renders at the
      // height they're actually aiming (hit-accuracy pass, PR #199).
      pitch: Rotation.x[eid],
      cs: {
        s: CombatStateComp.state[eid],
        d: CombatStateComp.direction[eid],
        pt: CombatStateComp.phaseT[eid],
        // Single-source weaponId: CombatStateComponent is what equipWeapon
        // writes and what interceptClaims sends — reading the animation
        // mirror here risked a wire mismatch (QA note #3 on PR #193).
        w: CombatStateComponent.weaponId[eid],
      },
    });
  }

  /** Interpolate remote puppets (call each fixed tick before hitboxSystem). */
  updateRemotes(): void {
    remotePlayerSystem(this.world, performance.now());
  }

  /**
   * Multiplayer replacement for the gated local lifecycle: tick the
   * DeathScreen's respawn countdown down (display only — never below 0,
   * never resurrects; the server's `respawn` message does that).
   */
  tickLocalLifecycle(): void {
    const eid = this.playerEid;
    if (
      hasComponent(this.world.ecs, DeadTag, eid) &&
      hasComponent(this.world.ecs, RespawnPending, eid) &&
      RespawnPending.ticksRemaining[eid] > 0
    ) {
      RespawnPending.ticksRemaining[eid] -= 1;
    }
  }
}
