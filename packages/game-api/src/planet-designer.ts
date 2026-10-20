import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { WorldRead } from './engine';
import type { ResolvedBody } from './universe';
import type { ThemePreferences } from './theme';
/**
 * Configuration options for mounting an independent planet appearance designer into a DOM root element.
 * Provides read-only world access, optional selected-body getter, viewer-scoped theme storage, and export callbacks.
 * Operates purely in viewer presentation space: commands never receive mutable world or simulation authority.
 */
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
/**
 * Interactive planet appearance designer control managing 3D/vector previews, color/layer editing, and exported looks (`ui.planet-designer@1.0.0`).
 * Evaluates appearance overrides for celestial bodies in body-fixed spherical coordinates without altering authoritative world state.
 * Releases preview canvases, styles, and animation frames on disposal.
 */
export interface PlanetDesignerControl extends Disposable {
 appearanceFor(world: WorldRead, body: ResolvedBody): ResolvedBody['appearance'];
 refresh(): void;
 open(): void;
}
/**
 * Factory creating independent planet appearance designer controls (`ui.planet-designer@1.0.0`).
 */
export interface PlanetDesignerFactory { create(options: PlanetDesignerOptions): PlanetDesignerControl }
/** Service key for the planet appearance designer factory (`ui.planet-designer@1.0.0`). */
export const PLANET_DESIGNERS: ServiceKey<PlanetDesignerFactory> = Object.freeze({ slot: 'ui.planet-designer', version: '1.0.0' });
