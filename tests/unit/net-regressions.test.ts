import { describe, expect, it } from 'vitest';
import { STEP, type Controls } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { loopback } from '../../packages/net/src/connection';
import { ClientSession } from '../../packages/net/src/client';
import { HostSession } from '../../packages/net/src/host';
import { MAX_CHAT, parseClientMessage, parseHostMessage } from '../../packages/net/src/protocol';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/index';
import { Game } from '../helpers/net-harness';

const BURN: Controls = { turn: 0, throttle: 0, engine: true };
const raw = (client: ClientSession): { send(text: string): void } =>
  (client as unknown as { connection: { send(text: string): void } }).connection;

/** Host on the wall clock (advance(), as browsers and the dedicated server run it), clients at ~60 Hz. */
function runAdvancing(game: Game, ms: number, skip: ReadonlySet<ClientSession> = new Set()): void {
  for (let i = 0; i < ms; i++) {
    game.net.now++;
    game.net.flush();
    if (game.net.now % 16 === 0) { game.host.advance(0.016); game.host.service(); }
    if (game.net.now % 16 === 8) {
      for (const pilot of game.pilots) {
        if (pilot.client.phase !== 'joined' || skip.has(pilot.client)) continue;
        pilot.ship ??= pilot.client.ownShips()[0]?.id;
        pilot.client.control(pilot.ship, pilot.controls ?? { turn: 0, throttle: 0, engine: false });
        pilot.client.update();
      }
    }
    game.net.flush();
  }
}

describe('multiplayer regressions', () => {
  it('applies an input stamped before the host clock during warp instead of hanging', () => {
    const game = new Game();
    const a = game.join('Ada');
    game.run(500);
    const ship = a.client.ownShips()[0]!.id;
    game.host.setWarp(100);
    expect(game.host.warp).toBe(100);
    for (let i = 0; i < 20; i++) game.host.advance(0.05);
    // A mirror that fell behind (a hidden tab) stamps its input with an old tick.
    raw(a.client).send(JSON.stringify({ t: 'input', seq: 999, ship, tick: game.host.world.tick - 50, turn: 0, throttle: 0,
      engine: true, set: 1 }));
    game.net.now += 100;
    game.net.flush();
    const queues = (game.host as unknown as { queues: Map<string, unknown[]> }).queues;
    const values = queues.values.bind(queues);
    let loops = 0;
    queues.values = () => { if (++loops > 10_000) throw new Error('advance() is spinning'); return values(); };
    game.host.advance(0.05);
    expect(game.host.world.ship(ship)!.controls.engine).toBe(true);
    // Holding the engine ends warp, as it does for the host's own controls; time moves on.
    expect(game.host.warp).toBe(1);
    const tick = game.host.world.tick;
    game.host.advance(0.05);
    expect(game.host.world.tick).toBeGreaterThan(tick);
  });

  it('publishes snapshots on the wall clock while warping', () => {
    const game = new Game();
    const a = game.join('Ada');
    game.run(500);
    game.host.setWarp(1000);
    let snapshots = 0;
    const receive = (a.client as unknown as { receive(text: string): void }).receive.bind(a.client);
    (a.client as unknown as { receive(text: string): void }).receive = text => {
      if (text.startsWith('{"t":"snapshot"')) snapshots++;
      receive(text);
    };
    runAdvancing(game, 2000);
    expect(game.host.warp).toBe(1000);
    // 20 a second at the default rate; ticks jump by thousands, so tick % 5 no longer decides.
    expect(snapshots).toBeGreaterThanOrEqual(30);
    expect(snapshots).toBeLessThanOrEqual(50);
    expect(Math.abs(a.client.world!.tick - game.host.world.tick)).toBeLessThan(200_000);
  });

  it('keeps every delta that arrives between two frames, removals included', () => {
    const game = new Game();
    const a = game.join('Ada'), b = game.join('Bo');
    game.run(300);
    b.client.spawn();
    game.run(300);
    expect(a.client.world!.size).toBe(3);
    const doomed = b.client.ownShips().find(s => s.id !== b.ship)!.id;
    b.client.remove(doomed);
    // Ada's tab skips frames while several snapshots arrive: only the first lists the removal.
    for (let i = 0; i < 200; i++) {
      game.net.now++;
      game.net.flush();
      if (game.net.now % 10 === 0) { game.host.step(); game.host.service(); }
      if (game.net.now % 16 === 0) b.client.update();
    }
    expect(game.host.world.has(doomed)).toBe(false);
    a.client.update();
    expect(a.client.world!.has(doomed)).toBe(false);
    expect(a.client.world!.size).toBe(2);
  });

  it('asks for the complete world after falling far behind instead of stepping for seconds', () => {
    const game = new Game();
    const a = game.join('Ada'), b = game.join('Bo');
    game.run(300);
    b.controls = BURN;
    game.run(300);
    // Ada's tab is hidden for 20 s: snapshots pile up, the mirror does not move.
    const hidden = new Set([a.client]);
    for (let i = 0; i < 20_000; i++) {
      game.net.now++;
      game.net.flush();
      if (game.net.now % 10 === 0) { game.host.step(); game.host.service(); }
      if (game.net.now % 16 === 0) for (const p of game.pilots) if (!hidden.has(p.client)) { p.client.control(p.ship, p.controls ?? BURN); p.client.update(); }
    }
    const world = a.client.world!;
    const step = world.step.bind(world);
    let steps = 0;
    world.step = () => { steps++; return step(); };
    let sent = '';
    const send = raw(a.client).send.bind(raw(a.client));
    raw(a.client).send = text => { sent += text; send(text); };
    a.client.update();
    expect(steps).toBeLessThanOrEqual(500);
    expect(sent).toContain('"t":"resync"');
    world.step = step;
    game.run(500);
    const bo = b.client.ownShips()[0]!.id;
    const hostShip = game.host.world.ship(bo)!, mirrored = a.client.world!.ship(bo)!;
    expect(a.client.world!.tick).toBeGreaterThanOrEqual(game.host.world.tick);
    expect(mirrored.state.status).toBe(hostShip.state.status);
    expect(Math.abs(a.client.world!.tick - game.host.world.tick)).toBeLessThan(50);
  });

  it('places a ship for its owner through the host, and refuses when cheats are off', () => {
    const game = new Game();
    const a = game.join('Ada'), b = game.join('Bo');
    game.run(300);
    const ship = a.client.ownShips()[0]!.id;
    const body = game.host.world.ship(ship)!.bodyId;
    const r = game.host.world.body(body).radius + 300_000;
    a.client.teleport(ship, body, { x: 0, y: r }, { x: 2000, y: 0 }, 0);
    game.run(200);
    const placed = game.host.world.ship(ship)!;
    expect(placed.state.status).toBe('flying');
    expect(Math.hypot(placed.state.position.x, placed.state.position.y)).toBeGreaterThan(r - 5000);
    // Everyone sees it there, not only the pilot who asked.
    const seen = b.client.world!.ship(ship)!;
    expect(Math.hypot(seen.state.position.x - placed.state.position.x, seen.state.position.y - placed.state.position.y)).toBeLessThan(100);

    const notices: string[] = [];
    b.client.onnotice = text => notices.push(text);
    b.client.teleport(ship, body, { x: 0, y: r * 2 }, { x: 0, y: 0 });
    game.run(100);
    expect(notices.join(' ')).toMatch(/your own ships/);

    const strict = new Game({ allowGodMode: false });
    const c = strict.join('Cy');
    strict.run(300);
    const cNotices: string[] = [];
    c.client.onnotice = text => cNotices.push(text);
    const cShip = c.client.ownShips()[0]!.id;
    const before = strict.host.world.ship(cShip)!.state.position;
    c.client.teleport(cShip, strict.host.world.ship(cShip)!.bodyId, { x: 0, y: 1e9 }, { x: 0, y: 0 });
    strict.run(100);
    expect(cNotices.join(' ')).toMatch(/Cheats .* disabled/);
    expect(strict.host.world.ship(cShip)!.state.position).toEqual(before);
  });

  it('shares chat lines with every pilot, limits floods and strips control characters', () => {
    const game = new Game();
    const a = game.join('Ada'), b = game.join('Bo');
    game.run(300);
    const heard: Array<{ from?: string; name: string; text: string }> = [];
    b.client.onchat = line => heard.push(line);
    const hostHeard: string[] = [];
    game.host.onchat = line => hostHeard.push(`${line.name}: ${line.text}`);
    a.client.chat('hello\u0007 there\nfriends');
    game.run(100);
    game.host.chat(undefined, 'Server restarting soon');
    game.run(100);
    expect(heard).toEqual([{ from: a.client.playerId, name: 'Ada', text: 'hello there friends' },
      { name: 'Server', text: 'Server restarting soon' }]);
    expect(hostHeard).toEqual(['Ada: hello there friends', 'Server: Server restarting soon']);

    const notices: string[] = [];
    a.client.onnotice = text => notices.push(text);
    game.run(7500); // the burst refills
    for (let i = 0; i < 10; i++) a.client.chat(`spam ${i}`);
    game.run(100);
    expect(heard.filter(line => line.text.startsWith('spam'))).toHaveLength(5);
    expect(notices.join(' ')).toMatch(/too quickly/);
    expect(a.client.phase).toBe('joined');
    expect(() => parseClientMessage(JSON.stringify({ t: 'chat', text: 'x'.repeat(MAX_CHAT + 1) }))).toThrow();
  });

  it('tells joining players which seat is the host, so a shared browser does not present its token', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-seat' });
    const host = new HostSession(world);
    const hostToken = 'a'.repeat(32);
    const hostId = host.seatHost('Hana', hostToken);
    const [clientEnd, hostEnd] = loopback();
    const asked: Array<[string, string | undefined]> = [];
    const client = new ClientSession(clientEnd, { name: 'Gus',
      // The browser's stored token for this world is the host's own seat.
      token: (worldId, seat) => { asked.push([worldId, seat]); return seat === hostId ? undefined : hostToken; } });
    host.accept(hostEnd);
    return new Promise<void>(done => {
      client.onjoined = () => {
        expect(asked).toEqual([['w-seat', hostId]]);
        expect(client.hostSeat).toBe(hostId);
        expect(client.playerId).not.toBe(hostId);
        done();
      };
    });
  });

  it('validates teleport requests', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'teleport', ship: 's-1', body: 'primus', x: 1, y: 2, vx: 3, vy: 4, heading: 0.5 })))
      .toEqual({ t: 'teleport', ship: 's-1', body: 'primus', x: 1, y: 2, vx: 3, vy: 4, heading: 0.5 });
    expect(() => parseClientMessage(JSON.stringify({ t: 'teleport', ship: 's-1', body: 'primus', x: 1e300, y: 2, vx: 3, vy: 4 }))).toThrow();
    expect(() => parseClientMessage('{"t":"teleport","ship":"s-1","body":"primus","x":1,"y":2,"vx":"fast","vy":4}')).toThrow();
    expect(parseHostMessage(JSON.stringify({ t: 'chat', name: 'Server', text: 'hi' }))).toEqual({ t: 'chat', name: 'Server', text: 'hi' });
  });

  it('never predicts past what a stalling host will schedule, so a hidden host tab cannot fork the flight', () => {
    const game = new Game();
    const a = game.join('Gus', { latencyMs: 1 });
    game.run(300);
    const ship = a.client.ownShips()[0]!.id;
    const truth = new Map<number, { x: number; y: number }>(), shown = new Map<number, { x: number; y: number }>();
    let pending = 0;
    for (let ms = 0; ms < 20_000; ms++) {
      game.net.now++;
      game.net.flush();
      pending += 0.001;
      // A hidden hosting tab wakes every 4 s and catches up at most 2 s (LocalSession.catchUp);
      // in between it still answers pings with its stale tick.
      if (game.net.now % 4000 === 0) {
        let left = Math.min(pending, 2);
        pending = 0;
        for (; left >= STEP - 1e-9; left -= STEP) {
          game.host.step();
          const p = game.host.world.ship(ship)!.state.position;
          truth.set(game.host.world.tick, { x: p.x, y: p.y });
        }
        game.host.service();
      }
      if (game.net.now % 16 === 0) {
        const phase = Math.floor(game.net.now / 700) % 4;
        a.client.control(ship, { turn: game.net.now < 3000 ? 0 : phase === 1 ? 1 : phase === 3 ? -1 : 0, throttle: 0, engine: true });
        a.client.update();
        const p = a.client.world!.ship(ship)!.state.position;
        shown.set(a.client.world!.tick, { x: p.x, y: p.y });
      }
      game.net.flush();
    }
    let compared = 0, worst = 0;
    for (const [tick, p] of shown) {
      const h = truth.get(tick);
      if (!h) continue;
      compared++;
      worst = Math.max(worst, Math.hypot(h.x - p.x, h.y - p.y));
    }
    expect(compared).toBeGreaterThan(300);
    // What the pilot saw at each step is what the host computed for it (8.7 m off before).
    expect(worst).toBeLessThan(0.01);
  });
});
