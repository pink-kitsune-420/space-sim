import { VIEW_HUD, type HudBinding, type HudInstrument, type HudInstrumentDefinition,
  type HudSurface, type ModuleInitializationV2, type ViewHud, type ViewHudFactory, type ViewHudOptions } from '@space-sim/game-api';

/** Shared lifecycle for every seat; the manager has no built-in flight instruments. */
export function createViewHud(options: ViewHudOptions): ViewHud {
  let binding = Object.freeze({...options.binding}), disposed = false, surface: HudSurface | undefined;
  let selected: readonly HudInstrumentDefinition[] = [];
  const active = new Map<HudInstrumentDefinition,HudInstrument>(), disabled = new Set<HudInstrumentDefinition>();
  let running: {definition:HudInstrumentDefinition;instrument:HudInstrument;enabled:boolean}[] = [];
  const adapters = new Map(options.adapters.map(adapter=>[`${adapter.key.slot}@${adapter.key.version}`,adapter.service]));
  if(adapters.size !== options.adapters.length || options.adapters.some(adapter=>adapter.service===undefined))throw new Error('Duplicate or missing HUD adapter');
  const capture = (value: HudBinding): Readonly<HudBinding> => {
    if(!value.viewportId || !value.seatId || !value.session || typeof value.session!=='object')throw new Error('HUD needs distinct view/seat and session identities');
    return Object.freeze({...value});
  }; binding=capture(binding);
  const close = (instrument: HudInstrument): void => { try {instrument.cancel();} finally {instrument.dispose();} };
  const fail = (definition: HudInstrumentDefinition, error: unknown): void => {
    disabled.add(definition);const instrument=active.get(definition);active.delete(definition);
    const entry=running.find(entry=>entry.definition===definition);if(entry)entry.enabled=false;
    try {if(instrument)close(instrument);} catch { /* Preserve the original instrument fault. */ }
    try {options.fault?.(definition.id,error);} catch { /* Diagnostics must not break other instruments. */ }
  };
  const run = (method: (instrument: HudInstrument)=>void): void => {
    if(disposed)return;
    for(const [definition,instrument] of active){try{method(instrument);}catch(error){fail(definition,error);}}
  };
  const hud: ViewHud = {
    get binding(){return binding;},get count(){return active.size;},
    cancel(){run(instrument=>instrument.cancel());},
    bind(value) {
      if(disposed)return;const next=capture(value);
      if(next.seatId!==binding.seatId || next.viewportId!==binding.viewportId)throw new Error('Create a new HUD for another seat or viewport');
      if(next.session===binding.session && next.context===binding.context && next.playerId===binding.playerId && next.targetId===binding.targetId)return;
      // All gestures stop before any instrument observes the new target/session.
      run(instrument=>instrument.cancel());binding=next;run(instrument=>instrument.rebind(binding));
    },
    select(definitions) {
      if(disposed)return;
      if(definitions.length===selected.length && definitions.every((definition,index)=>definition===selected[index]))return;
      if(definitions.length>64 || new Set(definitions.map(definition=>definition.id)).size!==definitions.length)throw new Error('At most 64 distinct HUD contributions');
      const added = new Map<HudInstrumentDefinition,HudInstrument>();
      try {
        for(const definition of definitions) {
          if(!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+(?:\/[a-z][a-z0-9-]*)?$/.test(definition.id))throw new Error('HUD contribution must be namespaced');
          if(active.has(definition) || disabled.has(definition) || definition.requires.some(key=>!adapters.has(`${key.slot}@${key.version}`)))continue;
          const instance=definition.create(Object.freeze({get binding(){return binding;},use<T>(key:{slot:string;version:string}):T {
            if(!definition.requires.some(need=>need.slot===key.slot&&need.version===key.version))throw new Error('Undeclared HUD adapter');
            return adapters.get(`${key.slot}@${key.version}`) as T;
          }})); added.set(definition,instance);instance.rebind(binding);if(surface)instance.resize(surface);
        }
      } catch(error) {for(const instrument of added.values()){try{close(instrument);}catch{/* Preserve selection error. */}}throw error;}
      for(const [definition,instrument] of active)if(!definitions.includes(definition)){active.delete(definition);try{close(instrument);}catch(error){fail(definition,error);}}
      for(const definition of disabled)if(!definitions.includes(definition))disabled.delete(definition);
      for(const [definition,instrument] of added)active.set(definition,instrument);
      const ordered=definitions.map(definition=>[definition,active.get(definition)] as const);active.clear();
      for(const [definition,instrument] of ordered)if(instrument)active.set(definition,instrument);
      running=[...active].map(([definition,instrument])=>({definition,instrument,enabled:true}));
      selected=[...definitions];
    },
    resize(value) {
      if(disposed)return;
      if(![value.width,value.height,value.x,value.y].every(Number.isFinite) || value.width<0 || value.height<0)throw new Error('HUD surface needs finite CSS-pixel geometry');
      if(surface && surface.root===value.root&&surface.width===value.width&&surface.height===value.height&&surface.x===value.x&&surface.y===value.y)return;
      surface=Object.freeze({...value});run(instrument=>instrument.resize(surface!));
    },
    update(elapsed) {
      if(disposed)return;if(!Number.isFinite(elapsed)||elapsed<0)throw new Error('HUD elapsed must be finite wall seconds');
      for(let i=0;i<running.length;i++){const entry=running[i]!;if(!entry.enabled)continue;try{entry.instrument.update(elapsed);}catch(error){fail(entry.definition,error);}}
    },
    draw(into) {
      if(disposed)return;
      for(let i=0;i<running.length;i++){const entry=running[i]!;if(!entry.enabled)continue;const start=into.length;
        try{entry.instrument.draw(into);}catch(error){into.length=start;fail(entry.definition,error);}}
    },
    dispose() {
      if(disposed)return;disposed=true;const errors:unknown[]=[];
      for(const instrument of active.values()){try{close(instrument);}catch(error){errors.push(error);}}
      active.clear();disabled.clear();selected=[];running=[];surface=undefined;
      if(errors.length)throw new AggregateError(errors,'View HUD cleanup failed');
    },
  };
  try {hud.select(options.instruments??[]);}catch(error){hud.dispose();throw error;}
  return hud;
}
export function createViewHuds(): ViewHudFactory {
  const views=new Set<ViewHud>();let disposed=false;
  return Object.freeze<ViewHudFactory>({create(options){if(disposed)throw new Error('View HUD provider disposed');const hud=createViewHud(options),close=hud.dispose.bind(hud);let closed=false;
    hud.dispose=()=>{if(closed)return;closed=true;views.delete(hud);close();};views.add(hud);return hud;},
    dispose(){if(disposed)return;disposed=true;const errors:unknown[]=[];for(const view of views){try{view.dispose();}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'View HUD provider cleanup failed');}});
}
export default function initialize(context:ModuleInitializationV2):void {
  context.contributeGuide({id:'usage',audience:'creators',title:'Shared view HUD lifecycle',summary:'Optional instruments with independent per-view lifetimes.',asset:'docs/creators/usage.json'});
  context.provide(VIEW_HUD,context.own(createViewHuds()));
}
