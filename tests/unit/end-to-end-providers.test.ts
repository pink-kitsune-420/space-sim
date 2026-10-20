import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {ModuleRegistryV2,moduleAssets} from '../../packages/game-runtime/src/modules-v2';
import {engineModuleServices} from '../../packages/sim-core/src/module-services';
import {MANEUVER_BURNS,TRANSFERS,type ManifestV2} from '../../packages/game-api/src/index';
import burn from '../../modules/maneuver-burn/src/index';
import {createFlightPlans} from '../../modules/flight-plans/src/index';
import {createTransferPlanner} from '../../modules/transfer-planner/src/index';
import flight from '../../modules/flight-plans/src/index';
import transfer from '../../modules/transfer-planner/src/index';
import burnPackage from '../../modules/maneuver-burn/module.json';
import flightPackage from '../../modules/flight-plans/module.json';
import transferPackage from '../../modules/transfer-planner/module.json';
it('binds the selected finite controller without crossing presentation/platform module tiers',()=>{
 const registry=new ModuleRegistryV2(engineModuleServices()),modules=[{manifest:burnPackage.manifest as ManifestV2,initialize:burn},{manifest:flightPackage.manifest as ManifestV2,initialize:flight},{manifest:transferPackage.manifest as ManifestV2,initialize:transfer}];
 for(const module of modules){
  const assets=new Map<string,Uint8Array>();
  for(const path of ['docs/creators/usage.json','docs/players/flight.json']){
   try{assets.set(path,new Uint8Array(readFileSync(`modules/${module.manifest.id.slice(9)}/${path}`)));}catch{/* This module may not have the player guide. */}
  }
  registry.register(module,moduleAssets(assets));
 }
 const candidate=registry.prepare({format:'space-sim-profile/2',id:'fixture.routes',modules:modules.map(({manifest})=>({id:manifest.id,version:manifest.version})),providers:Object.fromEntries(modules.flatMap(({manifest})=>manifest.slots.map(slot=>[slot,manifest.id]))),capabilities:{},settings:{}},'node');
 try{const planner=candidate.providedService(TRANSFERS),bound=planner.withBurns!(candidate.providedService(MANEUVER_BURNS));expect(planner.relationships).not.toContain('other');expect(bound.relationships).toContain('other');expect(bound.defaultFlightSeconds).toBeGreaterThan(365.25*86400);
 const legacyPlans={...createFlightPlans(),withBurns:undefined};expect(createTransferPlanner(legacyPlans,candidate.providedService(MANEUVER_BURNS)).relationships).not.toContain('other');}
 finally{candidate.dispose();}
});
