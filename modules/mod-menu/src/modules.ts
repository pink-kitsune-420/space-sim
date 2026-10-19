import type {ModMenuModuleOptions,ModMenuModulePort,ModMenuModuleView} from '@space-sim/game-api';
/** A profile draft editor. Only the host can resolve, enable, remove archives or publish a game. */
export function createModuleEditor(root:HTMLElement,port:ModMenuModulePort,options:ModMenuModuleOptions={}):ModMenuModuleView {
 const document=root.ownerDocument,Controller=document.defaultView?.AbortController??AbortController,controller=new Controller(),signal=controller.signal;
 const prefix=options.prefix??'mod-menu-modules';if(!/^[a-z][a-z0-9-]*$/.test(prefix))throw new Error('Invalid module editor prefix');
 const ids=options.ids??{list:`${prefix}-list`,status:`${prefix}-status`,apply:`${prefix}-apply`,cancel:`${prefix}-cancel`};
 const previous=[...root.childNodes],list=document.createElement('ul'),empty=document.createElement('p'),statusNode=document.createElement('p'),apply=document.createElement('button'),tasks=new Set<AbortController>();let disposed=false,applying=false,rows=new Controller();
 empty.className='module-note';empty.textContent='No additional modules installed. Import a .spacemod package to add one; importing does not run its code.';
 list.id=ids.list;statusNode.id=ids.status;statusNode.setAttribute('role','status');apply.type='button';apply.id=ids.apply;apply.textContent=options.applyLabel??'Apply module selection';
 const status=(message:string)=>{if(!disposed)statusNode.textContent=message;};
 const change=(action:()=>void,redraw=false)=>{if(disposed)return;try{action();if(redraw)refresh();}catch(error){status(error instanceof Error?error.message:String(error));}};
 const run=async(action:(signal:AbortSignal)=>Promise<void>)=>{if(disposed)return;const task=new AbortController();tasks.add(task);try{await action(task.signal);}catch(error){if(!disposed&&!task.signal.aborted)status(error instanceof Error?error.message:String(error));}finally{tasks.delete(task);}};
 function refresh():void {
  if(disposed)return;rows.abort();rows=new Controller();const state=port.state(),grouped=new Map<string,typeof state.installed[number][]>();
  for(const entry of state.installed)grouped.set(entry.manifest.id,[...grouped.get(entry.manifest.id)??[],entry]);
  empty.hidden=grouped.size>0;
  list.replaceChildren(...[...grouped].map(([id,entries])=>{
   const item=document.createElement('li'),label=document.createElement('label'),checkbox=document.createElement('input'),versions=document.createElement('select');checkbox.type='checkbox';checkbox.dataset.moduleId=id;checkbox.checked=state.selected[id]!==undefined;versions.setAttribute('aria-label',`Version of ${id}`);
   for(const entry of entries){const option=document.createElement('option');option.value=entry.digest;option.textContent=`${entry.manifest.version} · ${entry.digest.slice(0,12)}…`;versions.append(option);}
   versions.value=state.selected[id]??entries[0]!.digest;checkbox.disabled=versions.disabled=state.busy||!state.editable;
   checkbox.addEventListener('change',()=>change(()=>port.select(id,checkbox.checked?versions.value:undefined)),{signal:rows.signal});
   versions.addEventListener('change',()=>change(()=>port.version(id,versions.value),true),{signal:rows.signal});
   const entry=entries.find(entry=>entry.digest===versions.value)!;versions.title=`SHA-256 ${entry.digest}`;label.append(checkbox,` ${entry.manifest.name} · ${entry.manifest.tier}`);item.append(label,versions);
   const identity=document.createElement('details'),identityLabel=document.createElement('summary'),digest=document.createElement('p');identityLabel.textContent='Exact package identity';digest.className='module-note';digest.textContent=`${id}@${entry.manifest.version} · SHA-256 ${entry.digest}`;identity.append(identityLabel,digest);item.append(identity);
   const needs=document.createElement('p');needs.textContent=`Dependencies: ${entry.manifest.dependencies.map(ref=>`${ref.id}@${ref.version}`).join(', ')||'none'}. Capabilities: ${entry.manifest.requires.map(need=>`${need.name}@${need.version}${need.optional?' (optional)':''}`).join(', ')||'none'}.`;item.append(needs);
   for(const [key,schema] of Object.entries(entry.manifest.settings)){
    const label=document.createElement('label'),input=document.createElement('input');input.type='number';input.step=String(schema.step??'any');input.min=String(schema.minimum);input.max=String(schema.maximum);input.value=String(state.settings[id]?.[key]??schema.default);input.disabled=checkbox.disabled;input.addEventListener('change',()=>change(()=>port.setting(id,key,Number(input.value))),{signal:rows.signal});label.append(`${schema.label??key} `,input);item.append(label);
    if(schema.description){const help=document.createElement('p');help.className='module-note';help.id=`${prefix}-${id}-setting-${key}-help`;help.textContent=schema.description;input.setAttribute('aria-describedby',help.id);item.append(help);}
   }
   for(const need of entry.manifest.requires.filter(need=>!need.name.startsWith('core.'))){
    const label=document.createElement('label'),select=document.createElement('select'),automatic=document.createElement('option');automatic.value='';automatic.textContent='Automatic among enabled modules';select.append(automatic);select.disabled=checkbox.disabled;
    for(const provider of port.compatible(need)){const option=document.createElement('option');option.value=provider.digest;option.textContent=`${provider.manifest.name}@${provider.manifest.version}`;select.append(option);if(state.capabilities[id]?.[need.name]===provider.manifest.id&&state.selected[provider.manifest.id]===provider.digest)select.value=provider.digest;}
    select.addEventListener('change',()=>change(()=>port.capability(id,need.name,select.value||undefined),true),{signal:rows.signal});label.append(`Provider for ${need.name} `,select);item.append(label);
   }
   for(const slot of entry.manifest.slots){const input=document.createElement('input'),label=document.createElement('label');input.type='radio';input.name=`${prefix}-provider-${slot}`;input.checked=state.providers[slot]===id;input.disabled=checkbox.disabled;input.addEventListener('change',()=>change(()=>port.provider(slot,id,versions.value),true),{signal:rows.signal});label.append(input,` Use for ${slot}`);item.append(label);}
   const remove=document.createElement('button');remove.type='button';remove.textContent='Remove installed version';remove.disabled=state.busy||state.activeDigests.includes(versions.value);remove.addEventListener('click',()=>{void run(async signal=>{await port.remove(versions.value,signal);if(!disposed)refresh();});},{signal:rows.signal});item.append(remove);return item;
  }));
  apply.disabled=applying||state.busy||!state.editable||!state.installed.length;
 }
 const view:ModMenuModuleView={refresh,status,dispose(){if(disposed)return;disposed=true;controller.abort();rows.abort();for(const task of tasks)task.abort(new Error('Module editor removed'));tasks.clear();root.replaceChildren(...previous);}};
 try{
  const title=document.createElement('summary');title.textContent=options.title??'Modules';root.replaceChildren(title);
  if(options.notice){const notice=document.createElement('p');notice.textContent=options.notice;root.append(notice);}
  const include=document.createElement('button'),remove=document.createElement('button'),cancel=document.createElement('button');for(const button of [include,remove,cancel])button.type='button';include.textContent='Include required modules';remove.textContent='Remove dependent modules';cancel.textContent='Cancel module application';cancel.id=ids.cancel;
  include.addEventListener('click',()=>change(()=>port.includeRequired(),true),{signal});remove.addEventListener('click',()=>change(()=>port.removeDependents(),true),{signal});cancel.addEventListener('click',()=>{for(const task of tasks)task.abort(new Error('Module application cancelled'));change(()=>port.cancel());},{signal});apply.addEventListener('click',()=>{if(applying)return;applying=true;apply.disabled=true;void run(async signal=>{try{await port.apply(signal);}finally{applying=false;if(!disposed)refresh();}});},{signal});const actions=document.createElement('div');actions.className='lab-actions';actions.append(include,remove,apply,cancel);root.append(empty,list,actions,statusNode);refresh();return view;
 }catch(error){view.dispose();throw error;}
}
