import type { Disposable, WindowIcon } from '@space-sim/game-api';

/** Native button chrome shared by window toggles and game-specific dock actions. */
export function createDockButton(document: Document, icon: string, label: string, hint: string, controls?: string): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'dock-item';
  button.title = `${label}: ${hint}`; button.setAttribute('aria-label', label);
  if (controls) button.setAttribute('aria-controls', controls);
  // Icons come from the trusted host's fixed vector set; captions remain DOM text.
  button.innerHTML = icon;
  const caption = document.createElement('span'); caption.textContent = label; button.append(caption);
  return button;
}
export interface DockAction {
  readonly id: string; readonly label: string; readonly hint: string; readonly icon: WindowIcon;
  readonly controls?: string; readonly activate?: () => void;
  /** Borrow an existing control, retaining its listeners and restoring it on disposal. */
  readonly button?: HTMLButtonElement;
}
export interface ActionDock extends Disposable { readonly element: HTMLElement }
export function createActionDock(options: {
  readonly container: HTMLElement; readonly groups: readonly (readonly DockAction[])[];
  readonly icon: (name: WindowIcon) => string; readonly label?: string;
}): ActionDock {
  const document = options.container.ownerDocument, resources: (() => void)[] = [];
  const controller = new (document.defaultView?.AbortController ?? AbortController)();
  const element = document.createElement('nav'); element.className = 'hud-dock'; element.setAttribute('aria-label', options.label ?? 'Game tools');
  const seen = new Set<string>();
  try {
    for (const actions of options.groups) {
      const group = document.createElement('div'); group.className = 'dock-group'; group.setAttribute('role', 'group');
      for (const action of actions) {
        if (seen.has(action.id)) throw new Error(`Duplicate dock action ${action.id}`); seen.add(action.id);
        const template = createDockButton(document, options.icon(action.icon), action.label, action.hint, action.controls);
        const button = action.button ?? template;
        if (action.button) {
          const anchor = document.createComment('Dock action source'); button.before(anchor);
          const saved = [...button.attributes].map(attribute => [attribute.name, attribute.value] as const), children = [...button.childNodes];
          resources.push(() => { button.replaceChildren(...children); for (const attribute of [...button.attributes]) button.removeAttribute(attribute.name); for (const [key, value] of saved) button.setAttribute(key, value); if (anchor.parentNode) anchor.replaceWith(button); else button.remove(); });
          button.className = template.className; button.replaceChildren(...template.childNodes);
          for (const key of ['title', 'aria-label', 'aria-controls']) { const value = template.getAttribute(key); if (value !== null) button.setAttribute(key, value); }
        }
        button.dataset.dockAction = action.id;
        if (action.activate) button.addEventListener('click', action.activate, { signal: controller.signal });
        group.append(button);
      }
      element.append(group);
    }
    options.container.append(element);
  } catch (error) { controller.abort(); for (const restore of resources.reverse()) restore(); element.remove(); throw error; }
  let disposed = false;
  return { element, dispose() { if (disposed) return; disposed = true; controller.abort(); for (const restore of resources.reverse()) restore(); element.remove(); } };
}
