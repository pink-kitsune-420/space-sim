import { describe, expect, it } from 'vitest';
import { createSurfaceProfile, querySurface, surfaceSupport, sweepGroundSurface, sweepSurface } from '../../packages/sim-core/src/index';

const ocean = createSurfaceProfile(100, [-10, -10, -10, -10], 0, 100);
const radiusMetres = 2.5;
describe('finite hull sea and rock union', () => {
  it('finds the expanded sea circle before the seabed with clear endpoints', () => {
    for (const sign of [-1, 1]) {
      const hit = sweepSurface(ocean, { x: -120 * sign, y: 0 }, { x: 120 * sign, y: 0 }, { radiusMetres });
      expect(hit.status).toBe('hit');
      if (hit.status !== 'hit') continue;
      expect(hit.fraction).toBeCloseTo(17.5 / 240, 8);
      expect(hit.position.x).toBeCloseTo(-102.5 * sign, 6);
      expect(hit.surface.material).toBe('water');
      expect(hit.surface.firstContactRadius).toBe(100);
      expect(hit.surface.groundRadius).toBe(90);
      expect(hit.surface.normal.x).toBeCloseTo(-sign, 8);
      expect(Math.abs(hit.clearanceMetres)).toBeLessThan(1e-7);
      expect(hit.surfaceIdentity).toBe(ocean.identity);
    }
  });
  it('sweeps submerged hulls only against rock and supports their actual seabed', () => {
    const hit = sweepGroundSurface(ocean, { x: 96, y: 0 }, { x: 88, y: 0 }, { radiusMetres });
    expect(hit.status).toBe('hit');
    if (hit.status === 'hit') {
      expect(hit.fraction).toBeCloseTo(3.5 / 8, 7);
      expect(hit.surface.material).toBe('rock');
      expect(hit.position.x).toBeCloseTo(92.5, 6);
    }
    expect(surfaceSupport(ocean, 0, radiusMetres).centerRadiusMetres).toBeCloseTo(92.5, 6);
  });
  it('preserves off-centre coastal rock contact rather than using centre-angle material', () => {
    const elevations = Array<number>(128).fill(-10); elevations[0] = 12;
    const shore = createSurfaceProfile(100, elevations, 0, 100), angle = .028;
    const support = surfaceSupport(shore, angle, radiusMetres), r = support.centerRadiusMetres!;
    const p = { x: r * Math.cos(angle), y: r * Math.sin(angle) };
    const hit = sweepSurface(shore, p, p, { radiusMetres });
    expect(querySurface(shore, angle).material).toBe('water');
    expect(hit.status).toBe('hit');
    if (hit.status === 'hit') {
      expect(hit.surface.material).toBe('rock');
      // Independent dense curve distance and normal at the closest sampled point.
      let nearest = Infinity, qx = 0, qy = 0;
      for (let i = 0; i <= 20000; i++) {
        const a = -.02 + i * .000004, u = ((a / (2 * Math.PI) * 128) % 128 + 128) % 128, k = Math.floor(u);
        const r = 100 + elevations[k]! * (1 - (u-k)) + elevations[(k+1)%128]! * (u-k);
        const x = r * Math.cos(a), y = r * Math.sin(a), d = Math.hypot(p.x-x,p.y-y);
        if (d < nearest) { nearest=d;qx=x;qy=y; }
      }
      expect(nearest).toBeCloseTo(radiusMetres, 5);
      expect(hit.surface.normal.x).toBeCloseTo((p.x-qx)/nearest, 3);
      expect(hit.surface.normal.y).toBeCloseTo((p.y-qy)/nearest, 3);
    }
  });
  it('bounds combined work and never claims an unchecked prefix is clear', () => {
    for (const maxWork of [1, 2, 5, 20]) {
      const hit = sweepSurface(ocean, { x: 110, y: 0 }, { x: 95, y: 0 }, { radiusMetres, maxWork });
      expect(hit.diagnostics.work).toBeLessThanOrEqual(maxWork);
      if (hit.status === 'failed') expect(hit.verifiedFraction).toBeLessThanOrEqual(.5);
    }
    expect(sweepSurface(ocean, { x: 110, y: 0 }, { x: 95, y: 0 }, { radiusMetres, maxWork: 1 })).toMatchObject({status:'failed',verifiedFraction:0});
    expect(sweepSurface(ocean, { x: 101, y: 0 }, { x: 102, y: 0 }, { radiusMetres })).toMatchObject({status:'failed',reason:'initial-penetration'});
  });
  it('finds an isolated sea tangency without treating a wide envelope as rock', () => {
    const hit=sweepSurface(ocean,{x:-120,y:102.5},{x:120,y:102.5},{radiusMetres});
    expect(hit.status).toBe('hit');
    if(hit.status==='hit') {expect(hit.fraction).toBeCloseTo(.5,4);expect(hit.surface.material).toBe('water');}
  });
});

import { createSimulationContext, IDLE, initialState, magnitude, setGodMode, STEP, waterForces, type Body, type State } from '../../packages/sim-core/src/index';
const body:Body={id:'wet-hull',radius:100,mu:100000};
const start=(r:number,v=0):State=>({...initialState(),status:'flying',position:{x:r,y:0},velocity:{x:v,y:0},heading:0});

describe('circular water entry, buoyancy and support',()=>{
  it('matches independently integrated circular area and keeps the point model unchanged',()=>{
    for(const q of [-1.2,-1,-.8,-.2,0,.2,.8,1,1.2]) {
      let area=0;const n=100000,dx=2/n;
      for(let i=0;i<n;i++){const y=-1+(i+.5)*dx;if(y < -q)area+=2*Math.sqrt(1-y*y)*dx;}
      const fraction=area/Math.PI,f=waterForces(ocean,{x:100+q*radiusMetres,y:0},querySurface,radiusMetres);
      expect(Math.abs(f.gravityFactor-(1-2*fraction))).toBeLessThan(3e-7);
      expect(Math.abs(f.drag-16*fraction)).toBeLessThan(3e-6);
    }
    expect(waterForces(ocean,{x:100,y:0})).toEqual({gravityFactor:1,drag:0});
    expect(waterForces(ocean,{x:100,y:0},querySurface,radiusMetres)).toEqual({gravityFactor:0,drag:8});
  });
  it('converges at second order against an independent radial RK4 water ODE',()=>{
    const force=(r:number,v:number)=>{const q=(r-100)/2.5,f=(Math.acos(q)-q*Math.sqrt(1-q*q))/Math.PI;return -10000/(r*r)*(1-2*f)-16*f*v;};
    let r=99.4,v=-.2;const T=.2,h=.0001;
    for(let i=0;i<2000;i++){const a=force(r,v),b=force(r+v*h/2,v+a*h/2),c=force(r+(v+a*h/2)*h/2,v+b*h/2),d=force(r+(v+b*h/2)*h,v+c*h);r+=h/6*(v+2*(v+a*h/2)+2*(v+b*h/2)+(v+c*h));v+=h/6*(a+2*b+2*c+d);}
    const errors=[];
    for(const dt of [.01,.005,.0025]){const ctx=createSimulationContext({contactRadiusMetres:radiusMetres});try{let s={...start(99.4,-.2),water:'submerged' as const};for(let i=0;i<Math.round(T/dt);i++)s=ctx.step(s,IDLE,dt,{...body,mu:10000},ocean) as typeof s;errors.push(Math.hypot(s.position.x-r,s.velocity.x-v));}finally{ctx.dispose();}}
    expect(errors[0]).toBeLessThan(.001);expect(errors[1]).toBeLessThan(errors[0]!/3.5);expect(errors[2]).toBeLessThan(errors[1]!/3.5);
  });
  it('survives gentle entry, floats without sinking rock columns, dives and launches',()=>{
    const ctx=createSimulationContext({contactRadiusMetres:radiusMetres,acceleration:30});try{
      let s=start(102.501,-1),entries=0,min=Infinity;
      for(let i=0;i<6000&&s.water!=='floating';i++){s=ctx.advance(s,IDLE,STEP,body,ocean);if(s.waterEntry){entries++;expect(magnitude(s.waterEntry.position)).toBeCloseTo(102.5,6);}min=Math.min(min,magnitude(s.position));expect(s.status).not.toBe('crashed');}
      expect(entries).toBe(1);expect(s).toMatchObject({status:'landed',water:'floating',position:{x:100,y:0},velocity:{x:0,y:0}});expect(min).toBeLessThan(100.01);
      const held=ctx.advance(s,IDLE,STEP,body,ocean);expect(held.position).toEqual(s.position);
      const launch=ctx.advance({...s,throttle:1}, {...IDLE,engine:true},STEP,body,ocean);expect(launch.status).toBe('flying');expect(launch.velocity.x).toBeGreaterThan(0);
      const dive=ctx.advance({...s,heading:Math.PI,throttle:1},{...IDLE,engine:true},STEP,body,ocean);expect(dive.status).toBe('flying');expect(dive.water).toBe('submerged');expect(dive.velocity.x).toBeLessThan(0);
    }finally{ctx.dispose();}
  });
  it('keeps the legacy radial crash threshold, water wreck support and God-mode recovery',()=>{
    const ctx=createSimulationContext({contactRadiusMetres:radiusMetres});try{
      const s=ctx.advance(start(102.501,-6),IDLE,STEP,body,ocean);expect(s).toMatchObject({status:'crashed',water:'floating',contact:{material:'water'}});expect(magnitude(s.position)).toBeCloseTo(102.5,6);
      expect(ctx.advance(s,IDLE,STEP,body,ocean).position).toEqual(s.position);
      const recovered=ctx.advance(setGodMode(s,true),IDLE,STEP,body,ocean);expect(recovered.status).toBe('flying');expect(recovered.water).toBe('submerged');
      expect(ctx.advance(setGodMode(start(102.501,-6),true),IDLE,STEP,body,ocean).status).toBe('flying');
    }finally{ctx.dispose();}
  });
  it('rests on shallow seabed without snapping a hull through it to float',()=>{
    const shallow=createSurfaceProfile(100,[-.2,-.2,-.2,-.2],0,100),ctx=createSimulationContext({contactRadiusMetres:radiusMetres});try{
      let s=start(102.501,-1),rockContacts=0;for(let i=0;i<600;i++){s=ctx.advance(s,IDLE,STEP,body,shallow);if(s.contact?.material==='rock')rockContacts++;expect(magnitude(s.position)).toBeGreaterThanOrEqual(102.3-1e-7);expect(s.water).not.toBe('floating');expect(s.status).not.toBe('crashed');}
      expect(s.status).toBe('landed');expect(rockContacts).toBe(1);
    }finally{ctx.dispose();}
  });
  it('rejects rock penetration and floating support outside equilibrium, but accepts partial immersion',()=>{
    const ctx=createSimulationContext({contactRadiusMetres:radiusMetres});try{
      expect(()=>ctx.step({...start(101),water:'submerged'},IDLE,STEP,body,ocean)).not.toThrow();
      expect(()=>ctx.step({...start(91),water:'submerged'},IDLE,STEP,body,ocean)).toThrow('initial-penetration');
      expect(()=>ctx.step({...start(101),status:'landed',water:'floating'},IDLE,STEP,body,ocean)).toThrow('floating support');
      expect(()=>ctx.step({...start(103),water:'submerged'},IDLE,STEP,body,ocean)).toThrow('Invalid water state');
    }finally{ctx.dispose();}
  });
  it('matches every live entry vertex and ghost step through gentle float and heavy impact',()=>{
    for(const speed of [-1,-6]){const ctx=createSimulationContext({contactRadiusMetres:radiusMetres});try{
      let live=start(102.501,speed),end='';const job=ctx.predict(live,false,body,ocean);expect(job.next().value).toMatchObject({position:live.position});
      for(let i=0;i<8192;i++){live=ctx.advance(live,IDLE,STEP,body,ocean);if(live.waterEntry)expect(job.next().value).toEqual(live.waterEntry);expect(job.next().value).toMatchObject({position:live.position,time:live.contact?.time??live.time});if(live.status!=='flying'){end=job.next().value as string;break;}}
      expect(end).toBe(speed===-6?'impact':'floating');
    }finally{ctx.dispose();}}
  });
});

describe('rotating circular water and bounded caches',()=>{
  it('uses inward radial speed relative to moving water, not tangential speed',()=>{
    const ctx=createSimulationContext({contactRadiusMetres:radiusMetres});try{
      const rotating={...body,rotation:{period:100,direction:1 as const,phase:.7}},omega=2*Math.PI/100;
      const slow=ctx.advance({...start(102.501,-1),velocity:{x:-1,y:omega*102.501+20}},IDLE,STEP,rotating,ocean);
      expect(slow.status).toBe('flying');expect(slow.waterEntry).toBeDefined();
      const fast=ctx.advance({...start(102.501,-6),velocity:{x:-6,y:omega*102.501}},IDLE,STEP,rotating,ocean);
      expect(fast).toMatchObject({status:'crashed',water:'floating',contact:{material:'water'}});expect(magnitude(fast.contact!.impactVelocity)).toBeLessThan(6.2);
    }finally{ctx.dispose();}
  });
  it('settles at co-rotating force balance and holds body-fixed support',()=>{
    for(const direction of [-1,1] as const){const ctx=createSimulationContext({contactRadiusMetres:radiusMetres});try{
      const rotating={...body,rotation:{period:100,direction,phase:.7}},omega=direction*2*Math.PI/100;
      let s={...start(102.501,-1),velocity:{x:-1,y:omega*102.501}};
      for(let i=0;i<6000&&s.water!=='floating';i++)s=ctx.advance(s,IDLE,STEP,rotating,ocean);
      expect(s.status).toBe('landed');expect(s.water).toBe('floating');expect(magnitude(s.position)).toBeGreaterThan(100);
      const r=magnitude(s.position),f=waterForces(ocean,{x:r,y:0},querySurface,radiusMetres);
      expect(Math.abs(-body.mu/(r*r)*f.gravityFactor+omega*omega*r)).toBeLessThan(1e-7);
      const p=s.position;for(let i=0;i<20;i++)s=ctx.advance(s,IDLE,STEP,rotating,ocean);expect(s.position).toEqual(p);expect(s.velocity).toEqual({x:0,y:0});
    }finally{ctx.dispose();}}
  });
  it('retains sea tangency correctness when hull sizes alternate on one profile',()=>{
    for(const radiusMetres of [.1,2.5,32,.1]){const hit=sweepSurface(ocean,{x:-150,y:100+radiusMetres},{x:150,y:100+radiusMetres},{radiusMetres});expect(hit.status).toBe('hit');if(hit.status==='hit')expect(hit.fraction).toBeCloseTo(.5,7);}
  });
});

import oceanUniverse from '../../games/space-sim/universes/sandbox/ocean/universe.json';
import { World } from '../../packages/sim-core/src/world';
import { inertialState, validateUniverse } from '../../packages/sim-core/src/index';
describe('world water recovery frames',()=>{
  it.each([0,2.5])('recovers rotating water wrecks into inertial flight with hull radius %s',contactRadiusMetres=>{
    const raw=structuredClone(oceanUniverse),system=raw.systems[0]!;
    Object.assign(system,{vehicleDefaults:{contactRadiusMetres}});Object.assign(system.bodies[0]!,{rotation:{period:1000,direction:1,phaseRadiansAtEpoch:.7}});
    const heavy=system.presets.find(p=>p.id==='heavy')!;heavy.position=[514+contactRadiusMetres+.001,0];heavy.velocity=[-8,0];
    const world=new World(validateUniverse(raw));try{
      for(let i=0;i<2;i++)world.spawn({ownerId:'pilot',presetId:'heavy'});world.step();
      const wreck=world.ships()[0]!;expect(wreck.state.status).toBe('crashed');const expected=inertialState(wreck.state,world.body(wreck.bodyId));
      // The old no-body call only changed status, leaving this fixed position in
      // the wrong frame. Explicitly retain that baseline as regression evidence.
      expect(Math.hypot(expected.position.x-wreck.state.position.x,expected.position.y-wreck.state.position.y)).toBeGreaterThan(100);
      world.setGodMode(wreck.id,true);const recovered=world.ship(wreck.id)!.state;expect(recovered.position).toEqual(expected.position);expect(recovered.velocity).toEqual(expected.velocity);expect(recovered.status).toBe('flying');
      world.setGodModeAll(true);expect(world.ships().every(s=>s.state.status==='flying')).toBe(true);expect(()=>world.step()).not.toThrow();
    }finally{world.dispose();}
  });
});
