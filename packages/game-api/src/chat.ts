import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { ChatLine } from './session';
export type ChatMessageKind = 'system' | 'error' | 'success' | 'chat';
/** Borrowed window interaction service; the caller owns the shared stacking order. */
export interface WindowInteractions {
  raise(panel: HTMLElement): void;
  release(panel: HTMLElement): void;
  resize(panel: HTMLElement, viewport: HTMLElement, title: string, options: {
    start?: () => void; change(width: number, height: number, x: number, y: number): void; end(): void;
  }): Disposable;
}
export interface ChatConsoleOptions {
  readonly historyLines?: number;
  readonly root: HTMLElement; readonly viewport: HTMLElement; readonly toggle?: HTMLElement;
  readonly windows?: WindowInteractions;
  readonly initialMessage?: string;
  visible?(): boolean; setVisible?(visible: boolean): void;
  submit(text: string): void;
}
export interface ChatConsole extends Disposable {
  log(kind: ChatMessageKind, text: string, sender?: string): void;
  show(line: ChatLine, playerId?: string): void;
  clear(): void;
  minimize(minimized: boolean, focusInput?: boolean): void;
}
export interface ChatConsoleFactory { create(options: ChatConsoleOptions): ChatConsole }
export const CHAT_CONSOLES: ServiceKey<ChatConsoleFactory> = Object.freeze({ slot: 'ui.chat', version: '1.0.0' });
