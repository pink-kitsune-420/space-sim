import type {Disposable,HudVisibilityController,HudVisibilityOptions} from '@space-sim/game-api';
const KEY='space-sim:hud-visibility:1';
export class HudVisibility implements HudVisibilityController {
  private readonly events:AbortController;
  private readonly resources=new Set<Disposable>();
  private disposed=false;
  private get document(){return this.options.viewport.ownerDocument;}
  private get viewport(){return this.options.viewport;}
  private readonly ITEMS:readonly (readonly [string,string,string])[];
  private readonly choices: Partial<Record<string, boolean>> = Object.create(null);
  private readonly toggles: { input: HTMLInputElement; read: () => boolean; reset: () => void }[] = [];
  private readonly list:HTMLElement;
  constructor(private readonly options:HudVisibilityOptions) {
    this.events=new (this.document.defaultView?.AbortController??AbortController)();const signal=this.events.signal;this.list=options.list;
    this.ITEMS=options.items.map(item=>[item.id,item.label,item.selector??''] as const);
    const ITEMS=this.ITEMS;
    for(const item of options.items){const element=item.selector?options.viewport.querySelector(item.selector):undefined;const hidden=element?.classList.contains('hud-hidden'),container=item.containerClass?options.viewport.classList.contains(item.containerClass):undefined;this.resources.add({dispose:()=>{if(element)element.classList.toggle('hud-hidden',hidden);if(item.containerClass)options.viewport.classList.toggle(item.containerClass,container);}});}
    try {
      const saved = JSON.parse(options.storage?.getItem(options.storageKey??KEY) ?? '{}');
      for (const id of [...ITEMS.map(item => item[0]),...Object.keys(options.defaults??{})]) {
        if (typeof saved?.[id] === 'boolean') this.choices[id] = saved[id];
      }
    } catch { /* Defaults work without storage. */ }
    for (const [id, label] of ITEMS) this.bind(id, label, () => this.visible(id), value => this.set(id, value), () => this.set(id,options.items.find(item=>item.id===id)?.default??options.defaults?.[id]??true));
    const restore = this.document.createElement('button');
    restore.type = 'button'; restore.className = 'hud-visibility-restore';
    restore.textContent = 'Restore HUD visibility';
    restore.addEventListener('click', () => { for (const toggle of this.toggles) toggle.reset(); this.sync(); },{signal});
    this.resources.add({dispose:()=>restore.remove()});
    this.list.after(restore);
    // Existing instrument, chat, touch and profiler controls remain the same sources of truth.
    this.document.addEventListener('click', event => {
      // Native activation changes checked before click, then dispatches change. Let its
      // own change handler save that choice before synchronizing from stored state.
      if (!(event.target instanceof HTMLInputElement && event.target.type === 'checkbox')) this.sync();
    },{signal});
    this.document.addEventListener('change', () => this.sync(),{signal});
    this.document.addEventListener('hud-window-raise', () => this.sync(),{signal});
    this.apply();
  }
  visible(id:string):boolean {return this.choices[id]??this.options.items.find(item=>item.id===id)?.default??this.options.defaults?.[id]??true;}
  set(id:string, visible:boolean):void {
    if(this.disposed)return;
    this.choices[id] = visible;
    try { this.options.storage?.setItem(this.options.storageKey??KEY, JSON.stringify(this.choices)); } catch { /* Session-only preferences. */ }
    this.apply(); this.sync();
  }
  private apply(): void {
    for(const item of this.options.items)if(item.containerClass)this.viewport.classList.toggle(item.containerClass,!this.visible(item.id));
    for (const [id, , selector] of this.ITEMS) {
      if (selector) this.viewport.querySelector(selector)?.classList.toggle('hud-hidden', !this.visible(id));
    }
    this.viewport.dispatchEvent(new Event('hud-layout-change'));
  }
  /** Bind existing optional tools without duplicating their native enabled/preferences state. */
  bind(id: string, label: string, read: () => boolean, write: (visible: boolean) => void, reset: () => void): Disposable {
    if(this.disposed)throw new Error('HUD visibility disposed');
    const controller=new (this.document.defaultView?.AbortController??AbortController)();
    const row = this.document.createElement('label'); row.className = 'hud-visibility-option';
    const input = this.document.createElement('input'); input.type = 'checkbox'; input.id = `hud-visible-${id}`;
    input.checked = read(); row.append(input, this.document.createTextNode(label)); this.list.append(row);
    const toggle={input,read,reset};this.toggles.push(toggle);
    input.addEventListener('change', () => { write(input.checked); this.sync(); },{signal:controller.signal});
    let closed=false;const lease={dispose:()=>{if(closed)return;closed=true;this.resources.delete(lease);controller.abort();row.remove();const at=this.toggles.indexOf(toggle);if(at!==-1)this.toggles.splice(at,1);}};this.resources.add(lease);return lease;
  }
  dispose():void {if(this.disposed)return;this.disposed=true;this.events.abort();const errors:unknown[]=[];for(const resource of [...this.resources].reverse()){try{resource.dispose();}catch(error){errors.push(error);}}this.resources.clear();this.toggles.length=0;if(errors.length)throw new AggregateError(errors,'HUD visibility cleanup failed');}
  private sync(): void { for (const toggle of this.toggles) toggle.input.checked = toggle.read(); }
}
