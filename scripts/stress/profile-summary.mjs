// Summarize a V8 .cpuprofile: self and inclusive time by function.
// Usage: node scripts/stress/profile-summary.mjs <file.cpuprofile> [top=40]
import { readFileSync } from 'node:fs';
const [file, topArg] = process.argv.slice(2);
const profile = JSON.parse(readFileSync(file, 'utf8'));
const top = Number(topArg ?? 40);
const nodes = new Map(profile.nodes.map(n => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map();
const deltas = profile.timeDeltas;
const counts = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i];
  counts.set(id, (counts.get(id) ?? 0) + (deltas[i] ?? 0));
}
const key = n => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
let total = 0;
const inclusive = new Map();
for (const [id, us] of counts) {
  total += us;
  const n = nodes.get(id);
  self.set(key(n), (self.get(key(n)) ?? 0) + us);
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const k = key(nodes.get(cur));
    if (seen.has(k)) continue;
    seen.add(k);
    inclusive.set(k, (inclusive.get(k) ?? 0) + us);
  }
}
const fmt = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, top)
  .map(([k, us]) => `${(us / 1000).toFixed(1).padStart(9)} ms ${(100 * us / total).toFixed(1).padStart(5)}%  ${k}`).join('\n');
console.log(`total ${(total / 1000).toFixed(1)} ms\n--- self ---\n${fmt(self)}\n--- inclusive ---\n${fmt(inclusive)}`);
