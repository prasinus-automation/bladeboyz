/**
 * CombatFSM — Per-entity finite state machine for directional melee combat.
 * **FSM v2 (#88, #135)** — 7-state model, all writes funneled through
 * `transition()` and `_transitionTo()`.
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
 * Out of scope for #135 (issue B):
 * - `CombatStateComponent` + `CombatStateComp` unification (issue C, #136)
 * - Direction model unification into a single `Direction` enum (issue D, #139)
 * - DamageSystem dispatching FSM events instead of direct writes (issue E)
 */

import { CombatState } from './states';
import { AttackDirection, BlockDirection } from './directions';
import type { WeaponConfig } from '../weapons/WeaponConfig';

// ── Input types ──────────────────────────────────────────

/**
 * Inputs the FSM can react to. Every input is dispatched via
 * `FSM.transition(input, payload?)` — no system writes `_state` directly.
 *
 * Payload conventions (`payload?: number`):
 * - `Attack(dir)` — payload is an `AttackDirection`
 * - `Block(dir)` — payload is a `BlockDirection`
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

  private _attackDirection: AttackDirection = AttackDirection.Stab;
  private _blockDirection: BlockDirection = BlockDirection.Top;
  private _weaponConfig: WeaponConfig;

  /** Pending stamina events produced this tick, consumed by CombatSystem. */
  private _pendingStaminaEvents: FSMStaminaEvent[] = [];

  /** Buffered Attack input received during Recovery; fires on Recovery end. */
  private _comboBuffered = false;
  private _comboDirection: AttackDirection = AttackDirection.Stab;

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

  constructor(weaponConfig: WeaponConfig) {
    this._weaponConfig = weaponConfig;
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

  get attackDirection(): AttackDirection {
    return this._attackDirection;
  }

  get blockDirection(): BlockDirection {
    return this._blockDirection;
  }

  /**
   * Unified direction getter — returns the block direction in defensive
   * states (Blocking/Parry), the attack direction otherwise. Forward-compat
   * with issue D's unified `Direction` enum.
   */
  get direction(): AttackDirection | BlockDirection {
    return this._state === CombatState.Blocking || this._state === CombatState.Parry
      ? this._blockDirection
      : this._attackDirection;
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
   * Set the block direction without changing state. Used by the training
   * dummy debug tool (J key) to cycle which direction it's blocking
   * mid-block, without re-entering Blocking and re-opening the parry window.
   */
  setBlockDirection(direction: BlockDirection): void {
    this._blockDirection = direction;
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
   * - `Attack`: payload = `AttackDirection`
   * - `Block`: payload = `BlockDirection`
   * - others: payload ignored
   */
  transition(input: CombatInput, payload?: number): boolean {
    if (!this.canTransition(input)) return false;

    switch (input) {
      case CombatInput.Attack:
        return this._handleAttack((payload ?? AttackDirection.Stab) as AttackDirection);
      case CombatInput.Block:
        return this._handleBlock((payload ?? BlockDirection.Top) as BlockDirection);
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
   */
  private _transitionTo(newState: CombatState): void {
    this._state = newState;
  }

  // ── Private: input handlers ──────────────────────────

  private _handleAttack(direction: AttackDirection): boolean {
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
      if (direction === this._attackDirection) return false;
      this._enterWindup(direction, /* isMorph */ true);
      return true;
    }
    // Idle → Windup
    this._enterWindup(direction, /* isMorph */ false);
    return true;
  }

  private _handleBlock(blockDir: BlockDirection): boolean {
    // Block from Idle or Recovery → Blocking with fresh parry window.
    // Cancel any buffered combo so RMB cleanly aborts a chain.
    this._comboBuffered = false;
    this._isComboRecovery = false;
    this._blockDirection = blockDir;
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

  private _enterWindup(direction: AttackDirection, isMorph: boolean): void {
    this._transitionTo(CombatState.Windup);
    this._attackDirection = direction;
    this._phaseElapsed = 0;
    this._phaseTotal = this._weaponConfig.windup[direction];
    if (!isMorph) {
      // Morph reuses the original swing's stamina charge — only fresh
      // entries from Idle or combo-buffered Windup spend stamina.
      this._pendingStaminaEvents.push({ type: 'attack' });
    }
  }

  private _enterRelease(): void {
    this._transitionTo(CombatState.Release);
    this._phaseElapsed = 0;
    this._phaseTotal = this._weaponConfig.release[this._attackDirection];
  }

  private _enterRecovery(): void {
    this._transitionTo(CombatState.Recovery);
    this._phaseElapsed = 0;
    const timings = this._isComboRecovery
      ? this._weaponConfig.comboRecovery
      : this._weaponConfig.recovery;
    this._phaseTotal = timings[this._attackDirection];
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
  const fsm = new CombatFSM(weaponConfig);
  fsmRegistry.set(entityId, fsm);
  return fsm;
}

/** Remove an entity's FSM. */
export function removeFSM(entityId: number): void {
  fsmRegistry.delete(entityId);
}
