import { CORE_THEME } from '../../packages/game-api/src/index';
import { getActiveTheme } from '../../packages/render-2d/src/theme';
import { ModuleRegistryV2 } from '../../packages/game-runtime/src/modules-v2';
import { BrowserModuleHost } from '../../apps/web/src/module-host';
import { DeviceModuleManager } from '../../apps/web/src/device-module-manager';
import { MemoryPackageStore } from '../../packages/game-runtime/src/package-store';
import { decodePackage } from '../../packages/game-library/src/archive';
import { LocalSession } from '../../apps/web/src/session';

export async function replacementLifecycle(bytes: number[]) {
  const game = await decodePackage(Uint8Array.from(bytes));
  if (game.format !== 'space-lab-game/1' || !game.runtime) throw new Error('Expected mixed game');
  let hold = false, unblock: (() => void) | undefined;
  class Store extends MemoryPackageStore {
    override async get(digest: string) {
      if (hold) { hold = false; await new Promise<void>(resolve => { unblock = resolve; }); }
      return super.get(digest);
    }
  }
  const store = new Store();
  let world: object = {}, session: LocalSession | undefined, published = 0;
  const empty = { format: 'space-sim-profile/2' as const, id: 'test.harness', modules: [], providers: {}, settings: {}, capabilities: {} };
  const manager = new DeviceModuleManager(store, { editable: () => true, world: () => world,
    base: () => ({ profile: empty, applied: empty, manifests: new Map() }), editBase() {}, async apply() {},
    pilots: { count: 1, playerId: () => session?.playerId, assign() {}, release() {} },
  });
  const replace = () => manager.loadWorldGame(game.runtime!, { profile: game.bundle.profile, data: game.bundle.modules }, prepared => {
    const next = new LocalSession(prepared.loaded.world, { name: 'Lifecycle pilot' });
    prepared.candidate.own({ dispose: () => next.host.dispose() });
    session?.dispose(); session = next; world = prepared.loaded.world; published++;
  });
  const waitForHold = async () => { while (!unblock) await new Promise(resolve => setTimeout(resolve, 0)); };
  try {
    await replace(); const originalWorld = world, applied = await manager.capture();
    hold = true; const cancelled = replace().then(() => false, () => true); await waitForHold();
    manager.root.querySelector<HTMLButtonElement>('#cancel-device-modules')!.click();
    unblock!(); unblock = undefined;
    const cancelledRejected = await cancelled;
    const cancellationPreserved = world === originalWorld && await manager.capture() === applied;
    hold = true; const superseded = replace().then(() => false, () => true); await waitForHold();
    await replace(); const latestWorld = world; unblock!(); unblock = undefined;
    const supersededRejected = await superseded;
    const latestPreserved = latestWorld === world && world !== originalWorld;
    const live = (globalThis as typeof globalThis & { phase2Live?: number }).phase2Live;
    return { cancelledRejected, cancellationPreserved, supersededRejected, latestPreserved, published, live };
  } finally { manager.clear(); session?.dispose(); }
}

/** Renderer services are explicitly unsupported until the renderer adapter/extraction. */
export async function rendererGate() {
  const registry = new ModuleRegistryV2();
  registry.register({ manifest: { format: 'space-sim-module/2', apiVersion: 'space-sim-game-api/2', id: 'test.renderer', name: 'Test renderer',
    version: '1.0.0', kind: 'provider', tier: 'presentation', environments: ['browser'], slots: ['renderer'], provides: [{ name: 'renderer', version: '1.0.0' }],
    requires: [], dependencies: [], conflicts: [], before: [], after: [], settings: {}, license: 'MIT' },
    initialize(context) { context.provide({ slot: 'renderer', version: '1.0.0' }, {}); },
  });
  const candidate = registry.prepare({ format: 'space-sim-profile/2', id: 'test.renderer-game', modules: [{ id: 'test.renderer', version: '1.0.0' }], providers: {}, capabilities: {}, settings: {} }, 'browser');
  const host = new BrowserModuleHost();
  try { host.configure(candidate); return 'silently accepted'; }
  catch (error) { return String(error); }
  finally { host.dispose(); candidate.dispose(); }
}

export async function themePublicationRollback() {
  const original = getActiveTheme().hudColor, host = new BrowserModuleHost();
  const registry = new ModuleRegistryV2(host.hostServices());
  registry.register({ manifest: { format: 'space-sim-module/2', apiVersion: 'space-sim-game-api/2', id: 'test.theme', name: 'Candidate theme',
    version: '1.0.0', kind: 'provider', tier: 'platform', environments: ['browser'], slots: [], provides: [],
    requires: [{ name: 'core.theme', version: '^1.0.0' }], dependencies: [], conflicts: [], before: [], after: [], settings: {}, license: 'MIT' },
    initialize(context) { context.use(CORE_THEME).set({ hudColor: '#123456' }); },
  });
  const candidate = registry.prepare({ format: 'space-sim-profile/2', id: 'test.theme-game', modules: [{ id: 'test.theme', version: '1.0.0' }], providers: {}, capabilities: {}, settings: {} }, 'browser');
  try {
    host.configure(candidate); host.activate(document.createElement('div'));
    const changed = getActiveTheme().hudColor === '#123456';
    host.dispose(); return changed && getActiveTheme().hudColor === original;
  } finally { host.dispose(); candidate.dispose(); }
}
