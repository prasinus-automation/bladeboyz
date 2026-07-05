/**
 * DeathScreen — full-screen overlay shown while the local player is dead.
 *
 * Subscribes to two `EventBus` events:
 *   - `DeathEvent` (where `victimEid === playerEntity`): captures the killer
 *     name + weapon name, then shows the overlay.
 *   - `RespawnEvent` (where `eid === playerEntity`): hides the overlay.
 *
 * Visibility is gated by `DeadTag` on the local player each render frame —
 * events alone are transient, but the ECS tag is the source of truth for
 * "currently dead". This is important because if the user's tab was
 * backgrounded across the moment a `DeathEvent` fired, we still need the
 * overlay to come up correctly when they return.
 *
 * The countdown reads `RespawnPending.ticksRemaining[playerEid]` each frame
 * and renders `Math.ceil(remaining / 60)` (60 Hz fixed counter → integer
 * seconds tick naturally).
 *
 * Pointer events are disabled — clicking through the overlay still hits the
 * canvas (so the player can re-acquire pointer lock if it was released).
 *
 * Z-index 50 sits above gameplay HUD (10) and below modal panels like
 * InventoryPanel / ShopPanel which use 200+. Verified against InventoryPanel
 * before picking.
 *
 * Issue #137. Part of #93 (spawn/death/respawn loop).
 * Design doc: `docs/spawn-death-respawn.md`.
 */

import { hasComponent } from 'bitecs';
import { DeadTag, RespawnPending, Player, IsTrainingDummy } from '../ecs/components';
import type { GameWorld } from '../core/types';
import { EventBus } from '../events/EventBus';
import type { DeathEventPayload, RespawnEventPayload } from '../events/types';
import { weaponIdToName } from '../ecs/systems/CombatSystem';
import { getRemoteName } from '../net/RemotePlayers';

/**
 * Resolve a display name for an entity id.
 *
 * Stub helper — returns generic labels until the networking layer (#92)
 * provides real player names (or until #99 adds names for warmup bots).
 *
 * - `0` → `"the void"` (the sentinel for "no killer" in `DeathEvent.killerEid`)
 * - `world.playerEntity` → `"You"`
 * - any entity tagged `IsTrainingDummy` → `"Dummy <id>"`
 * - any entity tagged `Player` → `"Player"`
 * - everything else → `"Unknown"`
 *
 * The training-dummy branch was migrated from the legacy `activeDummies`
 * array to the `IsTrainingDummy` ECS tag in issue #114 — the resolver is
 * tag-driven now, mirroring the rest of the spawn/death/respawn HUD.
 *
 * TODO(#92): replace with real display names from networked player state.
 */
export function getDisplayName(world: GameWorld, eid: number): string {
  if (eid === 0) return 'the void';
  if (eid === world.playerEntity) return 'You';
  if (hasComponent(world.ecs, IsTrainingDummy, eid)) return `Dummy ${eid}`;
  // Multiplayer: remote players carry their server-verified display name.
  {
    const remoteName = getRemoteName(eid);
    if (remoteName !== null) return remoteName;
  }
  if (hasComponent(world.ecs, Player, eid)) return 'Player';
  return 'Unknown';
}

/**
 * Resolve a display name for a weapon id (index into `weaponIdToName`).
 * Falls back to `"unknown weapon"` for the sentinel `0` when no attribution
 * record exists, even though `0` happens to be a valid weapon index — the
 * design doc treats `0` as "no recorded weapon" when killerEid is also `0`.
 */
function getWeaponName(killerEid: number, weaponId: number): string {
  if (killerEid === 0) return 'no weapon';
  return weaponIdToName[weaponId] ?? 'unknown weapon';
}

export class DeathScreen {
  private container: HTMLElement;
  private killedByLine: HTMLElement;
  private countdown: HTMLElement;

  /** Cached killer info from the last `DeathEvent` for the local player. */
  private lastKillerName = '';
  private lastWeaponName = '';

  /** Cached visible state to skip redundant DOM writes. */
  private lastVisible = false;
  /** Cached integer-seconds countdown to skip redundant text writes. */
  private lastSecondsShown = -1;

  /** Unsubscribe handles from EventBus. */
  private unsubDeath: () => void;
  private unsubRespawn: () => void;

  constructor(private world: GameWorld) {
    this.container = document.createElement('div');
    this.container.id = 'death-screen';
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      pointer-events: none;
      z-index: 50;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      color: #fff;
      font-family: monospace;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.9);
    `;

    this.killedByLine = document.createElement('div');
    this.killedByLine.id = 'death-screen-killed-by';
    this.killedByLine.style.cssText = `
      margin-top: 80px;
      font-size: 22px;
      letter-spacing: 1px;
      color: #f88;
    `;
    this.killedByLine.textContent = '';
    this.container.appendChild(this.killedByLine);

    this.countdown = document.createElement('div');
    this.countdown.id = 'death-screen-countdown';
    this.countdown.style.cssText = `
      margin-top: 28vh;
      font-size: 64px;
      font-weight: bold;
      color: #ffd24a;
    `;
    this.countdown.textContent = '';
    this.container.appendChild(this.countdown);

    document.body.appendChild(this.container);

    // Subscribe BEFORE first update so we don't miss any events that fire
    // between construction and the first render.
    this.unsubDeath = EventBus.on('DeathEvent', (payload: DeathEventPayload) => {
      // Only the LOCAL player drives this overlay. Other deaths show up in
      // the killfeed / scoreboard, not the death screen.
      if (payload.victimEid !== this.world.playerEntity) return;
      this.lastKillerName = getDisplayName(this.world, payload.killerEid);
      this.lastWeaponName = getWeaponName(payload.killerEid, payload.weaponId);
      // Force a text rewrite next update() so the new line shows even if
      // visibility doesn't change in the same render frame.
      this.killedByLine.textContent =
        payload.killerEid === 0
          ? `Killed by ${this.lastKillerName}`
          : `Killed by ${this.lastKillerName} with ${this.lastWeaponName}`;
    });

    this.unsubRespawn = EventBus.on('RespawnEvent', (payload: RespawnEventPayload) => {
      if (payload.eid !== this.world.playerEntity) return;
      // Visibility flip happens in update() — but we can clear the cached
      // killer line so a stale label can't flash next death.
      this.lastKillerName = '';
      this.lastWeaponName = '';
    });
  }

  /**
   * Per-frame update. Reads ECS state to drive visibility + countdown.
   * Cheap when nothing changed — skips DOM writes via `lastVisible` /
   * `lastSecondsShown` caches.
   */
  update(): void {
    const playerEid = this.world.playerEntity;
    // `playerEntity` may be 0 in test setups before the player is created.
    // Bail safely — the overlay simply stays hidden.
    const isDead =
      playerEid !== 0 && hasComponent(this.world.ecs, DeadTag, playerEid);

    if (isDead !== this.lastVisible) {
      this.lastVisible = isDead;
      this.container.style.display = isDead ? 'flex' : 'none';
      // Reset the cached seconds so the first frame after appearing always
      // writes a fresh countdown.
      this.lastSecondsShown = -1;
    }

    if (!isDead) return;

    // Read RespawnPending each frame. If the entity has DeadTag but no
    // RespawnPending (shouldn't happen in production — they're added together
    // by HealthSystem) we just render 0.
    const ticks = hasComponent(this.world.ecs, RespawnPending, playerEid)
      ? RespawnPending.ticksRemaining[playerEid]
      : 0;
    const seconds = Math.max(0, Math.ceil(ticks / 60));
    if (seconds !== this.lastSecondsShown) {
      this.lastSecondsShown = seconds;
      this.countdown.textContent = String(seconds);
    }
  }

  /** Force the overlay open with the given killer line — test helper. */
  showFor(killerEid: number, weaponId: number): void {
    this.lastKillerName = getDisplayName(this.world, killerEid);
    this.lastWeaponName = getWeaponName(killerEid, weaponId);
    this.killedByLine.textContent =
      killerEid === 0
        ? `Killed by ${this.lastKillerName}`
        : `Killed by ${this.lastKillerName} with ${this.lastWeaponName}`;
  }

  /** Whether the overlay is currently visible. Test helper. */
  get isVisible(): boolean {
    return this.lastVisible;
  }

  dispose(): void {
    this.unsubDeath();
    this.unsubRespawn();
    this.container.remove();
  }
}
