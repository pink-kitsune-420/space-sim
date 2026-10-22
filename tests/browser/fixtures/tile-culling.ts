import { CanvasRenderer } from '../../../modules/render-canvas/src/canvas';
import { WebGLRenderer } from '../../../modules/render-webgl/src/webgl';
import { legacyRenderPorts } from '../../../packages/render-2d/src/compatibility';
import { DEFAULT_SHADERS } from '../../../packages/render-2d/src/index';
import { initialState } from '../../../packages/sim-core/src/index';
import { createTileChunkOwner, type OverlayPrimitive, type Renderer, type RenderFrame, type SceneRenderer, type Disposable } from '../../../packages/game-api/src/index';
import { validateOverlay } from '../../../packages/game-runtime/src/presentation';
import { createCanvasDrawing } from '../../../modules/render-canvas/src/index';
import { createWebGLDrawing } from '../../../modules/render-webgl/src/index';

declare const __CULLING_FIXTURE_SLOT__: string;
type Trial = { renderer: 'Canvas' | 'WebGL'; cap: number; rotation: number; cameraRotation: number;
  x: number; y: number; base?: number; mix?: boolean; mutate?: boolean; scale?: number;
  revision?: number; contentId?:number; validated?: boolean; factory?: boolean; scene?: boolean; paletteFlip?: boolean };
let owner = createTileChunkOwner(), epoch = 0;
const active = new Map<string, { renderer: Renderer; canvas: HTMLCanvasElement; tiles: Uint16Array;
  factory?: Disposable; walls: Uint16Array; light: Uint8Array; counts: { tiles: number; fills: number } }>();
const keyFor = (t: Pick<Trial,'renderer'|'cap'|'factory'>) => t.renderer + t.cap + (t.factory ? '-factory' : '-direct');

async function run(t: Trial) {
  const key = keyFor(t);
  let entry = active.get(key);
  if (!entry) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:320px;height:240px';
    document.body.append(canvas);
    const ports = { ...legacyRenderPorts, maxPixelRatio: t.cap };
    const factory = t.factory ? (t.renderer === 'Canvas' ? createCanvasDrawing(ports.geometry) : createWebGLDrawing(ports.geometry)) : undefined;
    const renderer: Renderer = t.factory
      ? t.renderer === 'Canvas' ? (factory as ReturnType<typeof createCanvasDrawing>).create(canvas, ports)
        : (factory as ReturnType<typeof createWebGLDrawing>).create(canvas, DEFAULT_SHADERS, ports)
      : t.renderer === 'Canvas' ? new CanvasRenderer(canvas, ports) : new WebGLRenderer(canvas, DEFAULT_SHADERS, ports);
    const counts = { tiles: 0, fills: 0 };
    if (t.renderer === 'WebGL') {
      const gl = canvas.getContext('webgl2')!, draw = gl.drawArraysInstanced.bind(gl);
      gl.drawArraysInstanced = (...args) => { counts.tiles++; draw(...args); };
      renderer.features!.shaders!.set({ ...DEFAULT_SHADERS, name: 'Culling v1 fixture' });
    } else {
      const ctx = canvas.getContext('2d')!, fill = ctx.fillRect.bind(ctx);
      ctx.fillRect = (...args) => { counts.fills++; fill(...args); };
    }
    entry = { renderer, canvas, factory, counts, tiles: new Uint16Array(1024), walls: new Uint16Array(1024), light: new Uint8Array(1024) };
    active.set(key, entry);
  }
  const { renderer, canvas, counts, tiles, walls, light } = entry;
  for (let i = 0; i < 1024; i++) { tiles[i] = i % 4 === 0 ? 0 : i % 3 + 1; walls[i] = i % 4 === 0 ? 1 : 0; light[i] = i % 16; }
  tiles[0] = t.mutate ? 2 : 1; light[0] = t.mutate ? 15 : 0;
  renderer.features!.tilePalettes!.register('fixture', t.paletteFlip ? ['#00000000','#ffffff','#ff00ff','#33aa4480'] : t.mutate ? ['#00000000', '#ffffff', '#33aaff', '#80402080'] : ['#00000000', '#ffffff', '#ff9933', '#80402080']);
  const base = t.base ?? 0, cc = Math.cos(t.cameraRotation), cs = Math.sin(t.cameraRotation), scale = t.scale ?? 16;
  const origin = (x: number, y: number) => ({ x: base + (cc * (x - 160) + cs * (120 - y)) / scale,
    y: -base + (-cs * (x - 160) + cc * (120 - y)) / scale });
  const chunk: Extract<OverlayPrimitive, { kind: 'tile-chunk' }> = { kind: 'tile-chunk', space: 'world',
    origin: origin(t.x, t.y), size: 32, tileMetres: 1, tiles, walls, light, lightEncoding: 'nibble', paletteId: 'fixture',
    rotationRadians: t.rotation, clipPolygon: [{x:0,y:0},{x:2,y:0},{x:2,y:1},{x:1,y:1},{x:1,y:2},{x:0,y:2}] };
  if (t.revision !== undefined) Object.assign(chunk, {contentRevision:{owner,id:t.contentId??0,revision:t.revision}});
  const overlays: OverlayPrimitive[] = [chunk];
  if (t.mix) {
    overlays.push({ ...chunk, origin: origin(120, 120) });
    overlays.push({ ...chunk, origin: origin(210, 90), clipPolygon: undefined, lightEncoding: undefined, light: undefined, walls: undefined,
      contentRevision:t.revision!==undefined?{owner,id:(t.contentId??0)+1,revision:t.revision}:undefined });
  }
  overlays.push({ kind: 'circle', space: 'screen', center: {x:8,y:8}, radius:6, color: '#00ff00', fill:true });
  const frame: RenderFrame = { state: initialState(), path: [], pathClosed: false, engine: false,
    bodies: [{id:'far',name:'',position:{x:1e20,y:1e20},radius:1}], camera: {center:{x:base,y:-base},rotation:t.cameraRotation,scale},
    theme: {highQuality:false,backdropStyle:'void',starsVisible:false,nebulaVisible:false,galaxiesVisible:false,gridEnabled:false},
    showShip:false,showScale:false,showBodyLabels:false,showShipLabels:false,overlays:t.validated ? validateOverlay(overlays) : overlays };
  counts.tiles = counts.fills = 0;
  if (t.scene) (renderer as SceneRenderer).drawScene({...frame,time:0}); else renderer.draw(frame);
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  const gl = t.renderer === 'WebGL' ? canvas.getContext('webgl2')! : null;
  if (gl) gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  else pixels.set(canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data);
  const x = Math.floor(8 * canvas.width / 320), y = Math.floor(8 * canvas.height / 240);
  const i = ((gl ? canvas.height - 1 - y : y) * canvas.width + x) * 4;
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))).map(x => x.toString(16).padStart(2,'0')).join('');
  const gpuInfo = gl?.getExtension('WEBGL_debug_renderer_info');
  return { digest, backing: [canvas.width,canvas.height], sentinel: Array.from(pixels.slice(i,i+4)), counts: {...counts},
    gpu: gpuInfo ? String(gl!.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL)) : null, glError: gl?.getError() ?? 0,
    epoch,ownerDisposed:owner.disposed,revision:chunk.contentRevision?.revision,
    ownerPreserved:!t.validated || t.revision===undefined || (frame.overlays![0] as typeof chunk).contentRevision?.owner===owner,
    revisionCaps:renderer.features?.tileChunks?.revisions ? {version:renderer.features.tileChunks.revisions.version,
      maxEntries:renderer.features.tileChunks.revisions.maxEntries,maxBytes:renderer.features.tileChunks.revisions.maxBytes}:null };
}
function close(t:Pick<Trial,'renderer'|'cap'|'factory'>) {const key=keyFor(t),entry=active.get(key);entry?.factory ? entry.factory.dispose() : entry?.renderer.dispose?.();entry?.canvas.remove();active.delete(key);return owner.disposed;}
function release(t:Pick<Trial,'renderer'|'cap'|'factory'|'contentId'>) {active.get(keyFor(t))?.renderer.features?.tileChunks?.revisions?.release({owner,id:t.contentId??0,revision:1});return owner.disposed;}
function lose(t:Pick<Trial,'renderer'|'cap'|'factory'>) {const gl=active.get(keyFor(t))?.canvas.getContext('webgl2'),ext=gl?.getExtension('WEBGL_lose_context');ext?.loseContext();return !!ext;}
Object.assign(window, { ['tileCulling_' + __CULLING_FIXTURE_SLOT__]: { run,close,release,lose,
  disposeOwner(){owner.dispose();return owner.disposed;},newWorld(){owner.dispose();owner=createTileChunkOwner();return ++epoch;} } });
