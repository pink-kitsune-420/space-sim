import type { ModuleInitializationV2, ThemeCustomizer, ThemeCustomizerFactory } from '@space-sim/game-api';
import { THEME_CUSTOMIZERS } from '@space-sim/game-api';
import { createThemeCustomizer } from './customizer';
export function createThemeCustomizers(css = ''): ThemeCustomizerFactory {
  const instances = new Set<ThemeCustomizer>(); let disposed = false;
  return Object.freeze<ThemeCustomizerFactory>({ create(options) {
    if (disposed) throw new Error('Theme controls provider disposed');
    const instance = createThemeCustomizer(options, css), close = instance.dispose.bind(instance); let closed = false;
    instance.dispose = () => { if (closed) return; closed = true; instances.delete(instance); close(); }; instances.add(instance); return instance;
  }, dispose() { if (disposed) return; disposed = true; const errors: unknown[] = [];
    for (const instance of instances) { try { instance.dispose(); } catch (error) { errors.push(error); } }
    instances.clear(); if (errors.length) throw new AggregateError(errors, 'Theme controls provider cleanup failed'); } });
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({id:'usage',audience:'creators',title:"Theme controls",summary:"Public ui.theme-customizer@1.0.0 service and lifecycle.",asset:'docs/creators/usage.json'}); context.provide(THEME_CUSTOMIZERS, context.own(createThemeCustomizers(context.assets.text('assets/controls.css')))); }
