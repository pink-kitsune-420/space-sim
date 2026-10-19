import {deterministicMath as dm,type Vec} from '@space-sim/game-api';
const length=(v:Vec)=>dm.hypot(v.x,v.y);
/** Universal-variable, zero-revolution Lambert seed. Deterministic bounded
 * bisection; acceptance is always checked by selected-provider propagation. */
export function lambert(start:Vec,end:Vec,seconds:number,mu:number,direction:number):{departure:Vec;arrival:Vec}|undefined {
 const r1=length(start),r2=length(end),cos=(start.x*end.x+start.y*end.y)/(r1*r2),cross=start.x*end.y-start.y*end.x;
 if(!(r1>0&&r2>0&&seconds>0&&mu>0)||!Number.isFinite(r1+r2+seconds+mu)||Math.abs(cross)<r1*r2*1e-10)return;
 const a=(cross*direction>0?1:-1)*Math.sqrt(Math.max(0,r1*r2*(1+Math.max(-1,Math.min(1,cos)))));
 if(Math.abs(a)<Math.sqrt(r1*r2)*1e-10)return;
 function time(z:number):{seconds:number;y:number}|undefined {
  let c:number,s:number;
  if(Math.abs(z)<.1){
   c=.5;s=1/6;let ct=c,st=s;
   for(let k=1;k<=12;k++){ct*=-z/((2*k+1)*(2*k+2));st*=-z/((2*k+2)*(2*k+3));c+=ct;s+=st;}
  }else if(z>0){const q=Math.sqrt(z);c=(1-dm.cos(q))/z;s=(q-dm.sin(q))/(q*q*q);}
  else{const q=Math.sqrt(-z),exp=dm.exp(q),inverse=1/exp;c=(1-(exp+inverse)/2)/z;s=((exp-inverse)/2-q)/(q*q*q);}
  if(!(c>0))return;
  const y=r1+r2+a*(z*s-1)/Math.sqrt(c);
  if(y<0)return{seconds:-Infinity,y};
  const x=Math.sqrt(y/c),t=(x*x*x*s+a*Math.sqrt(y))/Math.sqrt(mu);
  return Number.isFinite(t)?{seconds:t,y}:undefined;
 }
 let low=-4*Math.PI*Math.PI,high=4*Math.PI*Math.PI-1e-5;
 for(let i=0;i<8;i++){const t=time(low);if(t&&t.seconds<=seconds)break;low*=2;}
 const hi=time(high),lo=time(low);if(!hi||!lo||hi.seconds<seconds||lo.seconds>seconds)return;
 let value:ReturnType<typeof time>;
 for(let i=0;i<80;i++){
  const mid=(low+high)/2;value=time(mid);if(!value)return;
  if(value.seconds<seconds)low=mid;else high=mid;
 }
 value=time((low+high)/2);if(!value||value.y<0)return;
 const f=1-value.y/r1,g=a*Math.sqrt(value.y/mu),gd=1-value.y/r2;
 if(Math.abs(g)<1e-12)return;
 const departure={x:(end.x-f*start.x)/g,y:(end.y-f*start.y)/g},arrival={x:(gd*end.x-start.x)/g,y:(gd*end.y-start.y)/g};
 return Number.isFinite(departure.x+departure.y+arrival.x+arrival.y)?{departure,arrival}:undefined;
}
/** Outgoing hyperbola matching an asymptotic velocity at a given parking point.
 * Both angular-momentum roots exist; retain the parking orbit's signed direction. */
export function ejection(position:Vec,infinity:Vec,mu:number,direction:number):Vec|undefined {
 const r=length(position),v=length(infinity);if(!(r>0&&v>0))return;
 const rx=position.x/r,ry=position.y/r,ux=infinity.x/v,uy=infinity.y/v,
  cosine=rx*ux+ry*uy,sine=rx*uy-ry*ux,b=r*v*sine,
  h=(b+direction*Math.sqrt(b*b+4*r*mu*Math.max(0,1-cosine)))/2;
 if(Math.abs(h)<1e-10)return;
 const radial=mu/h*sine+v*cosine,tangent=h/r;
 return{x:rx*radial-ry*tangent,y:ry*radial+rx*tangent};
}
