import type { ForceExtension, ModuleState, MotionContextOptions, MotionServices, MotionStep, State, Vec } from '../../game-api/src/index';

export const MAX_MODULE_STATE_BYTES = 16_384;
export const MAX_FORCE_ACCELERATION = 10_000;

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Used only on custom motion paths; built-in ship/force loops keep their fast path. */
export function motionCopy<T>(value: T): T { return freeze(structuredClone(value)); }

export function validateModuleState(raw: ModuleState): ModuleState {
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > MAX_MODULE_STATE_BYTES || depth > 32) throw new Error('module state exceeds structural limits');
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (value && typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
      if (Array.isArray(value) && (value.length !== Object.keys(value).length || Object.keys(value).some((key, index) => key !== String(index)))) throw new Error('module state arrays must be dense JSON arrays');
      for (const child of Object.values(value)) visit(child, depth + 1);
      return;
    }
    throw new Error('module state must contain finite JSON values');
  };
  if (!raw || !Number.isSafeInteger(raw.version) || raw.version < 1
    || Object.keys(raw).some(key => key !== 'version' && key !== 'value')) throw new Error('invalid module state schema version');
  visit(raw.value, 0);
  if (new TextEncoder().encode(JSON.stringify(raw)).length > MAX_MODULE_STATE_BYTES) throw new Error('module state exceeds 16 KiB');
  return motionCopy(raw);
}

function finiteVector(v: Vec): boolean { return !!v && Number.isFinite(v.x) && Number.isFinite(v.y); }
function checkedService<T>(id: string, hook: string, work: () => T): T {
  try { return work(); }
  catch (error) { throw new Error(`Module ${id} ${hook}: ${(error as Error).message}`, { cause: error }); }
}

const CAPTURED_SERVICES = new WeakSet<object>();

/** Validate trusted static adapters before world construction; capture their dispatch once. */
function captureServices(services: Partial<MotionServices> = {}): Partial<MotionServices> {
  const methods: Record<string, readonly string[]> = {
    orbits: ['elements', 'propagate', 'timeToRadius'], bodies: ['load'],
    surfaces: ['generate', 'identity', 'validate', 'query', 'support', 'sweep', 'sweepGround'], rails: ['horizon'],
  };
  return Object.freeze(Object.fromEntries(Object.entries(services).map(([slot, raw]) => {
    const service = raw as unknown as Record<string, unknown>;
    if (!methods[slot] || !service || !['id', 'version', 'modelIdentity'].every(k => typeof service[k] === 'string' && service[k])
      || !methods[slot]!.every(k => typeof service[k] === 'function')) throw new Error(`Invalid ${slot} provider`);
    if (slot === 'orbits' && typeof service.analytic !== 'boolean') throw new Error('Invalid orbital analytic capability');
    if (slot === 'rails' && (!Array.isArray(service.compatible) || service.compatible.length > 256
      || !service.compatible.every(b => b && ['dynamics', 'orbits', 'bodies', 'surfaces'].every(k => typeof b[k] === 'string' && b[k])))) throw new Error('Invalid rails compatibility bindings');
    if (CAPTURED_SERVICES.has(raw)) return [slot, raw];
    const captured: Record<string, unknown> = { ...service, ...(slot === 'rails' ? { compatible: motionCopy(service.compatible) } : {}) };
    if (slot === 'orbits') {
      const p = raw as MotionServices['orbits'];
      const { id, elements: getElements, propagate: propagateState, timeToRadius: radiusTime } = p;
      captured.elements = (state: Parameters<typeof p.elements>[0], mu: number) => checkedService(id, 'orbits.elements', () => {
        const e = getElements(motionCopy(state), mu);
        if (!e || !['energy', 'angularMomentum', 'eccentricity', 'semilatusRectum', 'periapsis'].every(k => Number.isFinite(e[k as keyof typeof e]))
          || !['apoapsis', 'semiMajorAxis', 'period', 'periapsisAngle'].every(k => e[k as keyof typeof e] === null || Number.isFinite(e[k as keyof typeof e]))
          || !finiteVector(e.eccentricityVector) || e.periapsis < 0 || e.eccentricity < 0
          || typeof e.radial !== 'boolean' || !['elliptic', 'parabolic', 'hyperbolic'].includes(e.kind)) throw new Error('invalid orbital elements');
        return motionCopy(e);
      });
      captured.propagate = (state: Parameters<typeof p.propagate>[0], mu: number, seconds: number, options?: Parameters<typeof p.propagate>[3]) => checkedService(id, 'orbits.propagate', () => {
        const result = propagateState(motionCopy(state), mu, seconds, options && motionCopy(options));
        if (!result || typeof result.ok !== 'boolean' || !result.diagnostics
          || typeof result.diagnostics.converged !== 'boolean'
          || (result.ok && (!result.diagnostics.converged || !finiteVector(result.state.position) || !finiteVector(result.state.velocity)))) throw new Error('invalid orbital propagation');
        return motionCopy(result);
      });
      captured.timeToRadius = (state: Parameters<typeof p.timeToRadius>[0], mu: number, radius: number, direction: 'inbound' | 'outbound', elements?: Parameters<typeof p.timeToRadius>[4]) => checkedService(id, 'orbits.timeToRadius', () => {
        const seconds = radiusTime(motionCopy(state), mu, radius, direction, elements && motionCopy(elements));
        if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0)) throw new Error('invalid orbital event bound');
        return seconds;
      });
    }
    CAPTURED_SERVICES.add(captured);
    return [slot, Object.freeze(captured)];
  })));
}

/** Captures the immutable schedule once; there is no registration during an update. */
export function captureMotionOptions(options: MotionContextOptions): MotionContextOptions {
  if ((options.forces?.length ?? 0) > 256) throw new Error('Force schedule exceeds 256 modules');
  const ids = new Set<string>();
  const forces = (options.forces ?? []).map(({ moduleId, version, hook }) => {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(moduleId) || ids.has(moduleId)) throw new Error(`Module ${moduleId}: invalid or duplicate force namespace`);
    ids.add(moduleId);
    if (!hook.modelIdentity || typeof hook.modelIdentity !== 'string' || typeof hook.evaluate !== 'function') throw new Error(`Module ${moduleId}: invalid force hook`);
    try {
      return Object.freeze({ moduleId, version, hook: Object.freeze({ modelIdentity: hook.modelIdentity,
        initialState: validateModuleState(hook.initialState), evaluate: hook.evaluate, commit: hook.commit }) });
    } catch (error) { throw new Error(`Module ${moduleId} force initialState: ${(error as Error).message}`, { cause: error }); }
  });
  const d = options.dynamics;
  if (d && (!d.id || !d.version || !d.modelIdentity || typeof d.step !== 'function' || typeof d.supportsForces !== 'boolean')) throw new Error('Invalid dynamics provider');
  if (d && forces.length && !d.supportsForces) throw new Error(`Module ${d.id}: dynamics does not support force contributions`);
  return Object.freeze({ worldRules: !!options.worldRules, worldRuleIdentity: options.worldRuleIdentity, services: captureServices(options.services), forces: Object.freeze(forces), ...(d ? { dynamics: Object.freeze({ id: d.id, version: d.version,
    modelIdentity: d.modelIdentity, supportsForces: d.supportsForces, step: d.step }) } : {}) });
}

function hookCall<T>(id: string, hook: string, tick: number, work: () => T): T {
  try { return work(); }
  catch (error) { throw new Error(`Module ${id} ${hook} tick ${tick}: ${(error as Error).message}`, { cause: error }); }
}

/** Per-ship proposal. Nothing is published until motion and every commit validate. */
export class ForceTransaction {
  readonly input: MotionStep;
  readonly tick: number;
  private readonly states: Record<string, ModuleState> = Object.create(null);
  constructor(private readonly forces: readonly ForceExtension[], input: MotionStep) {
    this.input = Object.freeze({ ...input, state: motionCopy(input.state), controls: motionCopy(input.controls), body: motionCopy(input.body) });
    this.tick = Math.round(input.state.time / .01);
    const enabled = new Set(forces.map(f => f.moduleId));
    for (const id of Object.keys(input.state.moduleState ?? {})) if (!enabled.has(id)) throw new Error(`Module ${id}: state has no active force hook`);
    for (const { moduleId, hook } of forces) this.states[moduleId] = hookCall(moduleId, 'force.state', this.tick, () => {
      const state = validateModuleState(input.state.moduleState?.[moduleId] ?? hook.initialState);
      if (state.version !== hook.initialState.version) throw new Error('unsupported module state version');
      return state;
    });
  }
  acceleration(time: number, position: Vec, velocity: Vec): Vec {
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(this.input.state.time)) * 8;
    if (!Number.isFinite(time) || time < this.input.state.time - tolerance || time > this.input.state.time + this.input.seconds + tolerance
      || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) {
      throw new Error(`Force schedule tick ${this.tick}: invalid integrator stage`);
    }
    let x = 0, y = 0;
    for (const { moduleId, hook } of this.forces) {
      const a = hookCall(moduleId, 'force.evaluate', this.tick, () => {
        const result = hook.evaluate(Object.freeze({ tick: this.tick, time, position: motionCopy(position), velocity: motionCopy(velocity),
          body: this.input.body, controls: this.input.controls, state: this.states[moduleId]! }));
        if (!result || !Number.isFinite(result.x) || !Number.isFinite(result.y)
          || Math.abs(result.x) > MAX_FORCE_ACCELERATION || Math.abs(result.y) > MAX_FORCE_ACCELERATION) throw new Error('acceleration must be finite and bounded to 10000 m/s² per component');
        return { x: result.x, y: result.y };
      });
      x += a.x; y += a.y;
    }
    if (!Number.isFinite(x + y) || Math.abs(x) > MAX_FORCE_ACCELERATION || Math.abs(y) > MAX_FORCE_ACCELERATION) throw new Error(`Force schedule tick ${this.tick}: combined acceleration exceeds 10000 m/s²`);
    return { x, y };
  }
  commit(next: State): State {
    const verified = motionCopy(next);
    for (const { moduleId, hook } of this.forces) {
      if (hook.commit) this.states[moduleId] = hookCall(moduleId, 'force.commit', this.tick, () => {
        const proposed = hook.commit!(Object.freeze({ ...this.input, next: verified, moduleState: this.states[moduleId]! }));
        if (proposed.version !== hook.initialState.version) throw new Error('module state schema changes require a restart/migration');
        return validateModuleState(proposed);
      });
    }
    return this.forces.length ? Object.freeze({ ...verified, moduleState: Object.freeze(this.states) }) : verified;
  }
}

export function runDynamics<T>(id: string, tick: number, work: () => T): T { return hookCall(id, 'dynamics.step', tick, work); }
