import {closeSync,fsyncSync,openSync,renameSync,writeSync} from 'node:fs';
import {copyFile,mkdir,open,readFile,readdir,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {CORE_UNIVERSE_DISK,type HostServiceAccess,type UniverseDisk} from '../../../packages/game-api/src/index';
/** Native primitives only; naming/recovery/backup policy belongs to the editable module. */
export const universeDisk:UniverseDisk=Object.freeze({join,
  read:(path:string)=>readFile(path,'utf8'),directory:async(path:string)=>{await mkdir(path,{recursive:true});},names:readdir,rename,copy:copyFile,
  remove:(path:string)=>rm(path,{force:true}),missing:(error:unknown)=>(error as NodeJS.ErrnoException)?.code==='ENOENT',
  async replace(path:string,text:string){const temporary=`${path}.tmp`,handle=await open(temporary,'w');try{await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle.close();}await rename(temporary,path);},
  replaceSync(path:string,text:string){const temporary=`${path}.tmp`,fd=openSync(temporary,'w');try{writeSync(fd,text);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temporary,path);},
});
export const universeDiskService:HostServiceAccess=Object.freeze({key:CORE_UNIVERSE_DISK,service:universeDisk,tiers:['platform'] as const,environments:['node'] as const});
