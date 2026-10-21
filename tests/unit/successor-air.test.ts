import { expect, it } from 'vitest';
import { AirClock, SuccessorAir } from '../../apps/web/src/successor-air';
import { requestedBuiltinGame } from '../../apps/web/src/bundled-games';
import { prepareGame } from '../../packages/modules/src/index';

it('advances only active real seconds and resets on world change, pause/hidden suspension without catch-up', () => {
  const clock = new AirClock(), world = {};
  clock.advance(1, false, false, world); clock.advance(2, false, false, world); expect(clock.seconds).toBe(2);
  clock.advance(9, true, false, world); clock.advance(9, false, false, world); expect(clock.seconds).toBe(2);
  clock.advance(1, false, false, world); expect(clock.seconds).toBe(3);
  clock.suspend(); clock.advance(5000, false, false, world); expect(clock.seconds).toBe(3);
  clock.advance(5000, false, true, world); clock.advance(5000, false, false, world); expect(clock.seconds).toBe(3);
  clock.advance(NaN, false, false, world); expect(clock.seconds).toBe(3);
  clock.advance(3, false, false, {}); expect(clock.seconds).toBe(0);
});

it.each([2, 4, 8])('limits authored air to Primus, keeps fixed metre shell and low/off replacement at %ix', scale => {
  const game = requestedBuiltinGame('?game=space-sim-successor');
  const { world, candidate } = prepareGame({ environment: 'node', data: game.bundle.modules,
    profile: game.bundle.profile, universeKey: game.bundle.selection.universe,
    systemId: scale === 4 ? 'primus-system' : `primus-system-${scale}x` });
  try {
    const controller = new SuccessorAir(), primus = world.system.getAllBodies().find(b => b.id === 'planet')!, parvus = world.system.getAllBodies().find(b => b.id === 'moon')!;
    expect(controller.forBody(primus, false)?.mode).toBe('off');
    controller.mode = 'clouds'; const air = controller.forBody(primus, false)!;
    expect(air.mode).toBe('clouds'); expect(air.cloudAltitudeMetres).toBe(primus.radius * .018);
    expect(controller.forBody(primus, true)).toBe(air); expect(air.mode).toBe('air');
    expect(controller.forBody(parvus, false)).toBeUndefined();
    expect(controller.forBody({ ...primus, atmosphereColor: '#ff0000' }, false)).toBe(air);
    expect(controller.forBody({ ...primus, atmosphereColor: '#00000000' }, false)).toBeUndefined();
    controller.clock.advance(1, false, false, world); controller.clock.advance(100, false, false, world);
    controller.forBody(primus, false); expect(air.phaseRadians).toBeCloseTo(.05);
    controller.mode = 'off'; expect(controller.forBody(primus, false)).toBe(air); expect(air.mode).toBe('off');
  } finally { candidate.dispose(); }
});
