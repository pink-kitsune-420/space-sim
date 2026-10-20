import { describe, expect, it } from 'vitest';
import { validatePackage } from '../../packages/module-tools/package.mjs';
import { benchmarkModuleHook } from '../../packages/module-tools/benchmark.mjs';

describe('Branch 7: Build-Time Command Linting & Hook Benchmarks', () => {
  it('validatePackage throws error when module command binds KeyP or KeyX in default flight context', () => {
    const pkgP = {
      manifest: {
        id: 'example.module',
        commands: [
          { id: 'pause-cmd', label: 'Pause', key: 'KeyP' }
        ]
      }
    };
    expect(() => validatePackage(pkgP)).toThrow(
      'Package validation error in module example.module: command "pause-cmd" binds reserved key "KeyP". Either change the shortcut or specify a non-flight modal context (e.g. context: \'eva\').'
    );

    const pkgX = {
      manifest: {
        id: 'example.module',
        commands: [
          { id: 'throttle-cmd', label: 'Cut Throttle', key: 'KeyX', context: 'flight' }
        ]
      }
    };
    expect(() => validatePackage(pkgX)).toThrow(
      'Package validation error in module example.module: command "throttle-cmd" binds reserved key "KeyX". Either change the shortcut or specify a non-flight modal context (e.g. context: \'eva\').'
    );
  });

  it('validatePackage allows KeyX when command context is \'eva\' or \'editor\'', () => {
    const pkgEva = {
      manifest: {
        id: 'example.module',
        commands: [
          { id: 'eva-shortcut', label: 'EVA Shortcut', key: 'KeyX', context: 'eva' }
        ]
      }
    };
    expect(() => validatePackage(pkgEva)).not.toThrow();

    const pkgEditor = {
      manifest: {
        id: 'example.module',
        commands: [
          { id: 'editor-shortcut', label: 'Editor Shortcut', key: 'KeyX', context: 'editor' }
        ]
      }
    };
    expect(() => validatePackage(pkgEditor)).not.toThrow();
  });

  it('benchmarkModuleHook accurately reports p50, p95, p99 microsecond latencies', () => {
    const hook = {
      modelIdentity: 'timing-test-hook',
      evaluate() {
        let sum = 0;
        for (let i = 0; i < 50; i++) sum += i;
        return { state: sum };
      }
    };
    const report = benchmarkModuleHook(hook, { warmup: 500, iterations: 2000 });
    expect(report.hookName).toBe('timing-test-hook');
    expect(report.iterations).toBe(2000);
    expect(typeof report.timing.p50Microseconds).toBe('number');
    expect(typeof report.timing.p95Microseconds).toBe('number');
    expect(typeof report.timing.p99Microseconds).toBe('number');
    expect(typeof report.timing.maxMicroseconds).toBe('number');
    expect(typeof report.timing.meanMicroseconds).toBe('number');
    expect(report.timing.p50Microseconds).toBeGreaterThanOrEqual(0);
    expect(report.timing.p95Microseconds).toBeGreaterThanOrEqual(report.timing.p50Microseconds);
    expect(report.timing.p99Microseconds).toBeGreaterThanOrEqual(report.timing.p95Microseconds);
    expect(report.timing.maxMicroseconds).toBeGreaterThanOrEqual(report.timing.p99Microseconds);
  });

  it('benchmarkModuleHook detects zero-allocation loops (bytesPerTick === 0)', () => {
    const staticResult = Object.freeze({ state: Object.freeze({}) });
    let counter = 0;
    const zeroAllocHook = {
      modelIdentity: 'zero-alloc-rule',
      evaluate() {
        counter++;
        return staticResult;
      }
    };
    const report = benchmarkModuleHook(zeroAllocHook, { warmup: 1000, iterations: 2000 });
    expect(report.allocation.bytesPerTick).toBe(0);
    expect(report.status).toBe('pass');
  });

  it('benchmarkModuleHook flags memory-leaking hooks allocating objects in inner loops', () => {
    const retained: unknown[] = [];
    const leakingHook = {
      modelIdentity: 'leaker',
      evaluate() {
        const payload = { items: new Array(500).fill(Math.random()) };
        retained.push(payload);
        return { state: payload };
      }
    };
    const report = benchmarkModuleHook(leakingHook, { warmup: 100, iterations: 500 });
    expect(report.allocation.bytesPerTick).toBeGreaterThan(0);
    expect(report.status).not.toBe('pass');
  });
});
