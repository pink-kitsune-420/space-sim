import { magnitude } from './context';
import type { World } from './world';

/** Standard stepped time-warp factors (1x to 100,000x), calibrated for smooth, predictable acceleration. */
export const WARP_FACTORS = Object.freeze([
  1, 2, 3, 4, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000,
] as const);
export type WarpFactor = typeof WARP_FACTORS[number];

export const MAX_WARP = 100_000;
/** Maximum warp permitted while numerical integration is active (thrust or proximity). */
export const PHYSICAL_WARP_MAX = 4;

export interface WarpSafety {
  /** Maximum warp factor permitted under current flight conditions. */
  readonly maxGranted: number;
  /** Human-readable explanation if warp is restricted below requested. */
  readonly reason?: string;
  /** True if all ships are coasting on rails or landed (eligible for analytical time skip). */
  readonly railsEligible: boolean;
}

/** Evaluates whether high-warp time acceleration is safe for the current world state.
 * High warp (>4x) is only permitted when all ships are on rails (unpowered Kepler coast,
 * landed, or crashed) and no custom world rules require per-step execution.
 * Warp is also safely calibrated against orbital periods and planetary surface proximity. */
export function checkWarpSafety(world: World): WarpSafety {
  if (world.paused) {
    return { maxGranted: 1, reason: world.fault ? `World fault: ${world.fault}` : 'Simulation is paused', railsEligible: false };
  }
  if (world.rules.length > 0) {
    return { maxGranted: PHYSICAL_WARP_MAX, reason: 'Custom world rules active (per-step execution required)', railsEligible: false };
  }

  // Check if any ship is actively under pilot control (engine firing or turning)
  for (const ship of world.records()) {
    const controls = ship.controls;
    if (controls.engine) {
      return { maxGranted: 1, reason: `Engine thrust active on ${ship.name || ship.id}`, railsEligible: false };
    }
    if (controls.turn !== 0 || controls.throttle !== 0) {
      return { maxGranted: PHYSICAL_WARP_MAX, reason: `Active steering controls held on ${ship.name || ship.id}`, railsEligible: false };
    }
  }

  // Check if any ship is awake in the simulation (e.g. near surface, ocean, contact).
  // The most restrictive one decides; a ship resting on the ground sleeps on its next step.
  let numerical: WarpSafety | undefined;
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

  // Sanity check: flying ships on rails near surface or in fast orbital periods
  for (const ship of world.records()) {
    if (ship.state.status === 'flying' && world.hasBody(ship.bodyId)) {
      const body = world.body(ship.bodyId);
      const r = magnitude(ship.state.position);
      const alt = r - body.radius;

      // Close proximity to surface restricts warp
      if (alt <= Math.max(30, body.radius * 0.05)) {
        return {
          maxGranted: PHYSICAL_WARP_MAX,
          reason: `Low altitude (${Math.round(Math.max(0, alt))} m) above ${body.name}`,
          railsEligible: true,
        };
      }
      if (alt <= Math.max(100, body.radius * 0.2)) {
        return {
          maxGranted: 20,
          reason: `Low orbit above ${body.name} (altitude ${Math.round(alt)} m)`,
          railsEligible: true,
        };
      }

      // In a bound orbit, cap warp factor so 1 full orbit takes at least ~0.5s of real time
      const v = magnitude(ship.state.velocity);
      const eps = (v * v) / 2 - body.mu / r;
      if (eps < -1e-6) {
        const a = -body.mu / (2 * eps);
        if (a > 0) {
          const period = 2 * Math.PI * Math.sqrt((a * a * a) / body.mu);
          const orbitWarp = clampWarpFactor(Math.max(PHYSICAL_WARP_MAX, Math.floor(period * 2)));
          if (orbitWarp < MAX_WARP) {
            return {
              maxGranted: orbitWarp,
              reason: `Orbit period ${Math.round(period)}s around ${body.name} (capped to ${orbitWarp}×)`,
              railsEligible: true,
            };
          }
        }
      }
    }
  }

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
