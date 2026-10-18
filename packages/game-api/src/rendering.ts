import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { Camera, RenderBody, RenderFrame, RenderThemeOptions, Renderer, RenderTimer, ShaderPack } from './presentation';
import type { SurfaceProfile, SurfaceQuery } from './surface';

/** Read-only physical geometry; render quality must never change collision geometry. */
export interface RenderGeometry { querySurface(profile: SurfaceProfile, angle: number): SurfaceQuery }
export interface ThemeArtwork {
  current(): Readonly<RenderThemeOptions>;
  backdrop(context: CanvasRenderingContext2D, width: number, height: number, camera: Camera,
    settings: Readonly<RenderThemeOptions>, time: number): void;
}
/** A body/annotation viewer has no controlled vehicle, flight HUD or world scheduler. */
export interface SceneFrame extends Pick<RenderFrame, 'camera' | 'bodies' | 'overlays' | 'theme' | 'showScale' | 'ships' | 'showShipLabels'> { readonly time: number }
export interface SceneRenderer extends Renderer { dispose(): void; drawScene(frame: SceneFrame, timer?: RenderTimer): void }
export interface BodyPreview extends Disposable { readonly ready: boolean; readonly error?: string; draw(body: RenderBody, fill?: number): void }
export interface Render2DOptions {
  /** Presentation resolution cap, 0.5–4; never changes physical geometry. */
  readonly maxPixelRatio?: number;
  readonly geometry?: RenderGeometry;
  readonly theme?: ThemeArtwork;
  /** Explicit compatibility only: generic scenes otherwise contain exactly the supplied bodies. */
  readonly fallbackBody?: RenderBody;
}
export interface CanvasRendererFactory extends Disposable { create(canvas: HTMLCanvasElement, options?: Render2DOptions): SceneRenderer }
export interface WebGLRendererFactory extends Disposable {
  create(canvas: HTMLCanvasElement, shaders: ShaderPack, options?: Render2DOptions): SceneRenderer;
  preview(canvas: HTMLCanvasElement, shaders: ShaderPack): BodyPreview;
}
export const CANVAS_DRAWING: ServiceKey<CanvasRendererFactory> = Object.freeze({ slot: 'render.canvas', version: '1.0.0' });
export const WEBGL_DRAWING: ServiceKey<WebGLRendererFactory> = Object.freeze({ slot: 'render.webgl', version: '1.0.0' });
export interface ShaderLibrary {
  readonly defaults: ShaderPack;
  validate(value: unknown): ShaderPack;
  parse(text: string, filename: string): ShaderPack;
}
export const VECTOR_SHADERS: ServiceKey<ShaderLibrary> = Object.freeze({ slot: 'render.vector-shaders', version: '1.0.0' });
