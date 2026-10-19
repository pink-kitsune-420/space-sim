/** Removable vector display for the host's local maneuver editor. Public API only. */
import { createProjector, deterministicMath as dm, type ModuleManifest, type OverlayPrimitive, type PresentationView, type RegisteredModule, type Vec } from '@space-sim/game-api';

export const MANEUVER_COLOR = '#f7c775';
export { maneuverDelta } from '@space-sim/game-api';

export function drawManeuver(view: PresentationView): OverlayPrimitive[] {
  const plan = view.maneuver;
  if (!plan) return [];
  const world = (p: Vec): Vec => ({ x: p.x + view.body.position.x, y: p.y + view.body.position.y });
  const color = plan.valid ? MANEUVER_COLOR : '#c68484', center = world(plan.position), size = 7 / view.camera.scale;
  const project=createProjector(view.camera,view.viewport.width,view.viewport.height),c=dm.cos(view.camera.rotation),s=dm.sin(view.camera.rotation);
  const offset=(at:Vec,dx:number,dy:number):Vec=>({x:at.x+(dx*c-dy*s)/view.camera.scale,y:at.y+(-dx*s-dy*c)/view.camera.scale});
  const labelSide=project(center).y>view.viewport.height-140?-1:1;
  const out: OverlayPrimitive[] = plan.completed ? [] : [{ kind: 'line', space: 'world', color, width: 2, closed: true,
    points: [{ x: center.x, y: center.y + size }, { x: center.x + size, y: center.y },
      { x: center.x, y: center.y - size }, { x: center.x - size, y: center.y }] }];
  const dv = Math.hypot(plan.deltaVelocity.x, plan.deltaVelocity.y);
  if (dv > 0 && plan.valid) {
    const dx = plan.deltaVelocity.x / dv, dy = plan.deltaVelocity.y / dv, length = 30 / view.camera.scale;
    const tip = { x: center.x + dx * length, y: center.y + dy * length }, head = 5 / view.camera.scale;
    out.push({ kind: 'line', space: 'world', color, width: 2, points: [center, tip] },
      { kind: 'line', space: 'world', color, width: 2, points: [
        { x: tip.x - (dx + dy) * head, y: tip.y - (dy - dx) * head }, tip,
        { x: tip.x - (dx - dy) * head, y: tip.y - (dy + dx) * head }] });
    // Select at most 160 original intervals. Joining decimated endpoints can span
    // entire revolutions and invent loops through the body on long-wait plans.
    const path = plan.path, stride = Math.max(1, Math.ceil((path.length - 1) / 160));
    for (let i = 1; i < path.length; i += stride) {
      const a = path[i - 1]!, b = path[i]!, dt = b.time - a.time;
      const point = (t: number): Vec => {
        if (b.linear) return world({ x: a.position.x + (b.position.x - a.position.x) * t, y: a.position.y + (b.position.y - a.position.y) * t });
        const t2 = t * t, t3 = t2 * t;
        return world({ x: (2*t3-3*t2+1)*a.position.x + (t3-2*t2+t)*dt*a.velocity.x + (-2*t3+3*t2)*b.position.x + (t3-t2)*dt*b.velocity.x,
          y: (2*t3-3*t2+1)*a.position.y + (t3-2*t2+t)*dt*a.velocity.y + (-2*t3+3*t2)*b.position.y + (t3-t2)*dt*b.velocity.y });
      };
      out.push({ kind: 'line', space: 'world', color: '#f7c775bb', width: 1.5, points: [point(0), point(.25), point(.5), point(.7)] });
    }
  }
  const duration=(seconds:number|null|undefined):string=>seconds===null?'no thrust':seconds===undefined?'':`${seconds.toFixed(1)} s burn`;
  const arrow=(at:Vec,delta:Vec,tint:string):void=>{
    const magnitude=dm.hypot(delta.x,delta.y);if(!(magnitude>0))return;
    const dx=delta.x/magnitude,dy=delta.y/magnitude,length=26/view.camera.scale,head=4/view.camera.scale,
      tip={x:at.x+dx*length,y:at.y+dy*length};
    out.push({kind:'line',space:'world',color:tint,width:1.5,points:[at,tip]},
      {kind:'line',space:'world',color:tint,width:1.5,points:[{x:tip.x-(dx+dy)*head,y:tip.y-(dy-dx)*head},tip,{x:tip.x-(dx-dy)*head,y:tip.y-(dy+dx)*head}]});
  };
  for (const node of plan.nodes ?? []) {
    if (node.selected || node.completed) continue;
    const at = world(node.position), marker = 5 / view.camera.scale, tint = node.valid ? MANEUVER_COLOR : '#c68484';
    out.push({ kind: 'line', space: 'world', color: tint, width: 1, closed: true,
      points: [{x:at.x,y:at.y+marker},{x:at.x+marker,y:at.y},{x:at.x,y:at.y-marker},{x:at.x-marker,y:at.y}] },
      { kind: 'text', space: 'world', color: tint, at: offset(at,0,project(at).y>view.viewport.height-54?-20:20), align: 'center',
        text: `${node.label} · T${node.time>=view.time?'−':'+'}${Math.abs(node.time-view.time).toFixed(1)} s` });
    if(node.deltaVelocity)out.push({kind:'text',space:'world',color:tint,at:offset(at,0,project(at).y>view.viewport.height-54?-34:34),align:'center',
      text:`${dm.hypot(node.deltaVelocity.x,node.deltaVelocity.y).toFixed(1)} m/s${node.throttleBurnSeconds!==undefined?` · ${duration(node.throttleBurnSeconds)}`:''}`});
    if(node.valid&&node.deltaVelocity)arrow(at,node.deltaVelocity,tint);
  }
  if(!plan.completed)out.push({ kind: 'text', space: 'world', color, at: offset(center,0,76*labelSide), align: 'center',
    text: plan.valid ? `${plan.nodes?.find(node=>node.selected)?.label??'NODE'} · ${dv.toFixed(1)} m/s · T${plan.time >= view.time ? '−' : '+'}${Math.abs(plan.time - view.time).toFixed(1)} s` : 'NODE · replan' });
  if(plan.valid&&plan.throttleBurnSeconds!==undefined){
    const label=`${duration(plan.throttleBurnSeconds)} at ${((plan.throttle??0)*100).toFixed(0)}% throttle`;
    out.push({kind:'text',space:'world',color,at:offset(center,0,91*labelSide),align:'center',text:label});
  }
  if(plan.valid&&plan.remainingDeltaV!==undefined&&dv>0){
    const delivered=Math.max(0,Math.min(1,1-plan.remainingDeltaV/dv)),left=offset(center,-24,106*labelSide),right=offset(center,24,106*labelSide),filled=offset(center,-24+48*delivered,106*labelSide);
    out.push({kind:'line',space:'world',color:'#f7c77555',width:3,points:[left,right]},
      {kind:'line',space:'world',color,width:3,points:[left,filled]},
      {kind:'text',space:'world',color,at:offset(center,0,121*labelSide),align:'center',text:`BURN · ${plan.remainingDeltaV.toFixed(1)} m/s left`});
  }
  return out;
}

const manifest: ModuleManifest = {
  format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'builtin.maneuver-planner', name: 'Maneuver planner',
  version: '0.1.0', kind: 'provider', authority: 'presentation', environments: ['browser', 'offline'],
  dependencies: [], provides: [], requires: [], slots: [], before: [], after: [], settings: {}, license: 'LicenseRef-Project',
};
export const maneuverPlanner: RegisteredModule = { manifest, initialize(context) {
  context.contributeLayer({ name: 'maneuver', label: 'Planned burn and trajectory', draw: drawManeuver });
} };
