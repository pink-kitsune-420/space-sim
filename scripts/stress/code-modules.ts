import { readFileSync } from 'node:fs';
import { parseCodeArtifact, enableCodeArtifact, sha256Hex, canonicalJson } from '../../packages/game-runtime/src/index';
import { DEFAULT_PROFILE, prepareGame } from '../../packages/modules/src/index';
import { steadyLift } from '../../examples/modules/motion';
import type { RegisteredModule } from '../../packages/game-api/src/index';

const text = readFileSync(process.argv[2]!, 'utf8');
const percentile = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]!;
const parseTimes: number[] = [], enableTimes: number[] = [];
let code: RegisteredModule = steadyLift;
for (let i = 0; i < 50; i++) {
  let start = performance.now(); const artifact = parseCodeArtifact(text); parseTimes.push(performance.now() - start);
  start = performance.now(); code = enableCodeArtifact(artifact, 'node'); enableTimes.push(performance.now() - start);
}
const measure = (module: RegisteredModule) => {
  const start = performance.now();
  const game = prepareGame({ environment: 'node', code: [module], profile: { ...DEFAULT_PROFILE, id: 'local.measure',
    modules: [...DEFAULT_PROFILE.modules, { id: module.manifest.id, version: module.manifest.version }] } });
  const prepareMs = performance.now() - start;
  const ship = game.world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
  const ticks: number[] = [];
  for (let i = 0; i < 2200; i++) {
    const time = performance.now(); game.world.step(); if (i >= 200) ticks.push(performance.now() - time);
  }
  const { moduleState, ...state } = game.world.ship(ship.id)!.state;
  const result = { prepareMs, tickP50Ms: percentile(ticks, .5), tickP95Ms: percentile(ticks, .95),
    stateDigest: sha256Hex(canonicalJson(JSON.parse(JSON.stringify({ state, moduleValue: Object.values(moduleState ?? {}).map(v => v.value) })))) };
  game.candidate.dispose(); return result;
};
// Alternate twice to expose cold-JIT effects rather than claiming one sample is a regression gate.
const trials = [measure(steadyLift), measure(code), measure(steadyLift), measure(code)];
console.log(JSON.stringify({ artifactBytes: Buffer.byteLength(text), digest: parseCodeArtifact(text).digest,
  parseP50Ms: percentile(parseTimes, .5), parseP95Ms: percentile(parseTimes, .95),
  enableP50Ms: percentile(enableTimes, .5), enableP95Ms: percentile(enableTimes, .95),
  staticTrials: [trials[0], trials[2]], importedTrials: [trials[1], trials[3]],
  equivalentFinalStates: trials.every(t => t.stateDigest === trials[0]!.stateDigest) }));
