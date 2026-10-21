import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { TRAINER_VEHICLE_ID, captureVehicleCatalog, captureVehicleDefinition, captureVehicleAppearance, createVehicleArtwork,
  type VehicleCatalog, type ManifestV2, type ModuleProfileV2, type RegisteredModuleV2 } from '../../packages/game-api/src/index';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { IDLE } from '../../packages/sim-core/src/constants';
import { OCEAN_UNIVERSE, SOLAR_UNIVERSE, TERRAIN_UNIVERSE } from '../../packages/scenarios/builtin';
import { saveWorld, loadWorld, shipToSaved } from '../../packages/sim-core/src/save';
import { createSimulationContext } from '../../packages/sim-core/src/context';
import { engineModuleServices } from '../../packages/sim-core/src/module-services';
import { moduleWorldConfiguration } from '../../packages/sim-core/src/module-world';
import { ModuleRegistryV2, moduleAssets } from '../../packages/game-runtime/src/modules-v2';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { encodeUniverseSave, decodeUniverseSave } from '../../packages/game-library/src/save-package';
import { createFlightSessions } from '../../modules/session-flight/src/index';
import { flightSessionServices } from '../../packages/net/src/session-services';
import { loopback } from '../../packages/net/src/connection';
import { captureDataAdapter } from '../../packages/game-runtime/src/module-data';
import { inventory } from '../../examples/packages/inventory/src/index';
import { trainer } from '../../modules/vehicle-trainer/src/index';
import { trainerAppearance } from '../../modules/appearance-trainer/src/index';
import trainerDescriptor from '../../modules/vehicle-trainer/module.json';

const alternative = { id: 'fixture.shuttle/test', name: 'Test shuttle', handling: { acceleration: 50, turnRate: .5, initialThrottle: .8 } };
const vehicles: VehicleCatalog = captureVehicleCatalog({ format: 'space-sim-vehicles/1', defaultId: TRAINER_VEHICLE_ID, definitions: [trainer, alternative] });
const clean: (() => unknown)[] = [];
afterEach(async () => { for (const dispose of clean.splice(0).reverse()) await dispose(); });
function world(catalog: VehicleCatalog | undefined = vehicles) { const w = new World(DEFAULT_UNIVERSE, { vehicles: catalog }); clean.push(() => w.dispose()); return w; }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('per-craft vehicle authority', () => {
  it('captures immutable bounded namespaced definitions, catalogs and optional vector artwork', () => {
    const input = structuredClone(alternative), captured = captureVehicleDefinition(input); input.handling.acceleration = 99;
    expect(captured.handling!.acceleration).toBe(50); expect(Object.isFrozen(captured.handling)).toBe(true);
    for (const value of [NaN, Infinity, -1, 1e10]) expect(() => captureVehicleDefinition({ ...alternative, handling: { ...alternative.handling, acceleration: value } })).toThrow();
    for (const id of ['trainer', '../trainer', 'fixture/ship', 'fixture.ship/', 'fixture.ship/'+'x'.repeat(33)]) expect(() => captureVehicleDefinition({ ...trainer, id })).toThrow();
    expect(() => captureVehicleCatalog({ ...vehicles, defaultId: 'fixture.missing/craft' })).toThrow();
    expect(() => captureVehicleCatalog({ ...vehicles, definitions: [trainer, trainer] })).toThrow();
    expect(() => captureVehicleAppearance({ ...trainerAppearance, hull: [{ x: Infinity, y: 0 }, {x:0,y:0},{x:1,y:1}] })).toThrow();
    expect(() => captureVehicleAppearance({ ...trainerAppearance, hull: Array(129).fill({x:1,y:1}) })).toThrow();
    const art = createVehicleArtwork([trainerAppearance]); expect(art.get()).toEqual(trainerAppearance); expect(art.get(alternative.id)).toBeUndefined();
    expect(() => createVehicleArtwork([trainerAppearance, trainerAppearance])).toThrow('Duplicate');
  });

  it('preserves default trainer state and events across launch/turn/cutoff/coast/contact/water and legacy save versions', () => {
    for (const universe of [DEFAULT_UNIVERSE, SOLAR_UNIVERSE, TERRAIN_UNIVERSE, OCEAN_UNIVERSE]) {
      const legacy = new World(universe), extracted = new World(universe, { vehicles });
      try {
        for (const preset of legacy.system.presets) for (const w of [legacy, extracted]) w.spawn({ ownerId: 'pilot', presetId: preset.id });
        for (let tick = 0; tick < 300; tick++) {
          for (const w of [legacy, extracted]) for (const ship of w.records()) {
            if (tick === 10) w.setControls(ship.id, { turn: .5, throttle: .1, engine: true });
            if (tick === 30) w.setThrottle(ship.id, .8);
            if (tick === 50) w.setControls(ship.id, IDLE);
          }
          expect(extracted.step()).toEqual(legacy.step());
        }
        expect(extracted.ships().map(s => s.state)).toEqual(legacy.ships().map(s => s.state));
        for (const version of [1, 2]) {
          const saved = saveWorld(legacy, { version }), restored = loadWorld(saved);
          try { expect(saveWorld(restored.world, { version })).toEqual(saved); } finally { restored.world.dispose(); }
        }
        const old = loadWorld(saveWorld(legacy), { vehicles });
        try { expect(old.world.ships().map(s => { const {vehicleId: _id, ...saved}=shipToSaved(s); return saved; })).toEqual(legacy.ships().map(shipToSaved)); expect(old.world.ships().every(s => s.vehicleId === TRAINER_VEHICLE_ID)).toBe(true); }
        finally { old.world.dispose(); }
      } finally { legacy.dispose(); extracted.dispose(); }
    }
  });

  it('selects handling per vessel, preserves universe defaults and keeps identity through state replacement and predictions', () => {
    const w = world(), a = w.spawn({ ownerId: 'ada', presetId: 'planet-orbit' }), b = w.spawn({ ownerId: 'bob', presetId: 'planet-orbit', vehicleId: alternative.id });
    const fixed = createSimulationContext(alternative.handling), start = b.state;
    try {
      expect(w.contextFor(a)).toBe(w.context); expect(w.contextFor(b).vehicle).toEqual(alternative.handling);
      expect(b.state.throttle).toBe(.8); const controls = { turn: 1, throttle: 0, engine: true };
      w.setControls(b.id, controls); w.step();
      expect(w.ship(b.id)!.state).toEqual(fixed.advance(start, controls, .01, w.body(b.bodyId), w.surface(b.bodyId)));
      expect(w.contextFor(a).vehicle).toEqual(w.system.vehicleDefaults);
      const clone = w.cloneForPrediction(); try { expect(clone.contextFor(b).vehicle).toEqual(alternative.handling); expect(clone.contextFor(b)).not.toBe(w.contextFor(b)); } finally { clone.dispose(); }
      const before = JSON.stringify(saveWorld(w)); const prediction = w.contextFor(b).cloneForPrediction();
      try { const path = prediction.predict(w.ship(b.id)!.state, false, w.body(b.bodyId), w.surface(b.bodyId)); for (let i=0;i<30;i++) if(path.next().done) break; path.return('open'); } finally { prediction.dispose(); }
      expect(JSON.stringify(saveWorld(w))).toBe(before);
      w.respawn(b.id, 'planet-orbit'); expect(w.ship(b.id)!.vehicleId).toBe(alternative.id); expect(w.ship(b.id)!.state.throttle).toBe(.8);
      w.teleport(b.id, b.bodyId, start.position, start.velocity); expect(w.ship(b.id)!.vehicleId).toBe(alternative.id);
      w.setControls(b.id, IDLE); w.advanceTo(w.tick+200); expect(w.ship(b.id)!.vehicleId).toBe(alternative.id);
      w.put({ ...w.ship(b.id)!, ownerId: 'ada' }); expect(w.ownedBy('ada').has(b.id)).toBe(true); expect(w.ownedBy('bob').size).toBe(0);
      const number = w.nextShipNumber; expect(() => w.spawn({ownerId:'ada', vehicleId:'fixture.missing/craft'})).toThrow('Missing required vehicle'); expect(w.nextShipNumber).toBe(number);
    } finally { fixed.dispose(); }
  });

  it('releases every vehicle context when one provider cleanup fails', () => {
    const closed: number[] = [];
    const w = new World(DEFAULT_UNIVERSE, { vehicles, createContext(settings, options) {
      const context = createSimulationContext(settings, options), close = context.dispose.bind(context); let disposed = false;
      return { ...context, dispose() { if (disposed) return; disposed = true; close(); closed.push(settings.acceleration); if (settings.acceleration === 125) throw new Error('Provider cleanup failed'); } };
    } });
    expect(() => w.dispose()).toThrow('World motion context cleanup'); expect(closed.sort((a,b) => a-b)).toEqual([50,125]);
    expect(() => w.dispose()).not.toThrow();
  });

  it('replays mixed coasts identically with and without rails and releases every context', () => {
    const fast = world(), slow = world(); slow.rails = false;
    for (const w of [fast, slow]) for (const vehicleId of [TRAINER_VEHICLE_ID, alternative.id]) w.spawn({ ownerId: 'pilot', vehicleId, presetId: 'planet-orbit' });
    for (let tick=0;tick<200;tick++) { fast.step(); slow.step(); }
    expect(fast.ships().map(shipToSaved)).toEqual(slow.ships().map(shipToSaved));
    expect(fast.asleepCount).toBe(2);
    for (const w of [fast,slow]) { w.setControls('ship-2',{turn:.5,throttle:0,engine:true}); w.step(); }
    expect(fast.ships().map(shipToSaved)).toEqual(slow.ships().map(shipToSaved));
  });

  it('roundtrips version 4 with exact vehicle packages and module data, rejects missing/changed definitions and never downgrades identity', async () => {
    const adapter = captureDataAdapter('fixture.cargo', inventory), w = new World(DEFAULT_UNIVERSE, { vehicles, dataAdapters:[adapter], soloPreview:false }); clean.push(()=>w.dispose());
    w.spawn({ownerId:'ada', vehicleId: alternative.id, presetId:'planet-orbit'}); w.data.set({adapter:adapter.id,id:'ada'}, {count:12}); w.advanceTo(100);
    const saved = saveWorld(w); expect(saved.version).toBe(4); expect(saved.ships[0]!.vehicleId).toBe(alternative.id);
    const decoded = await decodeUniverseSave(await encodeUniverseSave(saved)); expect(decoded).toEqual(saved);
    const restored=loadWorld(decoded,{vehicles,dataAdapters:[adapter],soloPreview:false}); clean.push(()=>restored.world.dispose());
    expect(saveWorld(restored.world)).toEqual(saved); expect(restored.world.contextFor(restored.world.ships()[0]!).vehicle).toEqual(alternative.handling);
    expect(()=>loadWorld(saved)).toThrow('Missing required vehicle');
    expect(()=>loadWorld(saved,{vehicles:{...vehicles,definitions:[trainer]},dataAdapters:[adapter]})).toThrow('definitions differ');
    expect(()=>loadWorld({...saved,ships:[{...saved.ships[0],vehicleId:undefined}]},{vehicles,dataAdapters:[adapter]})).toThrow('explicit identity');
    expect(()=>loadWorld({...saved,version:2},{vehicles,dataAdapters:[adapter]})).toThrow('version 4');
    expect(()=>saveWorld(w,{version:2})).toThrow('version 4');
    const alternate=world({...vehicles,definitions:[trainer,{...alternative,handling:{...alternative.handling,acceleration:51}}]});
    expect(alternate.simulationFingerprint).not.toBe(w.simulationFingerprint);
    const plain=new World(DEFAULT_UNIVERSE);clean.push(()=>plain.dispose());const legacy=plain.spawn({ownerId:'pilot'}); plain.put({...legacy,vehicleId:TRAINER_VEHICLE_ID}); expect(plain.ship(legacy.id)!.vehicleId).toBeUndefined(); const reloaded=loadWorld(saveWorld(plain));reloaded.world.dispose();
    const mapped=world();mapped.put(legacy);expect(mapped.ship(legacy.id)!.vehicleId).toBe(TRAINER_VEHICLE_ID);
    const replacement=world({format:'space-sim-vehicles/1',defaultId:alternative.id,definitions:[alternative]});
    expect(replacement.spawn({ownerId:'pilot'}).vehicleId).toBe(alternative.id); expect(()=>replacement.put({...w.ships()[0]!,vehicleId:TRAINER_VEHICLE_ID})).toThrow('Missing required vehicle');
  });

  it('negotiates exact vehicles, enforces ownership, replicates alternate spawns and restores them on reconnect', async () => {
    const w = world(), factory=createFlightSessions(flightSessionServices()),host=factory.host(w);clean.push(()=>factory.dispose());
    let token='';
    async function connect(name:string,catalog:VehicleCatalog|undefined,reconnect?:string){
      const [server,client]=loopback();const joining=factory.join(client,{name,vehicles:catalog,token:()=>reconnect,saveToken:(_id,t)=>{if(name==='Ada')token=t;}},new AbortController().signal);host.accept(server);return joining;
    }
    await expect(connect('Legacy',undefined)).rejects.toThrow('vehicle packages');
    const ada=await connect('Ada',vehicles),bob=await connect('Bob',vehicles);host.setPaused(true);await flush();
    ada.spawn('planet-orbit',false,alternative.id);await flush();host.service();await flush();ada.update(0,undefined,IDLE);
    const owned=w.ships().find(s=>s.ownerId===ada.playerId&&s.vehicleId===alternative.id)!;expect(owned).toBeDefined();
    expect(ada.world.ship(owned.id)!.vehicleId).toBe(alternative.id);expect(ada.world.contextFor(owned).vehicle).toEqual(alternative.handling);
    expect(()=>host.setControls(bob.playerId,owned.id,{turn:1,throttle:0,engine:true})).toThrow();
    host.setControls(ada.playerId,owned.id,{turn:1,throttle:0,engine:true});ada.dispose();await flush();expect(w.ship(owned.id)!.controls).toEqual(IDLE);
    const again=await connect('Ada',vehicles,token);expect(again.playerId).toBe(owned.ownerId);expect(again.world.ship(owned.id)!.vehicleId).toBe(alternative.id);
    const saved=saveWorld(w,{players:host.roster()});const restored=loadWorld(saved,{vehicles});clean.push(()=>restored.world.dispose());expect(saveWorld(restored.world,{players:restored.players})).toEqual(saved);
    bob.dispose();again.dispose();
  });

  it('imports both editable archives through public hooks, separates tiers and composes a second headless game', async () => {
    const directory=await mkdtemp(join(tmpdir(),'portable-vehicles-'));clean.push(()=>rm(directory,{recursive:true,force:true}));
    const registrations=[];
    for(const name of ['vehicle-trainer','appearance-trainer']){
      const source=join(directory,name),output=join(directory,`${name}.spacemod`);await cp(resolve(`modules/${name}`),source,{recursive:true});await buildPortableModule(join(source,'module.json'),output,{typecheck:false});
      registrations.push(await inspectRuntimePackage(new Uint8Array(await readFile(output))));
    }
    for(const environment of ['browser','offline','node'] as const){
      const graph=new ModuleRegistryV2(engineModuleServices());
      for(const archive of registrations.filter(a=>environment!=='node'||a.id==='spacelab.trainer')){const registration=archive.register({environment,allowRuntimeCode:true,approvedDigests:new Set([archive.digest])});graph.register(registration.module,registration.assets);}
      const modules=registrations.filter(a=>environment!=='node'||a.id==='spacelab.trainer').map(a=>({id:a.id,version:a.version}));
      const profile:ModuleProfileV2={format:'space-sim-profile/2',id:'fixture.second-flight',modules,providers:{},capabilities:{},settings:{}};
      const candidate=graph.prepare(profile,environment);try{
        expect(candidate.soloPreview).toBe(false);expect(candidate.contributions('vehicle').map(c=>c.value)).toEqual([trainer]);
        expect(candidate.contributions('vehicleAppearance')).toHaveLength(environment==='node'?0:1);
        const identity={format:'spacelab-runtime-game/2' as const,environment,lock:candidate.lock,contentDigests:{},gameLockDigest:'a'.repeat(64),manifests:[...graph.manifests.values()],packages:registrations.filter(a=>modules.some(m=>m.id===a.id)).map(a=>({id:a.id,version:a.version,digest:a.digest})),authoritativeDigest:'a'.repeat(64)};
        const configuration=moduleWorldConfiguration(candidate,identity),w=new World(configuration.universe,configuration.options);try{const ship=w.spawn({ownerId:'pilot'});w.setControls(ship.id,{turn:0,throttle:0,engine:true});for(let i=0;i<100;i++)w.step();expect(w.ship(ship.id)!.state.status).toBe('flying');expect(w.ship(ship.id)!.vehicleId).toBe(TRAINER_VEHICLE_ID);}finally{w.dispose();}
      }finally{candidate.dispose();}
      const absent=graph.prepare({...profile,modules:[]},environment);expect(absent.contributions('vehicle')).toEqual([]);absent.dispose();
    }
    const invalid:RegisteredModuleV2={manifest:{...trainerDescriptor.manifest,tier:'presentation',requires:[]} as ManifestV2,initialize(context){context.contributeVehicle(trainer);}};
    const graph=new ModuleRegistryV2();graph.register(invalid,moduleAssets());
    const profile:ModuleProfileV2={format:'space-sim-profile/2',id:'fixture.invalid',modules:[{id:invalid.manifest.id,version:invalid.manifest.version}],providers:{},capabilities:{},settings:{}};
    expect(()=>graph.prepare(profile,'browser')).toThrow('unavailable to presentation');
  },60000);
});
