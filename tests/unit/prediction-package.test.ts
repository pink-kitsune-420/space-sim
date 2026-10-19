import {expect,it} from 'vitest';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {PREDICTIONS,type GhostEnd,type GhostSample,type SimulationContext} from '../../packages/game-api/src/index';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {inspectRuntimePackage} from '../../packages/game-library/src/runtime-package';
import {ModuleRegistryV2} from '../../packages/game-runtime/src/modules-v2';
import {World} from '../../packages/sim-core/src/world';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {saveWorld} from '../../packages/sim-core/src/save';
import {Prediction} from '../../modules/flight-prediction/src/index';

it('traces with the real prediction archive in every declared environment without advancing live authority',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'portable-flight-prediction-'));
 try{
  const source=join(directory,'prediction'),output=join(directory,'prediction.spacemod');await cp(resolve('modules/flight-prediction'),source,{recursive:true});
  await buildPortableModule(join(source,'module.json'),output,{typecheck:false});const checked=await inspectRuntimePackage(new Uint8Array(await readFile(output)));
  for(const environment of ['browser','offline','node'] as const){
   const registry=new ModuleRegistryV2(),registration=checked.register({environment,allowRuntimeCode:true,approvedDigests:new Set([checked.digest])});registry.register(registration.module,registration.assets);
   const profile={format:'space-sim-profile/2' as const,id:'fixture.prediction',modules:[{id:checked.id,version:checked.version}],providers:{'view.prediction':checked.id},capabilities:{},settings:{[checked.id]:{maxMs:2,traceSamplesPerSecond:240}}};
   const candidate=registry.prepare(profile,environment),factory=candidate.providedService(PREDICTIONS),ends:GhostEnd[]=[],preview=factory.create(summary=>ends.push(summary.end)),other=factory.create(()=>{}),world=new World(DEFAULT_UNIVERSE,{id:'prediction-authority'});
   try{
    const ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'});world.step();const state=world.ship(ship.id)!.state,before=JSON.stringify(saveWorld(world));
    for(let frame=0;frame<200&&preview.pathEnd!=='closed';frame++)preview.update(world.context,state,world.body(ship.bodyId),world.surface(ship.bodyId),ship.id,.1,false,ship.controls,world);
    expect(ends).toEqual(['closed']);expect(preview.path.length).toBeGreaterThan(40);expect(JSON.stringify(saveWorld(world))).toBe(before);
    expect(preview.maxMs).toBe(2);other.maxMs=.45;expect(preview.maxMs).toBe(2);
    candidate.dispose();expect(preview.path).toEqual([]);expect(()=>preview.update(world.context,state,world.body(ship.bodyId),undefined,ship.id,.1,false)).toThrow('disposed');expect(()=>factory.create(()=>{})).toThrow('disposed');
    const absent={...profile,modules:[],providers:{},settings:{}};expect(()=>registry.prepare(absent,environment,['view.prediction'])).toThrow('view.prediction');const optional=registry.prepare(absent,environment);expect(optional.lock.order).toEqual([]);optional.dispose();
   }finally{candidate.dispose();world.dispose();}
  }
 }finally{await rm(directory,{recursive:true,force:true});}
},60000);

it('cancels a throwing generator and context independently, clearing its retained path before reporting both failures',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),state=ship.state,sample:GhostSample={time:0,position:{x:0,y:0},velocity:{x:0,y:0}},jobFailure=new Error('generator cleanup failed'),contextFailure=new Error('context cleanup failed');
 let disposed=0,started=0;
 const context:SimulationContext={...world.context,cloneForPrediction(){return{...world.context,predict:function*():Generator<GhostSample,GhostEnd>{started++;try{while(true)yield sample;}finally{throw jobFailure;}},dispose(){disposed++;throw contextFailure;}};}};
 const preview=new Prediction(()=>{}, {maxMs:16});
 try{
  preview.update(context,state,world.body(ship.bodyId),undefined,ship.id,0,false);expect(started).toBe(1);expect(preview.pass).toBeDefined();
  let error:unknown;try{preview.invalidate();}catch(value){error=value;}
  expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([jobFailure,contextFailure]);expect(disposed).toBe(1);expect(preview.pass).toBeUndefined();expect(preview.path).toEqual([]);expect(preview.passKey).toBe('');preview.dispose();preview.dispose();expect(disposed).toBe(1);
 }finally{preview.dispose();world.dispose();}
});

it('releases a clone after prediction iteration fails and allows a new candidate job',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),state=ship.state,failure=new Error('prediction failed');let disposed=0;
 const context:SimulationContext={...world.context,cloneForPrediction(){return{...world.context,predict:function*():Generator<GhostSample,GhostEnd>{throw failure;},dispose(){disposed++;}};}};
 const preview=new Prediction(()=>{});
 try{
  for(let attempt=1;attempt<=2;attempt++){expect(()=>preview.update(context,state,world.body(ship.bodyId),undefined,ship.id,0,false)).toThrow(failure);expect(disposed).toBe(attempt);expect(preview.pass).toBeUndefined();expect(preview.path).toEqual([]);}
 }finally{preview.dispose();world.dispose();}
});

it('bounds sample retention and closes even an endlessly yielding optional motion provider',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'});let closed=0,disposed=0;
 const context:SimulationContext={...world.context,cloneForPrediction(){return{...world.context,predict:function*():Generator<GhostSample,GhostEnd>{try{let n=0;while(true)yield{time:n++,position:{x:0,y:640},velocity:{x:1,y:0}};}finally{closed++;}},dispose(){disposed++;}};}};
 const preview=new Prediction(()=>{}, {maxMs:16});
 for(let frame=0;frame<300;frame++){preview.update(context,ship.state,world.body(ship.bodyId),undefined,ship.id,.1,false);if(!preview.pass)break;}
 expect(preview.pass).toBeUndefined();expect(preview.pathEnd).toBe('open');expect(preview.path.length).toBe(32768);expect(closed).toBe(1);expect(disposed).toBe(1);
 preview.dispose();world.dispose();
});
