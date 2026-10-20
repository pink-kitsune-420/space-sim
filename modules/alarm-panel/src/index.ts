import {ALARM_CATALOGUE,ALARM_PANELS,WINDOWS,type AlarmPanel,type AlarmPanelFactory,type AlarmPanelOptions,
 type Disposable,type ModuleInitializationV2,type OrbitalAlarmCatalogue,type WindowChrome,type WindowSystem} from '@space-sim/game-api';
/** Removable dock/window view of existing clocks. No scheduler or host command ports. */
export function createAlarmPanels(windows:Pick<WindowSystem,'create'>|undefined,catalogue:OrbitalAlarmCatalogue):AlarmPanelFactory & Disposable {
 const panels=new Set<AlarmPanel>();let disposed=false;
 return Object.freeze({create(options:AlarmPanelOptions){
  if(disposed)throw Error('Alarm panel provider disposed');
  const chrome=options.windows??windows;if(!chrome)throw Error('Alarm panel requires ui.windows or an explicit host window adapter.');
  const id=options.id??'alarms';if(!/^[a-z][a-z0-9-]{0,63}$/.test(id))throw Error('Invalid alarm panel identity');
  let window:WindowChrome|undefined,dock:Disposable|undefined,last=-Infinity,closed=false;
  const document=options.container.ownerDocument;
  try{
   window=chrome.create({id,title:'Alarms',icon:'alarm',container:options.container,pinned:true,className:'alarm-window',place:()=>({x:390,y:100})});
   window.body.style.cssText='display:grid;gap:10px;padding:12px;max-width:480px;font-size:12px;line-height:1.5';
   const help=document.createElement('p'),status=document.createElement('output'),list=document.createElement('div');
   help.style.cssText='margin:0;font-size:11px;line-height:1.5;opacity:.85';help.className='panel-note';help.textContent='Reviewed next burns appear here, including manually flown nodes. Configure lead time and optional pause in Maneuver → Burn alarm. Later nodes join after earlier burns are resolved and reviewed.';
   status.setAttribute('aria-live','polite');list.dataset.alarmList='';list.style.cssText='display:grid;gap:8px';window.body.append(help,status,list);
   dock=options.shell?.addInstrument(window,'Alarms','Pending burn reminders and delivered alarms');
   let key='';
   const panel:AlarmPanel={update(){
    if(closed||!window!.isOpen)return;
    const now=performance.now();if(now-last<200)return;last=now;
    const events=catalogue.read(options.session()).slice().sort((a,b)=>Number(a.handled)-Number(b.handled)||a.deadline-b.deadline),pending=events.filter(e=>!e.handled).length;
    status.textContent=events.length?`${pending} pending · ${events.length-pending} delivered`:'No active reminders. Place and review a maneuver node to add one.';
    const next=events.map(e=>`${e.id}/${e.label}/${e.deadline}/${e.time}/${e.pause}/${e.handled}/${Math.floor((e.deadline-e.now)*10)}/${Math.floor((e.time-e.now)*10)}`).join('|');
    if(next===key)return;key=next;
    list.replaceChildren(...events.map(e=>{
     const row=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('p');row.dataset.alarmId=e.id;
     row.style.cssText='border:1px solid #294953;border-radius:6px;padding:8px';title.textContent=e.label;
     const countdown=(time:number)=>time>=0?`in ${time.toFixed(1)} s`:`${(-time).toFixed(1)} s ago`;
     detail.textContent=`${e.handled?'Delivered':`Reminder ${countdown(e.deadline-e.now)}`} · ${e.kind==='maneuver'?'node':'event'} ${countdown(e.time-e.now)} · ${e.pause?'pause requested':'notify and exit warp'}`;
     detail.className='panel-note';detail.style.margin='4px 0 0';row.append(title,detail);return row;
    }));
   },dispose(){
    if(closed)return;closed=true;panels.delete(panel);const errors:unknown[]=[];
    for(const close of [()=>dock?.dispose(),()=>window?.dispose()])try{close();}catch(e){errors.push(e);}
    if(errors.length)throw new AggregateError(errors,'Alarm panel cleanup failed');
   }};
   window.onChange(()=>{last=-Infinity;panel.update();});panels.add(panel);return panel;
  }catch(error){dock?.dispose();window?.dispose();throw error;}
 },dispose(){if(disposed)return;disposed=true;const errors:unknown[]=[];for(const panel of panels)try{panel.dispose();}catch(e){errors.push(e);}panels.clear();if(errors.length)throw new AggregateError(errors,'Alarm panels cleanup failed');}});
}
/**
 * Contributes the Alarms dock instrument panel window over existing orbital clocks.
 * Provides view.alarms@1.0.0 in slot view.alarms; requires flight.alarm-catalogue@^1.0.0
 * and optionally consumes ui.windows@^1.0.0.
 */
export default function initialize(context:ModuleInitializationV2):void {
 context.provide(ALARM_PANELS,context.own(createAlarmPanels(context.tryUse(WINDOWS),context.use(ALARM_CATALOGUE))));
 context.contributeGuide({id:'usage',audience:'creators',title:'Alarms dock instrument',summary:'Optional read-only window over independent orbital clocks.',asset:'docs/creators/usage.json'});
 context.contributeGuide({id:'alarms',audience:'players',title:'Alarms in the dock',summary:'View pending and delivered burn reminders.',asset:'docs/players/alarms.json'});
}
