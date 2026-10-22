import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CanvasRenderer as PortableCanvas } from '../../modules/render-canvas/src/canvas';
import { legacyRenderPorts } from '../../packages/render-2d/src/compatibility';
import { createTileChunkOwner, requireTileChunkFeatures } from '../../packages/game-api/src/index';
import type { OverlayPrimitive, RenderFrame } from '../../packages/game-api/src/index';
import { CanvasRenderer, DEFAULT_SHADERS, WebGLRenderer } from '../../packages/render-2d/src/index';
import { createSurfaceProfile } from '../../packages/sim-core/src/surface';
import { initialState } from '../../packages/sim-core/src/index';

const OVERLAYS: readonly OverlayPrimitive[] = [
  { kind: 'line', space: 'screen', points: [{ x: 100, y: 100 }, { x: 300, y: 100 }], color: '#ff0000', width: 4 },
  { kind: 'circle', space: 'world', center: { x: 0, y: 0 }, radius: 10, color: '#00ff0080', fill: true },
  { kind: 'text', space: 'screen', at: { x: 480, y: 520 }, text: 'MODULE', color: '#3366ff', align: 'right' },
];
const frame = (overlays?: readonly OverlayPrimitive[]): RenderFrame => ({ state: initialState(), path: [], pathClosed: false, engine: false,
  camera: { center: { x: 0, y: 0 }, rotation: 0, scale: 2 }, bodies: [{ id: 'far', name: '', position: { x: 1e9, y: 1e9 }, radius: 1 }],
  shipWorldPosition: { x: 1e20, y: 1e20 }, padPosition: { x: 1e20, y: 1e20 }, ...(overlays ? { overlays } : {}) });

let previous: unknown;
beforeEach(() => { previous = (globalThis as { window?: unknown }).window; (globalThis as { window?: unknown }).window = { devicePixelRatio: 2 }; });
afterEach(() => { (globalThis as { window?: unknown }).window = previous; });

function fake2d() {
  const calls: string[] = [];
  const ctx = new Proxy({ fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'start', font: '', lineDashOffset: 0 } as Record<string, unknown>, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: () => {} });
      return (...args: unknown[]) => { calls.push(`${String(key)}(${args.map(a => typeof a === 'number' ? +a.toFixed(2) : String(a)).join(',')})`); };
    },
    set(target, key, value) { target[key as string] = value; if (key === 'strokeStyle' || key === 'fillStyle' || key === 'lineWidth' || key === 'textAlign') calls.push(`${String(key)}=${String(value)}`); return true; },
  });
  return { calls, canvas: { clientWidth: 800, clientHeight: 600, width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement };
}

function fakeGl(stencil = true) {
  const stats = { programs: 0, created: 0, colors: [] as number[][], draws: [] as string[], instancedDraws: [] as string[], texts: [] as string[],
    buffers: new Set<object>(), tileUploads: [] as number[][], colorMasks: [] as boolean[][] };
  let program: unknown, linked = 0;
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined;
      if (/^[A-Z_0-9]+$/.test(key)) return key.length; // Distinct enum stand-ins.
      switch (key) {
        case 'createBuffer': return () => { const buffer = {}; stats.buffers.add(buffer); return buffer; };
        case 'deleteBuffer': return (buffer: object) => { stats.buffers.delete(buffer); };
        case 'bufferSubData': return (_target: unknown, _offset: unknown, data: unknown) => {
          if (data instanceof Uint16Array && data.length === 1024) stats.tileUploads.push(Array.from(data));
        };
        case 'createProgram': return () => { stats.programs++; stats.created++; return { id: ++linked }; };
        case 'deleteProgram': return (p: unknown) => { if (p) stats.programs--; };
        case 'getShaderParameter': case 'getProgramParameter': return (_: unknown, parameter: number) => parameter === 'LINK_STATUS'.length || parameter === 'COMPILE_STATUS'.length ? true : 0;
        case 'getFragDataLocation': case 'getAttribLocation': return () => 0;
        case 'useProgram': return (p: unknown) => { program = p; };
        case 'uniform4f': return (_: unknown, ...rgba: number[]) => { stats.colors.push(rgba.map(c => +c.toFixed(2))); };
        case 'colorMask': return (...rgba: boolean[]) => { stats.colorMasks.push(rgba); };
        case 'drawArrays': return (mode: number, _first: number, count: number) => { stats.draws.push(`${(program as { id: number } | undefined)?.id}:${mode}:${count}`); };
        case 'drawArraysInstanced': return (mode: number, _first: number, count: number, primcount: number) => { stats.instancedDraws.push(`${(program as { id: number } | undefined)?.id}:${mode}:${count}:${primcount}`); };
        case 'getContextAttributes': return () => ({ stencil });
        case 'getExtension': return () => null;
        case 'getError': return () => 0;
        default: return () => ({});
      }
    },
  });
  const label = { setTransform() {}, measureText: (t: string) => ({ width: t.length * 7 }), fillText(text:string) { stats.texts.push(text); }, font: '', fillStyle: '', textAlign: '', textBaseline: '' };
  const canvas = { clientWidth: 800, clientHeight: 600, width: 0, height: 0, getContext: () => gl,
    ownerDocument: { createElement: () => ({ width: 0, height: 0, getContext: () => label }) } } as unknown as HTMLCanvasElement;
  return { stats, canvas };
}

describe('renderer features', () => {
  it('qualifies revision metadata without caching mutable buffers or disposing another view owner', () => {
    const owner=createTileChunkOwner(),tiles=new Uint16Array(1024);tiles[0]=1;
    const contentRevision={owner,id:0,revision:0};
    const chunk:Extract<OverlayPrimitive,{kind:'tile-chunk'}>={kind:'tile-chunk',space:'world',origin:{x:0,y:0},size:32,tileMetres:1,tiles,contentRevision};
    const source=fakeGl(),gpu=new WebGLRenderer(source.canvas),drawing=fake2d(),cpu=new CanvasRenderer(drawing.canvas);
    for(const renderer of [gpu,cpu])requireTileChunkFeatures(renderer.features,{revisions:true});
    gpu.draw(frame([chunk]));cpu.draw(frame([chunk]));
    contentRevision.revision++;tiles[0]=2;
    gpu.draw(frame([{...chunk,origin:{x:1,y:2},rotationRadians:.2}]));cpu.draw(frame([chunk]));
    expect(source.stats.tileUploads.at(-1)![0]).toBe(2);
    gpu.features.tileChunks!.revisions!.release(contentRevision);expect(owner.disposed).toBe(false);
    gpu.dispose();cpu.draw(frame([chunk]));expect(owner.disposed).toBe(false);
    owner.dispose();expect(()=>cpu.draw(frame([{...chunk,origin:{x:1e9,y:1e9}}]))).toThrow('disposed');
    expect(()=>gpu.features.tileChunks!.revisions!.release(contentRevision)).not.toThrow();
    cpu.features.tileChunks!.revisions!.release(contentRevision);cpu.dispose();
  });
  it('caps the fallback backdrop while honoring an explicit creator resolution override', () => {
    const source = fake2d(), themes: unknown[] = [];
    const renderer = new PortableCanvas(source.canvas, { ...legacyRenderPorts, maxPixelRatio: 2,
      theme: { current: () => ({ highQuality: true, nebulaVisible: true, galaxiesVisible: true }),
        backdrop(_ctx, _width, _height, _camera, theme) { themes.push(theme); } } });
    renderer.draw({ ...frame(), theme: { highQuality: true, starsVisible: false } });
    expect(source.canvas.width).toBe(1600); expect(source.canvas.height).toBe(1200);
    expect(themes).toEqual([expect.objectContaining({ highQuality: false, nebulaVisible: false, galaxiesVisible: false, starsVisible: false })]);
    renderer.dispose();
  });

  it('keeps Canvas fallback low detail without mutating requested quality or air', () => {
    const requested = Object.freeze({ mode: 'clouds' as const, heightMetres: 30,
      cloudAltitudeMetres: 10, cloudThicknessMetres: 4, color: [.4, .7, .9] as const, opacity: .3, phaseRadians: .4 });
    const body = { id: 'air', name: '', radius: 100, position: { x: 0, y: 0 }, air: requested };
    const theme = Object.freeze({ highQuality: true, nebulaVisible: true, galaxiesVisible: true });
    const source = fake2d(), canvas = new CanvasRenderer(source.canvas);
    const scene = { ...frame(), presentationTime: 0, bodies: [body], theme };
    canvas.draw(scene);
    expect(source.canvas.width).toBe(800); expect(source.canvas.height).toBe(600);
    const cloudRequest = source.calls.slice(); source.calls.length = 0;
    canvas.draw({ ...scene, bodies: [{ ...body, air: { ...requested, mode: 'air' } }] });
    expect(source.calls).toEqual(cloudRequest);
    expect(requested.mode).toBe('clouds'); expect(theme.highQuality).toBe(true);
    expect(theme.nebulaVisible).toBe(true); expect(theme.galaxiesVisible).toBe(true);
    canvas.dispose();
  });


  it('qualifies independent air and masks it before flight cues without changing ground on replacement', () => {
    const surface = createSurfaceProfile(100, [0, 2, -1, 0, 1, -2, 0, 0]);
    const body = { id: 'air', name: 'AIR', radius: 100, position: { x: 0, y: 0 }, surface,
      atmosphereColor: '#6ab4ec80', air: { mode: 'clouds' as const, heightMetres: 20,
        cloudAltitudeMetres: 10, cloudThicknessMetres: 2, color: [.4, .7, .9] as const, opacity: .12, phaseRadians: 0 } };
    const tiles = new Uint16Array(1024); tiles[0] = 1;
    const chunk: OverlayPrimitive = { kind: 'tile-chunk', space: 'world', origin: {x:0,y:0}, size:32, tileMetres:1, tiles };
    const f = { ...frame([chunk]), bodies: [body], shipWorldPosition: { x: 0, y: 130 }, showScale: false };
    const cpu = fake2d(), renderer = new CanvasRenderer(cpu.canvas);
    expect(renderer.features.independentAir).toEqual({ version: 1 }); renderer.draw(f);
    expect(cpu.calls).toContain('clip(evenodd)');
    expect(cpu.calls.findIndex(c => c.startsWith('fillRect('))).toBeLessThan(cpu.calls.findIndex(c => c.includes('VESSEL 01')));
    const gpu = fakeGl(), accelerated = new WebGLRenderer(gpu.canvas);
    expect(accelerated.features.independentAir).toEqual({ version: 1 }); accelerated.draw(f);
    expect(gpu.stats.instancedDraws).toHaveLength(1);
    accelerated.draw({ ...f, bodies: [{ ...body, air: { ...body.air, mode: 'off' } }] });
    expect(gpu.stats.instancedDraws).toHaveLength(2);
    renderer.dispose(); accelerated.dispose(); expect(gpu.stats.buffers.size).toBe(0);
    const unavailable = new WebGLRenderer(fakeGl(false).canvas);
    expect(unavailable.features.independentAir).toBeUndefined(); unavailable.dispose();
  });


  it('draws cosmetic walls behind air, clears omitted GPU walls, and releases tile buffers', () => {
    const tiles = new Uint16Array(1024); tiles[0] = 1;
    const walls = new Uint16Array(1024); walls[0] = 2; walls[1] = 2;
    const chunk: OverlayPrimitive = { kind: 'tile-chunk', space: 'world', origin: { x: 0, y: 0 },
      tileMetres: 1, size: 32, tiles, walls, paletteId: 'fixture' };
    const palette = ['#00000000', '#112233', '#aabbcc'];
    const canvas = fake2d(); const cpu = new CanvasRenderer(canvas.canvas);
    cpu.features.tilePalettes?.register('fixture', palette);
    cpu.draw(frame([chunk]));
    expect(canvas.calls).toContain('fillStyle=#112233'); // Foreground masks its wall.
    expect(canvas.calls).toContain('fillStyle=#5e6770'); // Air reveals the dim background.
    expect(canvas.calls).not.toContain('fillStyle=#aabbcc');
    cpu.features.tilePalettes?.register('fixture', ['#00000000', '#112233', '#ffffff']);
    canvas.calls.length = 0; cpu.draw(frame([chunk]));
    expect(canvas.calls).toContain('fillStyle=#8c8c8c'); // Palette replacement invalidates walls too.
    cpu.dispose();

    const webgl = fakeGl(); const gpu = new WebGLRenderer(webgl.canvas);
    gpu.draw(frame([chunk, { ...chunk, walls: undefined }]));
    expect(webgl.stats.tileUploads).toHaveLength(4);
    expect(webgl.stats.tileUploads[1]).toEqual(Array.from(walls));
    expect(webgl.stats.tileUploads[3]).toEqual(Array(1024).fill(0));
    webgl.stats.tileUploads.length = 0;
    gpu.draw(frame([{ ...chunk, walls: undefined }]));
    expect(webgl.stats.tileUploads).toHaveLength(1); // Legacy chunks need no repeated wall upload.
    gpu.dispose();
    expect(webgl.stats.buffers.size).toBe(0);
    expect(webgl.stats.programs).toBe(0);
  });


  it('preflights essential profiles, copies palettes and observes borrowed arrays only through a draw', () => {
    const source = fake2d(), renderer = new CanvasRenderer(source.canvas);
    expect(() => requireTileChunkFeatures(undefined)).toThrow('required tile profile');
    expect(() => requireTileChunkFeatures({ tileChunks: { version: 9 } } as never)).toThrow();
    expect(() => requireTileChunkFeatures({ ...renderer.features, tileChunks: { version: 1, rotation: true, clipPolygon: true } }, {lightEncoding:'nibble'})).toThrow();
    requireTileChunkFeatures(renderer.features, {lightEncoding:'nibble', walls:true});
    const colors = ['#00000000', '#ffffff'];
    renderer.features.tilePalettes!.register('strict', colors); colors[1] = '#ff0000';
    const tiles = new Uint16Array(1024); tiles[0] = 1;
    const light = new Uint8Array(1024);
    const chunk: Extract<OverlayPrimitive, {kind:'tile-chunk'}> = {kind:'tile-chunk', space:'world', origin:{x:0,y:0},size:32,tileMetres:1,tiles,light,lightEncoding:'nibble',paletteId:'strict'};
    renderer.draw(frame([chunk])); expect(source.calls).toContain('fillStyle=#333333');
    source.calls.length=0;light[0]=15; renderer.draw(frame([chunk]));expect(source.calls).toContain('fillStyle=#ffffff');
    source.calls.length=0; renderer.draw(frame([{...chunk,light:undefined}]));expect(source.calls).toContain('fillStyle=#ffffff');
    source.calls.length=0; renderer.draw(frame([{...chunk,lightEncoding:undefined,light:new Uint8Array(1024)}]));expect(source.calls).toContain('fillStyle=#ffffff');
    source.calls.length=0;tiles[0]=1023;renderer.draw(frame([chunk]));expect(source.calls).toContain('fillStyle=#888888');
    light[0]=16;expect(()=>renderer.draw(frame([chunk]))).toThrow('0..15');
    renderer.features.tilePalettes!.register('strict', ['#00000000', '#11223380']);
    source.calls.length=0;tiles[0]=1;light[0]=15;renderer.draw(frame([chunk]));expect(source.calls).toContain('fillStyle=#11223380');
    expect(()=>renderer.features.tilePalettes!.register('bad',['red'])).toThrow('Invalid tile palette');
    renderer.dispose();expect(()=>renderer.features.tilePalettes!.register('x',colors)).toThrow('disposed');
  });
  it('hides celestial names in both renderers while retaining the body scene and other annotations', () => {
    for (const visible of [true, false]) {
      const scene: RenderFrame = { ...frame(), bodies: [{ id: 'home', name: 'Home', position: {x:0,y:0}, radius: 20 }], showBodyLabels: visible };
      const canvas = fake2d(), canvasRenderer = new CanvasRenderer(canvas.canvas); canvasRenderer.draw(scene);
      expect(canvas.calls.some(call => call.startsWith('fillText(HOME,'))).toBe(visible);
      expect(canvas.calls.some(call => call.startsWith('arc('))).toBe(true); canvasRenderer.dispose();
      const webgl = fakeGl(), webglRenderer = new WebGLRenderer(webgl.canvas); webglRenderer.draw(scene);
      expect(webgl.stats.texts.includes('HOME')).toBe(visible);
      expect(webgl.stats.draws.length).toBeGreaterThan(0); webglRenderer.dispose();
    }
  });
  it('hides planet orbit guides independently of bodies, names and module overlays in flight and body-only scenes', () => {
    for (const visible of [undefined, true, false]) {
      const scene: RenderFrame = { ...frame(OVERLAYS), bodies: [{ id: 'moon', name: 'Moon', position: {x:100,y:0}, radius: 10,
        parentPosition: {x:0,y:0}, orbitRadius: 100 }], showBodyOrbits: visible };
      for (const bodyOnly of [false, true]) {
        const canvas = fake2d(), canvasRenderer = new CanvasRenderer(canvas.canvas);
        if (bodyOnly) canvasRenderer.drawScene({ ...scene, time: 0 }); else canvasRenderer.draw(scene);
        expect(canvas.calls.includes('strokeStyle=#23374580')).toBe(visible !== false);
        expect(canvas.calls.some(call => call.startsWith('fillText(MOON,'))).toBe(true);
        expect(canvas.calls.some(call => call.startsWith('arc(600,300,20,'))).toBe(true);
        expect(canvas.calls.includes('fillText(MODULE,480,520)')).toBe(true);
        canvasRenderer.dispose();
        const webgl = fakeGl(), webglRenderer = new WebGLRenderer(webgl.canvas);
        if (bodyOnly) webglRenderer.drawScene({ ...scene, time: 0 }); else webglRenderer.draw(scene);
        expect(webgl.stats.draws.some(draw => draw.split(':')[1] === String('LINES'.length) && Number(draw.split(':')[2]) > 2)).toBe(visible !== false);
        expect(webgl.stats.texts).toContain('MOON');
        expect(webgl.stats.texts).toContain('MODULE');
        webglRenderer.dispose();
      }
    }
  });
  it('declare optional features instead of being identified by class', () => {
    const canvas = new CanvasRenderer(fake2d().canvas);
    expect(canvas.features.shaders).toBeUndefined();
    expect(typeof canvas.features.flush).toBe('function');
    const webgl = new WebGLRenderer(fakeGl().canvas);
    expect(webgl.features.shaders!.pack).toEqual(DEFAULT_SHADERS);
    const custom = { ...DEFAULT_SHADERS, name: 'Custom' };
    webgl.features.shaders!.set(custom);
    expect(webgl.features.shaders!.pack.name).toBe('Custom');
    expect(webgl.shaderPack.name).toBe('Custom');
    expect(Object.isFrozen(webgl.features)).toBe(true);
    webgl.dispose();
    expect(() => webgl.features.shaders!.set(DEFAULT_SHADERS)).toThrow('disposed');
  });
  it('draw module overlays in CSS pixels on Canvas 2D, above the scene', () => {
    const { calls, canvas } = fake2d();
    const renderer = new CanvasRenderer(canvas);
    renderer.draw(frame(OVERLAYS));
    expect(canvas.width).toBe(800);
    const start = calls.lastIndexOf('save()');
    const overlay = calls.slice(start);
    // The red screen line, the world disc at the view centre (10 m at 2 px/m), then the label.
    expect(overlay).toEqual(expect.arrayContaining(['moveTo(100,100)', 'lineTo(300,100)', 'strokeStyle=#ff0000', 'lineWidth=4',
      'arc(400,300,20,0,6.28)', 'fillStyle=#00ff0080', 'textAlign=right', 'fillText(MODULE,480,520)']));
    expect(overlay.indexOf('strokeStyle=#ff0000')).toBeLessThan(overlay.indexOf('fillText(MODULE,480,520)'));
    expect(calls.at(-1)).toBe('restore()');
    const before = calls.length;
    renderer.draw(frame());
    expect(calls.slice(before).some(c => c.startsWith('fillText(MODULE'))).toBe(false);
  });
  it('keeps Low graphics on the lite shader and compiles the full scene only when High is requested', () => {
    const { stats, canvas } = fakeGl();
    const renderer = new WebGLRenderer(canvas);
    for (let i = 0; i < 3; i++) renderer.draw({ ...frame(), theme: { highQuality: false } });
    expect(stats.created).toBe(4);
    renderer.draw({ ...frame(), theme: { highQuality: true } });
    expect(stats.created).toBe(5);
    expect(stats.programs).toBe(4);
    renderer.draw({ ...frame(), theme: { highQuality: true } });
    expect(stats.created).toBe(5);
    renderer.dispose();
    expect(stats.programs).toBe(0);
  });
  it('draw WebGL overlays through private passes, compiling the label pass only when needed', () => {
    const { stats, canvas } = fakeGl();
    const renderer = new WebGLRenderer(canvas);
    // Three pack programs (including the lite scene) plus the private colored pass.
    // Low graphics must never compile the unused full procedural scene.
    expect(stats.programs).toBe(4);
    renderer.draw({ ...frame(OVERLAYS.slice(0, 2)), theme: { highQuality: false } });
    expect(stats.programs).toBe(4);
    expect(stats.created).toBe(4);
    renderer.draw({ ...frame(OVERLAYS.slice(0, 2)), theme: { highQuality: true } });
    expect(stats.programs).toBe(4); // the full scene replaced the lite one
    renderer.draw({ ...frame(OVERLAYS), theme: { highQuality: true } });
    expect(stats.programs).toBe(5);
    // Exact module color whatever the shader pack: #3366ff as linear RGBA.
    expect(stats.colors).toContainEqual([.2, .4, 1, 1]);
    renderer.draw({ ...frame(OVERLAYS), theme: { highQuality: true } });
    expect(stats.created).toBe(6); // the lite scene, then the full one
    renderer.dispose(); renderer.dispose();
    expect(stats.programs).toBe(0);
  });
  it('withholds clipped-tile capability when WebGL did not provide a stencil buffer', () => {
    const gl = fakeGl(false), renderer = new WebGLRenderer(gl.canvas);
    expect(renderer.features.tileChunks).toBeUndefined();
    const tiles = new Uint16Array(1024); tiles[0] = 1;
    const chunk: OverlayPrimitive = { kind: 'tile-chunk', space: 'world', origin: { x: 0, y: 0 }, tileMetres: 1, size: 32, tiles };
    renderer.draw(frame([chunk])); expect(gl.stats.instancedDraws).toHaveLength(1);
    expect(() => renderer.draw(frame([{ ...chunk, clipPolygon: [{x:0,y:0}, {x:1,y:0}, {x:0,y:1}] }]))).toThrow('stencil buffer');
    renderer.dispose();
  });

  it('culls offscreen Canvas cells before raster work, including rotated chunk footprints', () => {
    const tiles = new Uint16Array(1024).fill(1);
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
      const canvas = fake2d(), renderer = new CanvasRenderer(canvas.canvas);
      renderer.draw(frame([{ kind: 'tile-chunk', space: 'world', origin: {x:0,y:0}, tileMetres:100, size:32, tiles,
        rotationRadians: angle }]));
      const calls = canvas.calls.filter(call => call.startsWith('fillRect(') && call.endsWith(',100,100)'));
      expect(calls.length).toBeGreaterThan(0); expect(calls.length).toBeLessThan(20);
      renderer.dispose();
    }
    const canvas = fake2d(), renderer = new CanvasRenderer(canvas.canvas);
    renderer.draw(frame([{ kind: 'tile-chunk', space: 'world', origin: {x:1e9,y:1e9}, tileMetres:100, size:32, tiles }]));
    expect(canvas.calls.filter(call => call.startsWith('fillRect(') && call.endsWith(',100,100)'))).toHaveLength(0);
    renderer.dispose();
  });

  it('transforms whole tile footprints and applies a concave clipping polygon before drawing', () => {
    const tiles = new Uint16Array(1024); tiles[0] = 1;
    const chunk: OverlayPrimitive = { kind: 'tile-chunk', space: 'world', origin: { x: 2, y: 3 },
      size: 32, tileMetres: .5, tiles, rotationRadians: Math.PI / 4,
      clipPolygon: [{x:0,y:0}, {x:.5,y:0}, {x:.5,y:.5}, {x:.25,y:.25}, {x:0,y:.5}] };
    for (const rotation of [0, Math.PI / 4, Math.PI / 2]) {
      const f = { ...frame([chunk]), camera: { ...frame().camera, rotation } };
      const canvas = fake2d(), cr = new CanvasRenderer(canvas.canvas);
      expect(cr.features.tileChunks?.version).toBe(1);
      cr.draw(f);
      const c = +(2 * Math.cos(rotation + Math.PI / 4)).toFixed(2);
      const s = +(2 * Math.sin(rotation + Math.PI / 4)).toFixed(2);
      expect(canvas.calls.some(call => call.startsWith(`transform(${c},${-s},${-s},${-c},`))).toBe(true);
      expect(canvas.calls).toContain('clip(evenodd)');
      expect(canvas.calls).toContain('fillRect(0,0,0.5,0.5)');
      expect(canvas.calls.indexOf('clip(evenodd)')).toBeLessThan(canvas.calls.indexOf('fillRect(0,0,0.5,0.5)'));
      cr.dispose();
      const gl = fakeGl(), wr = new WebGLRenderer(gl.canvas);
      expect(wr.features.tileChunks?.version).toBe(1);
      wr.draw(f);
      expect(gl.stats.instancedDraws).toHaveLength(1);
      expect(gl.stats.draws.some(draw => draw.endsWith(`:${'TRIANGLE_FAN'.length}:5`))).toBe(true);
      wr.dispose(); expect(gl.stats.programs).toBe(0);
    }
  });

  it('rejects invisible clip footprints before tile uploads/fills and preserves the following mutable chunk', () => {
    const tiles = new Uint16Array(1024).fill(1);
    const hidden: Extract<OverlayPrimitive, {kind:'tile-chunk'}> = { kind:'tile-chunk',space:'world',origin:{x:0,y:0},
      size:32,tileMetres:100,tiles,clipPolygon:[{x:600,y:0},{x:601,y:0},{x:601,y:1},{x:600,y:1}] };
    const visible = { ...hidden, tileMetres:1, clipPolygon:[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}] };
    const source = fakeGl(), gpu = new WebGLRenderer(source.canvas);
    gpu.draw(frame([hidden]));
    expect(source.stats.instancedDraws).toHaveLength(0); expect(source.stats.tileUploads).toHaveLength(0);
    expect(source.stats.colorMasks.some(mask => mask.every(value => !value))).toBe(false);
    gpu.draw(frame([hidden, visible]));
    expect(source.stats.instancedDraws).toHaveLength(1); expect(source.stats.tileUploads).toHaveLength(1);
    expect(source.stats.colorMasks.at(-1)).toEqual([true,true,true,true]);
    tiles[0] = 2; gpu.draw(frame([hidden, visible]));
    expect(source.stats.tileUploads.at(-1)![0]).toBe(2);
    gpu.dispose(); expect(source.stats.buffers.size).toBe(0);

    const drawing = fake2d(), cpu = new CanvasRenderer(drawing.canvas);
    cpu.draw(frame([hidden]));
    expect(drawing.calls.filter(c => c === 'clip(evenodd)')).toHaveLength(0);
    expect(drawing.calls.some(c => c.endsWith(',100,100)') && c.startsWith('fillRect('))).toBe(false);
    cpu.draw(frame([hidden, visible])); expect(drawing.calls).toContain('clip(evenodd)');
    expect(drawing.calls).toContain('fillRect(0,0,1,1)'); cpu.dispose();
  });

  it('retains touching clip edges and validates offscreen nibble buffers before culling', () => {
    const tiles = new Uint16Array(1024).fill(1);
    const chunk: Extract<OverlayPrimitive, {kind:'tile-chunk'}> = { kind:'tile-chunk',space:'world',origin:{x:200-.125,y:0},
      size:32,tileMetres:1,tiles,clipPolygon:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] };
    const source = fakeGl(), gpu = new WebGLRenderer(source.canvas); gpu.draw(frame([chunk]));
    expect(source.stats.instancedDraws).toHaveLength(1);
    const drawing = fake2d(), cpu = new CanvasRenderer(drawing.canvas);cpu.draw(frame([chunk]));
    expect(drawing.calls).toContain('clip(evenodd)');
    const invalid = { ...chunk,origin:{x:1e9,y:1e9},lightEncoding:'nibble' as const,light:new Uint8Array(1024).fill(16) };
    expect(() => gpu.draw(frame([invalid]))).toThrow(); expect(() => cpu.draw(frame([invalid]))).toThrow();
    gpu.dispose();cpu.dispose();
  });

  it('renders 32x32 tile chunks with instanced draw calls in WebGL 2 and fillRect in Canvas 2D', () => {
    const tiles1 = new Uint16Array(1024);
    tiles1[0] = 1; // Stone
    tiles1[1] = 2; // Regolith
    tiles1[32] = 15; // HullBlock
    const light1 = new Uint8Array(1024).fill(15);

    const tiles2 = new Uint16Array(1024);
    tiles2[500] = 7; // CoreMagma

    const chunk1: OverlayPrimitive = {
      kind: 'tile-chunk',
      space: 'world',
      origin: { x: 0, y: 0 },
      tileMetres: 0.5,
      size: 32,
      tiles: tiles1,
      light: light1,
    };
    const chunk2: OverlayPrimitive = {
      kind: 'tile-chunk',
      space: 'world',
      origin: { x: 16, y: 0 },
      tileMetres: 0.5,
      size: 32,
      tiles: tiles2,
      paletteId: 'custom-palette',
    };

    // 1. WebGL 2 rendering
    const webgl = fakeGl();
    const webglRenderer = new WebGLRenderer(webgl.canvas);
    expect(webgl.stats.programs).toBe(4); // Lite scene + vector + text + terrain

    // Register a custom palette
    webglRenderer.features.tilePalettes?.register('custom-palette', ['#00000000', '#112233', '#445566']);

    // Draw frame containing both chunks
    webglRenderer.draw(frame([chunk1, chunk2]));

    // tileChunkProgram was compiled on-demand: program count incremented by 1
    expect(webgl.stats.programs).toBe(5);

    // Exactly 1 instanced draw call per chunk (2 chunks = 2 draw calls)
    expect(webgl.stats.instancedDraws).toHaveLength(2);
    for (const draw of webgl.stats.instancedDraws) {
      const parts = draw.split(':');
      expect(Number(parts[2])).toBe(4); // 4 vertices (quad strip)
      expect(Number(parts[3])).toBe(1024); // 1024 tile instances
    }

    webglRenderer.dispose();
    expect(webgl.stats.programs).toBe(0);

    // 2. Canvas 2D fallback rendering
    const canvas = fake2d();
    const canvasRenderer = new CanvasRenderer(canvas.canvas);
    canvasRenderer.features.tilePalettes?.register('custom-palette', ['#00000000', '#112233', '#445566']);
    canvasRenderer.draw(frame([chunk1, chunk2]));

    // Verifies fillRect was called for non-zero tiles
    expect(canvas.calls.some(c => c.startsWith('fillRect('))).toBe(true);
    canvasRenderer.dispose();
  });
});
