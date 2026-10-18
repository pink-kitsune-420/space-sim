import {THROTTLE_HUD,FLIGHT_HUD_STATE,type ThrottleLeverOptions,type HudInstrumentDefinition,type HudSurface,type ModuleInitializationV2} from '@space-sim/game-api';
import {ThrottleLever,THROTTLE_LEVER_SPACE} from './lever';
export function createThrottleInstrument(options:ThrottleLeverOptions = {}):HudInstrumentDefinition {return Object.freeze<HudInstrumentDefinition>({
 id:'spacelab.throttle-hud',requires:Object.freeze([FLIGHT_HUD_STATE]),
 create(context){
  const adapter=context.use(FLIGHT_HUD_STATE);let surface:HudSurface|undefined,disposed=false;
  const lever=new ThrottleLever(adapter.pilot,()=>disposed?undefined:adapter.throttle(),value=>{if(!disposed)adapter.setThrottle(value);},options);
  return {cancel:()=>lever.cancel(),rebind:()=>lever.cancel(),resize(value){if(surface?.root!==value.root)lever.cancel();surface=value;},
   update(){if(disposed||!surface)return;const read=adapter.navball();
    // Geometry is supplied by the same cached layout used for navball drawing/picking.
    const side=read?Math.max(79*read.scale,read.trajectory!==undefined?130:100):100;
    lever.sync(surface.root,surface.x+(read?.center.x??0)-side-THROTTLE_LEVER_SPACE,surface.y+(read?.center.y??0)-76);
   },draw(){},dispose(){if(disposed)return;disposed=true;surface=undefined;lever.dispose();}};
 }
});}
export const throttleInstrument=createThrottleInstrument();
export default function initialize(context:ModuleInitializationV2):void {
 context.contributeGuide({id:'usage',audience:'creators',title:'Per-view throttle',summary:'Optional owned thrust control through a validated flight adapter.',asset:'docs/creators/usage.json'});
 context.provide(THROTTLE_HUD,createThrottleInstrument({keyboardStep:(context.settings.keyboardStepPercent??1)/100,pageStep:(context.settings.pageStepPercent??10)/100}));
}
