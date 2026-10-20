# Networking and flight-session adapters

This package connects the existing Space Sim application to module-owned sessions, transports and discovery. Transport interfaces and session contracts live in [packages/game-api](../game-api/src/index.ts).

> **Host-only package (`packages/net`):** Modules cannot import this package directly (`packages/module-tools/check-boundaries.mjs`); net has no bridge in `packages/modules/src/`. Module code uses the public transport, discovery, and session contracts in `@space-sim/game-api`: `TextConnection`, `TransportProvider`, `DiscoveryProvider`, `WEBSOCKET_TRANSPORT` (`net.websocket@1.0.0`, `DEFAULT_MAX_TEXT_LENGTH` = 64 MiB), `TAB_TRANSPORT`, `WEBRTC_SIGNALING`, `NODE_WEBSOCKET_TRANSPORT`, `LAN_DISCOVERY` (`net.lan-discovery@1.0.0`), `FLIGHT_SESSIONS` (`session.flight@1.0.0`), `FlightSessionServices`, `JOIN_PACKS`, and `CORE_WORLD`/`CORE_SAVE`/`CORE_CLOCK`/`CORE_MOTION`/`CORE_COMMANDS`.

- [modules/session-flight](../../modules/session-flight/) owns the flight protocol (`space-sim-net/6`), authoritative host, predicted client, input replay and correction. Its portable implementation uses injected engine services. The local `src/host.ts` and `src/client.ts` adapt those services for the existing flight application.
- [modules/net-websocket](../../modules/net-websocket/) owns the WebSocket client and address handling. The dedicated server's first-party listener is in [apps/server/src/websocket.ts](../../apps/server/src/websocket.ts).
- [modules/net-tab](../../modules/net-tab/) owns same-browser transport and hosting discovery. `src/broadcast.ts` exposes its explicit flight compatibility adapter.
- [modules/net-webrtc](../../modules/net-webrtc/) owns browser invite transport.
- [modules/discovery-lan](../../modules/discovery-lan/) owns generic LAN probing. `src/discovery.ts` supplies the flight greeting decoder and default port.
- [src/session-services.ts](src/session-services.ts) binds engine services for the legacy composition; [src/connection.ts](src/connection.ts) exposes connection helpers, including an in-memory pair for tests.

The host owns the world, admits players, checks ship ownership and publishes snapshots. Clients replay held controls against authoritative updates. Matching simulation identities and module selections are required; generic transports do not grant another game's state model flight-session compatibility.

For joining, invites, package review and hosting, use **Manual → Players → Flying together**. For server commands and persistent storage, see [apps/server](../../apps/server/README.md).
