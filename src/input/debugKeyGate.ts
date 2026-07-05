/**
 * debugKeyGate — predicate gating debug-only keys (T / Y / J / K).
 *
 * Issue #172: Debug dummy controls must be inert when:
 *   - input is paused (overlay open, focus lost), OR
 *   - the canvas does NOT hold pointer lock.
 *
 * Without this gate, pressing K while typing in DevTools or with the
 * inventory open would reset all dummies; T/Y/J would similarly side-
 * effect from outside the play surface.
 *
 * Pulled out of `main.ts` so it has a unit-test seam.
 */

/** Set of KeyboardEvent.code values gated as debug dummy controls. */
export const DEBUG_DUMMY_KEY_CODES: ReadonlySet<string> = new Set([
  'KeyT',
  'KeyY',
  'KeyJ',
  'KeyK',
  'KeyB',
]);

/** True if `code` is one of the debug dummy keys. */
export function isDebugDummyKey(code: string): boolean {
  return DEBUG_DUMMY_KEY_CODES.has(code);
}

/**
 * Returns true when a debug-dummy key handler MAY run, given the current
 * input/pointer-lock state. Returns false (key should be ignored) when:
 *   - input.paused (an overlay is up), OR
 *   - pointer lock is not held by the game canvas.
 *
 * Non-debug keys (anything not in `DEBUG_DUMMY_KEY_CODES`) always return
 * true; the caller decides what to do with them.
 *
 * @param code         KeyboardEvent.code of the pressed key
 * @param paused       InputManager.paused at event time
 * @param lockedTarget document.pointerLockElement at event time
 * @param canvas       The game canvas (the legitimate lock target)
 */
export function shouldDispatchDebugKey(
  code: string,
  paused: boolean,
  lockedTarget: Element | null,
  canvas: Element,
): boolean {
  if (!isDebugDummyKey(code)) return true;
  if (paused) return false;
  if (lockedTarget !== canvas) return false;
  return true;
}
