/**
 * EventBus — lightweight in-process pub/sub for cross-system events.
 *
 * Why a queue + flush instead of synchronous emit:
 *  - Event handlers may want to read ECS state that's still being written
 *    this tick (e.g. Killfeed reads `Score` after `processDeaths` has
 *    incremented it). Flushing at the end of `fixedUpdate` gives a clean
 *    "all systems have run, now consumers see a consistent snapshot".
 *  - Handlers can emit follow-up events without re-entering the bus mid-loop.
 *  - When the networking layer (#92) lands, server-replicated events can
 *    be queued through the same bus on receipt with no API change.
 *
 * Wire-up: `EventBus.flush()` is called once per fixed-update tick in
 * `main.ts`, AFTER all systems that emit have run. Anything emitted between
 * flush calls is delivered on the next flush.
 *
 * See `src/events/types.ts` for payload shapes and `docs/spawn-death-respawn.md`
 * for the producer/consumer table.
 */

import type { EventPayloadMap, EventType } from './types';

type Handler<T> = (payload: T) => void;

interface QueuedEvent {
  type: EventType;
  payload: unknown;
}

const handlers: { [K in EventType]?: Handler<EventPayloadMap[K]>[] } = {};
const queue: QueuedEvent[] = [];

/**
 * Subscribe to an event type. Returns an unsubscribe function.
 *
 * The same handler can be subscribed multiple times — each registration is
 * counted independently and each will receive the event. (Matches DOM
 * `addEventListener` semantics.)
 */
function on<K extends EventType>(
  type: K,
  handler: Handler<EventPayloadMap[K]>,
): () => void {
  let arr = handlers[type] as Handler<EventPayloadMap[K]>[] | undefined;
  if (!arr) {
    arr = [];
    (handlers as Record<EventType, Handler<unknown>[]>)[type] =
      arr as unknown as Handler<unknown>[];
  }
  arr.push(handler);
  return () => {
    const list = handlers[type] as Handler<EventPayloadMap[K]>[] | undefined;
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  };
}

/**
 * Queue an event for delivery. Subscribers receive it on the next `flush()`,
 * NOT immediately — see module-level docstring.
 */
function emit<K extends EventType>(type: K, payload: EventPayloadMap[K]): void {
  queue.push({ type, payload });
}

/**
 * Drain the queue, delivering each queued event to all current subscribers.
 *
 * If a handler emits a new event, that event is queued AFTER the current
 * drain loop finishes (it's appended to `queue`, not the in-flight slice),
 * so it will be delivered on the next `flush()` call. This keeps each
 * flush bounded — there's no risk of a feedback loop within a single tick.
 */
function flush(): void {
  if (queue.length === 0) return;
  // Snapshot the queue and reset before dispatching so handlers' re-emits
  // land in the next flush cycle (avoids a runaway feedback loop).
  const drained = queue.splice(0, queue.length);
  for (const evt of drained) {
    const list = handlers[evt.type] as Handler<unknown>[] | undefined;
    if (!list) continue;
    // Iterate a copy so unsubscribes during dispatch don't shift indices.
    const snapshot = list.slice();
    for (const h of snapshot) {
      try {
        h(evt.payload);
      } catch (err) {
        // A handler failure must not block siblings or the next event.
        // Log and keep going.
        // eslint-disable-next-line no-console
        console.error(`[EventBus] handler for "${evt.type}" threw:`, err);
      }
    }
  }
}

/**
 * Reset all subscribers and drop any queued events. Test helper — production
 * code never calls this. (`HealthSystem.resetHealthTracking()` calls it as
 * part of its broader test cleanup.)
 */
function clear(): void {
  for (const key of Object.keys(handlers) as EventType[]) {
    delete handlers[key];
  }
  queue.length = 0;
}

/** Drop pending events without delivering them. Test helper. */
function clearQueue(): void {
  queue.length = 0;
}

/** Number of currently-pending events (test helper). */
function pendingCount(): number {
  return queue.length;
}

export const EventBus = {
  on,
  emit,
  flush,
  clear,
  clearQueue,
  pendingCount,
};
