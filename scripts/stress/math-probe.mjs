// Which Math functions give different bits in Node, Chromium and Firefox?
// Usage: node scripts/stress/math-probe.mjs
import { chromium, firefox } from '@playwright/test';

const probe = () => {
  // Deterministic inputs spanning the ranges the physics uses.
  let s = 12345;
  const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const view = new DataView(new ArrayBuffer(8));
  const hex = v => { view.setFloat64(0, v); return view.getBigUint64(0).toString(16); };
  const fns = {
    sin: x => Math.sin(x * 20 - 10), cos: x => Math.cos(x * 20 - 10), atan2: (x, y) => Math.atan2(y - 0.5, x - 0.5),
    normalize: x => { const a = x * 20 - 10; return Math.atan2(Math.sin(a), Math.cos(a)); },
    hypot: (x, y) => Math.hypot(x * 1e7, y * 1e7), sqrt: x => Math.sqrt(x * 1e12), pow15: x => (x * 3) ** 1.5, pow3: x => (x * 3 - 1) ** 3,
    pow2: x => (x * 3 - 1) ** 2, exp: x => Math.exp(x * 4 - 2), expm1: x => Math.expm1(x * 4 - 2), asin: x => Math.asin(x),
    asinh: x => Math.asinh(x * 100), cbrt: x => Math.cbrt(x * 1e9), log: x => Math.log(x * 1e6 + 1),
  };
  const out = {};
  for (const [name, fn] of Object.entries(fns)) {
    const values = [];
    for (let i = 0; i < 20000; i++) values.push(hex(fn(rand(), rand())));
    out[name] = values;
  }
  return out;
};
const node = probe();
for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  const browser = await type.launch();
  const page = await browser.newPage();
  const result = await page.evaluate(`(${probe.toString()})()`);
  const summary = {};
  for (const fn of Object.keys(node)) summary[fn] = node[fn].filter((v, i) => v !== result[fn][i]).length;
  console.log(name, browser.version(), JSON.stringify(summary));
  await browser.close();
}
