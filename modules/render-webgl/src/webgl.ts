import { AirMesh, createTileChunkRevisions, validateTileChunkProfile } from '@space-sim/game-api';
import { trajectoryMarkers, VEHICLE_MARKER, vehicleArtworkScale, type Camera, type OverlayPrimitive, type VehicleAppearance } from '@space-sim/game-api';
import { Effects } from './effects';
import type { State, Vec, SceneFrame, RenderMaterial, RenderPostEffect } from '@space-sim/game-api';
import { sceneFrame, type RendererPorts } from './ports';
import {
  type RenderBody, type RenderFrame, type RenderShip, type RenderTimer, type Renderer, type RendererFeatures,
  createProjector, hermiteControls, pathFromShip
} from './frame';
import { ShaderStyle, validateShaderPack, type ShaderPack } from './shaders';
import { compileOverlayTextProgram, compileShaderPack, compileTerrainProgram, compileTileChunkProgram, liteShaderPack, startProgram,
  type PendingProgram, type ShaderPrograms } from './shader-program';
import { overlayRgba, screenOverlays, type ScreenOverlay } from './overlay';
import { terrainGeometry, terrainFaceColor, type TerrainGeometry } from './terrain';
import { SurfaceAtlasPass } from './surface-atlas';
import { PlanetMapPass } from './planet-map-pass';
import { bodyUniformLocations, parseHex, setBodyUniforms, type BodyUniformLocations } from './scene-bodies';
import { createNoiseTexture } from './noise-texture';
import { BodyCrowd, LabelPlacer, circleSegments, labelRect } from './layout';
import { createTilePaletteTexture, hexToRgb01, themeBackdropToShaderIndex, themeGridToShaderIndex } from './palette';

const DEFAULT_ZERO_WALLS = new Uint16Array(1024);
const DEFAULT_NIBBLE_LIGHT = new Uint8Array(1024).fill(15);
const DEFAULT_FULL_LIGHT = new Uint8Array(1024).fill(255);

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


export class WebGLRenderer implements Renderer {
  private readonly gl!: WebGL2RenderingContext;
  private quadProgram!: WebGLProgram;
  private vectorProgram!: WebGLProgram;
  private textProgram!: WebGLProgram;
  private programs!: ShaderPrograms;
  private activeShaders: ShaderPack;
  private effects: Effects;
  private disposed = false;
  private readonly quadBuffer!: WebGLBuffer;
  private sceneTimeLoc: WebGLUniformLocation | null = null;
  private nebulaTimeLoc: WebGLUniformLocation | null = null;
  private starsVisibleLoc: WebGLUniformLocation | null = null;
  private starDensityLoc: WebGLUniformLocation | null = null;
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
  private needsFullScene = false;
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
  private airMesh?: AirMesh;
  private terrainVerts = new Float32Array(4096);
  private surfaceAtlas?: SurfaceAtlasPass;
  private surfaceAtlasFailed = false;
  private planetMapPass?: PlanetMapPass;
  private planetMapFailed = false;
  private readonly colorVao: WebGLVertexArrayObject;
  private readonly colorBuffer: WebGLBuffer;
  private colorVerts = new Float32Array(4096);
  private colorBufferFloats = 0;
  /** Private overlay text pass; compiled on the first module label. */
  private overlayText?: { readonly program: WebGLProgram; readonly resolution: WebGLUniformLocation | null;
    readonly color: WebGLUniformLocation | null; readonly texture: WebGLUniformLocation | null };
  /** Private instanced tile chunk pass; compiled on the first tile-chunk primitive. */
  private tileChunkState?: {
    readonly program: WebGLProgram;
    readonly vao: WebGLVertexArrayObject;
    readonly quadBuffer: WebGLBuffer;
    readonly tilesBuffer: WebGLBuffer;
    readonly wallsBuffer: WebGLBuffer;
    wallsActive: boolean;
    readonly paletteSizeLoc: WebGLUniformLocation | null;
    readonly strictLightLoc: WebGLUniformLocation | null;
    readonly lightBuffer: WebGLBuffer;
    readonly resolutionLoc: WebGLUniformLocation | null;
    readonly cameraOffsetLoc: WebGLUniformLocation | null;
    readonly cameraScaleLoc: WebGLUniformLocation | null;
    readonly cameraRotationLoc: WebGLUniformLocation | null;
    readonly chunkRotationLoc: WebGLUniformLocation | null;
    readonly tileMetresLoc: WebGLUniformLocation | null;
    readonly paletteLoc: WebGLUniformLocation | null;
    readonly defaultPalette: WebGLTexture;
  };
  private readonly tilePaletteSizes = new Map<string, number>();
  private readonly tilePalettes = new Map<string, WebGLTexture>();
  private readonly stencilAvailable: boolean;
  /** Shader packs are this renderer's optional feature; callers never check its class. */
  readonly features: RendererFeatures;

  static isSupported(canvas: HTMLCanvasElement): boolean {
    try {
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: false, stencil: true });
      return !!gl;
    } catch {
      return false;
    }
  }

  constructor(private readonly canvas: HTMLCanvasElement, private readonly defaults: ShaderPack, private readonly ports: RendererPorts) {
    if(ports.maxPixelRatio!==undefined&&(!Number.isFinite(ports.maxPixelRatio)||ports.maxPixelRatio<.5||ports.maxPixelRatio>4))throw new Error('Pixel ratio cap must be in [0.5,4]');
    this.activeShaders = defaults;
    const shaders = defaults;
    const renderer = this;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: false, stencil: true });
    if (!gl) throw new Error('WebGL 2 is unavailable in this browser.');
    this.gl = gl;
    this.stencilAvailable = gl.getContextAttributes()?.stencil !== false;
    this.features = Object.freeze({
      effects: Object.freeze({ configure: (materials: readonly RenderMaterial[], post: readonly RenderPostEffect[]) => renderer.configureEffects(materials, post) }),
      shaders: Object.freeze({
        get pack(): ShaderPack { return renderer.activeShaders; },
        set: (pack: ShaderPack): void => renderer.setShaderPack(pack),
      }),
      ...(this.stencilAvailable ? { planetMap: Object.freeze({ version: 1 as const }), planetOverview: Object.freeze({ version: 1 as const }), independentAir: Object.freeze({ version: 1 as const }), tileChunks: Object.freeze({ version: 1 as const, rotation: true as const, clipPolygon: true as const, lightEncoding: 'nibble' as const, paletteEntries: 1024 as const, walls: true as const, buffers: 'borrowed-through-draw' as const, revisions: createTileChunkRevisions() }) } : {}),
      tilePalettes: Object.freeze({
        register: (paletteId: string, colors: readonly string[]): void => renderer.registerTilePalette(paletteId, colors),
      }),
    });
    this.effects = new Effects(gl);
    try {
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
    } catch (error) {
      this.pendingScene?.cancel(); this.effects.dispose();
      gl.getExtension('WEBGL_lose_context')?.loseContext(); throw error;
    }
  }

  private configureEffects(materials: readonly RenderMaterial[], post: readonly RenderPostEffect[]): void {
    if (this.disposed) throw new Error('Renderer has been disposed.');
    const candidate = new Effects(this.gl);
    try { candidate.configure(materials, post); candidate.prepare(Math.max(1,this.canvas.width),Math.max(1,this.canvas.height)); }
    catch (error) { candidate.dispose(); this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,null); throw error; }
    const old = this.effects; this.effects = candidate; old.dispose();
  }

  get shaderPack(): ShaderPack { return this.activeShaders; }

  setShaderPack(value: ShaderPack): void {
    if (this.disposed) throw new Error('Renderer has been disposed.');
    const pack = validateShaderPack(value, this.defaults);
    const { gl } = this;
    // A big procedural scene can take a noticeable time to compile. Start drawing with its lite
    // build (plain discs) and switch to the full scene when the driver has finished it.
    const lite = liteShaderPack(pack);
    const next = compileShaderPack(gl, lite ?? pack);
    const previous = this.programs;
    this.pendingScene?.cancel();
    this.pendingScene = undefined;
    this.needsFullScene = !!lite;
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
    this.nebulaTimeLoc = gl.getUniformLocation(program, 'u_nebulaTime');
    this.starsVisibleLoc = gl.getUniformLocation(program, 'u_starsVisible');
    this.starDensityLoc = gl.getUniformLocation(program, 'u_starDensity');
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
    this.airMesh = undefined;
    this.effects.dispose();
    this.surfaceAtlas?.dispose(); this.surfaceAtlas = undefined;
    this.planetMapPass?.dispose(); this.planetMapPass = undefined;
    gl.bindVertexArray(null);
    gl.useProgram(null);
    this.pendingScene?.cancel();
    for (const program of Object.values(this.programs)) gl.deleteProgram(program);
    gl.deleteProgram(this.terrainProgram);
    if (this.overlayText) gl.deleteProgram(this.overlayText.program);
    if (this.tileChunkState) {
      gl.deleteProgram(this.tileChunkState.program);
      gl.deleteVertexArray(this.tileChunkState.vao);
      gl.deleteBuffer(this.tileChunkState.quadBuffer);
      gl.deleteBuffer(this.tileChunkState.tilesBuffer);
      gl.deleteBuffer(this.tileChunkState.lightBuffer);
      gl.deleteBuffer(this.tileChunkState.wallsBuffer);
      gl.deleteTexture(this.tileChunkState.defaultPalette);
      this.tileChunkState = undefined;
    }
    for (const tex of this.tilePalettes.values()) gl.deleteTexture(tex);
    this.tilePalettes.clear(); this.tilePaletteSizes.clear();
    for (const vao of [this.quadVao, this.vectorVao, this.textVao, this.terrainVao, this.colorVao]) gl.deleteVertexArray(vao);
    for (const buffer of [this.quadBuffer, this.vectorBuffer, this.textBuffer, this.terrainBuffer, this.colorBuffer]) gl.deleteBuffer(buffer);
    for (const entry of this.labelCache.values()) gl.deleteTexture(entry.texture);
    this.labelCache.clear();
    gl.deleteTexture(this.noise);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  drawScene(frame: SceneFrame, timer?: RenderTimer): void { this.draw(sceneFrame(frame), timer); }
  draw(frame: RenderFrame, timer?: RenderTimer): void {
    if (this.disposed) return;
    // Port the verified B64 startup fix: Low quality must not compile an unused full scene.
    const baseTheme = this.ports.theme?.current() ?? {};
    const theme = frame.theme ? { ...baseTheme, ...frame.theme } : baseTheme;
    if (theme.highQuality !== false && this.needsFullScene) {
      this.pendingScene = startProgram(this.gl, this.activeShaders, 'scene');
      this.needsFullScene = false;
    }
    this.upgradeScene();
    const { canvas, gl } = this;
    const { state, camera, engine, bodies } = frame;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.ports.maxPixelRatio ?? 2);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    this.effects.begin(pixelWidth, pixelHeight);

    const toScreen = createProjector(camera, width, height);
    const labels = new LabelPlacer();
    // The piloted ship's own label always shows; everything else avoids it.
    const shipPos = frame.shipWorldPosition ?? state.position;
    const ship = toScreen(shipPos);
    const physicalArt = this.ports.vehicles?.get(frame.vehicleId);
    let shipExtent = 0;
    if (physicalArt?.metresPerUnit) {
      for (const point of physicalArt.hull) shipExtent = Math.max(shipExtent, Math.abs(point.x), Math.abs(point.y));
      shipExtent *= physicalArt.metresPerUnit * camera.scale;
    }
    const shipMargin = Math.max(40, shipExtent);
    const shipLabelX = ship.x + Math.max(16, shipExtent + 6), shipLabelY = ship.y - Math.max(13, shipExtent + 6);
    const shipVisible = frame.showShip !== false && ship.x >= -shipMargin && ship.x <= width + shipMargin && ship.y >= -shipMargin && ship.y <= height + shipMargin;
    const shipLabel = state.status === 'crashed' ? 'SIGNAL LOST' : frame.shipLabel ?? 'VESSEL 01';
    if (shipVisible && frame.showShipLabels !== false) labels.reserve(labelRect(shipLabel, shipLabelX, shipLabelY, 'left'));

    // 1. Fullscreen Shader Pass (Stars + Celestial Bodies)
    gl.disable(gl.BLEND);
    gl.useProgram(this.quadProgram);
    const realTimeSec = (frame.presentationTime ?? (typeof performance !== 'undefined' ? performance.now() * 0.001 : state.time)) % 3600;
    if (this.sceneTimeLoc) gl.uniform1f(this.sceneTimeLoc, realTimeSec);
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

    const bodyList = bodies && bodies.length > 0 ? bodies : this.ports.fallbackBody ? [this.ports.fallbackBody] : [];
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
      if (b.surface && !isStar) terrain.push(terrainGeometry({ ...b, surface: b.surface }, camera, width, height, this.ports.geometry));
      visible.push({ b, pos, r, isStar, order: i });
    }
    visible.sort((a, c) => (a.isStar === c.isStar ? c.r - a.r || a.order - c.order : a.isStar ? -1 : 1));

    let count = 0;
    const overflow: typeof visible = [];
    if (this.nebulaTimeLoc) gl.uniform1f(this.nebulaTimeLoc, theme.animatedNebula ? realTimeSec : 0);
    if (this.starsVisibleLoc) gl.uniform1i(this.starsVisibleLoc, theme.starsVisible ? 1 : 0);
    if (this.starDensityLoc) gl.uniform1f(this.starDensityLoc, Math.max(0.2, Math.min(2.5, theme.starDensity ?? 1)));
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
    if (this.bgModeLoc) gl.uniform1i(this.bgModeLoc, themeBackdropToShaderIndex(theme.backdropStyle ?? 'void'));
    if (this.gridEnabledLoc) gl.uniform1i(this.gridEnabledLoc, theme.gridEnabled && theme.gridStyle !== 'off' ? 1 : 0);
    if (this.gridModeLoc) gl.uniform1i(this.gridModeLoc, themeGridToShaderIndex(theme.gridStyle ?? 'off'));
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

    const independentAir = bodyList.some(b => b.air);
    const earlyGroundOverlays = independentAir || bodyList.some(b => b.overview?.planet);
    if (independentAir) this.drawAir(bodyList, terrain, visible, camera, width, height, 'far');
    for (const geometry of terrain) this.drawTerrain(geometry, width, height, false,
      geometry.mapBodyId ? bodyList.find(b => b.id === geometry.mapBodyId) : undefined, camera);
    if (overflow.length) this.drawBodyBatch(overflow, width, height);
    this.effects.drawMaterials(bodyList, camera, width, height, realTimeSec, this.ports.geometry);

    if (earlyGroundOverlays) {
      this.drawTileChunks(frame.overlays ?? [], camera, width, height);
      if (!this.planetMapFailed) for (const geometry of terrain) if (geometry.mapBodyId) {
        const body = bodyList.find(b => b.id === geometry.mapBodyId);
        if (body) try {
          this.planetMapPass ??= new PlanetMapPass(gl, this.noise);
          this.planetMapPass.drawCover(body, camera, geometry, width, height);
        } catch { this.planetMapPass?.dispose(); this.planetMapPass = undefined; this.planetMapFailed = true; }
      }
      if (independentAir) this.drawAir(bodyList, terrain, visible, camera, width, height, 'near');
    }
    this.beginVectorPass(width, height);
    if (frame.showBodyOrbits !== false) this.drawOrbitRings(bodyList, toScreen, camera.scale, width, height);

    // Body labels in priority order (stars, then by size); crowded ones are left out.
    const bodyLabels: PendingBodyLabel[] = [];
    const crowd = new BodyCrowd();
    for (const { b, pos, r, isStar } of visible) {
      if (frame.showBodyLabels === false) break;
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
    const padPos = frame.padPosition ?? { x: 0, y: this.ports.fallbackBody?.radius ?? 0 };
    const pad = toScreen(padPos);
    const padAngle = frame.padNormal ? Math.atan2(frame.padNormal.y, frame.padNormal.x) + camera.rotation : Math.PI / 2;
    const padX = Math.sin(padAngle) * 7, padY = Math.cos(padAngle) * 7;
    if (frame.showPad !== false && (frame.padPosition || this.ports.fallbackBody) && pad.x >= -20 && pad.x <= width + 20 && pad.y >= -20 && pad.y <= height + 20) {
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
      this.drawShipBatch(others, toScreen, camera.rotation, width, height, camera.scale);
      for (const other of others) {
        if (other.rock || frame.showShipLabels === false) continue;
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
      this.drawShip(ship, -state.heading - camera.rotation, 1, state.status, engine, state.throttle, ShaderStyle.ship, frame.vehicleId, camera.scale);
      this.beginTextPass(width, height);
      if (frame.showShipLabels !== false) this.drawLabel(shipLabel, shipLabelX, shipLabelY, ShaderStyle.telemetryLabel, 'left', dpr);
      this.beginVectorPass(width, height);
    }
    timer?.lap('ship');

    // Telemetry scale bar & overlay labels
    verts = this.dynamicVerts;
    if (frame.showScale !== false) {
      const metres = 10 ** Math.floor(Math.log10(100 / camera.scale));
      const pixels = metres * camera.scale;
      const barY = height - 27;
      verts[0] = width - 24 - pixels; verts[1] = barY;
      verts[2] = width - 24; verts[3] = barY;
      this.uploadAndDraw(2, gl.LINES, ShaderStyle.scale);
      this.beginTextPass(width, height);
      this.drawLabel(`${metres} m`, width - 24, height - 36, ShaderStyle.telemetryLabel, 'right', dpr);
    }
    if (frame.showScale === false) this.beginTextPass(width, height);
    if (frame.overlays?.length) {
      if (!earlyGroundOverlays) this.drawTileChunks(frame.overlays, camera, width, height);
      this.drawOverlays(screenOverlays(frame.overlays, camera, width, height), width, height, dpr);
    }
    const encounters = trajectoryMarkers(frame);
    if (encounters.length) this.drawOverlays(screenOverlays(encounters, camera, width, height), width, height, dpr);
    timer?.lap('overlay');
    this.effects.finish(realTimeSec);

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
    width: number, height: number, worldScale = 1): void {
    const { gl } = this;
    let visible = 0, vertices = 0;
    const placed: { readonly x: number; readonly y: number; readonly c: number; readonly s: number; readonly ship: RenderShip; readonly artwork?: VehicleAppearance }[] = [];
    for (const other of others) {
      if (other.rock) continue;
      const at = toScreen(other.position);
      const margin = Math.max(40, (this.ports.vehicles?.get(other.vehicleId)?.metresPerUnit ?? 0) * worldScale * 32);
      if (at.x < -margin || at.x > width + margin || at.y < -margin || at.y > height + margin) continue;
      const angle = -other.heading - rotation;
      let artwork = this.ports.vehicles?.get(other.vehicleId), size = .8;
      if (artwork?.metresPerUnit) {
        size = vehicleArtworkScale(artwork, worldScale);
        if (size === 0) { artwork = undefined; size = 1; }
      }
      const count = artwork?.hull.length ?? 4;
      placed.push({ x: at.x, y: at.y, c: Math.cos(angle) * size, s: Math.sin(angle) * size, ship: other, artwork });
      vertices += 3 + 3 * (count - 2) + 2 * count + (artwork?.lines?.reduce((n, line) => n + 2 * (line.length - 1), 0) ?? 0); visible++;
    }
    if (!visible) return;
    // Bound the shared vector buffer by the visible immutable hull sizes.
    const verts = this.ensureCapacity(vertices * 2);
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
      const f = p.artwork?.flame;
      if (!f || !p.ship.engine || p.ship.status !== 'flying') continue;
      point(p, f.x, -f.halfWidth); point(p, f.x - f.length - p.ship.throttle * f.throttleLength, 0); point(p, f.x, f.halfWidth);
    }
    const flameEnd = i;
    const bodyRanges: [number, number][] = [];
    for (const style of styles) {
      const from = i;
      for (const p of placed) {
        const own = p.ship.status === 'crashed' ? ShaderStyle.crashedShip
          : p.ship.foreign ? ShaderStyle.foreignShip : ShaderStyle.fleetShip;
        if (own !== style) continue;
        const hull = p.artwork?.hull ?? VEHICLE_MARKER;
        for (let j = 1; j < hull.length - 1; j++) {
          point(p, hull[0]!.x, hull[0]!.y); point(p, hull[j]!.x, hull[j]!.y); point(p, hull[j+1]!.x, hull[j+1]!.y);
        }
      }
      bodyRanges.push([from, i]);
    }
    const outlineStart = i;
    for (const p of placed) {
      const hull = p.artwork?.hull ?? VEHICLE_MARKER;
      for (let j = 0; j < hull.length; j++) {
        const a = hull[j]!, b = hull[(j+1) % hull.length]!; point(p, a.x, a.y); point(p, b.x, b.y);
      }
    }
    for (const p of placed) for (const line of p.artwork?.lines ?? []) for (let j = 1; j < line.length; j++) {
      point(p, line[j-1]!.x, line[j-1]!.y); point(p, line[j]!.x, line[j]!.y);
    }
    const outlineEnd = i;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts, 0, i);
    draw(flameStart, flameEnd, gl.TRIANGLES, ShaderStyle.flame);
    styles.forEach((style, k) => draw(bodyRanges[k]![0], bodyRanges[k]![1], gl.TRIANGLES, style));
    draw(outlineStart, outlineEnd, gl.LINES, ShaderStyle.outline);
  }

  /** One vessel: optional flame, body and outline, at a screen position and angle. */
  private drawShip(at: Vec, angle: number, size: number, status: State['status'], engine: boolean, throttle: number, style: number, vehicleId?: string, worldScale = 1): void {
    const { gl } = this;
    let artwork = this.ports.vehicles?.get(vehicleId);
    if (artwork?.metresPerUnit) {
      size = vehicleArtworkScale(artwork, worldScale);
      if (size === 0) { artwork = undefined; size = 1; }
    }
    const hull = artwork?.hull ?? VEHICLE_MARKER, f = artwork?.flame;
    const verts = this.ensureCapacity(hull.length * 2);
    const cosA = Math.cos(angle) * size, sinA = Math.sin(angle) * size;
    const point = (i: number, x: number, y: number): void => {
      verts[i * 2] = at.x + x * cosA - y * sinA;
      verts[i * 2 + 1] = at.y + x * sinA + y * cosA;
    };
    if (f && engine && status === 'flying') {
      point(0, f.x, -f.halfWidth); point(1, f.x - f.length - throttle * f.throttleLength, 0); point(2, f.x, f.halfWidth);
      this.uploadAndDraw(3, gl.TRIANGLES, ShaderStyle.flame);
    }
    for (let j = 0; j < hull.length; j++) point(j, hull[j]!.x, hull[j]!.y);
    this.uploadAndDraw(hull.length, gl.TRIANGLE_FAN, status === 'crashed' ? ShaderStyle.crashedShip : style);
    this.uploadAndDraw(hull.length, gl.LINE_LOOP, ShaderStyle.outline);
    for (const line of artwork?.lines ?? []) {
      for (let j = 0; j < line.length; j++) point(j, line[j]!.x, line[j]!.y);
      this.uploadAndDraw(line.length, gl.LINE_STRIP, ShaderStyle.outline);
    }
  }

  private beginVectorPass(width: number, height: number): void {
    const { gl } = this;
    gl.useProgram(this.vectorProgram);
    gl.uniform2f(this.vecResolutionLoc, width, height);
    gl.bindVertexArray(this.vectorVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vectorBuffer);
  }

  /** Canonical opaque-face union; no effect textures or shader-pack additions. */
  private drawAir(bodies: readonly RenderBody[], terrain: readonly TerrainGeometry[],
    visible: readonly { b: RenderBody; pos: Vec; r: number; isStar: boolean }[], camera: Camera,
    width: number, height: number, layer: 'far' | 'near'): void {
    if (!this.stencilAvailable) return;
    if (!bodies.some(b => b.air && b.air.mode !== 'off')) return;
    const { gl } = this;
    const airMesh = this.airMesh ??= new AirMesh();
    let masked = false;
    for (const body of bodies) {
      airMesh.update(body, camera, width, height, layer);
      if (!airMesh.length) continue;
      if (!masked) {
        gl.enable(gl.STENCIL_TEST); gl.stencilMask(0xff); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.colorMask(false, false, false, false); gl.stencilFunc(gl.ALWAYS, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        for (const geometry of terrain) this.drawTerrain(geometry, width, height, true);
        const discs = visible.filter(v => !v.b.surface);
        if (discs.length) this.drawBodyBatch(discs, width, height);
        gl.colorMask(true, true, true, true); gl.stencilMask(0); gl.stencilFunc(gl.EQUAL, 0, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP); masked = true;
      }
      gl.useProgram(this.terrainProgram); gl.uniform2f(this.terrainResolution, width, height);
      gl.bindVertexArray(this.terrainVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.terrainBuffer);
      if (this.terrainVerts.length < airMesh.vertices.length) {
        this.terrainVerts = new Float32Array(airMesh.vertices.length);
        gl.bufferData(gl.ARRAY_BUFFER, this.terrainVerts.byteLength, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, airMesh.vertices, 0, airMesh.length);
      gl.drawArrays(gl.TRIANGLES, 0, airMesh.length / 6);
    }
    if (masked) { gl.stencilMask(0xff); gl.disable(gl.STENCIL_TEST); }
  }

  private drawTerrain(geometry: TerrainGeometry, width: number, height: number, mask = false, body?: RenderBody, camera?: Camera): void {
    const { gl } = this;
    const mapCount = !mask && body && camera ? geometry.faces.reduce((n,f) => n + (f.planetMap ? (f.points.length-2)*3 : 0),0) : 0;
    if (mapCount && !this.planetMapFailed) try { this.planetMapPass ??= new PlanetMapPass(gl, this.noise); }
      catch { this.planetMapFailed = true; }
    const visibleRibbon = !mask && geometry.ribbonMaterial
      ? geometry.faces.reduce((n, f) => n + (f.surfaceRibbon ? (f.points.length - 2) * 3 : 0), 0) : 0;
    let atlas: ReturnType<SurfaceAtlasPass['prepare']>;
    if (visibleRibbon && geometry.ribbonMaterial && !this.surfaceAtlasFailed) {
      try {
        this.surfaceAtlas ??= new SurfaceAtlasPass(gl);
        atlas = this.surfaceAtlas.prepare(geometry.ribbonMaterial);
      } catch {
        this.surfaceAtlas?.dispose(); this.surfaceAtlas = undefined; this.surfaceAtlasFailed = true;
      }
    }
    gl.useProgram(this.terrainProgram);
    gl.uniform2f(this.terrainResolution, width, height);
    gl.bindVertexArray(this.terrainVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.terrainBuffer);
    const count = geometry.faces.reduce((sum, f) => sum + (mask && (f.color[3] !== 1 || f.overview) ? 0 : (f.points.length - 2) * 3), 0);
    const lineCount = mask ? 0 : geometry.edge.length * 2 + geometry.accents.reduce((sum, line) => sum + (line.length - 1) * 2, 0);
    const floats = (count + lineCount) * 6;
    const ribbonCount = atlas ? visibleRibbon : 0;
    if (floats > this.terrainVerts.length) {
      this.terrainVerts = new Float32Array(2 ** Math.ceil(Math.log2(floats)));
      gl.bufferData(gl.ARRAY_BUFFER, this.terrainVerts.byteLength, gl.DYNAMIC_DRAW);
    }
    let index = 0;
    const vertex = (p: { x: number; y: number }, color: readonly number[]) => {
      this.terrainVerts[index++] = p.x; this.terrainVerts[index++] = p.y;
      for (const c of color) this.terrainVerts[index++] = c;
    };
    for (let pass = 0; pass < (mapCount ? 3 : atlas ? 2 : 1); pass++) for (const f of geometry.faces) {
      if (mask && (f.color[3] !== 1 || f.overview)
        || (mapCount ? (f.surfaceRibbon ? 2 : f.planetMap ? 1 : 0) !== pass : atlas && Boolean(f.surfaceRibbon) !== (pass === 1))) continue;
      for (let j = 1; j < f.points.length - 1; j++) {
        for (const p of [f.points[0]!, f.points[j]!, f.points[j + 1]!]) vertex(p, terrainFaceColor(f, p));
      }
    }
    if (!mask) for (const [a, b] of geometry.edge) { vertex(a, geometry.accentColor); vertex(b, geometry.accentColor); }
    const faint = [...geometry.accentColor]; faint[3] = .24;
    if (!mask) for (const line of geometry.accents) for (let j = 1; j < line.length; j++) {
      vertex(line[j - 1]!, faint); vertex(line[j]!, faint);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.terrainVerts, 0, index);
    if (mapCount) {
      const skinCount = geometry.faces.reduce((n,f) => n + (f.surfaceRibbon ? (f.points.length-2)*3 : 0),0);
      const normalCount = count-mapCount-skinCount;
      gl.drawArrays(gl.TRIANGLES,0,normalCount);
      let drawn = false;
      if (!this.planetMapFailed) try { drawn = this.planetMapPass!.drawMap(body!,camera!,width,height,normalCount,mapCount); }
        catch { this.planetMapPass?.dispose(); this.planetMapPass=undefined; this.planetMapFailed=true; }
      gl.useProgram(this.terrainProgram);
      if (!drawn) gl.drawArrays(gl.TRIANGLES,normalCount,mapCount);
      if (!atlas && skinCount) gl.drawArrays(gl.TRIANGLES,normalCount+mapCount,skinCount);
    } else gl.drawArrays(gl.TRIANGLES, 0, count - ribbonCount);
    if (atlas && ribbonCount) {
      this.surfaceAtlas!.draw(geometry.ribbonMaterial!, atlas, width, height, count - ribbonCount, ribbonCount);
      gl.useProgram(this.terrainProgram);
    }
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

  registerTilePalette(paletteId: string, colors: readonly string[]): void {
    if (this.disposed) throw new Error('Renderer is disposed.');
    if (!paletteId || paletteId.length > 64 || colors.length < 1 || colors.length > 1024
      || colors.some(color => !/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color))) throw new Error('Invalid tile palette.');
    const state = this.ensureTileChunkResources();
    const existing = this.tilePalettes.get(paletteId);
    const tex = createTilePaletteTexture(this.gl, colors);
    if (existing && existing !== state.defaultPalette) {
      this.gl.deleteTexture(existing);
    }
    this.tilePalettes.set(paletteId, tex);
    this.tilePaletteSizes.set(paletteId, colors.length);
  }

  private ensureTileChunkResources(): NonNullable<typeof this.tileChunkState> {
    if (this.tileChunkState) return this.tileChunkState;
    const { gl } = this;
    const program = compileTileChunkProgram(gl);
    const resolutionLoc = gl.getUniformLocation(program, 'u_resolution');
    const cameraOffsetLoc = gl.getUniformLocation(program, 'u_camera_offset');
    const cameraScaleLoc = gl.getUniformLocation(program, 'u_camera_scale');
    const cameraRotationLoc = gl.getUniformLocation(program, 'u_camera_rotation');
    const tileMetresLoc = gl.getUniformLocation(program, 'u_tile_metres');
    const chunkRotationLoc = gl.getUniformLocation(program, 'u_chunk_rotation');
    const paletteLoc = gl.getUniformLocation(program, 'u_palette');
    const paletteSizeLoc = gl.getUniformLocation(program, 'u_palette_size');
    const strictLightLoc = gl.getUniformLocation(program, 'u_strict_light');

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    // Quad geometry (unit quad 0..1 for TRIANGLE_STRIP)
    const quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    // Instance tile IDs buffer (1024 uint16)
    const tilesBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, tilesBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 1024 * 2, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    // Instance tile light buffer (1024 uint8)
    const lightBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, lightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 1024, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribIPointer(2, 1, gl.UNSIGNED_BYTE, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    const wallsBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, wallsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, DEFAULT_ZERO_WALLS, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3); gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_SHORT, 0, 0); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);

    const defaultPalette = createTilePaletteTexture(gl);
    this.tilePalettes.set('default', defaultPalette);

    const state = {
      program,
      vao,
      quadBuffer,
      tilesBuffer,
      wallsBuffer, wallsActive: false, strictLightLoc, paletteSizeLoc,
      lightBuffer,
      resolutionLoc,
      cameraOffsetLoc,
      cameraScaleLoc,
      cameraRotationLoc,
      tileMetresLoc,
      chunkRotationLoc,
      paletteLoc,
      defaultPalette,
    };
    this.tileChunkState = state;
    return state;
  }

  private drawTileChunks(overlays: readonly OverlayPrimitive[], camera: Camera, width: number, height: number): void {
    let hasChunks = false;
    for (const p of overlays) {
      if (p.kind === 'tile-chunk') { hasChunks = true; break; }
    }
    if (!hasChunks) return;

    const state = this.ensureTileChunkResources();
    const { gl } = this;

    gl.useProgram(state.program);
    gl.bindVertexArray(state.vao);

    gl.uniform2f(state.resolutionLoc, width, height);
    gl.uniform1f(state.cameraScaleLoc, camera.scale);
    gl.uniform1f(state.cameraRotationLoc, camera.rotation);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(state.paletteLoc, 0);

    let boundPaletteId = '';

    for (const p of overlays) {
      if (p.kind !== 'tile-chunk') continue;

      validateTileChunkProfile(p);
      gl.uniform1i(state.strictLightLoc, p.lightEncoding === 'nibble' ? 1 : 0);
      const paletteId = p.paletteId ?? 'default';
      if (paletteId !== boundPaletteId) {
        const tex = this.tilePalettes.get(paletteId) ?? this.tilePalettes.get('default') ?? state.defaultPalette;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(state.paletteSizeLoc, this.tilePaletteSizes.get(paletteId) ?? this.tilePaletteSizes.get('default') ?? 27);
        boundPaletteId = paletteId;
      }

      if (p.clipPolygon) {
        if (!this.stencilAvailable) throw new Error('Clipped tile chunks require a stencil buffer.');
        const verts = this.ensureCapacity(p.clipPolygon.length * 6);
        const a = camera.rotation + (p.rotationRadians ?? 0), c = Math.cos(a), s = Math.sin(a);
        const cc = Math.cos(camera.rotation), cs = Math.sin(camera.rotation);
        const dx = p.origin.x - camera.center.x, dy = p.origin.y - camera.center.y;
        const ox = width / 2 + (dx * cc - dy * cs) * camera.scale;
        const oy = height / 2 - (dx * cs + dy * cc) * camera.scale;
        let minX = width, minY = height, maxX = 0, maxY = 0;
        for (let i = 0; i < p.clipPolygon.length; i++) {
          const v = p.clipPolygon[i]!;
          verts[i * 6] = ox + (v.x * c - v.y * s) * camera.scale;
          verts[i * 6 + 1] = oy - (v.x * s + v.y * c) * camera.scale;
          minX = Math.min(minX, verts[i * 6]!); maxX = Math.max(maxX, verts[i * 6]!);
          minY = Math.min(minY, verts[i * 6 + 1]!); maxY = Math.max(maxY, verts[i * 6 + 1]!);
          verts.fill(1, i * 6 + 2, i * 6 + 6);
        }
        // Clear only this chunk's screen footprint, including device-pixel coverage.
        const px = this.canvas.width / width, py = this.canvas.height / height;
        const left = Math.max(0, Math.floor(minX * px)), right = Math.min(this.canvas.width, Math.ceil(maxX * px));
        const bottom = Math.max(0, Math.floor((height - maxY) * py)), top = Math.min(this.canvas.height, Math.ceil((height - minY) * py));
        // The existing physical scissor guarantees no pixels for an empty clip.
        // Reject before changing stencil/color state or uploading any tile data.
        if (right <= left || top <= bottom) continue;
        // Even-odd parity of a triangle fan handles a simple concave polygon.
        // Stencil is private to this pass; restore write masks before other overlays.
        gl.enable(gl.STENCIL_TEST); gl.stencilMask(0xff);
        gl.colorMask(false, false, false, false);
        gl.stencilFunc(gl.ALWAYS, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
        gl.enable(gl.SCISSOR_TEST); gl.scissor(left, bottom, right - left, top - bottom);
        gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.useProgram(this.terrainProgram); gl.uniform2f(this.terrainResolution, width, height);
        gl.bindVertexArray(this.colorVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        if (this.colorBufferFloats < verts.length) {
          gl.bufferData(gl.ARRAY_BUFFER, verts.byteLength, gl.DYNAMIC_DRAW); this.colorBufferFloats = verts.length;
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts, 0, p.clipPolygon.length * 6);
        gl.drawArrays(gl.TRIANGLE_FAN, 0, p.clipPolygon.length);
        gl.colorMask(true, true, true, true);
        gl.stencilFunc(gl.EQUAL, 1, 1); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        gl.useProgram(state.program); gl.bindVertexArray(state.vao);
      }
      gl.uniform1f(state.chunkRotationLoc, p.rotationRadians ?? 0);
      gl.uniform2f(state.cameraOffsetLoc, p.origin.x - camera.center.x, p.origin.y - camera.center.y);
      gl.uniform1f(state.tileMetresLoc, p.tileMetres);

      gl.bindBuffer(gl.ARRAY_BUFFER, state.tilesBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, p.tiles);

      if (p.walls || state.wallsActive) {
        gl.bindBuffer(gl.ARRAY_BUFFER, state.wallsBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, p.walls ?? DEFAULT_ZERO_WALLS);
        state.wallsActive = p.walls !== undefined;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, state.lightBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, p.light ?? (p.lightEncoding === 'nibble' ? DEFAULT_NIBBLE_LIGHT : DEFAULT_FULL_LIGHT));

      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1024);
      if (p.clipPolygon) { gl.disable(gl.STENCIL_TEST); gl.disable(gl.SCISSOR_TEST); }
    }

    gl.bindVertexArray(null);
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

    const gl = this.gl;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts, 0, idx);
    let offset = 0, rangeStart = 0, leg = points[1]!.bodyId;
    for (let i = 1; i < points.length; i++) {
      const nextLeg = points[i]!.bodyId;
      if (nextLeg !== leg) {
        gl.uniform1i(this.vecStyleLoc, leg && leg !== path[0]?.frameId ? ShaderStyle.pad : ShaderStyle.path);
        gl.drawArrays(gl.LINE_STRIP, rangeStart, offset - rangeStart + 1);
        rangeStart = offset; leg = nextLeg;
      }
      offset += points[i]!.linear ? 1 : SAMPLES_PER_SEGMENT;
    }
    gl.uniform1i(this.vecStyleLoc, leg && leg !== path[0]?.frameId ? ShaderStyle.pad : ShaderStyle.path);
    gl.drawArrays(gl.LINE_STRIP, rangeStart, totalVertices - rangeStart);
  }
}
