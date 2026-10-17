import type { Renderer, RendererProvider, ShaderPack } from '../../../packages/game-api/src/index';
import { DEFAULT_SHADERS, MAX_SHADER_FILE_BYTES, parseShaderFile } from '../../../packages/render-2d/src/index';
import { element, show, download, message } from './ui';

type EventSink = (kind: string, detail: Record<string, string>) => void;

/** Owns the canvas and the live renderer built from the selected provider. Optional
 * features (shader packs, raster flush) are discovered from the renderer, never its class.
 * A failed replacement leaves the active pair intact. */
export class Rendering {
  renderer: Renderer | undefined;
  provider: RendererProvider | undefined;
  shaders = DEFAULT_SHADERS;
  readonly unavailable = new Set<string>();
  private loadVersion = 0;
  /** The page's canvas has never been given a context. */
  private pristine = true;

  /** `name` labels a provider for messages; `shaderName` names the installed shader-capable one. */
  constructor(public canvas: HTMLCanvasElement, private readonly name: (provider: RendererProvider) => string,
    private readonly shaderName: () => string | undefined) {}

  private replacementCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.id = 'flight-view'; canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', this.canvas.getAttribute('aria-label') || '');
    canvas.className = this.canvas.className;
    return canvas;
  }

  /** Build `provider`'s renderer on a fresh canvas, then swap it in and dispose the old one.
   * Each attempt uses a canvas no context has touched, so a failed WebGL start can fall back. */
  replace(provider: RendererProvider, beforeSwap: () => void = () => {}): void {
    const canvas = this.pristine ? this.canvas : this.replacementCanvas();
    this.pristine = false;
    let next: Renderer;
    try {
      next = provider.create(canvas, provider.capabilities.shaders ? { shaders: this.shaders } : {});
      this.unavailable.delete(provider.id);
    } catch (error) { this.unavailable.add(provider.id); throw error; }
    beforeSwap();
    if (canvas !== this.canvas) this.canvas.replaceWith(canvas);
    this.renderer?.dispose?.();
    this.canvas = canvas; this.renderer = next; this.provider = provider;
    element('renderer-toggle').textContent = `Renderer: ${provider.label}`;
    show('shader-status', next.features?.shaders ? `Using ${next.features.shaders.pack.name}.`
      : `${this.name(provider)} uses the built-in style.${this.shaderName() ? ` Load a shader to switch to ${this.shaderName()}.` : ''}`);
  }

  dispose(): void { this.renderer?.dispose?.(); this.renderer = undefined; }

  /** Renderer/shader UI bindings are platform work, outside the flight loop. `useShaderRenderer`
   * selects a renderer whose provider declares shader support, keeping presentation modules. */
  bindControls(options: { readonly toggle: () => void; readonly useShaderRenderer: () => void; readonly event: EventSink }): void {
    const useShaders = (pack: ShaderPack): void => {
      const previous = this.shaders;
      this.shaders = pack;
      try {
        const control = this.renderer?.features?.shaders;
        if (control) control.set(pack);
        else options.useShaderRenderer();
      } catch (error) { this.shaders = previous; throw error; }
      show('shader-name', pack.name);
      show('shader-status', `Using ${pack.name}. Shader choices last for this session; export to keep a copy.`);
      options.event('shader-load', { name: pack.name });
    };
    element('renderer-toggle').addEventListener('click', () => {
      try { options.toggle(); }
      catch (error) { show('shader-status', `Renderer could not be changed: ${message(error)}`); }
    });
    const input = element<HTMLInputElement>('shader-file');
    element('load-shader').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const version = ++this.loadVersion;
      input.value = '';
      show('shader-status', `Loading ${file.name}…`);
      try {
        if (file.size > MAX_SHADER_FILE_BYTES) throw new Error('Shader files must be at most 1 MiB.');
        const text = await file.text();
        if (version !== this.loadVersion) return;
        useShaders(parseShaderFile(text, file.name));
      } catch (error) {
        if (version !== this.loadVersion) return;
        show('shader-status', `Shader was not loaded: ${message(error)}`);
      }
    });
    element('reset-shader').addEventListener('click', () => {
      ++this.loadVersion;
      try {
        if (this.renderer?.features?.shaders) useShaders(DEFAULT_SHADERS);
        else {
          this.shaders = DEFAULT_SHADERS;
          show('shader-name', 'Default');
          show('shader-status', `Default restored. ${this.provider ? this.name(this.provider) : 'This renderer'} uses the built-in style.`);
        }
      } catch (error) { show('shader-status', `Default could not be restored: ${message(error)}`); }
    });
    element('export-shader').addEventListener('click', () => download('space-sim-shaders.json', JSON.stringify(this.shaders, null, 2)));
  }
}
