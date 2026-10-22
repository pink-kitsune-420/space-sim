import {describe,it,expect} from 'vitest';
import {createTileChunkOwner,createTileChunkRevisions,validateTileChunkRevision,validateTileChunkProfile,requireTileChunkFeatures,
  type OverlayPrimitive} from '../../packages/game-api/src/index';
import {validateOverlay} from '../../packages/game-runtime/src/presentation';
import {revisionTileExample as canvasExample} from '../../examples/modules/render-canvas/src/main';
import {revisionTileExample as webglExample} from '../../examples/modules/render-webgl/src/main';

const chunk=()=>({kind:'tile-chunk' as const,space:'world' as const,origin:{x:0,y:0},size:32 as const,tileMetres:1,tiles:new Uint16Array(1024)});

describe('explicit tile content revisions',()=>{
 it('keeps creator examples optional with explicit vector and borrowed-buffer fallback',()=>{
  const owner=createTileChunkOwner(),base={version:1 as const,rotation:true as const,clipPolygon:true as const};
  for(const example of [canvasExample,webglExample]){
   expect(example({},owner).kind).toBe('line');
   const legacy=example({tileChunks:base},owner);
   expect(legacy.kind).toBe('tile-chunk');expect('contentRevision' in legacy).toBe(false);
   const revision=example({tileChunks:{...base,revisions:createTileChunkRevisions()}},owner,2);
   expect(revision.kind).toBe('tile-chunk');
   if(revision.kind==='tile-chunk')expect(revision.contentRevision).toEqual({owner,id:0,revision:2});
  }
 });
 it('creates independent frozen epochs with idempotent disposal and no authority data',()=>{
  const a=createTileChunkOwner(),b=createTileChunkOwner();expect(a).not.toBe(b);expect(Object.isFrozen(a)).toBe(true);
  expect(a.disposed).toBe(false);a.dispose();a.dispose();expect(a.disposed).toBe(true);expect(b.disposed).toBe(false);
  expect(Object.keys(a).sort()).toEqual(['dispose','disposed','version']);
 });
 it('detaches metadata while preserving owner identity and borrowed mutable legacy buffers',()=>{
  const source=chunk(),owner=createTileChunkOwner(),revision={owner,id:2,revision:0};
  const out=validateOverlay([{...source,contentRevision:revision}])[0] as Extract<OverlayPrimitive,{kind:'tile-chunk'}>;
  expect(out.contentRevision).not.toBe(revision);expect(Object.isFrozen(out.contentRevision)).toBe(true);
  expect(out.contentRevision!.owner).toBe(owner);expect(out.tiles).toBe(source.tiles);
  revision.revision=1;source.tiles[0]=2;expect(out.contentRevision!.revision).toBe(0);expect(out.tiles[0]).toBe(2);
  // Opted-in producer advances its revision before submitting reused content.
  const next=validateOverlay([{...source,contentRevision:revision}])[0] as typeof out;
  expect(next.contentRevision!.revision).toBe(1);expect(next.tiles[0]).toBe(2);
  expect((validateOverlay([source])[0] as typeof out).contentRevision).toBeUndefined();
 });
 it('accepts structurally compatible owners from independently bundled SDK copies',()=>{
  let closed=false;const owner=Object.freeze({version:1 as const,get disposed(){return closed;},dispose(){closed=true;}});
  const r={owner,id:0,revision:Number.MAX_SAFE_INTEGER};expect(()=>validateTileChunkRevision(r)).not.toThrow();
  const inherited=Object.create(r);const out=validateOverlay([{...chunk(),contentRevision:inherited}])[0] as Extract<OverlayPrimitive,{kind:'tile-chunk'}>;
  expect(out.contentRevision).toEqual(r);expect(out.contentRevision!.owner).toBe(owner);
  owner.dispose();expect(()=>validateTileChunkProfile({...chunk(),contentRevision:r})).toThrow('disposed');
 });
 it('rejects unsafe, unknown or disposed metadata before visibility and supplied-light work',()=>{
  const owner=createTileChunkOwner(),valid={owner,id:0,revision:1};
  for(const bad of [null,[],0,{...valid,id:-1},{...valid,id:1.5},{...valid,revision:Infinity},{...valid,revision:Number.MAX_SAFE_INTEGER+1},
   {...valid,extra:true},{...valid,owner:{version:1,disposed:false,dispose(){}}},{...valid,owner:Object.freeze({version:2,disposed:false,dispose(){}})}]){
   expect(()=>validateTileChunkRevision(bad)).toThrow();expect(()=>validateOverlay([{...chunk(),contentRevision:bad}])).toThrow();
  }
  owner.dispose();expect(()=>validateOverlay([{...chunk(),origin:{x:1e9,y:1e9},contentRevision:valid}])).toThrow('disposed');
 });
 it('keeps release local and idempotent without disposing shared owners or retaining payload',()=>{
  const owner=createTileChunkOwner(),r={owner,id:4,revision:1},heldA=new Set([4]),heldB=new Set([4]);
  const a=createTileChunkRevisions(x=>{heldA.delete(x.id);}),b=createTileChunkRevisions(x=>{heldB.delete(x.id);});
  a.release(r);a.release(r);expect(heldA.size).toBe(0);expect(heldB.has(4)).toBe(true);expect(owner.disposed).toBe(false);
  expect(a.maxEntries).toBe(512);expect(a.maxBytes).toBe(2*1024*1024);
  owner.dispose();a.release(r);b.release(r);expect(heldB.size).toBe(0);expect(()=>validateTileChunkRevision(r)).toThrow();
  expect(()=>validateTileChunkRevision(r,true)).not.toThrow();
 });
 it('preflights revisions separately from legacy and supplied-light geometry support',()=>{
  const base={tileChunks:{version:1 as const,rotation:true as const,clipPolygon:true as const},tilePalettes:{register(){}}};
  expect(()=>requireTileChunkFeatures(base)).not.toThrow();expect(()=>requireTileChunkFeatures(base,{revisions:true})).toThrow();
  expect(()=>requireTileChunkFeatures({...base,tileChunks:{...base.tileChunks,revisions:createTileChunkRevisions()}},{revisions:true})).not.toThrow();
  for(const change of [{maxBytes:-1},{maxEntries:NaN},{maxEntries:513},{maxBytes:2*1024*1024+1}])
   expect(()=>requireTileChunkFeatures({...base,tileChunks:{...base.tileChunks,revisions:{...createTileChunkRevisions(),...change}}},{revisions:true})).toThrow();
 });
});
