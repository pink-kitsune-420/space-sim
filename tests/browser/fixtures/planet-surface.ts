import {createPlanetField,deterministicMath as dm,type PlanetSurfaceDefinition,type State} from '../../../packages/game-api/src/index';
import {World} from '../../../packages/sim-core/src/world';
import {validateUniverse} from '../../../packages/sim-core/src/universe';
import {saveWorld,loadWorld} from '../../../packages/sim-core/src/save';
import {querySurface} from '../../../packages/sim-core/src/surface';
import {IDLE,STEP} from '../../../packages/sim-core/src/constants';

export function run(){
 const definition:PlanetSurfaceDefinition={kind:'planet',generatorVersion:2,seed:741,recipe:'oceanic',radiusMetres:2048,maxReliefMetres:48,continentWavelengthMetres:1100,rangeWavelengthMetres:280,hillWavelengthMetres:80,octaves:4,waterCoverage:.68,sampleCount:8192,orientationRadians:0,pads:[{id:'landing-area',angleRadians:4.955908430461535,widthMetres:48,elevationMetres:26}],padShoulderMetres:40};
 const universe=validateUniverse({schemaVersion:1,id:'shared-field-proof',name:'Shared field proof',defaultSystemId:'field',systems:[{id:'field',name:'Primus',vehicleDefaults:{contactRadiusMetres:2.5,acceleration:24,turnRate:.65,initialThrottle:.65},bodies:[{id:'planet',name:'Primus',parentId:null,radius:2048,mu:13107200,rotation:{period:4800,direction:-1,phaseRadiansAtEpoch:.7},surface:definition}],presets:[{id:'pad',name:'Pad',kind:'landed',bodyId:'planet'}]}]});
 // Fixture explicitly declares built-in deterministic motion support. The
 // ordinary unqualified custom-profile save guard is covered by unit tests.
 const world=new World(universe,{soloPreview:false});
 try{
  const profile=world.surface('planet')!,planet=profile.planet!,field=createPlanetField(planet.definition),out=new Float64Array(8),values:number[]=[];
  let lowest=0,exactRing=true;
  for(let i=0;i<8192;i++){
   if(profile.sampleElevation(i)<profile.sampleElevation(lowest))lowest=i;
   if(i%127===0){const a=i*2*Math.PI/8192;field.evaluate(dm.cos(a),dm.sin(a),0,out);values.push(...out);exactRing &&= profile.sampleElevation(i)===out[0];}
  }
  let exactWater=true;for(let i=0;i<planet.map.elevations.length;i++)exactWater&&=planet.map.waterMask[i]===+(2048+planet.map.elevations[i]!<profile.seaRadiusMetres!);
  const launch=world.spawn({ownerId:'pilot',presetId:'pad'});world.step();const saved=saveWorld(world),restored=loadWorld(saved,{soloPreview:false});let roundtrip=false;
  try{roundtrip=JSON.stringify(saveWorld(restored.world))===JSON.stringify(saved);for(let i=0;i<10;i++){world.step();restored.world.step();}roundtrip&&=JSON.stringify(world.ships().map(s=>s.state))===JSON.stringify(restored.world.ships().map(s=>s.state));}finally{restored.world.dispose();}
  const a=lowest*2*Math.PI/8192,r=profile.seaRadiusMetres!+2.501,context=world.contextFor(world.ship(launch.id)!),body={...world.body('planet'),rotation:undefined};
  const start:State={...world.ship(launch.id)!.state,status:'flying',time:0,heading:a,position:{x:r*dm.cos(a),y:r*dm.sin(a)},velocity:{x:-dm.cos(a),y:-dm.sin(a)}};
  const ghost=context.predict(start,false,body,profile);ghost.next();const live=context.advance(start,IDLE,STEP,body,profile),entry=ghost.next().value,next=ghost.next().value;ghost.return('open');
  return{exactRing,exactWater,roundtrip,values,coasts:profile.coastAngles,coastRadii:profile.coastAngles.map(a=>querySurface(profile,a).groundRadius),sea:profile.seaRadiusMetres,coverage:planet.sampledWaterCoverage,
   storageBytes:profile.storageBytes,mapColumns:planet.options.columns,mapRows:planet.options.rows,privateEquator:!('equator' in planet),entry:live.waterEntry,
   predictionMatches:!!live.waterEntry&&JSON.stringify(entry)===JSON.stringify(live.waterEntry)&&JSON.stringify((next as {position?:unknown}).position)===JSON.stringify(live.position),status:live.status,water:live.water};
 }finally{world.dispose();}
}
