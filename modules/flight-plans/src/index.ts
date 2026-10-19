import { FLIGHT_PLANS, maneuverDelta, type EvaluatedFlightNode, type FlightPlan, 
 type FlightPlanNode, type FlightPlanService, type ModuleInitializationV2, type State, type Vec } from '@space-sim/game-api';

export const MAX_PLAN_NODES = 16;
export const MAX_PLAN_SECONDS = 365.25 * 86400;
const fail = (message: string): never => { throw new Error(`Flight plan: ${message}`); };
const record = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw)
 ? raw as Record<string, unknown> : fail('expected an object');
const number = (raw: unknown, name: string, bound = 1e20): number => typeof raw === 'number' && Number.isFinite(raw) && Math.abs(raw) <= bound
 ? raw : fail(`${name} must be a finite SI number`);
const text = (raw: unknown, name: string, length = 128): string => typeof raw === 'string' && raw.length > 0 && raw.length <= length && !/[\p{Cc}\p{Cf}]/u.test(raw)
 ? raw : fail(`${name} must be nonempty text (at most ${length} characters)`);
const vector = (raw: unknown): Vec => { const value = record(raw); return { x: number(value.x, 'x'), y: number(value.y, 'y') }; };
function readPlan(raw: unknown): FlightPlan {
 const p=record(raw), e=record(p.epoch), time=number(e.time,'epoch time',1e12);
 if (!Array.isArray(p.nodes) || p.nodes.length > MAX_PLAN_NODES) fail(`at most ${MAX_PLAN_NODES} nodes are supported`);
 const nodes: FlightPlanNode[]=[]; const ids=new Set<string>(); let previous=-Infinity;
 for (const raw of p.nodes as unknown[]) {
  const n=record(raw), id=text(n.id,'node id',64), at=number(n.time,'node time',1e12);
  if(ids.has(id))fail('duplicate node id'); ids.add(id);
  if((at < time && n.completed!==true) || at > time + MAX_PLAN_SECONDS || at <= previous)fail('nodes need increasing times within one year of their epoch'); previous=at;
  nodes.push({id,label:text(n.label,'node label',80),bodyId:text(n.bodyId,'body id'),time:at,
   prograde:number(n.prograde,'prograde delta-v',1e6),radial:number(n.radial,'radial delta-v',1e6),...(n.completed===true?{completed:true}:{})});
 }
 return {shipId:text(p.shipId,'ship id'),universeId:text(p.universeId,'universe id'),systemId:text(p.systemId,'system id'),
  fingerprint:text(p.fingerprint,'physics fingerprint',1024),motionIdentity:text(p.motionIdentity,'motion identity',16384),bodyId:text(p.bodyId,'body id'),
  epoch:{time,position:vector(e.position),velocity:vector(e.velocity),heading:number(e.heading,'heading',Math.PI*2)},nodes};
}
export function createFlightPlans(): FlightPlanService {
 const service: FlightPlanService = {
  capture(world,ship,nodes) {
   const s=ship.state;
   return readPlan({shipId:ship.id,universeId:world.universe.id,systemId:world.systemId,fingerprint:world.simulationFingerprint,
    motionIdentity:world.contextFor(ship).modelIdentity,bodyId:ship.bodyId,
    epoch:{time:s.time,position:s.position,velocity:s.velocity,heading:s.heading},nodes});
  },
  read(raw) {
   const value=record(raw);
   if(value.format!=='space-sim-flight-plans/1')fail('unsupported archive format');
   if(!Array.isArray(value.plans)||value.plans.length>64)fail('at most 64 ship plans are supported');
   const plans=(value.plans as unknown[]).map(readPlan);
   if(new Set(plans.map(plan=>plan.shipId)).size!==plans.length)fail('duplicate ship plans');
   return {format:'space-sim-flight-plans/1',plans};
  },
  *predict(plan,world) {
   const evaluated=service.evaluate(plan,world), valid=evaluated.filter(node=>node.valid), pending=evaluated.filter(node=>!node.intent.completed);
   if(!valid.length)return 'failed';
   let count=0;
   for(let index=0;index<valid.length;index++) {
    const node=valid[index]!,next=valid[index+1],job=world.predictShip(plan.shipId,false,{state:node.after!,bodyId:node.intent.bodyId});
    try {
     for(;;) {
      const result=job.next();
      if(result.done) {
       if(next) {
        if(result.value!=='closed')return 'open';
        // A closed single-body orbit may be followed for another revolution.
        // Exact event evaluation already validated the entire interval.
        const context=world.contextFor(world.ship(plan.shipId)!),body=world.body(node.intent.bodyId),surface=world.surface(body.id);
        const coast=context.keplerCoast(node.after!,body,surface);
        if(!coast)return 'failed';
        const period=context.services.orbits.elements(coast,body.mu).period;
        if(!period)return 'failed';
        for(let time=node.after!.time+period;time<next.intent.time;time+=period/64) {
         const solved=context.coastAt(coast,time,body,surface,{cache:false});if(!solved.ok)return 'failed';
         if(++count>16384)return 'open';yield{time,...solved.state};
        }
        yield next.before!;break;
       }
       return valid.length<pending.length?'open':valid.length>1&&result.value==='closed'?'horizon':result.value;
      }
      if(next&&result.value.time>=next.intent.time) {yield next.before!;break;}
      if(++count>16384)return 'open';yield result.value;
     }
    }finally{job.return('open');}
   }
   return 'open';
  },
  evaluate(plan,world) {
   if(plan.nodes.length>MAX_PLAN_NODES)fail(`at most ${MAX_PLAN_NODES} nodes are supported`);
   const ship=world.ship(plan.shipId), results:EvaluatedFlightNode[]=[];
   let reason=plan.universeId!==world.universe.id||plan.systemId!==world.systemId||plan.fingerprint!==world.simulationFingerprint
    ? 'World or physics changed. Review the plan.' : !ship ? 'This ship is unavailable.'
      : !world.predictionFeatures?.futureSeeds ? 'This host does not support detached future prediction seeds.' : '';
   const context=ship?world.contextFor(ship).cloneForPrediction():undefined;
   let seed:State={...plan.epoch,status:'flying',throttle:0,revision:0};
   try {
    if(context && (!context.capabilities.analyticCoast || !context.capabilities.rails || world.requiresWorldPrediction
      || context.modelIdentity!==plan.motionIdentity))reason='This plan needs compatible analytic motion and SOI horizons.';
    for(const intent of plan.nodes) {
     if(intent.completed){results.push({intent,valid:false,reason:'Completed. Later nodes require review against actual flight.'});continue;}
     let result:EvaluatedFlightNode={intent,valid:false,reason};
     if(!reason&&context)try {
      if(intent.bodyId!==plan.bodyId||!world.hasBody(intent.bodyId))throw Error('Later-body planning is not supported by this chain evaluator.');
      if(intent.time<seed.time)throw Error('The node was missed. Delete it or mark it flown before reviewing later nodes.');
      const body=world.body(intent.bodyId),surface=world.surface(body.id),coast=context.keplerCoast(seed,body,surface);
      if(!coast)throw Error('No safe analytic coast reaches this node.');
      const horizon=context.services.rails.horizon(world.system,body,seed,coast,seed.time,surface?.bounds.maxRadius??body.radius);
      if(!(horizon>=intent.time-seed.time))throw Error('A possible SOI or surface event requires a shorter leg or a new plan.');
      const solved=context.coastAt(coast,intent.time,body,surface,{cache:false});
      if(!solved.ok)throw Error(solved.diagnostics.reason??'Coast could not be solved.');
      const before:State={...seed,...solved.state,time:intent.time,coast}, delta=maneuverDelta(before,intent.prograde,intent.radial);
      const after:State={...before,coast:undefined,velocity:{x:before.velocity.x+delta.x,y:before.velocity.y+delta.y},revision:seed.revision+1};
      result={intent,valid:true,reason:'',seed,before,after,delta};seed=after;
     }catch(error){reason=error instanceof Error?error.message:'Plan evaluation failed.';result={intent,valid:false,reason};}
     results.push(result);
    }
   }finally{context?.dispose();}
   return results;
  },
 };
 return Object.freeze(service);
}
export default function initialize(context:ModuleInitializationV2):void {
 context.provide(FLIGHT_PLANS,createFlightPlans());
 context.contributeGuide({id:'usage',audience:'creators',title:'Shared flight-plan intent',summary:'Portable inert plans and bounded selected-provider chain evaluation.',asset:'docs/creators/usage.json'});
}
