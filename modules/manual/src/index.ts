import {captureDocument,documentText,MANUAL_READER,WINDOW_CONTENT,type Disposable,type ManualAudience,type ManualGuide,type ManualReader,type ManualReaderOptions,type ManualService,type ManualTopic,type ModuleInitializationV2,type WindowContentService} from '@space-sim/game-api';
const AUDIENCES:readonly ManualAudience[]=['players','creators'];
const text=(raw:string,label:string,max=256):string=>{if(typeof raw!=='string'||!raw.trim()||raw.length>max)throw new Error(`Invalid Manual ${label}`);return raw;};
function capture(topic:ManualTopic):ManualTopic {
 text(topic.id,'page ID',512);text(topic.title,'title');text(topic.summary,'summary',1024);
 if((topic.document!==undefined)===(topic.mount!==undefined)||topic.mount!==undefined&&typeof topic.mount!=='function')throw new Error('Manual page needs one structured document or trusted renderer');
 if(topic.searchText!==undefined&&(typeof topic.searchText!=='string'||topic.searchText.length>262144))throw new Error('Invalid Manual search text');
 return Object.freeze({...topic,...(topic.document?{document:captureDocument(topic.document)}:{})});
}
/** Reader/navigation/catalog own no game, controls, simulation or tutorial state. */
export function createManuals(content:WindowContentService,css=''):ManualService {
 const registered=new Map<symbol,readonly ManualGuide[]>(),readers=new Set<ManualReader>(),listeners=new Set<()=>void>(),styles=new Map<Document,HTMLStyleElement>();let disposed=false;
 const live=()=>{if(disposed)throw new Error('Manual provider disposed');};
 const guides=(audience:ManualAudience):readonly ManualGuide[]=>{const visible=new Map<string,ManualGuide>();for(const pages of registered.values())for(const page of pages)visible.set(page.id,page);return Object.freeze([...visible.values()].filter(page=>page.audience===audience));};
 const notify=()=>{for(const listener of listeners)listener();};
 return Object.freeze<ManualService>({
  guides,
  register(pages,options={}){
   live();if(!Array.isArray(pages)||pages.length>512)throw new Error('At most 512 Manual guides per registration');
   const ids=new Set(options.replace?[]:[...registered.values()].flat().map(page=>page.id));
   const captured=Object.freeze(pages.map(page=>{if(!AUDIENCES.includes(page.audience)||ids.has(page.id))throw new Error(`Invalid or duplicate Manual guide ${page.id}`);ids.add(page.id);return Object.freeze({...capture(page),audience:page.audience});}));
   const token=Symbol();registered.set(token,captured);
   try{notify();}catch(error){registered.delete(token);try{notify();}catch{/* Preserve registration error. */}throw error;}
   let closed=false;return {dispose(){if(closed)return;closed=true;registered.delete(token);notify();}};
  },
  create(options){
   live();const document=options.root.ownerDocument;
   if(css&&!styles.has(document)){const style=document.createElement('style');style.textContent=css;document.head.append(style);styles.set(document,style);}
   const reader=createReader(options,content,guides,listener=>{listeners.add(listener);return {dispose(){listeners.delete(listener);}};}),close=reader.dispose.bind(reader);let closed=false;
   reader.dispose=()=>{if(closed)return;closed=true;readers.delete(reader);close();};readers.add(reader);return reader;
  },
  dispose(){if(disposed)return;disposed=true;const errors:unknown[]=[];for(const reader of readers){try{reader.dispose();}catch(error){errors.push(error);}}registered.clear();listeners.clear();for(const style of styles.values())style.remove();styles.clear();if(errors.length)throw new AggregateError(errors,'Manual cleanup failed');}
 });
}
function createReader(options:ManualReaderOptions,content:WindowContentService,guides:(audience:ManualAudience)=>readonly ManualGuide[],subscribe:(changed:()=>void)=>Disposable):ManualReader {
 const root=options.root,document=root.ownerDocument,prefix=options.idPrefix??'manual';
 if(!/^[a-z][a-z0-9-]*$/.test(prefix))throw new Error('Invalid Manual ID prefix');
 const captureSection=(audience:ManualAudience)=>{const section=options.book[audience];text(section.label,'audience label');if(typeof section.intro!=='string'||!Array.isArray(section.pages)||section.pages.length>512)throw new Error('Invalid Manual section');const ids=new Set<string>();return {...section,pages:section.pages.map(page=>{if(ids.has(page.id))throw new Error(`Duplicate Manual page ${page.id}`);ids.add(page.id);return capture(page);})};};
 const book={players:captureSection('players'),creators:captureSection('creators')};
 const pages=(audience:ManualAudience)=>[...book[audience].pages,...guides(audience)];
 const state:{audience:ManualAudience;page:Record<ManualAudience,string>}={audience:'players',page:{players:pages('players')[0]?.id??'',creators:pages('creators')[0]?.id??''}};
 const key=options.storageKey??'space-sim:manual:1';
 try{const saved=JSON.parse(options.storage?.getItem(key)??'null');if(AUDIENCES.includes(saved?.audience))state.audience=saved.audience;for(const audience of AUDIENCES)if(pages(audience).some(page=>page.id===saved?.page?.[audience]))state.page[audience]=saved.page[audience];}catch{/* Optional remembered navigation. */}
 const save=()=>{try{options.storage?.setItem(key,JSON.stringify(state));}catch{/* Session-only navigation. */}};
 const previous=[...root.childNodes],hadClass=root.classList.contains('manual'),controller=new (document.defaultView?.AbortController??AbortController)(),signal=controller.signal;
 let disposed=false,reading:Disposable|undefined,rendered:ManualTopic|undefined,revision:string|undefined;
 let subscription:Disposable|undefined;
 const reader:ManualReader={refresh(){if(!disposed)render();},show(pageId){if(disposed||!pages(state.audience).some(page=>page.id===pageId))return;state.page[state.audience]=pageId;save();renderTopics();renderPage();options.scrollContainer?.scrollTo({top:0});article.scrollTo({top:0});article.focus({preventScroll:true});},
  dispose(){if(disposed)return;disposed=true;controller.abort();subscription?.dispose();try{reading?.dispose();}finally{reading=undefined;root.replaceChildren(...previous);root.classList.toggle('manual',hadClass);}}
 };
 const current=()=>{const available=pages(state.audience);return available.find(page=>page.id===state.page[state.audience])??available[0];};
 const searchText=new WeakMap<ManualTopic,string>();
 let intro:HTMLElement,search:HTMLInputElement,topics:HTMLUListElement,article:HTMLElement;
 function renderTopics():void {
  const query=search.value.trim().toLowerCase(),active=current();
  const available=pages(state.audience).filter(page=>{let indexed=searchText.get(page);if(indexed===undefined){indexed=`${page.title} ${page.summary} ${page.searchText??''} ${page.document?documentText(page.document):''}`.toLowerCase();searchText.set(page,indexed);}return !query||indexed.includes(query);});
  topics.replaceChildren(...available.map(page=>{const item=document.createElement('li'),button=document.createElement('button'),title=document.createElement('b'),summary=document.createElement('span');button.type='button';button.dataset.page=page.id;button.className='manual-topic';title.textContent=page.title;summary.textContent=page.summary;button.append(title,summary);if(page===active)button.setAttribute('aria-current','page');item.append(button);return item;}));
  if(!available.length){const empty=document.createElement('li');empty.className='manual-empty';empty.textContent='No pages match.';topics.append(empty);}
  topics.querySelector('[aria-current="page"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
 }
 function renderPage():void {
  const page=current(),stamp=options.revision?.()??'';if(page===rendered&&stamp===revision)return;
  const staged=document.createElement('div'),title=document.createElement('h2');title.textContent=page?.title??'No pages available';staged.append(title);
  const next=page?.document?content.document(staged,page.document):page?.mount?.(staged);
  try{reading?.dispose();}catch(error){next?.dispose();throw error;}
  article.replaceChildren(...staged.childNodes);article.scrollTop=0;reading=next??undefined;rendered=page;revision=stamp;
 }
 function render():void {
  for(const tab of root.querySelectorAll<HTMLButtonElement>('[data-audience]'))tab.setAttribute('aria-selected',String(tab.dataset.audience===state.audience));
  article.setAttribute('aria-labelledby',`${prefix}-tab-${state.audience}`);intro.textContent=book[state.audience].intro;renderTopics();renderPage();
 }
 try{
  root.classList.add('manual');root.innerHTML='<div class="manual-tabs" role="tablist" aria-label="Manual audience"></div><p class="manual-intro"></p><input type="search" class="manual-search" placeholder="Search the manual" aria-label="Search the manual" autocomplete="off" spellcheck="false"><div class="manual-layout"><nav class="manual-topics" aria-label="Manual topics"><ul></ul></nav><article class="manual-page" role="tabpanel" tabindex="-1" aria-live="polite"></article></div>';
  intro=root.querySelector('.manual-intro')!;intro.id=`${prefix}-intro`;search=root.querySelector('.manual-search')!;search.id=`${prefix}-search`;topics=root.querySelector('.manual-topics ul')!;topics.id=`${prefix}-topics`;article=root.querySelector('.manual-page')!;article.id=`${prefix}-page`;
  const tabs=root.querySelector('.manual-tabs')!;for(const audience of AUDIENCES){const tab=document.createElement('button');tab.type='button';tab.role='tab';tab.id=`${prefix}-tab-${audience}`;tab.dataset.audience=audience;tab.setAttribute('aria-controls',article.id);tab.textContent=book[audience].label;tabs.append(tab);}
  if(options.configure){const button=document.createElement('button');button.type='button';button.className='manual-configure';button.textContent=options.configure.label;button.setAttribute('aria-haspopup','dialog');button.addEventListener('click',()=>options.configure?.open(),{signal});intro.after(button);}
  root.addEventListener('click',event=>{const target=event.target instanceof Element?event.target:null,tab=target?.closest<HTMLElement>('[data-audience]');if(tab){state.audience=tab.dataset.audience as ManualAudience;save();render();return;}const link=target?.closest<HTMLElement>('[data-page]');if(link){event.preventDefault();reader.show(link.dataset.page!);}},{signal});
  tabs.addEventListener('keydown',event=>{const key=(event as KeyboardEvent).key;if(key!=='ArrowLeft'&&key!=='ArrowRight')return;event.preventDefault();const index=AUDIENCES.indexOf(state.audience);state.audience=AUDIENCES[(index+(key==='ArrowRight'?1:AUDIENCES.length-1))%AUDIENCES.length]!;save();render();root.querySelector<HTMLButtonElement>(`#${prefix}-tab-${state.audience}`)!.focus();},{signal});
  search.addEventListener('input',renderTopics,{signal});subscription=subscribe(render);render();return reader;
 }catch(error){try{reader.dispose();}catch{/* Preserve creation failure. */}throw error;}
}
export default function initialize(context:ModuleInitializationV2):void {
 context.contributeGuide({id:'usage',audience:'creators',title:'Manual reader and guide catalog',summary:'Optional Players/Creators navigation over shared documents with explicit live-content adapters.',asset:'docs/creators/usage.json'});
 context.provide(MANUAL_READER,context.own(createManuals(context.use(WINDOW_CONTENT),context.assets.text('assets/manual.css'))));
}
