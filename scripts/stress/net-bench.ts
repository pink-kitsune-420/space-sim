// Snapshot bandwidth with many objects: delta snapshots against the complete snapshot
// (what protocol 1 sent 20 times a second), using the deterministic in-memory network.
// Run: node scripts/stress/run.mjs scripts/stress/net-bench.ts --asteroids=2000 --pilots=4 --seconds=10
import { deflateRawSync } from 'node:zlib';
import { World } from '../../packages/sim-core/src/world';
import { parseHostMessage } from '../../packages/net/src/protocol';
import type { ClientSession } from '../../packages/net/src/client';
import { BUILTIN_UNIVERSES } from '../../packages/scenarios/builtin';
import { populateStress } from '../../packages/scenarios/stress';
import { Game } from '../../tests/helpers/net-harness';

const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const asteroids = Number(args.get('asteroids') ?? 2000);
const pilots = Number(args.get('pilots') ?? 4);
const seconds = Number(args.get('seconds') ?? 10);
const universe = BUILTIN_UNIVERSES[args.get('universe') ?? 'full']!;

const world = new World(universe, { id: 'w-bench' });
populateStress(world, { asteroids, seed: 9 });
const game = new Game({ maxPlayers: 32, maxShipsPerPlayer: 4, maxShips: 1_000_000 }, world);
const stats = { deltas: 0, fulls: 0, bytes: 0, deflated: 0, ships: 0, maxShips: 0 };
function tap(client: ClientSession): void {
  const connection = (client as unknown as { connection: { onmessage: ((text: string) => void) | null } }).connection;
  const original = connection.onmessage!;
  connection.onmessage = text => {
    const message = parseHostMessage(text);
    if (message.t === 'snapshot') {
      if (message.full) stats.fulls++; else stats.deltas++;
      stats.bytes += text.length;
      stats.deflated += deflateRawSync(text).length;
      stats.ships += message.ships.length;
      stats.maxShips = Math.max(stats.maxShips, message.ships.length);
    }
    original(text);
  };
}
for (let i = 0; i < pilots; i++) { const p = game.join(`P${i}`); tap(p.client); }
game.run(500);
// Everyone flies around: burns, turns, coasting, a few extra ships.
const start = performance.now();
for (let ms = 0; ms < seconds * 1000; ms += 250) {
  game.pilots.forEach((p, i) => {
    const phase = Math.floor(ms / 250 + i) % 8;
    p.controls = phase < 3 ? { turn: phase - 1, throttle: 0, engine: true } : { turn: 0, throttle: 0, engine: false };
  });
  if (ms === 2000) game.pilots.forEach(p => p.client.spawn());
  game.run(250);
}
const wallMs = performance.now() - start;
const full = JSON.stringify(game.host.snapshot());
const perSecond = 1000 / (game.host.settings.snapshotEveryTicks * 10);
const report = {
  objects: game.host.world.size, pilots, seconds,
  snapshotsPerClientPerSecond: perSecond,
  delta: { snapshots: stats.deltas, fullSnapshots: stats.fulls, meanShips: +(stats.ships / Math.max(1, stats.deltas + stats.fulls)).toFixed(1),
    maxShips: stats.maxShips,
    bytesPerClientPerSecond: Math.round(stats.bytes / pilots / seconds),
    deflatedBytesPerClientPerSecond: Math.round(stats.deflated / pilots / seconds) },
  protocol1: { bytesPerSnapshot: full.length, bytesPerClientPerSecond: Math.round(full.length * perSecond),
    deflatedBytesPerClientPerSecond: Math.round(deflateRawSync(full).length * perSecond) },
  hostAndClientsCpuMs: Math.round(wallMs),
};
console.log(JSON.stringify(report, null, 2));
