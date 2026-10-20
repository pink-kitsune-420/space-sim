import {mkdirSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import solarSystem from '../../games/space-sim/universes/astronomy/full-solar-system/universe.json';
import {World} from '../../packages/sim-core/src/world';
import {createFlightPlans} from '../../modules/flight-plans/src/index';
import {createManeuverBurns} from '../../modules/maneuver-burn/src/index';
import {createTransferPlanner} from '../../modules/transfer-planner/src/index';
import type {UniverseDefinition,TransferResult} from '../../packages/game-api/src/index';

it('plans a multi-year Earth to Europa mission without silently selecting Jupiter',()=>{
 const world=new World(solarSystem as UniverseDefinition),ship=world.spawn({ownerId:'pilot',presetId:'earth-orbit'}),burns=createManeuverBurns({stepSeconds:.01,idle:{engine:false,turn:0,throttle:0}}),plans=createFlightPlans(burns),solver=createTransferPlanner(plans,burns),year=365.25*86400;
 const job=solver.search(world,{shipId:ship.id,destinationId:'europa',periapsisAltitude:100000,apoapsisAltitude:100000,maxFlightSeconds:10*year});
 try{
  const routes=new Set<string>();let result:TransferResult|undefined,count=0;const at=performance.now();
  for(;count<50000000;count++){const step=job.next();for(const option of step.value.options??[])routes.add(option.route!.bodyIds.join(' → '));if(step.done){result=step.value;break;}}
  mkdirSync('private-docs/measurements/end-to-end-transfers',{recursive:true});writeFileSync('private-docs/measurements/end-to-end-transfers/earth-europa.json',JSON.stringify({count,ms:performance.now()-at,reason:result?.reason,compared:result?.compared,seen:[...routes],routes:result?.options.map(o=>({bodies:o.route?.bodyIds,deltaV:o.deltaV,years:(o.waitSeconds+o.travelSeconds)/year}))}));
  expect(result?.compared?.staged,'staged route must be validated as a whole').toBeGreaterThan(0);
  expect(routes.has('earth → europa'),'direct route must also be compared').toBe(true);
  expect(result?.options.length,result?.reason??'work limit').toBeGreaterThan(0);
  for(const option of result!.options){expect(option.plan.nodes.at(-1)!.bodyId).toBe('europa');expect(option.route?.finiteValidated).toBe(true);expect(option.waitSeconds+option.travelSeconds).toBeGreaterThan(year);expect(option.waitSeconds+option.travelSeconds).toBeLessThanOrEqual(10*year);}
 }finally{job.return({options:[],reason:'cancelled'});burns.dispose();world.dispose();}
},240000);
