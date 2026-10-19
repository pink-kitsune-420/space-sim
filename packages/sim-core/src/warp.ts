import type { WorldRead, WarpSafety } from '../../game-api/src/index';
export type { WarpSafety } from '../../game-api/src/index';

/** Standard stepped time-warp factors (1x to 100,000x), calibrated for smooth, predictable acceleration. */
export const WARP_FACTORS = Object.freeze([
  1, 2, 3, 4, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000,
] as const);
export type WarpFactor = typeof WARP_FACTORS[number];

export const MAX_WARP = 100_000;
/** Maximum warp permitted while numerical integration is active (thrust or proximity). */
export const PHYSICAL_WARP_MAX = 4;

/** Evaluates whether high-warp time acceleration is safe for the current world state.
 * High warp (>4x) is only permitted when all ships are on rails (unpowered Kepler coast,
 * landed, or crashed) and no custom world rules require per-step execution.
 * Rails already bound skips by verified surface/SOI wake times. Orbital period and
 * nominal altitude do not limit safe analytic coasts, including many revolutions. */
export function checkWarpSafety(world: WorldRead): WarpSafety {
  if (world.paused) {
    return { maxGranted: 1, reason: world.fault ? `World fault: ${world.fault}` : 'Simulation is paused', railsEligible: false };
  }
  let numerical: WarpSafety | undefined = world.rules.length > 0
    ? { maxGranted: PHYSICAL_WARP_MAX, reason: 'Custom world rules active (per-step execution required)', railsEligible: false }
    : undefined;

  // Check if any ship is actively under pilot control (engine firing or turning)
  for (const ship of world.records()) {
    const controls = ship.controls;
    if (controls.engine) {
      return { maxGranted: 1, reason: `Engine thrust active on ${ship.name || ship.id}`, railsEligible: false };
    }
    if (controls.turn !== 0 || controls.throttle !== 0) {
      numerical ??= { maxGranted: PHYSICAL_WARP_MAX, reason: `Active steering controls held on ${ship.name || ship.id}`, railsEligible: false };
    }
  }

  // Check if any ship is awake in the simulation (e.g. near surface, ocean, contact).
  // The most restrictive one decides; a ship resting on the ground sleeps on its next step.
  for (const ship of world.awakeShips()) {
    const state = ship.state, name = ship.name || ship.id;
    if (state.contact) return { maxGranted: 1, reason: `Surface contact on ${name}`, railsEligible: false };
    if (state.waterEntry) return { maxGranted: 1, reason: `Water entry on ${name}`, railsEligible: false };
    if (world.settles(ship.id)) continue;
    numerical ??= { maxGranted: PHYSICAL_WARP_MAX, railsEligible: false,
      reason: state.status === 'flying' ? `Numerical flight active on ${name}`
        : state.water !== undefined ? `${name} is afloat` : `${name} is settling on the surface` };
  }
  if (numerical) return numerical;

  // All ships are idle coasts on rails, landed, or crashed
  return { maxGranted: MAX_WARP, railsEligible: true };
}

/** Selects the next standard warp factor up (+1) or down (-1) from the ladder. */
export function nextWarpFactor(current: number, direction: 1 | -1, maxAllowed = MAX_WARP): number {
  if (direction > 0) {
    for (const factor of WARP_FACTORS) {
      if (factor > current && factor <= maxAllowed) return factor;
    }
    return Math.min(current, maxAllowed);
  } else {
    for (let i = WARP_FACTORS.length - 1; i >= 0; i--) {
      const factor = WARP_FACTORS[i]!;
      if (factor < current) return factor;
    }
    return 1;
  }
}

/** Clamps a warp factor to the valid integer range [1, maxAllowed], snapping to ladder factors. */
export function clampWarpFactor(factor: number, maxAllowed = MAX_WARP): number {
  if (!Number.isFinite(factor) || factor <= 1) return 1;
  const clamped = Math.min(Math.floor(factor), maxAllowed);
  for (let i = WARP_FACTORS.length - 1; i >= 0; i--) {
    if (WARP_FACTORS[i]! <= clamped) return WARP_FACTORS[i]!;
  }
  return 1;
}
