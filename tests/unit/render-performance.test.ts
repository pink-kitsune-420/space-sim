import { describe, expect, it } from 'vitest';
// @ts-expect-error first-party dev-only ESM tooling
import { validateProtocol, transferBytes, distribution, validateWindow, validateBackend, exportedSections, validateBuildProof } from '../../scripts/lib/render-performance.mjs';
// @ts-expect-error first-party serialized browser instrumentation
import { installRenderProbe } from '../../scripts/lib/render-probe.mjs';

const protocol = () => ({ schema: 'space-sim.render-protocol/1', baseURL: 'http://127.0.0.1:5202', distDir: 'dist',
  warmupMs: 10000, windowMs: 30000, windows: 2, probeMs: 3000, cases: [{ id: 'pad' }] });

describe('render measurement fidelity', () => {
  it('rejects short/ambiguous protocols and duplicate/unsafe output identities', () => {
    expect(validateProtocol(protocol()).cases[0].tiles).toBe(.5);
    for (const change of [{ windowMs: 29999 }, { windows: 1 }, { warmupMs: 0 }, { baseURL: 'https://example.com' },
      { baseURL: 'http://localhost/subpath' }, { unknown: true }, { cases: [{ id: '../escape' }] },
      { cases: [{ id: 'x' }, { id: 'x' }] }, { cases: [{ id: 'x', game: 'classic', tiles: .5 }] },
      { cases: [{ id: 'x', browser: 'firefox', backend: 'hardware' }] }]) {
      expect(() => validateProtocol({ ...protocol(), ...change })).toThrow();
    }
  });
  it('counts typed offsets in elements and explicit zero length as the remaining payload', () => {
    const backing = new ArrayBuffer(64), u16 = new Uint16Array(backing, 8, 12);
    expect(transferBytes(u16)).toBe(24); expect(transferBytes(u16, 2, 3)).toBe(6);
    expect(transferBytes(u16, 2, 0)).toBe(20); expect(transferBytes(backing, 8, 4)).toBe(4);
    expect(transferBytes(new DataView(backing, 8, 16), 4)).toBe(12);
    for (const args of [[u16, 13], [u16, -1], [u16, 2, 11], [u16, 1.5]]) expect(() => transferBytes(...args)).toThrow();
  });
  it('keeps all samples and rejects incomplete/nonfinite cadence or unknown physical backend', () => {
    expect(distribution([4, 1, 3, 2])).toEqual({ samples: 4, p50: 3, p95: 4, p99: 4, worst: 4 });
    expect(validateWindow({ startMs: 0, endMs: 30000, frames: 3, intervals: [10000, 10000, 10000] }).p95).toBe(10000);
    for (const change of [{ endMs: 29999 }, { endMs: NaN }, { frames: 2 }, { intervals: [0, 10000, 20000] }, { intervals: [10, 20, 30] }]) {
      expect(() => validateWindow({ startMs: 0, endMs: 30000, frames: 3, intervals: [10000, 10000, 10000], ...change })).toThrow();
    }
    expect(() => validateBackend('hardware', { renderer: 'builtin.webgl', gpu: 'ANGLE Intel Iris' })).not.toThrow();
    expect(() => validateBackend('hardware', { renderer: 'builtin.webgl', gpu: 'ANGLE SwiftShader' })).toThrow();
    expect(() => validateBackend('hardware', { renderer: 'builtin.webgl', gpu: 'Unknown' })).toThrow();
    expect(() => validateBackend('software', { renderer: 'builtin.webgl', gpu: 'ANGLE Intel Iris' })).toThrow();
  });
  it('rejects stale build attribution while permitting dev-harness-only changes', () => {
    const source = { commit: 'base', files: { 'apps/web/src/main.ts': 'new', 'scripts/probe.mjs': 'tool' } };
    const manifest = { files: { 'index.html': 'built' } };
    const proof = { commit: 'base', runtimeSourceSha256: { 'apps/web/src/main.ts': 'new' }, artifactSha256: manifest.files };
    expect(validateBuildProof(proof, source, manifest)).toBe(true);
    expect(() => validateBuildProof({ ...proof, commit: 'old' }, source, manifest)).toThrow();
    expect(() => validateBuildProof(proof, { ...source, files: { ...source.files, 'modules/renderer.ts': 'unbuilt' } }, manifest)).toThrow();
    expect(() => validateBuildProof(proof, source, { files: { 'index.html': 'different' } })).toThrow();
  });
  it('filters exported section history to measured time and rejects intrusive raster flushing', () => {
    const frame = (t: number) => ({ t, workMs: 1, physics: 0, prediction: 0, background: .1, planet: .2, path: 0, ship: 0, overlay: 0, hud: .7 });
    const report = { format: 'space-sim-log/1', environment: { precise: false }, frames: [frame(1), frame(10), frame(20)] };
    expect(exportedSections(report, 10000, 20000).retainedMeasuredFrames).toBe(2);
    expect(() => exportedSections({ ...report, environment: { precise: true } }, 0, 30000)).toThrow();
  });
});

it('the browser probe preserves calls, attributes byte roles, and restores every patched method', () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const names = ['WebGL2RenderingContext', 'CanvasRenderingContext2D', 'Element', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const old = new Map(names.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  class GL {
    ARRAY_BUFFER = 1; UNSIGNED_SHORT = 2; UNSIGNED_BYTE = 3; TRIANGLE_FAN = 4; STENCIL_BUFFER_BIT = 8; SCISSOR_TEST = 16; actual = 0;
    enable(..._a: unknown[]) {} disable(..._a: unknown[]) {} scissor(..._a: unknown[]) {}
    bindBuffer(..._a: unknown[]) {} bufferData(..._a: unknown[]) {} deleteBuffer(..._a: unknown[]) {}
    vertexAttribIPointer(..._a: unknown[]) {} bufferSubData(..._a: unknown[]) {} colorMask(..._a: unknown[]) {} clear(..._a: unknown[]) {}
    drawArrays(..._a: unknown[]) { this.actual++; } drawArraysInstanced(..._a: unknown[]) { this.actual++; }
  }
  class Canvas { canvas = { width: 10, height: 10 }; save() {} restore() {} transform(..._a: unknown[]) {} clip(..._a: unknown[]) {} fillRect(..._a: unknown[]) {} fill() {} beginPath() {} moveTo(..._a: unknown[]) {} lineTo(..._a: unknown[]) {} getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 20, f: 20 }; } }
  class Element { getBoundingClientRect() { return {}; } }
  const method = GL.prototype.bufferSubData;
  try {
    Object.assign(globals, { WebGL2RenderingContext: GL, CanvasRenderingContext2D: Canvas, Element,
      requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} });
    installRenderProbe();
    const probe = globals.__spaceSimRenderProbe as { start(): void; stop(): Record<string, number>; restore(): void };
    const gl = new GL(), buffer = {};
    gl.bindBuffer(1, buffer); gl.bufferData(1, 2048, 0); gl.vertexAttribIPointer(1, 1, 2, 0, 0);
    probe.start(); gl.bufferSubData(1, 0, new Uint16Array(12), 2, 0);
    gl.enable(16); gl.scissor(0, 0, 0, 10);
    gl.colorMask(false, false, false, false); gl.clear(8); gl.drawArrays(4, 0, 6); gl.drawArraysInstanced(5, 0, 4, 1024);
    const ctx = new Canvas(); ctx.save(); ctx.transform(1, 0, 0, -1, 0, 0); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(1, 1); ctx.clip(); ctx.fillRect(0, 0, 1, 1); ctx.restore();
    // An unclipped legacy chunk must not inherit a preceding chunk's offscreen clip.
    ctx.save(); ctx.transform(1, 0, 0, -1, 0, 0); ctx.fillRect(0, 0, 1, 1); ctx.restore();
    new Element().getBoundingClientRect(); gl.deleteBuffer(buffer);
    const counters = probe.stop(); expect(counters.tileIdUploadBytes).toBe(20); expect(counters.maskFans).toBe(1);
    expect(counters.zeroScissorDraws).toBe(1); expect(counters.zeroScissorTileDraws).toBe(1);
    expect(counters.offscreenTileClips).toBe(1); expect(counters.offscreenTileFillRects).toBe(1);
    expect(counters.tileInstances).toBe(1024); expect(counters.tileFillRects).toBe(2); expect(counters.tileClips).toBe(1);
    expect(counters.requestedLiveBufferBytes).toBe(0); expect(counters.peakRequestedBufferBytes).toBe(2048);
    expect(counters.layoutBoundsReads).toBe(1); expect(gl.actual).toBe(2);
    probe.restore(); expect(GL.prototype.bufferSubData).toBe(method);
  } finally {
    const probe = globals.__spaceSimRenderProbe as { restore(): void } | undefined; probe?.restore();
    for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globals[key]; }
  }
});
