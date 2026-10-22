import { createPlanetField } from './field';
import type { PlanetFieldDefinition } from './definition';
import * as dm from '../math';

/** Bounded F9 macro data, not fine tiles. Dimensions are powers of two.
 * Longitude wraps at 2*pi; row coordinate is body-fixed z, uniformly [-1,1]. */
export interface PlanetBakeOptions {
  readonly columns: number;
  readonly rows: number;
  readonly equatorSamples: number;
  readonly orientationRadians?: number;
}
/** Immutable-by-contract transferred data. The receiver owns all arrays and must
 * replace the descriptor before changing them. The producer retains no cache.
 * Heights and sea radius use SI metres; these samples do not yet constitute a
 * physics SurfaceProfile (the host must compute its exact interval bounds). */
export interface PlanetBakeResult {
  readonly identity: string;
  readonly definition: Readonly<PlanetFieldDefinition>;
  readonly options: Readonly<PlanetBakeOptions>;
  readonly equator: Float64Array;
  readonly map: Readonly<{
    elevations: Float64Array;
    /** Interleaved moisture and range strength, each [0,255]; cosmetic attributes. */
    attributes: Uint8Array;
    /** Exact classification of stored float64 heights against this bake's sea. */
    waterMask: Uint8Array;
  }>;
  readonly seaRadiusMetres?: number;
  readonly sampledWaterCoverage: number;
  /** Largest quantile histogram bin fraction; bounds coverage discretization.
   * Degenerate flat fields can make an intermediate requested fraction impossible. */
  readonly coverageBinFraction: number;
  readonly storageBytes: number;
}
/** No scheduler or DOM. Call step between yields or in a worker. Each operation
 * is one field sample, histogram bin or classification, capped at1024/step.
 * takeResult transfers once; cancel releases storage and prevents further work. */
export interface PlanetBake {
  readonly status: 'pending' | 'ready' | 'transferred' | 'cancelled';
  readonly progress: number;
  readonly storageBytes: number;
  step(maxOperations?: number): void;
  takeResult(): PlanetBakeResult;
  cancel(): void;
}
/** Maximum retained typed storage per job, including temporary histogram and
 * field scratch; two pending jobs fit in4MiB. Completed data belongs to callers. */
export const PLANET_BAKE_MAX_BYTES = 2 * 1024 * 1024;

/** Incremental deterministic macro bake from one qualified sphere field.
 * Sea coverage uses2048 global equal-area histogram bins, never north-disc area.
 * Calls are synchronous and non-reentrant; no allocations inside sample loops. */
export function createPlanetBake(definition: PlanetFieldDefinition, raw: PlanetBakeOptions): PlanetBake {
  let field: ReturnType<typeof createPlanetField> | undefined = createPlanetField(definition);
  const d = field.definition;
  if (!raw || typeof raw !== 'object' || Object.keys(raw).some(k => !['columns', 'rows', 'equatorSamples', 'orientationRadians'].includes(k)))
    throw Error('Invalid planet bake options');
  const power = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max && (n & (n - 1)) === 0;
  if (!power(raw.columns, 32, 512) || !power(raw.rows, 16, 256) || !power(raw.equatorSamples, 32, 65536))
    throw Error('Planet bake dimensions exceed power-of-two limits');
  const orientation = raw.orientationRadians ?? 0;
  if (!Number.isFinite(orientation) || orientation < 0 || orientation >= 2 * Math.PI) throw Error('Invalid bake orientation');
  const options = Object.freeze({ columns: raw.columns, rows: raw.rows, equatorSamples: raw.equatorSamples, orientationRadians: orientation });
  const count = options.columns * options.rows, coverage = d.waterCoverage;
  const histogramLength = coverage !== undefined && coverage > 0 && coverage < 1 ? 2048 : 0;
  let bytes = count * 11 + options.equatorSamples * 8 + histogramLength * 4 + 64 + field.storageBytes;
  if (bytes > PLANET_BAKE_MAX_BYTES) throw Error('Planet bake storage limit exceeded');
  let elevations: Float64Array | undefined = new Float64Array(count);
  let attributes: Uint8Array | undefined = new Uint8Array(count * 2);
  let waterMask: Uint8Array | undefined = new Uint8Array(count);
  let equator: Float64Array | undefined = new Float64Array(options.equatorSamples);
  let histogram: Uint32Array | undefined = new Uint32Array(histogramLength);
  let sample: Float64Array | undefined = new Float64Array(8);
  let status: PlanetBake['status'] = 'pending', stage: 'map' | 'quantile' | 'equator' | 'water' = 'map';
  let cursor = 0, done = 0, cumulative = 0, wet = 0, binFraction = 0;
  let sea = d.seaRadiusMetres;
  const total = count * 2 + equator.length + histogram.length;
  const identity = 'space-sim-planet-bake/2:' + field.identity + ':' + JSON.stringify(options);
  const free = () => { elevations = undefined; attributes = undefined; waterMask = undefined; equator = undefined;
    histogram = undefined; sample = undefined; field = undefined; bytes = 0; };
  return Object.freeze({
    get status() { return status; }, get progress() { return status === 'ready' || status === 'transferred' ? 1 : Math.min(1, done / total); },
    get storageBytes() { return bytes; },
    step(maxOperations = 256) {
      if (!Number.isInteger(maxOperations) || maxOperations < 1 || maxOperations > 1024) throw Error('Bake step budget must be1..1024');
      if (status !== 'pending') return;
      for (let work = 0; work < maxOperations && status === 'pending'; work++, done++) {
        if (stage === 'map') {
          const z = 2 * (Math.floor(cursor / options.columns) + .5) / options.rows - 1;
          const r = Math.sqrt(1 - z * z), angle = (cursor % options.columns + .5) * 2 * Math.PI / options.columns;
          field!.evaluate(r * dm.cos(angle), r * dm.sin(angle), z, sample!);
          const h = sample![0]!; elevations![cursor] = h;
          attributes![cursor * 2] = Math.round(sample![7]! * 255); attributes![cursor * 2 + 1] = Math.round(sample![5]! * 255);
          if (histogram!.length) {
            const bin = d.maxReliefMetres === 0 ? 0 : Math.max(0, Math.min(2047, Math.floor((h / d.maxReliefMetres + 1) * 1024)));
            histogram![bin] = histogram![bin]! + 1;
          }
          if (++cursor === count) {
            cursor = 0;
            if (coverage === 1) sea = d.radiusMetres + d.maxReliefMetres + Math.max(1e-7, d.radiusMetres * Number.EPSILON * 4);
            stage = histogram!.length ? 'quantile' : 'equator';
          }
        } else if (stage === 'quantile') {
          const n = histogram![cursor]!; cumulative += n; binFraction = Math.max(binFraction, n / count);
          if (sea === undefined && cumulative >= coverage! * count)
            sea = d.radiusMetres + d.maxReliefMetres * ((cursor + 1) / 1024 - 1);
          if (++cursor === histogram!.length) { cursor = 0; bytes -= histogram!.byteLength; histogram = undefined; stage = 'equator'; }
        } else if (stage === 'equator') {
          const a = orientation + cursor * 2 * Math.PI / options.equatorSamples;
          field!.evaluate(dm.cos(a), dm.sin(a), 0, sample!); equator![cursor] = sample![0]!;
          if (++cursor === options.equatorSamples) { cursor = 0; stage = 'water'; }
        } else {
          const water = sea !== undefined && d.radiusMetres + elevations![cursor]! < sea;
          waterMask![cursor] = water ? 1 : 0; if (water) wet++;
          if (++cursor === count) status = 'ready';
        }
      }
    },
    takeResult() {
      if (status !== 'ready') throw Error('Planet bake result is not ready or already transferred');
      const storageBytes = elevations!.byteLength + attributes!.byteLength + waterMask!.byteLength + equator!.byteLength;
      const result: PlanetBakeResult = Object.freeze({ identity, definition: d, options, equator: equator!,
        map: Object.freeze({ elevations: elevations!, attributes: attributes!, waterMask: waterMask! }),
        ...(sea === undefined ? {} : { seaRadiusMetres: sea }), sampledWaterCoverage: wet / count, coverageBinFraction: binFraction, storageBytes });
      status = 'transferred'; free(); return result;
    },
    cancel() { if (status === 'transferred' || status === 'cancelled') return; status = 'cancelled'; free(); },
  });
}
