import { NAVBALL_HUD, FLIGHT_HUD_STATE, type HudInstrumentDefinition, type ModuleInitializationV2 } from '@space-sim/game-api';
import { drawNavball, shipAutoFrame, shipNavballState, type NavballFrame } from './drawing';
export function createNavballInstrument(settings: {readonly frame?:number;readonly orientation?:'horizon'|'camera';readonly minimumSpeed?:number} = {}): HudInstrumentDefinition { return Object.freeze<HudInstrumentDefinition>({
  id:'builtin.navball',requires:Object.freeze([FLIGHT_HUD_STATE]),
  create(context) {
    const adapter=context.use(FLIGHT_HUD_STATE),frames=new Map<string,NavballFrame>();let session=context.binding.session,scope=context.binding.context,disposed=false;
    return {cancel(){adapter.cancelGestures?.();},resize(){},update(){},
      rebind(binding){if(binding.session!==session||binding.context!==scope){session=binding.session;scope=binding.context;frames.clear();}},
      draw(into){
        if(disposed)return;const read=adapter.navball();if(!read || read.state.status==='crashed')return;
        const frameSetting=settings.frame??read.frameSetting,orientation=settings.orientation??read.orientation;
        const id=context.binding.targetId ?? '',frame=frameSetting>=2?'surface':frameSetting>=1?'orbit':shipAutoFrame(read.state.status,read.clearance,read.radius,frames.get(id));
        if(frames.size>16)frames.clear();frames.set(id,frame);
        let state=shipNavballState(read.state,{radius:read.radius,spin:read.spin},frame,settings.minimumSpeed);if(!state)return;
        if(read.maneuver!==undefined)state={...state,maneuver:read.maneuver};
        const turn=orientation==='horizon'?Math.PI/2-state.zenith:read.cameraRotation;
        into.push(...drawNavball(state,read.center,turn,orientation,read.accentColor,read.playerLabel,read.scale,read.trajectory,read.pinned,read.dragging,read.editing));
      },
      dispose(){if(disposed)return;disposed=true;frames.clear();},
    };
  },
}); }
export const navballInstrument=createNavballInstrument();
export default function initialize(context:ModuleInitializationV2):void {
  context.contributeGuide({id:'usage',audience:'creators',title:'Per-view navball',summary:'Optional attitude instrument using the shared HUD lifecycle.',asset:'docs/creators/usage.json'});
  context.provide(NAVBALL_HUD,createNavballInstrument({frame:context.settings.frame??0,orientation:(context.settings.orientation??0)>=1?'camera':'horizon',minimumSpeed:context.settings.minimumSpeed??.05}));
}
