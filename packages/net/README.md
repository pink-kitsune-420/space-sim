# Networking Sessions

Transport-agnostic multiplayer for a [`World`](../sim-core/src/world.ts): no DOM, Node or wall-clock imports beyond an injectable millisecond clock, so the same code runs in a browser tab, the dedicated server and Node tests.

- `src/protocol.ts`: message types (`space-sim-net/4`) and strict validation of everything received, from players and from hosts.
- `src/host.ts`: `HostSession`, the authoritative owner of a world. It admits players (password, limits, reconnect tokens), checks ship ownership, schedules held controls at their simulation step, steps the world and publishes snapshots.
- `src/client.ts`: `ClientSession`, a predicted mirror of a host's world with input replay and fading display corrections.
- `src/connection.ts`: the `Connection` interface and an in-memory pair.
- `src/websocket.ts`: server addresses and a standard WebSocket client (browsers and Node 22).
- `src/sha256.ts`: dependency-free SHA-256 and random ids for tokens.
