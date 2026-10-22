import { expect, it } from 'vitest';
import { prepareDefaultLaunch } from '../../apps/web/src/default-launch';
import { requestedBuiltinGame } from '../../apps/web/src/bundled-games';
import { prepareGame, validateDataModule, loadInstalledWorld } from '../../packages/modules/src/index';
import previewData from '../../games/space-sim-successor/planet-preview.json';
import { inertialState } from '../../packages/sim-core/src/spin';
import { saveWorld } from '../../packages/sim-core/src/save';
import { IDLE } from '../../packages/sim-core/src/constants';
import type { World } from '../../packages/sim-core/src/world';

const game = requestedBuiltinGame('?game=space-sim-successor');
const preview = validateDataModule(previewData);
function prepare(generated: boolean, systemId?: string) {
  return prepareGame({ environment: 'node', data: [...game.bundle.modules, ...(generated ? [preview] : [])],
    profile: { ...game.bundle.profile, modules: [...game.bundle.profile.modules,
      ...(generated ? [{ id: preview.manifest.id, version: preview.manifest.version }] : [])] },
    universeKey: generated ? `${preview.manifest.id}/successor-field-v2` : game.bundle.selection.universe,
    systemId: systemId ?? (generated ? 'primus-field-system' : 'primus-system') });
}

// Independent geometry: native trig and the authored site, without the startup solver
// or the production rotation helper. Include the site's offset from the planet centre.
function solarElevation(world: World, time: number, local: { x: number; y: number }): number {
  const body = world.body('planet'), rotation = body.rotation!;
  const angle = rotation.phase + rotation.direction * 2 * Math.PI * time / rotation.period;
  const x = local.x * Math.cos(angle) - local.y * Math.sin(angle);
  const y = local.x * Math.sin(angle) + local.y * Math.cos(angle);
  const origin = world.system.getBodyPosition('planet', time), sun = world.system.getBodyPosition('star', time);
  const dx = sun.x - origin.x - x, dy = sun.y - origin.y - y;
  return Math.asin((x * dx + y * dy) / (Math.hypot(x, y) * Math.hypot(dx, dy))) * 180 / Math.PI;
}

it.each([false, true])('starts the %s generated default deterministically in rising daylight and launches normally', generated => {
  const ticks: number[] = [];
  for (let repeat = 0; repeat < 2; repeat++) {
    const { world, candidate } = prepare(generated);
    try {
      const before = world.presetState('pad').state;
      prepareDefaultLaunch(world, game.info.id);
      ticks.push(world.tick);
      const ship = world.spawn({ ownerId: 'pilot', presetId: 'pad' });
      const start = ship.state, body = world.body('planet');
      expect(start.status).toBe('landed');
      expect(start.position).toEqual(world.presetState('pad', 2.5).state.position);
      expect(start.heading).toBe(before.heading);
      expect(start.velocity).toEqual({ x: 0, y: 0 });
      const elevation = solarElevation(world, start.time, start.position);
      expect(elevation).toBeGreaterThanOrEqual(45);
      expect(elevation).toBeLessThan(45.01);
      expect(solarElevation(world, start.time + 1, start.position)).toBeGreaterThan(elevation);
      expect(solarElevation(world, start.time + body.rotation!.period / 4, start.position)).toBeGreaterThan(0);
      const inertial = inertialState(start, body), omega = -2 * Math.PI / body.rotation!.period;
      expect(inertial.velocity.x).toBeCloseTo(-omega * inertial.position.y, 10);
      expect(inertial.velocity.y).toBeCloseTo(omega * inertial.position.x, 10);
      expect(Math.cos(inertial.heading)).toBeCloseTo(inertial.position.x / Math.hypot(inertial.position.x, inertial.position.y), 8);
      for (let tick = 0; tick < 100; tick++) world.step();
      expect(world.ship(ship.id)!.state.position).toEqual(start.position);
      world.setControls(ship.id, { ...IDLE, engine: true });
      for (let tick = 0; tick < 100; tick++) world.step();
      expect(world.ship(ship.id)!.state.status).toBe('flying');
      expect(world.ship(ship.id)!.fault).toBeUndefined();
      const saved = saveWorld(world), restored = loadInstalledWorld(saved, { environment: 'node', data: [...game.bundle.modules, ...(generated ? [preview] : [])] });
      try {
        prepareDefaultLaunch(restored.world, game.info.id);
        expect(saveWorld(restored.world)).toEqual(saved);
      } finally { restored.world.dispose(); }
      console.info(JSON.stringify({ generated, tick: ticks.at(-1), elevation, daylightAfterSeconds: body.rotation!.period / 4 }));
    } finally { candidate.dispose(); }
  }
  expect(ticks[0]).toBeGreaterThan(0);
  expect(ticks[1]).toBe(ticks[0]);
}, 60_000);

it('preserves Classic, explicit alternative scenarios/systems and existing worlds, including time zero', () => {
  const { world, candidate } = prepare(false);
  try {
    prepareDefaultLaunch(world, 'builtin.space-sim'); expect(world.tick).toBe(0);
    prepareDefaultLaunch(world, game.info.id, 'planet-orbit'); expect(world.tick).toBe(0);
    const ship = world.spawn({ ownerId: 'existing-player', presetId: 'pad' });
    const saved = saveWorld(world);
    prepareDefaultLaunch(world, game.info.id);
    expect(saveWorld(world)).toEqual(saved); expect(world.ship(ship.id)!.state.time).toBe(0);
  } finally { candidate.dispose(); }
  const alternate = prepare(false, 'primus-system-2x');
  try { prepareDefaultLaunch(alternate.world, game.info.id); expect(alternate.world.tick).toBe(0); }
  finally { alternate.candidate.dispose(); }
});
