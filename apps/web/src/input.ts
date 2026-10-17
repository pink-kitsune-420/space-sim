const defaultFlightKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
const defaultShortcuts = new Set([
  'KeyP', 'KeyR', 'KeyC', 'KeyH', 'KeyF', 'Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract',
  'Backquote', 'BracketLeft', 'BracketRight', 'Backslash', 'Comma', 'Period', 'Slash',
]);
/** Keys the console owns; module commands may not bind them. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([...defaultFlightKeys, ...defaultShortcuts]);

/** Browser keyboard and hold-button bindings. Own them once for the console lifetime. */
export function bindFlightInput(options: {
  readonly keys: Set<string>;
  readonly pointers: Map<number, string>;
  readonly paused: () => boolean;
  readonly shortcut: (code: string) => void;
  /** A module command key; true when one is bound to `code`. */
  readonly command: (code: string) => boolean;
  readonly autoPause: (reason: string) => void;
  readonly autoResume?: (reason: string) => void;
  readonly visibility: () => void;
  readonly isFlightKey?: (code: string) => boolean;
  readonly isShortcutKey?: (code: string) => boolean;
}): void {
  const isFlight = (code: string) => options.isFlightKey ? options.isFlightKey(code) : defaultFlightKeys.has(code);
  const isShortcut = (code: string) => options.isShortcutKey ? options.isShortcutKey(code) : defaultShortcuts.has(code);

  window.addEventListener('keydown', event => {
    if ((event.target as HTMLElement).closest('input, select, button, summary, a, textarea')) return;
    const flight = isFlight(event.code);
    const shortcut = isShortcut(event.code);
    if (!flight && !shortcut) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || !options.command(event.code)) return;
      event.preventDefault();
      return;
    }
    event.preventDefault();
    if (flight) { if (!options.paused()) options.keys.add(event.code); return; }
    if (event.repeat) return;
    options.shortcut(event.code);
  });
  window.addEventListener('keyup', event => { options.keys.delete(event.code); });
  window.addEventListener('blur', () => options.autoPause('Window lost focus'));
  window.addEventListener('focus', () => options.autoResume?.('Window focused'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) options.autoPause('Tab was hidden');
    else options.autoResume?.('Tab was shown');
    options.visibility();
  });
  window.addEventListener('pagehide', () => options.autoPause('Page was hidden'));
  window.addEventListener('pageshow', () => options.autoResume?.('Page was shown'));
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-hold]')) {
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('pointerdown', event => {
      if (options.paused() || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      options.pointers.set(event.pointerId, button.dataset.hold!);
      button.setAttribute('aria-pressed', 'true');
    });
    const end = (event: PointerEvent): void => {
      options.pointers.delete(event.pointerId);
      button.setAttribute('aria-pressed', String([...options.pointers.values()].includes(button.dataset.hold!)));
    };
    button.addEventListener('pointerup', end);
    button.addEventListener('pointercancel', end);
    button.addEventListener('lostpointercapture', end);
    button.addEventListener('keydown', event => {
      if ((event.code === 'Space' || event.code === 'Enter') && !options.paused()) {
        event.preventDefault(); options.pointers.set(-1, button.dataset.hold!); button.setAttribute('aria-pressed', 'true');
      }
    });
    button.addEventListener('keyup', event => {
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault(); options.pointers.delete(-1); button.setAttribute('aria-pressed', 'false');
      }
    });
    button.addEventListener('blur', () => { options.pointers.delete(-1); button.setAttribute('aria-pressed', 'false'); });
  }

}
