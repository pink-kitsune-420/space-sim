import { FLIGHT_PLANS, flightSampleInFrame, maneuverDelta, type EvaluatedFlightNode, type FlightPlan,
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
function readAlarm(raw:unknown): import('@space-sim/game-api').NodeAlarmSettings {
 const a=record(raw),lead=number(a.leadSeconds,'alarm lead',86400);
 if(lead<0||typeof a.enabled!=='boolean'||typeof a.pause!=='boolean'||(a.notified!==undefined&&typeof a.notified!=='boolean'))fail('invalid node alarm preferences');
 return {enabled:a.enabled as boolean,leadSeconds:lead,pause:a.pause as boolean,...(a.notified===true?{notified:true}:{})};
}
function readPlan(raw: unknown): FlightPlan {
 const p=record(raw), e=record(p.epoch), time=number(e.time,'epoch time',1e12);
 if (!Array.isArray(p.nodes) || p.nodes.length > MAX_PLAN_NODES) fail(`at most ${MAX_PLAN_NODES} nodes are supported`);
 const nodes: FlightPlanNode[]=[]; const ids=new Set<string>(); let previous=-Infinity;
 for (const raw of p.nodes as unknown[]) {
  const n=record(raw), id=text(n.id,'node id',64), at=number(n.time,'node time',1e12);
  if(ids.has(id))fail('duplicate node id'); ids.add(id);
  if((at < time && n.completed!==true) || at > time + MAX_PLAN_SECONDS || at <= previous)fail('nodes need increasing times within one year of their epoch'); previous=at;
  nodes.push({id,label:text(n.label,'node label',80),bodyId:text(n.bodyId,'body id'),time:at,
   prograde:number(n.prograde,'prograde delta-v',1e6),radial:number(n.radial,'radial delta-v',1e6),...(n.completed===true?{completed:true}:{}),...(n.alarm!==undefined?{alarm:readAlarm(n.alarm)}:{})});
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
  *evaluateAsync(plan,world,traceCoasts=false) {
   if(plan.nodes.length>MAX_PLAN_NODES)fail(`at most ${MAX_PLAN_NODES} nodes are supported`);
   const ship=world.ship(plan.shipId),results:EvaluatedFlightNode[]=[];
   let reason=plan.universeId!==world.universe.id||plan.systemId!==world.systemId||plan.fingerprint!==world.simulationFingerprint
    ? 'World or physics changed. Review the plan.' : !ship?'This ship is unavailable.'
    : !world.predictionFeatures?.futureSeeds?'This host does not support detached future prediction seeds.':'';
   const context=ship?world.contextFor(ship).cloneForPrediction():undefined;
   let seed:State={...plan.epoch,status:'flying',throttle:0,revision:0},bodyId=plan.bodyId;
   try {
    if(context&&(!context.capabilities.analyticCoast||!context.capabilities.rails||world.requiresWorldPrediction||context.modelIdentity!==plan.motionIdentity))
     reason='This plan needs compatible analytic motion and SOI horizons.';
    for(const [index,intent] of plan.nodes.entries()) {
     if(intent.completed){results.push({intent,valid:false,reason:'Completed. Later nodes require review against actual flight.'});continue;}
     let result:EvaluatedFlightNode={intent,valid:false,reason};
     if(!reason&&context)try {
      if(!world.hasBody(bodyId)||!world.hasBody(intent.bodyId))throw Error('The planned body is unavailable.');
      if(intent.time<seed.time)throw Error('The node was missed. Delete it or mark it flown before reviewing later nodes.');
      const body=world.body(bodyId),surface=world.surface(bodyId),coast=context.keplerCoast(seed,body,surface);
      const horizon=coast?context.services.rails.horizon(world.system,body,seed,coast,seed.time,surface?.bounds.maxRadius??body.radius):0;
      let before:State,localSeed=seed;
      if(!traceCoasts&&coast&&bodyId===intent.bodyId&&horizon>=intent.time-seed.time) {
       const solved=context.coastAt(coast,intent.time,body,surface,{cache:false});
       if(!solved.ok)throw Error(solved.diagnostics.reason??'Coast could not be solved.');
       before={...seed,...solved.state,time:intent.time,coast};
      }else {
       if(!world.predictionFeatures?.endTime)throw Error('Cross-body plans need exact-end-time prediction support.');
       const forecast=world.predictShip(plan.shipId,false,{state:seed,bodyId,until:intent.time});
       let last:import('@space-sim/game-api').GhostSample|undefined,end:import('@space-sim/game-api').GhostEnd='open';
       try {
        for(let count=0;count<=16384;count++) {
         const step=forecast.next();if(step.done){end=step.value;break;}
         last=step.value;
         if(last.encounter) {
          const local=flightSampleInFrame(last,last.bodyId!,world.system);
          localSeed={...seed,time:local.time,position:local.position,velocity:local.velocity,coast:undefined};
         }
         yield{node:index,sample:step.value};
        }
       }finally{forecast.return('open');}
       if(end!=='horizon'||!last||Math.abs(last.time-intent.time)>1e-7)throw Error(`Coast ended before the node (${end}); contact or prediction budget requires review.`);
       if((last.bodyId??bodyId)!==intent.bodyId)throw Error('The coast does not reach the planned body at this time.');
       const local=flightSampleInFrame({...last,bodyId:last.bodyId??bodyId},intent.bodyId,world.system);
       before={...seed,time:intent.time,position:local.position,velocity:local.velocity,coast:undefined};
      }
      const delta=maneuverDelta(before,intent.prograde,intent.radial),
       after:State={...before,coast:undefined,velocity:{x:before.velocity.x+delta.x,y:before.velocity.y+delta.y},revision:seed.revision+1};
      result={intent,valid:true,reason:'',seed:localSeed,before,after,delta};seed=after;bodyId=intent.bodyId;
     }catch(error){reason=error instanceof Error?error.message:'Plan evaluation failed.';result={intent,valid:false,reason};}
     results.push(result);
     if(traceCoasts&&result.after)yield{node:index,sample:{time:result.after.time,position:result.after.position,velocity:result.after.velocity,bodyId,frameId:bodyId}};
    }
   }finally{context?.dispose();}
   return results;
  },
  *predict(plan,world) {
   const evaluation=service.evaluateAsync!(plan,world,true);
   let evaluated:readonly EvaluatedFlightNode[];
   try {
    for(;;){const step=evaluation.next();if(step.done){evaluated=step.value;break;}
     if(step.value.sample)yield flightSampleInFrame(step.value.sample,plan.bodyId,world.system);
    }
   }finally{evaluation.return([]);}
   const valid=evaluated.filter(node=>node.valid),pending=evaluated.filter(node=>!node.intent.completed),last=valid.at(-1);
   if(!last)return 'failed';
   if(valid.length<pending.length)return 'open';
   const job=world.predictShip(plan.shipId,false,{state:last.after!,bodyId:last.intent.bodyId});
   try {
    for(let count=0;count<16384;count++) {
     const step=job.next();
     if(step.done)return valid.length>1&&step.value==='closed'?'horizon':step.value;
     yield flightSampleInFrame({...step.value,bodyId:step.value.bodyId??last.intent.bodyId,frameId:step.value.frameId??last.intent.bodyId},plan.bodyId,world.system);
    }
   }finally{job.return('open');}
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
      if(intent.bodyId!==plan.bodyId||!world.hasBody(intent.bodyId))throw Error('Later-body planning requires progressive evaluation.');
      if(intent.time<seed.time)throw Error('The node was missed. Delete it or mark it flown before reviewing later nodes.');
      const body=world.body(intent.bodyId),surface=world.surface(body.id),coast=context.keplerCoast(seed,body,surface);
      if(!coast)throw Error('No safe analytic coast reaches this node.');
      const horizon=context.services.rails.horizon(world.system,body,seed,coast,seed.time,surface?.bounds.maxRadius??body.radius);
      if(!(horizon>=intent.time-seed.time))throw Error('A possible SOI or surface event requires progressive evaluation.');
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
