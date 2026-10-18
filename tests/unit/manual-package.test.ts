import {expect,it} from 'vitest';
import {createManuals} from '../../modules/manual/src/index';
import {createWindowContent} from '../../modules/ui-windows/src/content';
it('keeps removable guide data discoverable without a DOM, rejects duplicates and captures immutable body text',()=>{
 const content=createWindowContent(),manuals=createManuals(content),source={id:'test.module/help',audience:'creators' as const,title:'Help',summary:'A guide',document:{blocks:[{type:'paragraph' as const,text:'Original'}]}};
 const lease=manuals.register([source]);source.document.blocks[0]!.text='Modified';
 const page=manuals.guides('creators')[0]!;expect(page.document!.blocks[0]).toMatchObject({text:'Original'});expect(Object.isFrozen(page.document!.blocks)).toBe(true);
 expect(manuals.guides('players')).toEqual([]);expect(()=>manuals.register([source])).toThrow('duplicate');
 expect(()=>manuals.register([{...source,id:'other.help',mount(){}}])).toThrow('one structured document');
 lease.dispose();lease.dispose();expect(manuals.guides('creators')).toEqual([]);manuals.dispose();expect(()=>manuals.register([source])).toThrow('disposed');content.dispose();
});
it('shadows repeated candidate guide IDs and restores old content when the replacement lease rolls back',()=>{
 const content=createWindowContent(),manuals=createManuals(content);
 const original={id:'test.module/help',audience:'creators' as const,title:'Original',summary:'Guide',document:{blocks:[{type:'paragraph' as const,text:'Original content'}]}};
 const old=manuals.register([original]),next=manuals.register([{...original,title:'Replacement'}],{replace:true});
 expect(manuals.guides('creators').map(page=>page.title)).toEqual(['Replacement']);next.dispose();expect(manuals.guides('creators').map(page=>page.title)).toEqual(['Original']);
 expect(()=>manuals.register([original,original],{replace:true})).toThrow('duplicate');
 const committed=manuals.register([{...original,title:'Committed'}],{replace:true});old.dispose();expect(manuals.guides('creators').map(page=>page.title)).toEqual(['Committed']);committed.dispose();expect(manuals.guides('creators')).toEqual([]);manuals.dispose();content.dispose();
});
