import {deterministicMath as dm,type Vec} from '@space-sim/game-api';
export const radius=(v:Vec)=>dm.hypot(v.x,v.y);
export const tolerance=(r:number)=>Math.max(.01,r*1e-7);
/** Existing planner's bases are not generally orthogonal: prograde follows velocity. */
export function deltaComponents(position:Vec,velocity:Vec,delta:Vec):{prograde:number;radial:number}|undefined {
 const r=radius(position),v=radius(velocity);if(!(r>0&&v>0))return;
 const px=velocity.x/v,py=velocity.y/v,rx=position.x/r,ry=position.y/r,det=px*ry-py*rx;
 if(Math.abs(det)<1e-8)return;
 const prograde=(delta.x*ry-delta.y*rx)/det,radial=(px*delta.y-py*delta.x)/det;
 return Number.isFinite(prograde+radial)&&Math.abs(prograde)<=1e6&&Math.abs(radial)<=1e6?{prograde,radial}:undefined;
}
