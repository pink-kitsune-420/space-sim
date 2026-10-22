/** Serialized into a fresh, instrumented browser context by the dev harness only.
 * Counters and API-requested buffer liveness are not native/GPU peak memory. */
export function installRenderProbe(options = {}) {
  const limit = options.maxResources ?? 4096, contexts = new WeakMap(), canvasStates = new WeakMap(), restores = [];
  const state = { active: false, ablation: options.ablation ?? 'none', contexts: 0, overflow: false, contextLosses: 0,
    layoutStacks: [], lastFrame: 0, frame: 0, start: 0, counts: fresh(), peakRequestedBufferBytes: 0, requestedBufferBytes: 0 };
  function fresh() { return { frames: 0, glDraws: 0, tileDraws: 0, tileInstances: 0, maskFans: 0, maskedOtherDraws: 0,
    stencilClears: 0, zeroScissorDraws: 0, zeroScissorTileDraws: 0, bufferAllocations: 0, bufferRequestedBytes: 0, bufferUploads: 0, bufferUploadBytes: 0,
    tileIdUploadBytes: 0, lightUploadBytes: 0, wallUploadBytes: 0, otherUploadBytes: 0, textureUploads: 0,
    typedTextureBytes: 0, unknownTextureSources: 0, canvasFillRects: 0, tileFillRects: 0, canvasFills: 0,
    tileClips: 0, offscreenTileClips: 0, offscreenTileFillRects: 0, tileSubmissionMs: 0, layoutBoundsReads: 0, suppressedCells: 0 }; }
  function glState(gl) {
    let data = contexts.get(gl);
    if (!data) { data = { bindings: new Map(), buffers: new Map(), color: true, scissorEnabled: false, scissorEmpty: false }; contexts.set(gl, data); state.contexts++;
      if (state.contexts > 16) state.overflow = true;
      gl.canvas?.addEventListener?.('webglcontextlost', () => { for (const meta of data.buffers.values()) state.requestedBufferBytes -= meta.bytes; data.buffers.clear(); data.bindings.clear(); state.contextLosses++; }); }
    return data;
  }
  function canvasState(ctx) { let data = canvasStates.get(ctx); if (!data) { data = { tile: false, started: 0, stack: [], bounds: [Infinity, Infinity, -Infinity, -Infinity], matrix: undefined, offscreen: false }; canvasStates.set(ctx, data); } return data; }
  function bytes(data, offset = 0, length = 0) {
    const unit = data.BYTES_PER_ELEMENT ?? 1, available = data.byteLength / unit - offset;
    return (length > 0 ? length : available) * unit;
  }
  function wrap(proto, key, before, after) {
    if (!proto?.[key]) return;
    const fn = proto[key];
    proto[key] = function (...args) {
      const skip = before?.call(this, args);
      if (skip === true) return;
      const result = Reflect.apply(fn, this, args); after?.call(this, args, result); return result;
    };
    restores.push(() => { proto[key] = fn; });
  }
  const gl = globalThis.WebGL2RenderingContext?.prototype;
  wrap(gl, 'bindBuffer', function (a) { glState(this).bindings.set(a[0], a[1]); });
  wrap(gl, 'bufferData', function (a) {
    const d = glState(this), buffer = d.bindings.get(a[0]); if (!buffer) return;
    const size = typeof a[1] === 'number' ? a[1] : bytes(a[1], a[3], a[4]);
    const old = d.buffers.get(buffer);
    if (!old && d.buffers.size >= limit) { state.overflow = true; return; }
    state.requestedBufferBytes += size - (old?.bytes ?? 0);
    d.buffers.set(buffer, { bytes: size, role: old?.role ?? 'other' });
    state.peakRequestedBufferBytes = Math.max(state.peakRequestedBufferBytes, state.requestedBufferBytes);
    if (state.active) { state.counts.bufferAllocations++; state.counts.bufferRequestedBytes += size; }
  });
  wrap(gl, 'deleteBuffer', function (a) {
    const d = glState(this), old = d.buffers.get(a[0]);
    if (old) { state.requestedBufferBytes -= old.bytes; d.buffers.delete(a[0]); }
    for (const [target, buffer] of d.bindings) if (buffer === a[0]) d.bindings.delete(target);
  });
  // Qualified source uses integer attributes1/2/3 exclusively for IDs/light/walls.
  wrap(gl, 'vertexAttribIPointer', function (a) {
    const d = glState(this), buffer = d.bindings.get(this.ARRAY_BUFFER), meta = d.buffers.get(buffer);
    if (meta && a[1] === 1 && a[3] === 0 && a[4] === 0) {
      if (a[0] === 1 && a[2] === this.UNSIGNED_SHORT) meta.role = 'tileId';
      else if (a[0] === 2 && a[2] === this.UNSIGNED_BYTE) meta.role = 'light';
      else if (a[0] === 3 && a[2] === this.UNSIGNED_SHORT) meta.role = 'wall';
    }
  });
  wrap(gl, 'bufferSubData', function (a) {
    if (!state.active) return;
    const d = glState(this), role = d.buffers.get(d.bindings.get(a[0]))?.role ?? 'other', size = bytes(a[2], a[3], a[4]);
    state.counts.bufferUploads++; state.counts.bufferUploadBytes += size; state.counts[`${role}UploadBytes`] += size;
  });
  wrap(gl, 'enable', function (a) { if (a[0] === this.SCISSOR_TEST) glState(this).scissorEnabled = true; });
  wrap(gl, 'disable', function (a) { if (a[0] === this.SCISSOR_TEST) glState(this).scissorEnabled = false; });
  wrap(gl, 'scissor', function (a) { glState(this).scissorEmpty = a[2] <= 0 || a[3] <= 0; });
  wrap(gl, 'colorMask', function (a) { glState(this).color = a.some(Boolean); });
  wrap(gl, 'clear', function (a) { if (state.active && a[0] & this.STENCIL_BUFFER_BIT) state.counts.stencilClears++; });
  wrap(gl, 'drawArrays', function (a) {
    if (!state.active) return;
    state.counts.glDraws++;
    const d = glState(this); if (d.scissorEnabled && d.scissorEmpty) state.counts.zeroScissorDraws++;
    if (!glState(this).color) { if (a[0] === this.TRIANGLE_FAN) state.counts.maskFans++; else state.counts.maskedOtherDraws++; }
  });
  wrap(gl, 'drawArraysInstanced', function (a) {
    if (!state.active) return;
    const d = glState(this); if (d.scissorEnabled && d.scissorEmpty) state.counts.zeroScissorTileDraws++;
    state.counts.glDraws++; state.counts.tileDraws++; state.counts.tileInstances += a[3];
    if (state.ablation === 'skip-cells') { state.counts.suppressedCells += a[3]; return true; }
  });
  for (const key of ['texImage2D', 'texSubImage2D']) wrap(gl, key, function (a) {
    if (!state.active) return;
    state.counts.textureUploads++;
    const source = a.findLast(value => ArrayBuffer.isView(value));
    if (source) state.counts.typedTextureBytes += source.byteLength; else if (a.at(-1) != null) state.counts.unknownTextureSources++;
  });
  const canvas = globalThis.CanvasRenderingContext2D?.prototype;
  wrap(canvas, 'save', function () { const d = canvasState(this); if (d.stack.length < 128) d.stack.push({ tile: d.tile, started: d.started }); else state.overflow = true; });
  wrap(canvas, 'restore', undefined, function () {
    const d = canvasState(this), old = d.stack.pop();
    if (state.active && d.tile && !old?.tile) state.counts.tileSubmissionMs += performance.now() - d.started;
    d.tile = old?.tile ?? false; d.started = old?.started ?? 0;
  });
  // In qualified Canvas source the only transform() call enters a tile chunk.
  wrap(canvas, 'transform', function () { const d = canvasState(this); d.tile = true; d.offscreen = false; d.started = performance.now(); }, function () { canvasState(this).matrix = this.getTransform?.(); });
  wrap(canvas, 'beginPath', function () { const d = canvasState(this); if (d.tile) { d.bounds[0] = d.bounds[1] = Infinity; d.bounds[2] = d.bounds[3] = -Infinity; } });
  for (const key of ['moveTo', 'lineTo']) wrap(canvas, key, function (a) {
    const d = canvasState(this), m = d.matrix; if (!d.tile || !m) return;
    const x = m.a * a[0] + m.c * a[1] + m.e, y = m.b * a[0] + m.d * a[1] + m.f;
    d.bounds[0] = Math.min(d.bounds[0], x); d.bounds[1] = Math.min(d.bounds[1], y); d.bounds[2] = Math.max(d.bounds[2], x); d.bounds[3] = Math.max(d.bounds[3], y);
  });
  wrap(canvas, 'clip', function () {
    const d = canvasState(this); if (!state.active || !d.tile) return;
    state.counts.tileClips++;
    d.offscreen = d.bounds[2] < -1 || d.bounds[3] < -1 || d.bounds[0] > this.canvas?.width + 1 || d.bounds[1] > this.canvas?.height + 1;
    if (d.offscreen) state.counts.offscreenTileClips++;
  });
  wrap(canvas, 'fillRect', function () {
    if (!state.active) return;
    state.counts.canvasFillRects++;
    if (canvasState(this).tile) { state.counts.tileFillRects++; if (canvasState(this).offscreen) state.counts.offscreenTileFillRects++; if (state.ablation === 'skip-cells') { state.counts.suppressedCells++; return true; } }
  });
  wrap(canvas, 'fill', function () { if (state.active) state.counts.canvasFills++; });
  wrap(globalThis.Element?.prototype, 'getBoundingClientRect', function () {
    if (!state.active) return; state.counts.layoutBoundsReads++;
    if (state.counts.layoutBoundsReads <= 32) { const stack = new Error().stack; if (stack && state.layoutStacks.length < 16 && !state.layoutStacks.includes(stack)) state.layoutStacks.push(stack); }
  });
  function tick(now) { state.frame++; state.lastFrame = now; if (state.active) state.counts.frames++; state.raf = requestAnimationFrame(tick); }
  state.raf = requestAnimationFrame(tick);
  globalThis.__spaceSimRenderProbe = {
    start() { state.counts = fresh(); state.layoutStacks = []; state.start = performance.now(); state.active = true; },
    stop() { state.active = false; return { ...state.counts, durationMs: performance.now() - state.start,
      requestedLiveBufferBytes: state.requestedBufferBytes, peakRequestedBufferBytes: state.peakRequestedBufferBytes,
      layoutStacks: [...state.layoutStacks], contexts: state.contexts, contextLosses: state.contextLosses, overflow: state.overflow, ablation: state.ablation,
      scope: 'Instrumented API requests/source-qualified roles across contexts; not native/GPU peaks or bare timing' }; },
    restore() { state.active = false; cancelAnimationFrame(state.raf); for (const undo of restores.reverse()) undo(); delete globalThis.__spaceSimRenderProbe; },
  };
}

/** Separate asynchronous main-canvas GPU draw span; excludes preceding clears and guests. */
export async function gpuDrawSpans(durationMs = 3000) {
  const proto = WebGL2RenderingContext.prototype, saved = { drawArrays: proto.drawArrays, drawArraysInstanced: proto.drawArraysInstanced };
  let data, disjoint = false; const samples = [];
  const poll = () => {
    if (!data?.ext) return;
    disjoint ||= !!data.gl.getParameter(data.ext.GPU_DISJOINT_EXT);
    for (let i = data.pending.length - 1; i >= 0; i--) if (data.gl.getQueryParameter(data.pending[i], data.gl.QUERY_RESULT_AVAILABLE)) {
      if (samples.length < 8192) samples.push(data.gl.getQueryParameter(data.pending[i], data.gl.QUERY_RESULT) / 1e6);
      data.gl.deleteQuery(data.pending[i]); data.pending.splice(i, 1);
    }
  };
  try {
    for (const key of Object.keys(saved)) proto[key] = function (...a) {
      if (this.canvas.id === 'flight-view') {
        data ??= { gl: this, ext: this.getExtension('EXT_disjoint_timer_query_webgl2'), pending: [], active: false };
        if (data.ext && !data.active && data.pending.length < 32) {
          const q = this.createQuery(); data.active = true; this.beginQuery(data.ext.TIME_ELAPSED_EXT, q);
          queueMicrotask(() => { this.endQuery(data.ext.TIME_ELAPSED_EXT); data.active = false; data.pending.push(q); });
        }
      }
      return Reflect.apply(saved[key], this, a);
    };
    await new Promise(done => { let start; function frame(t) { start ??= t; poll(); if (t - start >= durationMs) done(); else requestAnimationFrame(frame); } requestAnimationFrame(frame); });
  } finally { Object.assign(proto, saved); }
  for (let i = 0; i < 4; i++) { await new Promise(requestAnimationFrame); poll(); }
  if (data) for (const q of data.pending) data.gl.deleteQuery(q);
  samples.sort((a,b) => a-b);
  return { supported: !!data?.ext, disjoint, samples: disjoint ? [] : samples,
    scope: 'Separate instrumented first-to-last main synchronous draw span; excludes preceding clears and guest contexts' };
}
