import type { Disposable, FlightKeyboardOptions } from '@space-sim/game-api';

const defaultFlightKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight']);
const defaultShortcuts = new Set([
  'KeyP', 'KeyR', 'KeyC', 'KeyH', 'KeyF', 'KeyT', 'Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract',
  'Backquote', 'BracketLeft', 'BracketRight', 'Backslash', 'Backspace', 'Comma', 'Period', 'Slash',
  'Tab', 'KeyN', 'KeyB', 'KeyX', 'KeyZ',
]);
/** Keys the console owns; module commands may not bind them. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([...defaultFlightKeys, ...defaultShortcuts]);

/** Browser keyboard and hold-button bindings. Own them once for the console lifetime. */
export function bindFlightInput(options: FlightKeyboardOptions): Disposable {
  const listeners: (() => void)[] = [];
  type Events = WindowEventMap & DocumentEventMap & HTMLElementEventMap;
  const listen = <K extends keyof Events>(target: EventTarget, type: K, handler: (event: Events[K]) => void): void => {
    target.addEventListener(type, handler as EventListener);
    listeners.push(() => target.removeEventListener(type, handler as EventListener));
  };
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-hold]');
  const release = (): void => {
    options.keys.clear(); options.pointers.clear();
    for (const button of buttons) button.setAttribute('aria-pressed', 'false');
  };
  const isFlight = (code: string) => options.isFlightKey ? options.isFlightKey(code) : defaultFlightKeys.has(code);
  const isShortcut = (code: string) => options.isShortcutKey ? options.isShortcutKey(code) : defaultShortcuts.has(code);

  listen(window, 'keydown', event => {
    if ((event.target as HTMLElement).closest('input, select, button, summary, a, textarea')) return;
    const code = options.binding?.(event) ?? event.code;
    const flight = isFlight(code);
    const shortcut = isShortcut(code);
    if (!flight && !shortcut) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || !options.command(event.code)) return;
      event.preventDefault();
      return;
    }
    event.preventDefault();
    if (flight) {
      if (!options.paused()) {
        options.keys.add(event.code);
        if (!event.repeat) options.flightPress?.(event.code);
      }
      return;
    }
    if (event.repeat) return;
    options.shortcut(code);
  });
  listen(window, 'keyup', event => { options.keys.delete(event.code); });
  listen(window, 'blur', () => { release(); options.autoPause('Window lost focus'); });
  listen(window, 'focus', () => options.autoResume?.('Window focused'));
  listen(document, 'visibilitychange', () => {
    if (document.hidden) { release(); options.autoPause('Tab was hidden'); }
    else options.autoResume?.('Tab was shown');
    options.visibility();
  });
  listen(window, 'pagehide', () => { release(); options.autoPause('Page was hidden'); });
  listen(window, 'pageshow', () => options.autoResume?.('Page was shown'));
  for (const button of buttons) {
    button.setAttribute('aria-pressed', 'false');
    listen(button, 'pointerdown', event => {
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
    listen(button, 'pointerup', end);
    listen(button, 'pointercancel', end);
    listen(button, 'lostpointercapture', end);
    listen(button, 'keydown', event => {
      if ((event.code === 'Space' || event.code === 'Enter') && !options.paused()) {
        event.preventDefault(); options.pointers.set(-1, button.dataset.hold!); button.setAttribute('aria-pressed', 'true');
      }
    });
    listen(button, 'keyup', event => {
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault(); options.pointers.delete(-1); button.setAttribute('aria-pressed', 'false');
      }
    });
    listen(button, 'blur', () => { options.pointers.delete(-1); button.setAttribute('aria-pressed', 'false'); });
  }

  let disposed = false;
  return { dispose() {
    if (disposed) return; disposed = true; release();
    for (const remove of listeners) remove(); listeners.length = 0;
  } };
}
