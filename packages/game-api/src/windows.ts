import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { WindowInteractions } from './chat';
import type { ThemePreferences } from './theme';
export type WindowIcon = 'grip' | 'setup' | 'ship' | 'fleet' | 'online' | 'instruments' | 'trajectory' | 'telemetry' | 'chat' | 'settings' | 'tools' | 'library' | 'manual' | 'pin';
export interface WindowChromeOptions {
  readonly id: string; readonly title: string; readonly icon?: WindowIcon;
  readonly container: HTMLElement;
  /** Viewer-only preferences. No storage is accessed unless supplied. */
  readonly storage?: ThemePreferences; readonly storagePrefix?: string;
  readonly pinned?: boolean; readonly className?: string;
  readonly place?: (container: HTMLElement, panel: HTMLElement) => { x: number; y: number };
  /** The game decides which interactions return to its main view. */
  readonly dismissOn?: (target: EventTarget | null) => boolean;
  readonly decorate?: (panel: HTMLElement) => Disposable | void;
  readonly onCloseButton?: () => void;
  readonly releaseInput?: () => void;
}
export interface WindowChrome extends Disposable {
  readonly element: HTMLElement; readonly body: HTMLElement; readonly icon: WindowIcon;
  readonly isOpen: boolean; readonly pinned: boolean; readonly isFront: boolean;
  open(): void; close(): void; raise(): void; setPinned(pinned: boolean): void;
  onChange(listener: () => void): Disposable;
}
export interface WindowSystem extends Disposable, WindowInteractions {
  /** Fixed first-party vector paths; labels and imported content remain DOM text. */
  icon(name: WindowIcon): string;
  create(options: WindowChromeOptions): WindowChrome;
  isFront(panel: HTMLElement): boolean;
}
export const WINDOWS: ServiceKey<WindowSystem> = Object.freeze({slot:'ui.windows', version:'1.0.0'});
