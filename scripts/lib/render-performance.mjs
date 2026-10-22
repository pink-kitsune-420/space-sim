import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

export const PROTOCOL_VERSION = 'space-sim.render-protocol/1';
export const MAX_CASES = 64;
export const MAX_SAMPLES = 120_000;
const rootKeys = ['schema', 'baseURL', 'distDir', 'warmupMs', 'windowMs', 'windows', 'probeMs', 'cases', 'buildProof'];
const caseKeys = ['id', 'browser', 'backend', 'game', 'preset', 'tiles', 'air', 'camera', 'rotationSteps', 'width', 'height', 'dpr', 'graphics', 'views', 'diagnostic', 'panXMetres', 'panYMetres', 'zoomSteps'];
function requireKeys(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error(`${name}: unknown field ${key}`);
}
function number(value, min, max, name, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw Error(`${name} must be ${integer ? 'an integer' : 'finite'} in [${min},${max}]`);
  return value;
}
function choice(value, allowed, name) {
  if (!allowed.includes(value)) throw Error(`${name} must be one of ${allowed.join(', ')}`);
  return value;
}
/** Strict dev-only protocol. Diagnostic ablations never count as visual qualification. */
export function validateProtocol(raw) {
  requireKeys(raw, rootKeys, 'protocol');
  if (raw.schema !== PROTOCOL_VERSION) throw Error('Unsupported render protocol');
  const url = new URL(raw.baseURL);
  if (url.pathname !== '/' || url.search || url.hash || url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw Error('Use an unauthenticated local production HTTP URL');
  if (typeof raw.distDir !== 'string' || !raw.distDir) throw Error('distDir is required');
  if (raw.buildProof !== undefined && (typeof raw.buildProof !== 'string' || !raw.buildProof)) throw Error('Invalid buildProof path');
  number(raw.warmupMs, 5000, 60000, 'warmupMs');
  number(raw.windowMs, 30000, 120000, 'windowMs');
  if (raw.windows !== 2) throw Error('Exactly two bare windows are required');
  number(raw.probeMs, 1000, 10000, 'probeMs');
  if (!Array.isArray(raw.cases) || !raw.cases.length || raw.cases.length > MAX_CASES) throw Error(`Use 1..${MAX_CASES} cases`);
  const ids = new Set();
  const cases = raw.cases.map((input, i) => {
    requireKeys(input, caseKeys, `case${i}`);
    const c = { browser: 'chromium', backend: 'hardware', game: 'successor', preset: 'pad', tiles: .5,
      air: 'off', camera: 'follow', rotationSteps: 0, width: 640, height: 480, dpr: 1, graphics: 'low', views: 1, diagnostic: 'none', panXMetres: 0, panYMetres: 0, zoomSteps: 0, ...input };
    if (typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) || ids.has(c.id)) throw Error('Case IDs must be unique safe filenames');
    ids.add(c.id);
    choice(c.browser, ['chromium', 'firefox', 'webkit'], 'browser');
    choice(c.backend, ['hardware', 'software', 'canvas'], 'backend');
    if (c.browser !== 'chromium' && c.backend !== 'canvas') throw Error('Named GL backend selection requires Chromium');
    choice(c.game, ['classic', 'successor'], 'game');
    if (typeof c.preset !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.preset)) throw Error('Invalid preset');
    choice(c.tiles, [0, .25, .5, 1], 'tiles');
    if (c.game === 'classic' && c.tiles !== 0) throw Error('Classic is a vector control');
    choice(c.air, ['off', 'sky', 'clouds'], 'air');
    choice(c.camera, ['follow', 'overview', 'motion'], 'camera');
    number(c.rotationSteps, -24, 24, 'rotationSteps', true); number(c.zoomSteps, -8, 8, 'zoomSteps', true);
    number(c.width, 320, 4096, 'width', true); number(c.height, 240, 4096, 'height', true);
    number(c.panXMetres, -10000, 10000, 'panXMetres'); number(c.panYMetres, -10000, 10000, 'panYMetres');
    number(c.dpr, 1, 3, 'dpr'); choice(c.graphics, ['low', 'high'], 'graphics'); choice(c.views, [1, 2, 4], 'views');
    choice(c.diagnostic, ['none', 'skip-cells'], 'diagnostic');
    if (c.diagnostic !== 'none' && (c.game !== 'successor' || !c.tiles)) throw Error('Cell ablation needs a tiled successor fixture');
    return Object.freeze(c);
  });
  return Object.freeze({ ...raw, baseURL: url.origin, cases: Object.freeze(cases) });
}
/** WebGL source offsets/lengths count typed elements, while ArrayBuffer uses bytes.
 * Explicit zero length means the remaining view, matching the WebGL2 overload. */
export function transferBytes(data, offset = 0, length = 0) {
  if (!(ArrayBuffer.isView(data) || data instanceof ArrayBuffer)) throw Error('Expected an ArrayBuffer or view');
  const unit = data.BYTES_PER_ELEMENT ?? 1;
  const available = data.byteLength / unit;
  if (!Number.isInteger(offset) || offset < 0 || offset > available || !Number.isInteger(length) || length < 0 || length > available - offset) throw Error('Invalid transfer range');
  return (length || available - offset) * unit;
}
export function distribution(values) {
  if (!values.length || values.length > MAX_SAMPLES || values.some(x => !Number.isFinite(x) || x < 0)) throw Error('Invalid or overflowing samples');
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { samples: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), worst: sorted.at(-1) };
}
export function validateWindow(window, minimumMs = 30000) {
  if (!window || !Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || window.endMs - window.startMs < minimumMs
    || !Array.isArray(window.intervals) || !window.intervals.length || window.intervals.some(x => !(x > 0))
    || window.frames !== window.intervals.length) throw Error('Incomplete cadence window');
  if (Math.abs(window.intervals.reduce((sum, value) => sum + value, 0) - (window.endMs - window.startMs)) > 1e-4) throw Error('Cadence clock/sample mismatch');
  return { startMs: window.startMs, endMs: window.endMs, durationMs: window.endMs - window.startMs,
    frames: window.frames, ...distribution(window.intervals) };
}
export function validateBackend(request, actual) {
  if (request === 'canvas') { if (actual.renderer !== 'builtin.canvas') throw Error('Native Canvas fallback was not active'); return; }
  if (actual.renderer !== 'builtin.webgl' || typeof actual.gpu !== 'string') throw Error('Actual WebGL identity unavailable');
  const software = /swiftshader|llvmpipe|software rasterizer|basic render|\bwarp\b/i.test(actual.gpu);
  if (request === 'software' ? !/swiftshader/i.test(actual.gpu) : software || !/intel|nvidia|amd|radeon|apple|adreno|mali|qualcomm/i.test(actual.gpu)) throw Error(`Requested ${request}, observed ${actual.gpu}`);
}
export async function artifactManifest(distDir) {
  const base = resolve(distDir), files = {};
  async function visit(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files[relative(base, path).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(path)).digest('hex');
      else throw Error('Production manifest cannot contain symlinks');
    }
  }
  await visit(base); if (!files['index.html']) throw Error('Production index.html is missing');
  return { distDir: base, files };
}
export async function verifyServed(manifest, baseURL) {
  for (const [path, hash] of Object.entries(manifest.files).filter(([p]) => p === 'index.html' || /^assets\/.*\.(js|css)$/.test(p))) {
    const response = await fetch(`${baseURL}/${path === 'index.html' ? '' : path}`);
    if (!response.ok || createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex') !== hash) throw Error(`Served artifact mismatch: ${path}`);
  }
}
/** The export ring is bounded to600frames. Filter by the measured clock range;
 * never present its subset as all bare-window CPU samples. */
export function exportedSections(report, startMs, endMs) {
  if (report.format !== 'space-sim-log/1' || report.environment?.precise !== false) throw Error('Expected unflushed diagnostic export');
  const rows = report.frames.filter(f => f.t * 1000 >= startMs && f.t * 1000 <= endMs);
  const sections = {};
  for (const key of ['workMs', 'physics', 'prediction', 'background', 'planet', 'path', 'ship', 'overlay', 'hud']) {
    sections[key] = rows.length ? distribution(rows.map(f => f[key])) : null;
  }
  return { retainedMeasuredFrames: rows.length, sections, scope: 'Retained source profiler ring subset; synchronous wall sections, no raster readback or total GPU cost' };
}

/** Tie externally served production bytes to the base commit and every dirty runtime
 * source, rather than mislabelling an old build with the current worktree snapshot. */
export function validateBuildProof(proof, source, manifest) {
  if (!proof || proof.commit !== source.commit) throw Error('Build/source base commit mismatch');
  const runtime = Object.fromEntries(Object.entries(source.files).filter(([p]) => /^(apps|modules|packages|games|examples)\//.test(p)));
  if (JSON.stringify(Object.entries(runtime).sort()) !== JSON.stringify(Object.entries(proof.runtimeSourceSha256 ?? {}).sort())) throw Error('Build/runtime source mismatch');
  if (JSON.stringify(Object.entries(manifest.files).sort()) !== JSON.stringify(Object.entries(proof.artifactSha256 ?? {}).sort())) throw Error('Build/artifact mismatch');
  return true;
}
