import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { WindowInteractions } from './chat';
import type { ThemePreferences } from './theme';
/**
 * First-party vector icon identifier rendered in window chrome headers and dock items.
 */
export type WindowIcon = 'grip' | 'setup' | 'ship' | 'fleet' | 'online' | 'instruments' | 'trajectory' | 'telemetry' | 'alarm' | 'chat' | 'settings' | 'tools' | 'library' | 'manual' | 'pin';

/**
 * Options for creating a floating window chrome instance (`ui.windows@1.0.0`).
 * Defines identification, title, icon, mount container, optional viewer storage for window
 * coordinates and pinned state, initial placement, dismiss predicates, and lifecycle callbacks.
 */
export interface WindowChromeOptions {
  readonly id: string;
  readonly title: string;
  readonly icon?: WindowIcon;
  readonly container: HTMLElement;
  /** Viewer-only preferences. No storage is accessed unless supplied. */
  readonly storage?: ThemePreferences;
  readonly storagePrefix?: string;
  readonly pinned?: boolean;
  readonly className?: string;
  readonly place?: (container: HTMLElement, panel: HTMLElement) => { x: number; y: number };
  /** The game decides which interactions return to its main view. */
  readonly dismissOn?: (target: EventTarget | null) => boolean;
  readonly decorate?: (panel: HTMLElement) => Disposable | void;
  readonly onCloseButton?: () => void;
  readonly releaseInput?: () => void;
}

/**
 * Movable, resizable, and pinnable floating window instance (`ui.windows@1.0.0`).
 * Owns the container DOM element, header chrome, body content host, dragging listeners,
 * and visibility state. Notifies subscribers when opened, closed, pinned, or raised.
 */
export interface WindowChrome extends Disposable {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  readonly icon: WindowIcon;
  readonly isOpen: boolean;
  readonly pinned: boolean;
  readonly isFront: boolean;
  open(): void;
  close(): void;
  raise(): void;
  setPinned(pinned: boolean): void;
  onChange(listener: () => void): Disposable;
}

/**
 * Shared floating window management and vector icon service (`ui.windows@1.0.0`).
 * Coordinates window creation, front-of-stack ordering, interactive element resizing,
 * and shared SVG path lookup without coupling to simulation state.
 * Disposing the system closes managed windows and detaches injected stylesheets.
 */
export interface WindowSystem extends Disposable, WindowInteractions {
  /** Fixed first-party vector paths; labels and imported content remain DOM text. */
  icon(name: WindowIcon): string;
  create(options: WindowChromeOptions): WindowChrome;
  isFront(panel: HTMLElement): boolean;
}

/** Service key for the shared floating window management system (`ui.windows@1.0.0`). */
export const WINDOWS: ServiceKey<WindowSystem> = Object.freeze({slot:'ui.windows', version:'1.0.0'});

