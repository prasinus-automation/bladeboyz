/**
 * npcRegistry — side-table of non-numeric per-NPC metadata.
 *
 * bitECS components are TypedArray-backed and can only store numbers, so any
 * string/object data (kind label, spawn pose, etc.) lives in this Map keyed
 * by entity id. Mirrors the existing `meshRegistry` / `fsmRegistry` /
 * `inventoryRegistry` / `shopkeepRegistry` / `pickupRegistry` pattern.
 *
 * Entries are added by entity factories (`createTrainingDummy`, future
 * `createWarmupBot`) and removed by their corresponding `remove…` helpers.
 *
 * For ITERATION (e.g. floating damage numbers, killfeed labels, K reset),
 * use a `defineQuery([IsNPC])` (or `[IsTrainingDummy]`) — bitECS queries are
 * faster than Map iteration and decouple iteration order from registration
 * order. Use this Map only when you need the metadata payload itself.
 *
 * See `docs/training-dummies-and-bots-spec.md` §6 for the architectural
 * rationale (replaces the old `activeDummies: number[]` array).
 */

export interface NpcMeta {
  /** What kind of NPC this is. Used for HUD chrome and future debug overlays. */
  kind: 'training-dummy' | 'warmup-bot';
  /** Spawn position, in feet-origin world coords. */
  spawnPos: { x: number; y: number; z: number };
  /** Spawn yaw in radians. Used by `K` reset to restore facing. */
  spawnYaw: number;
  /** Tick the NPC was created on. Currently informational. */
  spawnTick: number;
}

/** Map<entityId, NpcMeta> */
export const npcRegistry: Map<number, NpcMeta> = new Map();

/** Test helper — clear the registry between test cases. */
export function clearNpcRegistry(): void {
  npcRegistry.clear();
}
