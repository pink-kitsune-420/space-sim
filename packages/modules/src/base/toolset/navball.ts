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
  /** Inertial direction of the planned burn, shown as an amber diamond. */
  readonly maneuver?: number;
}

/** Below this speed (m/s) in the chosen frame there is no direction of motion to mark. */
export const NAVBALL_MIN_SPEED = .05;
/** Auto frame: surface below this fraction of the body radius, orbit again above the second. */
export const NAVBALL_SURFACE_ENTER = .12, NAVBALL_SURFACE_EXIT = .18;

/** Signed angle in [-π, π]. */
export const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export function bodySpinRate(body: { readonly rotation?: { readonly period?: number; readonly direction?: 'counter-clockwise' | 'clockwise' } }): number {
  if (!body.rotation?.period) return 0;
  return (2 * Math.PI / body.rotation.period) * (body.rotation.direction === 'clockwise' ? -1 : 1);
}

/** Navball quantities for any ship and reference body. */
export function shipNavballState(
  state: { readonly position: Vec; readonly velocity: Vec; readonly heading: number },
  body: { readonly radius: number; readonly spin?: number; readonly rotation?: { readonly period?: number; readonly direction?: 'counter-clockwise' | 'clockwise' } },
  frame: NavballFrame,
): NavballState | undefined {
  const { position: p, heading } = state;
  const r = Math.hypot(p.x, p.y);
  if (!(r > 0)) return undefined;
  const spin = body.spin ?? bodySpinRate(body);
  // ω × r is the ground's velocity at the ship; a resting ship already moves with it.
  const v = frame === 'surface' ? { x: state.velocity.x + spin * p.y, y: state.velocity.y - spin * p.x } : state.velocity;
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

/** Navball quantities for the controlled ship, or undefined without one (or at the body's centre).
 * `frame` picks the velocity: inertial relative to the body, or relative to its turning ground. */
export function navballState(view: PresentationSnapshot, frame: NavballFrame): NavballState | undefined {
  if (!view.ship) return undefined;
  const state = shipNavballState(view.ship.state, view.body, frame), plan = view.maneuver;
  if (!state || !plan?.valid || Math.hypot(plan.deltaVelocity.x, plan.deltaVelocity.y) === 0) return state;
  return { ...state, maneuver: Math.atan2(plan.deltaVelocity.y, plan.deltaVelocity.x) };
}

/** Determine auto frame from flight status and ground clearance. */
export function shipAutoFrame(status: string, clearance: number | null, bodyRadius: number, previous: NavballFrame = 'orbit'): NavballFrame {
  if (status !== 'flying') return 'surface';
  if (clearance === null) return 'orbit';
  const limit = (previous === 'surface' ? NAVBALL_SURFACE_EXIT : NAVBALL_SURFACE_ENTER) * bodyRadius;
  return clearance < limit ? 'surface' : 'orbit';
}

/** The frame auto mode shows: surface on the ground and near it, orbit higher up. `previous`
 * gives the band between the two thresholds hysteresis, so the dial does not flicker. */
export function autoFrame(view: PresentationSnapshot, previous: NavballFrame = 'orbit'): NavballFrame {
  if (!view.ship) return previous;
  return shipAutoFrame(view.ship.state.status, view.groundClearance, view.body.radius, previous);
}

/** CSS pixels: dial radius, marker track outside it, steering arc inside it, glyph radius. */
export const RADIUS = 52, TRACK = RADIUS + 13, INNER = RADIUS - 7, GLYPH = 5.5;
/** CSS pixels from the viewport's right edge (clear of the dock) and bottom edge (clear of the scale bar). */
export const RIGHT = 96, BOTTOM = 44;
/** At or below this width the dock and status stack along the top and touch controls fill the
 * bottom, so the dial sits at the right edge just beneath the top HUD. */
export const PHONE_WIDTH = 650, PHONE_RIGHT = 16, PHONE_TOP = 180;
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
export function drawNavball(
  state: NavballState,
  center: Vec,
  turn: number,
  orientation: NavballOrientation,
  accentColor?: string,
  playerLabel?: string,
  scale = 1,
  trajectoryText?: string,
  pinned = true,
  isDragging = false,
  editing = false,
): OverlayPrimitive[] {
  const r = RADIUS * scale;
  const track = TRACK * scale;
  const inner = INNER * scale;
  const glyph = GLYPH * scale;
  // Screen +Y points down, so a counter-clockwise screen angle α sits at (cos α, -sin α).
  const at = (angle: number, radius: number): Vec => ({ x: center.x + radius * Math.cos(angle + turn), y: center.y - radius * Math.sin(angle + turn) });
  const arc = (from: number, span: number, radius: number, steps: number): Vec[] =>
    Array.from({ length: steps + 1 }, (_, i) => at(from + span * i / steps, radius));
  const line = (points: Vec[], color: string, width = 1.5): OverlayPrimitive => ({ kind: 'line', space: 'screen', points, color, width });
  const out: OverlayPrimitive[] = [
    { kind: 'circle', space: 'screen', center, radius: track + glyph + 3 * scale, color: FACE, fill: true },
    ...(accentColor ? [{ kind: 'circle', space: 'screen', center, radius: track + glyph + 3 * scale, color: `${accentColor}88`, width: 2 }] as OverlayPrimitive[] : []),
    { kind: 'line', space: 'screen', points: arc(state.zenith - Math.PI / 2, Math.PI, r, 32), color: SKY, closed: true, fill: true },
    { kind: 'line', space: 'screen', points: arc(state.zenith + Math.PI / 2, Math.PI, r, 32), color: GROUND, closed: true, fill: true },
    line([at(state.zenith + Math.PI / 2, r), at(state.zenith - Math.PI / 2, r)], HORIZON),
    { kind: 'circle', space: 'screen', center, radius: r, color: accentColor ?? RIM, width: accentColor ? 2 : 1.5 },
    { kind: 'circle', space: 'screen', center, radius: track, color: `${accentColor ?? RIM}44`, width: 1 },
  ];

  // Drag indicator and handles when unpinned or dragging
  if (!pinned && !editing) {
    out.push({
      kind: 'circle',
      space: 'screen',
      center,
      radius: track + glyph + 6 * scale,
      color: isDragging ? (accentColor ?? '#38ef7d') : `${accentColor ?? '#ffb347'}99`,
      width: isDragging ? 2.5 : 1.5,
    });
    const dHandle = track + glyph + 6 * scale;
    for (const [hx, hy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      out.push({
        kind: 'circle',
        space: 'screen',
        center: { x: center.x + hx * dHandle, y: center.y + hy * dHandle },
        radius: 2.5 * scale,
        color: isDragging ? (accentColor ?? '#38ef7d') : '#ffb347',
        fill: true,
      });
    }
  }

  // Pin button: vector pushpin glyph at upper-right of dial
  const pinPos: Vec = { x: center.x + (track + 2 * scale) * 0.72, y: center.y - (track + 2 * scale) * 0.72 };
  if (editing) {
    for (const dx of [-2, 2]) for (const dy of [-4, 0, 4]) {
      out.push({ kind: 'circle', space: 'screen', center: { x: pinPos.x + dx * scale, y: pinPos.y + dy * scale },
        radius: scale, color: accentColor ?? RIM, fill: true });
    }
  } else out.push(
    { kind: 'circle', space: 'screen', center: pinPos, radius: 4 * scale, color: pinned ? (accentColor ?? RIM) : '#ffb347', fill: pinned, width: 1.5 },
    line([pinPos, { x: pinPos.x - 4 * scale, y: pinPos.y + 4 * scale }], pinned ? (accentColor ?? RIM) : '#ffb347', 1.5),
    { kind: 'text', space: 'screen', at: { x: pinPos.x + 6 * scale, y: pinPos.y + 3 * scale }, color: pinned ? `${accentColor ?? LABEL}99` : '#ffb347', align: 'left', text: pinned ? 'PIN' : 'UNPIN' },
  );

  // Status banner when unpinned or dragging
  if (isDragging && !editing) {
    out.push({ kind: 'text', space: 'screen', at: { x: center.x, y: center.y - track - glyph - 15 * scale }, color: accentColor ?? '#38ef7d', align: 'center', text: '✥ DRAGGING NAVBALL' });
  } else if (!pinned && !editing) {
    out.push({ kind: 'text', space: 'screen', at: { x: center.x, y: center.y - track - glyph - 15 * scale }, color: '#ffb347', align: 'center', text: '🔓 DRAG TO MOVE' });
  }

  // Player label badge above dial if specified
  if (playerLabel) {
    out.push({ kind: 'text', space: 'screen', at: { x: center.x, y: center.y - track - glyph - 4 * scale }, color: accentColor ?? LABEL, align: 'center', text: playerLabel });
  }

  // Pitch ladder: ticks inside the rim, every 15° from both horizons toward zenith and nadir.
  for (const level of [state.zenith - Math.PI / 2, state.zenith + Math.PI / 2]) {
    for (const deg of PITCH_TICKS) for (const side of [1, -1]) {
      const angle = level + side * deg * Math.PI / 180, long = (deg % 45 === 0 ? 9 : 5) * scale;
      out.push(line([at(angle, r), at(angle, r - long)], TICK, 1));
    }
  }

  // Shortest turn from the nose to prograde, along the inner ring.
  if (state.steering !== undefined && Math.abs(state.steering) > STEER_MIN) {
    out.push(line(arc(state.nose, state.steering, inner, Math.max(4, Math.ceil(Math.abs(state.steering) * 16))), STEER, 2));
  }
  // Ship reticle: a chevron at the centre and a pointer from it to the inner ring.
  const nose = state.nose, chevron = (angle: number, radius: number): Vec => at(nose + angle, radius);
  out.push({ kind: 'line', space: 'screen', points: [chevron(2.45, 10 * scale), chevron(0, 12 * scale), chevron(-2.45, 10 * scale), chevron(Math.PI, 4 * scale)],
    color: accentColor ?? NOSE, width: 2, closed: true });
  out.push(line([chevron(0, 15 * scale), chevron(0, inner - 2 * scale)], `${accentColor ?? NOSE}aa`, 1));
  out.push({ kind: 'line', space: 'screen', points: [chevron(0, inner + 4 * scale), chevron(.07, inner - 4 * scale), chevron(-.07, inner - 4 * scale)], color: accentColor ?? NOSE, closed: true, fill: true });

  // Markers on the outer track; glyph ticks stay screen-upright.
  const glyphMarker = (angle: number, color: string, marks: 'prograde' | 'retrograde' | 'out' | 'in'): void => {
    const c = at(angle, track), g = glyph;
    out.push({ kind: 'circle', space: 'screen', center: c, radius: g, color, width: 1.5 });
    const seg = (ax: number, ay: number, bx: number, by: number): void => {
      out.push(line([{ x: c.x + ax, y: c.y + ay }, { x: c.x + bx, y: c.y + by }], color));
    };
    if (marks === 'prograde' || marks === 'retrograde') {
      const stem = 4 * scale;
      seg(0, -g, 0, -g - stem); seg(-g, 0, -g - stem, 0); seg(g, 0, g + stem, 0);
      if (marks === 'retrograde') { const d = g * .6; seg(-d, -d, d, d); seg(-d, d, d, -d); }
      else out.push({ kind: 'circle', space: 'screen', center: c, radius: Math.max(1, 1 * scale), color, fill: true });
    } else {
      const d = Math.SQRT1_2;
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        if (marks === 'out') seg(sx * d * g, sy * d * g, sx * d * (g + 3.5 * scale), sy * d * (g + 3.5 * scale));
        else seg(sx * d * g, sy * d * g, sx * d * (g - 3 * scale), sy * d * (g - 3 * scale));
      }
    }
  };
  glyphMarker(state.zenith, RADIAL, 'out');
  glyphMarker(state.nadir, RADIAL, 'in');
  if (state.prograde !== undefined && state.retrograde !== undefined) {
    const color = state.speed < 1 ? `${PROGRADE}${DIM}` : PROGRADE;
    glyphMarker(state.retrograde, color, 'retrograde');
    glyphMarker(state.prograde, color, 'prograde');
  }

  // Readout beneath the dial.
  // Overlay fonts remain 11 CSS pixels when the dial shrinks: keep baseline spacing readable.
  const y = center.y + track + glyph + 18;
  if (state.maneuver !== undefined) {
    const p = at(state.maneuver, track + 4 * scale), size = 4 * scale;
    out.push({ kind: 'line', space: 'screen', color: '#f7c775', width: 2, closed: true,
      points: [{ x: p.x, y: p.y-size }, { x: p.x+size, y: p.y }, { x: p.x, y: p.y+size }, { x: p.x-size, y: p.y }] });
  }
  const pitch = Math.round(state.pitch);
  const steer = state.steering === undefined ? '' : `  Δ ${state.steering >= 0 ? '+' : ''}${Math.round(state.steering * 180 / Math.PI)}°`;
  out.push({ kind: 'text', space: 'screen', at: { x: center.x, y }, color: LABEL, align: 'center',
    text: `${playerLabel ? playerLabel + ' · ' : ''}${state.frame === 'orbit' ? 'ORB' : 'SRF'} · ${orientation === 'horizon' ? 'HRZ' : 'CAM'}` });
  out.push({ kind: 'text', space: 'screen', at: { x: center.x, y: y + 14 }, color: LABEL, align: 'center',
    text: `PITCH ${pitch > 0 ? '+' : ''}${pitch}°${steer}` });
  out.push({ kind: 'text', space: 'screen', at: { x: center.x, y: y + 28 }, color: LABEL, align: 'center',
    text: `${state.speed < 100 ? state.speed.toFixed(1) : Math.round(state.speed).toLocaleString('en-US')} m/s` });
  if (trajectoryText) {
    out.push({ kind: 'text', space: 'screen', at: { x: center.x, y: y + 42 }, color: accentColor ?? LABEL, align: 'center',
      text: trajectoryText });
  }
  return out;
}

/** Room the dial and its readout take beside and below the centre. */
export const SIDE = TRACK + GLYPH + 3, BELOW = TRACK + GLYPH + 18 + 28 + 6;

/** Conservative CSS-pixel footprint, including handles/banner and unscaled readout text.
 * Trajectory summaries need extra width and a fourth line. Does not change saved placement. */
export function navballFootprint(scale = 1, trajectory = false): { side: number; above: number; below: number } {
  return { side: Math.max(79 * scale, trajectory ? 130 : 100), above: 86 * scale + 14,
    below: (TRACK + GLYPH) * scale + (trajectory ? 66 : 52) };
}

export interface NavballPlacementDetail {
  readonly x: number;
  readonly y: number;
  readonly scale?: number;
  readonly accentColor?: string;
  readonly playerLabel?: string;
  readonly pinned?: boolean;
  readonly isDragging?: boolean;
  /** Layout editor allows movement while retaining the saved pin preference. */
  readonly editing?: boolean;
}

let customNavballPlacementProvider: ((view: PresentationView) => NavballPlacementDetail | undefined) | undefined;

export function setNavballPlacementProvider(provider: typeof customNavballPlacementProvider): void {
  customNavballPlacementProvider = provider;
}

export const navball: RegisteredModule = {
  manifest,
  initialize(context) {
    const frameSetting = context.settings.frame ?? 0, orientation: NavballOrientation = (context.settings.orientation ?? 0) >= 1 ? 'camera' : 'horizon';
    // Per ship, so split-screen panes keep their own surface/orbit hysteresis.
    const frames = new Map<string, NavballFrame>();
    context.contributeLayer({
      name: 'navball',
      label: 'Navball',
      draw(view: PresentationView) {
        const ship = view.ship;
        if (!ship || ship.state.status === 'crashed') return [];
        const frame = frameSetting >= 2 ? 'surface' : frameSetting >= 1 ? 'orbit' : autoFrame(view, frames.get(ship.id));
        if (frames.size > 16) frames.clear();
        frames.set(ship.id, frame);
        const state = navballState(view, frame);
        if (!state) return [];
        const turn = orientation === 'horizon' ? Math.PI / 2 - state.zenith : view.camera.rotation;
        const { width, height } = view.viewport;

        const custom = customNavballPlacementProvider?.(view);
        if (custom) {
          return drawNavball(
            state,
            { x: custom.x, y: custom.y },
            turn,
            orientation,
            custom.accentColor,
            custom.playerLabel,
            custom.scale ?? 1,
            undefined,
            custom.pinned ?? true,
            custom.isDragging ?? false,
            custom.editing ?? false,
          );
        }

        // Bottom right, as the HTML telemetry strip holds the bottom centre; upper right on phones.
        const phone = width <= PHONE_WIDTH;
        const center = phone ? { x: width - PHONE_RIGHT - SIDE, y: PHONE_TOP + SIDE } : { x: width - RIGHT - SIDE, y: height - BOTTOM - BELOW };
        return drawNavball(state, center, turn, orientation);
      },
    });
  },
};
