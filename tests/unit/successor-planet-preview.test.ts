import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { requestedBuiltinGame } from '../../apps/web/src/bundled-games';
import { prepareGame, validateDataModule } from '../../packages/modules/src/index';
import preview from '../../games/space-sim-successor/planet-preview.json';
import { querySurface } from '../../packages/sim-core/src/surface';
import { saveWorld } from '../../packages/sim-core/src/save';
import { IDLE } from '../../packages/sim-core/src/constants';
import { TileDemand, localSurfaceInView } from '../../apps/web/src/successor-tile-demand';
import { terrainGeometry as glTerrain } from '../../modules/render-webgl/src/terrain';
import { terrainGeometry as canvasTerrain } from '../../modules/render-canvas/src/terrain';

const game = requestedBuiltinGame('?game=space-sim-successor');
const data = validateDataModule(preview);
const prepare = () => prepareGame({environment:'node',data:[...game.bundle.modules,data],
 profile:{...game.bundle.profile,modules:[...game.bundle.profile.modules,{id:data.manifest.id,version:data.manifest.version}]},
 universeKey:'space-sim.successor-field-preview/successor-field-v2',systemId:'primus-field-system'});
let prepared:ReturnType<typeof prepare>;
beforeAll(()=>{ prepared=prepare(); });
afterAll(()=>{ prepared.candidate.dispose(); });
describe('opt-in generated Primus playtest',()=>{
 it('keeps the legacy module/profile/selection separate and approved handling unchanged',()=>{
  expect(game.bundle.modules.some(m=>m.manifest.id===data.manifest.id)).toBe(false);
  expect(game.bundle.profile.modules.some(m=>m.id===data.manifest.id)).toBe(false);
  expect(game.bundle.selection.universe).not.toContain('field');
  expect(prepared.world.context.vehicle).toEqual({acceleration:24,turnRate:.65,initialThrottle:.65,contactRadiusMetres:2.5});
  expect(prepared.world.surface('planet')!.planet!.definition.recipe).toBe('oceanic');
  expect(prepared.world.surface('moon')!.planet!.definition.recipe).toBe('rocky');
  expect(prepared.world.surface('moon')!.hasWater).toBe(false);
 });
 it('starts every authored scenario without a fault and saves the actual new universe',()=>{
  const world=prepared.world;
  for(const p of world.system.presets){const ship=world.spawn({ownerId:'proof',presetId:p.id});world.step();expect(world.ship(ship.id)!.fault,p.id).toBeUndefined();world.remove(ship.id);}
  expect(saveWorld(world).universe.id).toBe('successor-field-v2');
 });
 it('supports gentle entry, stable floating and the existing fast-entry crash policy',()=>{
  const world=prepared.world,ship=world.spawn({ownerId:'water',presetId:'gentle-splash'});
  let entered=false;for(let i=0;i<5;i++){world.step();entered ||= !!world.ship(ship.id)!.state.waterEntry;}let s=world.ship(ship.id)!.state;expect(s.status).toBe('flying');expect(s.water).toBe('submerged');expect(entered).toBe(true);
  world.respawn(ship.id,'already-floating');world.setControls(ship.id,IDLE);for(let i=0;i<30;i++)world.step();s=world.ship(ship.id)!.state;expect(s.status).toBe('landed');expect(s.water).toBe('floating');
  const radius=Math.hypot(s.position.x,s.position.y);expect(radius).toBeCloseTo(world.surface('planet')!.seaRadiusMetres!,1);
  world.respawn(ship.id,'heavy-splash');for(let i=0;i<5;i++)world.step();expect(world.ship(ship.id)!.state.status).toBe('crashed');world.remove(ship.id);
 });
 it('retains submerged rock in demand and separates ground and contact envelopes',()=>{
  const profile=prepared.world.surface('planet')!,bounds=profile.groundBounds!;
  expect(bounds.minRadius).toBeLessThan(profile.bounds.minRadius);expect(Object.isFrozen(bounds)).toBe(true);
  let index=0;for(let i=1;i<profile.sampleCount;i++)if(profile.sampleElevation(i)<profile.sampleElevation(index))index=i;
  const a=index*2*Math.PI/profile.sampleCount,r=profile.referenceRadius+profile.sampleElevation(index),camera={center:{x:r*Math.cos(a),y:r*Math.sin(a)},rotation:Math.PI/2-a,scale:100};
  expect(localSurfaceInView(profile,{x:0,y:0},camera,640,480)).toBe(true);
  const d=new TileDemand();d.update(profile,{x:0,y:0},0,camera,640,480);expect(d.overflow).toBe(false);expect(d.count).toBeGreaterThan(0);
  const body={id:'planet',name:'Primus',position:{x:0,y:0},radius:2048,surface:profile};
  for(const terrain of[glTerrain,canvasTerrain]){const geometry=terrain(body,camera,640,480,{querySurface});expect(geometry.boundary.length).toBeGreaterThan(1);expect(geometry.faces.some(f=>f.color[0]>f.color[2])).toBe(true);}
 });
});
