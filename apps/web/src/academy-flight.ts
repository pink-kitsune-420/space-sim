// Copyright (c) 2026 pink-kitsune-420. All Rights Reserved.
// SPDX-License-Identifier: LicenseRef-Project

import type { AcademyFlight, AcademyPractice, Elements, SessionRead, State, Vec, WorldRead } from '../../../packages/game-api/src/index';

/** Pure practice placement over the selected public body/ephemeris contracts. */
export function academyPracticeState(world: WorldRead, setup: AcademyPractice): { bodyId: string; position: Vec; velocity: Vec; heading: number } {
  if (!['circle', 'ellipse', 'approach', 'encounter'].includes(setup.kind) || !Number.isFinite(setup.low) || !Number.isFinite(setup.high)
    || setup.low < 1.05 || setup.high < setup.low || setup.high > 1000 || !world.hasBody(setup.bodyId)) throw Error('This practice setup is not supported by the current world.');
  const body = world.body(setup.bodyId), surface = world.surface(body.id), top = Math.max(body.radius, surface?.bounds.maxRadius ?? 0, surface?.seaRadiusMetres ?? 0);
  let low = setup.low * body.radius, high = setup.high * body.radius;
  let angle = Math.PI / 2, at = setup.at ?? 'periapsis';
  if (low <= top + 1) throw Error('Practice orbit would touch this body’s terrain or sea.');
  if (setup.kind === 'encounter') {
    const moon = world.system.getAllBodies().find(candidate => candidate.id === 'moon' && candidate.parentId === body.id);
    if (!moon || moon.ephemeris.kind !== 'circular-kepler') throw Error('This encounter practice requires Primus and its moving moon Parvus.');
    const distance = moon.ephemeris.radiusMetres ?? moon.ephemeris.radius;
    if (!distance) throw Error('The moon has no compatible orbital radius.');
    // Aim just outside the moon's centre; actual moving-SOI propagation verifies the exercise.
    high = distance + 3 * moon.radius;
    const seconds = Math.PI * Math.sqrt(((low + high) / 2) ** 3 / body.mu), time = world.time + seconds;
    const target = world.system.getBodyPosition(moon.id, time), parent = world.system.getBodyPosition(body.id, time);
    angle = Math.atan2(target.y - parent.y, target.x - parent.x) + Math.PI;
    at = 'periapsis';
  }
  const radius = at === 'apoapsis' ? high : low;
  if (high >= body.soi.radius * .95) throw Error('Practice orbit is outside this body’s sphere of influence.');
  let radial = 0, tangential = -Math.sqrt(body.mu * (2 / radius - 2 / (low + high)));
  if (setup.kind === 'approach') {
    const periSpeed = 1.5 * Math.sqrt(body.mu / low), energy = periSpeed * periSpeed / 2 - body.mu / low;
    const h = low * periSpeed;
    tangential = -h / high;
    radial = -Math.sqrt(2 * (energy + body.mu / high) - tangential * tangential);
    const position = { x: 0, y: high }, velocity = { x: -tangential, y: radial };
    return { bodyId: body.id, position, velocity, heading: Math.atan2(-velocity.y, -velocity.x) };
  }
  if (at === 'apoapsis') angle += Math.PI;
  const c = Math.cos(angle), s = Math.sin(angle), velocity = { x: radial * c - tangential * s, y: radial * s + tangential * c };
  return { bodyId: body.id, position: { x: radius * c, y: radius * s }, velocity, heading: Math.atan2(velocity.y, velocity.x) };
}

/** Holds only an opaque continuity identity, never another simulation. */
export function academyFlightReader(options: {
  session(): SessionRead; selected(): string | undefined; epoch(): number;
  plan(): { readonly valid: boolean; readonly nodes?: readonly { readonly valid: boolean }[]; readonly deltaVelocity: Vec } | undefined;
  alarms(): number; prediction(): string;
}): () => AcademyFlight | undefined {
  let world: object | undefined, shipId: string | undefined, epoch: number | undefined, identity = {};
  return () => {
    const session = options.session(), id = options.selected(), ship = id ? session.world.ship(id) : undefined;
    if (!ship || ship.ownerId !== session.playerId) return undefined;
    const nextEpoch = options.epoch();
    if (world !== session.world || shipId !== id || epoch !== nextEpoch) { world = session.world; shipId = id; epoch = nextEpoch; identity = {}; }
    const body = session.world.body(ship.bodyId), surface = session.world.surface(body.id), context = session.world.contextFor(ship);
    const analytic = context.capabilities.orbitalDiagnostics, state = ship.state;
    const orbit: Elements | null = analytic && state.status === 'flying' ? context.services.orbits.elements(state, body.mu) : null;
    const radius = Math.hypot(state.position.x, state.position.y);
    const rotation = state.status === 'flying' && body.rotation ? body.rotation.phase + body.rotation.direction * 2 * Math.PI * state.time / body.rotation.period : 0;
    const ground = surface ? context.services.surfaces.query(surface, Math.atan2(state.position.y, state.position.x) - rotation).firstContactRadius : body.radius;
    const plan = options.plan();
    // Detach vectors and analytic elements; no mutable world objects leave the host.
    const detached: State = { time: state.time, position: { ...state.position }, velocity: { ...state.velocity }, heading: state.heading,
      throttle: state.throttle, status: state.status, revision: state.revision };
    return { identity, time: session.world.time, paused: session.paused, state: detached, engine: !!ship.controls.engine,
      body: { id: body.id, name: body.name, radius: body.radius, mu: body.mu,
        surfaceTop: Math.max(body.radius, surface?.bounds.maxRadius ?? 0, surface?.seaRadiusMetres ?? 0), soi: body.soi.radius },
      orbit: orbit ? { ...orbit, eccentricityVector: { ...orbit.eccentricityVector } } : null,
      clearance: radius - ground, analytic, prediction: options.prediction(), plannedNodes: plan?.nodes?.filter(node => node.valid).length ?? (plan?.valid ? 1 : 0),
      plannedDeltaV: plan?.valid ? Math.hypot(plan.deltaVelocity.x, plan.deltaVelocity.y) : 0, alarms: options.alarms() };
  };
}
