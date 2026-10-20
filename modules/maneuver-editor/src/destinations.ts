import type { TransferPlanner, TransferRelationship, WorldRead } from '@space-sim/game-api';

type Destination = ReturnType<WorldRead['system']['getAllBodies']>[number];
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const relationshipNames:Record<TransferRelationship,string>={
 'same-body':'Orbit change around the current body',child:'Direct child transfer',parent:'Direct parent transfer',sibling:'Sibling transfer through a shared parent',other:'Deeper or unrelated transfer',
};

/** UI-only hierarchy index. Rebuilt on source changes, never during simulation stepping. */
export class DestinationPicker {
 private bodies:readonly Destination[]=[];
 private readonly byId=new Map<string,Destination>();
 private readonly children=new Map<string,Destination[]>();
 private readonly labels=new Map<string,string>();
 private readonly relations=new Map<string,TransferRelationship>();
 private readonly context:HTMLOutputElement;private readonly selected:HTMLOutputElement;private readonly support:HTMLOutputElement;
 private readonly local:HTMLDivElement;private readonly browser:HTMLDetailsElement;private readonly query:HTMLInputElement;
 private readonly trail:HTMLElement;private readonly results:HTMLDivElement;private readonly count:HTMLOutputElement;
 private currentId='';private browseId='';private destinationId='';
 get value():string{return this.destinationId;}
 get accepted():boolean{return this.relations.has(this.value)&&this.supports(this.value);}
 constructor(private readonly root:HTMLElement,prefix:string,private readonly service:TransferPlanner,
  private readonly commit:()=>void,signal:AbortSignal){
  root.innerHTML=`<output id="${prefix}-context" class="maneuver-help"></output>
   <div class="transfer-selected"><span>Destination</span><output id="${prefix}-destination" aria-live="polite"></output></div>
   <div class="maneuver-help">Local · orbital relationships</div><div class="transfer-destinations" id="${prefix}-local" role="group" aria-label="Local destinations"></div>
   <details id="${prefix}-browser"><summary>Browse or search all destinations</summary>
    <div class="transfer-search"><label for="${prefix}-query">Search all destinations</label><input id="${prefix}-query" type="search" autocomplete="off" placeholder="Body or parent name"><button id="${prefix}-clear" type="button">Clear</button></div>
    <nav id="${prefix}-trail" aria-label="Destination systems"></nav>
    <output id="${prefix}-count" class="maneuver-help" aria-live="polite"></output>
    <div id="${prefix}-results" class="transfer-destinations" role="group" aria-label="Destination results"></div>
   </details><output id="${prefix}-support" class="maneuver-help" aria-live="polite"></output>`;
  const get=<T extends HTMLElement>(name:string)=>root.querySelector<T>(`#${prefix}-${name}`)!;
  this.context=get('context');this.selected=get('destination');this.support=get('support');this.local=get('local');this.browser=get('browser');this.query=get('query');this.trail=get('trail');this.results=get('results');this.count=get('count');
  this.query.addEventListener('input',()=>this.renderBrowser(),{signal});
  get('clear').addEventListener('click',()=>{this.query.value='';this.renderBrowser();this.query.focus();},{signal});
  root.addEventListener('click',event=>{
   const button=(event.target as Element).closest<HTMLButtonElement>('button');if(!button||!root.contains(button))return;
   if(button.dataset.destination!==undefined)this.choose(button.dataset.destination);
   if(button.dataset.browse!==undefined){
    this.browseId=button.dataset.browse;this.query.value='';this.renderBrowser();
    this.results.querySelector<HTMLButtonElement>('button')?.focus();
   }
  },{signal});
  // Roving focus keeps a catalogue of hundreds of moons out of the Tab sequence.
  for(const list of [this.local,this.results]){
   list.addEventListener('focusin',event=>{for(const button of list.querySelectorAll('button'))button.tabIndex=button===event.target?0:-1;},{signal});
   list.addEventListener('keydown',event=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const buttons=[...list.querySelectorAll('button')],index=buttons.indexOf(event.target as HTMLButtonElement);if(index<0)return;
    event.preventDefault();event.stopPropagation();
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowDown'?1:-1)));
    buttons[next]?.focus();
   },{signal});
  }
 }
 private supports(id:string):boolean {
  const relationship=this.relations.get(id);return !!relationship&&(!this.service.relationships||this.service.relationships.includes(relationship));
 }
 private ancestors(id:string):Destination[]{
  const path:Destination[]=[],seen=new Set<string>();let body=this.byId.get(id);
  while(body&&!seen.has(body.id)){path.push(body);seen.add(body.id);body=body.parentId?this.byId.get(body.parentId):undefined;}
  return path;
 }
 populate(world:WorldRead,currentId:string,reset:boolean):void {
  const previous=this.value;this.currentId=currentId;this.byId.clear();this.children.clear();this.labels.clear();this.relations.clear();
  this.bodies=[...world.system.getAllBodies()].sort((a,b)=>compare(a.name.toLowerCase(),b.name.toLowerCase())||compare(a.id,b.id));
  const names=new Map<string,number>();
  for(const body of this.bodies){this.byId.set(body.id,body);names.set(body.name,(names.get(body.name)??0)+1);const parent=body.parentId??'';const children=this.children.get(parent)??[];children.push(body);this.children.set(parent,children);}
  const current=this.byId.get(currentId);
  for(const body of this.bodies){
   this.labels.set(body.id,this.ancestors(body.id).map(part=>`${part.name}${names.get(part.name)!>1?` [${part.id}]`:''}`).join(' · '));
   this.relations.set(body.id,body.id===currentId?'same-body':body.parentId===currentId?'child':body.id===current?.parentId?'parent':body.parentId&&body.parentId===current?.parentId?'sibling':'other');
  }
  this.context.textContent=current?`Current body: ${current.name}${current.parentId?` · parent: ${this.byId.get(current.parentId)?.name??current.parentId}`:' · no parent'}`:'Choose a ship to see its orbital neighborhood.';
  this.destinationId=current?(reset||!this.byId.has(previous)?currentId:previous):'';
  if(reset){this.query.value='';this.browser.open=false;const roots=this.children.get('')??[];this.browseId=roots.length===1?roots[0]!.id:'';}
  if(!this.byId.has(this.browseId))this.browseId='';
  const rank:Record<TransferRelationship,number>={'same-body':0,parent:1,child:2,sibling:3,other:4};
  const local=current?this.bodies.filter(body=>this.relations.get(body.id)!=='other'&&this.supports(body.id)).sort((a,b)=>rank[this.relations.get(a.id)!]-rank[this.relations.get(b.id)!]):[];
  this.renderRows(this.local,local,false);if(!local.length)this.local.textContent='No local relationships declared supported. Browse or search all bodies.';
  this.renderBrowser();this.showSelection();
 }
 private choose(id:string):void {
  if(id===this.value||!this.byId.has(id))return;
  this.destinationId=id;this.showSelection();this.commit();
 }
 private showSelection():void {
  this.selected.textContent=this.labels.get(this.value)??'No destination';
  const relation=this.relations.get(this.value);
  if(!relation)this.support.textContent='Choose a flying ship to plan a transfer.';
  else if(!this.service.relationships)this.support.textContent=`${relationshipNames[relation]}. The provider does not declare coverage; search will check suitability.`;
  else if(this.supports(this.value))this.support.textContent=`${relationshipNames[relation]}. The provider accepts this relationship; a safe trajectory is not guaranteed.`;
  else this.support.textContent=`${relationshipNames[relation]} is not supported by the selected provider.${relation==='other'?' This requires separate legs; this planner does not build an end-to-end route.':' Choose another destination or transfer provider.'}`;
  for(const button of this.root.querySelectorAll<HTMLButtonElement>('[data-destination]'))button.setAttribute('aria-pressed',String(button.dataset.destination===this.value));
 }
 private button(text:string):HTMLButtonElement {
  const button=this.root.ownerDocument.createElement('button');button.type='button';button.textContent=text;return button;
 }
 private renderRows(list:HTMLElement,bodies:readonly Destination[],browse:boolean):void {
  const fragment=this.root.ownerDocument.createDocumentFragment();
  for(const body of bodies){
   const row=this.root.ownerDocument.createElement('div');row.className='transfer-destination-row';
   const select=this.button(`${this.labels.get(body.id)}${body.id===this.currentId?' · change orbit':''}`);select.dataset.destination=body.id;
   select.setAttribute('aria-pressed',String(body.id===this.value));select.tabIndex=-1;row.append(select);
   if(browse){
    const children=this.children.get(body.id);
    if(children?.length&&body.id!==this.browseId){const open=this.button(`Browse (${children.length})`);open.dataset.browse=body.id;open.setAttribute('aria-label',`Browse bodies orbiting ${this.labels.get(body.id)}`);open.tabIndex=-1;row.append(open);}
   }
   fragment.append(row);
  }
  list.replaceChildren(fragment);list.querySelector<HTMLButtonElement>('button')?.setAttribute('tabindex','0');list.scrollTop=0;
 }
 private renderBrowser():void {
  const query=this.query.value.trim().toLowerCase(),tokens=query.split(/\s+/);
  this.trail.replaceChildren();
  if(query){
   const matches=this.bodies.filter(body=>tokens.every(token=>this.labels.get(body.id)!.toLowerCase().includes(token)));
   this.count.textContent=matches.length?`${matches.length} result${matches.length===1?'':'s'}`:'No destinations found. Try a body or parent name.';
   this.renderRows(this.results,matches,false);
  }else{
   const all=this.button('All systems');all.dataset.browse='';this.trail.append(all);
   for(const body of this.ancestors(this.browseId).reverse()){
    const button=this.button(body.name);button.dataset.browse=body.id;this.trail.append(button);
   }
   const primary=this.byId.get(this.browseId),children=this.children.get(this.browseId)??[];
   this.count.textContent=primary?`${children.length} bodies orbiting ${primary.name}`:`${children.length} systems`;
   this.renderRows(this.results,primary?[primary,...children]:children,true);
  }
 }
}
