import type {
  AuthoritativeLock,
  ForceExtension,
  ModuleManifest,
  ModuleState,
  ModuleValue,
  WorldRuleExtension,
  UniverseDefinition,
} from '../../game-api/src/index';
import { validateModuleState } from './motion';
import { freezeJson } from './validation';

/** SHA-256 of a string's UTF-8 bytes, as lowercase hex. Synchronous and dependency-free. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(text: string): string {
  return sha256Bytes(new TextEncoder().encode(text));
}

/** Hash raw bytes without decoding binary assets or normalizing source text. */
export function sha256Bytes(data: Uint8Array): string {
  const blocks = Math.ceil((data.length + 9) / 64);
  const bytes = new Uint8Array(blocks * 64);
  bytes.set(data);
  bytes[data.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bits = data.length * 8;
  view.setUint32(bytes.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(bytes.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, k = h[7]!;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + k) >>> 0;
  }
  return [...h].map(x => x.toString(16).padStart(8, '0')).join('');
}

/** Recursively serializes any JSON value with objects sorted by key. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonically serialize non-finite numbers');
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error(`Cannot canonically serialize value of type ${typeof value}`);
}

/** Bind physical definitions while retaining viewer-only palette/labels outside authority. */
export function physicalUniverseDigest(universe: UniverseDefinition): string {
  const visual = new Set(['name', 'description', 'author', 'color', 'accentColor', 'atmosphereColor', 'horizonColor', 'skyColor', 'zoom']);
  return sha256Hex(canonicalJson(JSON.parse(JSON.stringify(universe, (key, value: unknown) => visual.has(key) ? undefined : value))));
}

export interface AuthoritativeLockOptions {
  readonly profileId: string;
  readonly order: readonly string[];
  readonly manifests: ReadonlyMap<string, ModuleManifest>;
  readonly providers: Readonly<Record<string, string>>;
  readonly settings: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly contentDigests?: Readonly<Record<string, string>>;
  readonly physicalGeometry?: Readonly<Record<string, string>>;
  readonly rules?: readonly WorldRuleExtension[];
  readonly forces?: readonly ForceExtension[];
}

/** Constructs the canonical AuthoritativeLock, omitting presentation-only modules and slots. */
export function computeAuthoritativeLock(options: AuthoritativeLockOptions): AuthoritativeLock {
  const authoritativeOrder = options.order.filter(id => options.manifests.get(id)?.authority === 'authoritative');
  const modules = authoritativeOrder.map(id => ({
    id,
    version: options.manifests.get(id)?.version ?? '0.0.0',
  }));

  const providers: Record<string, string> = Object.create(null);
  for (const [slot, providerId] of Object.entries(options.providers)) {
    const m = options.manifests.get(providerId);
    if (m && m.authority === 'authoritative') {
      providers[slot] = providerId;
    }
  }

  const settings: Record<string, Record<string, number>> = Object.create(null);
  for (const id of authoritativeOrder) {
    if (options.settings[id]) {
      const keys = Object.keys(options.settings[id]!).sort();
      if (keys.length > 0) {
        settings[id] = Object.create(null) as Record<string, number>;
        for (const k of keys) {
          settings[id]![k] = options.settings[id]![k]!;
        }
      }
    }
  }

  const contentDigests: Record<string, string> = Object.create(null);
  for (const k of Object.keys(options.contentDigests ?? {}).sort()) {
    contentDigests[k] = options.contentDigests![k]!;
  }

  const physicalGeometry: Record<string, string> = Object.create(null);
  for (const k of Object.keys(options.physicalGeometry ?? {}).sort()) {
    physicalGeometry[k] = options.physicalGeometry![k]!;
  }

  const rules = (options.rules ?? []).map(r => ({
    moduleId: r.moduleId,
    version: r.version,
    modelIdentity: r.hook.modelIdentity,
    seed: r.hook.seed,
  })).sort((a, b) => a.moduleId.localeCompare(b.moduleId));

  const forces = (options.forces ?? []).map(f => ({
    moduleId: f.moduleId,
    version: f.version,
    modelIdentity: f.hook.modelIdentity,
  })).sort((a, b) => a.moduleId.localeCompare(b.moduleId));

  return freezeJson({
    format: 'space-sim-auth-lock/1',
    profileId: options.profileId,
    modules,
    order: authoritativeOrder,
    providers,
    settings,
    contentDigests,
    physicalGeometry,
    rules,
    forces,
  }) as AuthoritativeLock;
}

/** Computes the canonical simulation fingerprint (64-character SHA-256 hex string). */
export function computeSimulationFingerprint(lock: AuthoritativeLock): string {
  return sha256Hex(canonicalJson(lock));
}

export type StateMigrationFn = (value: ModuleValue) => ModuleValue;
const MIGRATIONS = new Map<string, StateMigrationFn>();

export function registerModuleMigration(moduleId: string, fromVersion: number, toVersion: number, migrate: StateMigrationFn): void {
  MIGRATIONS.set(`${moduleId}@${fromVersion}->${toVersion}`, migrate);
}

export function clearModuleMigrations(): void {
  MIGRATIONS.clear();
}

/** Migrates a ModuleState through registered migration functions to targetVersion. */
export function migrateModuleState(moduleId: string, state: ModuleState, targetVersion: number): ModuleState {
  if (state.version === targetVersion) return state;
  if (state.version > targetVersion) {
    throw new Error(`Module ${moduleId}: state version ${state.version} is newer than supported version ${targetVersion}`);
  }
  let current = state;
  while (current.version < targetVersion) {
    const nextVersion = current.version + 1;
    const migration = MIGRATIONS.get(`${moduleId}@${current.version}->${nextVersion}`);
    if (!migration) {
      throw new Error(`Module ${moduleId}: missing migration from version ${current.version} to ${nextVersion}`);
    }
    const migratedValue = migration(current.value);
    current = validateModuleState({ version: nextVersion, value: migratedValue });
  }
  return current;
}

export const DEFAULT_BUILTIN_LOCK: AuthoritativeLock = Object.freeze({
  format: 'space-sim-auth-lock/1',
  profileId: 'builtin.default',
  modules: [{ id: 'builtin.content', version: '0.1.0' }, { id: 'builtin.motion', version: '0.1.0' }],
  order: ['builtin.content', 'builtin.motion'],
  providers: {
    bodies: 'builtin.motion',
    content: 'builtin.content',
    motion: 'builtin.motion',
    orbits: 'builtin.motion',
    rails: 'builtin.motion',
    surfaces: 'builtin.motion',
  },
  settings: {},
  contentDigests: {},
  physicalGeometry: {},
  rules: [],
  forces: [],
});
