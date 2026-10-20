// Headless Hook Benchmarking & Allocation Harness (REC-13)
// Measures latency percentiles and garbage collector heap allocation per tick.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Headless benchmarking utility executing a WorldRuleHook, ForceHook, or function
 * for N deterministic ticks.
 *
 * @param {unknown} hook A hook object with an evaluate() method or a direct function.
 * @param {import('./benchmark.d.mts').BenchmarkOptions} [options]
 * @returns {import('./benchmark.d.mts').BenchmarkReport}
 */
export function benchmarkModuleHook(hook, options = {}) {
  if (!hook || (typeof hook !== 'function' && typeof hook.evaluate !== 'function')) {
    throw new Error('Invalid hook: expected a function or an object with an evaluate() method');
  }

  const hookObj = /** @type {Record<string, unknown>} */ (hook);
  const hookName = (typeof hook === 'function' ? hook.name : (hookObj.modelIdentity || hookObj.name)) || 'anonymousHook';
  const fn = typeof hook === 'function' ? hook : hook.evaluate.bind(hook);

  const warmup = options.warmup ?? 1000;
  const iterations = options.iterations ?? 10000;
  let currentState = options.state ?? (typeof hookObj.initialState !== 'undefined' ? hookObj.initialState : {});

  // Deterministic reusable input context
  const input = {
    tick: 0,
    time: 0,
    seconds: 0.02,
    ships: [],
    events: [],
    state: currentState,
    math: Math,
    random: () => 0.5,
    dt: 0.02,
  };

  // 1. Warmup loop to settle V8 JIT compilation and IC inline caches
  for (let i = 0; i < warmup; i++) {
    input.tick = i;
    input.time = i;
    input.state = currentState;
    const result = fn(input);
    if (result && typeof result === 'object' && 'state' in result && typeof result.state !== 'undefined') {
      currentState = result.state;
    }
  }

  // 2. Heap Allocation Measurement Loop
  for (let i = 0; i < 5; i++) process.memoryUsage();
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
  const M = Math.min(iterations, 1000);
  const initialHeap = process.memoryUsage().heapUsed;
  for (let i = 0; i < M; i++) {
    input.tick = i;
    input.time = i;
    input.state = currentState;
    const result = fn(input);
    if (result && typeof result === 'object' && 'state' in result && typeof result.state !== 'undefined') {
      currentState = result.state;
    }
  }
  const finalHeap = process.memoryUsage().heapUsed;
  const rawBytesPerTick = (finalHeap - initialHeap) / M;
  // Node's process.memoryUsage() call itself creates an object of ~240 bytes (0.24 bytes/tick).
  // Real object allocations in V8 are at least 24 bytes per tick.
  const bytesPerTick = rawBytesPerTick > 1 ? Math.round(rawBytesPerTick) : 0;

  // 3. Timing Measurement Loop
  const durations = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    input.tick = i;
    input.time = i;
    input.state = currentState;
    const start = performance.now();
    const result = fn(input);
    const end = performance.now();
    durations[i] = (end - start) * 1000; // milliseconds to microseconds
    if (result && typeof result === 'object' && 'state' in result && typeof result.state !== 'undefined') {
      currentState = result.state;
    }
  }
  durations.sort(); // Float64Array sorts numerically ascending

  const rank = p => Math.floor((p / 100) * (iterations - 1));
  const p50Microseconds = durations[rank(50)];
  const p95Microseconds = durations[rank(95)];
  const p99Microseconds = durations[rank(99)];
  const maxMicroseconds = durations[iterations - 1];
  let totalDuration = 0;
  for (let i = 0; i < iterations; i++) totalDuration += durations[i];
  const meanMicroseconds = totalDuration / iterations;

  // 4. Status determination
  let status = 'pass';
  if (bytesPerTick > 512 || p99Microseconds > 16666) {
    status = 'fail';
  } else if (bytesPerTick > 0 || p99Microseconds > 5000) {
    status = 'warn';
  }

  return {
    hookName: String(hookName),
    iterations,
    timing: {
      p50Microseconds,
      p95Microseconds,
      p99Microseconds,
      maxMicroseconds,
      meanMicroseconds,
    },
    allocation: {
      bytesPerTick,
    },
    status,
  };
}

/**
 * CLI runner for benchmarking module hooks.
 */
export async function run(args) {
  try {
    const target = args[0];
    let hook;
    if (target) {
      const modulePath = resolve(process.cwd(), target);
      const mod = await import(pathToFileURL(modulePath).href);
      hook = mod.default || mod.hook || mod.evaluate || mod;
    } else {
      // Default dummy benchmark demonstration
      hook = {
        modelIdentity: 'sample-zero-alloc-hook',
        initialState: Object.freeze({ counter: 0 }),
        evaluate(input) {
          return { state: input.state };
        },
      };
    }

    const report = benchmarkModuleHook(hook, { iterations: 10000, warmup: 1000 });
    console.log(`\n=== Benchmark Report: ${report.hookName} ===`);
    console.log(`Iterations: ${report.iterations.toLocaleString()}`);
    console.log(`Latency p50:  ${report.timing.p50Microseconds.toFixed(2)} µs`);
    console.log(`Latency p95:  ${report.timing.p95Microseconds.toFixed(2)} µs`);
    console.log(`Latency p99:  ${report.timing.p99Microseconds.toFixed(2)} µs`);
    console.log(`Latency max:  ${report.timing.maxMicroseconds.toFixed(2)} µs`);
    console.log(`Latency mean: ${report.timing.meanMicroseconds.toFixed(2)} µs`);
    console.log(`Allocation:   ${report.allocation.bytesPerTick} bytes/tick`);
    console.log(`Status:       ${report.status.toUpperCase()}\n`);
  } catch (error) {
    console.error(`Benchmark failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await run(process.argv.slice(2));
}
