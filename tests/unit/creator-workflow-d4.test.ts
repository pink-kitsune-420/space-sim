import { describe, expect, it, beforeAll } from 'vitest';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { packageContracts, newModule, buildPortableModule } from '../../packages/module-tools/package.mjs';
import { checkSource } from '../../packages/module-tools/check-boundaries.mjs';
import { loadCodeModuleV2 } from '../../packages/game-runtime/src/loader';
import { ModuleRegistryV2, moduleAssets } from '../../packages/game-runtime/src/modules-v2';
import { PresentationHooks } from '../../packages/game-runtime/src/presentation';
import type { HostServiceAccess, ModuleProfileV2, PresentationView, ManifestV2 } from '../../packages/game-api/src/index';

describe('Feature F29 Deliverable 4 (D4): End-to-End Creator Workflow Verification', () => {
  const scratchDir = '/tmp/creator-workflow-exercise';
  const gaugeDir = `${scratchDir}/example-gauge`;
  const archivePath = `${scratchDir}/community-altitude-gauge.spacemod`;
  const sourcePath = `${gaugeDir}/src/index.ts`;

  beforeAll(async () => {
    if (!existsSync(archivePath)) {
      await mkdir(scratchDir, { recursive: true });
      if (!existsSync(gaugeDir)) {
        await newModule('community.altitude-gauge', gaugeDir);
      }
      const manifest = {
        format: 'space-sim-module/2',
        apiVersion: 'space-sim-game-api/2',
        id: 'community.altitude-gauge',
        name: 'Altitude Warning Gauge',
        version: '0.1.0',
        kind: 'provider',
        tier: 'presentation',
        environments: ['browser', 'offline', 'node'],
        dependencies: [],
        conflicts: [],
        provides: [{ name: 'hud.altitude-gauge', version: '1.0.0' }],
        requires: [{ name: 'core.motion', version: '^1.0.0', optional: true }],
        slots: ['hud.altitude-gauge'],
        before: [],
        after: [],
        settings: {
          warningAltitude: {
            type: 'number',
            default: 200,
            minimum: 10,
            maximum: 5000,
            step: 10,
            label: 'Warning altitude (m)',
            description: 'Altitude below which the warning banner and caution gauge are active.',
          },
        },
        license: 'MIT',
      };
      const descriptor = {
        format: 'spacelab-module-package/1',
        manifest,
        entry: 'src/index.ts',
        compatibility: { deterministic: true, multiplayer: true },
        assets: [],
        data: [],
        guides: ['docs/creators/usage.json'],
        inputs: [],
        sourceStatus: 'included',
      };
      await writeFile(`${gaugeDir}/module.json`, JSON.stringify(descriptor, null, 2) + '\n');
      await writeFile(`${gaugeDir}/NOTICE`, 'Module community.altitude-gauge, licensed under MIT by Creator Test.\nPublic game-api inputs: Space Sim contributors, MIT (LICENSE).\n');
      await mkdir(`${gaugeDir}/docs/creators`, { recursive: true });
      const guideDoc = {
        id: 'usage',
        audience: 'creators',
        title: 'Altitude Warning Gauge',
        summary: 'Visual HUD layer rendering dynamic altitude warnings and telemetry panels.',
        blocks: [
          { type: 'heading', text: 'What it does' },
          { type: 'paragraph', text: 'Renders dynamic altitude warnings.' },
          { type: 'heading', text: 'Provides and requires' },
          { type: 'list', items: ['Provides hud.altitude-gauge@1.0.0.'] },
          { type: 'heading', text: 'Settings' },
          { type: 'list', items: ['warningAltitude: warning threshold.'] },
          { type: 'heading', text: 'Lifecycle' },
          { type: 'list', items: ['Synchronous init.'] },
          { type: 'heading', text: 'Remove or replace' },
          { type: 'paragraph', text: 'Presentation tier.' },
          { type: 'heading', text: 'Stability' },
          { type: 'paragraph', text: 'Pre-freeze.' },
          { type: 'heading', text: 'Example' },
          { type: 'code', text: 'node packages/module-tools/package.mjs build' },
          { type: 'heading', text: 'Related' },
          { type: 'link', text: 'Modules', page: 'modules' },
        ],
      };
      await writeFile(`${gaugeDir}/docs/creators/usage.json`, JSON.stringify(guideDoc, null, 2) + '\n');
      const sourceCode = `import { CORE_MOTION, type CoreMotion, type ModuleInitializationV2, type LayerHook, type PanelHook, type PresentationView, type OverlayPrimitive, type PanelRow, type ServiceKey } from '@space-sim/game-api';
export interface AltitudeGaugeService { readonly warningAltitude: number; isLowAltitude(c: number | null): boolean; }
export const ALTITUDE_GAUGE: ServiceKey<AltitudeGaugeService> = Object.freeze({ slot: 'hud.altitude-gauge', version: '1.0.0' });
export function createAltitudeLayer(w: number, m?: CoreMotion): LayerHook {
  return {
    name: 'altitude-warning', label: 'Altitude Warning',
    draw(view: PresentationView): readonly OverlayPrimitive[] {
      if (view.groundClearance === null || !view.ship) return [];
      const alt = view.groundClearance, cx = view.viewport.width / 2;
      if (alt < w) {
        return [
          { kind: 'line', space: 'screen', color: '#ff3333', closed: true, width: 2, points: [{ x: cx - 100, y: 20 }, { x: cx + 100, y: 20 }, { x: cx + 100, y: 80 }, { x: cx - 100, y: 80 }] },
          { kind: 'circle', space: 'screen', center: { x: cx - 80, y: 50 }, radius: 10, color: '#ff2222', fill: true },
          { kind: 'text', space: 'screen', at: { x: cx, y: 44 }, text: 'TERRAIN CAUTION', color: '#ff3333', align: 'center' },
          { kind: 'text', space: 'screen', at: { x: cx, y: 68 }, text: \`ALT: \${Math.round(alt)} m\`, color: '#ffaa00', align: 'center' }
        ];
      }
      return [{ kind: 'text', space: 'screen', at: { x: cx, y: 30 }, text: \`RADAR ALT: \${Math.round(alt)} m\`, color: '#00e5ff', align: 'center' }];
    }
  };
}
export function createAltitudePanel(w: number, m?: CoreMotion): PanelHook {
  return {
    name: 'altitude-status', title: 'Altitude Gauge',
    update(view: PresentationView): readonly PanelRow[] {
      const alt = view.groundClearance, isW = alt !== null && alt < w;
      return [
        { label: 'Ground Clearance', value: alt !== null ? \`\${Math.round(alt)}\` : 'N/A', unit: 'm' },
        { label: 'Warning Threshold', value: \`\${w}\`, unit: 'm' },
        { label: 'Speed', value: view.ship ? \`\${Math.round(m ? m.magnitude(view.ship.state.velocity) : Math.hypot(view.ship.state.velocity.x, view.ship.state.velocity.y))}\` : '0', unit: 'm/s' },
        { label: 'Status', value: isW ? 'WARNING' : 'CLEAR' }
      ];
    }
  };
}
export default function initialize(c: ModuleInitializationV2): void {
  const w = c.settings.warningAltitude ?? 200, m = c.tryUse(CORE_MOTION);
  c.contributeGuide({ id: 'usage', audience: 'creators', title: 'Altitude Warning Gauge', summary: 'Visual HUD layer rendering dynamic altitude warnings and telemetry panels.', asset: 'docs/creators/usage.json' });
  c.contributeLayer(createAltitudeLayer(w, m));
  c.contributePanel(createAltitudePanel(w, m));
  c.provide(ALTITUDE_GAUGE, { warningAltitude: w, isLowAltitude: clearance => clearance !== null && clearance < w });
}
`;
      await writeFile(sourcePath, sourceCode);
      await buildPortableModule(`${gaugeDir}/module.json`, archivePath);
    }
  });

  it('strictly restricts module imports to @space-sim/game-api without private engine paths', async () => {
    const source = await readFile(sourcePath, 'utf8');
    const errors = checkSource(source, 'examples/packages/example-gauge/src/index.ts');
    expect(errors).toEqual([]);
  });

  it('decodes and validates the compiled .spacemod archive package structure', async () => {
    const kit = await packageContracts();
    const bytes = new Uint8Array(await readFile(archivePath));
    const decoded = await kit.decodeModulePackage(bytes);
    const manifest = decoded.descriptor.manifest as ManifestV2;

    expect(manifest.id).toBe('community.altitude-gauge');
    expect(manifest.format).toBe('space-sim-module/2');
    expect(manifest.apiVersion).toBe('space-sim-game-api/2');
    expect(manifest.tier).toBe('presentation');
    expect(manifest.provides).toEqual([
      { name: 'hud.altitude-gauge', version: '1.0.0' },
    ]);
    expect(manifest.requires).toEqual([
      { name: 'core.motion', version: '^1.0.0', optional: true },
    ]);
    expect(manifest.settings?.warningAltitude).toMatchObject({
      type: 'number',
      default: 200,
      minimum: 10,
      maximum: 5000,
      step: 10,
    });
  });

  it('resolves in topological lock order, initializes synchronously and executes presentation hooks', async () => {
    const kit = await packageContracts();
    const bytes = new Uint8Array(await readFile(archivePath));
    const decoded = await kit.decodeModulePackage(bytes);
    const manifest = decoded.descriptor.manifest as ManifestV2;
    const files = decoded.files;
    const integrity = kit.parsePackageJson(kit.requiredFile(files, 'integrity.json'), 'integrity.json') as { digest: string };
    const source = new TextDecoder('utf-8').decode(kit.requiredFile(files, 'dist/module.js'));

    const registered = loadCodeModuleV2(
      {
        manifest,
        digest: integrity.digest,
        source,
        supportsMultiplayer: true,
      },
      {
        allowRuntimeCode: true,
        approvedDigests: new Set([integrity.digest]),
        environment: 'node',
      }
    );

    const mockCoreMotion = {
      magnitude: (v: { x: number; y: number }) => Math.hypot(v.x, v.y),
      normalizeAngle: (r: number) => r,
      services: {},
    };
    const hostServices: readonly HostServiceAccess[] = [
      {
        key: { slot: 'core.motion', version: '1.0.0' },
        service: mockCoreMotion,
        tiers: ['authoritative', 'presentation', 'platform', 'network'],
        environments: ['browser', 'offline', 'node'],
      },
    ];

    const registry = new ModuleRegistryV2(hostServices);
    registry.register(registered, moduleAssets(files));

    const profile: ModuleProfileV2 = {
      format: 'space-sim-profile/2',
      id: 'test.profile',
      modules: [{ id: 'community.altitude-gauge', version: '0.1.0' }],
      providers: { 'hud.altitude-gauge': 'community.altitude-gauge' },
      capabilities: {},
      settings: {
        'community.altitude-gauge': { warningAltitude: 300 },
      },
    };

    const lock = registry.resolve(profile, 'node', ['hud.altitude-gauge']);
    expect(lock.order).toContain('community.altitude-gauge');
    expect(lock.providers['hud.altitude-gauge']).toBe('community.altitude-gauge');
    expect(lock.settings['community.altitude-gauge']?.warningAltitude).toBe(300);

    const candidate = registry.prepare(profile, 'node', ['hud.altitude-gauge']);

    // Verify contributed guide document
    const guideRaw = candidate.guideDocuments.get('community.altitude-gauge/usage');
    expect(guideRaw).toBeDefined();
    const guide = JSON.parse(guideRaw!);
    expect(guide.title).toBe('Altitude Warning Gauge');
    expect(guide.summary).toBe('Visual HUD layer rendering dynamic altitude warnings and telemetry panels.');
    expect(guide.blocks.some((b: any) => b.type === 'heading' && b.text === 'What it does')).toBe(true);

    // Verify presentation contributions
    expect(candidate.core.layers.map(l => l.id)).toEqual(['community.altitude-gauge/altitude-warning']);
    expect(candidate.core.panels.map(p => p.id)).toEqual(['community.altitude-gauge/altitude-status']);

    const hooks = new PresentationHooks(candidate.core.layers, candidate.core.panels, []);

    const baseView: PresentationView = {
      time: 10.0,
      tick: 1000,
      paused: false,
      elapsed: 0.016,
      viewport: { width: 1280, height: 720, pixelRatio: 1 },
      body: { id: 'primus', name: 'Primus', radius: 512000, mu: 1.3e13, position: { x: 0, y: 0 } },
      vehicle: { acceleration: 125, turnRate: 1.2, initialThrottle: 0.5 },
      analyticOrbits: false,
      orbit: null,
      groundClearance: 1000,
      prediction: { status: 'none', samples: 0 },
      moduleState: {},
      camera: { center: { x: 0, y: 513000 }, rotation: 0, scale: 1 },
      ship: {
        id: 'ship-1',
        name: 'Vessel 01',
        bodyId: 'primus',
        state: { time: 10.0, position: { x: 0, y: 513000 }, velocity: { x: 140, y: 0 }, heading: 0, throttle: 0.5, status: 'flying', revision: 0 },
        controls: { turn: 0, throttle: 0.5, engine: true },
        position: { x: 0, y: 513000 },
      },
    };

    // Case 1: Normal altitude (1000m > 300m threshold)
    const normalOverlays = hooks.overlays(baseView);
    expect(normalOverlays).toHaveLength(1);
    expect((normalOverlays[0] as any).text).toContain('1000');

    const normalPanels = hooks.panelRows(baseView);
    expect(normalPanels).toHaveLength(1);
    expect(normalPanels[0]!.rows.find(r => r.label === 'Status')?.value).toBe('CLEAR');
    expect(normalPanels[0]!.rows.find(r => r.label === 'Speed')?.value).toBe('140');

    // Case 2: Low altitude (150m < 300m threshold)
    const lowAltView: PresentationView = {
      ...baseView,
      groundClearance: 150,
      ship: {
        ...baseView.ship!,
        state: { ...baseView.ship!.state, velocity: { x: 100, y: -50 } },
      },
    };

    const lowOverlays = hooks.overlays(lowAltView);
    expect(lowOverlays).toHaveLength(4);
    expect(lowOverlays.some(o => o.kind === 'text' && o.text === 'TERRAIN CAUTION')).toBe(true);

    const lowPanels = hooks.panelRows(lowAltView);
    expect(lowPanels[0]!.rows.find(r => r.label === 'Status')?.value).toBe('WARNING');
    expect(lowPanels[0]!.rows.find(r => r.label === 'Ground Clearance')?.value).toBe('150');

    candidate.dispose();
  });

  it('isolates presentation layer faults (thrown exceptions and oversized output > 256 primitives)', async () => {
    const kit = await packageContracts();
    const bytes = new Uint8Array(await readFile(archivePath));
    const decoded = await kit.decodeModulePackage(bytes);
    const manifest = decoded.descriptor.manifest as ManifestV2;
    const files = decoded.files;
    const integrity = kit.parsePackageJson(kit.requiredFile(files, 'integrity.json'), 'integrity.json') as { digest: string };
    const source = new TextDecoder('utf-8').decode(kit.requiredFile(files, 'dist/module.js'));

    const registered = loadCodeModuleV2(
      { manifest, digest: integrity.digest, source, supportsMultiplayer: true },
      { allowRuntimeCode: true, approvedDigests: new Set([integrity.digest]), environment: 'node' }
    );

    const registry = new ModuleRegistryV2([]);
    registry.register(registered, moduleAssets(files));

    const profile: ModuleProfileV2 = {
      format: 'space-sim-profile/2',
      id: 'test.profile',
      modules: [{ id: 'community.altitude-gauge', version: '0.1.0' }],
      providers: { 'hud.altitude-gauge': 'community.altitude-gauge' },
      capabilities: {},
      settings: { 'community.altitude-gauge': { warningAltitude: 200 } },
    };

    const candidate = registry.prepare(profile, 'node', ['hud.altitude-gauge']);

    let shouldThrow = false;
    let shouldExceedLimits = false;

    const faultyLayer = {
      moduleId: 'community.altitude-gauge',
      version: '0.1.0',
      id: 'community.altitude-gauge/faulty-extension',
      hook: {
        name: 'faulty-extension',
        label: 'Faulty Extension',
        draw() {
          if (shouldThrow) throw new Error('Uncaught rendering exception in presentation hook');
          if (shouldExceedLimits) {
            return Array.from({ length: 300 }, (_, i) => ({
              kind: 'text' as const,
              space: 'screen' as const,
              at: { x: i, y: i },
              text: `Primitive ${i}`,
              color: '#ffffff',
            }));
          }
          return [];
        },
      },
    };

    const testHooks = new PresentationHooks(
      [...candidate.core.layers, faultyLayer],
      candidate.core.panels,
      []
    );

    const view: PresentationView = {
      time: 1.0,
      tick: 100,
      paused: false,
      elapsed: 0.016,
      viewport: { width: 800, height: 600, pixelRatio: 1 },
      body: { id: 'p', name: 'P', radius: 1000, mu: 1000, position: { x: 0, y: 0 } },
      vehicle: { acceleration: 100, turnRate: 1.0, initialThrottle: 0 },
      analyticOrbits: false,
      orbit: null,
      groundClearance: 50,
      prediction: { status: 'none', samples: 0 },
      moduleState: {},
      camera: { center: { x: 0, y: 0 }, rotation: 0, scale: 1 },
      ship: {
        id: 's',
        name: 'S',
        bodyId: 'p',
        state: { time: 1.0, position: { x: 0, y: 1050 }, velocity: { x: 0, y: 0 }, heading: 0, throttle: 0, status: 'flying', revision: 0 },
        controls: { turn: 0, throttle: 0, engine: false },
        position: { x: 0, y: 1050 },
      },
    };

    // Sub-test A: Thrown error
    shouldThrow = true;
    shouldExceedLimits = false;
    const resA = testHooks.overlays(view);
    expect(resA).toHaveLength(4); // Healthy layer still drew 4 warning primitives
    expect(testHooks.enabled('community.altitude-gauge/faulty-extension')).toBe(false);
    expect(testHooks.enabled('community.altitude-gauge/altitude-warning')).toBe(true);
    expect(testHooks.faults[0]?.message).toContain('Uncaught rendering exception');

    // Sub-test B: Oversized limit (> 256 primitives)
    const testHooksB = new PresentationHooks(
      [...candidate.core.layers, faultyLayer],
      candidate.core.panels,
      []
    );
    shouldThrow = false;
    shouldExceedLimits = true;
    const resB = testHooksB.overlays(view);
    expect(resB).toHaveLength(4);
    expect(testHooksB.enabled('community.altitude-gauge/faulty-extension')).toBe(false);
    expect(testHooksB.faults[0]?.message).toContain('layers return at most 256 primitives');

    candidate.dispose();
  });
});
