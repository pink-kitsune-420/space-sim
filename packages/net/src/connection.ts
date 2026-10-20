/** Host-only connection interfaces and loopback helper (`packages/net`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); use `TextConnection`, `TransportProvider`, `WEBSOCKET_TRANSPORT`, `TAB_TRANSPORT`, or `WEBRTC_SIGNALING` from `@space-sim/game-api`. */

/** An ordered, reliable text channel: a WebSocket, a WebRTC data channel or an in-memory
 * pair. Sessions never see the transport. Modules use `TextConnection` from `@space-sim/game-api`. Host-only (`packages/net`). */
export interface Connection {
  /** For logs only, e.g. a remote address. */
  readonly label: string;
  /** Bytes queued but not yet sent; hosts skip snapshots for congested peers. */
  readonly bufferedAmount: number;
  send(text: string): void;
  close(reason?: string): void;
  onmessage: ((text: string) => void) | null;
  /** Called once, whichever side closed. */
  onclose: ((reason: string) => void) | null;
}

/** Schedules one delivery. The default delivers on a microtask, in order. Host-only (`packages/net`). */
export type Scheduler = (deliver: () => void) => void;

/** Two connected in-memory ends, for tests and same-process clients. One scheduler serves
 * both directions, or pass one per direction (first: messages sent by the first end). Delivers in order and before close. Modules use `TextConnection` and `TAB_TRANSPORT`. Host-only (`packages/net`). */
export function loopback(schedule: Scheduler | readonly [Scheduler, Scheduler] = queueMicrotask,
  labels: readonly [string, string] = ['loopback-a', 'loopback-b']): [Connection, Connection] {
  const schedulers = typeof schedule === 'function' ? [schedule, schedule] : schedule;
  let open = true;
  type End = Connection & { peer?: End; readonly schedule: Scheduler };
  const ends: End[] = labels.map((label, i): End => ({
    label, bufferedAmount: 0, onmessage: null, onclose: null, schedule: schedulers[i]!,
    send(this: End, text: string): void {
      if (!open) return;
      const peer = this.peer!;
      // Like a socket, anything sent before close still arrives before the close event.
      this.schedule(() => peer.onmessage?.(text));
    },
    close(this: End, reason = 'closed'): void {
      if (!open) return;
      open = false;
      for (const end of ends) this.schedule(() => end.onclose?.(reason));
    },
  }));
  ends[0]!.peer = ends[1]!;
  ends[1]!.peer = ends[0]!;
  return [ends[0]!, ends[1]!];
}
