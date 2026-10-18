import {expect,it} from 'vitest';
import type {HudBinding,HudInstrumentDefinition,OverlayPrimitive,ServiceKey} from '../../packages/game-api/src/index';
import {createViewHud,createViewHuds} from '../../modules/view-hud/src/index';
const adapter:ServiceKey<{value:number}>={slot:'fixture.readout',version:'1.0.0'};
const binding:HudBinding={seatId:'seat-alpha',viewportId:'view-alpha',playerId:'pilot-a',targetId:'target-a',session:{}};
it('preserves per-view instances on resize, cancels every gesture before rebind and omits incompatible instruments',()=>{
 const events:string[]=[],read={value:7};let created=0;
 const definition=(name:string):HudInstrumentDefinition=>({id:`fixture.${name}`,requires:[adapter],create(context){
  created++;expect(context.use(adapter)).toBe(read);return {cancel(){events.push(`${name}:cancel`);},rebind(value){events.push(`${name}:${value.targetId}`);},resize(){events.push(`${name}:resize`);},update(){},draw(){},dispose(){events.push(`${name}:dispose`);}};
 }});
 const a=definition('a'),b=definition('b'),definitions=[a,b];
 const hud=createViewHud({binding,adapters:[{key:adapter,service:read}],instruments:definitions});
 const root={} as HTMLElement;hud.resize({root,width:600,height:400,x:0,y:0});hud.resize({root,width:600,height:400,x:0,y:0});hud.select(definitions);
 expect(created).toBe(2);expect(events.filter(event=>event==='a:resize')).toHaveLength(1);
 events.length=0;hud.bind({...binding,targetId:'target-b'});
 expect(events).toEqual(['a:cancel','b:cancel','a:target-b','b:target-b']);
 events.length=0;hud.bind({...hud.binding,session:{}});expect(events.slice(0,2)).toEqual(['a:cancel','b:cancel']);
 expect(()=>hud.bind({...binding,seatId:'another-seat'})).toThrow('another seat');
 hud.select([]);expect(hud.count).toBe(0);expect(events.filter(event=>event.endsWith(':dispose'))).toHaveLength(2);hud.dispose();
 const absent=createViewHud({binding,adapters:[],instruments:definitions});expect(absent.count).toBe(0);absent.dispose();
 const wrong=createViewHud({binding,adapters:[{key:{...adapter,version:'2.0.0'},service:read}],instruments:definitions});expect(wrong.count).toBe(0);wrong.dispose();
});
it('isolates faulty contributions, rolls back partial drawing and disposes every view exactly once',()=>{
 let closed=0,good=0;const faults:string[]=[];
 const broken:HudInstrumentDefinition={id:'fixture.broken',requires:[],create(){return {cancel(){},rebind(){},resize(){},update(){},draw(into){into.push({kind:'circle',space:'screen',center:{x:1,y:1},radius:1,color:'#ffffff'});throw new Error('Draw failed');},dispose(){closed++;}};}};
 const healthy:HudInstrumentDefinition={id:'fixture.healthy',requires:[],create(){return {cancel(){},rebind(){},resize(){},update(){good++;},draw(){},dispose(){closed++;}};}};
 const factory=createViewHuds(),hud=factory.create({binding,adapters:[],instruments:[broken,healthy],fault:id=>faults.push(id)}),output:OverlayPrimitive[]=[];
 hud.draw(output);hud.draw(output);hud.update(1/60);expect(output).toEqual([]);expect(hud.count).toBe(1);expect(faults).toEqual(['fixture.broken']);expect(good).toBe(1);
 factory.dispose();hud.dispose();hud.update(1/60);expect(closed).toBe(2);expect(good).toBe(1);expect(()=>factory.create({binding,adapters:[]})).toThrow('disposed');
});
