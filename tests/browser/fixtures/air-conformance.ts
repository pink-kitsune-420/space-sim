import { WebGLRenderer, DEFAULT_SHADERS } from '../../../packages/render-2d/src/index';
import { CanvasRenderer } from '../../../modules/render-canvas/src/canvas';
import { legacyRenderPorts } from '../../../packages/render-2d/src/compatibility';
import { createSurfaceProfile } from '../../../packages/sim-core/src/surface';
import { initialState } from '../../../packages/sim-core/src/index';
import type { RenderAir, Renderer } from '../../../packages/game-api/src/index';

type Trial = { renderer: 'Canvas' | 'WebGL'; rotation: number; scale: number; near: boolean; phase?: number; origin?: number; backdrop?: 'magenta' | 'green' };
let active: Renderer | undefined;
/** Standalone fresh production fixture; raw framebuffer oracle, no test code in game. */
function run(t: Trial) {
  active?.dispose?.();
  const old = document.querySelector<HTMLCanvasElement>('#fixture')!, canvas = old.cloneNode() as HTMLCanvasElement; old.replaceWith(canvas);
  const renderer = t.renderer === 'Canvas' ? new CanvasRenderer(canvas, { ...legacyRenderPorts, ...(t.backdrop ? { theme: {
    current: () => ({}), backdrop(ctx, width, height) { ctx.fillStyle=t.backdrop==='magenta'?'#ff00ff':'#00ff00';ctx.fillRect(0,0,width,height); },
  } } : {}) }) : new WebGLRenderer(canvas);
  active = renderer;
  const ox = t.origin ?? 0, oy = -ox;
  const body = { id:'air',name:'',position:{x:ox,y:oy},radius:100,surface:createSurfaceProfile(100,[0,2,0,-1,0,1,-2,0]),
    color:'#414141',accentColor:'#999999',atmosphereColor:'#6ab4ec80',rotation:t.rotation };
  const air: RenderAir = { mode:'clouds',heightMetres:30,cloudAltitudeMetres:10,cloudThicknessMetres:4,
    color:[.4,.7,.9],opacity:.3,phaseRadians:t.phase??.4,sunDirection:{x:0,y:1} };
  const overlap = { id:'occluder',name:'',position:{x:ox+36,y:oy+112},radius:12,
    surface:createSurfaceProfile(12,[0,0,0,0]),color:'#775544',accentColor:'#775544',atmosphereColor:'#00000000' };
  const center = t.near ? {x:ox,y:oy+103} : {x:ox,y:oy};
  const frame = {state:initialState(),path:[],pathClosed:false,engine:false,camera:{center,rotation:0,scale:t.scale},
    theme:{highQuality:false,backdropStyle:'void' as const,starsVisible:false,nebulaVisible:false,galaxiesVisible:false,gridEnabled:false},
    showShip:false,showPad:false,showScale:false,showBodyLabels:false,presentationTime:0,
    overlays:[{kind:'line' as const,closed:true,fill:true,space:'world' as const,points:[{x:ox-3,y:oy+125},{x:ox+3,y:oy+125},{x:ox+3,y:oy+131},{x:ox-3,y:oy+131}],color:'#00ff00'}]};
  renderer.features.shaders?.set({...DEFAULT_SHADERS,name:'Air custom v1', ...(t.backdrop ? {passes:{...DEFAULT_SHADERS.passes,
    scene:{...DEFAULT_SHADERS.passes.scene,fragment:`#version 300 es
precision highp float;out vec4 fragColor;void main(){fragColor=${t.backdrop==='magenta'?'vec4(1.,0.,1.,1.)':'vec4(0.,1.,0.,1.)'};}`}}} : {})});
  const capture = (mode:RenderAir['mode']) => {
    renderer.draw({...frame,bodies:[{...body,air:{...air,mode}},overlap]});
    const pixels = new Uint8Array(canvas.width*canvas.height*4);
    if(t.renderer==='Canvas')pixels.set(canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data);
    else {const gl=canvas.getContext('webgl2')!;gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);}
    return pixels;
  };
  const off = capture('off'), clouds = capture('clouds');
  const dpr=canvas.width/canvas.clientWidth;
  let groundChanged=0,overlapChanged=0,skyChanged=0,cueChanged=0;
  for(let sy=0;sy<canvas.height;sy++)for(let sx=0;sx<canvas.width;sx++){
    const x=(sx/dpr-canvas.clientWidth/2)/t.scale,y=(canvas.clientHeight/2-sy/dpr)/t.scale+(t.near?103:0);
    const index=((t.renderer==='WebGL'?canvas.height-1-sy:sy)*canvas.width+sx)*4;
    const changed=Math.max(...[0,1,2].map(c=>Math.abs(off[index+c]!-clouds[index+c]!)))>2;
    if(Math.hypot(x,y)<94 && changed)groundChanged++;
    if(Math.hypot(x-36,y-112)<10 && changed)overlapChanged++;
    if(x>-2&&x<2&&y>126&&y<130&&changed)cueChanged++;
    if(Math.hypot(x,y)>106&&changed)skyChanged++;
  }
  const gl=t.renderer==='WebGL'?canvas.getContext('webgl2'):null,ext=gl?.getExtension('WEBGL_debug_renderer_info');
  const probe=(pixels:Uint8Array)=>{const x=Math.floor(32*dpr),y=Math.floor(32*dpr);
    const i=((t.renderer==='WebGL'?canvas.height-1-y:y)*canvas.width+x)*4;return Array.from(pixels.slice(i,i+4));};
  return {offSky:probe(off),cloudSky:probe(clouds),groundChanged,overlapChanged,cueChanged,skyChanged,glError:gl?.getError()??0,
    gpu:ext?gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,capability:renderer.features.independentAir};
}
Object.assign(window,{airFixture:{run}});
