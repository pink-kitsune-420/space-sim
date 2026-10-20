import { UNIVERSE_FILES, type UniverseFiles, type ModuleInitializationV2 } from '@space-sim/game-api';
/** Browser file IO only; no decoding, world access, package approval or activation. */
export function createUniverseFiles(): UniverseFiles {
  const urls = new Map<string, ReturnType<typeof setTimeout>>(); let disposed = false;
  const check = (signal:AbortSignal) => { signal.throwIfAborted(); if(disposed)throw new Error('Universe file provider disposed'); };
  return Object.freeze<UniverseFiles>({async read(file,signal){
    check(signal);if(file.size>64*1024*1024)throw new Error('Universe save files must be at most 64 MiB.');
    const bytes=new Uint8Array(await file.arrayBuffer());check(signal);return bytes;
  },async write(name,bytes,signal){
    check(signal);if(!name || name.length>256 || /[\\/\p{Cc}]/u.test(name))throw new Error('Invalid universe filename');
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),link=document.createElement('a');
    try{link.href=url;link.download=name;document.body.append(link);check(signal);link.click();}
    catch(error){URL.revokeObjectURL(url);throw error;}finally{link.remove();}
    urls.set(url,setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},10000));
  },dispose(){if(disposed)return;disposed=true;for(const[url,timer]of urls){clearTimeout(timer);URL.revokeObjectURL(url);}urls.clear();}});
}
/**
 * Contributes bounded browser file input reading and download writing services.
 * Provides universe.files@1.0.0 in slot universe.files.
 */
export default function initialize(context:ModuleInitializationV2):void{
  context.provide(UNIVERSE_FILES,context.own(createUniverseFiles()));
  context.contributeGuide({id:'usage',audience:'creators',title:'Universe file storage',summary:'Bounded browser files and owned downloads, independent of save validation.',asset:'docs/creators/usage.json'});
}
