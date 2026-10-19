import { moduleVehicleArtwork } from './world-presentation';
import type { VehicleArtwork } from '../../../packages/game-api/src/index';
/** Browser adapters for portable prejoin wire policy: inert inspection, isolated candidates,
 * transactional local storage and optional required-client windows. */
import type { JoinClientPort, JoinOffer, JoinStage, PilotRegistry } from '../../../packages/game-api/src/index';
import { MemoryPackageStore, type StoredPackage } from '../../../packages/game-runtime/src/package-store';
import { ALLOW_RUNTIME_CODE } from '../../../packages/game-runtime/src/build-policy';
import { artifactModules } from '../../../packages/game-runtime/src/loader';
import { inspectJoinPack } from '../../../packages/game-library/src/join-pack';
import { installGamePackages, installRuntimeSelection } from '../../../packages/game-library/src/runtime-selection';
import { inspectRuntimePackage } from '../../../packages/game-library/src/runtime-package';
import { preparePeerWorld } from '../../../packages/modules/src/installed';
import { engineModuleServices } from '../../../packages/sim-core/src/module-services';
import { createJoinReview } from '../../../modules/join-review/src/index';
import { CORE_SESSION } from '../../../packages/game-api/src/index';
import { browserSessionFactory } from './module-session';
import { BrowserPackageStore } from './package-store';
import { BrowserModuleHost } from './module-host';
import { environment } from './startup';
import { moduleLibrary } from './module-library';
import {moduleLogs} from './module-logging';

const store = new BrowserPackageStore(), review = createJoinReview();
let activeHost: BrowserModuleHost | undefined;
let activeArtwork: VehicleArtwork | undefined;
export const joinVehicleArtwork = () => activeArtwork;
export function sampleJoinModules(elapsed: number, flight: boolean, shortcuts: boolean): void { activeHost?.sample(elapsed, flight, shortcuts); }
export function releaseJoinModules(pilot?: number): void { activeHost?.release(pilot); }
export function joinSource(address: string): string {
  try { const url = new URL(address); return `${url.protocol}//${url.host}${url.pathname}`; }
  catch { return address.slice(0, 256); }
}
export function joinClientPort(options: { readonly address: string; readonly root: HTMLElement; readonly pilots: PilotRegistry;
  readonly status: (text: string) => void }): JoinClientPort {
  const address = joinSource(options.address), scope = (offer: JoinOffer) => `${address}\n${offer.sessionId}`;
  let entries: StoredPackage[] | undefined, preparedOffer: string | undefined;
  return {
    allowRuntimeCode: ALLOW_RUNTIME_CODE,
    approved: offer => store.joinApproved(scope(offer), offer),
    review: (offer, signal) => review.review(offer, address, signal),
    cached: offer => store.joinCached(offer),
    progress: (received, total) => options.status(`Receiving required game modules: ${Math.round(received / total * 100)}%`),
    async stage(offer, bytes, signal) {
      const inspected = await inspectJoinPack(bytes, offer, signal); signal.throwIfAborted();
      // Inspection of the actual inventory precedes all code evaluation, including cached replay.
      if (!ALLOW_RUNTIME_CODE && inspected.inventory.some(item => item.containsCode)) throw new Error('This build does not allow imported code');
      const staging = new MemoryPackageStore();
      await installGamePackages(inspected.game, staging, { environment: environment(), allowRuntimeCode: ALLOW_RUNTIME_CODE }, address);
      signal.throwIfAborted();
      const plan = inspected.game.runtime ? await installRuntimeSelection(inspected.game.runtime, staging, { environment: environment(), allowRuntimeCode: ALLOW_RUNTIME_CODE }, address) : undefined;
      const host = new BrowserModuleHost(options.status, options.pilots);
      let stage: JoinStage | undefined, artwork: VehicleArtwork | undefined;
      try {
        stage = await preparePeerWorld(plan, staging, { environment: environment(), allowRuntimeCode: ALLOW_RUNTIME_CODE,
          approvedDigests: new Set(plan?.packages.map(reference => reference.digest) ?? []) }, {
          logs:moduleLogs,profile: inspected.game.bundle.profile, data: inspected.game.bundle.modules,
          code: artifactModules(inspected.game.plugins, environment()), universe: inspected.universe, systemId: inspected.systemId,
          hostServices: [...engineModuleServices(), ...host.hostServices(), { key: CORE_SESSION, service: browserSessionFactory,
            tiers: ['platform', 'network'], environments: ['browser', 'offline'] }], inspect: inspectRuntimePackage,
          configure: modules => { host.configure(modules); artwork = moduleVehicleArtwork(modules); }, dispose: () => host.dispose(),
        }, offer, signal);
        signal.throwIfAborted();
        entries = [];
        for (const identity of await staging.list()) { const entry = await staging.get(identity.digest); if (entry) entries.push(entry); }
        preparedOffer = offer.id;
      } catch (error) { stage?.dispose(); host.dispose(); throw error; }
      const prepared = stage; let disposed = false;
      return { options: prepared.options,
        activate() {
          if (disposed) throw new Error('Server candidate is disposed');
          prepared.activate?.(); host.activate(options.root); host.commit(); activeHost = host; activeArtwork = artwork;
        },
        dispose() { if (disposed) return; disposed = true; if (activeHost === host) { activeHost = undefined; activeArtwork = undefined; } prepared.dispose(); host.dispose(); },
      };
    },
    async remember(offer, bytes, signal) {
      if (preparedOffer !== offer.id || !entries) throw new Error('Server pack has not been independently verified and staged');
      await store.commitJoin(scope(offer), offer, bytes, entries, signal);
      await moduleLibrary.refreshInstalled();
    },
  };
}
