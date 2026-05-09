/**
 * Combat FSM state identifiers — FSM v2 (issue #88, #135).
 *
 * Trimmed from 11 states to **7**. The numeric values are written into
 * `CombatStateComponent.state` (ui8) and read by `DirectionIndicator`,
 * `AnimationSystem`, `ViewmodelAnimationSystem`, `DamageSystem`, and
 * `StaminaSystem` — they MUST stay stable between this enum and any
 * caller comparing against literal numbers (e.g. the `>= 4 && <= 5`
 * range checks in `HUD.ts`/`DirectionIndicator.ts`).
 *
 * Dropped from v1 (see `docs/combat-fsm-v2.md` §2):
 * - `Block`        → renamed to `Blocking`
 * - `ParryWindow`  → folded into `Blocking` (see `parryActive` getter)
 * - `Riposte`      → cut for MVP; post-parry uses normal `Recovery`/`Blocking`
 * - `Feint`        → cut for MVP; re-add behind `canFeint` weapon flag later
 * - `Clash`        → unreachable in v1 code; dropped entirely
 * - `Stunned`      → collapsed into `HitStun`; block-break also routes here
 *
 * Wire format note (relevant when networking lands per
 * `docs/networking/02-replication-and-protocol.md`): re-adding any of the
 * dropped states post-MVP MUST give them new numeric slots — never reuse
 * 4/5/6 since those now mean `Blocking`/`Parry`/`HitStun` on the wire.
 *
 * Note: `AttackDirection` and `BlockDirection` live in `./directions.ts`.
 * `BodyRegion` lives in `../ecs/components.ts`. All timing is in **ticks**
 * (1 tick = 1/60th second at 60 Hz fixed update).
 */
export const enum CombatState {
  Idle = 0,
  Windup = 1,
  Release = 2,
  Recovery = 3,
  Blocking = 4,
  Parry = 5,
  HitStun = 6,
}

/**
 * Human-readable labels for combat states. Indexed by `CombatState` numeric
 * value. Used by HUD's debug FSM label and any other surface that wants
 * to show the current state by name.
 */
export const COMBAT_STATE_NAMES: Record<number, string> = {
  0: 'Idle',
  1: 'Windup',
  2: 'Release',
  3: 'Recovery',
  4: 'Blocking',
  5: 'Parry',
  6: 'HitStun',
};

// ── Movement States ──────────────────────────────────────

export const enum MovementState {
  Idle = 0,
  Walking = 1,
  Running = 2,
  Jumping = 3,
  Crouching = 4,
}
