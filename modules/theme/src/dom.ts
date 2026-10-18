import type { Disposable, ThemeSettings } from '@space-sim/game-api';
import { applyHudThemeToDom } from './appearance';
const ATTRIBUTES = ['data-hud-theme', 'data-window-style'];
const CLASSES = ['hud-glow', 'hud-scanlines', 'hud-chamfer', 'compact-hud'];
const PROPERTIES = ['--ui-win-opacity', '--ui-hud-custom-color', '--ui-win-custom-accent', '--ui-grid-color'];
function fields(node: HTMLElement): Map<string, string | null> {
  return new Map([...ATTRIBUTES.map(name => [name, node.getAttribute(name)] as const),
    ...CLASSES.map(name => [`class:${name}`, String(node.classList.contains(name))] as const),
    ...PROPERTIES.flatMap(name => [[`style:${name}`, node.style.getPropertyValue(name)], [`priority:${name}`, node.style.getPropertyPriority(name)]] as const)]);
}
/** Restore only fields still carrying this controller's last value, preserving later owners. */
export function themeDom(root?: HTMLElement): Disposable & { apply(settings: Readonly<ThemeSettings>): void } {
  const nodes = new Map<HTMLElement, { before: Map<string, string | null>; last: Map<string, string | null> }>();
  return { apply(settings) {
    if (!root) return;
    const targets = [root, ...root.querySelectorAll<HTMLElement>('#flight-console,dialog,.chat-overlay,.modal-window,.inspector-panel,.flight-window,#orbit-sandbox-workspace')];
    for (const node of targets) if (!nodes.has(node)) { const before = fields(node); nodes.set(node, { before, last: before }); }
    applyHudThemeToDom(settings, root);
    for (const node of targets) nodes.get(node)!.last = fields(node);
  }, dispose() {
    for (const [node, {before, last}] of nodes) {
      const current = fields(node);
      for (const name of ATTRIBUTES) if (current.get(name) === last.get(name)) {
        const value = before.get(name); if (value === null) node.removeAttribute(name); else node.setAttribute(name, value!);
      }
      for (const name of CLASSES) if (current.get(`class:${name}`) === last.get(`class:${name}`)) node.classList.toggle(name, before.get(`class:${name}`) === 'true');
      for (const name of PROPERTIES) if (current.get(`style:${name}`) === last.get(`style:${name}`) && current.get(`priority:${name}`) === last.get(`priority:${name}`)) {
        const value = before.get(`style:${name}`); if (value) node.style.setProperty(name, value, before.get(`priority:${name}`)!); else node.style.removeProperty(name);
      }
    }
    nodes.clear();
  } };
}
