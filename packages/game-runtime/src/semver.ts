/** Host-only (`packages/game-runtime`) semantic versions and dependency ranges. A registry installs one version per module ID,
 * so a range is a satisfaction check against that version, never a solver. Profiles and
 * locks keep exact versions. Modules cannot import this package; they declare ranges in their manifests. */

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
}
type Operator = '<' | '<=' | '>' | '>=' | '=';
interface Comparator { readonly op: Operator; readonly version: Version }

const IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const VERSION = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
const MAX_RANGE = 128;

/** Parses an exact semantic version (`1.2.3`, optional prerelease and build metadata), or returns `undefined`. Host-only (`packages/game-runtime`). */
export function parseVersion(text: string): Version | undefined {
  const m = VERSION.exec(text);
  if (!m) return undefined;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return { major, minor, patch, prerelease: m[4] ? m[4].split('.').map(p => /^\d+$/.test(p) ? Number(p) : p) : [] };
}

/** Semantic version precedence; build metadata is ignored. */
export function compareVersions(a: Version, b: Version): number {
  for (const key of ['major', 'minor', 'patch'] as const) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  if (!a.prerelease.length || !b.prerelease.length) return Math.sign(b.prerelease.length - a.prerelease.length);
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i], y = b.prerelease[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    if (typeof x !== typeof y) return typeof x === 'number' ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function comparators(token: string): Comparator[] | undefined {
  if (token === '*') return [];
  const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(token);
  const version = m && parseVersion(m[2]!);
  if (!m || !version) return undefined;
  const { major, minor, patch } = version;
  const bound = (major: number, minor: number, patch: number): Version => ({ major, minor, patch, prerelease: [] });
  if (m[1] === '^') return [{ op: '>=', version }, { op: '<', version: major > 0 ? bound(major + 1, 0, 0)
    : minor > 0 ? bound(0, minor + 1, 0) : bound(0, 0, patch + 1) }];
  if (m[1] === '~') return [{ op: '>=', version }, { op: '<', version: bound(major, minor + 1, 0) }];
  return [{ op: (m[1] ?? '=') as Operator, version }];
}

/** `1.2.3`, `^1.2.3`, `~1.2.3`, comparators (`>=1.2.0 <2.0.0`), `*`, and alternatives joined
 * by `||`. Versions are complete; partial versions such as `^1.2` are not accepted. */
export function parseRange(range: string): readonly (readonly Comparator[])[] | undefined {
  if (typeof range !== 'string' || !range.trim() || range.length > MAX_RANGE) return undefined;
  const sets: Comparator[][] = [];
  for (const part of range.split('||')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return undefined;
    const set: Comparator[] = [];
    for (const token of tokens) {
      const parsed = comparators(token);
      if (!parsed) return undefined;
      set.push(...parsed);
    }
    sets.push(set);
  }
  return sets;
}
/** Whether `range` is a supported dependency range (see `parseRange`). Host-only (`packages/game-runtime`). */
export const validRange = (range: string): boolean => parseRange(range) !== undefined;

function test(c: Comparator, v: Version): boolean {
  const order = compareVersions(v, c.version);
  return c.op === '=' ? order === 0 : c.op === '<' ? order < 0 : c.op === '<=' ? order <= 0 : c.op === '>' ? order > 0 : order >= 0;
}
/** Prerelease versions only match a set naming a prerelease of the same major.minor.patch. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version), sets = parseRange(range);
  if (!v || !sets) return false;
  return sets.some(set => set.every(c => test(c, v)) && (!v.prerelease.length || set.some(c => c.version.prerelease.length > 0
    && c.version.major === v.major && c.version.minor === v.minor && c.version.patch === v.patch)));
}
