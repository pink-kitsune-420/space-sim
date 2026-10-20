export interface BenchmarkOptions {
  /** Number of warmup iterations before measuring (default: 1000). */
  readonly warmup?: number;
  /** Number of measured tick iterations (default: 10_000). */
  readonly iterations?: number;
  /** Custom state to pass to hook. */
  readonly state?: unknown;
}

export interface BenchmarkReport {
  readonly hookName: string;
  readonly iterations: number;
  readonly timing: {
    readonly p50Microseconds: number;
    readonly p95Microseconds: number;
    readonly p99Microseconds: number;
    readonly maxMicroseconds: number;
    readonly meanMicroseconds: number;
  };
  readonly allocation: {
    /** Estimated heap allocation per tick in bytes. Must be 0 for zero-allocation inner loops. */
    readonly bytesPerTick: number;
  };
  readonly status: 'pass' | 'warn' | 'fail';
}

export function benchmarkModuleHook(hook: unknown, options?: BenchmarkOptions): BenchmarkReport;
export function run(args: string[]): Promise<void>;
