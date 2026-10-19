import type { AcademyFlight, AcademyTarget, AcademyOrbitPreview, TutorialObservation, Vec } from '@space-sim/game-api';

export function observeFlight(flight: AcademyFlight): TutorialObservation {
  const { state, body, orbit } = flight, radius = Math.hypot(state.position.x, state.position.y);
  const speed = Math.hypot(state.velocity.x, state.velocity.y);
  const safe = flight.analytic && state.status === 'flying' && orbit?.kind === 'elliptic' && !orbit.radial
    && orbit.periapsis > body.surfaceTop + Math.max(.5, body.radius * .01)
    && orbit.apoapsis !== null && orbit.apoapsis < body.soi * .95;
  return { identity: flight.identity, time: flight.time, paused: flight.paused, values: {
    flying: state.status === 'flying', landed: state.status === 'landed', coasting: !flight.engine,
    safe: !!safe, bound: orbit?.kind === 'elliptic', bodyId: body.id,
    clearance: flight.clearance ?? Number.NaN, radius, radiusRatio: radius / body.radius, speed,
    periapsis: orbit?.periapsis ?? Number.NaN, apoapsis: orbit?.apoapsis ?? Number.NaN,
    periapsisRatio: orbit ? orbit.periapsis / body.radius : Number.NaN,
    apoapsisRatio: orbit?.apoapsis ? orbit.apoapsis / body.radius : Number.NaN,
    eccentricity: orbit?.eccentricity ?? Number.NaN, energy: orbit?.energy ?? Number.NaN,
    angularMomentum: orbit?.angularMomentum ?? Number.NaN, period: orbit?.period ?? Number.NaN,
    nodeCount: flight.plannedNodes, nodeDv: flight.plannedDeltaV, alarmCount: flight.alarms,
  } };
}

/** A bounded geometric teaching guide, not a flight prediction or executable plan. */
export function previewOrbit(flight: AcademyFlight, target: AcademyTarget): AcademyOrbitPreview {
  const low = target.low * flight.body.radius, high = target.high * flight.body.radius;
  if (!(low > flight.body.surfaceTop && high >= low && high < flight.body.soi)) throw Error('Target orbit is outside this body’s safe preview range.');
  const angle = flight.orbit?.periapsisAngle ?? Math.atan2(flight.state.position.y, flight.state.position.x);
  return { bodyId: flight.body.id, points: conicPoints(low, high, angle) };
}
/** Bounded geometric ellipse for the diagram, including impact trajectories. */
export function conicPoints(low: number, high: number, angle: number): readonly Vec[] {
  if (![low, high, angle].every(Number.isFinite) || low <= 0 || high < low) return [];
  const a = (low + high) / 2, e = (high - low) / (high + low), p = a * (1 - e * e);
  const ca = Math.cos(angle), sa = Math.sin(angle), points: Vec[] = [];
  for (let i = 0; i <= 96; i++) {
    const t = i * Math.PI * 2 / 96, r = p / (1 + e * Math.cos(t)), x = r * Math.cos(t), y = r * Math.sin(t);
    points.push({ x: ca * x - sa * y, y: sa * x + ca * y });
  }
  return points;
}
