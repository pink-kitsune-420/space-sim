export { throttleSelection } from './selection';
import {THROTTLE_HUD,FLIGHT_HUD_STATE,type ThrottleLeverOptions,type HudInstrumentDefinition,type HudSurface,type ModuleInitializationV2} from '@space-sim/game-api';
import {ThrottleLever} from './lever';
export function createThrottleInstrument(options:ThrottleLeverOptions = {}):HudInstrumentDefinition {return Object.freeze<HudInstrumentDefinition>({
 id:'spacelab.throttle-hud',requires:Object.freeze([FLIGHT_HUD_STATE]),
 create(context){
  const adapter=context.use(FLIGHT_HUD_STATE),left=adapter.pilot===1||adapter.pilot===2,top=adapter.pilot>=2,preferred={x:0,y:0};let surface:HudSurface|undefined,disposed=false;
  const lever=new ThrottleLever(adapter.pilot,()=>disposed?undefined:adapter.throttle(),value=>{if(!disposed)adapter.setThrottle(value);},options);
  return {cancel:()=>lever.cancel(),rebind:()=>lever.cancel(),resize(value){if(surface?.root!==value.root)lever.cancel();surface=value;},
   update(){if(disposed||!surface)return;
    // Independent responsive anchor. HUD-tool preferences translate this within the
    // current view; moving a navball never changes the lever's base coordinates.
    preferred.x=Math.max(8,Math.min(Math.max(8,surface.width-56),left?220:surface.width-360));
    preferred.y=Math.max(8,Math.min(Math.max(8,surface.height-184),top?32:surface.height-196));
    const at=adapter.placeThrottle?.(preferred,surface)??preferred;
    lever.sync(surface.root,surface.x+at.x,surface.y+at.y);
   },draw(){},dispose(){if(disposed)return;disposed=true;surface=undefined;lever.dispose();}};
 }
});}
export const throttleInstrument=createThrottleInstrument();
export default function initialize(context:ModuleInitializationV2):void {
 context.contributeGuide({id:'usage',audience:'creators',title:'Per-view throttle',summary:'Optional owned thrust control through a validated flight adapter.',asset:'docs/creators/usage.json'});
 context.provide(THROTTLE_HUD,createThrottleInstrument({keyboardStep:(context.settings.keyboardStepPercent??1)/100,pageStep:(context.settings.pageStepPercent??10)/100}));
}
