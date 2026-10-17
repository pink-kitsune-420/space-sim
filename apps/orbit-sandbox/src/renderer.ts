import { createProjector, dragCamera, drawProceduralBackdrop, getActiveTheme, WebGLRenderer, screenToWorld, type Camera, type RenderBody } from './spacelab/render-2d';
export { dragCamera, screenToWorld, type Camera, type RenderBody };
import type { Vec } from './spacelab/sim-core';
import type { CelestialBody, SlingshotCandidate } from './types';
import { getOrComputeOrbitElements } from './physics';

export interface MutableCamera {
  center: { x: number; y: number };
  scale: number;
  rotation: number;
}

export interface RendererState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  glRenderer?: WebGLRenderer;
  camera: MutableCamera;
  selectedBodyId: string | null;
  hoveredBodyId: string | null;
  isEditingRings: boolean;
  showOrbitLines: boolean;
  showOrbitApsides: boolean;
}

export function createRenderer(canvas: HTMLCanvasElement): RendererState {
  const ctx = canvas.getContext('2d')!;
  let glRenderer: WebGLRenderer | undefined;

  try {
    let glCanvas = document.getElementById('orbit-gl-canvas') as HTMLCanvasElement | null;
    if (!glCanvas && canvas.parentElement) {
      glCanvas = document.createElement('canvas');
      glCanvas.id = 'orbit-gl-canvas';
      glCanvas.style.position = 'absolute';
      glCanvas.style.top = '0';
      glCanvas.style.left = '0';
      glCanvas.style.width = '100%';
      glCanvas.style.height = '100%';
      glCanvas.style.pointerEvents = 'none';
      canvas.parentElement.insertBefore(glCanvas, canvas);
    }
    if (glCanvas) {
      glRenderer = new WebGLRenderer(glCanvas);
    }
  } catch (err) {
    console.warn('Orbit Sandbox WebGL shader renderer unavailable, falling back to 2D:', err);
  }

  const camera: MutableCamera = {
    center: { x: 12000, y: 0 },
    scale: 0.0075, // screen px per meter
    rotation: 0,
  };

  return {
    canvas,
    ctx,
    glRenderer,
    camera,
    selectedBodyId: null,
    hoveredBodyId: null,
    isEditingRings: false,
    showOrbitLines: true,
    showOrbitApsides: true,
  };
}


export function worldToScreen(worldPos: Vec, camera: Camera, width: number, height: number): Vec {
  const projector = createProjector(camera, width, height);
  return projector(worldPos);
}



export function renderScene(
  state: RendererState,
  bodies: readonly CelestialBody[],
  candidate: SlingshotCandidate | null,
  timeSec: number,
): void {
  const { ctx, canvas, camera, glRenderer } = state;
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const width = canvas.clientWidth || (canvas.width / dpr);
  const height = canvas.clientHeight || (canvas.height / dpr);
  const theme = getActiveTheme();

  // 1. Unified 3D WebGL Shader Pass (Procedural Skybox, Stars, Nebulae, Galaxies & 3D Planets)
  if (glRenderer) {
    const star = bodies.find(s => s.surfaceFeatures === 'star');
    const renderBodies: RenderBody[] = bodies.map(b => {
      let sunDirection: Vec | undefined;
      if (star && star.id !== b.id) {
        const dx = star.position.x - b.position.x;
        const dy = star.position.y - b.position.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.1) sunDirection = { x: dx / d, y: dy / d };
      }
      const spinPeriod = b.rotation?.period || 86400;
      const spinDir = b.rotation?.direction || 1;
      const rotation = (timeSec * 2 * Math.PI / spinPeriod * spinDir) + (b.rotation?.phaseRadiansAtEpoch || 0);

      return {
        id: b.id,
        name: b.name,
        position: b.position,
        radius: b.radius,
        color: b.color,
        accentColor: b.accentColor,
        atmosphereColor: b.atmosphereColor,
        horizonColor: b.accentColor,
        skyColor: b.atmosphereColor,
        surfaceFeatures: b.surfaceFeatures,
        rotation,
        sunDirection,
        appearance: b.appearance,
      };
    });

    glRenderer.draw({
      state: {
        time: timeSec,
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        heading: 0,
        throttle: 0,
        status: 'flying',
        revision: 0,
      },
      camera: {
        center: camera.center,
        scale: camera.scale,
        rotation: camera.rotation,
      },
      bodies: renderBodies,
      path: [],
      pathClosed: false,
      engine: false,
      theme: {
        ...theme,
        highQuality: true,
      },
    });

    // Clear 2D overlay canvas so WebGL shaders show through
    ctx.clearRect(0, 0, width, height);
  } else {
    // Canvas 2D Fallback
    drawProceduralBackdrop(ctx, width, height, camera, theme, timeSec, theme.highQuality !== false);
  }

  // 2. Orbital Trails
  ctx.save();
  for (const body of bodies) {
    if (body.trail.length > 1) {
      ctx.beginPath();
      const first = worldToScreen(body.trail[0]!, camera, width, height);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < body.trail.length; i++) {
        const pt = worldToScreen(body.trail[i]!, camera, width, height);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = `${body.color}40`;
      ctx.lineWidth = Math.max(1, Math.min(2.5, 120 * camera.scale));
      ctx.stroke();
    }
  }
  ctx.restore();

  // 3. Planetary Orbit Lines (Keplerian / Cached relative ellipses)
  renderOrbitLines(ctx, camera, width, height, bodies, state, timeSec);

  // 4. Celestial Bodies Overlay (Selection rings, vector arrows, labels)
  for (const body of bodies) {
    renderCelestialBody(ctx, camera, width, height, body, state, timeSec, Boolean(glRenderer));
  }

  // 5. Slingshot Drag Vector & Ghost Trajectory
  if (candidate) {
    renderSlingshotDrag(ctx, camera, width, height, candidate);
  }
}

function renderOrbitLines(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  bodies: readonly CelestialBody[],
  state: RendererState,
  timeSec: number,
): void {
  if (!state.showOrbitLines) return;

  ctx.save();
  for (const body of bodies) {
    if (body.isFixed || body.showOrbitLine === false) continue;

    const cache = getOrComputeOrbitElements(body, bodies, timeSec);
    if (!cache) continue;

    const parent = bodies.find(b => b.id === cache.parentBodyId);
    if (!parent) continue;

    const points = cache.relativeOrbitPoints;
    if (!points || points.length < 2) continue;

    const isSelected = state.selectedBodyId === body.id;
    const isHovered = state.hoveredBodyId === body.id;

    // Draw the orbit line path
    ctx.beginPath();
    const firstWorld = { x: parent.position.x + points[0]!.x, y: parent.position.y + points[0]!.y };
    const firstScreen = worldToScreen(firstWorld, camera, width, height);
    ctx.moveTo(firstScreen.x, firstScreen.y);

    for (let i = 1; i < points.length; i++) {
      const pWorld = { x: parent.position.x + points[i]!.x, y: parent.position.y + points[i]!.y };
      const ptScreen = worldToScreen(pWorld, camera, width, height);
      ctx.lineTo(ptScreen.x, ptScreen.y);
    }

    if (cache.isBound) {
      ctx.closePath();
    }

    if (isSelected) {
      ctx.strokeStyle = '#38bdf890';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([]);
    } else if (isHovered) {
      ctx.strokeStyle = `${body.color}90`;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = `${body.color}35`;
      ctx.lineWidth = 1.0;
      ctx.setLineDash([4, 4]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Periapsis / Apoapsis markers if apsides enabled or body is selected/hovered
    if (state.showOrbitApsides || isSelected || isHovered) {
      // 1. Eccentricity suppression: circular orbits (e < 0.025) have degenerate apsides that jump around
      const minEccentricity = isSelected ? 0.015 : 0.025;
      if (cache.eccentricity < minEccentricity) {
        continue;
      }

      // 2. Small orbit culling (e.g. distant moons) to prevent label crowding
      const semiMajor = cache.semiMajorAxis ?? cache.periapsisRadius;
      const scrSemiMajor = semiMajor * camera.scale;
      if (scrSemiMajor < 30 && !isSelected) {
        continue;
      }
      if (scrSemiMajor < 14) {
        continue;
      }

      const parentScr = worldToScreen(parent.position, camera, width, height);
      const parentScrR = Math.max(6, parent.radius * camera.scale);
      const bodyScr = worldToScreen(body.position, camera, width, height);
      const bodyScrR = Math.max(6, body.radius * camera.scale);

      // Periapsis marker
      const peWorld = {
        x: parent.position.x + cache.periapsisOffset.x,
        y: parent.position.y + cache.periapsisOffset.y,
      };
      const peScr = worldToScreen(peWorld, camera, width, height);

      // Check collision with parent or body discs
      const peDistParent = Math.hypot(peScr.x - parentScr.x, peScr.y - parentScr.y);
      const peDistBody = Math.hypot(peScr.x - bodyScr.x, peScr.y - bodyScr.y);
      const canDrawPe = peDistParent >= (parentScrR + 8) && peDistBody >= (bodyScrR + 8);

      if (canDrawPe) {
        drawApsisBadge(
          ctx,
          peScr.x,
          peScr.y,
          'Pe',
          cache.periapsisRadius,
          isSelected ? '#38bdf8' : 'rgba(56, 189, 248, 0.85)',
          parentScr,
          isSelected,
        );
      }

      // Apoapsis marker
      if (cache.isBound && cache.apoapsisOffset && cache.apoapsisRadius !== null) {
        const apWorld = {
          x: parent.position.x + cache.apoapsisOffset.x,
          y: parent.position.y + cache.apoapsisOffset.y,
        };
        const apScr = worldToScreen(apWorld, camera, width, height);

        const apDistParent = Math.hypot(apScr.x - parentScr.x, apScr.y - parentScr.y);
        const apDistBody = Math.hypot(apScr.x - bodyScr.x, apScr.y - bodyScr.y);
        const apDistPe = canDrawPe ? Math.hypot(apScr.x - peScr.x, apScr.y - peScr.y) : 999;
        const canDrawAp = apDistParent >= (parentScrR + 8) && apDistBody >= (bodyScrR + 8) && apDistPe >= 24;

        if (canDrawAp) {
          drawApsisBadge(
            ctx,
            apScr.x,
            apScr.y,
            'Ap',
            cache.apoapsisRadius,
            isSelected ? '#f43f5e' : 'rgba(244, 63, 94, 0.85)',
            parentScr,
            isSelected,
          );
        }
      }
    }
  }
  ctx.restore();
}

function renderCelestialBody(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  body: CelestialBody,
  state: RendererState,
  timeSec: number,
  isWebGLActive = false,
): void {
  const scr = worldToScreen(body.position, camera, width, height);
  const scrR = Math.max(2, body.radius * camera.scale);

  // Cull if completely off screen
  if (scr.x < -scrR * 3 || scr.x > width + scrR * 3 || scr.y < -scrR * 3 || scr.y > height + scrR * 3) {
    return;
  }

  const isSelected = state.selectedBodyId === body.id;
  const isHovered = state.hoveredBodyId === body.id;

  ctx.save();

  if (!isWebGLActive) {
    // 1. Atmosphere / Corona Glow (Canvas 2D Fallback)
    if (body.surfaceFeatures === 'star') {
      const coronaR = scrR * 2.8;
      const grad = ctx.createRadialGradient(scr.x, scr.y, scrR * 0.8, scr.x, scr.y, coronaR);
      grad.addColorStop(0, body.atmosphereColor);
      grad.addColorStop(0.5, `${body.accentColor}40`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(scr.x, scr.y, coronaR, 0, Math.PI * 2);
      ctx.fill();
    } else if (scrR >= 4) {
      const atmoR = scrR * 1.35;
      const atmoGrad = ctx.createRadialGradient(scr.x, scr.y, scrR, scr.x, scr.y, atmoR);
      atmoGrad.addColorStop(0, body.atmosphereColor);
      atmoGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = atmoGrad;
      ctx.beginPath();
      ctx.arc(scr.x, scr.y, atmoR, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Planet Disc / Star Core (Canvas 2D Fallback)
    ctx.beginPath();
    ctx.arc(scr.x, scr.y, scrR, 0, Math.PI * 2);

    if (body.surfaceFeatures === 'star') {
      const starGrad = ctx.createRadialGradient(scr.x - scrR * 0.2, scr.y - scrR * 0.2, 0, scr.x, scr.y, scrR);
      starGrad.addColorStop(0, body.appearance.colors[0] ?? '#ffffff');
      starGrad.addColorStop(0.4, body.color);
      starGrad.addColorStop(0.85, body.accentColor);
      starGrad.addColorStop(1, '#c8401a');
      ctx.fillStyle = starGrad;
      ctx.fill();
    } else {
      // 3D sphere shading gradient
      const lightAngle = Math.PI / 4;
      const lx = scr.x - Math.cos(lightAngle) * scrR * 0.4;
      const ly = scr.y - Math.sin(lightAngle) * scrR * 0.4;
      const sphereGrad = ctx.createRadialGradient(lx, ly, scrR * 0.1, scr.x, scr.y, scrR);
      sphereGrad.addColorStop(0, body.accentColor);
      sphereGrad.addColorStop(0.5, body.color);
      sphereGrad.addColorStop(1, '#050a12');
      ctx.fillStyle = sphereGrad;
      ctx.fill();

      // Surface details if visible
      if (scrR > 8) {
        drawBodyDetails(ctx, scr.x, scr.y, scrR, body, timeSec);
      }
    }

    // 3. Rings (Canvas 2D Fallback)
    if (body.rings) {
      renderRings(ctx, camera, width, height, body, scr, timeSec);
    }
  }

  // 4. Selection / Hover Rings
  if (isSelected || isHovered) {
    ctx.beginPath();
    ctx.arc(scr.x, scr.y, scrR + 6, 0, Math.PI * 2);
    ctx.strokeStyle = isSelected ? '#38bdf8' : 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();

    // Direction / velocity vector
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (speed > 0.1) {
      const vScale = 0.5 * camera.scale;
      const vxEnd = scr.x + body.velocity.x * vScale;
      const vyEnd = scr.y - body.velocity.y * vScale;
      ctx.beginPath();
      ctx.moveTo(scr.x, scr.y);
      ctx.lineTo(vxEnd, vyEnd);
      ctx.strokeStyle = '#4ed99c';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // 5. Name & Info Tag
  ctx.fillStyle = isSelected ? '#38bdf8' : '#94a3b8';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  const tagY = scr.y + scrR + 14;
  ctx.fillText(body.name, scr.x, tagY);
  if (isSelected) {
    const v = Math.hypot(body.velocity.x, body.velocity.y);
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.fillText(`${v.toFixed(1)} m/s · r: ${Math.round(body.radius)}m`, scr.x, tagY + 12);
  }

  ctx.restore();
}

function drawBodyDetails(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  body: CelestialBody,
  timeSec: number,
): void {
  ctx.save();
  ctx.clip(); // Clip to the body disc

  const rotationAngle = (timeSec / body.rotation.period) * Math.PI * 2 * body.rotation.direction;

  if (body.appearance.style === 'banded') {
    // Gas giant cloud bands
    const bandCount = 7;
    for (let i = 0; i < bandCount; i++) {
      const by = y - radius + (i / bandCount) * radius * 2;
      const bHeight = (radius * 2) / bandCount;
      const colIdx = i % body.appearance.colors.length;
      ctx.fillStyle = `${body.appearance.colors[colIdx]}40`;
      ctx.fillRect(x - radius, by, radius * 2, bHeight);
    }
  } else if (body.appearance.style === 'oceanic') {
    // Continents & clouds
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotationAngle);
    ctx.fillStyle = `${body.appearance.colors[1]}80`;
    ctx.beginPath();
    ctx.ellipse(radius * 0.2, radius * 0.1, radius * 0.45, radius * 0.35, 0.4, 0, Math.PI * 2);
    ctx.ellipse(-radius * 0.3, -radius * 0.2, radius * 0.35, radius * 0.25, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // Swirling cloud wisp
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = Math.max(1, radius * 0.12);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.65, 0.5, 2.5);
    ctx.stroke();
    ctx.restore();
  } else if (body.appearance.style === 'volcanic') {
    // Lava cracks
    ctx.strokeStyle = '#ff6a1f';
    ctx.lineWidth = Math.max(1, radius * 0.08);
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.5, y - radius * 0.2);
    ctx.lineTo(x, y + radius * 0.3);
    ctx.lineTo(x + radius * 0.4, y - radius * 0.1);
    ctx.stroke();
  } else if (body.appearance.style === 'rocky' || body.appearance.style === 'icy') {
    // Subtle crater shadows
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(x + radius * 0.3, y - radius * 0.2, radius * 0.2, 0, Math.PI * 2);
    ctx.arc(x - radius * 0.25, y + radius * 0.35, radius * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  // Dark limb on night side
  const nightGrad = ctx.createLinearGradient(x - radius * 0.5, y - radius * 0.5, x + radius, y + radius);
  nightGrad.addColorStop(0, 'rgba(0,0,0,0)');
  nightGrad.addColorStop(0.7, 'rgba(0,0,0,0.1)');
  nightGrad.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = nightGrad;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

  ctx.restore();
}

function renderRings(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  _width: number,
  _height: number,
  _body: CelestialBody,
  scr: Vec,
  _timeSec: number,
): void {
  const rings = _body.rings;
  if (!rings) return;

  const innerScrR = rings.innerRadius * camera.scale;
  const outerScrR = rings.outerRadius * camera.scale;

  if (outerScrR < 1) return;

  ctx.save();
  // Translucent ring disc
  const ringGrad = ctx.createRadialGradient(scr.x, scr.y, innerScrR, scr.x, scr.y, outerScrR);
  ringGrad.addColorStop(0, 'rgba(216, 185, 142, 0.05)');
  ringGrad.addColorStop(0.3, rings.color);
  ringGrad.addColorStop(0.8, 'rgba(216, 185, 142, 0.35)');
  ringGrad.addColorStop(1, 'rgba(216, 185, 142, 0.0)');

  ctx.fillStyle = ringGrad;
  ctx.beginPath();
  ctx.arc(scr.x, scr.y, outerScrR, 0, Math.PI * 2);
  ctx.arc(scr.x, scr.y, innerScrR, 0, Math.PI * 2, true);
  ctx.fill();

  // Draw discrete ring particles
  if (rings.particles && innerScrR > 10) {
    for (const p of rings.particles) {
      const pDist = p.radius * camera.scale;
      const px = scr.x + Math.cos(p.angle) * pDist;
      const py = scr.y + Math.sin(p.angle) * pDist;
      ctx.fillStyle = `rgba(240, 225, 200, ${p.opacity})`;
      ctx.fillRect(px, py, p.size, p.size);
    }
  }

  ctx.restore();
}

function renderSlingshotDrag(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  candidate: SlingshotCandidate,
): void {
  const scrOrigin = worldToScreen(candidate.origin, camera, width, height);

  ctx.save();

  // 1. Ghost Trajectory Path
  if (candidate.ghostPath.length > 1) {
    ctx.beginPath();
    const first = worldToScreen(candidate.ghostPath[0]!.position, camera, width, height);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < candidate.ghostPath.length; i++) {
      const pt = worldToScreen(candidate.ghostPath[i]!.position, camera, width, height);
      ctx.lineTo(pt.x, pt.y);
    }

    ctx.strokeStyle = candidate.isSnappingCircular
      ? '#4ed99c'
      : (candidate.orbitalPeriod ? '#38bdf8' : '#f59e0b');
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Periapsis and Apoapsis indicators
    const centerScr = candidate.parentBody ? worldToScreen(candidate.parentBody.position, camera, width, height) : scrOrigin;
    for (const sample of candidate.ghostPath) {
      if (sample.isPeriapsis && candidate.periapsisRadius !== null) {
        const pt = worldToScreen(sample.position, camera, width, height);
        drawApsisBadge(ctx, pt.x, pt.y, 'Pe', candidate.periapsisRadius, '#38bdf8', centerScr, true);
      } else if (sample.isApoapsis && candidate.apoapsisRadius !== null) {
        const pt = worldToScreen(sample.position, camera, width, height);
        drawApsisBadge(ctx, pt.x, pt.y, 'Ap', candidate.apoapsisRadius, '#f43f5e', centerScr, true);
      } else if (sample.collided) {
        const pt = worldToScreen(sample.position, camera, width, height);
        drawCollisionMarker(ctx, pt.x, pt.y);
      }
    }
  }

  // 2. Candidate Planet Preview at Origin
  ctx.beginPath();
  ctx.arc(scrOrigin.x, scrOrigin.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#38bdf8';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 3. Velocity Vector Arrow
  // v is in world m/s. Arrow in screen px:
  const arrowScale = 2.0; // px per m/s
  const arrowEnd = {
    x: scrOrigin.x + candidate.velocity.x * arrowScale,
    y: scrOrigin.y - candidate.velocity.y * arrowScale,
  };

  const speed = candidate.currentSpeed;

  if (speed > 0.5) {
    ctx.beginPath();
    ctx.moveTo(scrOrigin.x, scrOrigin.y);
    ctx.lineTo(arrowEnd.x, arrowEnd.y);
    ctx.strokeStyle = candidate.isSnappingCircular ? '#4ed99c' : '#38bdf8';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Arrowhead
    const angle = Math.atan2(scrOrigin.y - arrowEnd.y, arrowEnd.x - scrOrigin.x);
    const headLen = 10;
    ctx.fillStyle = candidate.isSnappingCircular ? '#4ed99c' : '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(arrowEnd.x, arrowEnd.y);
    ctx.lineTo(
      arrowEnd.x - headLen * Math.cos(angle - Math.PI / 6),
      arrowEnd.y + headLen * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      arrowEnd.x - headLen * Math.cos(angle + Math.PI / 6),
      arrowEnd.y + headLen * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fill();

    // 4. Live Speed Readout Badge
    const badgeX = arrowEnd.x + 12;
    const badgeY = arrowEnd.y - 12;

    ctx.font = '11px monospace';
    const text1 = `${speed.toFixed(1)} m/s`;
    const text2 = candidate.parentBody ? `Circ: ${candidate.circularSpeed.toFixed(1)} m/s` : '';
    const snapText = candidate.isSnappingCircular ? ' [CIRCULAR SNAPPED]' : '';

    const label = `${text1}${snapText} ${text2 ? `(${text2})` : ''}`;
    const metrics = ctx.measureText(label);
    const boxW = metrics.width + 12;
    const boxH = 22;

    ctx.fillStyle = 'rgba(15, 29, 48, 0.9)';
    ctx.strokeStyle = candidate.isSnappingCircular ? '#4ed99c' : '#38bdf8';
    ctx.lineWidth = 1;
    ctx.fillRect(badgeX, badgeY - 14, boxW, boxH);
    ctx.strokeRect(badgeX, badgeY - 14, boxW, boxH);

    ctx.fillStyle = candidate.isSnappingCircular ? '#4ed99c' : '#f8fafc';
    ctx.fillText(label, badgeX + 6, badgeY + 1);
  }

  ctx.restore();
}

function formatOrbitDistance(distMeters: number): string {
  if (distMeters >= 1_000_000) {
    return `${(distMeters / 1_000_000).toFixed(1)}M km`;
  }
  if (distMeters >= 10_000) {
    return `${(distMeters / 1000).toFixed(1)} km`;
  }
  if (distMeters >= 1_000) {
    return `${(distMeters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(distMeters)} m`;
}

function drawApsisBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: 'Ap' | 'Pe',
  radiusMeters: number,
  color: string,
  centerScr: Vec,
  isSelected: boolean,
): void {
  ctx.save();

  // 1. Target Reticle at (x, y)
  ctx.beginPath();
  ctx.arc(x, y, 4.0, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 1.5 : 1.0;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // 2. Radial outward vector from parent center
  const dx = x - centerScr.x;
  const dy = y - centerScr.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;

  // 3. Format badge text: "Ap · 25.4 km"
  const distStr = radiusMeters > 0 ? formatOrbitDistance(radiusMeters) : '';
  const tagText = type;
  const fullText = distStr ? `${tagText} · ${distStr}` : tagText;

  ctx.font = '600 10px monospace';
  const tagMetrics = ctx.measureText(tagText);
  const fullMetrics = ctx.measureText(fullText);

  const padX = 6;
  const badgeH = 17;
  const badgeW = fullMetrics.width + padX * 2;

  // Push outward along (nx, ny) away from parent body
  const offsetDist = 12;
  let badgeX = x + nx * offsetDist;
  let badgeY = y + ny * offsetDist - badgeH / 2;

  // Directional shift so the leader line connects cleanly to badge edge
  if (nx < -0.2) {
    badgeX -= badgeW;
  } else if (Math.abs(nx) <= 0.2) {
    badgeX -= badgeW / 2;
  }

  // Draw connecting leader tick
  const leaderStartX = x + nx * 4.5;
  const leaderStartY = y + ny * 4.5;
  const leaderEndX = nx < -0.2 ? badgeX + badgeW : (nx > 0.2 ? badgeX : badgeX + badgeW / 2);
  const leaderEndY = badgeY + badgeH / 2;

  ctx.beginPath();
  ctx.moveTo(leaderStartX, leaderStartY);
  ctx.lineTo(leaderEndX, leaderEndY);
  ctx.strokeStyle = `${color}80`;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Draw glassmorphic pill background
  ctx.fillStyle = 'rgba(8, 15, 25, 0.88)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
  } else {
    ctx.rect(badgeX, badgeY, badgeW, badgeH);
  }
  ctx.fill();

  // Pill border with subtle glow if selected
  ctx.strokeStyle = isSelected ? color : `${color}70`;
  ctx.lineWidth = isSelected ? 1.4 : 1.0;
  if (isSelected) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Text inside pill
  ctx.textBaseline = 'middle';
  const textY = badgeY + badgeH / 2 + 0.5;

  // Draw Tag (Ap in coral/red, Pe in cyan)
  ctx.fillStyle = color;
  ctx.fillText(tagText, badgeX + padX, textY);

  // Draw distance portion in crisp light-slate
  if (distStr) {
    const dotStr = ' · ';
    const dotW = ctx.measureText(dotStr).width;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
    ctx.fillText(dotStr, badgeX + padX + tagMetrics.width, textY);

    ctx.fillStyle = isSelected ? '#f8fafc' : '#cbd5e1';
    ctx.fillText(distStr, badgeX + padX + tagMetrics.width + dotW, textY);
  }

  ctx.restore();
}

function drawCollisionMarker(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
  ctx.fill();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = 'rgba(8, 15, 25, 0.9)';
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1;
  const label = '✕ IMPACT';
  ctx.font = 'bold 9px monospace';
  const metrics = ctx.measureText(label);
  const w = metrics.width + 10;
  const h = 16;
  const bx = x + 8;
  const by = y - h / 2;

  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(bx, by, w, h, 3);
  } else {
    ctx.rect(bx, by, w, h);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ef4444';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + 5, by + h / 2 + 0.5);
  ctx.restore();
}
