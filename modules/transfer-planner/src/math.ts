import {deterministicMath as dm,type TransferOption,type Vec} from '@space-sim/game-api';
export const radius=(v:Vec)=>dm.hypot(v.x,v.y);
export const tolerance=(r:number)=>Math.max(.01,r*1e-7);
/** Compare validated candidates that still leave time to prepare the departure. */
export function transferOptions(candidates:readonly Omit<TransferOption,'kind'>[],now:number):readonly TransferOption[] {
 const available=candidates.filter(c=>c.plan.nodes[0]!.time-c.departureBurnSeconds/2>now+1)
  .sort((a,b)=>a.deltaV-b.deltaV||a.waitSeconds+a.travelSeconds-b.waitSeconds-b.travelSeconds);
 if(!available.length)return [];
 const efficient=available[0]!,faster=available.filter(c=>c.deltaV<=efficient.deltaV*2&&c.waitSeconds+c.travelSeconds<=(efficient.waitSeconds+efficient.travelSeconds)*.9)
  .sort((a,b)=>a.waitSeconds+a.travelSeconds-b.waitSeconds-b.travelSeconds||a.deltaV-b.deltaV)[0];
 return [{...efficient,kind:'efficient'},...(faster?[{...faster,kind:'faster' as const}]:[])];
}
/** Full-throttle burns are centered on their impulse times. Leave room to cut
 * off the first, turn in inertial space, then begin the second. A zero-impulse
 * review checkpoint needs neither ignition nor steering and may cross a burn. */
export function burnsFit(travel:number,departure:Vec,arrival:Vec,acceleration:number,turnRate:number):boolean {
 const first=radius(departure),second=radius(arrival);
 if(first<=1e-8||second<=1e-8)return true;
 const angle=Math.abs(dm.normalizeAngle(dm.atan2(arrival.y,arrival.x)-dm.atan2(departure.y,departure.x)));
 const turn=angle<1e-7?0:turnRate>0?angle/turnRate:Infinity;
 return (first+second)/(2*acceleration)+turn<travel;
}
/** Existing planner's bases are not generally orthogonal: prograde follows velocity. */
export function deltaComponents(position:Vec,velocity:Vec,delta:Vec):{prograde:number;radial:number}|undefined {
 const r=radius(position),v=radius(velocity);if(!(r>0&&v>0))return;
 const px=velocity.x/v,py=velocity.y/v,rx=position.x/r,ry=position.y/r,det=px*ry-py*rx;
 if(Math.abs(det)<1e-8)return;
 const prograde=(delta.x*ry-delta.y*rx)/det,radial=(px*delta.y-py*delta.x)/det;
 return Number.isFinite(prograde+radial)&&Math.abs(prograde)<=1e6&&Math.abs(radial)<=1e6?{prograde,radial}:undefined;
}
