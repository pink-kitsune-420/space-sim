import { createPlanetBake, createPlanetField, type PlanetBake, type PlanetGenerator, type Disposable } from '@space-sim/game-api';

/** Reusable authoritative generator factory, independent of the host's world,
 * physics, renderer and scheduler. Two pending jobs bound factory-owned storage
 * to4MiB; transfer or cancel a job before requesting another. */
export function createPlanetGenerator(): PlanetGenerator & Disposable {
  const pending = new Set<PlanetBake>();
  let disposed = false;
  const live = () => { if (disposed) throw Error('Planet generator is disposed'); };
  return Object.freeze({
    create(definition) { live(); return createPlanetField(definition); },
    bake(definition, options) {
      live(); if (pending.size >= 2) throw Error('Planet generator permits at most two pending bake jobs');
      const inner = createPlanetBake(definition, options);
      const job: PlanetBake = Object.freeze({
        get status() { return inner.status; }, get progress() { return inner.progress; }, get storageBytes() { return inner.storageBytes; },
        step: (budget?: number) => inner.step(budget),
        takeResult() { const result = inner.takeResult(); pending.delete(job); return result; },
        cancel() { inner.cancel(); pending.delete(job); },
      });
      pending.add(job); return job;
    },
    dispose() { if (disposed) return; disposed = true; for (const job of pending) job.cancel(); pending.clear(); },
  } satisfies PlanetGenerator & Disposable);
}
