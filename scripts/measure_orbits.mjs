import { readFile, writeFile } from 'node:fs/promises';
import { elements, propagate } from '../packages/sim-core/src/orbit.ts';

const document = JSON.parse(await readFile('tests/fixtures/orbits.json', 'utf8'));
let worstState = 0, worstEnergy = 0, worstMomentum = 0, maxIterations = 0, maxResidual = 0;
const cases = [];
for (const fixture of document.fixtures) {
  const result = propagate(fixture.input, fixture.mu, fixture.seconds);
  if (!result.ok) throw new Error(`${fixture.id}: ${result.diagnostics.reason}`);
  const { state, diagnostics } = result;
  const position = Math.hypot(state.position.x - fixture.expected.position.x,
    state.position.y - fixture.expected.position.y) / fixture.lengthScale;
  const velocity = Math.hypot(state.velocity.x - fixture.expected.velocity.x,
    state.velocity.y - fixture.expected.velocity.y) / fixture.speedScale;
  const a = elements(fixture.input, fixture.mu), b = elements(state, fixture.mu);
  const energy = Math.abs(b.energy - a.energy) / fixture.speedScale ** 2;
  const momentum = Math.abs(b.angularMomentum - a.angularMomentum) / (fixture.lengthScale * fixture.speedScale);
  worstState = Math.max(worstState, position, velocity);
  worstEnergy = Math.max(worstEnergy, energy);
  worstMomentum = Math.max(worstMomentum, momentum);
  maxIterations = Math.max(maxIterations, diagnostics.iterations);
  maxResidual = Math.max(maxResidual, Math.abs(diagnostics.residualSeconds ?? 0));
  cases.push({ id: fixture.id, position, velocity, scaledEnergyDrift: energy, scaledMomentumDrift: momentum,
    iterations: diagnostics.iterations, residualSeconds: diagnostics.residualSeconds });
}
const report = { measuredAt: new Date().toISOString(), node: process.version,
  model: document.model, fixtureGenerator: document.generator,
  normalization: 'Position/L, velocity/V, energy/V², signed momentum/(L*V); fixture L,V',
  summary: { fixtureCount: cases.length, worstState, worstScaledEnergyDrift: worstEnergy,
    worstScaledMomentumDrift: worstMomentum, maxIterations, maxResidualSeconds: maxResidual }, cases };
await writeFile('private-docs/measurements/m2-orbits.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary, null, 2));
