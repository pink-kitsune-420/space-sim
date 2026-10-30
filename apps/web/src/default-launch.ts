// Copyright (c) 2026 pink-kitsune-420
// SPDX-License-Identifier: MIT

import type { World } from '../../../packages/sim-core/src/world';
import { rotate, spinAngle } from '../../../packages/sim-core/src/spin';
import { STEP } from '../../../packages/sim-core/src/constants';

/** Choose the first rising 45° Sun at the existing pad before seating a fresh demo.
 * Only the clock changes; landed position/heading remain in the rotating body frame.
 * Save restoration, joining and explicit scenario changes never call this path. */
export function prepareDefaultLaunch(world: World, gameId: string, presetId = 'pad'): void {
  if (gameId !== 'builtin.space-sim-successor' || presetId !== 'pad'
    || world.tick !== 0 || world.time !== 0 || world.ships().length !== 0) return;
  const defaultWorld = world.universe.id === 'successor-universe' && world.systemId === 'primus-system';
  const previewWorld = world.universe.id === 'successor-field-v2' && world.systemId === 'primus-field-system';
  if (!defaultWorld && !previewWorld) return;
  const pad = world.system.presets.find(p => p.id === 'pad');
  const star = world.system.getAllBodies().find(b => b.surfaceFeatures === 'star');
  if (!pad || pad.bodyId !== 'planet' || pad.kind !== 'landed' || !star) return;
  const body = world.body(pad.bodyId), period = body.rotation?.period;
  if (!period) return;
  const local = world.presetState(pad.id).state.position;
  const radius = Math.hypot(local.x, local.y);
  const target = Math.SQRT1_2;
  const sunlight = (time: number): number => {
    const site = rotate(local, spinAngle(body, time));
    const origin = world.system.getBodyPosition(body.id, time);
    const sun = world.system.getBodyPosition(star.id, time);
    const dx = sun.x - origin.x - site.x, dy = sun.y - origin.y - site.y;
    return (site.x * dx + site.y * dy) / (radius * Math.hypot(dx, dy));
  };
  // Bracket an upward crossing, accounting for orbital motion as well as spin.
  const interval = period / 64;
  let low = 0;
  for (let sample = 1; sample <= 128; sample++) {
    let high = sample * interval;
    if (sunlight(low) < target && sunlight(high) >= target) {
      for (let iteration = 0; iteration < 40; iteration++) {
        const middle = (low + high) / 2;
        if (sunlight(middle) < target) low = middle; else high = middle;
      }
      // Advance the empty world on its ordinary fixed clock, before any ship exists.
      world.advanceTo(Math.ceil(high / STEP));
      return;
    }
    low = high;
  }
}
