// Cross-engine determinism probe: the same world run for the same steps must produce the
// same bits in Node (V8), Chromium (V8) and Firefox (SpiderMonkey). Delta snapshots only
// refresh idle ships now and then because every peer is expected to compute identical
// motion; this measures whether that holds and how far engines drift when it does not.
//
// Node:    node scripts/stress/run.mjs scripts/stress/determinism.ts
// Browser: bundled as an IIFE by scripts/stress/determinism-browsers.mjs
import { World } from '../../packages/sim-core/src/world';
import { BUILTIN_UNIVERSES } from '../../packages/scenarios/builtin';
import { populateStress } from '../../packages/scenarios/stress';

export interface Probe { readonly ships: number; readonly ticks: number; readonly digest: string; readonly states: Record<string, string> }

/** Float64 bits as hex: exact and compact. */
function bits(values: readonly number[]): string {
  const view = new DataView(new ArrayBuffer(8));
  return values.map(v => { view.setFloat64(0, v); return view.getBigUint64(0).toString(16).padStart(16, '0'); }).join('');
}

export function probe(ticks = 3000): Probe {
  const world = new World(BUILTIN_UNIVERSES.full!, { id: 'probe' });
  populateStress(world, { ships: 60, asteroids: 600, seed: 3, burn: true });
  for (let t = 0; t < ticks; t++) {
    if (t === 1500) for (const ship of [...world.records()]) if (ship.controls.engine) world.setControls(ship.id, { turn: 1, throttle: 0, engine: false });
    world.step();
  }
  const states: Record<string, string> = {};
  let digest = 0;
  for (const ship of world.ships()) {
    const s = ship.state;
    const text = `${ship.bodyId}:${s.status}:${s.revision}:${bits([s.position.x, s.position.y, s.velocity.x, s.velocity.y, s.heading])}`;
    states[ship.id] = text;
    for (let i = 0; i < text.length; i++) digest = (Math.imul(digest, 31) + text.charCodeAt(i)) | 0;
  }
  return { ships: world.size, ticks, digest: (digest >>> 0).toString(16), states };
}

const g = globalThis as { process?: { getBuiltinModule?: (id: string) => unknown }; __probe?: Probe };
const fs = g.process?.getBuiltinModule?.('node:fs') as { writeFileSync(path: string, text: string): void } | undefined;
if (fs) {
  const result = probe();
  console.log(JSON.stringify({ ships: result.ships, ticks: result.ticks, digest: result.digest }));
  // Full states for comparison with browsers.
  fs.writeFileSync('test-results/determinism-node.json', JSON.stringify(result));
} else {
  g.__probe = probe();
}
