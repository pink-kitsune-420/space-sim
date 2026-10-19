import {expect,it} from 'vitest';
import {lambert,ejection} from '../../modules/transfer-planner/src/lambert';
import {createSimulationContext} from '../../packages/sim-core/src/context';
import {deterministicMath as dm} from '../../packages/game-api/src/index';
it('seeds short/long clockwise/counterclockwise transfers including hyperbolic and scaled conics',()=>{
 const ctx=createSimulationContext();
 for(const scale of [1,1e8])for(const direction of [-1,1])for(const factor of [.1,1,2]){
  const r=1000*scale,mu=1e7*scale*scale*scale,angle=direction*1.8,start={x:r,y:0},end={x:r*dm.cos(angle),y:r*dm.sin(angle)},seconds=1.8*Math.sqrt(r*r*r/mu)*factor;
  const solved=lambert(start,end,seconds,mu,direction)!;expect(solved).toBeDefined();
  const coast=ctx.services.orbits.propagate({position:start,velocity:solved.departure},mu,seconds);expect(coast.ok).toBe(true);
  if(coast.ok){expect(Math.hypot(coast.state.position.x-end.x,coast.state.position.y-end.y)).toBeLessThan(r*1e-9);expect(Math.hypot(coast.state.velocity.x-solved.arrival.x,coast.state.velocity.y-solved.arrival.y)).toBeLessThan(Math.sqrt(mu/r)*1e-9);}
 }
 expect(lambert({x:1,y:0},{x:-1,y:0},1,1,1)).toBeUndefined();ctx.dispose();
});
it('matches local hyperbolic energy and the outgoing asymptote with either angular-momentum sign',()=>{
 const ctx=createSimulationContext(),mu=1e6,position={x:100,y:30},infinity={x:-20,y:50};
 for(const direction of [-1,1]){
  const velocity=ejection(position,infinity,mu,direction)!;
  const orbit=ctx.services.orbits.elements({position,velocity},mu);
  expect(orbit.kind).toBe('hyperbolic');expect(Math.sign(orbit.angularMomentum)).toBe(direction);
  expect(orbit.energy).toBeCloseTo((infinity.x**2+infinity.y**2)/2,8);
  const far=ctx.services.orbits.propagate({position,velocity},mu,1e6);expect(far.ok).toBe(true);
  if(far.ok)expect(Math.hypot(far.state.velocity.x-infinity.x,far.state.velocity.y-infinity.y)).toBeLessThan(.001);
 }
 ctx.dispose();
});
