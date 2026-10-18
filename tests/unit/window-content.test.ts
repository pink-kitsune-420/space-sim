import { describe, expect, it } from 'vitest';
import { captureDocument, documentText, type WindowDefinition } from '../../packages/game-api/src/index';
import { captureWindow } from '../../packages/game-runtime/src/hooks-v2';

describe('structured window content', () => {
  it('captures detached frozen documents and indexes body text, list items and internal links', () => {
    const source = {blocks:[{type:'list',items:['Unique mineral instructions']},{type:'link',text:'More information',page:'creator.help/page'}]};
    const document = captureDocument(source); source.blocks[0]!.items!.push('late');
    expect(documentText(document)).toBe('Unique mineral instructions More information');
    expect(Object.isFrozen(document.blocks[0])).toBe(true);
    expect(() => captureDocument({blocks:[{type:'link',text:'Unsafe',page:'javascript:alert(1)'}]})).toThrow('Invalid document page');
    expect(() => captureDocument({blocks:[{type:'html',text:'<script>'}]})).toThrow('Unsupported guide block');
    expect(() => captureDocument({blocks:[{type:'paragraph',text:'a'.repeat(65537)}]})).toThrow('64 KiB');
  });
  it('captures window forms, logs and bounded exact-version preview declarations without aliases', () => {
    const source: WindowDefinition = {name:'reader',title:'Reader',controls:[],content:[
      {kind:'form',id:'form',controls:[{kind:'button',id:'apply',label:'Apply',action:'creator.editor/apply'}]},
      {kind:'preview',id:'orbit',type:{name:'creator.orbit',version:'1.0.0'},data:{points:[1,2]}},
      {kind:'log',id:'events',items:['Opened']},
    ]};
    const captured = captureWindow(source);
    expect(captured).toEqual(source);expect(Object.isFrozen(captured.content![1])).toBe(true);
    expect(() => captureWindow({...source,content:[...source.content!,source.content![0]!]})).toThrow('Duplicate content');
    for (const data of [NaN, {infinite:Infinity}, new Array(4096).fill(0)]) {
      expect(() => captureWindow({...source,content:[{kind:'preview',id:'orbit',type:{name:'creator.orbit',version:'1.0.0'},data}]})).toThrow();
    }
    expect(() => captureWindow({...source,content:[{kind:'preview',id:'orbit',type:{name:'creator.orbit',version:'^1.0.0'},data:null}]})).toThrow('exact semantic version');
  });
});
