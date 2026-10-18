import { describe, expect, it } from 'vitest';
import { DEFAULT_UNIVERSE, IDLE, MODEL, type Controls, type State } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { shipToSaved } from '../../packages/sim-core/src/save';
import { loopback } from '../../packages/net/src/connection';
import { ClientSession } from '../../packages/net/src/client';
import { PROTOCOL, parseHostMessage } from '../../packages/net/src/protocol';
import { sha256Hex } from '../../packages/net/src/sha256';
import { Game } from '../helpers/net-harness';

const BURN: Controls = { turn: 0, throttle: 0, engine: true };
const shipOf = (game: Game, index: number): string => game.pilots[index]!.client.ownShips()[0]!.id;

describe('host and client sessions', () => {
  it('waits for a reserved reconnect token before sending join', async () => {
    const [host, connection] = loopback();
    const sent: string[] = [];
    host.onmessage = text => sent.push(text);
    let reserve!: (token: string) => void;
    const client = new ClientSession(connection, { name: 'Ada', token: () => new Promise<string>(done => { reserve = done; }) });
    host.send(JSON.stringify({ t: 'info', protocol: PROTOCOL, model: MODEL, worldId: 'world', name: 'Server',
      password: false, players: 0, maxPlayers: 16 }));
    await Promise.resolve();
    expect(sent).toEqual([]);
    reserve('a'.repeat(32));
    await Promise.resolve(); await Promise.resolve();
    expect(sent.map(text => JSON.parse(text))).toEqual([{ t: 'join', name: 'Ada', token: 'a'.repeat(32) }]);
    client.leave();
  });

  it('does not send a late join after disconnecting during token reservation', async () => {
    const [host, connection] = loopback();
    const sent: string[] = [];
    host.onmessage = text => sent.push(text);
    let reserve!: (token: string) => void;
    const client = new ClientSession(connection, { name: 'Ada', token: () => new Promise<string>(done => { reserve = done; }) });
    host.send(JSON.stringify({ t: 'info', protocol: PROTOCOL, model: MODEL, worldId: 'world', name: 'Server',
      password: false, players: 0, maxPlayers: 16 }));
    await Promise.resolve();
    client.leave();
    reserve('a'.repeat(32));
    await Promise.resolve(); await Promise.resolve();
    expect(sent).toEqual([]);
    expect(client.phase).toBe('closed');
  });

  it('admit players with their own first ship, tokens and a shared roster', () => {
    const game = new Game();
    const a = game.join('Ada'), b = game.join('Bo');
    game.run(300);
    expect([a.client.phase, b.client.phase]).toEqual(['joined', 'joined']);
    expect(a.client.playerId).not.toBe(b.client.playerId);
    expect(a.tokens.get('w-test')).toMatch(/^[0-9a-f]{32}$/);
    expect(game.host.roster().find(p => p.id === a.client.playerId)!.tokenHash).toBe(sha256Hex(a.tokens.get('w-test')!));
    expect(b.client.players.map(p => p.name).sort()).toEqual(['Ada', 'Bo']);
    expect(game.host.world.size).toBe(2);
    expect(b.client.world!.size).toBe(2);
    expect(a.client.ownShips()).toHaveLength(1);
    expect(a.client.world!.ship(shipOf(game, 1))!.ownerId).toBe(b.client.playerId);
  });

  it('predicts the local ship exactly when inputs arrive in time', () => {
    const game = new Game();
    const a = game.join('Ada', { latencyMs: 25 });
    game.run(1500);
    const id = shipOf(game, 0);
    const predicted = new Map<number, State>();
    const program: Array<[number, Controls]> = [[0, BURN], [300, { turn: 1, throttle: 1, engine: true }], [450, IDLE], [700, { turn: -1, throttle: 0, engine: false }], [900, IDLE]];
    for (let ms = 0; ms < 1500; ms += 1) {
      for (const [at, controls] of program) if (ms === at) a.controls = controls;
      game.run(1, true);
      const world = a.client.world!;
      predicted.set(world.tick, world.ship(id)!.state);
    }
    game.run(400, true);
    // Clients update at ~60 Hz, so they land on roughly every other 10-ms tick.
    const checked = [...predicted.keys()].filter(t => game.hostTicks.has(t));
    expect(checked.length).toBeGreaterThan(80);
    // Late predictions (after the snapshot that followed each input) are exact.
    let exact = 0;
    for (const tick of checked) {
      const host = game.hostTicks.get(tick)!.get(id) as State;
      const mine = predicted.get(tick)!;
      if (host.position.x === mine.position.x && host.position.y === mine.position.y && host.heading === mine.heading) exact++;
    }
    expect(exact / checked.length).toBeGreaterThan(0.95);
    expect(game.host.world.ship(id)!.state.status).not.toBe('landed');
  });

  it('converges after late inputs under jittery latency', () => {
    const game = new Game();
    let n = 0;
    const a = game.join('Ada', { latencyMs: () => 30 + ((n++ * 37) % 90) });
    game.run(1500);
    a.controls = BURN; game.run(400);
    a.controls = { turn: 1, throttle: 0, engine: true }; game.run(150);
    a.controls = IDLE; game.run(1500);
    const id = shipOf(game, 0);
    // The client runs ahead of the host; let the host reach the predicted tick.
    const world = a.client.world!;
    const tick = world.tick, mine = world.ship(id)!.state;
    expect(tick).toBeGreaterThan(game.host.world.tick);
    game.run(300, true);
    const host = game.hostTicks.get(tick)!.get(id) as State;
    expect(mine.position).toEqual(host.position);
    expect(mine.velocity).toEqual(host.velocity);
    expect(mine.status).toBe(host.status);
    expect(mine.position).not.toEqual(game.host.world.presetState('pad').state.position);
  });

  it('shows other pilots ships moving with their reported controls', () => {
    const game = new Game();
    const a = game.join('Ada'), b = game.join('Bo');
    game.run(1000);
    a.controls = BURN;
    game.run(800);
    const id = shipOf(game, 0);
    const seen = b.client.world!.ship(id)!;
    const truth = game.host.world.ship(id)!;
    expect(seen.state.status).toBe('flying');
    expect(seen.controls.engine).toBe(true);
    // B runs ahead of the host by its lead, so compare against the host's motion scale.
    expect(Math.hypot(seen.state.position.x - truth.state.position.x, seen.state.position.y - truth.state.position.y)).toBeLessThan(15);
  });

  it('refuses commands for ships owned by someone else', () => {
    const game = new Game();
    const a = game.join('Ada'), b = game.join('Bo');
    const notices: string[] = [];
    b.client.onnotice = text => notices.push(text);
    game.run(500);
    const aShip = shipOf(game, 0);
    b.ship = aShip;
    b.controls = BURN;
    b.client.setGodMode(aShip, true);
    b.client.respawn(aShip);
    game.run(500);
    expect(game.host.world.ship(aShip)!.state.status).toBe('landed');
    expect(game.host.world.ship(aShip)!.state.godMode).toBeUndefined();
    expect(notices).toEqual(['You can only command your own ships.', 'You can only command your own ships.']);
    void a;
  });

  it('releases a disconnected pilot and returns their ships when they reconnect', () => {
    const game = new Game();
    const a = game.join('Ada');
    game.run(800);
    const id = shipOf(game, 0);
    a.controls = BURN;
    game.run(400);
    expect(game.host.world.ship(id)!.controls.engine).toBe(true);
    a.client.leave();
    game.run(100);
    expect(game.host.world.ship(id)!.controls).toEqual(IDLE);
    expect(game.host.playerList()).toEqual([{ id: a.client.playerId, name: 'Ada', connected: false }]);
    const again = game.join('Ada 2', { tokens: a.tokens });
    game.run(300);
    expect(again.client.playerId).toBe(a.client.playerId);
    expect(again.client.ownShips().map(s => s.id)).toEqual([id]);
    expect(game.host.playerName(a.client.playerId!)).toBe('Ada 2');
    expect(game.host.world.size).toBe(1);
  });

  it('releases a silent pilot after the timeout', () => {
    const game = new Game({ releaseAfterMs: 500 });
    const a = game.join('Ada');
    game.run(500);
    a.controls = BURN;
    game.run(200);
    const id = shipOf(game, 0);
    expect(game.host.world.ship(id)!.controls.engine).toBe(true);
    game.pilots.length = 0; // the client stops updating (a hidden tab), but stays connected
    game.run(1200);
    expect(game.host.world.ship(id)!.controls).toEqual(IDLE);
  });

  it('replaces an older connection for the same pilot', () => {
    const game = new Game();
    const first = game.join('Ada');
    game.run(300);
    const second = game.join('Ada', { tokens: first.tokens });
    game.run(300);
    expect(first.client.phase).toBe('closed');
    expect(first.client.closeReason).toBe('You joined from another window.');
    expect(second.client.phase).toBe('joined');
    expect(game.host.connectedCount()).toBe(1);
  });

  it('enforces passwords, the player limit and ship limits', () => {
    const game = new Game({ password: 'orbit', maxPlayers: 2, maxShipsPerPlayer: 2 });
    const wrong = game.join('Eve', { password: 'guess' });
    const none = game.join('Nil');
    const a = game.join('Ada', { password: 'orbit' }), b = game.join('Bo', { password: 'orbit' });
    const c = game.join('Cy', { password: 'orbit' });
    game.run(500);
    expect(wrong.client.closeReason).toBe('Wrong password.');
    expect(none.client.closeReason).toBe('This server needs a password.');
    expect(c.client.closeReason).toBe('The game is full (2 players).');
    expect([a.client.phase, b.client.phase]).toEqual(['joined', 'joined']);
    const notices: string[] = [];
    a.client.onnotice = text => notices.push(text);
    a.client.remove(shipOf(game, 2));
    a.client.spawn('planet-orbit');
    a.client.spawn();
    game.run(300);
    expect(a.client.ownShips().map(s => s.bodyId)).toEqual(['planet', 'planet']);
    expect(notices).toEqual(['Keep at least one ship.', 'Ship limit reached (2 per pilot).']);
    a.client.remove(a.client.ownShips()[0]!.id);
    game.run(300);
    expect(a.client.ownShips()).toHaveLength(1);
  });

  it('shares host pauses and holds prediction while paused', () => {
    const game = new Game();
    const a = game.join('Ada');
    game.run(500);
    game.host.setPaused(true, 'Paused by host');
    game.run(100);
    expect(a.client.paused).toBe(true);
    expect(a.client.pauseReason).toBe('Paused by host');
    const tick = a.client.world!.tick;
    a.controls = BURN;
    game.run(500);
    expect(a.client.world!.tick).toBe(tick);
    expect(game.host.world.tick).toBe(tick);
    game.host.setPaused(false);
    game.run(600);
    expect(a.client.paused).toBe(false);
    expect(game.host.world.ship(shipOf(game, 0))!.state.status).toBe('flying');
  });

  it('seats the browser host with a token, ahead of remote players', () => {
    const game = new Game({ maxPlayers: 2 });
    const hostId = game.host.seatHost('Hana', 'f'.repeat(32));
    game.host.spawnShip(hostId, 'pad', true);
    const a = game.join('Ada'), b = game.join('Bo');
    game.run(300);
    expect(a.client.phase).toBe('joined');
    expect(b.client.closeReason).toBe('The game is full (2 players).');
    expect(a.client.players.find(p => p.id === hostId)).toEqual({ id: hostId, name: 'Hana', connected: true, host: true });
    const impostor = game.join('Hana?', { tokens: new Map([['w-test', 'f'.repeat(32)]]) });
    game.run(300);
    expect(impostor.client.closeReason).toBe('That pilot is the host.');
    expect(game.host.seatHost('Hana', 'f'.repeat(32))).toBe(hostId);
  });

  it('drops malformed, early and flooding connections without disturbing the world', () => {
    const game = new Game();
    const send = (texts: string[]): string[] => {
      const [client, host] = loopback(deliver => deliver());
      const received: string[] = [];
      client.onmessage = text => received.push(text);
      game.host.accept(host);
      for (const text of texts) client.send(text);
      return received.map(text => parseHostMessage(text).t === 'error' ? (JSON.parse(text) as { message: string }).message : parseHostMessage(text).t);
    };
    expect(send(['{"t":"spawn"}'])).toEqual(['info', 'Join first.']);
    expect(send(['not json'])).toEqual(['info', 'Invalid message: message is not JSON']);
    expect(send([JSON.stringify({ t: 'input', seq: 1, ship: 'ship-1', tick: 0, turn: 5, throttle: 0, engine: true })]))
      .toEqual(['info', 'Invalid message: turn must be in [-1, 1]']);
    expect(send(Array.from({ length: 400 }, (_, i) => JSON.stringify({ t: 'ping', id: i }))).at(-1)).toBe('Too many messages.');
    const idle = loopback(deliver => deliver());
    game.host.accept(idle[1]);
    game.net.now += 20000;
    game.host.service();
    expect(game.host.connectedCount()).toBe(0);
    expect(game.host.world.size).toBe(0);
  });

  it('closes with a clear message when versions differ', () => {
    const [client, host] = loopback(deliver => deliver());
    const session = new ClientSession(client, { name: 'Ada' });
    host.send(JSON.stringify({ t: 'info', protocol: 'space-sim-net/0', model: MODEL, worldId: 'w-x', name: 'Old', password: false, players: 0, maxPlayers: 4 }));
    expect(session.phase).toBe('closed');
    expect(session.closeReason).toBe(`Version mismatch: the host runs space-sim-net/0 / ${MODEL}; this game runs ${PROTOCOL} / ${MODEL}.`);
  });

  it('survives a hostile host sending a broken universe', () => {
    const [client, host] = loopback(deliver => deliver());
    const session = new ClientSession(client, { name: 'Ada' });
    host.send(JSON.stringify({ t: 'info', protocol: PROTOCOL, model: MODEL, worldId: 'w-x', name: 'Bad', password: false, players: 0, maxPlayers: 4 }));
    host.send(JSON.stringify({ t: 'welcome', playerId: 'p-1', universe: { schemaVersion: 1 }, systemId: 'x', tick: 0, time: 0,
      paused: false, rules: { maxPlayers: 1, maxShipsPerPlayer: 1, allowGodMode: true, snapshotEveryTicks: 5 }, players: [], ships: [] }));
    expect(session.phase).toBe('closed');
    expect(session.closeReason).toContain('Could not follow the host');
  });

  it('forgets an away pilot without ships to stay within the save limit, else refuses', () => {
    const away = Array.from({ length: 512 }, (_, i) => ({ id: `p-old${i}`, name: `Old ${i}` }));
    const roomy = new Game({}, undefined, away);
    const newcomer = roomy.join('New');
    roomy.run(300);
    expect(newcomer.client.phase).toBe('joined');
    expect(roomy.host.roster()).toHaveLength(512);
    expect(roomy.host.roster().some(p => p.id === 'p-old0')).toBe(false);

    const world = new World(DEFAULT_UNIVERSE, { id: 'w-test' });
    for (const p of away) world.spawn({ ownerId: p.id });
    const crowded = new Game({ maxShips: 1024 }, world, away);
    const refused = crowded.join('New');
    crowded.run(300);
    expect(refused.client.closeReason).toBe('This world has no room for new pilots.');
  });

  it('keeps showing a ship it cannot verify, held where the host says it is', () => {
    const [client, host] = loopback(deliver => deliver());
    const session = new ClientSession(client, { name: 'Ada', now: () => 0 });
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-x' });
    world.spawn({ ownerId: 'p-other', presetId: 'planet-orbit' });
    world.step();
    const ship = { ...shipToSaved(world.ship('ship-1')!), controls: [0, 0, 0] };
    const tampered = { ...ship, position: [ship.position[0] + 5, ship.position[1]] };
    host.send(JSON.stringify({ t: 'info', protocol: PROTOCOL, model: MODEL, worldId: 'w-x', name: 'Host', password: false, players: 1, maxPlayers: 4 }));
    host.send(JSON.stringify({ t: 'welcome', playerId: 'p-me', universe: DEFAULT_UNIVERSE, systemId: 'primus-system',
      tick: world.tick, time: world.time, paused: false, rules: { maxPlayers: 4, maxShipsPerPlayer: 2, allowGodMode: true, snapshotEveryTicks: 5 },
      players: [], ships: [tampered] }));
    expect(session.phase).toBe('joined');
    const seen = session.world!.ship('ship-1')!;
    expect(seen.state.position).toEqual({ x: tampered.position[0], y: tampered.position[1] });
    expect(seen.fault).toContain('Not verified here: Ship ship-1: coast epoch disagrees');
  });

  it('restores roster identities from a save so pilots reclaim ships on a new host', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-test' });
    world.spawn({ ownerId: 'p-saved', presetId: 'planet-orbit' });
    const game = new Game({}, world, [{ id: 'p-saved', name: 'Old', tokenHash: sha256Hex('a'.repeat(32)) }]);
    const back = game.join('Ada', { tokens: new Map([['w-test', 'a'.repeat(32)]]) });
    game.run(300);
    expect(back.client.playerId).toBe('p-saved');
    expect(back.client.ownShips().map(s => s.id)).toEqual(['ship-1']);
    expect(game.host.world.size).toBe(1);
  });
});
