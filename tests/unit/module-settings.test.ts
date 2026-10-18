import {afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {PROFILERS,THEMES,FLIGHT_PROFILES,type ManifestV2,type ModuleInitializationV2,type ServiceKey} from '../../packages/game-api/src/index';
import {ModuleRegistryV2} from '../../packages/game-runtime/src/modules-v2';
import {validateManifest,settingValue} from '../../packages/game-runtime/src/validation';
import {validateManifestV2} from '../../packages/game-runtime/src/validation-v2';
import initializeProfiler from '../../modules/profiler/src/index';
import {createThemes} from '../../modules/theme/src/index';
import {createFlightProfileCodec} from '../../modules/input-profiles/src/index';
afterEach(()=>vi.restoreAllMocks());
it('keeps both creator schemas compatible with runtime numeric-setting metadata',async()=>{
 const portable=JSON.parse(await readFile('packages/module-tools/portable.schema.json','utf8'));
 const legacy=JSON.parse(await readFile('packages/module-tools/module.schema.json','utf8'));
 for(const manifest of [legacy.$defs.manifest,portable.$defs.manifestV1,portable.$defs.manifestV2]){
  const schema=manifest.properties.settings.additionalProperties;
  expect(schema.additionalProperties).toBe(false);
  expect(schema.required).toEqual(['type','default','minimum','maximum']);
  expect(schema.properties.step).toEqual({type:'number',exclusiveMinimum:0});
  expect(schema.properties.label).toEqual({type:'string',minLength:1,maxLength:256,pattern:'\\S'});
  expect(schema.properties.description).toEqual({type:'string',minLength:1,maxLength:1024,pattern:'\\S'});
 }
 const raw=JSON.parse(await readFile('modules/navball/module.json','utf8')).manifest;
 expect(validateManifestV2(raw).settings.minimumSpeed).toMatchObject({step:.01,label:expect.any(String),description:expect.any(String)});
});
it('validates described numeric settings, increments and defaults without changing continuous legacy settings',async()=>{
 const raw=JSON.parse(await readFile('modules/profiler/module.json','utf8')).manifest as ManifestV2;
 const manifest=validateManifestV2(raw);expect(manifest.settings.precise).toMatchObject({label:'Precise renderer timing',step:1});
 expect(()=>validateManifestV2({...raw,settings:{...raw.settings,precise:{...raw.settings.precise,description:'x'.repeat(1025)}}})).toThrow('description');
 expect(()=>validateManifestV2({...raw,settings:{...raw.settings,precise:{...raw.settings.precise,default:.5}}})).toThrow('increment');
 const legacy={...raw,format:'space-sim-module/1',apiVersion:'space-sim-game-api/1',authority:'presentation',provides:[],requires:[],slots:[]};delete (legacy as any).tier;
 expect(validateManifest(legacy).settings.graphMs!.description).toContain('60 Hz');
 expect(settingValue(.3,{type:'number',minimum:0,maximum:1,default:0,step:.1})).toBe(true);
 expect(settingValue(.35,{type:'number',minimum:0,maximum:1,default:0,step:.1})).toBe(false);
 expect(settingValue(.35,{type:'number',minimum:0,maximum:1,default:0})).toBe(true);
});
it('applies profiler package settings through candidate validation and rejects invalid overrides before activation',async()=>{
 const manifest=JSON.parse(await readFile('modules/profiler/module.json','utf8')).manifest as ManifestV2;
 const registry=new ModuleRegistryV2();registry.register({manifest,initialize(context){initializeProfiler({...context,contributeGuide(){}} as ModuleInitializationV2);}});
 const profile={format:'space-sim-profile/2' as const,id:'fixture.config',modules:[{id:manifest.id,version:manifest.version}],providers:{[PROFILERS.slot]:manifest.id},capabilities:{},settings:{[manifest.id]:{precise:1,longWorkMs:2}}};
 let time=0;vi.spyOn(performance,'now').mockImplementation(()=>time);let flushes=0;
 const candidate=registry.prepare(profile,'browser'),profiler=candidate.providedService(PROFILERS).create(()=>flushes++);
 profiler.begin(16);time=3;profiler.lap('physics');profiler.end();
 expect(profiler.precise).toBe(true);expect(flushes).toBe(1);expect(profiler.summary().slowFrames).toBe(1);candidate.dispose();
 expect(()=>registry.prepare({...profile,settings:{[manifest.id]:{precise:.5}}},'browser')).toThrow('increment');
 expect(()=>registry.prepare({...profile,settings:{[manifest.id]:{longWorkMs:-1}}},'browser')).toThrow('between');
});
it('uses configured viewer/controller defaults while keeping explicit saved preferences',()=>{
 const themes=createThemes('',{windowOpacity:.7,starDensity:.5,nebulaIntensity:0});
 const initial=themes.create(),saved=themes.create({storage:{getItem:()=>JSON.stringify({windowOpacity:.9,starDensity:1.5}),setItem(){}}});
 expect(initial.current()).toMatchObject({windowOpacity:.7,starDensity:.5,nebulaIntensity:0});
 expect(saved.load()).toMatchObject({windowOpacity:.9,starDensity:1.5,nebulaIntensity:0});
 const profiles=createFlightProfileCodec(.25);expect(profiles.defaultProfile.deadzone).toBe(.25);expect(profiles.normalize({}).deadzone).toBe(.25);expect(profiles.normalize({deadzone:.1}).deadzone).toBe(.1);
 expect(()=>createFlightProfileCodec(1)).toThrow('deadzone');themes.dispose();
 // Keep public typed service keys available to independent configuration consumers.
 const keys:readonly Pick<ServiceKey<unknown>,'slot'|'version'>[]=[THEMES,FLIGHT_PROFILES];expect(keys.map(key=>key.slot)).toEqual(['presentation.themes','input.flight-profiles']);
});
