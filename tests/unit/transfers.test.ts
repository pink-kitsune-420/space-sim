import {expect,it} from 'vitest';
import {createTransferPlanner,deltaComponents} from '../../modules/transfer-planner/src/index';
import {createFlightPlans} from '../../modules/flight-plans/src/index';
import {World} from '../../packages/sim-core/src/world';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {saveWorld} from '../../packages/sim-core/src/save';
import {maneuverDelta,type TransferResult,type TransferRequest,type TransferProgress} from '../../packages/game-api/src/index';
const plans=createFlightPlans(),solver=createTransferPlanner(plans);
function setup(r=640,speedScale=1,acceleration=125){
 const universe={...DEFAULT_UNIVERSE,systems:DEFAULT_UNIVERSE.systems.map(s=>({...s,vehicleDefaults:{...s.vehicleDefaults,acceleration}}))};
 const world=new World(universe),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),body=world.body(ship.bodyId);
 world.put({...ship,state:{...ship.state,position:{x:0,y:r},velocity:{x:Math.sqrt(body.mu/r)*speedScale,y:0}}});
 return{world,ship:world.ship(ship.id)!,body};
}
function search(world:World,request:TransferRequest){
 const job=solver.search(world,request);let last:TransferProgress|undefined,yields=0;
 for(;;){const r=job.next();if(r.done)return{result:r.value,last,yields};last=r.value;if(++yields>800000)throw Error('Unbounded search');}
}
it.each([[640,1,768,768],[1280,1,128,128],[640,1.15,512,512],[640,1.15,256,1024],[1280,1.1,128,388],[640,-1,256,1024]])('finds validated circular/elliptical orbit changes from r=%s scale=%s to altitudes %s/%s',(r,scale,low,high)=>{
 const {world,ship,body}=setup(r,scale),before=JSON.stringify(saveWorld(world));
 const {result,yields,last}=search(world,{shipId:ship.id,destinationId:body.id,periapsisAltitude:low,apoapsisAltitude:high});
 expect(result.options.length,result.reason).toBeGreaterThan(0);expect(yields).toBeLessThan(20000);expect(last!.tested).toBeLessThanOrEqual(40);
 for(const option of result.options){
  const evaluated=plans.evaluate(option.plan,world);expect(evaluated.every(node=>node.valid)).toBe(true);
  const orbit=world.context.services.orbits.elements(evaluated[1]!.after!,body.mu);
  expect(Math.abs(orbit.periapsis-(body.radius+low))).toBeLessThan(.01);expect(Math.abs(orbit.apoapsis!-(body.radius+high))).toBeLessThan(.01);
  expect(option.waitSeconds).toBeGreaterThanOrEqual(30);expect(option.travelSeconds).toBeGreaterThan(0);
  expect(option.deltaV).toBeCloseTo(option.departureDeltaV+option.arrivalDeltaV,10);
  expect(option.plan.nodes).toHaveLength(2);expect(option.warning.toLowerCase()).toContain('finite');
 }
 expect(JSON.stringify(saveWorld(world))).toBe(before);world.dispose();
});
it('matches independently calculated Hohmann cost while its faster option arrives earlier with a radial arrival correction',()=>{
 const {world,ship,body}=setup(),target=1280,{result}=search(world,{shipId:ship.id,destinationId:body.id,periapsisAltitude:target-body.radius,apoapsisAltitude:target-body.radius});
 const efficient=result.options.find(o=>o.kind==='efficient')!,faster=result.options.find(o=>o.kind==='faster')!;
 const a=(640+target)/2,expected=Math.sqrt(body.mu*(2/640-1/a))-Math.sqrt(body.mu/640)+Math.sqrt(body.mu/target)-Math.sqrt(body.mu*(2/target-1/a));
 expect(efficient.deltaV).toBeCloseTo(expected,7);expect(efficient.travelSeconds).toBeCloseTo(Math.PI*Math.sqrt(a*a*a/body.mu),7);
 expect(faster.waitSeconds+faster.travelSeconds).toBeLessThan((efficient.waitSeconds+efficient.travelSeconds)*.98);
 expect(Math.abs(faster.plan.nodes[1]!.radial)).toBeGreaterThan(.1);expect(faster.deltaV).toBeGreaterThan(efficient.deltaV);world.dispose();
});
it('solves the existing nonorthogonal radial/prograde basis without losing arrival delta-v',()=>{
 const sample={time:0,position:{x:10,y:0},velocity:{x:1,y:3}},delta={x:4,y:-2},components=deltaComponents(sample.position,sample.velocity,delta)!;
 const actual=maneuverDelta(sample,components.prograde,components.radial);expect(actual.x).toBeCloseTo(delta.x,12);expect(actual.y).toBeCloseTo(delta.y,12);
 expect(deltaComponents(sample.position,{x:1,y:0},delta)).toBeUndefined();
});
it('explains unsuitable or unsupported conditions and distinguishes weak-engine impulse estimates',()=>{
 const {world,ship,body}=setup(),request={shipId:ship.id,destinationId:body.id,periapsisAltitude:768,apoapsisAltitude:768};
 for(const changed of [{...request,destinationId:'moon'},{...request,periapsisAltitude:-1},{...request,apoapsisAltitude:Infinity}])expect(search(world,changed).result.options).toEqual([]);
 expect(search(world,{...request,destinationId:'moon'}).result.reason).toContain('Moon and planet');
 const weak=setup(640,1,1),result=search(weak.world,{...request,shipId:weak.ship.id}).result;expect(result.options[0]!.warning).toContain('Long finite burn');weak.world.dispose();
 const noEngine=setup(640,1,0);expect(search(noEngine.world,request).result.reason).toContain('no engine');noEngine.world.dispose();
 world.setControls(ship.id,{turn:0,throttle:0,engine:true});expect(search(world,request).result.reason).toContain('Stop thrust');world.dispose();
});
it('cancels a live child forecast and does not step or arm the world',()=>{
 const {world,ship,body}=setup();let active=0,closed=0;
 const source=Object.create(world) as World;source.predictShip=function*(id,coarse,seed){active++;try{return yield* world.predictShip(id,coarse,seed);}finally{active--;closed++;}};
 const job=solver.search(source,{shipId:ship.id,destinationId:body.id,periapsisAltitude:768,apoapsisAltitude:768});
 for(let i=0;i<200&&!active;i++)job.next();expect(active).toBe(1);job.return({options:[],reason:'cancelled'} satisfies TransferResult);expect(active).toBe(0);expect(closed).toBeGreaterThan(0);expect(world.tick).toBe(0);expect(world.ship(ship.id)!.controls.engine).toBe(false);world.dispose();
});

it('handles actual packaged services without UI or view-prediction modules and explains a missing required plan provider',async()=>{
 const {cp,mkdtemp,readFile,rm}=await import('node:fs/promises'),{join,resolve}=await import('node:path'),{tmpdir}=await import('node:os');
 const {buildPortableModule}=await import('../../packages/module-tools/package.mjs'),{inspectRuntimePackage}=await import('../../packages/game-library/src/runtime-package'),{ModuleRegistryV2}=await import('../../packages/game-runtime/src/modules-v2');
 const {TRANSFERS}=await import('../../packages/game-api/src/index'),dir=await mkdtemp(join(tmpdir(),'transfer-archive-'));
 try {
  const checked:Awaited<ReturnType<typeof inspectRuntimePackage>>[]=[];
  for(const name of ['flight-plans','transfer-planner']){const source=join(dir,name),out=join(dir,`${name}.spacemod`);await cp(resolve('modules',name),source,{recursive:true});await buildPortableModule(join(source,'module.json'),out,{typecheck:false});checked.push(await inspectRuntimePackage(new Uint8Array(await readFile(out))));}
  for(const environment of ['browser','offline','node'] as const){
   const registry=new ModuleRegistryV2();for(const archive of checked){const r=archive.register({environment,allowRuntimeCode:true,approvedDigests:new Set([archive.digest])});registry.register(r.module,r.assets);}
   const profile={format:'space-sim-profile/2' as const,id:'fixture.transfers',modules:checked.map(m=>({id:m.id,version:m.version})),providers:{'flight.plans':checked[0]!.id,'flight.transfers':checked[1]!.id},capabilities:{},settings:{}};
   expect(()=>registry.prepare({...profile,modules:profile.modules.slice(1),providers:{'flight.transfers':checked[1]!.id}},environment)).toThrow('flight.plans');
   const candidate=registry.prepare(profile,environment),{world,ship,body}=setup(),job=candidate.providedService(TRANSFERS).search(world,{shipId:ship.id,destinationId:body.id,periapsisAltitude:768,apoapsisAltitude:768});
   let result:TransferResult|undefined;for(let i=0;i<20000;i++){const r=job.next();if(r.done){result=r.value;break;}}
   expect(result?.options).toHaveLength(2);candidate.dispose();world.dispose();
  }
 }finally{await rm(dir,{recursive:true,force:true});}
},60000);
