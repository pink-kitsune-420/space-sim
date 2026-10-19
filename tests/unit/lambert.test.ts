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

// Independent Kepler ellipse fixtures: position and velocity from true anomaly,
// flight time from eccentric anomaly. No game propagator generates these targets.
const cases=[{a:960,mu:13107200},{a:8e6,mu:3.986004418e14},{a:1.5e11,mu:1.32712440018e20}]
 .flatMap(scale=>[30,120,220,320].flatMap(degrees=>[-1,1].map(direction=>({...scale,degrees,direction}))));
it.each(cases)('matches an independent Kepler ellipse at a=$a m, angle=$degrees°, direction=$direction',({a,mu,degrees,direction})=>{
 const e=.3,f=degrees*Math.PI/180,p=a*(1-e*e),r1=a*(1-e),r2=p/(1+e*Math.cos(f));
 let eccentric=Math.atan2(Math.sqrt(1-e*e)*Math.sin(f),e+Math.cos(f));if(eccentric<0)eccentric+=2*Math.PI;
 const seconds=(eccentric-e*Math.sin(eccentric))*Math.sqrt(a*a*a/mu),speed=Math.sqrt(mu/p);
 const expectedStart={x:0,y:direction*Math.sqrt(mu*(1+e)/r1)},expectedEnd={x:-speed*Math.sin(f),y:direction*speed*(e+Math.cos(f))};
 const result=lambert({x:r1,y:0},{x:r2*Math.cos(f),y:direction*r2*Math.sin(f)},seconds,mu,direction);
 expect(result).toBeDefined();
 for(const [actual,expected] of [[result!.departure,expectedStart],[result!.arrival,expectedEnd]])expect(Math.hypot(actual!.x-expected!.x,actual!.y-expected!.y)).toBeLessThan(Math.sqrt(mu/a)*1e-9);
});
it.each([-2.3,-.7,.7,2.3].flatMap(angle=>[-1,1].map(direction=>({angle,direction}))))('matches a hyperbolic excess velocity using independent conic invariants: $angle/$direction',({angle,direction})=>{
 const mu=13107200,r=1024,infinity=45,vInf={x:infinity*Math.cos(angle),y:infinity*Math.sin(angle)},v=ejection({x:r,y:0},vInf,mu,direction)!;
 expect(v).toBeDefined();expect((v.x*v.x+v.y*v.y)/2-mu/r).toBeCloseTo(infinity*infinity/2,8);
 const h=r*v.y;expect(Math.sign(h)).toBe(direction);
 const eccentricity={x:r*v.y*v.y/mu-1,y:-r*v.x*v.y/mu},e=Math.hypot(eccentricity.x,eccentricity.y);
 expect(e).toBeGreaterThan(1);
 const outgoing=Math.atan2(eccentricity.y,eccentricity.x)+direction*Math.acos(-1/e);
 expect(Math.hypot(Math.cos(outgoing)-Math.cos(angle),Math.sin(outgoing)-Math.sin(angle))).toBeLessThan(1e-10);
});
it('rejects singular, collinear and nonfinite Lambert requests instead of returning a plausible transfer',()=>{
 for(const end of [{x:0,y:0},{x:1,y:0},{x:-1,y:0},{x:Infinity,y:1}])expect(lambert({x:1,y:0},end,1,1,1)).toBeUndefined();
 for(const seconds of [0,-1,Infinity])expect(lambert({x:1,y:0},{x:0,y:1},seconds,1,1)).toBeUndefined();
});
