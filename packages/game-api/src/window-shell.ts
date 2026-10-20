import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { WindowChrome, WindowIcon, WindowChromeOptions } from './windows';
/**
 * Specification for a workspace panel mounted into the window shell dock and viewport layer.
 * Defines panel identification, title, dock label, vector icon, hover hint, borrowed DOM content,
 * and whether the window is placed in the global overlay layer or beside the dock.
 */
export interface WindowPanelSpec {
  readonly id: string;
  readonly title: string;
  readonly label: string;
  readonly icon: WindowIcon;
  readonly hint: string;
  readonly content: readonly HTMLElement[];
  readonly global?: boolean;
}

/**
 * Configuration options for creating a workspace window shell and dock (`ui.shell@1.0.0`).
 * Defines the main viewport element, optional overlay root, grouped panel definitions,
 * instrument toggle integration, wall-millisecond Escape debounce interval, chrome settings,
 * and input focus/release lifecycle hooks.
 */
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

/**
 * Workspace window shell managing an edge dock and floating window lifecycles (`ui.shell@1.0.0`).
 * Unpinned windows behave like tabs (one at a time, closed by returning to flight or pressing Escape),
 * while pinned windows stay open during flight. Manages Escape debounce, fullscreen exit detection,
 * file-input change routing to workspace panels, and borrowed content node restoration on disposal.
 * Throws when invoked after disposal or when opening an unregistered panel.
 */
export interface WindowShell extends Disposable {
  readonly isOpen: boolean;
  addInstrument(window: WindowChrome, label: string, hint: string): Disposable;
  open(panel?: string): void;
  close(focus?: boolean, fromEscape?: boolean): void;
  toggle(fromEscape?: boolean): void;
  handleFullscreenEscape(): void;
}

/**
 * Factory service creating workspace window shells (`ui.shell@1.0.0`).
 * Injects shared shell stylesheet rules into target documents. Disposing the factory
 * disposes all active shell instances and removes injected stylesheet elements.
 */
export interface WindowShellFactory extends Disposable {
  create(options: WindowShellOptions): WindowShell;
}

/** Service key for the workspace window shell factory (`ui.shell@1.0.0`). */
export const WINDOW_SHELL: ServiceKey<WindowShellFactory> = Object.freeze({slot:'ui.shell',version:'1.0.0'});

