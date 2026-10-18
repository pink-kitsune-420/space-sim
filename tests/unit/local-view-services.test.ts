import guide from '../../modules/local-views/docs/creators/usage.json';
import { describe, expect, it } from 'vitest';
import { VIEW_CAMERAS, type Camera, type LocalCameraFactory, type LocalCameraInput, type LocalViewCamera, type ManifestV2, type ModuleProfileV2 } from '../../packages/game-api/src/index';
import { createLocalViews } from '../../modules/local-views/src/index';
import initialize from '../../modules/local-views/src/index';
import descriptor from '../../modules/local-views/module.json';
import { ModuleRegistryV2, moduleAssets } from '../../packages/game-runtime/src/modules-v2';
import { LocalPilotRegistry } from '../../modules/local-pilots/src/index';

function cameras() {
  const instances: (LocalViewCamera & { zoom: number; closed: number })[] = [];
  const factory: LocalCameraFactory = { create(viewportId) {
    let targetId: string | undefined;
    const camera = { viewportId, get targetId() { return targetId; }, mode: 'follow' as const, zoom: 1, closed: 0,
      focus(target: string | undefined) { targetId = target; }, changeZoom(factor: number) { this.zoom *= factor; },
      frame(input: LocalCameraInput): Camera { return { center: targetId ? input.transform(targetId)?.position ?? { x: 0, y: 0 } : { x: 0, y: 0 }, rotation: 0, scale: this.zoom }; },
      dispose() { this.closed++; } };
    instances.push(camera); return camera;
  } }; return { factory, instances };
}
describe('portable local view services', () => {
  it.each([1, 2, 3, 4])('preserves independent target/zoom state across %i views and releases all surfaces', count => {
    const camera = cameras(), draws: { viewport: string; camera: Camera }[] = [], closed: string[] = [];
    const views = createLocalViews(camera.factory, { bindings: Array.from({ length: count }, (_, i) => ({ viewportId: `view-${i}`, seatId: `seat-${i}`, playerId: `player-${i}`, targetId: `target-${i}` })), layout: 'auto', mode: 'split',
      surface(binding) { return { resize() {}, draw(camera) { draws.push({ viewport: binding.viewportId, camera }); }, dispose() { closed.push(binding.viewportId); } }; } });
    views.reflow(1000, 600); views.camera('view-0').changeZoom(2);
    views.render(.01, id => ({ position: { x: Number(id.slice(7)), y: 0 }, orientation: 0 }));
    expect(draws.length).toBe(count); expect(draws[0]!.camera.scale).toBe(2);
    for (let i = 1; i < count; i++) { expect(draws[i]!.camera.scale).toBe(1); expect(draws[i]!.camera.center.x).toBe(i); }
    expect(views.splitActive).toBe(count > 1); views.dispose(); views.dispose();
    expect(closed.length).toBe(count); expect(camera.instances.map(c => c.closed)).toEqual(Array(count).fill(1));
  });
  it('distinguishes connected support from active splitting and preserves hidden cameras on reflow', () => {
    const camera = cameras(); const visible = new Map<string, boolean>();
    const views = createLocalViews(camera.factory, { bindings: [{ viewportId: 'main', seatId: 'seat-a' }, { viewportId: 'guest', seatId: 'seat-b' }], layout: 'auto', mode: 'dynamic',
      surface(binding) { return { resize(_rect, _w, _h, show) { visible.set(binding.viewportId, show); }, draw() {}, dispose() {} }; } });
    expect(() => views.render(.01, () => undefined)).toThrow('Reflow');
    views.reflow(800, 600); expect(views.count).toBe(2); expect(views.splitActive).toBe(false); expect(visible.get('guest')).toBe(false);
    views.camera('guest').changeZoom(3); views.reflow(600, 800, new Set([1])); expect(views.splitActive).toBe(true);
    views.reflow(800, 600); expect(views.splitActive).toBe(false); expect(camera.instances[1]!.zoom).toBe(3); views.dispose();
  });
  it('rejects a required missing camera and recovers with a compatible provider', () => {
    const manifest = descriptor.manifest as ManifestV2, registry = new ModuleRegistryV2(); registry.register({ manifest, initialize }, moduleAssets(new Map([['docs/creators/usage.json', new TextEncoder().encode(JSON.stringify(guide))]])));
    const profile: ModuleProfileV2 = { format: 'space-sim-profile/2', id: 'test.views', modules: [{ id: manifest.id, version: manifest.version }], providers: { 'view.local': manifest.id }, capabilities: {}, settings: {} };
    expect(() => registry.prepare(profile, 'browser')).toThrow('view.camera');
    registry.register({ manifest: { ...manifest, id: 'fixture.camera', requires: [], slots: ['view.camera'], provides: [{ name: 'view.camera', version: '1.0.0' }] }, initialize(c) { c.provide(VIEW_CAMERAS, cameras().factory); } });
    const recovered = registry.prepare({ ...profile, modules: [...profile.modules, { id: 'fixture.camera', version: manifest.version }], providers: { ...profile.providers, 'view.camera': 'fixture.camera' } }, 'browser');
    expect(recovered.available).toBe(true); recovered.dispose();
  });
});
describe('portable local pilots', () => {
  it('borrows session identity, releases before assignment and enforces active seat bounds', () => {
    const changes: string[] = [], registry = new LocalPilotRegistry({ count: () => 4, playerId: seat => `session-${seat + 10}`,
      assign(pilot, device) { changes.push(`${pilot}:${device}`); }, release(pilot) { changes.push(`release:${pilot ?? 'all'}`); } });
    expect(registry.playerId(3)).toBe('session-13'); registry.assign(2, 'pad:1');
    expect(changes).toEqual(['release:all', '2:pad:1']); expect(() => registry.assign(2, 'auto')).toThrow('Unsupported');
    expect(() => registry.playerId(4)).toThrow('not active'); registry.dispose(); registry.dispose();
    expect(() => registry.assign(0, 'keyboard')).toThrow('disposed'); expect(changes.at(-1)).toBe('release:all');
  });
});
