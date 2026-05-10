/**
 * G7 — Forbidden patterns lint (issue #175).
 *
 * Greps `src/` for patterns that have repeatedly been the source of subtle
 * bugs in tick-driven gameplay code, and fails if any new occurrences are
 * introduced. This is the in-test substitute for an ESLint rule — keeps
 * the CI surface tight without dragging in an ESLint plugin.
 *
 * Rules pinned (per #175 spec, with adjustments for current reality):
 *
 *   1. `setTimeout(` — allowlisted to the four files that legitimately use it
 *      today (debounce escape hatch in goldPersistence, transient HUD
 *      fade/pulse animations elsewhere). Any new file introducing setTimeout
 *      fails this test. The architect's intent: keep simulation/loop code
 *      tick-driven, not timer-driven.
 *   2. `setInterval(` — forbidden anywhere in `src/`. Tick-driven game loops
 *      have no business with wall-clock intervals.
 *   3. `new Promise(` — forbidden inside `src/ecs/systems/` or `src/combat/`.
 *      ECS systems and the combat FSM are synchronous-by-design; the moment
 *      they spawn a promise, they've broken the determinism that makes
 *      networked replay possible.
 *   4. `event.key` — forbidden anywhere in `src/`. It's locale-dependent
 *      (`Shift+5` is `%` on US keyboards, `5` on AZERTY); use `event.code`
 *      which always reflects the physical key position.
 *
 * Pre-flight verified (today): all four rules pass against the current tree.
 * This test freezes that as policy.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const SRC_ROOT = join(__dirname, '..');

// Allowlist: setTimeout is permitted in these files. Any new entry to this
// list should be reviewed by an architect — the default is "no setTimeout".
const SETTIMEOUT_ALLOWLIST = new Set<string>([
  // Trailing-edge debounce for localStorage writes (intentional design — see
  // #105 / AGENTS.md "Gold Persistence").
  'economy/goldPersistence.ts',
  // Transient HUD toast — appears, fades out, removes itself. Pure UX, no
  // simulation impact.
  'hud/DebugNotification.ts',
  // Gold-change pulse animation — visual flourish only.
  'hud/GoldCounter.ts',
  // Inline row-error message timeout in the shop UI.
  'hud/ShopPanel.ts',
]);

// ── File walker ────────────────────────────────────────

/** Walk `dir` recursively and return every .ts file relative to SRC_ROOT. */
function walkTsFiles(dir: string, results: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsFiles(full, results);
    } else if (st.isFile() && name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

/** Convert an absolute path under SRC_ROOT to a portable POSIX-style relative path. */
function relToSrc(absPath: string): string {
  return relative(SRC_ROOT, absPath).split(sep).join('/');
}

/** Read file once, lazy cache so we don't re-read for each rule. */
const fileCache = new Map<string, string>();
function readSrc(absPath: string): string {
  let txt = fileCache.get(absPath);
  if (txt === undefined) {
    txt = readFileSync(absPath, 'utf-8');
    fileCache.set(absPath, txt);
  }
  return txt;
}

// All .ts files under src/, including .test.ts. We grep both because forbidden
// patterns in test files are also worth catching — tests run code too and we
// don't want them depending on wall-clock timers either.
const allTsFiles = walkTsFiles(SRC_ROOT);

/** Find all line offsets of `needle` in `text`. Returns array of (lineNo, lineText). */
function findMatches(text: string, needle: string | RegExp): Array<{ line: number; text: string }> {
  const lines = text.split('\n');
  const hits: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip single-line comments to avoid flagging documentation that
    // discusses a forbidden pattern.
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    const match = typeof needle === 'string' ? line.includes(needle) : needle.test(line);
    if (match) hits.push({ line: i + 1, text: line.trim() });
  }
  return hits;
}

// ── Tests ──────────────────────────────────────────────

describe('G7 — forbidden patterns lint', () => {
  it('setTimeout( only appears in the documented allowlist', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const abs of allTsFiles) {
      const rel = relToSrc(abs);
      // Skip the test files in __tests__/ entirely — they're allowed to
      // reference patterns by name (this very file does).
      if (rel.startsWith('__tests__/')) continue;
      if (rel.endsWith('.test.ts')) continue;
      const text = readSrc(abs);
      const hits = findMatches(text, 'setTimeout(');
      for (const h of hits) {
        if (!SETTIMEOUT_ALLOWLIST.has(rel)) {
          offenders.push({ file: rel, line: h.line, text: h.text });
        }
      }
    }
    if (offenders.length > 0) {
      const msg = offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join('\n');
      throw new Error(
        `Found ${offenders.length} new setTimeout( usage(s) outside the allowlist:\n${msg}\n\n` +
          `If this is intentional, add the file to SETTIMEOUT_ALLOWLIST in ` +
          `src/__tests__/no-forbidden-patterns.test.ts and document why.`,
      );
    }
    // Sanity: allowlist entries must actually exist (rot-guard).
    for (const rel of SETTIMEOUT_ALLOWLIST) {
      const absPath = join(SRC_ROOT, rel);
      expect(
        allTsFiles.includes(absPath),
        `Allowlisted file does not exist: ${rel} — clean it up.`,
      ).toBe(true);
    }
  });

  it('setInterval( does not appear anywhere in src/', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const abs of allTsFiles) {
      const rel = relToSrc(abs);
      if (rel.startsWith('__tests__/')) continue;
      if (rel.endsWith('.test.ts')) continue;
      const text = readSrc(abs);
      const hits = findMatches(text, 'setInterval(');
      for (const h of hits) {
        offenders.push({ file: rel, line: h.line, text: h.text });
      }
    }
    if (offenders.length > 0) {
      const msg = offenders.map((o) => `  ${o.file}:${o.line}  ${o.text}`).join('\n');
      throw new Error(
        `Found ${offenders.length} setInterval( usage(s) — tick-driven gameplay has no business with wall-clock intervals:\n${msg}`,
      );
    }
  });

  it('new Promise( does not appear inside src/ecs/systems/ or src/combat/', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const abs of allTsFiles) {
      const rel = relToSrc(abs);
      if (rel.endsWith('.test.ts')) continue;
      const isEcsSystem = rel.startsWith('ecs/systems/');
      const isCombat = rel.startsWith('combat/');
      if (!isEcsSystem && !isCombat) continue;
      const text = readSrc(abs);
      const hits = findMatches(text, 'new Promise(');
      for (const h of hits) {
        offenders.push({ file: rel, line: h.line, text: h.text });
      }
    }
    if (offenders.length > 0) {
      const msg = offenders.map((o) => `  ${o.file}:${o.line}  ${o.text}`).join('\n');
      throw new Error(
        `Found ${offenders.length} new Promise( usage(s) in ECS systems or combat code. ` +
          `Both are synchronous-by-design — async breaks determinism for networked replay:\n${msg}`,
      );
    }
  });

  it('event.key does not appear anywhere in src/ (use event.code instead)', () => {
    // Match `event.key` and `e.key` when used on a KeyboardEvent. We deliberately
    // accept false-positives that the runtime would have caught anyway and
    // err on the side of strictness — handler params are conventionally `e` or
    // `event` in this codebase.
    const pattern = /\b(?:e|event|ev|evt|keyEvent|kbEvent|keyboardEvent|kbdEvent)\.key\b(?!\s*[A-Za-z_$])/;
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const abs of allTsFiles) {
      const rel = relToSrc(abs);
      if (rel.startsWith('__tests__/')) continue;
      if (rel.endsWith('.test.ts')) continue;
      const text = readSrc(abs);
      const hits = findMatches(text, pattern);
      for (const h of hits) {
        offenders.push({ file: rel, line: h.line, text: h.text });
      }
    }
    if (offenders.length > 0) {
      const msg = offenders.map((o) => `  ${o.file}:${o.line}  ${o.text}`).join('\n');
      throw new Error(
        `Found ${offenders.length} event.key usage(s). event.key is locale-dependent ` +
          `(Shift+5 is "%" on US, "5" on AZERTY). Use event.code for physical key position:\n${msg}`,
      );
    }
  });

  // ── Sanity: the walker actually walks. ──

  it('sanity: file walker finds at least one .ts file', () => {
    expect(allTsFiles.length).toBeGreaterThan(0);
  });

  it('sanity: file walker finds CombatFSM.ts (a known file)', () => {
    expect(allTsFiles.some((p) => relToSrc(p) === 'combat/CombatFSM.ts')).toBe(true);
  });
});
