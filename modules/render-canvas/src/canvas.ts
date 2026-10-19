import { VEHICLE_MARKER, type VehicleAppearance } from '@space-sim/game-api';
import type { Vec, SceneFrame } from '@space-sim/game-api';
import { sceneFrame, type RendererPorts } from './ports';
import { createProjector, getPathGeometry, hermiteControls, type Camera, type RenderBody, type RenderFrame, type RenderShip, type Renderer,
  type RendererFeatures, type RenderTimer } from './frame';
import { screenOverlays, type ScreenOverlay } from './overlay';
import { drawCanvasTerrain, terrainGeometry } from './terrain';
import { daylight, NIGHT_LEVEL, screenDirection } from './lighting';
import { BodyCrowd, LabelPlacer, labelRect } from './layout';
import type { RenderThemeOptions } from '@space-sim/game-api';

const distance = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y);
const CULL_MARGIN = 8;
/** Latitude-line ellipse height as a fraction of the planet radius. */
const PARALLEL = 0.13;

const CRATERS = [
  { ox: 0.35, oy: -0.2, r: 0.18 },
  { ox: -0.3, oy: 0.35, r: 0.14 },
  { ox: 0.1, oy: 0.45, r: 0.22 },
  { ox: -0.25, oy: -0.4, r: 0.16 },
  { ox: 0.45, oy: 0.25, r: 0.12 },
] as const;

const STAR_BRIGHT_UV = new Float64Array(50);
const STAR_DIM_UV = new Float64Array(150);
{
  let bIdx = 0, dIdx = 0;
  for (let i = 0; i < 100; i++) {
    const u = ((i * 7919 + 31) % 1000) / 1000;
    const v = ((i * 3571 + 71) % 1000) / 1000;
    if (i % 4 === 0) {
      STAR_BRIGHT_UV[bIdx++] = u;
      STAR_BRIGHT_UV[bIdx++] = v;
    } else {
      STAR_DIM_UV[dIdx++] = u;
      STAR_DIM_UV[dIdx++] = v;
    }
  }
}

/** Shade the night side of a disc (and its glow) away from the screen direction to the star. */
function drawNightSide(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, sun: Vec): void {
  const edge = radius * 0.18;
  const shadow = ctx.createLinearGradient(x + sun.x * edge, y + sun.y * edge, x - sun.x * edge, y - sun.y * edge);
  shadow.addColorStop(0, 'rgba(5,10,18,0)');
  shadow.addColorStop(1, `rgba(5,10,18,${1 - NIGHT_LEVEL})`);
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fill();
}

function drawPlanetBase(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number,
  color = '#233c47', accent = '#659497', atmosphere = '#29495380', sun?: Vec): void {
  // A lit disc shades from its day side; drawNightSide darkens it once its markings are drawn.
  // Only render outer atmospheric glow if body is large enough to see it
  if (radius >= 6) {
    const atmoRadius = radius * 1.08;
    const glow = ctx.createRadialGradient(x, y, radius, x, y, atmoRadius);
    glow.addColorStop(0, atmosphere);
    glow.addColorStop(1, '#29495300');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, atmoRadius, 0, 2 * Math.PI);
    ctx.fill();
  }
  const gradient = sun ? ctx.createLinearGradient(x + sun.x * radius, y + sun.y * radius, x - sun.x * radius, y - sun.y * radius)
    : ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, '#101e2b');
  ctx.fillStyle = gradient;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
}

function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number,
  color = '#ffd000', accent = '#ff7700', atmosphere = '#ffaa0060'): void {
  if (radius >= 6) {
    // 1. Broad outer corona glow
    const outerCoronaRadius = radius * 1.85;
    const corona = ctx.createRadialGradient(x, y, radius, x, y, outerCoronaRadius);
    corona.addColorStop(0, atmosphere);
    corona.addColorStop(0.35, atmosphere.length === 9 ? atmosphere.slice(0, 7) + '33' : '#ff990030');
    corona.addColorStop(0.7, '#ff660010');
    corona.addColorStop(1, '#ff440000');
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(x, y, outerCoronaRadius, 0, 2 * Math.PI);
    ctx.fill();

    // 2. Solar corona rays radiating outward (only if large enough)
    if (radius >= 12) {
      ctx.save();
      ctx.translate(x, y);
      const numRays = 12;
      ctx.strokeStyle = atmosphere.length === 9 ? atmosphere.slice(0, 7) + '40' : '#ffaa0040';
      ctx.lineWidth = Math.max(1.2, radius * 0.05);
      ctx.beginPath();
      for (let i = 0; i < numRays; i++) {
        const angle = (i * 2 * Math.PI) / numRays;
        const len = (i % 2 === 0 ? 1.4 : 1.22) * radius;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        ctx.moveTo(cos * radius * 0.95, sin * radius * 0.95);
        ctx.lineTo(cos * len, sin * len);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // 3. Luminous stellar core with bright radial gradient (white-hot center to radiant gold/orange)
  const core = ctx.createRadialGradient(x, y, 0, x, y, radius);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(0.3, '#fff6bd');
  core.addColorStop(0.75, color);
  core.addColorStop(1, accent);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fill();

  // 4. Vibrant glowing edge
  ctx.strokeStyle = '#fff8db';
  ctx.lineWidth = Math.max(1, radius * 0.03);
  ctx.stroke();
}

/** Subtle craters for rocky moons */
function drawCraterLines(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, angle: number): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.strokeStyle = '#55697360'; ctx.lineWidth = 1;
  for (const c of CRATERS) {
    ctx.beginPath(); ctx.arc(c.ox * radius, c.oy * radius, c.r * radius, 0, 2 * Math.PI); ctx.stroke();
  }
  ctx.restore();
}

/** Parametric angle ranges [start, end] of the latitude ellipse centred at offset·radius
 * (width = disc diameter, height = PARALLEL·radius) that lie inside the disc. A point at
 * angle θ is inside when (1 - k²)sin²θ - 2uk·sinθ - u² >= 0, whose roots are u/(1-k) and -u/(1+k). */
export function parallelArcs(offset: number): ReadonlyArray<readonly [number, number]> {
  if (offset === 0) return [[0, 2 * Math.PI]];
  const a = offset / (1 - PARALLEL), b = -offset / (1 + PARALLEL);
  const lo = Math.asin(Math.min(a, b)), hi = Math.asin(Math.max(a, b));
  return [[hi, Math.PI - hi], [Math.PI - lo, 2 * Math.PI + lo]];
}

const GLOBE_PARALLELS = [-2, -1, 0, 1, 2].map(i => ({
  i,
  meridianRxFactor: Math.max(0.12, Math.abs(i) / 2.2),
  arcs: parallelArcs(i / 3).map(([start, end]) => ({
    start,
    end,
    cosStart: Math.cos(start),
    sinStart: Math.sin(start),
  })),
}));

/** Globe lines in the planet's own frame, rotated by `angle` on the canvas. Meridians are
 * inscribed and latitude lines are cut analytically to the disc, so no clip mask is
 * needed (a clip was the most expensive part of the frame in software rendering). */
function drawPlanetLines(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, angle: number): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.strokeStyle = '#35505a60'; ctx.lineWidth = 1;
  const height = radius * PARALLEL;
  for (const p of GLOBE_PARALLELS) {
    ctx.beginPath(); ctx.ellipse(0, 0, radius * p.meridianRxFactor, radius, 0, 0, Math.PI * 2); ctx.stroke();
    const centre = p.i * radius / 3;
    ctx.beginPath();
    for (const arc of p.arcs) {
      ctx.moveTo(radius * arc.cosStart, centre + height * arc.sinStart);
      ctx.ellipse(0, centre, radius, height, 0, arc.start, arc.end);
    }
    ctx.stroke();
  }
  ctx.restore();
}

const HORIZON_STEPS = 48;
const horizonPtsX = new Float64Array(HORIZON_STEPS + 1);
const horizonPtsY = new Float64Array(HORIZON_STEPS + 1);
const horizonAtmoX = new Float64Array(HORIZON_STEPS + 1);
const horizonAtmoY = new Float64Array(HORIZON_STEPS + 1);

/**
 * Render close-up planet horizon when apparent radius is large relative to viewport.
 * Rather than asking the browser 2D canvas to rasterize an arc with millions of pixels radius
 * (which overflows fixed-point clipping and causes tessellation distortion/triangles),
 * this clips the analytical horizon curve strictly to the visible viewport boundaries,
 * generating a smooth curvature polyline, local linear fill gradient, and atmospheric glow.
 */
export function drawPlanetHorizon(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  color = '#233c47',
  accent = '#659497',
  atmosphere = '#29495380',
  isStar = false,
  horizonColor?: string,
  skyColor?: string,
  /** Darkness of the visible ground and sky, 0 by day (see lighting.ts). */
  night = 0,
): void {
  const cx = width / 2, cy = height / 2;
  const dx = x - cx, dy = y - cy;
  const dist = Math.hypot(dx, dy);
  const maxCornerDist = Math.hypot(cx, cy);

  // If the body is so far that even its atmosphere doesn't reach the viewport
  const atmoReach = isStar ? radius * 0.85 : Math.max(30, Math.min(120, radius * 0.08));
  if (dist - radius > maxCornerDist + atmoReach) return;

  // If the viewport is entirely underground (every corner inside the planet)
  if (radius - dist > maxCornerDist) {
    ctx.fillStyle = isStar ? color : '#101e2b';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  // Direction from planet center towards screen center
  const theta0 = Math.atan2(cy - y, cx - x);

  // Compute angular range subtended by viewport corners as seen from the planet center
  let minDiff = 0;
  let maxDiff = 0;
  for (let c = 0; c < 4; c++) {
    const cornerX = (c === 1 || c === 2) ? width : 0;
    const cornerY = (c >= 2) ? height : 0;
    const angle = Math.atan2(cornerY - y, cornerX - x);
    let diff = angle - theta0;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (diff < minDiff) minDiff = diff;
    if (diff > maxDiff) maxDiff = diff;
  }

  // Angular margin ensuring the horizon curve extends cleanly beyond canvas borders
  const margin = Math.max(0.08, 60 / radius);
  const thetaMin = theta0 + minDiff - margin;
  const thetaMax = theta0 + maxDiff + margin;
  const angleSpan = Math.min(Math.PI * 0.95, Math.max(0.01, thetaMax - thetaMin));

  // Air is a share of the radius, so it stays as deep as the zoom shows it, however close.
  const glowHeight = isStar ? Math.min(200, Math.max(60, radius * 0.15)) : Math.max(radius * 0.08, Math.min(25, radius * 0.25));
  const atmoRadius = radius + glowHeight;

  for (let i = 0; i <= HORIZON_STEPS; i++) {
    const angle = thetaMin + (angleSpan * i) / HORIZON_STEPS;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    horizonPtsX[i] = x + radius * cosA;
    horizonPtsY[i] = y + radius * sinA;
    horizonAtmoX[i] = x + atmoRadius * cosA;
    horizonAtmoY[i] = y + atmoRadius * sinA;
  }

  // Midpoints on surface closest to screen center for ground gradient orientation
  const cos0 = Math.cos(theta0), sin0 = Math.sin(theta0);
  const pMidX = x + radius * cos0;
  const pMidY = y + radius * sin0;

  // 1. Atmosphere / Corona Glow extending outward into space
  // Traced forward along the surface arc, then backward along the concentric outer atmosphere arc
  ctx.save();
  const effectiveAtmo = skyColor ?? atmosphere;
  const transparentAtmo = effectiveAtmo.length === 9
    ? effectiveAtmo.slice(0, 7) + '00'
    : (effectiveAtmo.length === 7 ? effectiveAtmo + '00' : '#00000000');
  const atmoGrad = ctx.createRadialGradient(x, y, radius, x, y, atmoRadius);
  atmoGrad.addColorStop(0, effectiveAtmo);
  atmoGrad.addColorStop(1, transparentAtmo);
  ctx.fillStyle = atmoGrad;
  ctx.beginPath();
  ctx.moveTo(horizonPtsX[0]!, horizonPtsY[0]!);
  for (let i = 1; i <= HORIZON_STEPS; i++) ctx.lineTo(horizonPtsX[i]!, horizonPtsY[i]!);
  for (let i = HORIZON_STEPS; i >= 0; i--) ctx.lineTo(horizonAtmoX[i]!, horizonAtmoY[i]!);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 2. Planet / Stellar Core Ground Polygon
  // Unit vector towards the planet center ("down" into the surface)
  const ux = dist > 1e-4 ? dx / dist : 0;
  const uy = dist > 1e-4 ? dy / dist : 1;
  const groundDepth = maxCornerDist * 2 + 200;

  ctx.save();
  const groundGrad = ctx.createLinearGradient(
    pMidX,
    pMidY,
    pMidX + ux * Math.min(groundDepth, 350),
    pMidY + uy * Math.min(groundDepth, 350),
  );
  if (isStar) {
    groundGrad.addColorStop(0, '#ffffff');
    groundGrad.addColorStop(0.2, '#fff6bd');
    groundGrad.addColorStop(0.6, color);
    groundGrad.addColorStop(1, accent);
  } else {
    groundGrad.addColorStop(0, color);
    groundGrad.addColorStop(1, '#101e2b');
  }
  ctx.fillStyle = groundGrad;
  ctx.beginPath();
  ctx.moveTo(horizonPtsX[0]!, horizonPtsY[0]!);
  for (let i = 1; i <= HORIZON_STEPS; i++) ctx.lineTo(horizonPtsX[i]!, horizonPtsY[i]!);
  ctx.lineTo(horizonPtsX[HORIZON_STEPS]! + ux * groundDepth, horizonPtsY[HORIZON_STEPS]! + uy * groundDepth);
  ctx.lineTo(horizonPtsX[0]! + ux * groundDepth, horizonPtsY[0]! + uy * groundDepth);
  ctx.closePath();
  ctx.fill();

  // Night over the visible ground and its sky.
  if (night > 0) {
    ctx.fillStyle = `rgba(5,10,18,${night})`;
    ctx.beginPath();
    ctx.moveTo(horizonAtmoX[0]!, horizonAtmoY[0]!);
    for (let i = 1; i <= HORIZON_STEPS; i++) ctx.lineTo(horizonAtmoX[i]!, horizonAtmoY[i]!);
    ctx.lineTo(horizonPtsX[HORIZON_STEPS]! + ux * groundDepth, horizonPtsY[HORIZON_STEPS]! + uy * groundDepth);
    ctx.lineTo(horizonPtsX[0]! + ux * groundDepth, horizonPtsY[0]! + uy * groundDepth);
    ctx.closePath();
    ctx.fill();
  }

  // 3. Crisp horizon line stroke
  ctx.strokeStyle = isStar ? '#fff8db' : (horizonColor ?? accent);
  ctx.lineWidth = isStar ? 2 : 1.5;
  ctx.beginPath();
  ctx.moveTo(horizonPtsX[0]!, horizonPtsY[0]!);
  for (let i = 1; i <= HORIZON_STEPS; i++) ctx.lineTo(horizonPtsX[i]!, horizonPtsY[i]!);
  ctx.stroke();
  ctx.restore();
}

export class CanvasRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** No shader packs. Reading one pixel back makes the browser finish deferred drawing. */
  readonly features: RendererFeatures;
  private disposed = false;
  constructor(private readonly canvas: HTMLCanvasElement, private readonly ports: RendererPorts) {
    if(ports.maxPixelRatio!==undefined&&(!Number.isFinite(ports.maxPixelRatio)||ports.maxPixelRatio<.5||ports.maxPixelRatio>4))throw new Error('Pixel ratio cap must be in [0.5,4]');
    // Opaque: every frame paints the full background, so the page never blends through.
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
    this.ctx = ctx;
    this.features = Object.freeze({ flush: () => { ctx.getImageData(0, 0, 1, 1); } });
  }
  dispose(): void { this.disposed = true; }
  drawScene(frame: SceneFrame, timer?: RenderTimer): void { this.draw(sceneFrame(frame), timer); }
  draw(frame: RenderFrame, timer?: RenderTimer): void {
    if (this.disposed) throw new Error('Renderer has been disposed.');
    const { canvas, ctx } = this;
    const { state, camera, engine, bodies } = frame;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const toScreen = createProjector(camera, width, height);
    const dpr = Math.min(window.devicePixelRatio || 1, this.ports.maxPixelRatio ?? 3);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bodyList = bodies && bodies.length > 0 ? bodies : this.ports.fallbackBody ? [this.ports.fallbackBody] : [];

    const realTimeSec = (frame.presentationTime ?? (typeof performance !== 'undefined' ? performance.now() * 0.001 : state.time)) % 3600;
    this.drawBackground(width, height, camera, frame.theme, realTimeSec);
    timer?.lap('background');

    const maxViewportDim = Math.max(width, height);
    const maxCorner = Math.hypot(width / 2, height / 2);
    if (frame.showBodyOrbits !== false) {
      // 1. Draw orbit rings for moons around their parent bodies, all in one dashed path
      ctx.beginPath();
      let rings = 0;
      for (const b of bodyList) {
        if (b.parentPosition && b.orbitRadius) {
          const parentScreen = toScreen(b.parentPosition);
          const orbitScreenRadius = b.orbitRadius * camera.scale;
          if (orbitScreenRadius > 1) {
            const dx = parentScreen.x - width / 2;
            const dy = parentScreen.y - height / 2;
            const distToCenter = Math.hypot(dx, dy);

            // Cull if orbit ring does not intersect the viewport at all
            if (Math.abs(distToCenter - orbitScreenRadius) > maxCorner + 10) {
              continue;
            }
            rings++;
            // When orbit radius is larger than twice the viewport, clipping to a tangent segment
            // avoids generating millions of dashes across a multi-million-pixel circle
            if (orbitScreenRadius > maxViewportDim * 2) {
              const theta0 = Math.atan2(height / 2 - parentScreen.y, width / 2 - parentScreen.x);
              const cos0 = Math.cos(theta0), sin0 = Math.sin(theta0);
              const p0x = parentScreen.x + cos0 * orbitScreenRadius;
              const p0y = parentScreen.y + sin0 * orbitScreenRadius;
              const vx = -sin0, vy = cos0;
              const span = maxCorner + 30;
              ctx.moveTo(p0x - vx * span, p0y - vy * span);
              ctx.lineTo(p0x + vx * span, p0y + vy * span);
            } else {
              ctx.moveTo(parentScreen.x + orbitScreenRadius, parentScreen.y);
              ctx.arc(parentScreen.x, parentScreen.y, orbitScreenRadius, 0, 2 * Math.PI);
            }
          }
        }
      }
      if (rings) {
        ctx.strokeStyle = '#23374580';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const labels = new LabelPlacer();
    const shipPos = frame.shipWorldPosition ?? state.position;
    const ship = toScreen(shipPos);
    const shipVisible = frame.showShip !== false && ship.x >= -40 && ship.x <= width + 40 && ship.y >= -40 && ship.y <= height + 40;
    const shipLabel = state.status === 'crashed' ? 'SIGNAL LOST' : frame.shipLabel ?? 'VESSEL 01';
    if (shipVisible && frame.showShipLabels !== false) labels.reserve(labelRect(shipLabel, ship.x + 16, ship.y - 13, 'left'));
    // Body labels go to the biggest bodies first; crowded ones are left out.
    const labelOrder = bodyList.map((b, i) => ({ b, i, r: (b.surface?.bounds.maxRadius ?? b.radius) * camera.scale }))
      .sort((a, c) => ((a.b.surfaceFeatures === 'star') === (c.b.surfaceFeatures === 'star')
        ? c.r - a.r || a.i - c.i : a.b.surfaceFeatures === 'star' ? -1 : 1));
    const labelled = new Set<RenderBody>();
    const crowd = new BodyCrowd();
    for (const { b, r } of labelOrder) {
      const pos = toScreen(b.position);
      if (pos.x < -60 || pos.x > width + 60 || pos.y < -60 || pos.y > height + 60) continue;
      if (!crowd.admit(pos.x, pos.y, r) || r > maxViewportDim * 0.9) continue;
      const isStar = b.surfaceFeatures === 'star';
      if (pos.x < -60 || pos.x > width + 60 || pos.y < -60 || pos.y > height + 60) continue;
      const labelY = r < 2.5 ? (isStar ? pos.y - 10 : pos.y - 7) : (r > 30 ? pos.y - r - 8 : pos.y + Math.min(r + 14, 24));
      if (frame.showBodyLabels !== false && labels.tryPlace(labelRect(b.name.toUpperCase(), pos.x, labelY, 'center'))) labelled.add(b);
    }

    // 2. Draw each celestial body
    for (const b of bodyList) {
      const pos = toScreen(b.position);
      const r = (b.surface?.bounds.maxRadius ?? b.radius) * camera.scale;
      const isStar = b.surfaceFeatures === 'star';
      const outer = isStar ? r * 1.85 : r + Math.min(120, Math.max(25, r * .08));
      const sun = b.sunDirection && !isStar ? screenDirection(b.sunDirection, camera.rotation) : undefined;

      // Strict circle-to-viewport distance culling
      const clampX = Math.max(0, Math.min(width, pos.x));
      const clampY = Math.max(0, Math.min(height, pos.y));
      const distSq = (pos.x - clampX) ** 2 + (pos.y - clampY) ** 2;
      if (distSq > (outer + CULL_MARGIN) ** 2) {
        continue;
      }

      if (b.surface && !isStar) {
        drawCanvasTerrain(ctx, terrainGeometry({ ...b, surface: b.surface }, camera, width, height, this.ports.geometry));
      } else if (r < 2.5) {
        if (isStar) {
          // Radiant star beacon with glowing corona halo even at extreme zoom-out
          ctx.fillStyle = b.atmosphereColor ?? '#ffaa0050';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 6, 0, 2 * Math.PI);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 3, 0, 2 * Math.PI);
          ctx.fill();
        } else {
          // Distant marker dot so moons and planets remain visible at high zoom-out
          ctx.fillStyle = b.accentColor ?? '#8ddbc1';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 2.5, 0, 2 * Math.PI);
          ctx.fill();
        }
      } else {
        // Horizon threshold: when the body's radius is larger than 60% of viewport and center is offset, or radius > 1500
        const distToCenter = Math.hypot(pos.x - width / 2, pos.y - height / 2);
        if (r > 1500 || (r > maxViewportDim * 0.6 && distToCenter > maxCorner * 0.5)) {
          drawPlanetHorizon(
            ctx,
            width,
            height,
            pos.x,
            pos.y,
            r,
            b.color,
            b.accentColor,
            b.skyColor ?? b.atmosphereColor,
            isStar,
            b.horizonColor,
            b.skyColor,
            sun ? 1 - daylight((sun.x * (width / 2 - pos.x) + sun.y * (height / 2 - pos.y)) / (distToCenter || 1)) : 0,
          );
        } else if (isStar) {
          drawSun(ctx, pos.x, pos.y, r, b.color, b.accentColor, b.skyColor ?? b.atmosphereColor);
        } else {
          drawPlanetBase(ctx, pos.x, pos.y, r, b.color, b.horizonColor ?? b.accentColor, b.skyColor ?? b.atmosphereColor, sun);
          if (r >= 18) {
            if (b.surfaceFeatures === 'craters') {
              drawCraterLines(ctx, pos.x, pos.y, r, -camera.rotation - (b.rotation ?? 0));
            } else if (b.surfaceFeatures !== 'smooth') {
              drawPlanetLines(ctx, pos.x, pos.y, r, -camera.rotation - (b.rotation ?? 0));
            }
          }
          if (sun) drawNightSide(ctx, pos.x, pos.y, r >= 6 ? r * 1.08 : r, sun);
        }
      }
      if (r <= maxViewportDim * 0.9 && labelled.has(b)) {
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillStyle = isStar ? '#f5b041' : '#7b929d';
        ctx.textAlign = 'center';
        const labelY = r < 2.5
          ? (isStar ? pos.y - 10 : pos.y - 7)
          : (r > 30 ? pos.y - r - 8 : pos.y + Math.min(r + 14, 24));
        ctx.fillText(b.name.toUpperCase(), pos.x, labelY);
      }
    }
    timer?.lap('planet');

    this.drawPath(frame, toScreen, width, height);
    timer?.lap('path');

    const padPos = frame.padPosition ?? { x: 0, y: this.ports.fallbackBody?.radius ?? 0 };
    const pad = toScreen(padPos);
    const padAngle = frame.padNormal ? Math.atan2(frame.padNormal.y, frame.padNormal.x) + camera.rotation : Math.PI / 2;
    const padX = Math.sin(padAngle) * 7, padY = Math.cos(padAngle) * 7;
    if (frame.showPad !== false && (frame.padPosition || this.ports.fallbackBody) && pad.x >= -20 && pad.x <= width + 20 && pad.y >= -20 && pad.y <= height + 20) {
      ctx.strokeStyle = '#dba76a'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(pad.x - padX, pad.y - padY); ctx.lineTo(pad.x + padX, pad.y + padY); ctx.stroke();
    }

    const drawShip = (at: Vec, heading: number, status: string, burning: boolean, throttle: number, size: number, fill: string): void => {
      ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(-heading - camera.rotation);
      if (size !== 1) ctx.scale(size, size);
      const artwork = this.ports.vehicles?.get(frame.vehicleId), hull = artwork?.hull ?? VEHICLE_MARKER, flame = artwork?.flame;
      if (flame && burning && status === 'flying') {
        ctx.fillStyle = '#e0a665'; ctx.beginPath(); ctx.moveTo(flame.x, -flame.halfWidth); ctx.lineTo(flame.x - flame.length - throttle * flame.throttleLength, 0); ctx.lineTo(flame.x, flame.halfWidth); ctx.fill();
      }
      ctx.fillStyle = status === 'crashed' ? '#ef8c7a' : fill; ctx.strokeStyle = '#080f19';
      ctx.beginPath(); ctx.moveTo(hull[0]!.x, hull[0]!.y); for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i]!.x, hull[i]!.y); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    };
    ctx.font = '11px ui-monospace, monospace'; ctx.textAlign = 'left';
    this.drawRocks(frame.ships ?? [], toScreen, width, height);
    this.drawShipBatch(frame.ships ?? [], toScreen, camera.rotation, width, height);
    ctx.fillStyle = '#95a9b5';
    for (const other of frame.ships ?? []) {
      if (other.rock || frame.showShipLabels === false) continue;
      const at = toScreen(other.position);
      if (at.x < -40 || at.x > width + 40 || at.y < -40 || at.y > height + 40) continue;
      const text = other.status === 'crashed' ? `${other.label} · LOST` : other.label;
      if (labels.tryPlace(labelRect(text, at.x + 13, at.y - 11, 'left'))) ctx.fillText(text, at.x + 13, at.y - 11);
    }
    if (shipVisible) {
      drawShip(ship, state.heading, state.status, engine, state.throttle, 1, '#e8f8ef');
      ctx.fillStyle = '#95a9b5';
      if (frame.showShipLabels !== false) ctx.fillText(shipLabel, ship.x + 16, ship.y - 13);
    }
    timer?.lap('ship');
    // Scale annotation is in world metres, independent of canvas device pixels.
    if (frame.showScale !== false) {
      const metres = 10 ** Math.floor(Math.log10(100 / camera.scale));
      const pixels = metres * camera.scale;
      ctx.strokeStyle = '#66808c'; ctx.beginPath(); ctx.moveTo(width - 24 - pixels, height - 27); ctx.lineTo(width - 24, height - 27); ctx.stroke();
      ctx.font = '11px ui-monospace, monospace'; ctx.fillStyle = '#95a9b5'; ctx.textAlign = 'right';
      ctx.fillText(`${metres} m`, width - 24, height - 36);
    }
    if (frame.overlays?.length) this.drawOverlays(screenOverlays(frame.overlays, camera, width, height));
    timer?.lap('overlay');
  }

  /** Presentation layers above the built-in scene: every shape in order, then every label in
   * order, matching the WebGL renderer so text stays readable. */
  private drawOverlays(items: readonly ScreenOverlay[]): void {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([]); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.font = '11px ui-monospace, monospace';
    for (const item of items) {
      if (item.kind === 'text') continue;
      ctx.beginPath();
      if (item.kind === 'circle') ctx.arc(item.center.x, item.center.y, item.radius, 0, 2 * Math.PI);
      else {
        ctx.moveTo(item.points[0]!.x, item.points[0]!.y);
        for (let i = 1; i < item.points.length; i++) ctx.lineTo(item.points[i]!.x, item.points[i]!.y);
        if (item.kind === 'polygon') ctx.closePath();
      }
      if (item.kind === 'polygon' || (item.kind === 'circle' && item.fill)) { ctx.fillStyle = item.color; ctx.fill(); }
      else { ctx.strokeStyle = item.color; ctx.lineWidth = item.width; ctx.stroke(); }
    }
    for (const item of items) {
      if (item.kind !== 'text') continue;
      ctx.fillStyle = item.color; ctx.textAlign = item.align;
      ctx.fillText(item.text, item.at.x, item.at.y);
    }
    ctx.restore();
  }

  /** Asteroids as small squares, two fills (intact and wrecked). */
  private drawRocks(others: readonly RenderShip[], toScreen: (p: Vec) => Vec, width: number, height: number): void {
    const { ctx } = this;
    for (const [fill, crashed] of [['#99948c', false], ['#ef8c7a', true]] as const) {
      ctx.beginPath();
      let any = false;
      for (const o of others) {
        if (!o.rock || (o.status === 'crashed') !== crashed) continue;
        const at = toScreen(o.position);
        if (at.x < -8 || at.x > width + 8 || at.y < -8 || at.y > height + 8) continue;
        ctx.rect(at.x - 1.75, at.y - 1.75, 3.5, 3.5);
        any = true;
      }
      if (any) { ctx.fillStyle = fill; ctx.fill(); }
    }
  }

  /** Other vessels as one path per fill (flames, three hull colors) plus one outline path. */
  private drawShipBatch(others: readonly RenderShip[], toScreen: (p: Vec) => Vec, rotation: number,
    width: number, height: number): void {
    const { ctx } = this;
    const placed: { readonly x: number; readonly y: number; readonly c: number; readonly s: number; readonly ship: RenderShip; readonly artwork?: VehicleAppearance }[] = [];
    for (const other of others) {
      if (other.rock) continue;
      const at = toScreen(other.position);
      if (at.x < -40 || at.x > width + 40 || at.y < -40 || at.y > height + 40) continue;
      const angle = -other.heading - rotation;
      placed.push({ x: at.x, y: at.y, c: Math.cos(angle) * 0.8, s: Math.sin(angle) * 0.8, ship: other, artwork: this.ports.vehicles?.get(other.vehicleId) });
    }
    if (!placed.length) return;
    const hull = (p: typeof placed[number]): void => {
      const points = p.artwork?.hull ?? VEHICLE_MARKER;
      const first = points[0]!;
      ctx.moveTo(p.x + first.x * p.c - first.y * p.s, p.y + first.x * p.s + first.y * p.c);
      for (let i = 1; i < points.length; i++) {
        const v = points[i]!; ctx.lineTo(p.x + v.x * p.c - v.y * p.s, p.y + v.x * p.s + v.y * p.c);
      }
      ctx.closePath();
    };
    ctx.beginPath();
    for (const p of placed) {
      const f = p.artwork?.flame;
      if (!f || !p.ship.engine || p.ship.status !== 'flying') continue;
      const tip = f.x - f.length - p.ship.throttle * f.throttleLength;
      ctx.moveTo(p.x + f.x * p.c + f.halfWidth * p.s, p.y + f.x * p.s - f.halfWidth * p.c);
      ctx.lineTo(p.x + tip * p.c, p.y + tip * p.s);
      ctx.lineTo(p.x + f.x * p.c - f.halfWidth * p.s, p.y + f.x * p.s + f.halfWidth * p.c); ctx.closePath();
    }
    ctx.fillStyle = '#e0a665'; ctx.fill();
    for (const [fill, match] of [['#9fbfc9', (s: RenderShip) => s.status !== 'crashed' && !s.foreign],
      ['#f7c775', (s: RenderShip) => s.status !== 'crashed' && !!s.foreign],
      ['#ef8c7a', (s: RenderShip) => s.status === 'crashed']] as const) {
      ctx.beginPath();
      let any = false;
      for (const p of placed) if (match(p.ship)) { hull(p); any = true; }
      if (any) { ctx.fillStyle = fill; ctx.fill(); }
    }
    ctx.beginPath();
    for (const p of placed) hull(p);
    ctx.strokeStyle = '#080f19'; ctx.lineWidth = 1; ctx.stroke();
  }

  private drawBackground(
    width: number,
    height: number,
    camera?: Camera,
    theme?: RenderThemeOptions,
    timeSec = 0,
  ): void {
    const artwork = this.ports.theme;
    if (!artwork) { this.ctx.fillStyle = '#080f19'; this.ctx.fillRect(0, 0, width, height); return; }
    const fullTheme = theme ? { ...artwork.current(), ...theme } : artwork.current();
    artwork.backdrop(this.ctx, width, height, camera ?? { center: { x: 0, y: 0 }, scale: 1, rotation: 0 }, fullTheme, timeSec);
  }

  /** Dashed Hermite curves through the ghost samples. Off-screen segments are culled; each
   * visible run restarts the dash at its accumulated length so dashes stay continuous. */
  private drawPath({ state, path, pathClosed, camera, pathOrigin }: RenderFrame, _toScreen: (p: Vec) => Vec,
    width: number, height: number): void {
    if (path.length === 0) return;
    const origin = pathOrigin ?? { x: 0, y: 0 };
    const c = Math.cos(camera.rotation), s = Math.sin(camera.rotation);
    const ox = origin.x - camera.center.x, oy = origin.y - camera.center.y;
    const halfW = width / 2, halfH = height / 2, scale = camera.scale;
    const projectLocalX = (px: number, py: number): number => halfW + ((ox + px) * c - (oy + py) * s) * scale;
    const projectLocalY = (px: number, py: number): number => halfH - ((ox + px) * s + (oy + py) * c) * scale;

    const geom = getPathGeometry(path);
    const { ctx } = this;

    let firstIdx = 1;
    let startX = 0;
    let startY = 0;
    let length = 0;
    let firstSegControls: readonly [Vec, Vec] | undefined;

    if (pathClosed) {
      if (path.length < 2) return;
      startX = projectLocalX(path[0]!.position.x, path[0]!.position.y);
      startY = projectLocalY(path[0]!.position.x, path[0]!.position.y);
    } else {
      let lo = 0, hi = path.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (path[mid]!.time <= state.time) lo = mid + 1; else hi = mid; }
      if (lo === path.length) return;
      const flown = lo > 0 ? geom.cumulativeChords[lo - 1]! + distance(path[lo - 1]!.position, state.position) : 0;
      length = flown * scale;
      startX = projectLocalX(state.position.x, state.position.y);
      startY = projectLocalY(state.position.x, state.position.y);
      firstIdx = lo;
      firstSegControls = hermiteControls(
        { time: state.time, position: state.position, velocity: state.velocity },
        path[lo]!,
      );
    }

    ctx.strokeStyle = '#8ddbc1'; ctx.lineWidth = 1.3; ctx.setLineDash([4, 5]);
    let running = false;
    for (let i = firstIdx; i < path.length; i++) {
      const [c1, c2] = (i === firstIdx && firstSegControls) ? firstSegControls : geom.controls[i - 1]!;
      const endPos = path[i]!.position;
      const p1x = projectLocalX(c1.x, c1.y), p1y = projectLocalY(c1.x, c1.y);
      const p2x = projectLocalX(c2.x, c2.y), p2y = projectLocalY(c2.x, c2.y);
      const endX = projectLocalX(endPos.x, endPos.y), endY = projectLocalY(endPos.x, endPos.y);
      const visible = Math.max(startX, p1x, p2x, endX) >= -CULL_MARGIN
        && Math.min(startX, p1x, p2x, endX) <= width + CULL_MARGIN
        && Math.max(startY, p1y, p2y, endY) >= -CULL_MARGIN
        && Math.min(startY, p1y, p2y, endY) <= height + CULL_MARGIN;
      if (visible) {
        if (!running) { ctx.lineDashOffset = length; ctx.beginPath(); ctx.moveTo(startX, startY); running = true; }
        ctx.bezierCurveTo(p1x, p1y, p2x, p2y, endX, endY);
      } else if (running) { ctx.stroke(); running = false; }
      length += Math.hypot(endX - startX, endY - startY);
      startX = endX;
      startY = endY;
    }
    if (running) ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }
}
