import { describe, expect, it } from 'vitest';
import type { ModuleProfile, RegisteredModule } from '../../packages/game-api/src/index';
import { createPresentationRegistry, DEFAULT_PRESENTATION_PROFILE } from '../../packages/modules/src/browser';
import { createBuiltinRegistry, prepareGame } from '../../packages/modules/src/index';
import { validatePackage, type GamePackage } from '../../packages/game-library/src/archive';
import { presentationPreferenceKey, presentationRoots, selectPresentationProfile } from '../../apps/web/src/presentation-profile';
import { bundledGames, bundledGameDefinition, bundledGameAdapters, defaultGame, requestedBuiltinGame } from '../../apps/web/src/bundled-games';
import flightStarter from '../../games/flight-starter/game.json' with { type: 'json' };
import spaceSim from '../../games/space-sim/game.json' with { type: 'json' };

const starter = validatePackage(flightStarter) as GamePackage;
const originalGame = validatePackage(spaceSim) as GamePackage;

describe('manifest presentation composition', () => {
  it('selects bundled startup manifests by ID without a per-game startup branch', () => {
    expect(requestedBuiltinGame('?game=flight-starter')).toEqual(starter);
    expect(requestedBuiltinGame('?game=builtin.flight-starter')).toEqual(starter);
    expect(requestedBuiltinGame('?game=orbit-sandbox').info.id).toBe('builtin.orbit-sandbox');
    expect(requestedBuiltinGame('')).toBe(defaultGame);
    expect(requestedBuiltinGame('?game=https://example.com/game.json')).toBe(defaultGame);
    expect(new Set(bundledGames.map(game => game.info.id)).size).toBe(bundledGames.length);
  });
  it('pins non-flight host adapters to exact bundled definitions across archive-shaped round trips', () => {
    for (const id of ['planet-viewer', 'survey-fixture']) {
      const game = requestedBuiltinGame(`?game=${id}`);
      expect(bundledGameAdapters.get(game.info.id)).toMatch(/static-viewer|bounded-survey/);
      expect(bundledGameDefinition(JSON.parse(JSON.stringify(game)))).toBe(game);
      expect(bundledGameDefinition({ ...game, info: { ...game.info, description: 'Edited host claim' } })).toBeUndefined();
    }
  });
  it('boots the flight starter with no sound or other instruments and the same flight identity', () => {
    const profile = starter.bundle.presentation!, registry = createPresentationRegistry();
    const selection = selectPresentationProfile(profile, registry, presentationRoots(profile, registry));
    expect(selection).toEqual(profile);
    expect(registry.resolve(selection, 'offline', ['renderer']).order).toEqual(['builtin.canvas', 'builtin.navball']);
    createBuiltinRegistry().resolve(starter.bundle.profile, 'node', ['motion', 'content']);
    const world = prepareGame({ environment: 'node', profile: starter.bundle.profile, universeKey: starter.bundle.selection.universe });
    const original = prepareGame({ environment: 'node', profile: originalGame.bundle.profile, universeKey: originalGame.bundle.selection.universe });
    try { expect(world.world.simulationFingerprint).toBe(original.world.simulationFingerprint); }
    finally { world.candidate.dispose(); original.candidate.dispose(); }
  });

  it('removes dependency libraries with their last user and retains newly added default modules', () => {
    const registry = createPresentationRegistry(), roots = presentationRoots(DEFAULT_PRESENTATION_PROFILE, registry);
    expect(roots.map(ref => ref.id)).not.toContain('builtin.flight-data');
    const onlyAudio = roots.filter(ref => ref.id === 'builtin.audio');
    expect(selectPresentationProfile(DEFAULT_PRESENTATION_PROFILE, registry, onlyAudio).modules.map(ref => ref.id))
      .toEqual(['builtin.webgl', 'builtin.canvas', 'builtin.audio']);
    expect(registry.resolve(selectPresentationProfile(DEFAULT_PRESENTATION_PROFILE, registry, roots), 'browser', ['renderer']))
      .toEqual(registry.resolve(DEFAULT_PRESENTATION_PROFILE, 'browser', ['renderer']));
  });

  it('retains a game\'s renderer and settings when adding a module and its dependencies', () => {
    const registry = createPresentationRegistry(), profile = starter.bundle.presentation!;
    const explicit = [...presentationRoots(profile, registry), { id: 'builtin.telemetry', version: '0.1.0' }];
    const next = selectPresentationProfile(profile, registry, explicit);
    expect(next.modules.map(ref => ref.id)).toEqual(['builtin.canvas', 'builtin.flight-data', 'builtin.navball', 'builtin.telemetry']);
    expect(next.providers).toEqual({ renderer: 'builtin.canvas' });
    expect(next.settings).toEqual(profile.settings);
    registry.resolve(next, 'browser', ['renderer']);
    const bare = selectPresentationProfile(next, registry, []);
    expect(bare.modules).toEqual([{ id: 'builtin.canvas', version: '0.1.0' }]);
    expect(bare.settings).toEqual({});
    expect(profile.settings['builtin.navball']).toEqual({ frame: 1, orientation: 1 });
  });

  it('preserves replaceable providers and their settings without initializing them during selection', () => {
    let initialized = 0;
    const module: RegisteredModule = {
      manifest: { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'test.sound', name: 'Other sound',
        version: '2.0.0', kind: 'provider', authority: 'presentation', environments: ['browser', 'offline'], dependencies: [],
        provides: ['audio'], requires: [], slots: ['audio'], before: [], after: [], license: 'MIT',
        settings: { volume: { type: 'number', default: 1, minimum: 0, maximum: 1 } } },
      initialize() { initialized++; },
    };
    const registry = createPresentationRegistry([module]);
    const profile: ModuleProfile = { ...starter.bundle.presentation!, modules: [...starter.bundle.presentation!.modules, { id: 'test.sound', version: '2.0.0' }],
      providers: { renderer: 'builtin.canvas', audio: 'test.sound' }, settings: { 'test.sound': { volume: .2 } } };
    const next = selectPresentationProfile(profile, registry, presentationRoots(profile, registry));
    expect(next).toEqual(profile);
    registry.resolve(next, 'browser', ['renderer']);
    expect(initialized).toBe(0);
    const muted = selectPresentationProfile(next, registry, next.modules.filter(ref => ref.id === 'builtin.navball'), undefined, { audio: undefined });
    expect(muted.providers).toEqual({ renderer: 'builtin.canvas' });
    expect(muted.settings).toEqual({});
  });

  it('honors exact module versions and adds another renderer only on explicit selection', () => {
    const registry = createPresentationRegistry(), profile = starter.bundle.presentation!;
    expect(() => selectPresentationProfile(profile, registry, [{ id: 'builtin.navball', version: '9.0.0' }])).toThrow('exact version');
    const next = selectPresentationProfile(profile, registry, presentationRoots(profile, registry), 'builtin.webgl');
    expect(next.providers.renderer).toBe('builtin.webgl');
    expect(next.modules.map(ref => ref.id)).toEqual(['builtin.canvas', 'builtin.navball', 'builtin.webgl']);
    expect(() => selectPresentationProfile(profile, registry, [], 'builtin.navball')).toThrow('no installed renderer');
  });

  it('preserves existing viewer preferences and keeps other games in their own namespace', () => {
    expect(presentationPreferenceKey('builtin.space-sim')).toBe('space-sim.presentation/1');
    expect(presentationPreferenceKey(starter.info.id)).not.toBe(presentationPreferenceKey('builtin.space-sim'));
  });
});
