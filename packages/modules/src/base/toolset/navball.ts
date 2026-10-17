/** Toolset instrument: a 2D navball. A split-horizon dial (sky toward the zenith, ground toward
 * the nadir) with the ship's nose, prograde/retrograde and radial markers on its rim, the
 * shortest turn from nose to prograde, and pitch and speed in the orbital or surface frame. */
import type { ModuleManifest, OverlayPrimitive, PresentationSnapshot, PresentationView, RegisteredModule, Vec } from '../../../../game-api/src/index';

export type NavballFrame = 'orbit' | 'surface';
export type NavballOrientation = 'horizon' | 'camera';
/** Directions are system angles in radians, counter-clockwise from +X (the frame of `State.heading`). */
export interface NavballState {
  readonly frame: NavballFrame;
  /** Radial out (zenith) and radial in (nadir). */
  readonly zenith: number;
  readonly nadir: number;
  /** The ship's nose. */
  readonly nose: number;
  /** Absent when the ship is (nearly) at rest in this frame. */
  readonly prograde?: number;
  readonly retrograde?: number;
  /** m/s in this frame. */
  readonly speed: number;
  /** Sense of the forward horizon: 1 counter-clockwise, -1 clockwise. */
  readonly forward: 1 | -1;
  /** Degrees above the forward horizon in [-180, 180]: 90 at the zenith, 0 level ahead, ±180 level behind. */
  readonly pitch: number;
  /** Shortest signed turn in [-π, π] from the nose to prograde (positive counter-clockwise). */
  readonly steering?: number;
}

/** Below this speed (m/s) in the chosen frame there is no direction of motion to mark. */
export const NAVBALL_MIN_SPEED = .05;
/** Auto frame: surface below this fraction of the body radius, orbit again above the second. */
export const NAVBALL_SURFACE_ENTER = .12, NAVBALL_SURFACE_EXIT = .18;

/** Signed angle in [-π, π]. */
export const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Navball quantities for the controlled ship, or undefined without one (or at the body's centre).
 * `frame` picks the velocity: inertial relative to the body, or relative to its turning ground. */
export function navballState(view: PresentationSnapshot, frame: NavballFrame): NavballState | undefined {
  const ship = view.ship;
  if (!ship) return undefined;
  const { position: p, heading } = ship.state;
  const r = Math.hypot(p.x, p.y);
  if (!(r > 0)) return undefined;
  const spin = view.body.spin ?? 0;
  // ω × r is the ground's velocity at the ship; a resting ship already moves with it.
  const v = frame === 'surface' ? { x: ship.state.velocity.x + spin * p.y, y: ship.state.velocity.y - spin * p.x } : ship.state.velocity;
  const up: Vec = { x: p.x / r, y: p.y / r };
  const speed = Math.hypot(v.x, v.y), tangential = up.x * v.y - up.y * v.x;
  // Ahead is the way the ship moves round the body; at rest, the way the ground turns
  // (east), else clockwise like default orbits.
  const forward: 1 | -1 = Math.abs(tangential) > NAVBALL_MIN_SPEED ? (tangential > 0 ? 1 : -1) : spin > 0 ? 1 : -1;
  const nx = Math.cos(heading), ny = Math.sin(heading);
  const level = forward * (up.x * ny - up.y * nx), climb = up.x * nx + up.y * ny;
  const zenith = Math.atan2(up.y, up.x), nose = wrapAngle(heading);
  const prograde = speed > NAVBALL_MIN_SPEED ? Math.atan2(v.y, v.x) : undefined;
  return { frame, zenith, nadir: wrapAngle(zenith + Math.PI), nose, speed, forward,
    pitch: Math.atan2(climb, level) * 180 / Math.PI,
    ...(prograde !== undefined ? { prograde, retrograde: wrapAngle(prograde + Math.PI), steering: wrapAngle(prograde - nose) } : {}) };
}

/** The frame auto mode shows: surface on the ground and near it, orbit higher up. `previous`
 * gives the band between the two thresholds hysteresis, so the dial does not flicker. */
export function autoFrame(view: PresentationSnapshot, previous: NavballFrame = 'orbit'): NavballFrame {
  const ship = view.ship;
  if (!ship) return previous;
  if (ship.state.status !== 'flying') return 'surface';
  const clearance = view.groundClearance;
  if (clearance === null) return 'orbit';
  const limit = (previous === 'surface' ? NAVBALL_SURFACE_EXIT : NAVBALL_SURFACE_ENTER) * view.body.radius;
  return clearance < limit ? 'surface' : 'orbit';
}

/** CSS pixels: dial radius, marker track outside it, steering arc inside it, glyph radius. */
const RADIUS = 52, TRACK = RADIUS + 13, INNER = RADIUS - 7, GLYPH = 5.5;
/** CSS pixels from the viewport's right edge (clear of the dock) and bottom edge (clear of the scale bar). */
const RIGHT = 96, BOTTOM = 44;
/** At or below this width the dock and status stack along the top and touch controls fill the
 * bottom, so the dial sits at the right edge just beneath the top HUD. */
const PHONE_WIDTH = 650, PHONE_RIGHT = 16, PHONE_TOP = 180;
const SKY = '#1f5f7acc', GROUND = '#6a4a2ecc', FACE = '#071015d9', RIM = '#9fb8bf', HORIZON = '#e8f8ef', TICK = '#c3d3d6aa';
const PROGRADE = '#cde86a', RADIAL = '#5fd3ee', NOSE = '#f2f6f4', STEER = '#f7c775', LABEL = '#c3d3d6', DIM = '66';
/** Below this |steering| the arc is noise. */
const STEER_MIN = 2 * Math.PI / 180;
const PITCH_TICKS = [15, 30, 45, 60, 75];

const manifest: ModuleManifest = {
  format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'builtin.navball', name: 'Navball',
  version: '0.1.0', kind: 'provider', authority: 'presentation', environments: ['browser', 'offline'],
  dependencies: [], provides: [], requires: [], slots: [], before: [], after: [],
  settings: {
    /** 0 auto, 1 orbit, 2 surface. */
    frame: { type: 'number', default: 0, minimum: 0, maximum: 2 },
    /** 0 zenith up (horizon), 1 turned with the camera. */
    orientation: { type: 'number', default: 0, minimum: 0, maximum: 1 },
  },
  license: 'LicenseRef-Project',
};

/** The dial's draw list, centred at `center` (CSS pixels); `turn` maps a system angle to a screen angle. */
export function drawNavball(state: NavballState, center: Vec, turn: number, orientation: NavballOrientation): OverlayPrimitive[] {
  // Screen +Y points down, so a counter-clockwise screen angle α sits at (cos α, -sin α).
  const at = (angle: number, radius: number): Vec => ({ x: center.x + radius * Math.cos(angle + turn), y: center.y - radius * Math.sin(angle + turn) });
  const arc = (from: number, span: number, radius: number, steps: number): Vec[] =>
    Array.from({ length: steps + 1 }, (_, i) => at(from + span * i / steps, radius));
  const line = (points: Vec[], color: string, width = 1.5): OverlayPrimitive => ({ kind: 'line', space: 'screen', points, color, width });
  const out: OverlayPrimitive[] = [
    { kind: 'circle', space: 'screen', center, radius: TRACK + GLYPH + 3, color: FACE, fill: true },
    { kind: 'line', space: 'screen', points: arc(state.zenith - Math.PI / 2, Math.PI, RADIUS, 32), color: SKY, closed: true, fill: true },
    { kind: 'line', space: 'screen', points: arc(state.zenith + Math.PI / 2, Math.PI, RADIUS, 32), color: GROUND, closed: true, fill: true },
    line([at(state.zenith + Math.PI / 2, RADIUS), at(state.zenith - Math.PI / 2, RADIUS)], HORIZON),
    { kind: 'circle', space: 'screen', center, radius: RADIUS, color: RIM, width: 1.5 },
    { kind: 'circle', space: 'screen', center, radius: TRACK, color: `${RIM}44`, width: 1 },
  ];
  // Pitch ladder: ticks inside the rim, every 15° from both horizons toward zenith and nadir.
  for (const level of [state.zenith - Math.PI / 2, state.zenith + Math.PI / 2]) {
    for (const deg of PITCH_TICKS) for (const side of [1, -1]) {
      const angle = level + side * deg * Math.PI / 180, long = deg % 45 === 0 ? 9 : 5;
      out.push(line([at(angle, RADIUS), at(angle, RADIUS - long)], TICK, 1));
    }
  }

  // Shortest turn from the nose to prograde, along the inner ring.
  if (state.steering !== undefined && Math.abs(state.steering) > STEER_MIN) {
    out.push(line(arc(state.nose, state.steering, INNER, Math.max(4, Math.ceil(Math.abs(state.steering) * 16))), STEER, 2));
  }
  // Ship reticle: a chevron at the centre and a pointer from it to the inner ring.
  const nose = state.nose, chevron = (angle: number, radius: number): Vec => at(nose + angle, radius);
  out.push({ kind: 'line', space: 'screen', points: [chevron(2.45, 10), chevron(0, 12), chevron(-2.45, 10), chevron(Math.PI, 4)],
    color: NOSE, width: 2, closed: true });
  out.push(line([chevron(0, 15), chevron(0, INNER - 2)], `${NOSE}aa`, 1));
  out.push({ kind: 'line', space: 'screen', points: [chevron(0, INNER + 4), chevron(.07, INNER - 4), chevron(-.07, INNER - 4)], color: NOSE, closed: true, fill: true });

  // Markers on the outer track; glyph ticks stay screen-upright.
  const glyph = (angle: number, color: string, marks: 'prograde' | 'retrograde' | 'out' | 'in'): void => {
    const c = at(angle, TRACK), g = GLYPH;
    out.push({ kind: 'circle', space: 'screen', center: c, radius: g, color, width: 1.5 });
    const seg = (ax: number, ay: number, bx: number, by: number): void => {
      out.push(line([{ x: c.x + ax, y: c.y + ay }, { x: c.x + bx, y: c.y + by }], color));
    };
    if (marks === 'prograde' || marks === 'retrograde') {
      seg(0, -g, 0, -g - 4); seg(-g, 0, -g - 4, 0); seg(g, 0, g + 4, 0);
      if (marks === 'retrograde') { const d = g * .6; seg(-d, -d, d, d); seg(-d, d, d, -d); }
      else out.push({ kind: 'circle', space: 'screen', center: c, radius: 1, color, fill: true });
    } else {
      const d = Math.SQRT1_2;
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        if (marks === 'out') seg(sx * d * g, sy * d * g, sx * d * (g + 3.5), sy * d * (g + 3.5));
        else seg(sx * d * g, sy * d * g, sx * d * (g - 3), sy * d * (g - 3));
      }
    }
  };
  glyph(state.zenith, RADIAL, 'out');
  glyph(state.nadir, RADIAL, 'in');
  if (state.prograde !== undefined && state.retrograde !== undefined) {
    const color = state.speed < 1 ? `${PROGRADE}${DIM}` : PROGRADE;
    glyph(state.retrograde, color, 'retrograde');
    glyph(state.prograde, color, 'prograde');
  }

  // Readout beneath the dial.
  const y = center.y + TRACK + GLYPH + 18;
  const pitch = Math.round(state.pitch);
  const steer = state.steering === undefined ? '' : `  Δ ${state.steering >= 0 ? '+' : ''}${Math.round(state.steering * 180 / Math.PI)}°`;
  out.push({ kind: 'text', space: 'screen', at: { x: center.x, y }, color: LABEL, align: 'center',
    text: `${state.frame === 'orbit' ? 'ORB' : 'SRF'} · ${orientation === 'horizon' ? 'HRZ' : 'CAM'}` });
  out.push({ kind: 'text', space: 'screen', at: { x: center.x, y: y + 14 }, color: LABEL, align: 'center',
    text: `PITCH ${pitch > 0 ? '+' : ''}${pitch}°${steer}` });
  out.push({ kind: 'text', space: 'screen', at: { x: center.x, y: y + 28 }, color: LABEL, align: 'center',
    text: `${state.speed < 100 ? state.speed.toFixed(1) : Math.round(state.speed).toLocaleString('en-US')} m/s` });
  return out;
}

/** Room the dial and its readout take beside and below the centre. */
const SIDE = TRACK + GLYPH + 3, BELOW = TRACK + GLYPH + 18 + 28 + 6;

export const navball: RegisteredModule = {
  manifest,
  initialize(context) {
    const frameSetting = context.settings.frame ?? 0, orientation: NavballOrientation = (context.settings.orientation ?? 0) >= 1 ? 'camera' : 'horizon';
    let frame: NavballFrame = 'orbit';
    context.contributeLayer({
      name: 'navball',
      label: 'Navball',
      draw(view: PresentationView) {
        const ship = view.ship;
        if (!ship || ship.state.status === 'crashed') return [];
        frame = frameSetting >= 2 ? 'surface' : frameSetting >= 1 ? 'orbit' : autoFrame(view, frame);
        const state = navballState(view, frame);
        if (!state) return [];
        const turn = orientation === 'horizon' ? Math.PI / 2 - state.zenith : view.camera.rotation;
        const { width, height } = view.viewport;
        // Bottom right, as the HTML telemetry strip holds the bottom centre; upper right on phones.
        const phone = width <= PHONE_WIDTH;
        const center = phone ? { x: width - PHONE_RIGHT - SIDE, y: PHONE_TOP + SIDE } : { x: width - RIGHT - SIDE, y: height - BOTTOM - BELOW };
        return drawNavball(state, center, turn, orientation);
      },
    });
  },
};
