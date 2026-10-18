import { FLIGHT_PROFILES, LOCAL_PILOTS, type Disposable, type LocalPilotHost, type ModuleInitializationV2, type PilotRegistry } from '@space-sim/game-api';
import { createLocalPlayerPreferences } from './preferences';

/** Device-local seats over a borrowed session. The host owns identity and persistence. */
export class LocalPilotRegistry implements PilotRegistry, Disposable {
  private disposed = false;
  constructor(private readonly host: LocalPilotHost) {}
  get count(): number {
    if (this.disposed) throw new Error('Local pilot registry is disposed');
    const count = this.host.count();
    if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('Local pilot count must be in [1, 4]');
    return count;
  }
  private check(pilot: number): void {
    if (!Number.isInteger(pilot) || pilot < 0 || pilot >= this.count) throw new Error('Pilot is not active in this window');
  }
  playerId(pilot: number): string | undefined { this.check(pilot); return this.host.playerId(pilot); }
  assign(pilot: number, device: string): void {
    this.check(pilot);
    if (!(device === 'keyboard' || device === 'none' || device === 'auto' && pilot === 0 || /^pad:\d{1,2}$/.test(device)))
      throw new Error('Unsupported pilot input device');
    this.host.release(); this.host.assign(pilot, device);
  }
  release(pilot?: number): void { if (pilot !== undefined) this.check(pilot); else void this.count; this.host.release(pilot); }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.host.release(); }
}
export default function initialize(context: ModuleInitializationV2): void {
  const profiles = context.tryUse(FLIGHT_PROFILES);
  context.contributeGuide({ id: 'usage', audience: 'creators', title: "Local pilot registry", summary: "Adapts one to four active local seats to borrowed session identities and device preferences.", asset: 'docs/creators/usage.json' });
  const registries = new Set<LocalPilotRegistry>(); let disposed = false;
  context.own({ dispose() { if (disposed) return; disposed = true; const errors: unknown[] = [];
    for (const registry of registries) { try { registry.dispose(); } catch (error) { errors.push(error); } }
    registries.clear(); if (errors.length) throw new AggregateError(errors, 'Local pilot provider cleanup failed'); } });
  context.provide(LOCAL_PILOTS, Object.freeze({ create(host: LocalPilotHost) {
    if (disposed) throw new Error('Local pilot provider is disposed');
    const registry = new LocalPilotRegistry(host), dispose = registry.dispose.bind(registry);
    registry.dispose = () => { try { dispose(); } finally { registries.delete(registry); } }; registries.add(registry); return registry;
  }, preferences() {
    if (disposed) throw new Error('Local pilot provider is disposed');
    if (!profiles) throw new Error('Flight seat preferences require a compatible input.flight-profiles provider');
    return createLocalPlayerPreferences(profiles);
  } }));
}
