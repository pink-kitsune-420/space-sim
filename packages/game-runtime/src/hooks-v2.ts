import type { ActionDefinitionV2, ActionSink, DiscoveryProvider, Disposable, GuidePage, InputFrame, InputSource,
  MaterialDefinition, ModuleContribution, ModuleHookFault, PostEffectDefinition, ServerAdvert, TextConnection,
  TransportProvider, UiControl, WindowDefinition, WindowContentDefinition, PreviewData } from '../../game-api/src/index';
import { captureDocument, capturePreviewData } from '../../game-api/src/index';
import { artifactPath } from './artifact';
import { freezeJson, keys, object, string, version } from './validation';

const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const ACTION = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\/[a-z][a-z0-9-]{0,63}$/;
export function contributionName(raw: unknown): string {
  if (typeof raw !== 'string' || !NAME.test(raw)) throw new Error('Contribution name must be 1–32 lowercase letters, digits or hyphens');
  return raw;
}
function method<T extends object, K extends keyof T>(raw: T, key: K): T[K] {
  if (typeof raw[key] !== 'function') throw new Error(`${String(key)} must be a function`);
  return (raw[key] as Function).bind(raw) as T[K];
}
export function captureActions(raw: readonly ActionDefinitionV2[], moduleId: string): readonly ActionDefinitionV2[] {
  if (!Array.isArray(raw) || raw.length > 128) throw new Error('At most 128 actions per module');
  return freezeJson(raw.map(value => {
    const a = object(value, 'Action'); keys(a, ['id', 'label', 'category', 'mode', 'defaultKeys'], 'Action');
    if (typeof a.id !== 'string' || !ACTION.test(a.id) || !a.id.startsWith(`${moduleId}/`)) throw new Error('Action must use its module namespace');
    if (!['flight', 'warp', 'view', 'system'].includes(a.category as string) || !['held', 'axis', 'press'].includes(a.mode as string)) throw new Error('Invalid action category/mode');
    if (!Array.isArray(a.defaultKeys) || a.defaultKeys.length > 16) throw new Error('At most 16 default keys per action');
    return { id: a.id, label: string(a.label, 'Action label'), category: a.category, mode: a.mode,
      defaultKeys: a.defaultKeys.map(k => string(k, 'Default key')) } as ActionDefinitionV2;
  }));
}
export function captureWindow(raw: WindowDefinition): WindowDefinition {
  const w = object(raw, 'Window'); keys(w, ['name', 'title', 'controls', 'content'], 'Window');
  if (!Array.isArray(w.controls) || w.controls.length > 128) throw new Error('At most 128 controls per window');
  const ids = new Set<string>();
  const controls = w.controls.map(value => {
    const c = object(value, 'Control'), kind = c.kind;
    const fields = kind === 'text' ? ['kind', 'id', 'text'] : kind === 'canvas' ? ['kind', 'id', 'label']
      : kind === 'button' || kind === 'toggle' ? ['kind', 'id', 'label', 'action']
      : kind === 'slider' ? ['kind', 'id', 'label', 'action', 'minimum', 'maximum', 'step'] : undefined;
    if (!fields) throw new Error('Unknown control kind'); keys(c, fields, 'Control');
    const id = contributionName(c.id);
    if (ids.has(id)) throw new Error(`Duplicate control ${id}`); ids.add(id);
    if (kind === 'text') string(c.text, 'Control text'); else string(c.label, 'Control label');
    if (fields.includes('action') && (typeof c.action !== 'string' || !ACTION.test(c.action))) throw new Error('Control needs a namespaced action');
    if (kind === 'slider' && (![c.minimum, c.maximum, c.step].every(n => typeof n === 'number' && Number.isFinite(n))
      || (c.minimum as number) >= (c.maximum as number) || (c.step as number) <= 0 || (c.step as number) > (c.maximum as number) - (c.minimum as number))) throw new Error('Invalid slider bounds');
    return { ...c, id } as unknown as UiControl;
  });
  let content: readonly WindowContentDefinition[] | undefined;
  if (w.content !== undefined) {
    if (!Array.isArray(w.content) || w.content.length > 64) throw new Error('At most 64 window content sections');
    content = w.content.map(captureContent);
    for (const section of content) { if (ids.has(section.id)) throw new Error(`Duplicate content ${section.id}`); ids.add(section.id); }
  }
  return freezeJson({ name: contributionName(w.name), title: string(w.title, 'Window title'), controls, ...(content ? {content} : {}) });
}
function captureContent(value: unknown): WindowContentDefinition {
  const c = object(value, 'Window content'), id = contributionName(c.id);
  if (c.kind === 'document' || c.kind === 'instruction') {
    keys(c, ['kind', 'id', 'document'], 'Document content');
    const doc = object(c.document, 'Document'); keys(doc, ['blocks'], 'Document');
    return { kind: c.kind, id, document: captureDocument(doc) };
  }
  if (c.kind === 'form' || c.kind === 'inspector') {
    keys(c, ['kind', 'id', 'controls'], 'Form content');
    return { kind: c.kind, id, controls: captureWindow({name:id,title:id,controls:c.controls as UiControl[]}).controls };
  }
  if (c.kind === 'list' || c.kind === 'log') {
    keys(c, ['kind', 'id', 'items'], 'List content');
    if (!Array.isArray(c.items) || c.items.length > 256) throw new Error('At most 256 list entries');
    return {kind:c.kind,id,items:c.items.map(item => string(item, 'List entry'))};
  }
  if (c.kind === 'preview') {
    keys(c, ['kind', 'id', 'type', 'data'], 'Preview content');
    const type = object(c.type, 'Preview type'); keys(type, ['name', 'version'], 'Preview type');
    if (typeof type.name !== 'string' || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(type.name)) throw new Error('Preview type must be namespaced');
    return {kind:'preview',id,type:{name:type.name,version:version(type.version,'Preview version')},data:capturePreviewData(c.data as PreviewData)};
  }
  throw new Error('Unknown window content kind');
}
export function captureGuide(raw: GuidePage): GuidePage {
  const p = object(raw, 'Guide'); keys(p, ['id', 'audience', 'title', 'summary', 'asset'], 'Guide');
  if (!['players', 'creators'].includes(p.audience as string)) throw new Error('Guide audience must be players or creators');
  const asset = artifactPath(p.asset);
  if (!asset.startsWith(`docs/${p.audience}/`) || !asset.endsWith('.json')) throw new Error('Guide asset must match its audience');
  return freezeJson({ id: contributionName(p.id), audience: p.audience as GuidePage['audience'], title: string(p.title, 'Guide title'), summary: string(p.summary, 'Guide summary'), asset });
}
/** Imported Manual pages remain bounded structured text, never executable HTML. */
export function validateGuideDocument(text: string, page: GuidePage): void {
  if (new TextEncoder().encode(text).length > 65536) throw new Error('Guide exceeds 64 KiB');
  const raw = object(JSON.parse(text), 'Guide document');
  keys(raw, ['id', 'audience', 'title', 'summary', 'blocks'], 'Guide document');
  if (raw.id !== page.id || raw.audience !== page.audience) throw new Error('Guide document identity/audience mismatch');
  string(raw.title, 'Guide title'); string(raw.summary, 'Guide summary');
  captureDocument(raw);
}
export function captureEffect<T extends MaterialDefinition | PostEffectDefinition>(raw: T, post: boolean): T {
  const e = object(raw, 'Effect'); keys(e, post ? ['name', 'fragmentAsset', 'after', 'scale', 'uniforms'] : ['name', 'bodyIds', 'fragmentAsset', 'uniforms'], 'Effect');
  const uniforms = object(e.uniforms, 'Uniforms');
  if (Object.keys(uniforms).length > 64 || Object.entries(uniforms).some(([key, n]) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || typeof n !== 'number' || !Number.isFinite(n))) throw new Error('Invalid effect uniforms');
  const values = post ? e.after : e.bodyIds;
  if (!Array.isArray(values) || values.length > 256 || values.some(v => typeof v !== 'string' || !v.trim() || v.length > 256) || new Set(values).size !== values.length) throw new Error('Invalid effect targets/order');
  if (post && e.scale !== .5 && e.scale !== 1) throw new Error('Post effect scale must be 0.5 or 1');
  return freezeJson({ ...e, name: contributionName(e.name), fragmentAsset: artifactPath(e.fragmentAsset) }) as T;
}

/** Owns callback failures and cancellation, independently of browser/Node adapters. */
export class DeviceHooks implements Disposable {
  private readonly resources: { readonly id: string; readonly resource: Disposable }[] = [];
  private readonly disabled = new Set<string>();
  private readonly failures: ModuleHookFault[] = [];
  private disposed = false;
  get faults(): readonly ModuleHookFault[] { return Object.freeze([...this.failures]); }
  enabled(id: string): boolean { return !this.disposed && !this.disabled.has(id); }
  private fail(kind: ModuleHookFault['kind'], id: string, moduleId: string, error: unknown): void {
    if (this.disabled.has(id)) return;
    this.disabled.add(id);
    this.closeResources(id);
    if (this.failures.length < 64) this.failures.push(Object.freeze({ kind, hook: id, moduleId, message: error instanceof Error ? error.message : String(error) }));
  }
  private own(id: string, resource: Disposable): void {
    if (this.disposed) { resource.dispose(); return; }
    this.resources.push({ id, resource });
  }
  input(moduleId: string, raw: InputSource, allowedActions: () => ReadonlySet<string>): ModuleContribution<InputSource> {
    const name = contributionName(raw.name), id = `${moduleId}/${name}`;
    const sample = method(raw, 'sample'), release = method(raw, 'release'), dispose = method(raw, 'dispose');
    let closed = false, sink: ActionSink | undefined, writes = 0;
    const pendingActions = new Array<string>(256), pendingValues = new Float64Array(256);
    const close = (): void => { if (closed) return; closed = true; try { release(); } finally { dispose(); } };
    this.own(id, { dispose: close });
    // Reused for every sample. An input source may write only while its sample is running.
    const checkedSink: ActionSink = Object.freeze({ set(action: string, value: number) {
      if (!sink) throw new Error('Input sink is outside its sample');
      if (!allowedActions().has(action) || !Number.isFinite(value)) throw new Error(`Invalid input action/value ${action}`);
      if (writes >= pendingValues.length) throw new Error('At most 256 action writes per input sample');
      pendingActions[writes] = action; pendingValues[writes++] = Math.max(-1, Math.min(1, value));
    } });
    const hooks = this;
    const value: InputSource = Object.freeze({ name,
      sample(frame: InputFrame, into: ActionSink) {
        if (closed || !hooks.enabled(id)) return;
        try {
          writes = 0; sink = into; sample(frame, checkedSink); sink = undefined;
          for (let i = 0; i < writes; i++) into.set(pendingActions[i]!, pendingValues[i]!);
        }
        catch (error) { hooks.fail('input', id, moduleId, error); try { close(); } catch { /* Keep the original fault. */ } }
        finally { sink = undefined; }
      },
      release(pilot?: number) {
        if (closed || !hooks.enabled(id)) return;
        try { release(pilot); } catch (error) { hooks.fail('input', id, moduleId, error); try { close(); } catch { /* Cleanup is best effort. */ } }
      }, dispose: close });
    return Object.freeze({ moduleId, id, value });
  }
  transport(moduleId: string, raw: TransportProvider): ModuleContribution<TransportProvider> {
    const name = contributionName(raw.name), id = `${moduleId}/${name}`;
    if (!Array.isArray(raw.schemes) || !raw.schemes.length || raw.schemes.length > 16 || raw.schemes.some(s => !/^[a-z][a-z0-9+.-]*$/.test(s)) || new Set(raw.schemes).size !== raw.schemes.length) throw new Error('Invalid transport schemes');
    const connect = method(raw, 'connect'), listen = raw.listen ? method(raw, 'listen') : undefined;
    const value: TransportProvider = Object.freeze({ name, schemes: Object.freeze([...raw.schemes]),
      connect: (address: string, signal: AbortSignal) => this.run('transport', moduleId, id, signal, async ownedSignal => {
        let cancel = (): void => {};
        const peer = ownedConnection(await connect(address, ownedSignal), () => signal.removeEventListener('abort', cancel));
        cancel = () => { try { peer.close('Connection cancelled'); } catch (error) { this.fail('transport', id, moduleId, error); } };
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted || ownedSignal.aborted) { peer.close('Connection cancelled'); throw new Error('Connection cancelled'); }
        this.own(id, { dispose: () => peer.close('Module disposed') }); return peer;
      }),
      ...(listen ? { listen: (address: string, accept: (peer: TextConnection) => void, signal: AbortSignal) => this.run('transport', moduleId, id, signal, async ownedSignal => {
        const listener = await listen(address, rawPeer => {
          try {
            const peer = ownedConnection(rawPeer);
            if (signal.aborted || ownedSignal.aborted || !this.enabled(id)) { peer.close('Listener cancelled'); return; }
            this.own(id, { dispose: () => peer.close('Module disposed') }); accept(peer);
          } catch (error) { this.fail('transport', id, moduleId, error); }
        }, ownedSignal);
        const close = method(listener, 'dispose'); let closed = false;
        const cancel = (): void => { try { resource.dispose(); } catch (error) { this.fail('transport', id, moduleId, error); } };
        const resource = Object.freeze({ dispose() { if (closed) return; closed = true; signal.removeEventListener('abort', cancel); close(); } });
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted || ownedSignal.aborted) { resource.dispose(); throw new Error('Listener cancelled'); }
        this.own(id, resource); return resource;
      }) } : {}),
    });
    return Object.freeze({ moduleId, id, value });
  }
  discovery(moduleId: string, raw: DiscoveryProvider): ModuleContribution<DiscoveryProvider> {
    const name = contributionName(raw.name), id = `${moduleId}/${name}`, scan = method(raw, 'scan');
    return Object.freeze({ moduleId, id, value: Object.freeze({ name,
      scan: (emit: (advert: ServerAdvert) => void, signal: AbortSignal) => this.run('discovery', moduleId, id, signal, async ownedSignal => {
        let callbackError: unknown, accepting = true;
        try { await scan(raw => {
          if (!accepting || ownedSignal.aborted || !this.enabled(id)) return;
          try { emit(captureAdvert(raw)); } catch (error) { callbackError = error; this.fail('discovery', id, moduleId, error); }
        }, ownedSignal); } finally { accepting = false; }
        if (callbackError) throw callbackError;
      }),
    }) });
  }
  private async run<T>(kind: 'transport' | 'discovery', moduleId: string, id: string, signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.enabled(id) || signal.aborted) throw new Error(`${id} is unavailable or cancelled`);
    const controller = new AbortController(), cancel = (): void => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const lease = { dispose: cancel }; this.own(id, lease);
    try { return await work(controller.signal); }
    catch (error) { if (!controller.signal.aborted) this.fail(kind, id, moduleId, error); controller.abort(); throw error; }
    finally { signal.removeEventListener('abort', cancel); const at = this.resources.findIndex(entry => entry.resource === lease); if (at !== -1) this.resources.splice(at, 1); }
  }
  private closeResources(id?: string): void {
    for (let i = this.resources.length - 1; i >= 0; i--) {
      const entry = this.resources[i]!;
      if (id !== undefined && entry.id !== id) continue;
      this.resources.splice(i, 1);
      try { entry.resource.dispose(); } catch (error) { this.disposalErrors.push(error); }
    }
  }
  readonly disposalErrors: unknown[] = [];
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.closeResources();
  }
}
function captureAdvert(raw: ServerAdvert): ServerAdvert {
  const a = object(raw, 'Server advert'); keys(a, ['id', 'name', 'address', 'players', 'maxPlayers', 'protocol'], 'Server advert');
  if (!Number.isSafeInteger(a.players) || !Number.isSafeInteger(a.maxPlayers) || (a.players as number) < 0 || (a.maxPlayers as number) < 1 || (a.players as number) > (a.maxPlayers as number)) throw new Error('Invalid server player counts');
  return freezeJson({ id: string(a.id, 'Server ID'), name: string(a.name, 'Server name'), address: string(a.address, 'Server address'), protocol: string(a.protocol, 'Server protocol'), players: a.players, maxPlayers: a.maxPlayers }) as ServerAdvert;
}
function ownedConnection(raw: TextConnection, stopped: () => void = () => {}): TextConnection {
  try { return captureConnection(raw, stopped); }
  catch (error) { try { raw.close('Invalid connection'); } catch { /* Preserve validation failure. */ } throw error; }
}
function captureConnection(raw: TextConnection, stopped: () => void): TextConnection {
  string(raw.label, 'Connection label');
  const send = method(raw, 'send'), close = method(raw, 'close'); let closed = false;
  if (!Number.isFinite(raw.bufferedAmount) || raw.bufferedAmount < 0) throw new Error('Invalid connection backpressure');
  let onclose = raw.onclose, notified = false;
  raw.onclose = reason => { if (notified) return; notified = true; closed = true; stopped(); onclose?.(reason); };
  return Object.freeze({ label: raw.label,
    get bufferedAmount() { return raw.bufferedAmount; },
    send(text: string) { if (closed) throw new Error('Connection closed'); send(text); },
    close(reason?: string) { if (closed) return; closed = true; stopped(); close(reason); },
    get onmessage() { return raw.onmessage; }, set onmessage(value) { raw.onmessage = value; },
    get onclose() { return onclose; }, set onclose(value) { onclose = value; },
  });
}
