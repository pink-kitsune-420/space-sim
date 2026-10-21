import { CanvasRenderer, WebGLRenderer, DEFAULT_SHADERS } from '../../../packages/render-2d/src/index';
import { requireTileChunkFeatures, type OverlayPrimitive, type Renderer } from '../../../packages/game-api/src/index';
import { initialState } from '../../../packages/sim-core/src/index';

type Trial = { renderer: 'Canvas' | 'WebGL'; rotation: number; cameraRotation: number; light?: boolean; unknownPalette?: boolean; legacy?: boolean; replace?: boolean; alpha?: boolean; reuse?: boolean };
/** Compiled by Vite as a separate production-only conformance fixture, never in the game. */
let active: Renderer | undefined;
function run(trial: Trial) {
  active?.dispose?.();
  const canvas = document.querySelector<HTMLCanvasElement>('#fixture')!;
  const next = canvas.cloneNode() as HTMLCanvasElement; canvas.replaceWith(next);
  const renderer: Renderer = trial.renderer === 'Canvas' ? new CanvasRenderer(next) : new WebGLRenderer(next);
  requireTileChunkFeatures(renderer.features, {lightEncoding:'nibble', walls:true});
  const palette = ['#00000000', '#ffffff', '#80402080'];
  renderer.features!.tilePalettes!.register('test', palette); palette[1] = '#ff0000';
  if (trial.replace) renderer.features!.tilePalettes!.register('test', ['#00000000', '#ffffff', '#80402080']);
  const tiles = new Uint16Array(1024), walls = new Uint16Array(1024), light = new Uint8Array(1024).fill(15);
  tiles[0] = 1; tiles[1] = 1; walls[32] = 1; tiles[33] = trial.alpha ? 2 : 1023; light[0] = 0;
  const chunk: OverlayPrimitive = {kind:'tile-chunk',space:'world',origin:{x:-1,y:-1},size:32,tileMetres:1,
    rotationRadians:trial.rotation, clipPolygon:[{x:0,y:0},{x:2,y:0},{x:2,y:1.75},{x:0,y:1.75}],
    tiles,walls,paletteId:trial.unknownPalette?'unknown':'test',
    ...(!trial.legacy ? {lightEncoding:'nibble'} as const : {}), ...(trial.light !== false ? {light}: {})};
  const frame = {state:initialState(),path:[],pathClosed:false,engine:false,bodies:[{id:'far',name:'',position:{x:1e9,y:1e9},radius:1}],
    camera:{center:{x:.25,y:-.4},rotation:trial.cameraRotation,scale:32},theme:{highQuality:false,backdropStyle:'void' as const,starsVisible:false,nebulaVisible:false,galaxiesVisible:false,gridEnabled:false},
    showShip:false,showScale:false,showBodyLabels:false,showShipLabels:false,overlays:[chunk]};
  if (renderer.features?.shaders) renderer.features.shaders.set({...DEFAULT_SHADERS,name:'Conformance custom v1 pack'});
  renderer.draw(frame);
  if(trial.reuse){light[0]=15;renderer.draw(frame);}
  const width=next.width,height=next.height, pixels=new Uint8Array(width*height*4);
  if(trial.renderer==='WebGL') {
    const gl=next.getContext('webgl2')!;gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  } else pixels.set(next.getContext('2d')!.getImageData(0,0,width,height).data);
  const sample=(x:number,y:number)=>{
    const bc=Math.cos(trial.rotation),bs=Math.sin(trial.rotation),cc=Math.cos(trial.cameraRotation),cs=Math.sin(trial.cameraRotation);
    const wx=-1+x*bc-y*bs-.25,wy=-1+x*bs+y*bc+.4;
    const dpr=width/next.clientWidth;
    const sx=Math.floor((next.clientWidth/2+(wx*cc-wy*cs)*32)*dpr),sy=Math.floor((next.clientHeight/2-(wx*cs+wy*cc)*32)*dpr);
    if(sx<0||sy<0||sx>=width||sy>=height)throw new Error('Conformance probe outside viewport');
    const i=((trial.renderer==='WebGL'?height-1-sy:sy)*width+sx)*4;
    return Array.from(pixels.slice(i,i+4));
  };
  const gl=trial.renderer==='WebGL'?next.getContext('webgl2'):null;
  const gpuInfo=gl?.getExtension('WEBGL_debug_renderer_info');
  const result={gpu:gpuInfo?gl!.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL):null,samples:[sample(.5,.5),sample(1.5,.5),sample(.5,1.5),sample(1.5,1.5),sample(.5,1.9)],
    features:renderer.features?.tileChunks,glError:trial.renderer==='WebGL'?next.getContext('webgl2')!.getError():0};
  active=renderer;return result;
}
Object.assign(window,{tileFixture:{run}});
