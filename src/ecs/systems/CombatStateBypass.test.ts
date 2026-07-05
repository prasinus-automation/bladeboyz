/**
 * **Canary test (#174).** Detects new bypasses of the CombatFSM by direct
 * writes to `CombatStateComponent.state[eid] = X`.
 *
 * The funneled-writes invariant on `CombatFSM` (see `CombatFSM.test.ts`'s
 * `'invariant: _state is only written through _transitionTo'`) guarantees
 * that the FSM's *internal* `_state` is only mutated through
 * `_transitionTo`. But that invariant doesn't help if a system writes
 * directly to the ECS-side `CombatStateComponent.state` slot — those
 * writes get clobbered by `CombatSystem.ts:139` on the next fixed tick
 * (CombatSystem's authoritative `state = fsm.state` sync), which is
 * exactly the user-visible "I land a hit but the target doesn't flinch /
 * keeps swinging through it / the hitstop animation flickers for one
 * frame" bug filed as #141.
 *
 * This test does NOT fix #141. It fences off the surface so the day
 * someone adds a NEW direct write — outside the known allowlist and the
 * three known #141 bypass sites — CI fails loudly and the bypass is
 * caught in review instead of shipping.
 *
 * ## Allowlist categories
 *
 * 1. **Init writes** (`createPlayer.ts`, `createTrainingDummy.ts`) — entity
 *    factories set the initial Idle state at spawn before the FSM exists
 *    in `fsmRegistry`.
 * 2. **Authoritative FSM-ECS sync writes** (`CombatSystem.ts`,
 *    `StaminaSystem.ts`, `createTrainingDummy.ts`) — every tick CombatSystem
 *    writes `state = fsm.state` to mirror the FSM into the component.
 *    StaminaSystem performs the same mirror immediately after dispatching
 *    `BlockBreak`. createTrainingDummy's debug helpers
 *    (`toggleTrainingDummyBlock`, `cycleTrainingDummyBlockDirection`,
 *    `resetAllTrainingDummies`) mirror eagerly so callers see the change
 *    without waiting for the next CombatSystem tick.
 * 3. **Death reset** (`processDeaths.ts:113`) — forces Idle when an
 *    entity dies, before the FSM gets to react.
 * 4. **No-FSM defensive fallback** (`StaminaSystem.ts:137`) — when an
 *    entity has no registered FSM (legacy / test fixtures), the system
 *    writes HitStun directly. Documented in AGENTS.md.
 *
 * ## Known #141 bypasses (will be removed by #141)
 *
 * `DamageSystem.ts` writes the attacker's/target's combat state directly
 * in three places. These are the bug sites #141 will fix; the canary
 * tolerates them today via an exact source-snippet match. Any drift in
 * the snippet will fail this test, surfacing the bypass site again.
 *
 * Once #141 lands, delete the entire `KNOWN_141_BYPASSES` map below.
 */

import { describe, it, expect } from 'vitest';

// Vite glob: load every .ts file under src/ as raw text, eagerly. The leading
// `/` makes it project-root absolute so the result keys are predictable
// (`/src/...`).
const sourceFiles = import.meta.glob('/src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Production source files where direct `CombatStateComponent.state[X] = Y`
// writes are tolerated (init, FSM-ECS sync, death reset, no-FSM fallback).
// Listed by project-rooted path; the glob keys are matched verbatim.
const ALLOWED_FILES = new Set<string>([
  '/src/ecs/entities/createPlayer.ts',
  '/src/ecs/entities/createTrainingDummy.ts',
  // Init write only (warmup bot factory, #119) — same category as the
  // player/dummy factories above.
  '/src/ecs/entities/createWarmupBot.ts',
  '/src/ecs/systems/CombatSystem.ts',
  '/src/ecs/systems/StaminaSystem.ts',
  '/src/ecs/systems/processDeaths.ts',
]);

// `import.meta.glob` may return paths starting with `/src` OR `src` depending
// on Vite version / config. Normalize.
function normalizePath(p: string): string {
  return p.startsWith('/') ? p : '/' + p;
}

// Known bypass sites (#141). Tolerated today; will be removed when #141
// lands. Each entry is the trimmed source snippet that the canary
// tolerates — drift in the snippet (e.g. someone changes the variable
// name) will break the match and re-flag the line as a new offender.
const KNOWN_141_BYPASSES: Record<string, string[]> = {
  '/src/ecs/systems/DamageSystem.ts': [
    'CombatStateComponent.state[attackerEid] = CombatState.HitStun;',
    'CombatStateComponent.state[attackerEid] = CombatState.Recovery;',
    'CombatStateComponent.state[targetEid] = CombatState.HitStun;',
  ],
};

// Match `CombatStateComponent.state[<expr>] = <expr>` (assignment, NOT
// comparison `===`/`==`). The negative lookahead avoids matching
// `... === ...`.
const WRITE_PATTERN = /CombatStateComponent\.state\s*\[[^\]]+\]\s*=(?!=)/;

interface Offender {
  file: string;
  line: number;
  text: string;
}

describe('canary: direct writes to CombatStateComponent.state are funneled (#174)', () => {
  it('every direct write lives in an allowlisted file or a known #141 bypass site', () => {
    const offenders: Offender[] = [];

    for (const [rawPath, contents] of Object.entries(sourceFiles)) {
      const path = normalizePath(rawPath);
      // Skip test fixtures — tests are allowed to seed component state directly.
      if (path.endsWith('.test.ts') || path.endsWith('.d.ts')) continue;
      // Skip the canary itself — its `WRITE_PATTERN` literal would otherwise
      // self-match inside this very file (see the regex source above).
      if (path.endsWith('/CombatStateBypass.test.ts')) continue;
      // Skip whitelisted files — direct writes here are legitimate
      // (init / authoritative FSM-ECS sync / death reset / no-FSM fallback).
      if (ALLOWED_FILES.has(path)) continue;

      const lines = contents.split('\n');
      const knownSnippets = KNOWN_141_BYPASSES[path] ?? [];

      for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        if (!WRITE_PATTERN.test(text)) continue;
        // Skip block-comment continuation lines (lines starting with `*`)
        // so docs that mention `CombatStateComponent.state[…] = X` aren't
        // counted as code.
        if (/^\s*\*/.test(text)) continue;

        const trimmed = text.trim();
        // Tolerate exact known #141 sites — matched by full trimmed line.
        if (knownSnippets.some((known) => trimmed.includes(known))) continue;

        offenders.push({ file: path, line: i + 1, text: trimmed });
      }
    }

    if (offenders.length > 0) {
      const summary = offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join('\n');
      throw new Error(
        `Found ${offenders.length} new direct write(s) to ` +
          `CombatStateComponent.state outside the allowlist:\n${summary}\n\n` +
          `Either: (a) route the write through the FSM via ` +
          `fsm.transition(CombatInput.X), or (b) add the file to ` +
          `ALLOWED_FILES in CombatStateBypass.test.ts with a comment ` +
          `explaining why the bypass is correct (init / FSM-ECS sync / etc.).`,
      );
    }

    expect(offenders).toEqual([]);
  });

  it('the three known #141 bypass sites still exist (will fail when #141 lands)', () => {
    // Sanity check: if #141 lands and removes one of these snippets, this
    // test fails — that's the prompt to clean up the KNOWN_141_BYPASSES
    // map AND delete this test, since the bypass is gone.
    const damagePath = '/src/ecs/systems/DamageSystem.ts';
    let contents = sourceFiles[damagePath];
    if (!contents) {
      // Fallback in case the glob omits the leading slash on this Vite version.
      const fallback = Object.entries(sourceFiles).find(([k]) =>
        normalizePath(k) === damagePath,
      );
      if (fallback) contents = fallback[1];
    }
    expect(contents).toBeDefined();
    for (const snippet of KNOWN_141_BYPASSES[damagePath]) {
      expect(contents).toContain(snippet);
    }
  });
});
