import type { Connection } from './connection';
import { MAX_HOST_MESSAGE } from './protocol';
import { newToken } from './sha256';

/** Same-browser multiplayer: tabs of one browser (one origin) reach each other over a
 * BroadcastChannel, with no network, STUN or codes. A hosting tab advertises its world;
 * other tabs list it and connect in one click. Every tab hears every message, so each one
 * names its connection and direction, and tabs ignore what is not theirs. */
export const LOCAL_CHANNEL = 'space-sim-local';
/** A hosting tab repeats its advertisement this often; listeners forget it after three
 * missed ones. */
const ADVERTISE_MS = 2000;
const ADVERT_EXPIRES_MS = 3 * ADVERTISE_MS + 500;
/** Without Web Locks, liveness falls back to heartbeats. */
const BEAT_MS = 2000;
const TIMEOUT_MS = 30_000;
const OPEN_TIMEOUT_MS = 5000;

/** The part of BroadcastChannel this uses (tests can pass a fake). */
export interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
}
/** The part of Web Locks this uses: holding a lock for a connection's lifetime lets the
 * other tab learn at once when this one closes or crashes, even while timers are throttled. */
export interface LocksLike {
  request(name: string, options: { readonly signal?: AbortSignal }, callback: () => Promise<void>): Promise<unknown>;
}
export interface LocalOptions {
  readonly channel?: () => ChannelLike;
  /** Null for heartbeats only. Defaults to navigator.locks when present. */
  readonly locks?: LocksLike | null;
  readonly beatMs?: number;
  readonly timeoutMs?: number;
}

export interface LocalAdvert {
  /** This hosting tab's key. */
  readonly host: string;
  readonly name: string;
  readonly worldId: string;
  readonly players: number;
  readonly maxPlayers: number;
}

type Side = 'host' | 'guest';
type Wire =
  | { readonly k: 'discover' }
  | ({ readonly k: 'here' } & LocalAdvert)
  | { readonly k: 'gone'; readonly host: string }
  | { readonly k: 'open'; readonly host: string; readonly id: string }
  | { readonly k: 'accept'; readonly id: string }
  | { readonly k: 'data'; readonly id: string; readonly to: Side; readonly text: string }
  | { readonly k: 'beat'; readonly id: string; readonly to: Side }
  | { readonly k: 'close'; readonly id: string; readonly to: Side; readonly reason: string };

const KEY = /^[0-9a-f]{32}$/;
const str = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
/** Same-origin tabs are trusted to run this game, not to be well formed. */
function parse(data: unknown): Wire | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const m = data as Record<string, unknown>;
  const side = m.to === 'host' || m.to === 'guest';
  switch (m.k) {
    case 'discover': return { k: 'discover' };
    case 'here':
      return str(m.host, 32) && KEY.test(m.host) && str(m.name, 80) && str(m.worldId, 64) && count(m.players) && count(m.maxPlayers)
        ? { k: 'here', host: m.host, name: m.name, worldId: m.worldId, players: m.players, maxPlayers: m.maxPlayers } : undefined;
    case 'gone': return str(m.host, 32) ? { k: 'gone', host: m.host } : undefined;
    case 'open': return str(m.host, 32) && str(m.id, 32) && KEY.test(m.id) ? { k: 'open', host: m.host, id: m.id } : undefined;
    case 'accept': return str(m.id, 32) ? { k: 'accept', id: m.id } : undefined;
    case 'data': return str(m.id, 32) && side && str(m.text, MAX_HOST_MESSAGE) ? { k: 'data', id: m.id, to: m.to as Side, text: m.text } : undefined;
    case 'beat': return str(m.id, 32) && side ? { k: 'beat', id: m.id, to: m.to as Side } : undefined;
    case 'close': return str(m.id, 32) && side && str(m.reason, 200) ? { k: 'close', id: m.id, to: m.to as Side, reason: m.reason } : undefined;
    default: return undefined;
  }
}

function defaultLocks(): LocksLike | null {
  const locks = (globalThis as { navigator?: { locks?: LocksLike } }).navigator?.locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}
const lockName = (id: string, side: Side): string => `${LOCAL_CHANNEL}/${id}/${side}`;
/** Hold a lock until released; resolves once it is held. */
function hold(locks: LocksLike, name: string): { readonly held: Promise<void>; release(): void } {
  let release = (): void => {};
  const held = new Promise<void>(granted => {
    locks.request(name, {}, () => new Promise<void>(done => { release = done; granted(); })).catch(() => granted());
  });
  return { held, release: () => release() };
}

/** A link between two tabs; `side` is the end this tab plays. */
class LocalLink implements Connection {
  readonly label: string;
  readonly bufferedAmount = 0;
  onclose: ((reason: string) => void) | null = null;
  closed = false;
  private handler: ((text: string) => void) | null = null;
  /** Messages that arrived before anyone listened (the host greets at once). */
  private backlog: string[] = [];
  private heard: number;
  private sentAt: number;
  private readonly timer?: ReturnType<typeof setInterval>;
  private readonly watch?: AbortController;
  private readonly peer: Side;

  constructor(readonly id: string, side: Side, private readonly post: (wire: Wire) => void,
    private readonly ownLock: { release(): void } | undefined, locks: LocksLike | null,
    options: LocalOptions, private readonly forget: (link: LocalLink) => void) {
    this.peer = side === 'host' ? 'guest' : 'host';
    this.label = side === 'host' ? 'another tab' : 'host tab';
    this.heard = this.sentAt = Date.now();
    if (locks) {
      // Granted only when the other tab lets go of its lock: it closed, crashed or left.
      this.watch = new AbortController();
      locks.request(lockName(id, this.peer), { signal: this.watch.signal }, async () => {
        // A goodbye posted just before the release may still be on its way.
        await new Promise(done => setTimeout(done, 250));
        this.finish('The other tab closed.', false);
      }).catch(() => { /* aborted on close */ });
    } else {
      const beat = options.beatMs ?? BEAT_MS, timeout = options.timeoutMs ?? TIMEOUT_MS;
      this.timer = setInterval(() => {
        const now = Date.now();
        if (now - this.heard > timeout) { this.finish('Connection lost.', true); return; }
        if (now - this.sentAt >= beat) this.wire({ k: 'beat', id, to: this.peer });
      }, Math.max(10, Math.min(beat, timeout) / 2));
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  get onmessage(): ((text: string) => void) | null { return this.handler; }
  set onmessage(handler: ((text: string) => void) | null) {
    this.handler = handler;
    const waiting = this.backlog;
    this.backlog = [];
    for (const text of waiting) this.handler?.(text);
  }

  send(text: string): void { if (!this.closed) this.wire({ k: 'data', id: this.id, to: this.peer, text }); }
  close(reason = 'Disconnected.'): void { this.finish(reason, true); }

  receive(wire: Wire): void {
    if (this.closed) return;
    this.heard = Date.now();
    if (wire.k === 'data') {
      if (this.handler) this.handler(wire.text);
      else this.backlog.push(wire.text);
    }
    else if (wire.k === 'close') this.finish(wire.reason || 'Disconnected.', false);
  }

  finish(reason: string, tell: boolean): void {
    if (this.closed) return;
    if (tell) this.wire({ k: 'close', id: this.id, to: this.peer, reason: reason.slice(0, 200) });
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.watch?.abort();
    this.ownLock?.release();
    this.forget(this);
    this.onclose?.(reason);
  }

  private wire(wire: Wire): void {
    this.sentAt = Date.now();
    this.post(wire);
  }
}

function channel(options: LocalOptions): { readonly ch: ChannelLike; post(wire: Wire): void } {
  const ch = options.channel?.() ?? new BroadcastChannel(LOCAL_CHANNEL) as unknown as ChannelLike;
  return { ch, post(wire) { try { ch.postMessage(wire); } catch { /* channel closed */ } } };
}

/** A hosting tab: answers discovery, advertises itself and accepts connections. */
export class LocalHost {
  readonly key = newToken();
  private readonly ch: ChannelLike;
  private readonly post: (wire: Wire) => void;
  private readonly links = new Map<string, LocalLink>();
  private readonly locks: LocksLike | null;
  private readonly timer: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(private readonly describe: () => Omit<LocalAdvert, 'host'>, private readonly accept: (connection: Connection) => void,
    private readonly options: LocalOptions = {}) {
    ({ ch: this.ch, post: this.post } = channel(options));
    this.locks = options.locks === undefined ? defaultLocks() : options.locks;
    this.ch.onmessage = event => this.receive(parse(event.data));
    this.timer = setInterval(() => this.announce(), ADVERTISE_MS);
    (this.timer as { unref?: () => void }).unref?.();
    this.announce();
  }

  /** Tell listening tabs about this world now (the roster changed, say). */
  announce(): void { if (!this.stopped) this.post({ k: 'here', host: this.key, ...this.describe() }); }

  /** Stop advertising and close every connection (the transport only: sessions say goodbye first). */
  close(reason = 'The host stopped hosting.'): void {
    if (this.stopped) return;
    for (const link of [...this.links.values()]) link.finish(reason, true);
    this.post({ k: 'gone', host: this.key });
    this.stopped = true;
    clearInterval(this.timer);
    this.ch.close();
  }

  private receive(wire: Wire | undefined): void {
    if (!wire || this.stopped) return;
    if (wire.k === 'discover') { this.announce(); return; }
    if (wire.k === 'open') {
      if (wire.host !== this.key || this.links.has(wire.id)) return;
      void this.open(wire.id);
      return;
    }
    if ((wire.k === 'data' || wire.k === 'beat' || wire.k === 'close') && wire.to === 'host') this.links.get(wire.id)?.receive(wire);
  }

  private async open(id: string): Promise<void> {
    const own = this.locks ? hold(this.locks, lockName(id, 'host')) : undefined;
    await own?.held;
    if (this.stopped) { own?.release(); return; }
    const link = new LocalLink(id, 'host', this.post, own, this.locks, this.options, l => this.links.delete(l.id));
    this.links.set(id, link);
    this.post({ k: 'accept', id });
    try { this.accept(link); } catch { link.finish('The host refused the connection.', true); }
  }
}

/** Lists hosting tabs in this browser while open. */
export class LocalDiscovery {
  private readonly ch: ChannelLike;
  private readonly post: (wire: Wire) => void;
  private readonly seen = new Map<string, LocalAdvert & { readonly at: number }>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly onchange: (worlds: readonly LocalAdvert[]) => void, options: LocalOptions = {}) {
    ({ ch: this.ch, post: this.post } = channel(options));
    this.ch.onmessage = event => {
      const wire = parse(event.data);
      if (wire?.k === 'here') {
        const { k: _k, ...advert } = wire;
        const old = this.seen.get(wire.host);
        this.seen.set(wire.host, { ...advert, at: Date.now() });
        if (!old || old.name !== advert.name || old.players !== advert.players || old.maxPlayers !== advert.maxPlayers) this.changed();
      } else if (wire?.k === 'gone' && this.seen.delete(wire.host)) this.changed();
    };
    this.timer = setInterval(() => this.expire(), ADVERTISE_MS);
    (this.timer as { unref?: () => void }).unref?.();
    this.post({ k: 'discover' });
  }

  worlds(): LocalAdvert[] { return [...this.seen.values()].map(({ at: _at, ...advert }) => advert); }
  close(): void { clearInterval(this.timer); this.ch.close(); }

  private expire(): void {
    const now = Date.now();
    let removed = false;
    for (const [key, advert] of this.seen) if (now - advert.at > ADVERT_EXPIRES_MS) { this.seen.delete(key); removed = true; }
    if (removed) this.changed();
  }
  private changed(): void { this.onchange(this.worlds()); }
}

/** Connect to a hosting tab by its key. */
export function connectLocal(host: string, options: LocalOptions = {}): Promise<Connection> {
  const { ch, post } = channel(options);
  const locks = options.locks === undefined ? defaultLocks() : options.locks;
  const id = newToken();
  return new Promise((resolve, reject) => {
    let link: LocalLink | undefined;
    const own = locks ? hold(locks, lockName(id, 'guest')) : undefined;
    const fail = (reason: string): void => {
      clearTimeout(timer);
      own?.release();
      ch.close();
      reject(new Error(reason));
    };
    const timer = setTimeout(() => fail('The other tab did not answer. Is it still hosting?'), options.timeoutMs ?? OPEN_TIMEOUT_MS);
    ch.onmessage = event => {
      const wire = parse(event.data);
      if (!wire) return;
      if (!link) {
        if (wire.k === 'accept' && wire.id === id) {
          clearTimeout(timer);
          link = new LocalLink(id, 'guest', post, own, locks, options, () => ch.close());
          resolve(link);
        } else if (wire.k === 'gone' && wire.host === host) fail('That tab stopped hosting.');
        return;
      }
      if (wire.k === 'gone' && wire.host === host) link.finish('The host tab closed.', false);
      else if ((wire.k === 'data' || wire.k === 'beat' || wire.k === 'close') && wire.to === 'guest' && wire.id === id) link.receive(wire);
    };
    // Held before asking, so the host can only ever wait for a lock this tab already has.
    void (own?.held ?? Promise.resolve()).then(() => post({ k: 'open', host, id }));
  });
}
