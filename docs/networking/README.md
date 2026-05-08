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
| 02  | `02-snapshot-and-state-sync.md` *(planned, see #126)*                      | Snapshot format, delta encoding, interest mgmt | What goes on the wire each tick: which components are replicated, baseline-vs-delta encoding, per-entity ordering.          |
| 03  | `03-message-protocol-and-handshake.md` *(planned, see #133)*               | Wire protocol, joining flow, error codes       | Binary frame layout, message-type enum, version handshake, disconnect/reconnect sequence, anti-cheat validation rules.      |
| 04  | `04-server-runtime-and-deploy.md` *(planned, see #138)*                    | Server process layout, build, deploy           | Node.js entry point, how the existing fixed-timestep loop is reused server-side, Docker image, port mapping, smoke tests.   |

Doc 01 (this PR) is the load-bearing one — every later doc references it for
"what gets sent at what rate" and "who is the source of truth for component X".

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
