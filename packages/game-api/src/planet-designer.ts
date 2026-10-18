import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { WorldRead } from './engine';
import type { ResolvedBody } from './universe';
import type { ThemePreferences } from './theme';
/** Viewer-only appearance authoring. Commands never receive mutable world authority. */
export interface PlanetDesignerOptions {
 readonly root: HTMLElement;
 readonly idPrefix?: string;
 readonly storage?: ThemePreferences;
 world(): WorldRead;
 current?(): string | undefined;
 download(name: string, content: Blob): void;
 confirm(message: string): boolean;
 copy?(text: string): Promise<void>;
}
export interface PlanetDesignerControl extends Disposable {
 appearanceFor(world: WorldRead, body: ResolvedBody): ResolvedBody['appearance'];
 refresh(): void;
 open(): void;
}
export interface PlanetDesignerFactory { create(options: PlanetDesignerOptions): PlanetDesignerControl }
export const PLANET_DESIGNERS: ServiceKey<PlanetDesignerFactory> = Object.freeze({ slot: 'ui.planet-designer', version: '1.0.0' });
