import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OverlayPrimitive, RenderFrame } from '../../packages/game-api/src/index';
import { CanvasRenderer, DEFAULT_SHADERS, WebGLRenderer } from '../../packages/render-2d/src/index';
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

function fakeGl() {
  const stats = { programs: 0, created: 0, colors: [] as number[][], draws: [] as string[], texts: [] as string[] };
  let program: unknown, linked = 0;
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined;
      if (/^[A-Z_0-9]+$/.test(key)) return key.length; // Distinct enum stand-ins.
      switch (key) {
        case 'createProgram': return () => { stats.programs++; stats.created++; return { id: ++linked }; };
        case 'deleteProgram': return (p: unknown) => { if (p) stats.programs--; };
        case 'getShaderParameter': case 'getProgramParameter': return (_: unknown, parameter: number) => parameter === 'LINK_STATUS'.length || parameter === 'COMPILE_STATUS'.length ? true : 0;
        case 'getFragDataLocation': case 'getAttribLocation': return () => 0;
        case 'useProgram': return (p: unknown) => { program = p; };
        case 'uniform4f': return (_: unknown, ...rgba: number[]) => { stats.colors.push(rgba.map(c => +c.toFixed(2))); };
        case 'drawArrays': return (mode: number, _first: number, count: number) => { stats.draws.push(`${(program as { id: number } | undefined)?.id}:${mode}:${count}`); };
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
    expect(canvas.width).toBe(1600);
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
});
