import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { ChatLine } from './session';
/** Categorical style tag for messages logged to the chat console. */
export type ChatMessageKind = 'system' | 'error' | 'success' | 'chat';
/** Borrowed window interaction service; the caller owns the shared stacking order. */
export interface WindowInteractions {
  /** Bring the window panel to the top of the z-order stack. */
  raise(panel: HTMLElement): void;
  /** Release the window panel when closing or blurring. */
  release(panel: HTMLElement): void;
  /** Attach drag-resize behavior to a floating window panel. */
  resize(panel: HTMLElement, viewport: HTMLElement, title: string, options: {
    start?: () => void; change(width: number, height: number, x: number, y: number): void; end(): void;
  }): Disposable;
}
/** Options configuring a chat console UI instance. */
export interface ChatConsoleOptions {
  /** Maximum number of history lines retained in the DOM (1–1000, default 60). */
  readonly historyLines?: number;
  /** Root container element where the chat console markup is injected. */
  readonly root: HTMLElement;
  /** Viewport bounding container for dragging and positioning. */
  readonly viewport: HTMLElement;
  /** Optional button element toggling the chat console open/closed. */
  readonly toggle?: HTMLElement;
  /** Optional window interaction manager for floating, dragging and resizing. */
  readonly windows?: WindowInteractions;
  /** Optional initial system banner message displayed upon initialization. */
  readonly initialMessage?: string;
  /** Check whether the chat console is currently visible. */
  visible?(): boolean;
  /** Show or hide the chat console. */
  setVisible?(visible: boolean): void;
  /** Callback invoked when the user submits an input text line or command. */
  submit(text: string): void;
}
/** Active in-game chat console instance managing DOM rendering and history. */
export interface ChatConsole extends Disposable {
  /** Append a message with a specific visual kind and optional sender label. */
  log(kind: ChatMessageKind, text: string, sender?: string): void;
  /** Render an incoming session ChatLine, attributing sender or self tag based on playerId. */
  show(line: ChatLine, playerId?: string): void;
  /** Clear all message lines currently displayed in the chat log. */
  clear(): void;
  /** Minimize the chat overlay to a pill button or restore it to normal size. */
  minimize(minimized: boolean, focusInput?: boolean): void;
}
/** Factory creating chat console UI instances. */
export interface ChatConsoleFactory {
  /** Construct and mount a new ChatConsole inside options.root. */
  create(options: ChatConsoleOptions): ChatConsole;
}
/** ServiceKey for the in-game chat console UI factory (slot `ui.chat`). */
export const CHAT_CONSOLES: ServiceKey<ChatConsoleFactory> = Object.freeze({ slot: 'ui.chat', version: '1.0.0' });
