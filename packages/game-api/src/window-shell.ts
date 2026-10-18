import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { WindowChrome, WindowIcon, WindowChromeOptions } from './windows';
export interface WindowPanelSpec {
  readonly id: string; readonly title: string; readonly label: string; readonly icon: WindowIcon; readonly hint: string;
  readonly content: readonly HTMLElement[];
  readonly global?: boolean;
}
export interface WindowShellOptions {
  readonly viewport: HTMLElement;
  readonly overlayRoot?: HTMLElement;
  readonly groups: readonly (readonly WindowPanelSpec[])[];
  readonly instrumentGroup?: number;
  readonly instrumentToggle?: HTMLElement;
  /** Wall milliseconds between Escape/fullscreen toggles; default 300. */
  readonly escapeToggleMs?: number;
  readonly chrome?: Pick<WindowChromeOptions, 'storage' | 'storagePrefix' | 'dismissOn' | 'decorate'>;
  release(): void;
  focus(): void;
  onClose?(): void;
  captureEscape?(event: KeyboardEvent): boolean;
  dismissModal?(): boolean;
  filePanel?(input: HTMLInputElement): string | undefined;
}
export interface WindowShell extends Disposable {
  readonly isOpen: boolean;
  addInstrument(window: WindowChrome, label: string, hint: string): Disposable;
  open(panel?: string): void;
  close(focus?: boolean, fromEscape?: boolean): void;
  toggle(fromEscape?: boolean): void;
  handleFullscreenEscape(): void;
}
export interface WindowShellFactory extends Disposable { create(options: WindowShellOptions): WindowShell }
export const WINDOW_SHELL: ServiceKey<WindowShellFactory> = Object.freeze({slot:'ui.shell',version:'1.0.0'});
