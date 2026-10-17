import { planet, type State, type Vec } from '../../sim-core/src/index';
import {
  type RenderBody, type RenderFrame, type RenderShip, type RenderTimer, type Renderer, type RendererFeatures,
  createProjector, hermiteControls, pathFromShip
} from './frame';
import { DEFAULT_SHADERS, ShaderStyle, validateShaderPack, type ShaderPack } from './shaders';
import { compileOverlayTextProgram, compileShaderPack, compileTerrainProgram, liteShaderPack, startProgram,
  type PendingProgram, type ShaderPrograms } from './shader-program';
import { overlayRgba, screenOverlays, type ScreenOverlay } from './overlay';
import { terrainGeometry, terrainFaceColor, type TerrainGeometry } from './terrain';
import { bodyUniformLocations, parseHex, setBodyUniforms, type BodyUniformLocations } from './scene-bodies';
import { createNoiseTexture } from './noise-texture';
import { BodyCrowd, LabelPlacer, circleSegments, labelRect } from './layout';
import { getActiveTheme, hexToRgb01, themeBackdropToShaderIndex, themeGridToShaderIndex } from './theme';

/** Unit circle vertex tables, built once per segment count. */
const UNIT_CIRCLES = new Map<number, Float64Array>();
function unitCircle(segments: number): Float64Array {
  let table = UNIT_CIRCLES.get(segments);
  if (!table) {
    table = new Float64Array(segments * 2);
    for (let s = 0; s < segments; s++) {
      const th = (s / segments) * 2 * Math.PI;
      table[s * 2] = Math.cos(th);
      table[s * 2 + 1] = Math.sin(th);
    }
    UNIT_CIRCLES.set(segments, table);
  }
  return table;
}
const WHITE: readonly [number, number, number] = [1, 1, 1];
const ROCK: readonly [number, number, number] = [0.6, 0.58, 0.55];
const ROCK_WRECK: readonly [number, number, number] = [0.94, 0.55, 0.48];

const SAMPLES_PER_SEGMENT = 8;
const HERMITE_BASIS_8 = new Float64Array(SAMPLES_PER_SEGMENT * 4);
for (let s = 0; s < SAMPLES_PER_SEGMENT; s++) {
  const u = s / SAMPLES_PER_SEGMENT;
  const u2 = u * u, u3 = u2 * u, om = 1 - u, om2 = om * om;
  HERMITE_BASIS_8[s * 4] = om2 * om;
  HERMITE_BASIS_8[s * 4 + 1] = 3 * om2 * u;
  HERMITE_BASIS_8[s * 4 + 2] = 3 * om * u2;
  HERMITE_BASIS_8[s * 4 + 3] = u3;
}

const LABEL_FONT = '11px ui-monospace, monospace';
const LABEL_PAD_X = 2;
const LABEL_CSS_H = 20;
const LABEL_BASELINE_Y = 14;
const MAX_LABEL_CACHE = 128;

interface LabelEntry {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly cssW: number;
  readonly cssH: number;
}

interface PendingBodyLabel {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly style: number;
}


const DEFAULT_BODY_LIST: readonly RenderBody[] = Object.freeze([{
  id: planet.id,
  name: 'PRIMUS',
  position: Object.freeze({ x: 0, y: 0 }),
  radius: planet.radius,
  color: '#233c47',
  accentColor: '#659497',
  atmosphereColor: '#29495380',
  surfaceFeatures: 'globe-lines' as const,
}]);

export class WebGLRenderer implements Renderer {
  private readonly gl!: WebGL2RenderingContext;
  private quadProgram!: WebGLProgram;
  private vectorProgram!: WebGLProgram;
  private textProgram!: WebGLProgram;
  private programs!: ShaderPrograms;
  private activeShaders = DEFAULT_SHADERS;
  private disposed = false;
  private readonly quadBuffer!: WebGLBuffer;
  private sceneTimeLoc: WebGLUniformLocation | null = null;
  private vectorTimeLoc: WebGLUniformLocation | null = null;
  private textTimeLoc: WebGLUniformLocation | null = null;
  private readonly quadVao!: WebGLVertexArrayObject;
  private readonly vectorVao!: WebGLVertexArrayObject;
  private readonly textVao!: WebGLVertexArrayObject;
  private readonly vectorBuffer!: WebGLBuffer;
  private readonly textBuffer!: WebGLBuffer;
  private quadResolutionLoc: WebGLUniformLocation | null = null;
  private quadBodyCountLoc: WebGLUniformLocation | null = null;
  private quadNoiseLoc: WebGLUniformLocation | null = null;
  private bgModeLoc: WebGLUniformLocation | null = null;
  private gridEnabledLoc: WebGLUniformLocation | null = null;
  private gridModeLoc: WebGLUniformLocation | null = null;
  private gridSpacingLoc: WebGLUniformLocation | null = null;
  private gridOpacityLoc: WebGLUniformLocation | null = null;
  private gridColorLoc: WebGLUniformLocation | null = null;
  private nebulaIntensityLoc: WebGLUniformLocation | null = null;
  private highQualityLoc: WebGLUniformLocation | null = null;
  private galaxiesVisibleLoc: WebGLUniformLocation | null = null;
  private worldSeedLoc: WebGLUniformLocation | null = null;
  private camCenterLoc: WebGLUniformLocation | null = null;
  private camScaleLoc: WebGLUniformLocation | null = null;
  private camRotationLoc: WebGLUniformLocation | null = null;
  private pendingScene: PendingProgram | undefined;
  private readonly noise!: WebGLTexture;
  private bodyUniforms: readonly BodyUniformLocations[] = [];
  private vecResolutionLoc: WebGLUniformLocation | null = null;
  private vecStyleLoc: WebGLUniformLocation | null = null;
  private textResolutionLoc: WebGLUniformLocation | null = null;
  private textStyleLoc: WebGLUniformLocation | null = null;
  private textTexLoc: WebGLUniformLocation | null = null;
  private readonly labelCanvas!: HTMLCanvasElement;
  private readonly labelCtx!: CanvasRenderingContext2D;
  private readonly labelCache = new Map<string, LabelEntry>();
  private readonly textQuadVerts = new Float32Array(24);
  private dynamicVerts = new Float32Array(4096);
  private dynamicCapacityFloats = 4096;
  private readonly terrainProgram: WebGLProgram;
  private readonly terrainResolution: WebGLUniformLocation | null;
  private readonly terrainVao: WebGLVertexArrayObject;
  private readonly terrainBuffer: WebGLBuffer;
  private terrainVerts = new Float32Array(4096);
  private readonly colorVao: WebGLVertexArrayObject;
  private readonly colorBuffer: WebGLBuffer;
  private colorVerts = new Float32Array(4096);
  private colorBufferFloats = 0;
  /** Private overlay text pass; compiled on the first module label. */
  private overlayText?: { readonly program: WebGLProgram; readonly resolution: WebGLUniformLocation | null;
    readonly color: WebGLUniformLocation | null; readonly texture: WebGLUniformLocation | null };
  /** Shader packs are this renderer's optional feature; callers never check its class. */
  readonly features: RendererFeatures;

  static isSupported(canvas: HTMLCanvasElement): boolean {
    try {
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: false });
      return !!gl;
    } catch {
      return false;
    }
  }

  constructor(private readonly canvas: HTMLCanvasElement, shaders: ShaderPack = DEFAULT_SHADERS) {
    const renderer = this;
    this.features = Object.freeze({ shaders: Object.freeze({
      get pack(): ShaderPack { return renderer.activeShaders; },
      set: (pack: ShaderPack): void => renderer.setShaderPack(pack),
    }) });
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: false });
    if (!gl) throw new Error('WebGL 2 is unavailable in this browser.');
    this.gl = gl;
    this.terrainProgram = compileTerrainProgram(gl);
    this.terrainResolution = gl.getUniformLocation(this.terrainProgram, 'u_resolution');
    this.terrainVao = gl.createVertexArray()!;
    this.terrainBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.terrainVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.terrainBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.terrainVerts.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    // Batched colored discs and dots share the private terrain program's vertex layout.
    this.colorVao = gl.createVertexArray()!;
    this.colorBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.colorVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);

    this.noise = createNoiseTexture(gl);

    const labelCanvas = canvas.ownerDocument.createElement('canvas');
    const labelCtx = labelCanvas.getContext('2d');
    if (!labelCtx) throw new Error('Canvas 2D is unavailable for WebGL text labels.');
    this.labelCanvas = labelCanvas;
    this.labelCtx = labelCtx;

    try {
      this.setShaderPack(shaders);
    } catch (error) {
      gl.deleteProgram(this.terrainProgram);
      gl.deleteBuffer(this.terrainBuffer);
      gl.deleteVertexArray(this.terrainVao);
      gl.deleteTexture(this.noise);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      throw error;
    }

    // Quad setup
    const quadVao = gl.createVertexArray()!;
    this.quadVao = quadVao;
    gl.bindVertexArray(quadVao);
    const quadBuf = gl.createBuffer()!;
    this.quadBuffer = quadBuf;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const aQuadPos = 0;
    gl.enableVertexAttribArray(aQuadPos);
    gl.vertexAttribPointer(aQuadPos, 2, gl.FLOAT, false, 0, 0);

    // Dynamic vector buffer setup
    const vectorVao = gl.createVertexArray()!;
    this.vectorVao = vectorVao;
    gl.bindVertexArray(vectorVao);
    const vectorBuf = gl.createBuffer()!;
    this.vectorBuffer = vectorBuf;
    gl.bindBuffer(gl.ARRAY_BUFFER, vectorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.dynamicVerts.byteLength, gl.DYNAMIC_DRAW);
    const aVecPos = 0;
    gl.enableVertexAttribArray(aVecPos);
    gl.vertexAttribPointer(aVecPos, 2, gl.FLOAT, false, 0, 0);

    // Text quad buffer setup (interleaved x, y, u, v)
    const textVao = gl.createVertexArray()!;
    this.textVao = textVao;
    gl.bindVertexArray(textVao);
    const textBuf = gl.createBuffer()!;
    this.textBuffer = textBuf;
    gl.bindBuffer(gl.ARRAY_BUFFER, textBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.textQuadVerts.byteLength, gl.DYNAMIC_DRAW);
    const aTextPos = 0;
    const aTextUv = 1;
    gl.enableVertexAttribArray(aTextPos);
    gl.vertexAttribPointer(aTextPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aTextUv);
    gl.vertexAttribPointer(aTextUv, 2, gl.FLOAT, false, 16, 8);

    gl.bindVertexArray(null);
  }

  get shaderPack(): ShaderPack { return this.activeShaders; }

  setShaderPack(value: ShaderPack): void {
    if (this.disposed) throw new Error('Renderer has been disposed.');
    const pack = validateShaderPack(value);
    const { gl } = this;
    // A big procedural scene can take a noticeable time to compile. Start drawing with its lite
    // build (plain discs) and switch to the full scene when the driver has finished it.
    const lite = liteShaderPack(pack);
    const next = compileShaderPack(gl, lite ?? pack);
    const previous = this.programs;
    this.pendingScene?.cancel();
    this.pendingScene = lite ? startProgram(gl, pack, 'scene') : undefined;
    this.programs = next;
    this.useScene(next.scene);
    this.vectorProgram = next.vector;
    this.textProgram = next.text;
    this.vecResolutionLoc = gl.getUniformLocation(this.vectorProgram, 'u_resolution');
    this.vecStyleLoc = gl.getUniformLocation(this.vectorProgram, 'u_style');
    this.textResolutionLoc = gl.getUniformLocation(this.textProgram, 'u_resolution');
    this.textStyleLoc = gl.getUniformLocation(this.textProgram, 'u_style');
    this.textTexLoc = gl.getUniformLocation(this.textProgram, 'u_tex');

    this.vectorTimeLoc = gl.getUniformLocation(next.vector, 'u_time');
    this.textTimeLoc = gl.getUniformLocation(next.text, 'u_time');
    this.activeShaders = pack;
    if (previous) for (const program of Object.values(previous)) gl.deleteProgram(program);
  }

  private useScene(program: WebGLProgram): void {
    const { gl } = this;
    this.quadProgram = program;
    this.quadResolutionLoc = gl.getUniformLocation(program, 'u_resolution');
    this.quadBodyCountLoc = gl.getUniformLocation(program, 'u_bodyCount');
    this.quadNoiseLoc = gl.getUniformLocation(program, 'u_noise');
    this.sceneTimeLoc = gl.getUniformLocation(program, 'u_time');
    this.bgModeLoc = gl.getUniformLocation(program, 'u_bgMode');
    this.gridEnabledLoc = gl.getUniformLocation(program, 'u_gridEnabled');
    this.gridModeLoc = gl.getUniformLocation(program, 'u_gridMode');
    this.gridSpacingLoc = gl.getUniformLocation(program, 'u_gridSpacing');
    this.gridOpacityLoc = gl.getUniformLocation(program, 'u_gridOpacity');
    this.gridColorLoc = gl.getUniformLocation(program, 'u_gridColor');
    this.nebulaIntensityLoc = gl.getUniformLocation(program, 'u_nebulaIntensity');
    this.highQualityLoc = gl.getUniformLocation(program, 'u_highQuality');
    this.galaxiesVisibleLoc = gl.getUniformLocation(program, 'u_galaxiesVisible');
    this.worldSeedLoc = gl.getUniformLocation(program, 'u_worldSeed');
    this.camCenterLoc = gl.getUniformLocation(program, 'u_camCenter');
    this.camScaleLoc = gl.getUniformLocation(program, 'u_camScale');
    this.camRotationLoc = gl.getUniformLocation(program, 'u_camRotation');
    const bodyUniforms: BodyUniformLocations[] = [];
    for (let i = 0; i < 8; i++) bodyUniforms.push(bodyUniformLocations(gl, program, i));
    this.bodyUniforms = bodyUniforms;
  }

  /** Swap in the full scene once its background compile is done; on failure keep the lite one. */
  private upgradeScene(): void {
    const pending = this.pendingScene;
    if (!pending?.ready()) return;
    this.pendingScene = undefined;
    try {
      const program = pending.finish();
      const lite = this.programs.scene;
      this.programs = { ...this.programs, scene: program };
      this.useScene(program);
      this.gl.deleteProgram(lite);
    } catch (error) {
      console.warn(`Detailed planets are unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const { gl } = this;
    gl.bindVertexArray(null);
    gl.useProgram(null);
    this.pendingScene?.cancel();
    for (const program of Object.values(this.programs)) gl.deleteProgram(program);
    gl.deleteProgram(this.terrainProgram);
    if (this.overlayText) gl.deleteProgram(this.overlayText.program);
    for (const vao of [this.quadVao, this.vectorVao, this.textVao, this.terrainVao, this.colorVao]) gl.deleteVertexArray(vao);
    for (const buffer of [this.quadBuffer, this.vectorBuffer, this.textBuffer, this.terrainBuffer, this.colorBuffer]) gl.deleteBuffer(buffer);
    for (const entry of this.labelCache.values()) gl.deleteTexture(entry.texture);
    this.labelCache.clear();
    gl.deleteTexture(this.noise);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  draw(frame: RenderFrame, timer?: RenderTimer): void {
    if (this.disposed) return;
    this.upgradeScene();
    const { canvas, gl } = this;
    const { state, camera, engine, bodies } = frame;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight);

    const toScreen = createProjector(camera, width, height);
    const labels = new LabelPlacer();
    // The piloted ship's own label always shows; everything else avoids it.
    const shipPos = frame.shipWorldPosition ?? state.position;
    const ship = toScreen(shipPos);
    const shipVisible = ship.x >= -40 && ship.x <= width + 40 && ship.y >= -40 && ship.y <= height + 40;
    const shipLabel = state.status === 'crashed' ? 'SIGNAL LOST' : frame.shipLabel ?? 'VESSEL 01';
    if (shipVisible) labels.reserve(labelRect(shipLabel, ship.x + 16, ship.y - 13, 'left'));

    // 1. Fullscreen Shader Pass (Stars + Celestial Bodies)
    gl.disable(gl.BLEND);
    gl.useProgram(this.quadProgram);
    const realTimeSec = (typeof performance !== 'undefined' ? performance.now() * 0.001 : state.time) % 3600;
    const animTime = (frame.theme?.animatedNebula ?? true) ? realTimeSec : 0.0;
    if (this.sceneTimeLoc) gl.uniform1f(this.sceneTimeLoc, animTime);
    if (this.vectorTimeLoc) {
      gl.useProgram(this.vectorProgram);
      gl.uniform1f(this.vectorTimeLoc, realTimeSec);
    }
    if (this.textTimeLoc) {
      gl.useProgram(this.textProgram);
      gl.uniform1f(this.textTimeLoc, realTimeSec);
    }
    if (this.vectorTimeLoc || this.textTimeLoc) gl.useProgram(this.quadProgram);
    gl.uniform2f(this.quadResolutionLoc, width, height);

    const bodyList = bodies && bodies.length > 0 ? bodies : DEFAULT_BODY_LIST;
    const cx = width * 0.5, cy = height * 0.5;
    const maxViewportDim = Math.max(width, height);

    // Visible bodies, largest first after any star: the scene shader has eight slots, which
    // go to the bodies that need its discs and atmospheres most. The rest (a full solar
    // system has hundreds of moons) are drawn as batched discs and dots below.
    const visible: { readonly b: RenderBody; readonly pos: Vec; readonly r: number; readonly isStar: boolean; readonly order: number }[] = [];
    const terrain: TerrainGeometry[] = [];
    for (let i = 0; i < bodyList.length; i++) {
      const b = bodyList[i]!;
      const pos = toScreen(b.position);
      const r = (b.surface?.bounds.maxRadius ?? b.radius) * camera.scale;
      const isStar = b.surfaceFeatures === 'star';
      const outer = r < 2.5
        ? (isStar ? 6 : 2.5)
        : (isStar ? r * 1.85 : (b.appearance?.style === 'banded' ? r * 2.45 : r + Math.min(120, Math.max(25, r * 0.08))));
      const clampX = Math.max(0, Math.min(width, pos.x));
      const clampY = Math.max(0, Math.min(height, pos.y));
      if ((pos.x - clampX) ** 2 + (pos.y - clampY) ** 2 > (outer + 8) ** 2) continue;
      if (b.surface && !isStar) terrain.push(terrainGeometry({ ...b, surface: b.surface }, camera, width, height));
      visible.push({ b, pos, r, isStar, order: i });
    }
    visible.sort((a, c) => (a.isStar === c.isStar ? c.r - a.r || a.order - c.order : a.isStar ? -1 : 1));

    let count = 0;
    const overflow: typeof visible = [];
    const theme = frame.theme ? { ...getActiveTheme(), ...frame.theme } : getActiveTheme();
    const worldSeed = (theme.shaderSeed && theme.shaderSeed !== 0)
      ? theme.shaderSeed
      : (frame.theme?.worldSeed ?? theme.worldSeed ?? 0.0);
    for (const v of visible) {
      const { b, pos, r, isStar } = v;
      if (b.surface && !isStar) continue;
      if (count >= 8) { overflow.push(v); continue; }
      setBodyUniforms(gl, this.bodyUniforms[count]!, b, pos, r, { x: cx, y: cy }, camera, worldSeed);
      count++;
    }
    gl.uniform1i(this.quadBodyCountLoc, count);
    if (this.bgModeLoc) gl.uniform1i(this.bgModeLoc, themeBackdropToShaderIndex(theme.backdropStyle));
    if (this.gridEnabledLoc) gl.uniform1i(this.gridEnabledLoc, theme.gridEnabled && theme.gridStyle !== 'off' ? 1 : 0);
    if (this.gridModeLoc) gl.uniform1i(this.gridModeLoc, themeGridToShaderIndex(theme.gridStyle));
    if (this.gridSpacingLoc) gl.uniform1f(this.gridSpacingLoc, theme.gridSpacing || 80);
    if (this.gridOpacityLoc) gl.uniform1f(this.gridOpacityLoc, theme.gridOpacity ?? 0.45);
    if (this.gridColorLoc) {
      const gc = hexToRgb01(theme.gridColor || '#38bdf8');
      gl.uniform3f(this.gridColorLoc, gc.r, gc.g, gc.b);
    }
    if (this.nebulaIntensityLoc) gl.uniform1f(this.nebulaIntensityLoc, theme.nebulaVisible ? (theme.nebulaIntensity ?? 1.0) : 0.0);
    if (this.highQualityLoc) gl.uniform1i(this.highQualityLoc, theme.highQuality !== false ? 1 : 0);
    if (this.galaxiesVisibleLoc) gl.uniform1i(this.galaxiesVisibleLoc, theme.galaxiesVisible !== false ? 1 : 0);
    if (this.worldSeedLoc) gl.uniform1f(this.worldSeedLoc, worldSeed);
    if (this.camCenterLoc) gl.uniform2f(this.camCenterLoc, camera.center.x, camera.center.y);
    if (this.camScaleLoc) gl.uniform1f(this.camScaleLoc, camera.scale);
    if (this.camRotationLoc) gl.uniform1f(this.camRotationLoc, camera.rotation);

    // Unit 1 keeps the noise lattice clear of the label textures on unit 0.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.noise);
    gl.uniform1i(this.quadNoiseLoc, 1);
    gl.activeTexture(gl.TEXTURE0);

    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    timer?.lap('background');

    // 2. Vector & Text Passes
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    for (const geometry of terrain) this.drawTerrain(geometry, width, height);
    if (overflow.length) this.drawBodyBatch(overflow, width, height);

    this.beginVectorPass(width, height);
    this.drawOrbitRings(bodyList, toScreen, camera.scale, width, height);

    // Body labels in priority order (stars, then by size); crowded ones are left out.
    const bodyLabels: PendingBodyLabel[] = [];
    const crowd = new BodyCrowd();
    for (const { b, pos, r, isStar } of visible) {
      if (!crowd.admit(pos.x, pos.y, r) || r > maxViewportDim * 0.9) continue;
      const text = b.name.toUpperCase();
      const labelY = r < 2.5
        ? (isStar ? pos.y - 10 : pos.y - 7)
        : (r > 30 ? pos.y - r - 8 : pos.y + Math.min(r + 14, 24));
      if (!labels.tryPlace(labelRect(text, pos.x, labelY, 'center'))) continue;
      bodyLabels.push({ text, x: pos.x, y: labelY, style: isStar ? ShaderStyle.starLabel : ShaderStyle.bodyLabel });
    }
    if (bodyLabels.length > 0) {
      this.beginTextPass(width, height);
      for (const lbl of bodyLabels) this.drawLabel(lbl.text, lbl.x, lbl.y, lbl.style, 'center', dpr);
      this.beginVectorPass(width, height);
    }
    timer?.lap('planet');

    // Ghost Path
    this.drawPath(frame);
    let verts = this.dynamicVerts;
    timer?.lap('path');

    // Launch pad
    const padPos = frame.padPosition ?? { x: 0, y: planet.radius };
    const pad = toScreen(padPos);
    const padAngle = frame.padNormal ? Math.atan2(frame.padNormal.y, frame.padNormal.x) + camera.rotation : Math.PI / 2;
    const padX = Math.sin(padAngle) * 7, padY = Math.cos(padAngle) * 7;
    if (pad.x >= -20 && pad.x <= width + 20 && pad.y >= -20 && pad.y <= height + 20) {
      verts[0] = pad.x - padX; verts[1] = pad.y - padY;
      verts[2] = pad.x + padX; verts[3] = pad.y + padY;
      this.uploadAndDraw(2, gl.LINES, ShaderStyle.pad);
    }

    // Other vessels beneath the piloted one, batched by drawing role, then the piloted ship
    const others = frame.ships ?? [];
    const shipLabels: { readonly text: string; readonly x: number; readonly y: number }[] = [];
    if (others.length) {
      if (others.some(o => o.rock)) {
        this.drawRockBatch(others, toScreen, width, height);
        this.beginVectorPass(width, height);
      }
      this.drawShipBatch(others, toScreen, camera.rotation, width, height);
      for (const other of others) {
        if (other.rock) continue;
        const at = toScreen(other.position);
        if (at.x < -40 || at.x > width + 40 || at.y < -40 || at.y > height + 40) continue;
        const text = other.status === 'crashed' ? `${other.label} · LOST` : other.label;
        if (labels.tryPlace(labelRect(text, at.x + 13, at.y - 11, 'left'))) shipLabels.push({ text, x: at.x + 13, y: at.y - 11 });
      }
      if (shipLabels.length) {
        this.beginTextPass(width, height);
        for (const l of shipLabels) this.drawLabel(l.text, l.x, l.y, ShaderStyle.telemetryLabel, 'left', dpr);
        this.beginVectorPass(width, height);
      }
    }
    verts = this.dynamicVerts;
    if (shipVisible) {
      this.drawShip(ship, -state.heading - camera.rotation, 1, state.status, engine, state.throttle, ShaderStyle.ship);
      this.beginTextPass(width, height);
      this.drawLabel(shipLabel, ship.x + 16, ship.y - 13, ShaderStyle.telemetryLabel, 'left', dpr);
      this.beginVectorPass(width, height);
    }
    timer?.lap('ship');

    // Telemetry scale bar & overlay labels
    verts = this.dynamicVerts;
    const metres = 10 ** Math.floor(Math.log10(100 / camera.scale));
    const pixels = metres * camera.scale;
    const barY = height - 27;
    verts[0] = width - 24 - pixels; verts[1] = barY;
    verts[2] = width - 24; verts[3] = barY;
    this.uploadAndDraw(2, gl.LINES, ShaderStyle.scale);

    this.beginTextPass(width, height);
    this.drawLabel(`${metres} m`, width - 24, height - 36, ShaderStyle.telemetryLabel, 'right', dpr);
    if (frame.overlays?.length) this.drawOverlays(screenOverlays(frame.overlays, camera, width, height), width, height, dpr);
    timer?.lap('overlay');

    gl.bindVertexArray(null);
  }

  /** Every moon's orbit ring in one LINES draw, each with just enough segments for its size. */
  private drawOrbitRings(bodyList: readonly RenderBody[], toScreen: (p: Vec) => Vec, scale: number,
    width: number, height: number): void {
    const cx = width * 0.5, cy = height * 0.5;
    const maxCorner = Math.hypot(cx, cy), maxViewportDim = Math.max(width, height);
    let floats = 0;
    const rings: { readonly x: number; readonly y: number; readonly r: number; readonly n: number }[] = [];
    for (const b of bodyList) {
      if (!b.parentPosition || !b.orbitRadius) continue;
      const parentScreen = toScreen(b.parentPosition);
      const r = b.orbitRadius * scale;
      if (r <= 1) continue;
      // Cull if the ring does not intersect the viewport at all
      if (Math.abs(Math.hypot(parentScreen.x - cx, parentScreen.y - cy) - r) > maxCorner + 10) continue;
      const n = r > maxViewportDim * 2 ? 1 : circleSegments(r);
      rings.push({ x: parentScreen.x, y: parentScreen.y, r, n });
      floats += n * 4;
    }
    if (!rings.length) return;
    const verts = this.ensureCapacity(floats);
    let i = 0;
    for (const { x, y, r, n } of rings) {
      if (n === 1) {
        // A ring far larger than the screen is a straight tangent line here.
        const theta0 = Math.atan2(cy - y, cx - x);
        const cos0 = Math.cos(theta0), sin0 = Math.sin(theta0);
        const p0x = x + cos0 * r, p0y = y + sin0 * r, span = maxCorner + 30;
        verts[i++] = p0x + sin0 * span; verts[i++] = p0y - cos0 * span;
        verts[i++] = p0x - sin0 * span; verts[i++] = p0y + cos0 * span;
        continue;
      }
      const circle = unitCircle(n);
      for (let s = 0; s < n; s++) {
        const t = (s + 1) % n;
        verts[i++] = x + circle[s * 2]! * r; verts[i++] = y + circle[s * 2 + 1]! * r;
        verts[i++] = x + circle[t * 2]! * r; verts[i++] = y + circle[t * 2 + 1]! * r;
      }
    }
    this.uploadAndDraw(i / 2, this.gl.LINES, ShaderStyle.orbit);
  }

  /** Bodies beyond the scene shader's slots: discs with an accent rim, and marker dots for
   * bodies smaller than a few pixels, in two draws of the private colored pass. */
  private drawBodyBatch(list: readonly { readonly b: RenderBody; readonly pos: Vec; readonly r: number; readonly isStar: boolean }[],
    width: number, height: number): void {
    const { gl } = this;
    let triangles = 0, lines = 0;
    for (const { r } of list) {
      const n = r < 2.5 ? 8 : circleSegments(Math.min(r, 4096));
      triangles += n * 3;
      if (r >= 2.5) lines += n * 2;
    }
    const total = (triangles + lines) * 6;
    if (total > this.colorVerts.length) this.colorVerts = new Float32Array(2 ** Math.ceil(Math.log2(total)));
    const data = this.colorVerts;
    let i = 0;
    const vertex = (x: number, y: number, c: readonly number[], a: number): void => {
      data[i++] = x; data[i++] = y; data[i++] = c[0]!; data[i++] = c[1]!; data[i++] = c[2]!; data[i++] = a;
    };
    // Triangles first (fills), then the rims as lines.
    for (const { b, pos, r, isStar } of list) {
      const dot = r < 2.5;
      const radius = dot ? (isStar ? 3 : 2.5) : Math.min(r, 1e6);
      const n = dot ? 8 : circleSegments(Math.min(r, 4096));
      const color = dot ? (isStar ? WHITE : parseHex(b.accentColor ?? '#8ddbc1')) : parseHex(b.color ?? '#233c47');
      const circle = unitCircle(n);
      for (let s = 0; s < n; s++) {
        const t = (s + 1) % n;
        vertex(pos.x, pos.y, color, 1);
        vertex(pos.x + circle[s * 2]! * radius, pos.y + circle[s * 2 + 1]! * radius, color, 1);
        vertex(pos.x + circle[t * 2]! * radius, pos.y + circle[t * 2 + 1]! * radius, color, 1);
      }
    }
    const fillVertices = i / 6;
    for (const { b, pos, r } of list) {
      if (r < 2.5) continue;
      const n = circleSegments(Math.min(r, 4096));
      const accent = parseHex(b.horizonColor ?? b.accentColor ?? '#659497');
      const circle = unitCircle(n);
      for (let s = 0; s < n; s++) {
        const t = (s + 1) % n;
        vertex(pos.x + circle[s * 2]! * r, pos.y + circle[s * 2 + 1]! * r, accent, 1);
        vertex(pos.x + circle[t * 2]! * r, pos.y + circle[t * 2 + 1]! * r, accent, 1);
      }
    }
    gl.useProgram(this.terrainProgram);
    gl.uniform2f(this.terrainResolution, width, height);
    gl.bindVertexArray(this.colorVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    if (this.colorBufferFloats < data.length) {
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      this.colorBufferFloats = data.length;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, i);
    gl.drawArrays(gl.TRIANGLES, 0, fillVertices);
    if (i / 6 > fillVertices) gl.drawArrays(gl.LINES, fillVertices, i / 6 - fillVertices);
  }

  /** Asteroids as small gray hexagons (wrecked ones reddish) in one colored draw. */
  private drawRockBatch(others: readonly RenderShip[], toScreen: (p: Vec) => Vec, width: number, height: number): void {
    const { gl } = this;
    let rocks = 0;
    for (const o of others) if (o.rock) rocks++;
    const floats = rocks * 18 * 6;
    if (floats > this.colorVerts.length) this.colorVerts = new Float32Array(2 ** Math.ceil(Math.log2(floats)));
    const data = this.colorVerts, hexagon = unitCircle(6);
    let i = 0;
    for (const o of others) {
      if (!o.rock) continue;
      const at = toScreen(o.position);
      if (at.x < -8 || at.x > width + 8 || at.y < -8 || at.y > height + 8) continue;
      const color = o.status === 'crashed' ? ROCK_WRECK : ROCK;
      for (let s = 0; s < 6; s++) {
        const t = (s + 1) % 6;
        for (const [x, y] of [[at.x, at.y], [at.x + hexagon[s * 2]! * 2.2, at.y + hexagon[s * 2 + 1]! * 2.2],
          [at.x + hexagon[t * 2]! * 2.2, at.y + hexagon[t * 2 + 1]! * 2.2]] as const) {
          data[i++] = x; data[i++] = y; data[i++] = color[0]; data[i++] = color[1]; data[i++] = color[2]; data[i++] = 0.9;
        }
      }
    }
    if (!i) return;
    gl.useProgram(this.terrainProgram);
    gl.uniform2f(this.terrainResolution, width, height);
    gl.bindVertexArray(this.colorVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    if (this.colorBufferFloats < data.length) {
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      this.colorBufferFloats = data.length;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, i);
    gl.drawArrays(gl.TRIANGLES, 0, i / 6);
  }

  /** All other vessels in at most five draws (flames, three body styles, outlines). */
  private drawShipBatch(others: readonly RenderShip[], toScreen: (p: Vec) => Vec, rotation: number,
    width: number, height: number): void {
    const { gl } = this;
    let visible = 0;
    const placed: { readonly x: number; readonly y: number; readonly c: number; readonly s: number; readonly ship: RenderShip }[] = [];
    for (const other of others) {
      if (other.rock) continue;
      const at = toScreen(other.position);
      if (at.x < -40 || at.x > width + 40 || at.y < -40 || at.y > height + 40) continue;
      const angle = -other.heading - rotation;
      placed.push({ x: at.x, y: at.y, c: Math.cos(angle) * 0.8, s: Math.sin(angle) * 0.8, ship: other });
      visible++;
    }
    if (!visible) return;
    // Worst case per ship: 3 flame + 6 body + 8 outline vertices.
    const verts = this.ensureCapacity(visible * 17 * 2);
    const styles = [ShaderStyle.fleetShip, ShaderStyle.foreignShip, ShaderStyle.crashedShip];
    const draw = (from: number, to: number, mode: number, style: number): void => {
      if (to > from) {
        gl.uniform1i(this.vecStyleLoc, style);
        gl.drawArrays(mode, from / 2, (to - from) / 2);
      }
    };
    let i = 0;
    const point = (p: typeof placed[number], x: number, y: number): void => {
      verts[i++] = p.x + x * p.c - y * p.s;
      verts[i++] = p.y + x * p.s + y * p.c;
    };
    const flameStart = i;
    for (const p of placed) {
      if (!p.ship.engine || p.ship.status !== 'flying') continue;
      point(p, -7, -3); point(p, -15 - p.ship.throttle * 15, 0); point(p, -7, 3);
    }
    const flameEnd = i;
    const bodyRanges: [number, number][] = [];
    for (const style of styles) {
      const from = i;
      for (const p of placed) {
        const own = p.ship.status === 'crashed' ? ShaderStyle.crashedShip
          : p.ship.foreign ? ShaderStyle.foreignShip : ShaderStyle.fleetShip;
        if (own !== style) continue;
        // The four-point hull as two triangles (the fan 0-1-2, 0-2-3).
        point(p, 11, 0); point(p, -7, -6); point(p, -4, 0);
        point(p, 11, 0); point(p, -4, 0); point(p, -7, 6);
      }
      bodyRanges.push([from, i]);
    }
    const outlineStart = i;
    for (const p of placed) {
      point(p, 11, 0); point(p, -7, -6);
      point(p, -7, -6); point(p, -4, 0);
      point(p, -4, 0); point(p, -7, 6);
      point(p, -7, 6); point(p, 11, 0);
    }
    const outlineEnd = i;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts, 0, i);
    draw(flameStart, flameEnd, gl.TRIANGLES, ShaderStyle.flame);
    styles.forEach((style, k) => draw(bodyRanges[k]![0], bodyRanges[k]![1], gl.TRIANGLES, style));
    draw(outlineStart, outlineEnd, gl.LINES, ShaderStyle.outline);
  }

  /** One vessel: optional flame, body and outline, at a screen position and angle. */
  private drawShip(at: Vec, angle: number, size: number, status: State['status'], engine: boolean, throttle: number, style: number): void {
    const { gl } = this;
    const verts = this.dynamicVerts;
    const cosA = Math.cos(angle) * size, sinA = Math.sin(angle) * size;
    const point = (i: number, x: number, y: number): void => {
      verts[i * 2] = at.x + x * cosA - y * sinA;
      verts[i * 2 + 1] = at.y + x * sinA + y * cosA;
    };
    if (engine && status === 'flying') {
      point(0, -7, -3); point(1, -15 - throttle * 15, 0); point(2, -7, 3);
      this.uploadAndDraw(3, gl.TRIANGLES, ShaderStyle.flame);
    }
    point(0, 11, 0); point(1, -7, -6); point(2, -4, 0); point(3, -7, 6);
    this.uploadAndDraw(4, gl.TRIANGLE_FAN, status === 'crashed' ? ShaderStyle.crashedShip : style);
    this.uploadAndDraw(4, gl.LINE_LOOP, ShaderStyle.outline);
  }

  private beginVectorPass(width: number, height: number): void {
    const { gl } = this;
    gl.useProgram(this.vectorProgram);
    gl.uniform2f(this.vecResolutionLoc, width, height);
    gl.bindVertexArray(this.vectorVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vectorBuffer);
  }

  private drawTerrain(geometry: TerrainGeometry, width: number, height: number): void {
    const { gl } = this;
    gl.useProgram(this.terrainProgram);
    gl.uniform2f(this.terrainResolution, width, height);
    gl.bindVertexArray(this.terrainVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.terrainBuffer);
    const count = geometry.faces.reduce((sum, f) => sum + (f.points.length - 2) * 3, 0);
    const lineCount = geometry.edge.length * 2 + geometry.accents.reduce((sum, line) => sum + (line.length - 1) * 2, 0);
    const floats = (count + lineCount) * 6;
    if (floats > this.terrainVerts.length) {
      this.terrainVerts = new Float32Array(2 ** Math.ceil(Math.log2(floats)));
      gl.bufferData(gl.ARRAY_BUFFER, this.terrainVerts.byteLength, gl.DYNAMIC_DRAW);
    }
    let index = 0;
    const vertex = (p: { x: number; y: number }, color: readonly number[]) => {
      this.terrainVerts[index++] = p.x; this.terrainVerts[index++] = p.y;
      for (const c of color) this.terrainVerts[index++] = c;
    };
    for (const f of geometry.faces) for (let j = 1; j < f.points.length - 1; j++) {
      for (const p of [f.points[0]!, f.points[j]!, f.points[j + 1]!]) vertex(p, terrainFaceColor(f, p));
    }
    for (const [a, b] of geometry.edge) { vertex(a, geometry.accentColor); vertex(b, geometry.accentColor); }
    const faint = [...geometry.accentColor]; faint[3] = .24;
    for (const line of geometry.accents) for (let j = 1; j < line.length; j++) {
      vertex(line[j - 1]!, faint); vertex(line[j]!, faint);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.terrainVerts, 0, index);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.drawArrays(gl.LINES, count, lineCount);
  }

  private beginTextPass(width: number, height: number): void {
    const { gl } = this;
    gl.useProgram(this.textProgram);
    gl.uniform2f(this.textResolutionLoc, width, height);
    gl.uniform1i(this.textTexLoc, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.textVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textBuffer);
  }

  private getLabelEntry(text: string, dpr: number): LabelEntry {
    const key = `${text}@${dpr}`;
    const existing = this.labelCache.get(key);
    if (existing) {
      this.labelCache.delete(key);
      this.labelCache.set(key, existing);
      return existing;
    }

    const { gl, labelCanvas, labelCtx } = this;
    let texture: WebGLTexture;
    if (this.labelCache.size >= MAX_LABEL_CACHE) {
      const oldestKey = this.labelCache.keys().next().value!;
      const oldest = this.labelCache.get(oldestKey)!;
      this.labelCache.delete(oldestKey);
      texture = oldest.texture;
    } else {
      texture = gl.createTexture()!;
    }

    labelCtx.font = LABEL_FONT;
    const width = labelCtx.measureText(text).width;
    const cssW = Math.max(4, Math.ceil(width) + LABEL_PAD_X * 2);
    const cssH = LABEL_CSS_H;
    const pw = Math.max(1, Math.round(cssW * dpr));
    const ph = Math.max(1, Math.round(cssH * dpr));

    labelCanvas.width = pw;
    labelCanvas.height = ph;
    labelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    labelCtx.font = LABEL_FONT;
    labelCtx.fillStyle = '#ffffff';
    labelCtx.textAlign = 'left';
    labelCtx.textBaseline = 'alphabetic';
    labelCtx.fillText(text, LABEL_PAD_X, LABEL_BASELINE_Y);

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, labelCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const entry: LabelEntry = { texture, width, cssW, cssH };
    this.labelCache.set(key, entry);
    return entry;
  }

  private drawLabel(
    text: string,
    x: number,
    y: number,
    style: number,
    align: 'left' | 'center' | 'right',
    dpr: number,
  ): void {
    this.gl.uniform1i(this.textStyleLoc, style);
    this.drawLabelQuad(text, x, y, align, dpr);
  }

  /** One cached glyph texture as a quad, through whichever text program is bound. */
  private drawLabelQuad(text: string, x: number, y: number, align: 'left' | 'center' | 'right', dpr: number): void {
    const { gl, textQuadVerts } = this;
    const entry = this.getLabelEntry(text, dpr);

    let anchorX = x;
    if (align === 'center') anchorX = x - entry.width * 0.5;
    else if (align === 'right') anchorX = x - entry.width;

    const x0 = Math.round((anchorX - LABEL_PAD_X) * dpr) / dpr;
    const y0 = Math.round((y - LABEL_BASELINE_Y) * dpr) / dpr;
    const x1 = x0 + entry.cssW;
    const y1 = y0 + entry.cssH;

    textQuadVerts[0] = x0; textQuadVerts[1] = y0; textQuadVerts[2] = 0; textQuadVerts[3] = 0;
    textQuadVerts[4] = x1; textQuadVerts[5] = y0; textQuadVerts[6] = 1; textQuadVerts[7] = 0;
    textQuadVerts[8] = x0; textQuadVerts[9] = y1; textQuadVerts[10] = 0; textQuadVerts[11] = 1;
    textQuadVerts[12] = x0; textQuadVerts[13] = y1; textQuadVerts[14] = 0; textQuadVerts[15] = 1;
    textQuadVerts[16] = x1; textQuadVerts[17] = y0; textQuadVerts[18] = 1; textQuadVerts[19] = 0;
    textQuadVerts[20] = x1; textQuadVerts[21] = y1; textQuadVerts[22] = 1; textQuadVerts[23] = 1;

    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, textQuadVerts);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Module overlays: every shape in order in one draw of the private colored pass, then every
   * label in order through the private overlay-label pass, so shader packs never restyle
   * module output and text stays readable. Few state changes: WebGL calls are costly. */
  private drawOverlays(items: readonly ScreenOverlay[], width: number, height: number, dpr: number): void {
    const { gl } = this;
    let data = this.colorVerts, i = 0;
    const reserve = (floats: number): void => {
      if (i + floats <= data.length) return;
      const next = new Float32Array(2 ** Math.ceil(Math.log2(i + floats)));
      next.set(data.subarray(0, i));
      data = this.colorVerts = next;
    };
    const vertex = (x: number, y: number, c: readonly number[]): void => {
      data[i++] = x; data[i++] = y; data[i++] = c[0]!; data[i++] = c[1]!; data[i++] = c[2]!; data[i++] = c[3]!;
    };
    const segment = (ax: number, ay: number, bx: number, by: number, half: number, c: readonly number[]): void => {
      const length = Math.hypot(bx - ax, by - ay);
      if (!length) return;
      const nx = -(by - ay) / length * half, ny = (bx - ax) / length * half;
      reserve(36);
      vertex(ax + nx, ay + ny, c); vertex(ax - nx, ay - ny, c); vertex(bx + nx, by + ny, c);
      vertex(bx + nx, by + ny, c); vertex(ax - nx, ay - ny, c); vertex(bx - nx, by - ny, c);
    };
    let labels = 0;
    for (const item of items) {
      if (item.kind === 'text') { labels++; continue; }
      const c = overlayRgba(item.color);
      if (item.kind === 'line') {
        for (let k = 1; k < item.points.length; k++) {
          const a = item.points[k - 1]!, b = item.points[k]!;
          segment(a.x, a.y, b.x, b.y, item.width / 2, c);
        }
      } else if (item.kind === 'polygon') {
        // Fan around the centroid: the clipped shapes are convex or star-shaped about it.
        let cx = 0, cy = 0;
        for (const q of item.points) { cx += q.x; cy += q.y; }
        cx /= item.points.length; cy /= item.points.length;
        reserve(item.points.length * 18);
        for (let k = 0; k < item.points.length; k++) {
          const a = item.points[k]!, b = item.points[(k + 1) % item.points.length]!;
          vertex(cx, cy, c); vertex(a.x, a.y, c); vertex(b.x, b.y, c);
        }
      } else {
        // Smooth at the device resolution: module markers are small but often sharp-edged.
        const n = Math.max(32, circleSegments(item.radius * dpr)), circle = unitCircle(n), { x, y } = item.center, r = item.radius;
        if (item.fill) reserve(n * 18);
        for (let s = 0; s < n; s++) {
          const t = (s + 1) % n;
          const ax = x + circle[s * 2]! * r, ay = y + circle[s * 2 + 1]! * r;
          const bx = x + circle[t * 2]! * r, by = y + circle[t * 2 + 1]! * r;
          if (item.fill) { vertex(x, y, c); vertex(ax, ay, c); vertex(bx, by, c); }
          else segment(ax, ay, bx, by, item.width / 2, c);
        }
      }
    }
    if (i) {
      gl.useProgram(this.terrainProgram);
      gl.uniform2f(this.terrainResolution, width, height);
      gl.bindVertexArray(this.colorVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
      if (this.colorBufferFloats < data.length) {
        gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
        this.colorBufferFloats = data.length;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, i);
      gl.drawArrays(gl.TRIANGLES, 0, i / 6);
    }
    if (!labels) return;
    const text = this.overlayText ??= this.createOverlayText();
    gl.useProgram(text.program);
    gl.uniform2f(text.resolution, width, height);
    gl.uniform1i(text.texture, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.textVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textBuffer);
    for (const item of items) {
      if (item.kind !== 'text') continue;
      gl.uniform4f(text.color, ...overlayRgba(item.color));
      this.drawLabelQuad(item.text, item.at.x, item.at.y, item.align, dpr);
    }
  }

  private createOverlayText(): NonNullable<WebGLRenderer['overlayText']> {
    const { gl } = this;
    const program = compileOverlayTextProgram(gl);
    return { program, resolution: gl.getUniformLocation(program, 'u_resolution'),
      color: gl.getUniformLocation(program, 'u_color'), texture: gl.getUniformLocation(program, 'u_tex') };
  }

  private ensureCapacity(floatCount: number): Float32Array {
    if (floatCount > this.dynamicCapacityFloats) {
      let next = this.dynamicCapacityFloats;
      while (next < floatCount) next *= 2;
      this.dynamicVerts = new Float32Array(next);
      this.dynamicCapacityFloats = next;
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vectorBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.dynamicVerts.byteLength, this.gl.DYNAMIC_DRAW);
    }
    return this.dynamicVerts;
  }

  private uploadAndDraw(vertexCount: number, mode: number, style: number): void {
    const { gl } = this;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.dynamicVerts, 0, vertexCount * 2);
    gl.uniform1i(this.vecStyleLoc, style);
    gl.drawArrays(mode, 0, vertexCount);
  }

  private drawPath({ state, path, pathClosed, camera, pathOrigin }: RenderFrame): void {
    const origin = pathOrigin ?? { x: 0, y: 0 };
    const { points } = pathFromShip(path, pathClosed,
      { time: state.time, position: state.position, velocity: state.velocity });
    if (points.length < 2) return;

    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    const halfW = width * 0.5, halfH = height * 0.5, scale = camera.scale;
    const c = Math.cos(camera.rotation), s = Math.sin(camera.rotation);
    const ox = origin.x - camera.center.x, oy = origin.y - camera.center.y;

    const totalVertices = points.slice(1).reduce((n, p) => n + (p.linear ? 1 : SAMPLES_PER_SEGMENT), 1);
    const verts = this.ensureCapacity(totalVertices * 2);
    let idx = 0;
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1]!, p3 = points[i]!;
      if (p3.linear) {
        const lx = ox + p0.position.x, ly = oy + p0.position.y;
        verts[idx++] = halfW + (lx * c - ly * s) * scale;
        verts[idx++] = halfH - (lx * s + ly * c) * scale;
        continue;
      }
      const [c1, c2] = hermiteControls(p0, p3);
      for (let step = 0; step < SAMPLES_PER_SEGMENT; step++) {
        const bIdx = step * 4;
        const b0 = HERMITE_BASIS_8[bIdx]!, b1 = HERMITE_BASIS_8[bIdx + 1]!;
        const b2 = HERMITE_BASIS_8[bIdx + 2]!, b3 = HERMITE_BASIS_8[bIdx + 3]!;
        const lx = ox + b0 * p0.position.x + b1 * c1.x + b2 * c2.x + b3 * p3.position.x;
        const ly = oy + b0 * p0.position.y + b1 * c1.y + b2 * c2.y + b3 * p3.position.y;
        verts[idx++] = halfW + (lx * c - ly * s) * scale;
        verts[idx++] = halfH - (lx * s + ly * c) * scale;
      }
    }
    const lastPos = points[points.length - 1]!.position;
    const lastLx = ox + lastPos.x, lastLy = oy + lastPos.y;
    verts[idx++] = halfW + (lastLx * c - lastLy * s) * scale;
    verts[idx++] = halfH - (lastLx * s + lastLy * c) * scale;

    this.uploadAndDraw(totalVertices, this.gl.LINE_STRIP, ShaderStyle.path);
  }
}
