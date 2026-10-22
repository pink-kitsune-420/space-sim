import { beforeAll, describe, expect, it, vi, afterEach } from 'vitest';
import preview from '../../games/space-sim-successor/planet-preview.json';
import { createPlanetBake, type PlanetBakeResult, type PlanetSurfaceDefinition } from '../../packages/game-api/src/index';
import { bakePlanetSurface, planetDefinitionForSamples, PLANET_SURFACE_MAP } from '../../packages/sim-core/src/planet-surface';
import { surfaceFromPlanetBake, generateSurface, surfaceIdentity, querySurface } from '../../packages/sim-core/src/surface';
import { buildOverview, overviewWork } from '../../apps/web/src/successor-overview';
import { MATERIAL_DOMAINS } from '../../apps/web/src/successor-materials';
import { encodeStarterProducts, decodeStarterProducts, STARTER_PRODUCT_FORMAT, type StarterProduct } from '../../apps/web/src/starter-product-format';
import { prepareStarterWorlds } from '../../apps/web/src/starter-products';
import { requestedBuiltinGame } from '../../apps/web/src/bundled-games';
import { prepareGame, validateDataModule, loadInstalledWorld } from '../../packages/modules/src/index';
import { saveWorld } from '../../packages/sim-core/src/save';
import { canonicalJson } from '../../packages/game-runtime/src/authoritative';
const body = preview.data.universes[0]!.definition.systems[0]!.bodies.find(b => b.id === 'planet')!;
const definition = { id: 'planet' as const, radius: body.radius, surface: body.surface as PlanetSurfaceDefinition };
let bake: PlanetBakeResult;
let encoded: ReturnType<typeof encodeStarterProducts>;
let product: StarterProduct;
const equalBytes = (a: ArrayBufferView, b: ArrayBufferView) => expect(Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))).toBe(true);
beforeAll(() => {
  bake = bakePlanetSurface(definition.surface);
  const profile = generateSurface(definition);
  encoded = encodeStarterProducts({ physical: bake, overview: buildOverview(profile, MATERIAL_DOMAINS.planet) });
  product = { format: STARTER_PRODUCT_FORMAT, bodyId: 'planet', surfaceIdentity: surfaceIdentity(definition), sourceIdentity: 'a'.repeat(64),
    bytes: encoded.bytes.length, compressedBytes: 1, digest: 'b'.repeat(64), rawDigest: 'c'.repeat(64), path: 'starter-products/planet-0000000000000000.bin', tree: encoded.tree };
});
afterEach(() => vi.unstubAllGlobals());

describe('prepared starter products', () => {
  it('round trips every physical/map byte and reconstructs unchanged polar-linear contact', () => {
    const decoded = decodeStarterProducts(product, encoded.bytes), restored = surfaceFromPlanetBake(definition, decoded.physical), canonical = generateSurface(definition);
    equalBytes(decoded.physical.equator, bake.equator);
    equalBytes(decoded.physical.map.elevations, bake.map.elevations);
    equalBytes(decoded.physical.map.attributes, bake.map.attributes);
    equalBytes(decoded.physical.map.waterMask, bake.map.waterMask);
    const expected = buildOverview(canonical, MATERIAL_DOMAINS.planet);
    equalBytes(decoded.overview.planet!.rgba, expected.planet!.rgba);
    equalBytes(decoded.overview.planet!.equator, expected.planet!.equator);
    equalBytes(decoded.overview.surface!.samples, expected.surface!.samples);
    expected.levels.forEach((l, i) => equalBytes(l.rgba, decoded.overview.levels[i]!.rgba));
    expect(restored.identity).toBe(canonical.identity); expect(restored.bounds).toEqual(canonical.bounds);
    expect(restored.groundBounds).toEqual(canonical.groundBounds); expect(restored.seaRadiusMetres).toBe(2051.09375);
    for (const angle of [0, .1, 1.8652254254248182, 4.955908430461535, 2 * Math.PI - 1e-12]) expect(querySurface(restored, angle)).toEqual(querySurface(canonical, angle));
    decoded.physical.equator.fill(-999); expect(restored.sampleElevation(0)).toBe(canonical.sampleElevation(0));
  });
  it('accepts the same field after canonical JSON key ordering used by saved worlds', () => {
    const reordered = JSON.parse(canonicalJson(definition.surface)) as PlanetSurfaceDefinition;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(definition.surface));
    expect(surfaceIdentity({ ...definition, surface: reordered })).toBe(surfaceIdentity(definition));
    const profile = surfaceFromPlanetBake({ ...definition, surface: reordered }, bake);
    expect(profile.identity).toBe(surfaceIdentity(definition));
    expect(profile.sampleElevation(0)).toBe(bake.equator[0]);
  });
  it('rejects version/size/layout/finite-value violations before accepting arrays', () => {
    expect(() => decodeStarterProducts({ ...product, format: 'old' as never }, encoded.bytes)).toThrow('size/version');
    expect(() => decodeStarterProducts({ ...product, bytes: 32 * 1024 * 1024 }, encoded.bytes)).toThrow('size/version');
    for (const desc of [ {array:'Float64Array',offset:0,length:1e9}, {array:'Uint8Array',offset:-8,length:4}, {array:'Function',offset:0,length:4},
      [{array:'Uint8Array',offset:0,length:16},{array:'Float64Array',offset:8,length:2}] ]) {
      expect(() => decodeStarterProducts({ ...product, tree: desc }, encoded.bytes)).toThrow('layout');
    }
    const bytes = encoded.bytes.slice();new DataView(bytes.buffer).setFloat64(0, NaN, true);
    expect(() => decodeStarterProducts(product, bytes)).toThrow('Non-finite');
  });
  it('rejects stale recipe/options/pad identities, and retains exact locks and save restoration', () => {
    const data = validateDataModule(preview), game = requestedBuiltinGame('?game=space-sim-successor');
    const options = { environment: 'node' as const, id: 'starter-proof', data: [...game.bundle.modules, data],
      profile: { ...game.bundle.profile, modules: [...game.bundle.profile.modules, { id: data.manifest.id, version: data.manifest.version }] },
      universeKey: `${data.manifest.id}/successor-field-v2`, systemId: 'primus-field-system' };
    expect(() => surfaceFromPlanetBake({ ...definition, surface: { ...definition.surface, hillWavelengthMetres: 100 } }, bake)).toThrow('match');
    expect(() => surfaceFromPlanetBake(definition, { ...bake, options: { ...bake.options, orientationRadians: 1 } })).toThrow('match');
    const physical = surfaceFromPlanetBake(definition, bake), profiles = new Map([['planet', physical]]);
    const a = prepareGame(options), b = prepareGame({ ...options, derivedPlanets: profiles });
    try {
      expect(b.world.surface('planet')).toBe(physical); expect(b.world.lock).toEqual(a.world.lock); expect(b.world.simulationFingerprint).toBe(a.world.simulationFingerprint);
      for (const world of [a.world, b.world]) { world.spawn({ownerId:'proof',presetId:'already-floating'}); for(let i=0;i<100;i++)world.step(); }
      const state = (w: typeof a.world) => {const {savedAt,...rest}=saveWorld(w);return rest};
      expect(state(b.world)).toEqual(state(a.world));
      const loaded = loadInstalledWorld(saveWorld(b.world), { environment:'node',data:options.data,derivedPlanets:profiles });
      try { expect(loaded.world.surface('planet')).toBe(physical); expect(state(loaded.world)).toEqual(state(b.world)); } finally { loaded.world.dispose(); }
    } finally { a.candidate.dispose(); b.candidate.dispose(); }
  });
  it('uses identical samples with cooperative field/map work and aborts abandoned preparation', async () => {
    const job = createPlanetBake(planetDefinitionForSamples(definition.surface), { ...PLANET_SURFACE_MAP, equatorSamples:8192,orientationRadians:0 });
    while(job.status==='pending')job.step(256); const result=job.takeResult(); equalBytes(result.equator,bake.equator);equalBytes(result.map.elevations,bake.map.elevations);
    const profile=surfaceFromPlanetBake(definition,result),work=overviewWork(profile,MATERIAL_DOMAINS.planet);let step=work.next(),yields=0;
    while(!step.done){yields++;step=work.next()}expect(yields).toBeGreaterThan(100);equalBytes(step.value.planet!.rgba,buildOverview(profile,MATERIAL_DOMAINS.planet).planet!.rgba);
    vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(performance.now());return 0});
    const controller=new AbortController();
    await expect(prepareStarterWorlds([definition],[],controller.signal,()=>controller.abort(new Error('superseded')))).rejects.toThrow('superseded');
    const stages:string[]=[];
    const custom={...definition,surface:{...definition.surface,seed:742}};
    const prepared=await prepareStarterWorlds([custom],[],new AbortController().signal,p=>stages.push(p.stage));
    const canonical=generateSurface(custom);expect(prepared.sources[0]!.source).toBe('generated');
    expect(prepared.profiles.get('planet')!.identity).toBe(canonical.identity);expect(stages).toContain('Drawing Primus');
    for(const angle of [0,1,2,3,4,5])expect(querySurface(prepared.profiles.get('planet')!,angle)).toEqual(querySurface(canonical,angle));
  });
});
