/** Non-modal host decisions for automatic fleet requests. Pending and refused
 * requests never invoke the clock. Permission is session-local. */
export class WarpApproval {
 private readonly panel: HTMLElement;
 private readonly text: HTMLElement;
 private readonly requests = new Map<string, { label: string; nodeId:string; mode:'slowdown'|'auto-warp'; approved:boolean; denied: boolean }>();
 constructor(container: HTMLElement) {
  this.panel=container.ownerDocument.createElement('section');
  this.panel.id='warp-approval';this.panel.className='warp-approval';this.panel.hidden=true;
  this.panel.setAttribute('role','region');this.panel.setAttribute('aria-label','Host warp approval');
  this.panel.innerHTML='<p aria-live="polite"></p><div><button type="button" data-warp-approve>Allow burn approach</button><button type="button" data-warp-deny>Decline</button></div>';
  this.text=this.panel.querySelector('p')!;container.append(this.panel);
  this.panel.querySelector('[data-warp-approve]')!.addEventListener('click',()=>this.decide(true));
  this.panel.querySelector('[data-warp-deny]')!.addEventListener('click',()=>this.decide(false));
 }
 request(key: string, label: string, nodeId:string, mode:'slowdown'|'auto-warp'='slowdown'): boolean {
  let old=this.requests.get(key);if(old&&(old.nodeId!==nodeId||old.mode!==mode)){this.requests.delete(key);old=undefined;}
  if(old?.denied)throw new Error('The host declined the warp change.');
  if(!old){this.requests.set(key,{label,nodeId,mode,approved:false,denied:false});this.render();}
  return old?.approved??false;
 }
 approved(key:string):boolean {return this.requests.get(key)?.approved??false;}
 consume(key:string):void {this.requests.delete(key);this.render();}
 retain(active: (key: string) => boolean): void {let changed=false;for(const key of this.requests.keys())if(!active(key)){this.requests.delete(key);changed=true;}if(changed)this.render();}
 clear(): void {if(!this.requests.size)return;this.requests.clear();this.render();}
 private decide(allowed: boolean): void {
  for(const request of this.requests.values()){
   if(request.denied||request.approved)continue;
   if(allowed)request.approved=true;
   else request.denied=true;
   break;
  }
  this.render();
 }
 private render(): void {
  const pending=[...this.requests.values()].filter(value=>!value.denied&&!value.approved);
  this.panel.hidden=!pending.length;
  this.panel.querySelector('[data-warp-approve]')!.textContent=pending[0]?.mode==='auto-warp'?'Allow automatic warp':'Allow burn approach';
  this.text.textContent=pending.length?`${pending[0]!.label} requests permission ${pending[0]!.mode==='auto-warp'?'to auto-warp through its remaining prepared burns':'to reduce warp when its burn needs alignment and thrust'}.${pending.length>1?` ${pending.length-1} more pending.`:''}`:'';
 }
}
