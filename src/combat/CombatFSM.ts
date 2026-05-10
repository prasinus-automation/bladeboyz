/**
 * CombatFSM — Per-entity finite state machine for directional melee combat.
 * **FSM v2 (#88, #135, #139)** — 7-state model with unified `Direction`
 * enum, all writes funneled through `transition()` and `_transitionTo()`.
 *
 * Pure TypeScript logic — no Three.js, no Rapier, no DOM dependencies.
 * All timing is in ticks (1 tick = 1/60th second at 60 Hz fixed update).
 *
 * ## Invariant
 *
 * **Only `_transitionTo(newState)` mutates the internal `_state` field.**
 * Every external state change goes through `transition(input, payload)`.
 * This is the discipline that makes v2 correct — see `docs/combat-fsm-v2.md`
 * §3 (transition rules). If you find yourself wanting to write
 * `this._state = X` outside `_transitionTo`, you're probably implementing a
 * side effect that should live in the entry helper for state X.
 *
 * Out of scope:
 * - `CombatStateComponent` + `CombatStateComp` unification (issue C, #136)
 * - DamageSystem dispatching FSM events instead of direct writes (issue E)
 */

import { CombatState, COMBAT_STATE_NAMES } from './states';
import { Direction, DIRECTION_NAMES } from './directions';
import type { WeaponConfig } from '../weapons/WeaponConfig';
import { getCurrentFixedTick } from '../core/tickCounter';

// ── Dev-mode tracing (#174) ──────────────────────────────

/**
 * Master switch for dev-only FSM transition logging + phaseTotal=0 watchdog
 * warnings. Defaults to `import.meta.env.DEV` so the entire log/warn block
 * tree-shakes out of production builds (Vite drops `import.meta.env.DEV`-
 * guarded code when `DEV === false`).
 *
 * Exported so tests can flip it off when verifying the silent-prod contract.
 * Production code should never read this directly.
 */
export let FSM_TRACE_ENABLED = import.meta.env.DEV;

/** Test-only — set the trace flag. Production code must not call this. */
export function setFsmTraceEnabled(enabled: boolean): void {
  FSM_TRACE_ENABLED = enabled;
}

/** Human-readable labels for `CombatInput`. Const enum → no reverse lookup. */
const INPUT_NAMES: Record<number, string> = {
  0: 'Attack',
  1: 'Block',
  2: 'ReleaseBlock',
  3: 'HitReceived',
  4: 'BlockedHit',
  5: 'ParryTriggered',
  6: 'WasParried',
  7: 'BlockBreak',
};

// ── Input types ──────────────────────────────────────────

/**
 * Inputs the FSM can react to. Every input is dispatched via
 * `FSM.transition(input, payload?)` — no system writes `_state` directly.
 *
 * Payload conventions (`payload?: number`):
 * - `Attack(dir)` — payload is a `Direction`
 * - `Block(dir)` — payload is a `Direction`
 * - all others — no payload
 */
export const enum CombatInput {
  /** `Attack(direction)` — gated on stamina ≥ `staminaCost.attack`. */
  Attack = 0,
  /** `Block(direction)` — RMB just-press; opens parry window when from Idle/Recovery. */
  Block = 1,
  /** RMB released — exits Blocking back to Idle. */
  ReleaseBlock = 2,
  /** Dispatched by DamageSystem when a hit lands on a non-blocking target. */
  HitReceived = 3,
  /** Dispatched by DamageSystem when defender successfully blocks (parry window expired). */
  BlockedHit = 4,
  /** Dispatched by DamageSystem when defender parries (parry window active + direction matches). */
  ParryTriggered = 5,
  /** Dispatched to attacker by DamageSystem when their swing was parried. */
  WasParried = 6,
  /** Dispatched by StaminaSystem when stamina hits 0 while in Blocking. */
  BlockBreak = 7,
}

// ── Stamina cost event type ──────────────────────────────

/**
 * Stamina-cost event emitted by the FSM, drained by CombatSystem each tick
 * and forwarded to StaminaSystem via `queueStaminaCost`.
 *
 * The `'feint'` value is preserved as a legal type so the StaminaSystem's
 * existing typed switch keeps narrowing correctly even though FSM v2 doesn't
 * emit it; once `staminaCost.feint` is fully removed (post-MVP re-add of
 * Feint behind a weapon flag) this type narrows to the three v2 values.
 */
export interface FSMStaminaEvent {
  type: 'attack' | 'block' | 'parry' | 'feint';
}

// ── HitStun entry mode ───────────────────────────────────

/**
 * Internal — encodes which duration to use when entering HitStun.
 * v2 collapses Stunned + block-break into a single HitStun state with
 * three possible durations (normal hit / parry / block-break).
 */
const enum HitStunMode {
  Normal = 0,
  Parried = 1,
  BlockBreak = 2,
}

// ── FSM class ────────────────────────────────────────────

export class CombatFSM {
  private _state: CombatState = CombatState.Idle;
  private _phaseElapsed = 0;
  private _phaseTotal = 0;

  /**
   * Unified direction (FSM v2, #139). Represents the most-recent direction
   * payload from an `Attack` or `Block` input. v1's separate `_attackDirection`
   * + `_blockDirection` slots were collapsed because the new direction model
   * uses a single 4-value enum for both attack and block intent.
   *
   * Default `Overhead` matches the v1 `_blockDirection = BlockDirection.Top`
   * default (Top mapped to Overhead in #139's enum unification).
   */
  private _direction: Direction = Direction.Overhead;
  private _weaponConfig: WeaponConfig;

  /** Pending stamina events produced this tick, consumed by CombatSystem. */
  private _pendingStaminaEvents: FSMStaminaEvent[] = [];

  /** Buffered Attack input received during Recovery; fires on Recovery end. */
  private _comboBuffered = false;
  /** Direction the buffered combo will swing in. Overwritten on every buffer. */
  private _comboDirection: Direction = Direction.Overhead;

  /**
   * Set true when an Attack is buffered during Recovery; the resulting
   * combo swing's Recovery uses `comboRecovery` ticks instead of the
   * full `recovery` ticks. Reset to false on Idle entry.
   *
   * Public via the `isComboRecovery` getter so external consumers (e.g. a
   * future server-authoritative replay) can read it without poking at the
   * FSM internals.
   */
  private _isComboRecovery = false;

  /**
   * Tracks whether the most recent `Blocking` entry was triggered by an
   * RMB just-press (Idle→Blocking or Recovery→Blocking). Set to false when
   * Blocking is re-entered from a Parry phase-end — that's the held-RMB
   * case where the defender doesn't get a fresh parry window.
   *
   * `parryActive` reads this together with `phaseElapsed` and
   * `weapon.parryWindow` to decide whether incoming hits can be parried.
   */
  private _blockingEntryWasJustPress = false;

  /**
   * Tracks whether RMB was still held when Parry was entered. Set true on
   * Parry entry; flipped to false if `ReleaseBlock` fires while in Parry.
   * On Parry phase-end: held → re-enter Blocking; released → return to Idle.
   */
  private _rmbHeldDuringParry = false;

  /**
   * Entity id this FSM belongs to. Used only for dev-mode transition
   * logging (#174). Defaults to 0 when constructed without an id (tests
   * that drive the FSM directly) — `createFSM(eid, …)` threads the real
   * eid through.
   */
  private _eid: number;

  /**
   * Most recent `CombatInput` that triggered a transition. Set at the top
   * of `transition()` before any state-mutating code runs; cleared back to
   * `undefined` at the bottom of `transition()` so auto-transitions fired
   * by `_onPhaseEnd()` log as `auto` instead of inheriting the previous
   * external input. Dev-mode only — read by `_transitionTo` when logging.
   */
  private _lastInput: CombatInput | undefined = undefined;

  constructor(weaponConfig: WeaponConfig, eid = 0) {
    this._weaponConfig = weaponConfig;
    this._eid = eid;
  }

  // ── Getters ──────────────────────────────────────────

  get state(): CombatState {
    return this._state;
  }

  /**
   * Ticks since entering the current state. Increments every `tick()`.
   *
   * - In states with `phaseTotal > 0` (Windup/Release/Recovery/Parry/HitStun)
   *   the FSM auto-transitions when `phaseElapsed >= phaseTotal`.
   * - In Idle/Blocking (`phaseTotal == 0`) phaseElapsed still increments —
   *   Blocking uses it for the parry-window check.
   */
  get phaseElapsed(): number {
    return this._phaseElapsed;
  }

  /**
   * Total ticks for the current state's phase. 0 in states with no fixed
   * duration (Idle, Blocking) — those exit on input only.
   */
  get phaseTotal(): number {
    return this._phaseTotal;
  }

  /**
   * Backward-compat shim. v1 callers (CombatSystem, HUD) read
   * `ticksRemaining` to mirror onto `CombatStateComponent.ticksRemaining`.
   * v2 stores the elapsed counter forward; expose the remaining ticks as
   * `max(0, total - elapsed)` so callers don't have to migrate.
   */
  get ticksRemaining(): number {
    if (this._phaseTotal <= 0) return 0;
    const remaining = this._phaseTotal - this._phaseElapsed;
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Current direction — single field after FSM v2's direction unification
   * (#139). The semantic interpretation depends on `state`: in Blocking /
   * Parry it's the block direction, otherwise it's the attack direction
   * (or the most recent attack direction in Idle).
   */
  get direction(): Direction {
    return this._direction;
  }

  /**
   * Backward-compat alias of `direction`. Kept so existing CombatSystem
   * mirroring (which writes the old `attackDirection`/`blockDirection` ECS
   * slots) doesn't have to fork on state. With the unified enum, both ECS
   * slots receive the same numeric value.
   */
  get attackDirection(): Direction {
    return this._direction;
  }

  /** Backward-compat alias of `direction`. Same value as `attackDirection`. */
  get blockDirection(): Direction {
    return this._direction;
  }

  get weaponConfig(): WeaponConfig {
    return this._weaponConfig;
  }

  /**
   * True iff the entity is in `Blocking` and within the parry window AND
   * the Blocking entry was an RMB just-press (not held-from-Parry).
   * DamageSystem reads this to decide between Parry vs BlockedHit for an
   * incoming attack.
   */
  get parryActive(): boolean {
    if (this._state !== CombatState.Blocking) return false;
    if (!this._blockingEntryWasJustPress) return false;
    return this._phaseElapsed <= this._weaponConfig.parryWindow;
  }

  /**
   * True iff the next Recovery entry will use `weapon.comboRecovery` instead
   * of `weapon.recovery`. Set when an Attack is buffered during Recovery,
   * reset on Idle entry.
   */
  get isComboRecovery(): boolean {
    return this._isComboRecovery;
  }

  /**
   * True iff the most recent Blocking entry was triggered by an RMB
   * just-press. Used by `parryActive`; exposed for tests + future
   * networking authority that needs to replay the parry-window decision.
   */
  get blockingEntryWasJustPress(): boolean {
    return this._blockingEntryWasJustPress;
  }

  /** Drain pending stamina events (caller is responsible for applying them). */
  drainStaminaEvents(): FSMStaminaEvent[] {
    const events = this._pendingStaminaEvents;
    this._pendingStaminaEvents = [];
    return events;
  }

  /** Set a new weapon config (e.g. on weapon swap). */
  setWeaponConfig(config: WeaponConfig): void {
    this._weaponConfig = config;
  }

  /**
   * Set the direction without changing state. Used by the training dummy
   * debug tool (J key) to cycle which direction it's blocking mid-block,
   * without re-entering Blocking and re-opening the parry window.
   *
   * Named `setBlockDirection` for backward-compat with the dummy code; with
   * FSM v2's unified direction enum (#139) this writes the same `_direction`
   * field as Attack/Block transitions.
   */
  setBlockDirection(direction: Direction): void {
    this._direction = direction;
  }

  // ── Phase math (kept as methods for backward-compat) ─

  /**
   * Total ticks for the current phase. Same as the `phaseTotal` getter —
   * kept as a method because some external callers (CombatSystem, HUD)
   * still use this name.
   */
  getPhaseTotal(): number {
    return this._phaseTotal;
  }

  /**
   * Normalized progress through the current phase, in [0, 1]. Returns 0
   * when the current phase has no fixed duration (Idle, Blocking).
   *
   * `t = phaseElapsed / phaseTotal`
   */
  getPhaseT(): number {
    if (this._phaseTotal <= 0) return 0;
    if (this._phaseElapsed <= 0) return 0;
    if (this._phaseElapsed >= this._phaseTotal) return 1;
    return this._phaseElapsed / this._phaseTotal;
  }

  // ── Turncap ──────────────────────────────────────────

  /**
   * Maximum turn rate in radians/tick for the current state.
   * Returns `Infinity` when no cap applies (Idle / Blocking / Parry).
   *
   * Per `docs/combat-fsm-v2.md` §6: Parry is intentionally uncapped —
   * the parrier is rewarded with free aim while the attacker is staggered.
   * HitStun uses `weapon.turncap.hitStun` (NEW in FSM v2 schema, #131).
   */
  getCurrentTurncap(): number {
    switch (this._state) {
      case CombatState.Windup:
        return this._weaponConfig.turncap.windup;
      case CombatState.Release:
        return this._weaponConfig.turncap.release;
      case CombatState.Recovery:
        return this._weaponConfig.turncap.recovery;
      case CombatState.HitStun:
        return this._weaponConfig.turncap.hitStun;
      default:
        // Idle, Blocking, Parry — no cap (Parry is intentionally uncapped).
        return Infinity;
    }
  }

  // ── Transition logic ─────────────────────────────────

  /**
   * Whether a given input can produce a transition from the current state.
   * This is informational — `transition()` does the same gating before
   * mutating, so callers don't strictly need to check first.
   */
  canTransition(input: CombatInput): boolean {
    const s = this._state;
    switch (input) {
      case CombatInput.Attack:
        return (
          s === CombatState.Idle ||
          s === CombatState.Recovery || // combo buffer
          s === CombatState.Windup // morph (different direction)
        );
      case CombatInput.Block:
        return s === CombatState.Idle || s === CombatState.Recovery;
      case CombatInput.ReleaseBlock:
        return s === CombatState.Blocking || s === CombatState.Parry;
      case CombatInput.HitReceived:
        return s !== CombatState.HitStun;
      case CombatInput.BlockedHit:
        return s === CombatState.Blocking || s === CombatState.Release;
      case CombatInput.ParryTriggered:
        return s === CombatState.Blocking;
      case CombatInput.WasParried:
        return s === CombatState.Release;
      case CombatInput.BlockBreak:
        return s === CombatState.Blocking;
      default:
        return false;
    }
  }

  /**
   * Single entry point for state changes. Returns true iff a transition
   * (or in-state side-effect like a buffered combo) actually occurred.
   *
   * - `Attack`: payload = `Direction`
   * - `Block`: payload = `Direction`
   * - others: payload ignored
   */
  transition(input: CombatInput, payload?: number): boolean {
    if (!this.canTransition(input)) return false;

    // Stamp the input so `_transitionTo` can include it in the dev log line.
    // Cleared in the `finally` so any phase-end auto-transitions that fire
    // *outside* `transition()` (i.e. from `tick()` → `_onPhaseEnd()`) log
    // as `auto` rather than inheriting the previous external input.
    this._lastInput = input;
    try {
      switch (input) {
        case CombatInput.Attack:
          return this._handleAttack((payload ?? Direction.Stab) as Direction);
        case CombatInput.Block:
          // Default to Overhead (formerly BlockDirection.Top) when no payload
          // is supplied — matches the v1 default-to-Top fallback semantics.
          return this._handleBlock((payload ?? Direction.Overhead) as Direction);
        case CombatInput.ReleaseBlock:
          return this._handleReleaseBlock();
        case CombatInput.HitReceived:
          return this._handleHitReceived();
        case CombatInput.BlockedHit:
          return this._handleBlockedHit();
        case CombatInput.ParryTriggered:
          return this._handleParryTriggered();
        case CombatInput.WasParried:
          return this._handleWasParried();
        case CombatInput.BlockBreak:
          return this._handleBlockBreak();
        default:
          return false;
      }
    } finally {
      this._lastInput = undefined;
    }
  }

  // ── Tick (called once per fixed update) ──────────────

  /**
   * Advance the FSM by one tick. Increments `phaseElapsed` and triggers an
   * auto-transition when the current phase finishes.
   *
   * `phaseElapsed` increments in every state EXCEPT `Idle` — in Idle there's
   * no animation-relevant clock to track. Blocking has no fixed duration
   * (`phaseTotal == 0`) but still increments because the parry-window check
   * compares `phaseElapsed` against `weapon.parryWindow`.
   */
  tick(): void {
    if (this._state === CombatState.Idle) return;
    this._phaseElapsed++;
    if (this._phaseTotal > 0 && this._phaseElapsed >= this._phaseTotal) {
      this._onPhaseEnd();
    }
  }

  /** Force-reset to Idle (e.g. on death/respawn). */
  reset(): void {
    this._transitionTo(CombatState.Idle);
    this._phaseElapsed = 0;
    this._phaseTotal = 0;
    this._pendingStaminaEvents = [];
    this._comboBuffered = false;
    this._isComboRecovery = false;
    this._blockingEntryWasJustPress = false;
    this._rmbHeldDuringParry = false;
  }

  // ── Private: the ONLY state-mutator ─────────────────

  /**
   * **The single place `_state` is written.** All entry/exit side effects
   * (timer reset, stamina emission, direction recording) happen in the
   * `_enterX` helpers around this call.
   *
   * Emits a `[FSM]` console.log in dev mode (#174) so swing transitions
   * are traceable without a debugger. The entire log block is gated on
   * `import.meta.env.DEV` AND the runtime `FSM_TRACE_ENABLED` flag — Vite
   * tree-shakes the block out of production builds (any string referenced
   * only inside the dropped block, including `'[FSM]'`, won't appear in
   * the prod bundle).
   */
  private _transitionTo(newState: CombatState): void {
    if (import.meta.env.DEV && FSM_TRACE_ENABLED) {
      const oldState = this._state;
      // Use the lookup tables — `CombatState`, `Direction`, and `CombatInput`
      // are all const enums, so `Enum[value]` reverse lookup is erased at
      // compile time and unavailable at runtime.
      const oldName = COMBAT_STATE_NAMES[oldState] ?? oldState;
      const newName = COMBAT_STATE_NAMES[newState] ?? newState;
      const inputName =
        this._lastInput === undefined
          ? 'auto'
          : (INPUT_NAMES[this._lastInput] ?? this._lastInput);
      const dirName = DIRECTION_NAMES[this._direction] ?? this._direction;
      // Single console.log to keep the dev console readable. Formatting:
      //   [FSM] <eid> <Old> → <New> (input: X, dir: Y, tick: Z)
      // eslint-disable-next-line no-console
      console.log(
        '[FSM]',
        this._eid,
        oldName,
        '→',
        newName,
        '(input:',
        inputName,
        ', dir:',
        dirName,
        ', tick:',
        getCurrentFixedTick(),
        ')',
      );
    }
    this._state = newState;
  }

  /**
   * **`phaseTotal === 0` watchdog (#174).** Called from `_enterWindup`,
   * `_enterRelease`, and `_enterRecovery` immediately after `_phaseTotal`
   * is read from the weapon config.
   *
   * If a weapon ships with `windup[dir] = 0` (or release/recovery), the FSM
   * would auto-transition on the same tick it entered the state because
   * `tick()` checks `phaseElapsed >= phaseTotal` — except `phaseElapsed` is
   * 0 too, so the FSM would stall at `phaseElapsed = phaseTotal = 0` and
   * never advance. The watchdog forces `_phaseTotal = 1` so the state
   * survives at least one full tick before progressing — visually a frame
   * flash, but the FSM never freezes.
   *
   * The fallback runs in BOTH dev and prod (defensive — production should
   * not freeze). The console.warn fires only in dev so production builds
   * stay silent.
   */
  private _assertPhaseTotal(state: CombatState): void {
    if (this._phaseTotal !== 0) return;
    if (import.meta.env.DEV && FSM_TRACE_ENABLED) {
      const stateName = COMBAT_STATE_NAMES[state] ?? state;
      const dirName = DIRECTION_NAMES[this._direction] ?? this._direction;
      // eslint-disable-next-line no-console
      console.warn(
        '[FSM] phaseTotal=0 in',
        stateName,
        '— weapon:',
        this._weaponConfig.name,
        'dir:',
        dirName,
        '(falling back to phaseTotal=1 so FSM auto-progresses)',
      );
    }
    this._phaseTotal = 1;
  }

  // ── Private: input handlers ──────────────────────────

  private _handleAttack(direction: Direction): boolean {
    if (this._state === CombatState.Recovery) {
      // Buffer combo — fires when Recovery ends. The resulting next Recovery
      // will use `comboRecovery` ticks (set `_isComboRecovery = true` here so
      // the flag survives the Windup/Release/Recovery chain).
      this._comboBuffered = true;
      this._comboDirection = direction;
      this._isComboRecovery = true;
      return true;
    }
    if (this._state === CombatState.Windup) {
      // Morph — same FSM, swap direction, restart windup, no extra stamina.
      // Same direction = no-op (avoid burning the morph chance).
      if (direction === this._direction) return false;
      this._enterWindup(direction, /* isMorph */ true);
      return true;
    }
    // Idle → Windup
    this._enterWindup(direction, /* isMorph */ false);
    return true;
  }

  private _handleBlock(blockDir: Direction): boolean {
    // Block from Idle or Recovery → Blocking with fresh parry window.
    // Cancel any buffered combo so RMB cleanly aborts a chain.
    this._comboBuffered = false;
    this._isComboRecovery = false;
    this._direction = blockDir;
    this._enterBlocking(/* wasJustPress */ true);
    return true;
  }

  private _handleReleaseBlock(): boolean {
    if (this._state === CombatState.Blocking) {
      this._enterIdle();
      return true;
    }
    if (this._state === CombatState.Parry) {
      // Stay in Parry; phase-end will route to Idle instead of Blocking.
      this._rmbHeldDuringParry = false;
      return true;
    }
    return false;
  }

  private _handleHitReceived(): boolean {
    this._enterHitStun(HitStunMode.Normal);
    return true;
  }

  private _handleBlockedHit(): boolean {
    if (this._state === CombatState.Blocking) {
      // Defender successfully blocks. Stays in Blocking; emit block stamina.
      // Re-enter is NOT triggered — phaseElapsed continues so a chained
      // hit during the same parry window still resolves correctly.
      this._pendingStaminaEvents.push({ type: 'block' });
      return true;
    }
    if (this._state === CombatState.Release) {
      // Attacker's swing was blocked. Drop into Recovery (no extra stamina).
      this._enterRecovery();
      return true;
    }
    return false;
  }

  private _handleParryTriggered(): boolean {
    if (this._state !== CombatState.Blocking) return false;
    this._enterParry();
    return true;
  }

  private _handleWasParried(): boolean {
    if (this._state !== CombatState.Release) return false;
    this._enterHitStun(HitStunMode.Parried);
    return true;
  }

  private _handleBlockBreak(): boolean {
    if (this._state !== CombatState.Blocking) return false;
    this._enterHitStun(HitStunMode.BlockBreak);
    return true;
  }

  // ── Private: state entry helpers ─────────────────────

  private _enterIdle(): void {
    this._transitionTo(CombatState.Idle);
    this._phaseElapsed = 0;
    this._phaseTotal = 0;
    this._comboBuffered = false;
    this._isComboRecovery = false;
    this._blockingEntryWasJustPress = false;
    this._rmbHeldDuringParry = false;
  }

  private _enterWindup(direction: Direction, isMorph: boolean): void {
    // Write direction BEFORE `_transitionTo` so the dev-mode transition
    // log emits the NEW direction (the value we're swinging in), not the
    // stale prior direction. `_transitionTo` only mutates `_state`, so
    // reordering is functionally a no-op for everything else.
    this._direction = direction;
    this._transitionTo(CombatState.Windup);
    this._phaseElapsed = 0;
    this._phaseTotal = this._weaponConfig.windup[direction];
    this._assertPhaseTotal(CombatState.Windup);
    if (!isMorph) {
      // Morph reuses the original swing's stamina charge — only fresh
      // entries from Idle or combo-buffered Windup spend stamina.
      this._pendingStaminaEvents.push({ type: 'attack' });
    }
  }

  private _enterRelease(): void {
    this._transitionTo(CombatState.Release);
    this._phaseElapsed = 0;
    this._phaseTotal = this._weaponConfig.release[this._direction];
    this._assertPhaseTotal(CombatState.Release);
  }

  private _enterRecovery(): void {
    this._transitionTo(CombatState.Recovery);
    this._phaseElapsed = 0;
    const timings = this._isComboRecovery
      ? this._weaponConfig.comboRecovery
      : this._weaponConfig.recovery;
    this._phaseTotal = timings[this._direction];
    this._assertPhaseTotal(CombatState.Recovery);
  }

  private _enterBlocking(wasJustPress: boolean): void {
    this._transitionTo(CombatState.Blocking);
    this._phaseElapsed = 0;
    this._phaseTotal = 0; // no fixed duration; exits on input
    this._blockingEntryWasJustPress = wasJustPress;
  }

  private _enterParry(): void {
    this._transitionTo(CombatState.Parry);
    this._phaseElapsed = 0;
    this._phaseTotal = this._weaponConfig.parryRecovery;
    // Default: assume RMB still held — phase-end returns to Blocking.
    // ReleaseBlock during Parry flips this to false → phase-end → Idle.
    this._rmbHeldDuringParry = true;
    this._pendingStaminaEvents.push({ type: 'parry' });
  }

  private _enterHitStun(mode: HitStunMode): void {
    this._transitionTo(CombatState.HitStun);
    this._phaseElapsed = 0;
    switch (mode) {
      case HitStunMode.Parried:
        this._phaseTotal = this._weaponConfig.parryStunTicks;
        break;
      case HitStunMode.BlockBreak:
        this._phaseTotal = this._weaponConfig.blockBreakStunTicks;
        break;
      case HitStunMode.Normal:
      default:
        this._phaseTotal = this._weaponConfig.hitStunTicks;
        break;
    }
    // HitStun cancels any pending swing chain — combo buffer / combo flag
    // both clear so the post-stun Recovery → Idle path is clean.
    this._comboBuffered = false;
    this._isComboRecovery = false;
  }

  // ── Private: phase-end auto-transitions ──────────────

  private _onPhaseEnd(): void {
    switch (this._state) {
      case CombatState.Windup:
        this._enterRelease();
        break;

      case CombatState.Release:
        this._enterRecovery();
        break;

      case CombatState.Recovery:
        if (this._comboBuffered) {
          // Chain into the next swing. `_isComboRecovery` stays true so the
          // *next* Recovery uses `comboRecovery` ticks. Dir consumed here.
          const dir = this._comboDirection;
          this._comboBuffered = false;
          this._enterWindup(dir, /* isMorph */ false);
        } else {
          this._enterIdle();
        }
        break;

      case CombatState.Parry:
        if (this._rmbHeldDuringParry) {
          // Common case — RMB still held. Re-enter Blocking, but WITHOUT a
          // fresh parry window (that would let a defender cheese parry
          // forever by parry-then-block-again).
          this._enterBlocking(/* wasJustPress */ false);
        } else {
          // RMB was released during Parry — return to Idle.
          this._enterIdle();
        }
        break;

      case CombatState.HitStun:
        // HitStun → Recovery so the post-stun animation lands cleanly,
        // then Recovery → Idle on its own phase-end.
        this._enterRecovery();
        break;

      // Idle and Blocking have no fixed duration — `tick()` won't fire
      // _onPhaseEnd for them because `phaseTotal == 0`.
      default:
        break;
    }
  }
}

// ── FSM Registry (side-table for per-entity instances) ───

/** `Map<entityId, CombatFSM>` — bitECS can't store objects in components. */
export const fsmRegistry = new Map<number, CombatFSM>();

/** Create and register an FSM for an entity. */
export function createFSM(entityId: number, weaponConfig: WeaponConfig): CombatFSM {
  const fsm = new CombatFSM(weaponConfig, entityId);
  fsmRegistry.set(entityId, fsm);
  return fsm;
}

/** Remove an entity's FSM. */
export function removeFSM(entityId: number): void {
  fsmRegistry.delete(entityId);
}
