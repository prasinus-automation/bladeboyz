# BladeBoyz Networking Architecture

> **Status:** architecture spec, no production code in this folder. These docs
> are the source-of-truth for the multiplayer rebuild tracked in #92. Any
> implementation PR for the multiplayer layer must cite the doc number(s) it
> implements, and any diff that contradicts a doc must update the doc in the
> same PR.

## How to read this

These docs are written for backend devs implementing the multiplayer layer. They
assume you have already read [`AGENTS.md`](../../AGENTS.md) (stack details, ECS
conventions, fixed-timestep loop, FSM tick contract) and
[`docs/MVP.md`](../MVP.md) (the broader rebuild roadmap that frames *why* we are
adding networking now).

The four docs build on each other in order. Read them in order on a first
pass — each later doc takes the earlier ones as given.

| #   | File                                                                       | Topic                                          | One-line summary                                                                                                            |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 01  | [`01-transport-and-authority.md`](./01-transport-and-authority.md)         | Transport, topology, tickrate, authority model | WebSocket + single Node.js process, 60Hz server tick / 30Hz broadcast, server-authoritative combat, client-predicted movement. |
| 02  | [`02-replication-and-protocol.md`](./02-replication-and-protocol.md)       | Replication model + protocol message catalog   | Which ECS components cross the wire, snapshot vs. delta encoding with a per-entity changed-mask byte, full C↔S message catalog, msgpackr binary format. |
| 03  | [`03-sequences-and-anticheat.md`](./03-sequences-and-anticheat.md)         | End-to-end sequence diagrams, anti-cheat rules | Mermaid sequence diagrams for join / move / swing / hit-blocked / disconnect-reconnect, plus the per-message server-side validation rules behind doc 01 §6 and per-rule log levels. |
| 04  | [`04-server-packaging.md`](./04-server-packaging.md)                       | Headless server packaging, deploy, codebase reorg | Why the current `World.ts` cannot run headless, the `CoreWorld` / `RenderWorld` / `ServerWorld` split, per-world side-tables (replaces the module-level singletons in `AGENTS.md`), proposed `src/shared/` + `src/client/` + `src/server/` directory layout, server-side bone math, updated Dockerfile + deploy workflow, migration PR sequencing. |

Doc 01 is the load-bearing foundation — every later doc references it for
"what gets sent at what rate" and "who is the source of truth for component
X". Doc 02 is the wire-format contract that the implementation PRs cite
verbatim. Doc 03 turns the authority/protocol contract into concrete
end-to-end flows and the validation rules that gate every C→S message.
Doc 04 is the codebase-reorg + packaging plan that gates the implementation
milestone — none of the steps in docs 01-03 are buildable until the
`World.ts` split in doc 04 §2 lands.

## Out of scope across all four docs

Matchmaking, lobbies, regional shards, horizontal scale, encryption beyond
TLS-on-WS, statistical anti-cheat (aimbot/wall-hack heuristics), spectator mode,
voice chat, reconnect-to-different-server. All of these are deliberately
deferred — the goal is **two-to-eight humans in one arena over the open
internet**, nothing more.

## Conventions used in these docs

- **Tick** means one fixed-update step on the server (1/60 s). Wall-clock
  time is called out explicitly when used.
- **Server-authoritative** means the server is the sole writer of a piece of
  state. Clients render it but never originate writes.
- **Client-predicted** means the client simulates locally for responsiveness
  and the server reconciles divergence on the next snapshot.
- **MUST / SHOULD / MAY** are used in the RFC 2119 sense for protocol-level
  requirements.
