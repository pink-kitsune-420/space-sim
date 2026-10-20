import { themeDom } from './dom';
import type { ModuleInitializationV2, RenderThemeOptions, ThemeController, ThemeFactory, ThemeOptions, ThemeSettings } from '@space-sim/game-api';
import { THEMES } from '@space-sim/game-api';
import { DEFAULT_THEME_SETTINGS, THEME_PRESETS, drawProceduralBackdrop } from './appearance';
const STORAGE_KEY = 'space-sim:theme:v5';
const enumValues: Readonly<Record<string, readonly string[]>> = {
  backdropStyle: ['spacelab', 'nebula', 'carina', 'galactic', 'aurora', 'supernova', 'void', 'pillars', 'helix', 'asteroids'],
  gridStyle: ['cartesian', 'polar', 'dots', 'hex', 'off'],
  counterTheme: ['spacelab', 'cyber', 'apollo', 'tactical', 'aurora', 'solar', 'custom'],
  windowStyle: ['classic', 'cyber', 'apollo', 'tactical', 'aurora', 'solar', 'void', 'crimson'],
};
function settings(raw: unknown, base: Readonly<ThemeSettings>): Readonly<ThemeSettings> {
  const result = { ...base } as unknown as Record<string, unknown>;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [key, value] of Object.entries(raw)) {
    if (!(key in DEFAULT_THEME_SETTINGS) && !['worldSeed'].includes(key)) continue;
    if (key === 'windowOpacity') {
      result[key] = value == null ? base.windowOpacity : typeof value === 'number' && Number.isFinite(value) ? Math.max(.4,Math.min(1,value)) : DEFAULT_THEME_SETTINGS.windowOpacity;
    }
    else if (enumValues[key]) { if (typeof value === 'string' && enumValues[key]!.includes(value)) result[key] = value; }
    else if (key.endsWith('Color')) { if (typeof value === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3}(?:[0-9a-f]{2})?)?$/i.test(value)) result[key] = value; }
    else if (typeof value === 'boolean' && typeof result[key] === 'boolean') result[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value) && (typeof result[key] === 'number' || key === 'worldSeed')) result[key] = value;
  }
  return Object.freeze(result) as unknown as Readonly<ThemeSettings>;
}
/** No IO or DOM changes until load/set. Each controller has isolated settings/listeners. */
export function createTheme(options: ThemeOptions = {}): ThemeController {
  const defaults=settings(options.defaults??{},DEFAULT_THEME_SETTINGS);
  let current: Readonly<ThemeSettings> = defaults, disposed = false;
  const dom = themeDom(options.root);
  const listeners = new Set<(theme: Readonly<RenderThemeOptions>) => void>();
  const active = () => { if (disposed) throw new Error('Theme controller disposed'); };
  const controller: ThemeController = {
    defaults, presets: THEME_PRESETS,
    current() { active(); return current; },
    load() { active(); try { current = settings(JSON.parse(options.storage?.getItem(STORAGE_KEY) ?? 'null'), defaults); }
      catch { current = defaults; } dom.apply(current); return current; },
    set(value) { active(); current = settings(value, current);
      try { options.storage?.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* Preferences remain usable. */ }
      dom.apply(current);
      for (const listener of listeners) { try { listener(current); } catch { /* Observers cannot stop the remaining observers. */ } }
    },
    refresh() { active(); dom.apply(current); },
    subscribe(listener) { active(); listeners.add(listener); return { dispose() { listeners.delete(listener); } }; },
    backdrop(context, width, height, camera, value, time) { active(); const merged = value === current ? current : { ...current, ...value };
      drawProceduralBackdrop(context, width, height, camera, merged, time, merged.highQuality !== false); },
    dispose() { if (disposed) return; disposed = true; listeners.clear(); dom.dispose(); },
  };
  return Object.freeze(controller);
}
/** Create a presentation theme factory providing isolated theme controllers with injected theme stylesheets. */
export function createThemes(css = '', defaults:Partial<ThemeSettings> = {}): ThemeFactory {
  const controllers = new Set<ThemeController>(), styles = new Map<Document, { node: HTMLStyleElement; users: number }>(); let disposed = false;
  return Object.freeze({ create(options?: ThemeOptions) { if (disposed) throw new Error('Theme provider disposed');
    const controller = createTheme({...options,defaults:{...defaults,...options?.defaults}}), document = options?.root?.ownerDocument;
    if (document && css) {
      let lease = styles.get(document);
      if (!lease) { const node = document.createElement('style'); node.textContent = css; document.head.append(node); lease = { node, users: 0 }; styles.set(document, lease); }
      lease.users++;
    }
    let closed = false;
    const wrapper: ThemeController = Object.freeze({ ...controller, dispose() {
      if (closed) return; closed = true; controllers.delete(wrapper); controller.dispose();
      if (document && css) { const lease = styles.get(document)!; if (--lease.users === 0) { lease.node.remove(); styles.delete(document); } }
    } });
    controllers.add(wrapper); return wrapper;
  }, dispose() { if (disposed) return; disposed = true; const errors: unknown[] = [];
    for (const controller of controllers) { try { controller.dispose(); } catch (error) { errors.push(error); } }
    controllers.clear(); if (errors.length) throw new AggregateError(errors, 'Theme provider cleanup failed'); } });
}

/** Initialize the theme module, providing presentation.themes@1.0.0 and registering its usage guide. */
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({id:'usage',audience:'creators',title:"Themes",summary:"Public presentation.themes@1.0.0 service and lifecycle.",asset:'docs/creators/usage.json'});
  context.provide(THEMES, context.own(createThemes(context.assets.text('assets/theme.css') + '\n' + context.assets.text('assets/hud.css'),{windowOpacity:context.settings.windowOpacity??.96,starDensity:context.settings.starDensity??1,nebulaIntensity:context.settings.nebulaIntensity??1,gridOpacity:context.settings.gridOpacity??.45,gridSpacing:context.settings.gridSpacing??80})));
}
