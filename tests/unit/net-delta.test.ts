import { describe, expect, it } from 'vitest';
import { type Controls, type State } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { parseHostMessage, type HostMessage } from '../../packages/net/src/protocol';
import type { ClientSession } from '../../packages/net/src/client';
import { populateStress } from '../../packages/scenarios/stress';
import { SOLAR_UNIVERSE } from '../../packages/scenarios/builtin';
import { Game } from '../helpers/net-harness';

type Snapshot = Extract<HostMessage, { t: 'snapshot' }>;
const BURN: Controls = { turn: 0, throttle: 0, engine: true };

/** Record every snapshot a client receives (and its size). */
function tap(client: ClientSession): { snapshots: Snapshot[]; bytes: number[] } {
  const connection = (client as unknown as { connection: { onmessage: ((text: string) => void) | null } }).connection;
  const original = connection.onmessage!;
  const seen = { snapshots: [] as Snapshot[], bytes: [] as number[] };
  connection.onmessage = text => {
    const message = parseHostMessage(text);
    if (message.t === 'snapshot') { seen.snapshots.push(message); seen.bytes.push(text.length); }
    original(text);
  };
  return seen;
}

function crowdedWorld(rocks = 400): World {
  const world = new World(SOLAR_UNIVERSE, { id: 'w-test', systemId: 'solar-system' });
  populateStress(world, { asteroids: rocks, seed: 5 });
  return world;
}

/** Every ship in each mirror against the host's record of the same tick. Mirrors run
 * ahead of the host, so freeze them and let the host catch up first. */
function mismatches(game: Game, ...clients: ClientSession[]): string[] {
  const frozen = clients.map(client => ({ tick: client.world!.tick, ships: client.world!.ships() }));
  const pilots = game.pilots.splice(0);
  game.run(400, true);
  game.pilots.push(...pilots);
  const wrong: string[] = [];
  for (const { tick, ships } of frozen) {
    const host = game.hostTicks.get(tick);
    if (!host) throw new Error(`host has no record of tick ${tick}`);
    for (const ship of ships) {
      const truth = host.get(ship.id) as State | undefined;
      if (!truth || truth.position.x !== ship.state.position.x || truth.position.y !== ship.state.position.y
        || truth.velocity.x !== ship.state.velocity.x || truth.revision !== ship.state.revision) wrong.push(`${tick}:${ship.id}`);
    }
  }
  return wrong;
}

describe('delta snapshots', () => {
  it('leave idle ships out and keep every mirrored ship exact', () => {
    const game = new Game({}, crowdedWorld());
    const a = game.join('Ada'), b = game.join('Bo');
    const seen = tap(b.client);
    game.run(500, true);
    a.controls = BURN;
    game.run(600, true);
    a.controls = { turn: 1, throttle: 0, engine: true };
    game.run(300, true);
    a.controls = { turn: 0, throttle: 0, engine: false };
    game.run(1200, true);
    const deltas = seen.snapshots.filter(s => !s.full);
    expect(deltas.length).toBeGreaterThan(30);
    // 402 ships in the world; a delta carries own ships, changes and small refresh slices.
    const largest = Math.max(...deltas.map(s => s.ships.length));
    expect(largest).toBeLessThan(20);
    expect(seen.snapshots.filter(s => s.full)).toHaveLength(0);
    expect(mismatches(game, a.client, b.client)).toEqual([]);
  });

  it('mirrors another pilot burning with constant controls between refreshes', () => {
    const game = new Game({}, crowdedWorld(50));
    const a = game.join('Ada'), b = game.join('Bo');
    game.run(500, true);
    a.controls = BURN;
    game.run(2500, true);
    const id = a.client.ownShips()[0]!.id;
    expect(game.host.world.ship(id)!.state.status).toBe('flying');
    expect(b.client.world!.ship(id)!.controls.engine).toBe(true);
    expect(mismatches(game, b.client)).toEqual([]);
  });

  it('removes ships that left the world', () => {
    const game = new Game({ maxShipsPerPlayer: 3 }, crowdedWorld(20));
    const a = game.join('Ada'), b = game.join('Bo');
    game.run(400);
    a.client.spawn();
    game.run(400);
    const extra = a.client.ownShips().map(s => s.id).sort().at(-1)!;
    expect(b.client.world!.has(extra)).toBe(true);
    a.client.remove(extra);
    game.run(400);
    expect(game.host.world.has(extra)).toBe(false);
    expect(b.client.world!.has(extra)).toBe(false);
  });

  it('catches up a player whose link fell behind with everything it missed, not the whole world', () => {
    const game = new Game({ maxShipsPerPlayer: 3 }, crowdedWorld(30));
    const a = game.join('Ada'), b = game.join('Bo');
    const seen = tap(a.client);
    game.run(400, true);
    const host = game.host as unknown as { peers: Set<{ player?: { id: string }; connection: { bufferedAmount: number } }> };
    const peer = [...host.peers].find(p => p.player?.id === a.client.playerId)!;
    // A congested link: the host skips Ada's snapshots while Bo launches, burns and removes.
    Object.defineProperty(peer.connection, 'bufferedAmount', { value: 2 << 20, configurable: true });
    const congested = game.host.world.tick;
    b.client.spawn();
    b.controls = BURN;
    game.run(300, true);
    const spare = b.client.ownShips().map(s => s.id).sort().at(-1)!;
    b.client.remove(spare);
    game.run(200, true);
    // Only snapshots already on the wire (20 ms latency) arrive while congested.
    expect(seen.snapshots.filter(s => s.tick > congested + 5)).toHaveLength(0);
    const before = seen.snapshots.length;
    Object.defineProperty(peer.connection, 'bufferedAmount', { value: 0, configurable: true });
    game.run(200, true);
    const after = seen.snapshots.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every(s => !s.full)).toBe(true);
    expect(after[0]!.gone).toContain(spare);
    expect(after[0]!.ships.some(s => s.ownerId === b.client.playerId && s.controls[2] === 1)).toBe(true);
    expect(a.client.world!.has(spare)).toBe(false);
    expect(mismatches(game, a.client, b.client)).toEqual([]);
  });

  it('sends the whole world on pause so mirrors rewind to the pause', () => {
    const game = new Game({}, crowdedWorld(30));
    const a = game.join('Ada');
    const seen = tap(a.client);
    game.run(500);
    game.host.setPaused(true, 'Hold');
    game.run(100);
    expect(seen.snapshots.at(-1)?.full).toBe(true);
    expect(a.client.world!.tick).toBe(game.host.world.tick);
  });
});
