import {describe,expect,it} from 'vitest';
import {createPlanetField,deterministicMath as dm,type PlanetSurfaceDefinition} from '../../packages/game-api/src/index';
import {generateSurface,querySurface,surfaceIdentity,validateSurfaceDefinition,validateUniverse,loadSystem,createSimulationContext,initialState,IDLE,STEP,magnitude,type State} from '../../packages/sim-core/src/index';
import {World} from '../../packages/sim-core/src/world';
import {saveWorld,loadWorld} from '../../packages/sim-core/src/save';

const definition:PlanetSurfaceDefinition={kind:'planet',generatorVersion:2,seed:741,recipe:'oceanic',radiusMetres:2048,maxReliefMetres:48,continentWavelengthMetres:1100,rangeWavelengthMetres:280,hillWavelengthMetres:80,octaves:4,waterCoverage:.68,sampleCount:8192,orientationRadians:0,pads:[{id:'landing-area',angleRadians:4.955908430461535,widthMetres:48,elevationMetres:26}],padShoulderMetres:40};
const raw=(surface:unknown=definition)=>({schemaVersion:1,id:'field-test',name:'Shared field',defaultSystemId:'field',systems:[{id:'field',name:'Field',vehicleDefaults:{contactRadiusMetres:2.5,acceleration:24,turnRate:.65,initialThrottle:.65},bodies:[{id:'planet',name:'Primus',parentId:null,radius:2048,mu:13107200,surface}],presets:[{id:'pad',name:'Land',bodyId:'planet',kind:'landed'}]}]});

describe('version2 physical map/profile adapter',()=>{
 it('bakes the physical ring, map and exact shores from one padded field with private geometry',()=>{
  const profile=generateSurface({radius:2048,surface:definition}),planet=profile.planet!,field=createPlanetField(planet.definition),out=new Float64Array(8);
  expect(planet).toBeDefined();expect('equator' in planet).toBe(false);expect(profile.identity).toBe(surfaceIdentity({radius:2048,surface:definition}));expect(profile.hasWater).toBe(true);expect(profile.coastAngles.length).toBeGreaterThan(0);
  for(let i=0;i<profile.sampleCount;i+=17){const a=i*2*Math.PI/profile.sampleCount;field.evaluate(dm.cos(a),dm.sin(a),0,out);expect(profile.sampleElevation(i)).toBe(out[0]);expect(querySurface(profile,a).elevation).toBe(out[0]);}
  const {columns,rows}=planet.options;
  for(let i=0;i<columns*rows;i+=257){const z=2*(Math.floor(i/columns)+.5)/rows-1,r=Math.sqrt(1-z*z),a=(i%columns+.5)*2*Math.PI/columns;field.evaluate(r*dm.cos(a),r*dm.sin(a),z,out);expect(planet.map.elevations[i]).toBe(out[0]);expect(planet.map.waterMask[i]).toBe(+(2048+out[0]!<profile.seaRadiusMetres!));}
  for(const a of profile.coastAngles)expect(querySurface(profile,a).groundRadius).toBeCloseTo(profile.seaRadiusMetres!,9);
  expect(profile.storageBytes).toBe(4*profile.sampleCount*8+planet.storageBytes-profile.sampleCount*8);
  const first=profile.sampleElevation(0),copy=profile.copyElevations();copy[0]=999;planet.map.elevations[0]=999;expect(profile.sampleElevation(0)).toBe(first);
 });
 it('keeps a full advertised landing core level and its final sea strictly below it',()=>{
  const profile=generateSurface({radius:2048,surface:definition}),pad=definition.pads![0]!;
  for(let i=-100;i<=100;i++){const a=pad.angleRadians+i/100*pad.widthMetres/(2*2048),q=querySurface(profile,a);expect(q.elevation).toBe(26);expect(q.material).toBe('rock');expect(q.groundRadius).toBeGreaterThan(profile.seaRadiusMetres!);}
  expect(profile.planet!.definition.pads![0]!.widthMetres).toBeGreaterThan(pad.widthMetres);
 });
 it('has stable detached identity across reordered JSON and changes with physical authoring parameters',()=>{
  const captured=validateSurfaceDefinition(definition,2048),reordered=Object.fromEntries(Object.entries(definition).reverse());expect(surfaceIdentity({radius:2048,surface:captured})).toBe(surfaceIdentity({radius:2048,surface:validateSurfaceDefinition(reordered,2048)}));
  for(const changed of [{seed:742},{sampleCount:16384},{orientationRadians:.2},{waterCoverage:.6},{padShoulderMetres:41}])expect(surfaceIdentity({radius:2048,surface:{...definition,...changed}})).not.toBe(surfaceIdentity({radius:2048,surface:definition}));
  const input={...definition,pads:definition.pads!.map(p=>({...p}))},safe=validateSurfaceDefinition(input,2048);input.pads![0]!.elevationMetres=0;expect(safe.pads![0]!.elevationMetres).toBe(26);
 });
 it.each([{kind:'radial'},{radiusMetres:1024},{sampleCount:4096},{sampleCount:8193},{orientationRadians:-1},{minFeatureWidthMetres:1},{mountainRangeCount:1},{padShoulderMetres:1},{waterCoverage:1},{seaRadiusMetres:2049}])('rejects incompatible or under-resolved recipes %j',change=>{
  expect(()=>validateSurfaceDefinition({...definition,...change},2048)).toThrow();
 });
 it('rejects a launch pad flooded by a resolved coverage sea rather than silently moving it',()=>{
  const flooded={...definition,pads:[{...definition.pads![0]!,elevationMetres:-40}]};expect(()=>generateSurface({radius:2048,surface:flooded})).toThrow('resolved coverage sea');
 });
 it('enforces aggregate macro map caps before generation for JSON and typed loaded systems',()=>{
  const input=raw(),sys=input.systems[0]!;
  sys.bodies=Array.from({length:5},(_,i)=>({...sys.bodies[0]!,id:i?'planet-'+i:'planet'}));
  expect(()=>validateUniverse(input)).toThrow('planet map budget');
  expect(()=>loadSystem(input as unknown as Parameters<typeof loadSystem>[0])).toThrow('planet map budget');
 });
 it('roundtrips a new wet-hull world and preserves all subsequent deterministic state',()=>{
  const universe=validateUniverse(raw()),preview=new World(universe);try{expect(preview.soloPreview).toBe(true);expect(()=>saveWorld(preview)).toThrow('declared deterministic multiplayer support');}finally{preview.dispose();}
  // This fixture declares its verified built-in deterministic motion support;
  // ordinary unqualified custom profiles retain the existing save gate.
  const world=new World(universe,{soloPreview:false});try{
   const ship=world.spawn({ownerId:'pilot',presetId:'pad'});world.step();expect(world.ship(ship.id)!.state.status).toBe('landed');
   const saved=saveWorld(world),restored=loadWorld(saved,{soloPreview:false});try{expect(saveWorld(restored.world)).toEqual(saved);for(let i=0;i<20;i++){world.step();restored.world.step();}expect(restored.world.ships().map(s=>s.state)).toEqual(world.ships().map(s=>s.state));expect(restored.world.surface('planet')!.planet!.identity).toBe(world.surface('planet')!.planet!.identity);}finally{restored.world.dispose();}
  }finally{world.dispose();}
 });
 it('shares immutable built-in map/profile data across prediction clones while isolating ships and lifetime',()=>{
  const world=new World(validateUniverse(raw()),{soloPreview:false});const ship=world.spawn({ownerId:'pilot',presetId:'pad'}),profile=world.surface('planet')!;
  const clone=world.cloneForPrediction();try{
   expect(clone.surface('planet')).toBe(profile);expect(clone.surface('planet')!.planet).toBe(profile.planet);expect(clone.ships().map(s=>s.state)).toEqual(world.ships().map(s=>s.state));
   clone.setControls(ship.id,{...IDLE,engine:true});clone.step();expect(clone.ship(ship.id)!.state).not.toEqual(world.ship(ship.id)!.state);
   const before=JSON.stringify(world.ship(ship.id)!.state);clone.step();expect(JSON.stringify(world.ship(ship.id)!.state)).toBe(before);
   world.dispose();expect(()=>clone.step()).not.toThrow();expect(querySurface(clone.surface('planet')!,definition.pads![0]!.angleRadians).material).toBe('rock');
  }finally{clone.dispose();world.dispose();}
 });
 it('uses actual generated sea for gentle circular entry and agrees with prediction',()=>{
  const profile=generateSurface({radius:2048,surface:definition}),body={id:'planet',radius:2048,mu:13107200},ctx=createSimulationContext({contactRadiusMetres:2.5});try{
   let index=0;for(let i=1;i<profile.sampleCount;i++)if(profile.sampleElevation(i)<profile.sampleElevation(index))index=i;
   const a=index*2*Math.PI/profile.sampleCount,r=profile.seaRadiusMetres!+2.501;
   let s:State={...initialState(),status:'flying',heading:a,position:{x:r*dm.cos(a),y:r*dm.sin(a)},velocity:{x:-dm.cos(a),y:-dm.sin(a)}};
   const ghost=ctx.predict(s,false,body,profile);ghost.next();s=ctx.advance(s,IDLE,STEP,body,profile);expect(s.status).toBe('flying');expect(s.waterEntry).toBeDefined();expect(magnitude(s.waterEntry!.position)).toBeCloseTo(profile.seaRadiusMetres!+2.5,6);expect(ghost.next().value).toEqual(s.waterEntry);expect(ghost.next().value).toMatchObject({position:s.position,time:s.time});ghost.return('open');
  }finally{ctx.dispose();}
 });
});
