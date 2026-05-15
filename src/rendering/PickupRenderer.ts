/**
 * PickupRenderer — variable-rate visual update for ground weapon pickups.
 *
 * Runs from `loop.update(dt)` (NOT `fixedUpdate`) — pure visuals, never
 * gameplay-relevant. Drives three behaviors per pickup entity:
 *
 *   1. **Idle spin**: rotate `group.rotation.y` at `SPIN_RATE` rad/s.
 *   2. **Bob**: gentle vertical sin-wave (~5cm amplitude) so the pickup
 *      reads as "lying on the ground but alive" rather than static prop.
 *   3. **Blink + fade in last 5s**: when fewer than `BLINK_TICKS` ticks
 *      remain before despawn, ramp `material.opacity` 1.0 → 0.3 across the
 *      window AND alternate `group.visible` at ~10Hz. Materials had
 *      `transparent = true` flipped in `createGroundPickupModel` at spawn —
 *      this hot path only mutates `opacity` / `visible`, never `transparent`.
 *
 * **Zero per-frame allocations.** No `new Vector3()`, no `.clone()`. Per-pickup
 * baseline-Y is stashed on `group.userData.pickupBaseY` on first sight; the
 * Three.js `userData` map is reused across frames.
 *
 * Constants — `DESPAWN_TICKS`, `BLINK_TICKS`, `PICKUP_RADIUS` — are the
 * single source of truth for the pickup timeline. They will move to
 * `WeaponPickupSystem.ts` when sibling issue #121 lands. Until then the
 * renderer (and the HUD prompt that reads `PICKUP_RADIUS`) own them.
 */

import { WeaponPickup } from '../ecs/components';
import { pickupRegistry } from '../inventory/PickupRegistry';
import type { GameWorld } from '../core/types';

// ── Pickup timeline constants ────────────────────────────────
//
// As of #121 the canonical home for these is `WeaponPickupSystem.ts` — the
// system that owns drop-on-death, KeyE pickup, and despawn-sweep timing.
// We import them here so this renderer can read them in the fade-window
// math below AND re-export them so existing callers (`PickupPrompt.ts`
// reads `PICKUP_RADIUS`, `PickupRenderer.test.ts` reads all three) don't
// break. New code should import directly from
// `../ecs/systems/WeaponPickupSystem`.
import {
  DESPAWN_TICKS,
  BLINK_TICKS,
  PICKUP_RADIUS,
} from '../ecs/systems/WeaponPickupSystem';
export { DESPAWN_TICKS, BLINK_TICKS, PICKUP_RADIUS };

// ── Visual tuning constants ──────────────────────────────────

/** Idle spin rate (radians per second around world-Y). */
const SPIN_RATE = 0.5;

/** Bob frequency (Hz, peak-to-peak per second). Two oscillations per second. */
const BOB_FREQ = 2.0;

/** Bob amplitude (meters). ~5cm peak displacement above/below baseline. */
const BOB_AMPLITUDE = 0.05;

/** Opacity at despawn moment (lowest visible point of fade ramp). */
const FADE_END_OPACITY = 0.3;

/**
 * Blink period (ticks). Visibility flips every `BLINK_PERIOD_TICKS / 2` ticks.
 * 6 ticks total → on for 3, off for 3 → ~10Hz at 60Hz fixed rate.
 */
const BLINK_PERIOD_TICKS = 6;

/** UserData key for the per-pickup baseline-Y captured on first frame. */
const BASE_Y_KEY = 'pickupBaseY';

/**
 * Tick to elapsed-seconds conversion factor (1/60 at 60Hz). Used for bob
 * phase math so we don't depend on a wall-clock outside the fixed-tick
 * cadence.
 */
const TICK_DT_SECONDS = 1 / 60;

// ── Per-frame system ─────────────────────────────────────────

/**
 * Run the pickup-visuals pass for one render frame.
 *
 * @param _world      Game world (unused today; reserved for future hooks
 *                    that need scene/camera context).
 * @param currentTick Current fixed tick — read from `getCurrentFixedTick()`
 *                    in the caller.
 * @param dt          Frame delta (seconds) — drives spin angular velocity.
 */
export function pickupRenderer(
  _world: GameWorld,
  currentTick: number,
  dt: number,
): void {
  const spinDelta = SPIN_RATE * dt;
  // Blink phase: invariant across all pickups this frame.
  const blinkOn = (Math.floor(currentTick / (BLINK_PERIOD_TICKS / 2)) & 1) === 0;

  for (const [eid, data] of pickupRegistry) {
    const group = data.group;

    // ── Spin ──
    group.rotation.y += spinDelta;

    // ── Bob ──
    // Capture baseline Y on first frame the renderer sees this pickup. The
    // factory placed the group at the spawn position, so userData['baseY']
    // ends up equal to the requested feet-Y on the ground.
    let baseY = group.userData[BASE_Y_KEY] as number | undefined;
    if (baseY === undefined) {
      baseY = group.position.y;
      group.userData[BASE_Y_KEY] = baseY;
    }
    const elapsedTicks = currentTick - WeaponPickup.spawnTick[eid];
    const elapsedSec = elapsedTicks * TICK_DT_SECONDS;
    group.position.y = baseY + Math.sin(elapsedSec * BOB_FREQ) * BOB_AMPLITUDE;

    // ── Blink + fade in last BLINK_TICKS ticks ──
    const despawnTick = WeaponPickup.despawnTick[eid];
    const ticksLeft = despawnTick - currentTick;

    if (ticksLeft <= BLINK_TICKS) {
      // Linear ramp: ticksLeft = BLINK_TICKS → opacity 1.0
      //              ticksLeft = 0          → opacity FADE_END_OPACITY (0.3)
      // Clamp so an entity that overshoots despawn (drained past 0) stays
      // at the floor opacity rather than going negative.
      const t = Math.max(0, Math.min(1, ticksLeft / BLINK_TICKS));
      const opacity = FADE_END_OPACITY + (1 - FADE_END_OPACITY) * t;
      const mats = data.materials;
      for (let i = 0; i < mats.length; i++) {
        mats[i].opacity = opacity;
      }
      group.visible = blinkOn;
    } else {
      // Outside fade window — restore to fully-visible defaults. Cheap
      // (idempotent assignment) and avoids leaving a pickup stuck at low
      // opacity if its despawnTick is mutated by some future system.
      group.visible = true;
      const mats = data.materials;
      for (let i = 0; i < mats.length; i++) {
        if (mats[i].opacity !== 1) mats[i].opacity = 1;
      }
    }
  }
}
