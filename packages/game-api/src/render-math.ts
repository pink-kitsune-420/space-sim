import type { Camera, OverlayPrimitive, RenderFrame } from './presentation';
import type { GhostSample, State, Vec } from './state';
import { normalizeAngle } from './math';

/** Public presentation contracts; renderer implementations re-export them for existing callers. */
export type { Camera, OverlayPrimitive, OverlaySpace, RenderBody, RenderFrame, RenderSection, RenderShip, RenderTimer,
  Renderer, RendererFeatures } from './presentation';

export function project(p: Vec, camera: Camera, width: number, height: number): Vec {
  return createProjector(camera, width, height)(p);
}

/** Cache camera constants once per frame, shared by every body/path/ship vertex. */
export function createProjector(camera: Camera, width: number, height: number): (p: Vec) => Vec {
  const c = Math.cos(camera.rotation), s = Math.sin(camera.rotation);
  return p => {
    const x = p.x - camera.center.x, y = p.y - camera.center.y;
    return { x: width / 2 + (x * c - y * s) * camera.scale,
      y: height / 2 - (x * s + y * c) * camera.scale };
  };
}

/** Project a screen-space coordinate (CSS pixels) to world coordinates. */
export function screenToWorld(screenPos: Vec, camera: Camera, width: number, height: number): Vec {
  const c = Math.cos(camera.rotation);
  const s = Math.sin(camera.rotation);
  const sx = (screenPos.x - width / 2) / camera.scale;
  const sy = -(screenPos.y - height / 2) / camera.scale;
  return {
    x: camera.center.x + (sx * c + sy * s),
    y: camera.center.y + (-sx * s + sy * c),
  };
}

/** Move the scene by a screen-space pointer displacement (CSS pixels). */
export function dragCamera(camera: Camera, delta: Vec): Camera {
  const c = Math.cos(camera.rotation), s = Math.sin(camera.rotation);
  return { ...camera, center: {
    x: camera.center.x + (-c * delta.x + s * delta.y) / camera.scale,
    y: camera.center.y + (s * delta.x + c * delta.y) / camera.scale,
  } };
}

export function blendAngle(current: number, target: number, fraction: number): number {
  return normalizeAngle(current + normalizeAngle(target - current) * Math.max(0, Math.min(1, fraction)));
}

/** Presentation snapshot `alpha` of the way from one fixed physics step to the next, so
 * motion stays smooth when 10-ms steps do not divide the display's frame interval.
 * Visual only: physics must never read the result. */
export function interpolateState(from: State, to: State, alpha: number): State {
  if (from === to || alpha >= 1) return to;
  const t = Math.max(0, alpha), mix = (a: number, b: number): number => a + (b - a) * t;
  return { ...to, time: mix(from.time, to.time),
    position: { x: mix(from.position.x, to.position.x), y: mix(from.position.y, to.position.y) },
    velocity: { x: mix(from.velocity.x, to.velocity.x), y: mix(from.velocity.y, to.velocity.y) },
    heading: blendAngle(from.heading, to.heading, t) };
}

/** Bézier control points of the cubic Hermite curve between two timed states. Exact end
 * positions and velocities keep sparse quantized samples smooth at any zoom; the
 * projection is affine, so world-space control points project directly. */
export function hermiteControls(a: GhostSample, b: GhostSample): readonly [Vec, Vec] {
  if (b.linear) return [
    { x: a.position.x + (b.position.x - a.position.x) / 3, y: a.position.y + (b.position.y - a.position.y) / 3 },
    { x: b.position.x - (b.position.x - a.position.x) / 3, y: b.position.y - (b.position.y - a.position.y) / 3 },
  ];
  const third = (b.time - a.time) / 3;
  return [{ x: a.position.x + a.velocity.x * third, y: a.position.y + a.velocity.y * third },
    { x: b.position.x - b.velocity.x * third, y: b.position.y - b.velocity.y * third }];
}

interface PathGeometry {
  first?: GhostSample;
  readonly cumulativeChords: number[];
  readonly controls: Array<readonly [Vec, Vec]>;
}
const PATH_GEOMETRY = new WeakMap<readonly GhostSample[], PathGeometry>();
export function getPathGeometry(path: readonly GhostSample[]): PathGeometry {
  let geom = PATH_GEOMETRY.get(path);
  if (!geom) {
    geom = { first: path[0], cumulativeChords: [0], controls: [] };
    PATH_GEOMETRY.set(path, geom);
  } else if (geom.first !== path[0] || geom.cumulativeChords.length > path.length) {
    geom.first = path[0];
    geom.cumulativeChords.length = 1;
    geom.controls.length = 0;
  }
  for (let i = geom.cumulativeChords.length; i < path.length; i++) {
    const prev = path[i - 1]!, curr = path[i]!;
    geom.cumulativeChords.push(geom.cumulativeChords[i - 1]! + distance(prev.position, curr.position));
    geom.controls.push(hermiteControls(prev, curr));
  }
  return geom;
}

/** The drawn part of a path. Open paths drop samples the ship has passed and begin at the
 * ship; `flown` is the chord length already behind it, which keeps the dashes world-fixed. */
export function pathFromShip(path: readonly GhostSample[], closed: boolean,
  ship: GhostSample): { readonly points: readonly GhostSample[]; readonly flown: number } {
  if (closed || path.length === 0) return { points: path, flown: 0 };
  let lo = 0, hi = path.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (path[mid]!.time <= ship.time) lo = mid + 1; else hi = mid; }
  if (lo === path.length) return { points: [], flown: 0 };
  const geom = getPathGeometry(path);
  const flown = lo > 0 ? geom.cumulativeChords[lo - 1]! + distance(path[lo - 1]!.position, ship.position) : 0;
  return { points: [ship, ...path.slice(lo)], flown };
}

const distance = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y);


/** Restrained timed SOI markers, shared by compatible vector renderers. Coordinates
 * already belong to the path's initial translating body frame. No physics queries. */
export function trajectoryMarkers(frame: RenderFrame): OverlayPrimitive[] {
  const out: OverlayPrimitive[] = [], origin = frame.pathOrigin ?? { x: 0, y: 0 };
  for (const point of frame.path) {
    if (!point.encounter || point.time < frame.state.time) continue;
    const center = { x: point.position.x + origin.x, y: point.position.y + origin.y };
    const to = frame.bodies?.find(body => body.id === point.encounter!.to)?.name ?? point.encounter.to;
    out.push({ kind: 'circle', space: 'world', center, radius: 4 / frame.camera.scale, color: '#dba76a', width: 1.5 },
      { kind: 'text', space: 'world', at: { x: center.x, y: center.y + 13 / frame.camera.scale },
        color: '#dba76a', align: 'center', text: `${to} · T−${(point.time - frame.state.time).toFixed(1)} s` });
    if (out.length >= 32) break;
  }
  return out;
}
