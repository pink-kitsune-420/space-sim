import { captureDocument, capturePreviewData, type Disposable, type WindowContentService, type WindowContentOptions,
  type WindowPreviewType, type WindowContentDefinition, type UiControl } from '@space-sim/game-api';

/** One registry per prepared game; no global extension or DOM lifetime. */
export function createWindowContent(): WindowContentService {
  const types = new Map<string, { provider: WindowPreviewType; mounts: Set<Disposable> }>();
  const mounts = new Set<Disposable>(); let disposed = false;
  const live = (): void => { if (disposed) throw new Error('Window content provider disposed'); };
  const key = (type: WindowPreviewType['type']): string => {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(type.name) || !/^\d+\.\d+\.\d+$/.test(type.version)) throw new Error('Invalid named versioned preview type');
    return `${type.name}@${type.version}`;
  };
  const closeAll = (resources: Iterable<Disposable>): void => {
    const errors: unknown[] = [];
    for (const resource of [...resources].reverse()) { try { resource.dispose(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Window content cleanup failed');
  };
  const mount = (root: HTMLElement, content: WindowContentDefinition, options: WindowContentOptions = {}): Disposable => {
    live();
    const document = root.ownerDocument, section = document.createElement('div'); section.className = `window-content window-content-${content.kind}`;
    const controller = new (document.defaultView?.AbortController ?? AbortController)(), resources: Disposable[] = [];
    let entry: ReturnType<typeof types.get>, closed = false;
    // Retained callbacks from disposed previews cannot issue actions or navigate.
    const callbacks: WindowContentOptions = Object.freeze<WindowContentOptions>({
      action: (id, value) => { if (!closed) options.action?.(id, value); },
      navigate: page => { if (!closed) options.navigate?.(page); },
      control: (id, node) => { if (!closed) options.control?.(id, node); },
    });
    const lease: Disposable = {dispose() {
      if (closed) return; closed = true; mounts.delete(lease); entry?.mounts.delete(lease); controller.abort(); section.remove(); closeAll(resources);
    }};
    const textNode = (tag: string, text: string, parent: HTMLElement = section): HTMLElement => {
      const node = document.createElement(tag); node.textContent = text; parent.append(node); return node;
    };
    const control = (control: UiControl): void => {
      let node: HTMLElement;
      if (control.kind === 'text') node = textNode('p', control.text);
      else if (control.kind === 'canvas') { node = document.createElement('canvas'); node.setAttribute('aria-label', control.label); section.append(node); }
      else if (control.kind === 'button') {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = control.label; section.append(button); node = button;
        button.addEventListener('click', () => callbacks.action?.(control.action, 1), {signal:controller.signal});
      } else {
        const label = textNode('label', control.label), input = document.createElement('input'); input.type = control.kind === 'toggle' ? 'checkbox' : 'range';
        if (control.kind === 'slider') { input.min = String(control.minimum); input.max = String(control.maximum); input.step = String(control.step); input.value = String(control.minimum); }
        label.append(input); node = input;
        input.addEventListener('input', () => callbacks.action?.(control.action, control.kind === 'toggle' ? input.checked : Number(input.value)), {signal:controller.signal});
      }
      callbacks.control?.(control.id, node);
    };
    try {
      root.append(section);
      switch (content.kind) {
        case 'document': case 'instruction':
          for (const block of captureDocument(content.document).blocks) {
            if (block.type === 'list') { const list = document.createElement(block.ordered ? 'ol' : 'ul'); for (const item of block.items) textNode('li', item, list); section.append(list); }
            else if (block.type === 'link') {
              const link = textNode('a', block.text) as HTMLAnchorElement; link.href = `#manual-${block.page}`; link.dataset.page = block.page;
              if (options.navigate) link.addEventListener('click', event => { event.preventDefault(); callbacks.navigate?.(block.page); }, {signal:controller.signal});
            } else textNode(block.type === 'heading' ? 'h3' : block.type === 'code' ? 'pre' : 'p', block.text);
          }
          break;
        case 'form': case 'inspector': for (const field of content.controls) control(field); break;
        case 'list': case 'log': {
          const list = document.createElement(content.kind === 'log' ? 'ol' : 'ul');
          if (content.kind === 'log') { list.setAttribute('role', 'log'); list.setAttribute('aria-live', 'polite'); }
          for (const item of content.items) textNode('li', item, list); section.append(list); break;
        }
        case 'preview': {
          entry = types.get(key(content.type)); if (!entry) throw new Error(`Missing preview extension ${key(content.type)}`);
          // Copy/capture both incoming and validated data so extensions cannot mutate declarations.
          const data = capturePreviewData(entry.provider.validate(capturePreviewData(content.data)));
          const preview = entry.provider.mount(section, data, callbacks); resources.push(preview); entry.mounts.add(lease);
          const observer = new (document.defaultView?.ResizeObserver ?? ResizeObserver)(() => { if (!closed) preview.resize(section.clientWidth, section.clientHeight); });
          resources.push({dispose:() => observer.disconnect()}); observer.observe(section);
          preview.resize(section.clientWidth, section.clientHeight); break;
        }
      }
      mounts.add(lease); return lease;
    } catch (error) { try { lease.dispose(); } catch { /* Preserve mount error. */ } throw error; }
  };
  return Object.freeze<WindowContentService>({
    register(provider) {
      live(); const id = key(provider.type);
      if (types.has(id)) throw new Error(`Duplicate preview extension ${id}`);
      if (typeof provider.validate !== 'function' || typeof provider.mount !== 'function') throw new Error('Invalid preview extension');
      const entry = {provider:{type:Object.freeze({...provider.type}),validate:provider.validate.bind(provider),mount:provider.mount.bind(provider)},mounts:new Set<Disposable>()}; types.set(id,entry);
      let closed = false;
      return {dispose() { if (closed) return; closed = true; types.delete(id); closeAll(entry.mounts); }};
    },
    mount,
    document: (root, document, options) => mount(root, {kind:'document',id:'document',document}, options),
    dispose() { if (disposed) return; disposed = true; try { closeAll(mounts); } finally { types.clear(); } },
  });
}
