import{beforeAll,describe,expect,it}from'vitest';
import{buildPlanetMap,planetMapColor,PlanetMapFrame,PlanetCoverMesh,createPlanetField,type RenderBody,type RenderOverview,type RenderPlanetMap,type SurfaceProfile}from'../../packages/game-api/src/index';
import{generateSurface,querySurface}from'../../packages/sim-core/src/surface';
import{terrainGeometry}from'../../modules/render-webgl/src/terrain';
import{buildOverview}from'../../apps/web/src/successor-overview';
import{MATERIAL_DOMAINS}from'../../apps/web/src/successor-materials';
let profile:SurfaceProfile,map:RenderPlanetMap,levels:RenderOverview['levels'];
beforeAll(()=>{profile=generateSurface({radius:2048,surface:{kind:'planet',generatorVersion:2,recipe:'oceanic',seed:741,radiusMetres:2048,maxReliefMetres:48,continentWavelengthMetres:1100,rangeWavelengthMetres:280,hillWavelengthMetres:80,octaves:4,seaRadiusMetres:2051.09375,sampleCount:8192,orientationRadians:0}});const built=buildPlanetMap(profile);map=built.planet;levels=built.levels;});
const body=():RenderBody=>({id:'planet',name:'Primus',position:{x:0,y:0},radius:2048,surface:profile,overview:{levels,planet:map},rotation:0});
describe('shared polar planet appearance',()=>{
 it('classifies orbital pixels from the exact same physical field with no polar seam',()=>{
  const field=createPlanetField(profile.planet!.definition),out=new Float64Array(8);let checked=0,water=0,land=0;
  for(let i=0;i<512*512;i+=197){const x=(i%512+.5)/512*2-1,y=(Math.floor(i/512)+.5)/512*2-1,r=x*x+y*y,a=map.rgba[i*4+3]!;if(r>1){expect(a).toBe(0);continue;}expect(a).toBe(255);field.evaluate(x,y,Math.sqrt(1-r),out);const wet=2048+out[0]!<profile.seaRadiusMetres!,blue=map.rgba[i*4+2]!>map.rgba[i*4+1]!&&map.rgba[i*4+2]!>map.rgba[i*4]!;expect(blue).toBe(wet);if(wet)water++;else land++;checked++;}
  expect(checked).toBeGreaterThan(500);expect(water).toBeGreaterThan(100);expect(land).toBeGreaterThan(100);
  const i=(256*512+256)*4,j=(255*512+255)*4;for(let c=0;c<3;c++)expect(Math.abs(map.rgba[i+c]!-map.rgba[j+c]!)).toBeLessThan(5);
 });
 it('keeps skin colors out of rock columns and removes skin beneath actual ocean',()=>{
  expect(map.coverMetres).toBe(.35);for(let i=0;i<8192;i+=17)expect(map.equator[i*4+3]).toBe(profile.referenceRadius+profile.sampleElevation(i)<profile.seaRadiusMetres!?0:255);
  expect(map.rgba.byteLength).toBe(1048576);expect(map.equator.byteLength).toBe(32768);expect(map.storageBytes).toBe(1081344);
  expect(levels[0]!.sectors).toBe(1);expect(levels.at(-1)!.sectors).toBe(128);expect(levels.at(-1)!.rings).toBe(16);expect(levels.every(l=>l.sectors*l.rings<=2048&&l.rgba.every(Number.isFinite))).toBe(true);
 });
 it('reconstructs the physical equator instead of sampling an adjacent latitude at the atlas rim',()=>{
  const color=new Float64Array(4);let priorWrong=0,correctedWrong=0;
  for(let i=0;i<profile.sampleCount;i++){
   const a=i*2*Math.PI/profile.sampleCount,x=Math.cos(a),y=Math.sin(a),wet=profile.referenceRadius+profile.sampleElevation(i)<profile.seaRadiusMetres!;
   planetMapColor(map,x,y,color);if((color[2]!>color[1]!&&color[2]!>color[0]!)!==wet)priorWrong++;
   planetMapColor(map,x,y,color,profile);if((color[2]!>color[1]!&&color[2]!>color[0]!)!==wet)correctedWrong++;
   expect(color[3]).toBeCloseTo(1,12);
  }
  expect(priorWrong).toBeGreaterThan(100);expect(correctedWrong).toBe(0);
 });
 it('samples in linear light, premultiplying transparent neighbors',()=>{
  const probe:RenderPlanetMap={identity:'fixture',projection:'north-pole-equator-rim/1',size:2,rgba:new Uint8Array([255,0,0,255,0,0,255,0,255,0,0,255,0,0,255,0]),equator:new Uint8Array(8),coverMetres:0,storageBytes:24},out=new Float64Array(4);
  planetMapColor(probe,0,0,out);expect(Array.from(out)).toEqual([.5,0,0,.5]);
 });
 it('holds body-fixed addresses through zoom, rotation and large world translations',()=>{
  const f=new PlanetMapFrame(),b=body(),camera={center:{x:2070.25,y:0},scale:1,rotation:.7};expect(f.update(b,camera,1280,900)).toBe(true);const address=[f.cameraRadius,f.referenceOffset,f.angleIndex,f.angleFraction,f.directionX,f.directionY];
  f.update(b,{...camera,scale:40},1280,900);expect([f.cameraRadius,f.referenceOffset,f.angleIndex,f.angleFraction,f.directionX,f.directionY]).toEqual(address);expect(f.opacity).toBe(0);
  f.update({...b,position:{x:1e12,y:-1e12}},{...camera,center:{x:1e12+2070.25,y:-1e12}},1280,900);expect([f.cameraRadius,f.referenceOffset,f.angleIndex,f.angleFraction,f.directionX,f.directionY]).toEqual(address);
  expect(f.update(b,{center:{x:1e8,y:0},scale:1,rotation:0},1280,900)).toBe(false);
 });
 it('samples actual ground in CSS space independently of camera spin, translation and scale',()=>{
  const f=new PlanetMapFrame(),out=new Float64Array(7),a=1.234,index=a/Math.PI/2*profile.sampleCount,i=Math.floor(index),t=index-i,h=profile.sampleElevation(i)*(1-t)+profile.sampleElevation((i+1)%profile.sampleCount)*t;
  for(const spin of[0,.7,3.1])for(const rotation of[0,.4])for(const scale of[.04,10,1000]){
   const b={...body(),position:{x:1e9,y:-1e9},rotation:spin},r=profile.referenceRadius+h-.1;
   const camera={center:{x:1e9+r*Math.cos(a+spin),y:-1e9+r*Math.sin(a+spin)},scale,rotation};
   f.update(b,camera,640,480);f.sample(320,240,640,480,profile,out);
   expect(out[2]).toBeCloseTo(.1,4);expect(out[0]!+out[1]!).toBeCloseTo(index,4);expect(Math.atan2(out[5]!,out[4]!)).toBeCloseTo(a,5);
  }
 });
 it('retains the actual map fan when a wet world exceeds the legacy illustrative color budget',()=>{
  const overview=buildOverview(profile,MATERIAL_DOMAINS.planet),b={...body(),surface:profile,overview};
  for(const scale of[.15380859375,.35,.8]){
   const geometry=terrainGeometry(b,{center:{x:0,y:0},rotation:0,scale},1280,900,{querySurface});
   expect(geometry.faces.some(f=>f.planetMap),String(scale)).toBe(true);
  }
 });
 it('uses only supplied pause-safe cloud phase and honors airless/off modes',()=>{
  const f=new PlanetMapFrame(),b=body(),camera={center:{x:0,y:0},scale:.04,rotation:0};const air={mode:'clouds' as const,heightMetres:120,cloudAltitudeMetres:35,cloudThicknessMetres:15,color:[.4,.7,.9] as const,opacity:.12,phaseRadians:1.234};
  f.update({...b,air},camera,1280,900);expect(f.cloudPhase).toBe(1.234);expect(f.clouds).toBe(true);f.update({...b,air},camera,1280,900);expect(f.cloudPhase).toBe(1.234);f.update(b,camera,1280,900);expect(f.clouds).toBe(false);expect(f.air).toBe(false);
 });
 it('builds only visible cover bands with fixed storage and conservative overflow fallback',()=>{
  const mesh=new PlanetCoverMesh(),f=new PlanetMapFrame();f.visible=true;f.scale=10;const points=[{x:100,y:200,angle:Math.PI/2,radius:2048},{x:200,y:200,angle:Math.PI/2,radius:2048}];mesh.update(map,f,points,640,480);expect(mesh.length).toBe(12);expect(mesh.vertices.byteLength).toBe(24576);expect(mesh.vertices[1]).toBeCloseTo(199);expect(mesh.vertices[5]).toBeCloseTo(204.5);
  mesh.update(map,f,points,640,480,0);expect(mesh.vertices[1]).toBeCloseTo(200);expect(mesh.vertices[5]).toBeCloseTo(203.5);
  mesh.update(map,f,points.map(p=>({...p,x:p.x-2000})),640,480);expect(mesh.length).toBe(0);mesh.update(map,f,Array.from({length:515},(_,i)=>points[i%2]!),640,480);expect(mesh.length).toBe(0);
  f.scale=.04;mesh.update(map,f,points,640,480);expect(mesh.length).toBe(0);
 });
});
