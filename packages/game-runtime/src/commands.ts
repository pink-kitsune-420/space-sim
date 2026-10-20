/** Host-only (`packages/game-runtime`): pilot command capture and argument/effect validation. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); modules register commands with `contributeCommand` and hosts run them through `CORE_COMMANDS`. */
import type { CommandEffect, CommandExtension, CommandHook, CommandParameter, ModuleValue, Ship } from '../../game-api/src/index';
import { motionCopy, validateModuleState } from './motion';

/** Most `contributeCommand` hooks per module (`32`; `Module <id>: at most 32 commands`). Host-only (`packages/game-runtime`). */
export const MAX_COMMANDS_PER_MODULE = 32;
/** Most numeric parameters per command (`8`). Host-only (`packages/game-runtime`). */
export const MAX_COMMAND_PARAMETERS = 8;
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const KEY = /^(?:Key[A-Z]|Digit[0-9])$/;
const PARAMETER = /^[a-z][A-Za-z0-9]{0,31}$/;
const MODULE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
/** `<module id>/<command name>`, as sent over the network. */
export const COMMAND_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\/[a-z][a-z0-9-]{0,31}$/;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function parameter(id: string, key: string, raw: unknown): CommandParameter {
  const p = raw as Record<string, unknown> | null;
  const label = `Command ${id} parameter ${key}`;
  if (!PARAMETER.test(key) || !p || typeof p !== 'object' || Array.isArray(p)
    || Object.keys(p).some(k => !['type', 'default', 'minimum', 'maximum', 'integer'].includes(k))) throw new Error(`${label}: invalid schema`);
  if (p.type !== 'number' || !finite(p.default) || !finite(p.minimum) || !finite(p.maximum)
    || p.minimum > p.default || p.default > p.maximum) throw new Error(`${label}: expected a number schema with minimum ≤ default ≤ maximum`);
  if (p.integer !== undefined && typeof p.integer !== 'boolean') throw new Error(`${label}: integer must be boolean`);
  if (p.integer && ![p.default, p.minimum, p.maximum].every(Number.isInteger)) throw new Error(`${label}: integer bounds and default must be integers`);
  return Object.freeze({ type: 'number', default: p.default, minimum: p.minimum, maximum: p.maximum, ...(p.integer ? { integer: true } : {}) });
}

/** Validate a hook once, at registration, and freeze its declaration and callback. */
export function captureCommand(moduleId: string, version: string, raw: CommandHook): CommandExtension {
  if (!MODULE.test(moduleId)) throw new Error(`Module ${moduleId}: invalid command namespace`);
  const hook = raw as unknown as Record<string, unknown> | null;
  if (!hook || typeof hook !== 'object') throw new Error(`Module ${moduleId}: invalid command`);
  if (typeof hook.name !== 'string' || !NAME.test(hook.name)) throw new Error(`Module ${moduleId} command: name must be 1–32 lowercase letters, digits or hyphens`);
  const id = `${moduleId}/${hook.name}`;
  if (Object.keys(hook).some(k => !['name', 'label', 'key', 'parameters', 'resolve'].includes(k))) throw new Error(`Command ${id}: unknown field`);
  if (typeof hook.label !== 'string' || !hook.label.trim() || hook.label.length > 32) throw new Error(`Command ${id}: label must contain 1–32 characters`);
  if (hook.key !== undefined && (typeof hook.key !== 'string' || !KEY.test(hook.key))) throw new Error(`Command ${id}: key must be KeyA–KeyZ or Digit0–Digit9`);
  if (typeof hook.resolve !== 'function') throw new Error(`Command ${id}: resolve must be a function`);
  const declared = hook.parameters ?? {};
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) throw new Error(`Command ${id}: parameters must be an object`);
  const entries = Object.entries(declared);
  if (entries.length > MAX_COMMAND_PARAMETERS) throw new Error(`Command ${id}: at most ${MAX_COMMAND_PARAMETERS} parameters`);
  const parameters: Record<string, CommandParameter> = Object.create(null);
  for (const [key, value] of entries) parameters[key] = parameter(id, key, value);
  return Object.freeze({ moduleId, version, id, hook: Object.freeze({ name: hook.name, label: hook.label.trim(),
    ...(hook.key ? { key: hook.key as string } : {}), parameters: Object.freeze(parameters),
    resolve: hook.resolve as CommandHook['resolve'] }) });
}

/** A world's command table: unique IDs and keys, in resolved module order. */
export function captureCommands(commands: readonly CommandExtension[]): readonly CommandExtension[] {
  if (commands.length > 1024) throw new Error('Command table exceeds 1024 commands');
  const ids = new Set<string>(), keys = new Map<string, string>();
  return Object.freeze(commands.map(c => {
    const command = captureCommand(c.moduleId, c.version, c.hook);
    if (command.id !== c.id || ids.has(command.id)) throw new Error(`Command ${c.id}: invalid or duplicate ID`);
    const key = command.hook.key;
    if (key && keys.has(key)) throw new Error(`Command ${command.id}: key ${key} is already bound to ${keys.get(key)}`);
    ids.add(command.id);
    if (key) keys.set(key, command.id);
    return command;
  }));
}

/** Untrusted arguments from a pilot: only declared finite numbers within bounds. */
export function commandArguments(command: CommandExtension, raw: unknown = {}): Readonly<Record<string, number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Command ${command.id}: arguments must be an object`);
  const parameters = command.hook.parameters ?? {};
  const args: Record<string, number> = Object.create(null);
  for (const key of Object.keys(raw)) if (!Object.hasOwn(parameters, key)) throw new Error(`Command ${command.id}: unknown argument ${key}`);
  for (const [key, p] of Object.entries(parameters)) {
    const value = Object.hasOwn(raw, key) ? (raw as Record<string, unknown>)[key] : p.default;
    if (!finite(value) || value < p.minimum || value > p.maximum || (p.integer && !Number.isInteger(value))) {
      throw new Error(`Command ${command.id} argument ${key}: must be ${p.integer ? 'an integer' : 'a number'} in [${p.minimum}, ${p.maximum}]`);
    }
    args[key] = value;
  }
  return Object.freeze(args);
}

function effect(command: CommandExtension, raw: unknown): CommandEffect {
  const e = raw as Record<string, unknown> | null;
  if (e && typeof (e as { then?: unknown }).then === 'function') throw new Error('invalid command effect: asynchronous commands are unsupported');
  if (!e || typeof e !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(e))
    || Object.keys(e).some(k => k !== 'controls' && k !== 'throttle' && k !== 'moduleEvent')) throw new Error('invalid command effect');
  const c = e.controls as Record<string, unknown> | undefined;
  if (c !== undefined && (!c || typeof c !== 'object' || Object.keys(c).some(k => !['turn', 'throttle', 'engine'].includes(k))
    || !finite(c.turn) || Math.abs(c.turn) > 1 || !finite(c.throttle) || Math.abs(c.throttle) > 1
    || typeof c.engine !== 'boolean')) throw new Error('invalid command controls');
  if (e.throttle !== undefined && (!finite(e.throttle) || e.throttle < 0 || e.throttle > 1)) throw new Error('invalid command throttle');
  let moduleEvent: { readonly type: string; readonly payload: ModuleValue } | undefined;
  if (e.moduleEvent !== undefined) {
    const m = e.moduleEvent as Record<string, unknown> | null;
    if (!m || typeof m !== 'object' || Object.keys(m).some(k => k !== 'type' && k !== 'payload')
      || typeof m.type !== 'string' || !m.type) throw new Error('invalid command module event');
    const payload = validateModuleState({ version: 1, value: m.payload as ModuleValue }).value;
    moduleEvent = Object.freeze({ type: m.type, payload });
  }
  if (c === undefined && e.throttle === undefined && moduleEvent === undefined) throw new Error(`empty effect from ${command.id}`);
  return Object.freeze({ ...(c ? { controls: Object.freeze({ turn: c.turn as number, throttle: c.throttle as number, engine: c.engine as boolean }) } : {}),
    ...(e.throttle !== undefined ? { throttle: e.throttle as number } : {}),
    ...(moduleEvent !== undefined ? { moduleEvent } : {}) });
}

/** Run one command for the authoritative host. The caller has checked ownership; this
 * validates arguments and the proposed effect before anything is applied. Exposed to hosts and
 * modules as `CORE_COMMANDS.resolve`. Errors read `Module <id> command <command id> tick <n>: <message>`. */
export function resolveCommand(command: CommandExtension, ship: Ship, rawArgs: unknown, tick: number, time: number): CommandEffect {
  const args = commandArguments(command, rawArgs);
  try {
    return effect(command, command.hook.resolve(Object.freeze({ tick, time, ship: motionCopy(ship), args })));
  } catch (error) {
    throw new Error(`Module ${command.moduleId} command ${command.id} tick ${tick}: ${(error as Error).message}`, { cause: error });
  }
}
