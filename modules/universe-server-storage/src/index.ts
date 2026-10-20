import { CORE_UNIVERSE_DISK, SERVER_UNIVERSE_STORAGE, type UniverseDisk, type ServerUniverseOptions, type ServerUniverseStore, type ServerUniverseStorage, type WorldSave, type ModuleInitializationV2 } from '@space-sim/game-api';
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
/** Server policy over native IO. The supplied restore callback retains package recovery
 * and state validation. Closing rejects new work; idle drains already queued writes. */
export function createServerUniverseStorage(io:UniverseDisk):ServerUniverseStorage & {dispose():void}{
  const stores=new Set<{dispose():void}>();let disposed=false;
  return Object.freeze({create<T>(options:ServerUniverseOptions<T>):ServerUniverseStore<T>{
    if(disposed)throw new Error('Universe server storage provider disposed');
    if(!Number.isInteger(options.keepBackups)||options.keepBackups<0||options.keepBackups>10000)throw new Error('Invalid backup retention');
    const file=io.join(options.directory,'world.json'),backups=io.join(options.directory,'backups'),log=options.log??(()=>{});
    let queue:Promise<unknown>=Promise.resolve(),closed=false;
    const check=()=>{if(closed)throw new Error('Universe server storage disposed');};
    function enqueue<R>(operation:()=>Promise<R>):Promise<R>{check();const run=queue.then(operation);queue=run.catch(()=>{});return run;}
    const backupFiles=async()=>{try{return(await io.names(backups)).filter(name=>/^world-[0-9TZ-]+\.json$/.test(name)).sort();}catch(error){if(io.missing(error))return[];throw error;}};
    const store:ServerUniverseStore<T>=Object.freeze({file,backups,
      async load(){check();const read=async(path:string)=>options.restore(JSON.parse(await io.read(path)));
        try{return{loaded:await read(file),from:file};}catch(error){
          if(options.configurationError(error))throw error;if(io.missing(error))return undefined;
          const aside=io.join(options.directory,`world.unusable-${stamp()}.json`);log(`World file ${file} is unusable: ${(error as Error).message}`);
          await io.rename(file,aside);log(`Moved it to ${aside}.`);
        }
        for(const name of(await backupFiles()).reverse()){
          const path=io.join(backups,name);try{const loaded=await read(path);log(`Restored the world from backup ${path}.`);return{loaded,from:path};}
          catch(error){if(options.configurationError(error))throw error;log(`Backup ${path} is unusable: ${(error as Error).message}`);}
        }
        throw new Error(`No usable world in ${options.directory}. Fix or remove the moved files, or start with --new.`);
      },
      save(save:WorldSave){check();const text=JSON.stringify(save,null,1);return enqueue(async()=>{await io.directory(options.directory);await io.replace(file,text);});},
      saveSync(save:WorldSave){check();io.replaceSync(file,JSON.stringify(save,null,1));},
      idle:()=>queue.then(()=>{}),
      backup(){return enqueue(async()=>{
        await io.directory(backups);const target=io.join(backups,`world-${stamp()}.json`);
        try{await io.copy(file,target);}catch(error){if(options.configurationError(error))throw error;if(io.missing(error))return undefined;throw error;}
        const names=await backupFiles();for(const old of names.slice(0,Math.max(0,names.length-options.keepBackups)))await io.remove(io.join(backups,old));return target;
      });},
      backupFiles(){check();return backupFiles();},
      dispose(){if(closed)return;closed=true;stores.delete(store);},
    });stores.add(store);return store;
  },dispose(){if(disposed)return;disposed=true;for(const store of stores)store.dispose();stores.clear();}});
}
/**
 * Contributes serialized atomic universe persistence and backup storage for Node environments.
 * Provides universe.server-storage@1.0.0 in slot universe.server-storage.
 * Requires core.universe-disk@^1.0.0.
 */
export default function initialize(context:ModuleInitializationV2):void{
  context.provide(SERVER_UNIVERSE_STORAGE,context.own(createServerUniverseStorage(context.use(CORE_UNIVERSE_DISK))));
  context.contributeGuide({id:'usage',audience:'creators',title:'Server universe storage',summary:'Serialized atomic saves, backups and validated recovery over borrowed native disk IO.',asset:'docs/creators/usage.json'});
}
