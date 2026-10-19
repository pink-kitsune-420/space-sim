/** Non-modal host decisions for automatic fleet requests. Pending and refused
 * requests never invoke the supplied warp command. Permission is session-local. */
export class WarpApproval {
 private readonly panel: HTMLElement;
 private readonly text: HTMLElement;
 private readonly requests = new Map<string, { label: string; apply: () => void; denied: boolean }>();
 constructor(container: HTMLElement) {
  this.panel=container.ownerDocument.createElement('section');
  this.panel.id='warp-approval';this.panel.className='warp-approval';this.panel.hidden=true;
  this.panel.setAttribute('role','region');this.panel.setAttribute('aria-label','Host warp approval');
  this.panel.innerHTML='<p aria-live="polite"></p><div><button type="button" data-warp-approve>Approve 1×</button><button type="button" data-warp-deny>Decline</button></div>';
  this.text=this.panel.querySelector('p')!;container.append(this.panel);
  this.panel.querySelector('[data-warp-approve]')!.addEventListener('click',()=>this.decide(true));
  this.panel.querySelector('[data-warp-deny]')!.addEventListener('click',()=>this.decide(false));
 }
 request(key: string, label: string, apply: () => void): boolean {
  const old=this.requests.get(key);
  if(old?.denied)throw new Error('The host declined the warp change.');
  if(!old){this.requests.set(key,{label,apply,denied:false});this.render();}
  return false;
 }
 retain(active: (key: string) => boolean): void {let changed=false;for(const key of this.requests.keys())if(!active(key)){this.requests.delete(key);changed=true;}if(changed)this.render();}
 clear(): void {if(!this.requests.size)return;this.requests.clear();this.render();}
 private decide(allowed: boolean): void {
  for(const [key,request] of this.requests){
   if(request.denied)continue;
   if(allowed){this.requests.delete(key);request.apply();}
   else request.denied=true;
   break;
  }
  this.render();
 }
 private render(): void {
  const pending=[...this.requests.values()].filter(value=>!value.denied);
  this.panel.hidden=!pending.length;
  this.text.textContent=pending.length?`${pending[0]!.label} requests real time (1×) for its prepared burn.${pending.length>1?` ${pending.length-1} more pending.`:''}`:'';
 }
}
