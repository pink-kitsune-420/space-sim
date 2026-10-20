import { CORE_SAVE, CORE_UNIVERSE_FORMAT, UNIVERSE_SAVES,
  type SaveCodec, type UniverseSaveFormat, type UniverseSaveFactory, type UniverseSaveOptions, type UniverseSaveCommands, type ModuleInitializationV2 } from '@space-sim/game-api';

/** One operation per controller; async work retains an explicit source identity. */
export function createUniverseSaves(codec: Pick<SaveCodec,'save'>, format: UniverseSaveFormat): UniverseSaveFactory & {dispose():void} {
  const controllers = new Set<UniverseSaveCommands>(); let disposed = false;
  return Object.freeze({ create(options: UniverseSaveOptions): UniverseSaveCommands {
    if (disposed) throw new Error('Universe save provider disposed');
    let closed = false, pending: AbortController | undefined;
    async function run<T>(operation: 'save'|'load', signal: AbortSignal | undefined, work: (source: ReturnType<UniverseSaveOptions['current']>, signal: AbortSignal, guard: () => void) => Promise<T>): Promise<T> {
      if (closed) throw new Error('Universe save commands disposed');
      signal?.throwIfAborted(); if (pending) throw new Error('A universe save or load is already in progress');
      const source = options.current();
      if (operation === 'save' ? !source.canSave : !source.canLoad) throw new Error(operation === 'save' ? 'This session cannot save universes.' : 'Load universe saves in your solo game.');
      const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', abort, {once:true}); pending = controller;
      const guard = (): void => {
        controller.signal.throwIfAborted(); const current = options.current();
        if (current.identity !== source.identity || current.world !== source.world || (operation === 'save' ? !current.canSave : !current.canLoad))
          throw new Error(`The active session changed while ${operation === 'save' ? 'saving' : 'loading'}.`);
      };
      try { guard(); return await work(source,controller.signal,guard); }
      finally { signal?.removeEventListener('abort',abort); if(pending===controller) pending=undefined; }
    }
    const commands = Object.freeze<UniverseSaveCommands>({
      save: (write,signal) => run('save',signal,async(source,owned,guard)=>{
        const date = new Date(), save = codec.save(source.world,{...source.options,savedAt:date.toISOString()});
        const bytes = await format.encode(save,owned); guard();
        const name = `${save.universe.id.replace(/[^a-z0-9._-]/gi,'-').slice(0,80)}-${date.toISOString().slice(0,19).replace(/:/g,'-')}.spaceuniverse`;
        await write(name,bytes,owned); return save;
      }),
      load: (read,signal) => run('load',signal,async(_source,owned,guard)=>{
        const bytes = await read(owned); guard();
        if (bytes.byteLength > 64*1024*1024) throw new Error('Universe save files must be at most 64 MiB.');
        const raw = await format.decode(bytes,owned); guard();
        await options.restore(raw,owned,guard);
      }),
      dispose(){if(closed)return;closed=true;pending?.abort(new Error('Universe save commands disposed'));controllers.delete(commands);},
    });
    controllers.add(commands); return commands;
  },dispose(){if(disposed)return;disposed=true;for(const controller of controllers)controller.dispose();controllers.clear();} });
}
/**
 * Contributes single-operation universe save and load command controllers.
 * Provides universe.saves@1.0.0 in slot universe.saves.
 * Requires core.save@^1.0.0 and core.universe-save-format@^1.0.0.
 */
export default function initialize(context: ModuleInitializationV2): void {
  context.provide(UNIVERSE_SAVES,context.own(createUniverseSaves(context.use(CORE_SAVE),context.use(CORE_UNIVERSE_FORMAT))));
  context.contributeGuide({id:'usage',audience:'creators',title:'Universe save commands',summary:'Cancellable save/load over engine validation and independently selected storage.',asset:'docs/creators/usage.json'});
}
