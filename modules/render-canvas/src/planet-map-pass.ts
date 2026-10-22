/** First-party MIT simplified single-view planet sampling; no field generation. */
import{PlanetMapFrame,PlanetCoverMesh,planetMapColor,planetDisplayChannel,linearColor,type RenderBody,type Camera}from'@space-sim/game-api';
import type{TerrainGeometry}from'./terrain';
export class PlanetMapPass{
 private readonly frame=new PlanetMapFrame();private readonly mesh=new PlanetCoverMesh();
 private readonly work:HTMLCanvasElement;private readonly context:CanvasRenderingContext2D;private readonly pixels:ImageData;
 private readonly polar=new Float64Array(7);private readonly color=new Float64Array(4);
 constructor(canvas:HTMLCanvasElement){this.work=canvas.ownerDocument.createElement('canvas');this.work.width=this.work.height=512;const ctx=this.work.getContext('2d');if(!ctx)throw Error('Planet raster unavailable');this.context=ctx;this.pixels=ctx.createImageData(512,512);}
 private clip(ctx:CanvasRenderingContext2D,g:TerrainGeometry){ctx.beginPath();if(g.groundClip.length){ctx.moveTo(g.groundClip[0]!.x,g.groundClip[0]!.y);for(let i=1;i<g.groundClip.length;i++)ctx.lineTo(g.groundClip[i]!.x,g.groundClip[i]!.y);}ctx.closePath();ctx.clip();}
 drawMap(ctx:CanvasRenderingContext2D,b:RenderBody,camera:Camera,g:TerrainGeometry,width:number,height:number){
  const p=b.surface,map=b.overview?.planet;if(!p||!map||!this.frame.update(b,camera,width,height)||this.frame.opacity<=0)return;
  const f=this.frame,r=p.bounds.maxRadius*f.scale,cx=width/2-f.cameraRadius*f.axisX*f.scale,cy=height/2+f.cameraRadius*f.axisY*f.scale;
  const left=Math.max(0,Math.floor(cx-r-1)),top=Math.max(0,Math.floor(cy-r-1)),right=Math.min(width,Math.ceil(cx+r+1)),bottom=Math.min(height,Math.ceil(cy+r+1));if(right<=left||bottom<=top)return;
  const rw=Math.min(512,right-left),rh=Math.min(512,bottom-top),sx=(right-left)/rw,sy=(bottom-top)/rh,data=this.pixels.data,q=this.polar,c=this.color;
  for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){
   const i=(y*512+x)*4;f.sample(left+(x+.5)*sx,top+(y+.5)*sy,width,height,p,q);if(q[3]!>1){data[i+3]=0;continue;}
   planetMapColor(map,q[4]!,q[5]!,c,p);const z=Math.sqrt(Math.max(0,1-q[4]!*q[4]!-q[5]!*q[5]!)),light=.12+.88*Math.max(0,Math.min(1,q[4]!*f.sunX+q[5]!*f.sunY+.35*z));
   for(let k=0;k<3;k++)data[i+k]=planetDisplayChannel((c[3]!>0?c[k]!/c[3]!:0)*light);data[i+3]=Math.round(c[3]!*255);
  }
  this.context.putImageData(this.pixels,0,0,0,0,rw,rh);ctx.save();this.clip(ctx,g);ctx.globalAlpha=f.opacity;ctx.imageSmoothingEnabled=true;ctx.drawImage(this.work,0,0,rw,rh,left,top,right-left,bottom-top);ctx.restore();
 }
 drawCover(ctx:CanvasRenderingContext2D,b:RenderBody,camera:Camera,g:TerrainGeometry,width:number,height:number){
  const p=b.surface,map=b.overview?.planet;if(!p||!map||!this.frame.update(b,camera,width,height))return;const f=this.frame;this.mesh.update(map,f,g.boundary,width,height,0);if(!this.mesh.length)return;
  ctx.save();this.clip(ctx,g);const v=this.mesh.vertices,q=this.polar;
  for(let i=0;i<this.mesh.length;i+=12){
   const x=(v[i]!+v[i+2]!)/2,y=(v[i+1]!+v[i+3]!)/2;f.sample(x,y,width,height,p,q);if(p.seaRadiusMetres!==undefined&&p.referenceRadius+q[6]!<p.seaRadiusMetres)continue;
   const a=q[0]!*4,bb=((q[0]!+1)%p.sampleCount)*4,t=q[1]!,aa=map.equator[a+3]!/255,ab=map.equator[bb+3]!/255,alpha=aa*(1-t)+ab*t;if(!alpha)continue;
   const c=this.color;for(let k=0;k<3;k++)c[k]=planetDisplayChannel((linearColor(map.equator[a+k]!/255)*aa*(1-t)+linearColor(map.equator[bb+k]!/255)*ab*t)/alpha);
   ctx.fillStyle=`rgba(${c[0]},${c[1]},${c[2]},${alpha})`;ctx.beginPath();ctx.moveTo(v[i]!,v[i+1]!);ctx.lineTo(v[i+2]!,v[i+3]!);ctx.lineTo(v[i+4]!,v[i+5]!);ctx.lineTo(v[i+10]!,v[i+11]!);ctx.closePath();ctx.fill();
  }ctx.restore();
 }
}
