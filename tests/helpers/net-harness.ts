import { DEFAULT_UNIVERSE, type Controls } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { loopback, type Connection, type Scheduler } from '../../packages/net/src/connection';
import { HostSession, type HostSettings } from '../../packages/net/src/host';
import { ClientSession, type ClientOptions } from '../../packages/net/src/client';
import type { SavedPlayer } from '../../packages/sim-core/src/save';

/** A deterministic network: one fake millisecond clock, and in-memory links with latency. */
export class SimNet {
  now = 0;
  private queue: Array<{ readonly at: number; readonly order: number; readonly deliver: () => void }> = [];
  private order = 0;
  readonly log: string[] = [];

  link(latencyMs: number | (() => number)): [Connection, Connection] {
    const delay = typeof latencyMs === 'number' ? () => latencyMs : latencyMs;
    // Each direction stays in order even with jitter, like TCP.
    const direction = (): Scheduler => {
      let last = 0;
      return deliver => {
        last = Math.max(last, this.now + delay());
        this.queue.push({ at: last, order: this.order++, deliver });
      };
    };
    return loopback([direction(), direction()], ['client', 'host']);
  }

  flush(): void {
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.order - b.order);
      const next = this.queue[0];
      if (!next || next.at > this.now) return;
      this.queue.shift();
      next.deliver();
    }
  }
}

export interface Pilot { client: ClientSession; controls?: Controls; ship?: string; tokens: Map<string, string> }

export class Game {
  readonly net = new SimNet();
  readonly host: HostSession;
  readonly pilots: Pilot[] = [];
  hostTicks = new Map<number, Map<string, unknown>>();
  constructor(settings: Partial<HostSettings> = {}, world = new World(DEFAULT_UNIVERSE, { id: 'w-test' }), players?: SavedPlayer[]) {
    this.host = new HostSession(world, settings, { now: () => this.net.now, log: m => this.net.log.push(m), ...(players ? { players } : {}) });
  }

  join(name: string, options: Partial<ClientOptions> & { latencyMs?: number | (() => number); tokens?: Map<string, string> } = {}): Pilot {
    const [clientEnd, hostEnd] = this.net.link(options.latencyMs ?? 20);
    const tokens = options.tokens ?? new Map<string, string>();
    const client = new ClientSession(clientEnd, { name, now: () => this.net.now,
      token: id => tokens.get(id), saveToken: (id, token) => tokens.set(id, token), ...options });
    this.host.accept(hostEnd);
    const pilot: Pilot = { client, tokens };
    this.pilots.push(pilot);
    return pilot;
  }

  /** Run in 1-ms increments: the host at 100 Hz, clients at ~60 Hz. */
  run(ms: number, record = false): void {
    for (let i = 0; i < ms; i++) {
      this.net.now++;
      this.net.flush();
      if (this.net.now % 10 === 0) {
        this.host.step();
        this.host.service();
        if (record) this.hostTicks.set(this.host.world.tick, new Map(this.host.world.ships().map(s => [s.id, s.state])));
      }
      if (this.net.now % 16 === 0) {
        for (const pilot of this.pilots) {
          if (pilot.client.phase !== 'joined') continue;
          pilot.ship ??= pilot.client.ownShips()[0]?.id;
          pilot.client.control(pilot.ship, pilot.controls ?? { turn: 0, throttle: 0, engine: false });
          pilot.client.update();
        }
      }
      this.net.flush();
    }
  }
}
