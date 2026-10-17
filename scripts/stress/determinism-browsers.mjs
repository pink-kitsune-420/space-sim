// Run scripts/stress/determinism.ts in Chromium and Firefox and compare every ship's bits
// with the Node run (node scripts/stress/run.mjs scripts/stress/determinism.ts first).
import { chromium, firefox } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'rolldown';

const node = JSON.parse(readFileSync('test-results/determinism-node.json', 'utf8'));
const out = await build({ input: resolve('scripts/stress/determinism.ts'), platform: 'browser', logLevel: 'warn',
  write: false, output: { format: 'iife' } });
const code = out.output[0].code;
for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>probe</title>');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(() => window.__probe);
    const differing = Object.keys(node.states).filter(id => node.states[id] !== result.states[id]);
    let worst = 0;
    for (const id of differing) {
      const a = node.states[id].split(':')[3], b = result.states[id]?.split(':')[3] ?? '';
      const view = new DataView(new ArrayBuffer(8));
      const value = hex => { view.setBigUint64(0, BigInt(`0x${hex}`)); return view.getFloat64(0); };
      for (let k = 0; k < 2; k++) {
        const x = value(a.slice(k * 16, k * 16 + 16)), y = value(b.slice(k * 16, k * 16 + 16));
        worst = Math.max(worst, Math.abs(x - y));
      }
    }
    console.log(JSON.stringify({ browser: name, version: browser.version(), ships: result.ships, digest: result.digest,
      nodeDigest: node.digest, identical: differing.length === 0, differingShips: differing.length,
      worstPositionDifferenceMetres: worst, sample: differing.slice(0, 3) }));
  } finally { await browser.close(); }
}
