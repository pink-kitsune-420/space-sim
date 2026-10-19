import { describe, expect, it } from 'vitest';
import type { Camera, GhostSample, PresentationView } from '../../packages/game-api/src/index';
import { maneuverDelta, drawManeuver } from '../../modules/maneuver-display/src/overlay';
import { maneuverWarpFactor, pickManeuverTime } from '../../apps/web/src/maneuver-planner';
import { validateOverlay } from '../../packages/game-runtime/src/index';
import { navballState, drawNavball } from '../../modules/navball/src/drawing';
import { project } from '../../packages/render-2d/src/frame';
import { ManeuverBurn } from '../../apps/web/src/maneuver-burn';
import { LocalSession } from '../../apps/web/src/session';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE, IDLE, STEP } from '../../packages/sim-core/src/index';

const camera: Camera = { center: { x: 0, y: 0 }, rotation: 0, scale: 1 };
const origin = { x: 0, y: 0 };
const a: GhostSample = { time: 0, position: { x: -100, y: 0 }, velocity: { x: 20, y: 40 } };
const b: GhostSample = { time: 10, position: { x: 100, y: 0 }, velocity: { x: 20, y: -40 } };
const view: PresentationView = {
  time: 0, tick: 0, paused: true, elapsed: 0, viewport: { width: 800, height: 600, pixelRatio: 1 },
  body: { id: 'planet', name: 'Planet', radius: 50, mu: 1e6, position: origin },
  vehicle: { acceleration: 10, turnRate: 1, initialThrottle: 1 }, analyticOrbits: true, orbit: null,
  groundClearance: 50, prediction: { status: 'closed', samples: 2 }, moduleState: {}, camera,
  ship: { id: 's', name: 'Ship', bodyId: 'planet', state: { time: 0, position: a.position, velocity: a.velocity, heading: 0, throttle: 1, status: 'flying', revision: 0 },
    position: a.position, controls: { turn: 0, throttle: 0, engine: false } },
};

describe('maneuver planning', () => {
  it.each([{ x: .03, y: .04 }, { x: -137, y: 29 }, { x: 0, y: -25 }])(
    'executes a finite burn %j identically across fast and stalled rendering frames', delta => {
      const fly = (frames: readonly number[]) => {
        const world = new World(DEFAULT_UNIVERSE);
        const session = new LocalSession(world, { name: 'Pilot' });
        const id = session.spawn('planet-orbit', false)!;
        const burn = new ManeuverBurn(5, delta, world.context.vehicle);
        let calls = 0, first = Infinity, last = -Infinity, deliveredX = 0, deliveredY = 0;
        const finalTick = 800;
        for (let frame = 0; world.tick < finalTick; frame++) {
          const seconds = Math.min(frames[frame % frames.length]!, (finalTick - world.tick) * STEP - session.alpha * STEP);
          session.update(seconds, id, IDLE, () => {
            calls++;
            const ship = world.ship(id)!, command = burn.next(ship.state);
            if (command.throttle !== undefined) session.setThrottle(id, command.throttle);
            if (command.controls.engine) {
              first = Math.min(first, world.time); last = world.time + STEP;
              const impulse = world.context.vehicle.acceleration * command.throttle! * STEP;
              deliveredX += Math.cos(ship.state.heading) * impulse; deliveredY += Math.sin(ship.state.heading) * impulse;
            }
            return command.controls;
          });
        }
        expect(calls).toBe(finalTick);
        expect(burn.phase).toBe('complete');
        expect(burn.remaining).toBeLessThan(1e-8);
        expect(deliveredX).toBeCloseTo(delta.x, 8); expect(deliveredY).toBeCloseTo(delta.y, 8);
        expect(Math.abs((first + last) / 2 - 5)).toBeLessThanOrEqual(STEP);
        expect(world.ship(id)!.controls).toEqual(IDLE);
        expect(world.ship(id)!.state.throttle).toBe(0);
        const state = world.ship(id)!.state;
        world.dispose();
        return state;
      };
      expect(fly([.2, .01, .07, .03])).toEqual(fly([.01]));
    });
  it('refuses impossible burns and detects skipped physics ticks', () => {
    expect(() => new ManeuverBurn(5, { x: 0, y: 0 }, view.vehicle)).toThrow();
    expect(() => new ManeuverBurn(5, { x: 1, y: 0 }, { ...view.vehicle, acceleration: 0 })).toThrow();
    const burn = new ManeuverBurn(.05, { x: 1, y: 0 }, { ...view.vehicle, turnRate: 0 });
    expect(() => burn.next({ ...view.ship!.state, heading: 1 })).toThrow('No steering');
    const state = { ...view.ship!.state, heading: 0, time: .1 };
    expect(burn.next(state).controls.engine).toBe(true);
    expect(() => burn.next({ ...state, time: .13 })).toThrow('clock changed');
  });
  it('keeps long-burn impulse accumulation precise through final cutoff', () => {
    const delta = { x: 1e6 * Math.cos(1), y: 1e6 * Math.sin(1) };
    const vehicle = { ...view.vehicle, acceleration: 125 };
    const burn = new ManeuverBurn(4000, delta, vehicle);
    for (let tick = 0; tick < 800002 && burn.phase !== 'complete'; tick++) {
      burn.next({ ...view.ship!.state, time: tick * STEP, heading: 1 });
    }
    expect(burn.phase).toBe('complete');
    expect(burn.remaining).toBeLessThan(1e-8);
  }, 20_000);
  it('picks the rendered Hermite arc between samples, with camera rotation and body translation', () => {
    // At t=1/2 the curve is 100 m above the chord: a vertex/chord picker would miss it.
    const shifted = { x: 1e10, y: -2e10 };
    const rotated = { center: shifted, rotation: .7, scale: 1.4 };
    const pointer = project({ x: shifted.x, y: shifted.y + 100 }, rotated, 800, 600);
    const time = pickManeuverTime([a, b], false, 0, pointer, rotated, shifted, 800, 600);
    expect(time).toBeCloseTo(5, 2);
    expect(pickManeuverTime([a, b], false, 0, { x: 400, y: 300 }, camera, origin, 800, 600)).toBeUndefined();
  });
  it('projects a captured drag far from the curve and limits it to the initial supported leg',()=>{
    const pointer={x:400,y:-100};
    expect(pickManeuverTime([a,b],false,0,pointer,camera,origin,800,600)).toBeUndefined();
    expect(pickManeuverTime([a,b],false,0,pointer,camera,origin,800,600,Infinity)).toBeCloseTo(5,2);
    const later={time:20,position:{x:800,y:400},velocity:{x:20,y:0},encounter:{from:'planet',to:'moon'}};
    const remote={x:1200,y:-100};
    const unrestricted=pickManeuverTime([a,b,later],false,0,remote,camera,origin,800,600,Infinity)!;
    const limited=pickManeuverTime([a,b,later],false,0,remote,camera,origin,800,600,Infinity,20)!;
    expect(unrestricted).toBeGreaterThan(10);expect(limited).toBeLessThanOrEqual(10);
    expect(pickManeuverTime([a,{...b,linear:true}],false,0,pointer,camera,origin,800,600,Infinity)).toBeUndefined();
  });
  it('rolls an old closed preview into the next future passage, and never selects past open paths', () => {
    const pointer = { x: 400, y: 200 };
    expect(pickManeuverTime([a, b], true, 32, pointer, camera, origin, 800, 600)).toBeCloseTo(35, 2);
    expect(pickManeuverTime([a, b], false, 32, pointer, camera, origin, 800, 600)).toBeUndefined();
    expect(pickManeuverTime([a, { ...b, linear: true }], false, 0, pointer, camera, origin, 800, 600)).toBeUndefined();
  });
  it('combines velocity-relative prograde and position-relative radial burns on eccentric orbits', () => {
    const sample = { time: 0, position: { x: 5, y: 0 }, velocity: { x: 3, y: 4 } };
    const delta = maneuverDelta(sample, 10, 4);
    expect(delta).toEqual({ x: 10, y: 8 });
    expect(Math.hypot(delta.x, delta.y)).toBeCloseTo(Math.sqrt(164));
    expect(maneuverDelta(sample, -10, -4)).toEqual({ x: -10, y: -8 });
    expect(maneuverDelta({ ...sample, velocity: { x: 0, y: 0 } }, 0, 4)).toEqual({ x: 4, y: 0 });
  });
  it('leaves at least half the approach window unused even after a long frame stall', () => {
    for (const seconds of [.01, .25, .3, 1, 2, 30, 100, 1000, 1e6]) {
      const warp = maneuverWarpFactor(seconds);
      expect(warp).toBeLessThanOrEqual(10_000);
      if (warp > 1) expect(.1 * warp).toBeLessThanOrEqual(seconds / 2);
    }
    expect(maneuverWarpFactor(0)).toBe(1);
    expect(maneuverWarpFactor(-100)).toBe(1);
  });
  it('renders bounded valid overlays and shows the burn direction in the navball', () => {
    const planned: PresentationView = { ...view, maneuver: { time: 5, position: a.position, deltaVelocity: { x: 3, y: 4 },
      burnSeconds: .5, valid: true, path: Array.from({ length: 1000 }, (_, i) => ({ ...a, time: i })) } };
    const primitives = drawManeuver(planned);
    expect(() => validateOverlay(primitives)).not.toThrow();
    expect(primitives.length).toBeLessThan(170);
    const nav = navballState(planned, 'orbit')!;
    expect(nav.maneuver).toBeCloseTo(Math.atan2(4, 3));
    expect(drawNavball(nav, { x: 100, y: 100 }, 0, 'horizon').some(p => p.color === '#f7c775')).toBe(true);
    expect(navballState({ ...planned, maneuver: { ...planned.maneuver!, valid: false } }, 'orbit')?.maneuver).toBeUndefined();
    expect(drawManeuver(view)).toEqual([]);
  });
});

it('draws distinct transfer burn vectors, throttle duration, zero-thrust status and delivered impulse progress within the overlay budget',()=>{
 const plan={time:5,position:a.position,deltaVelocity:{x:3,y:4},burnSeconds:.5,throttle:.25,throttleBurnSeconds:2,remainingDeltaV:2.5,valid:true,path:[a,b],
  nodes:[{id:'d',label:'Departure',time:5,position:a.position,selected:true,valid:true,deltaVelocity:{x:3,y:4},throttleBurnSeconds:2},
   {id:'a',label:'Arrival',time:10,position:b.position,selected:false,valid:true,deltaVelocity:{x:-3,y:4},throttleBurnSeconds:3}]};
 const primitives=drawManeuver({...view,maneuver:plan});expect(()=>validateOverlay(primitives)).not.toThrow();
 const labels=primitives.filter(p=>p.kind==='text').map(p=>p.text).join(' ');
 expect(labels).toContain('Arrival');expect(labels).toContain('5.0 m/s');expect(labels).toContain('2.0 s burn at 25% throttle');expect(labels).toContain('BURN · 2.5 m/s left');
 expect(drawManeuver({...view,maneuver:{...plan,throttle:0,throttleBurnSeconds:null}}).some(p=>p.kind==='text'&&p.text.includes('no thrust at 0%'))).toBe(true);
 const dense={...plan,path:Array.from({length:2000},(_,i)=>({...a,time:i})),nodes:Array.from({length:16},(_,i)=>({...plan.nodes[1]!,id:String(i)}))};
 expect(()=>validateOverlay(drawManeuver({...view,maneuver:dense}))).not.toThrow();
});

it('keeps completed burns in the journal without drawing completed targets as failed replans',()=>{
 const plan={time:5,position:a.position,deltaVelocity:{x:3,y:4},burnSeconds:.5,valid:false,completed:true,path:[],
  nodes:[{id:'d',label:'Departure',time:5,position:a.position,selected:true,completed:true,valid:false},
   {id:'a',label:'Arrival',time:10,position:b.position,selected:false,valid:false}]};
 const output=drawManeuver({...view,maneuver:plan}),labels=output.filter(p=>p.kind==='text').map(p=>p.text).join(' ');
 expect(labels).toContain('Arrival');expect(labels).not.toContain('NODE');expect(labels).not.toContain('Departure');
 expect(drawManeuver({...view,maneuver:{...plan,nodes:plan.nodes.map(node=>({...node,completed:true}))}})).toEqual([]);
});
