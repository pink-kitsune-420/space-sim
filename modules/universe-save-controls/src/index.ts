import { UNIVERSE_FILES, UNIVERSE_SAVE_CONTROLS, type UniverseFiles, type UniverseSaveControlFactory, type UniverseSaveControlOptions, type UniverseSaveControls, type ModuleInitializationV2 } from '@space-sim/game-api';
export function createUniverseSaveControls(files:UniverseFiles):UniverseSaveControlFactory & {dispose():void}{
  const instances=new Set<UniverseSaveControls>();let disposed=false;
  return Object.freeze({mount(options:UniverseSaveControlOptions):UniverseSaveControls{
    if(disposed)throw new Error('Universe save controls provider disposed');
    const lifetime=new AbortController(),document=options.root.ownerDocument;let closed=false,busy=false;
    const original=options.controls?undefined:[...options.root.childNodes];
    let controls=options.controls;
    if(!controls){
      const prefix=options.prefix??'universe';if(!/^[a-z][a-z0-9-]{0,63}$/.test(prefix))throw new Error('Invalid universe control prefix');
      if(['save','load','file'].some(kind=>document.getElementById(`${prefix}-${kind}`)))throw new Error('Universe control prefix is already mounted');
      const save=document.createElement('button'),load=document.createElement('button'),file=document.createElement('input');
      save.type=load.type='button';save.id=`${prefix}-save`;load.id=`${prefix}-load`;file.id=`${prefix}-file`;
      save.textContent='Save universe';load.textContent='Load universe…';file.type='file';file.hidden=true;file.accept='.spaceuniverse,.json,.gz,application/zip,application/json';
      options.root.replaceChildren(save,load,file);controls={save,load,file};
    }
    const {save,load,file}=controls;
    async function run(operation:'save'|'load',work:()=>Promise<void>){
      if(closed||busy)return;busy=true;
      try{await work();}catch(error){if(!closed&&!lifetime.signal.aborted)options.error?.(operation,error);}finally{busy=false;}
    }
    save.addEventListener('click',()=>{void run('save',async()=>{const saved=await options.commands.save((name,bytes,signal)=>files.write(name,bytes,signal),lifetime.signal);if(!closed)options.saved?.(saved);});},{signal:lifetime.signal});
    load.addEventListener('click',()=>{if(!closed&&!busy)file.click();},{signal:lifetime.signal});
    file.addEventListener('change',()=>{const selected=file.files?.[0];if(!selected||closed||busy)return;
      void run('load',async()=>{try{await options.commands.load(signal=>files.read(selected,signal),lifetime.signal);if(!closed)options.loaded?.();}finally{if(!closed)file.value='';}});
    },{signal:lifetime.signal});
    const control:UniverseSaveControls=Object.freeze({get busy(){return busy;},dispose(){if(closed)return;closed=true;lifetime.abort(new Error('Universe save controls disposed'));if(original)options.root.replaceChildren(...original);instances.delete(control);}});
    instances.add(control);return control;
  },dispose(){if(disposed)return;disposed=true;for(const instance of instances)instance.dispose();instances.clear();}});
}
/**
 * Contributes Save universe and Load universe button and file picker mounting UI.
 * Provides ui.universe-saves@1.0.0 in slot ui.universe-saves.
 * Requires universe.files@^1.0.0.
 */
export default function initialize(context:ModuleInitializationV2):void{
  context.provide(UNIVERSE_SAVE_CONTROLS,context.own(createUniverseSaveControls(context.use(UNIVERSE_FILES))));
  context.contributeGuide({id:'usage',audience:'creators',title:'Universe save controls',summary:'Independent Save universe / Load universe UI over explicit commands and file storage.',asset:'docs/creators/usage.json'});
}
