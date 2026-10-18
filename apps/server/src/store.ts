import { GameConfigurationError } from '../../../packages/game-runtime/src/game-loader';
import { VehicleConfigurationError } from '../../../packages/game-api/src/index';
import type { SimulationContextFactory, WorldSave } from '../../../packages/game-api/src/index';
import { builtinContextFactory } from '../../../packages/modules/src/index';
import { loadWorld, type LoadedWorld } from '../../../packages/sim-core/src/save';
import { createServerUniverseStorage } from '../../../modules/universe-server-storage/src/index';
import { universeDisk } from './universe-disk';
/** Compatibility composition; filesystem policy is owned by the editable storage module. */
export class WorldStore {
  private readonly provider=createServerUniverseStorage(universeDisk);
  private readonly store;
  readonly file:string;readonly backups:string;
  constructor(readonly dir:string,keepBackups:number,log:(message:string)=>void=()=>{},createContext:SimulationContextFactory=builtinContextFactory('node'),restore?:(raw:unknown)=>LoadedWorld|Promise<LoadedWorld>){
    this.store=this.provider.create({directory:dir,keepBackups,log,restore:restore??(raw=>loadWorld(raw,{createContext})),configurationError:error=>error instanceof GameConfigurationError || error instanceof VehicleConfigurationError});
    this.file=this.store.file;this.backups=this.store.backups;
  }
  load(){return this.store.load();}
  save(save:WorldSave){return this.store.save(save);}
  saveSync(save:WorldSave){this.store.saveSync(save);}
  idle(){return this.store.idle();}
  backup(){return this.store.backup();}
  backupFiles(){return this.store.backupFiles();}
  dispose(){this.provider.dispose();}
}
