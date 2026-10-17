/** Bundled only by the browser test; no test hooks or assets ship in the app. Draws one frame of
 * module overlays with a real renderer and reports pixel colors at CSS-pixel probes. */
import { CanvasRenderer, WebGLRenderer, type Renderer } from '../../packages/render-2d/src/index';
import { initialState } from '../../packages/sim-core/src/index';
import type { OverlayPrimitive } from '../../packages/game-api/src/index';

let renderer: Renderer | undefined;
export const OVERLAYS: readonly OverlayPrimitive[] = [
  { kind: 'line', space: 'screen', points: [{ x: 100, y: 100 }, { x: 300, y: 100 }], color: '#ff0000', width: 4 },
  // Camera scale 2 px/m centred on the origin: world (0, 0) is the view centre and +Y is up.
  { kind: 'circle', space: 'world', center: { x: 0, y: 0 }, radius: 10, color: '#00ff00', fill: true },
  { kind: 'line', space: 'world', points: [{ x: -75, y: -75 }, { x: 75, y: -75 }], color: '#ffff00', width: 3 },
  { kind: 'circle', space: 'screen', center: { x: 650, y: 150 }, radius: 30, color: '#ff00ff', width: 3 },
  { kind: 'text', space: 'screen', at: { x: 480, y: 520 }, text: 'OVERLAY TEXT', color: '#3366ff' },
  // A planet-sized ring whose nearest edge crosses the view at x = 600: drawn as its visible arc.
  { kind: 'circle', space: 'world', center: { x: 1e12, y: 0 }, radius: 1e12 - 100, color: '#00ffff', width: 2 },
];

export function draw(options: { renderer: 'canvas' | 'webgl'; probes: readonly { x: number; y: number }[];
  boxes: readonly { x0: number; y0: number; x1: number; y1: number }[] }) {
  renderer?.dispose?.();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:800px;height:600px;display:block';
  document.body.replaceChildren(canvas);
  renderer = options.renderer === 'canvas' ? new CanvasRenderer(canvas) : new WebGLRenderer(canvas);
  renderer.draw({ state: initialState(), path: [], pathClosed: false, engine: false,
    camera: { center: { x: 0, y: 0 }, rotation: 0, scale: 2 },
    bodies: [{ id: 'far', name: '', position: { x: 1e9, y: 1e9 }, radius: 1 }],
    shipWorldPosition: { x: 1e20, y: 1e20 }, padPosition: { x: 1e20, y: 1e20 }, overlays: OVERLAYS });
  const dpr = canvas.width / 800;
  const gl = options.renderer === 'webgl' ? canvas.getContext('webgl2')! : null;
  const ctx = options.renderer === 'canvas' ? canvas.getContext('2d')! : null;
  const pixels = gl ? new Uint8Array(canvas.width * canvas.height * 4) : ctx!.getImageData(0, 0, canvas.width, canvas.height).data;
  if (gl) gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels as Uint8Array);
  const pixel = (x: number, y: number): number[] => {
    const px = Math.floor(x * dpr), py = gl ? canvas.height - 1 - Math.floor(y * dpr) : Math.floor(y * dpr);
    return Array.from(pixels.slice((py * canvas.width + px) * 4, (py * canvas.width + px) * 4 + 4));
  };
  const box = (b: { x0: number; y0: number; x1: number; y1: number }): number[][] => {
    const out: number[][] = [];
    for (let y = b.y0; y < b.y1; y += 1 / dpr) for (let x = b.x0; x < b.x1; x += 1 / dpr) out.push(pixel(x, y));
    return out;
  };
  return { size: [canvas.width, canvas.height], error: gl?.getError() ?? 0, probes: options.probes.map(p => pixel(p.x, p.y)),
    boxes: options.boxes.map(box) };
}
