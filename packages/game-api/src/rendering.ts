import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { Camera, RenderBody, RenderFrame, RenderThemeOptions, Renderer, RenderTimer, ShaderPack } from './presentation';
import type { SurfaceProfile, SurfaceQuery } from './surface';
import type { VehicleArtwork } from './vehicles';

/** Generic position marker (four-point box) when a craft omits optional appearance artwork. */
export const VEHICLE_MARKER = Object.freeze([Object.freeze({x: 3, y: -3}), Object.freeze({x: -3, y: -3}), Object.freeze({x: -3, y: 3}), Object.freeze({x: 3, y: 3})]);

/** Read-only physical geometry query interface; render quality must never alter collision geometry. */
export interface RenderGeometry {
  /** Query the physical terrain radius and normal at a given angle. */
  querySurface(profile: SurfaceProfile, angle: number): SurfaceQuery;
}

/** Presentation service providing theme options and procedural backdrop drawing for renderers. */
export interface ThemeArtwork {
  /** Return the currently active presentation theme options. */
  current(): Readonly<RenderThemeOptions>;
  /** Draw the procedural starfield, nebulae and backdrop grid into the canvas context. */
  backdrop(context: CanvasRenderingContext2D, width: number, height: number, camera: Camera,
    settings: Readonly<RenderThemeOptions>, time: number): void;
}

/** Standalone render frame for body, map or designer viewers lacking active flight controls or world scheduler. */
export interface SceneFrame extends Pick<RenderFrame, 'camera' | 'bodies' | 'overlays' | 'theme' | 'showScale' | 'ships' | 'showShipLabels' | 'showBodyLabels' | 'showBodyOrbits'> {
  /** Presentation time in seconds for backdrop animation and orbit markers. */
  readonly time: number;
}

/** Presentation renderer capable of drawing flight and standalone scene frames to an owned canvas. */
export interface SceneRenderer extends Renderer {
  /** Release owned GPU programs, textures, canvas context bindings and event listeners. */
  dispose(): void;
  /** Draw a standalone celestial scene frame without controlled flight HUD or ship inputs. */
  drawScene(frame: SceneFrame, timer?: RenderTimer): void;
}

/** Lightweight preview renderer for standalone planet or celestial body preview displays. */
export interface BodyPreview extends Disposable {
  /** Whether the underlying shader program and GPU textures are linked and ready to draw. */
  readonly ready: boolean;
  /** Diagnostic error string if shader compilation or context acquisition failed. */
  readonly error?: string;
  /** Draw a preview of the specified body with optional shading fill factor. */
  draw(body: RenderBody, fill?: number): void;
}

/** Configuration options passed when creating a 2D canvas or WebGL scene renderer. */
export interface Render2DOptions {
  /** Optional vehicle appearance catalog; falls back to generic marker when omitted. */
  readonly vehicles?: VehicleArtwork;
  /** Presentation resolution cap, 0.5–4; never alters physical simulation or body dimensions. */
  readonly maxPixelRatio?: number;
  /** Physical terrain surface query port for procedural body drawing. */
  readonly geometry?: RenderGeometry;
  /** Procedural backdrop and styling provider. */
  readonly theme?: ThemeArtwork;
  /** Explicit compatibility fallback body when a scene frame contains zero bodies. */
  readonly fallbackBody?: RenderBody;
}

/** Factory providing Canvas 2D scene renderer instances. Disposing releases all created renderers. */
export interface CanvasRendererFactory extends Disposable {
  /** Create a Canvas 2D scene renderer for the given canvas element and options. */
  create(canvas: HTMLCanvasElement, options?: Render2DOptions): SceneRenderer;
}

/** Factory providing WebGL 2 scene renderers and body preview instances. Disposing releases all GPU resources. */
export interface WebGLRendererFactory extends Disposable {
  /** Create a WebGL 2 scene renderer bound to the canvas element and shader pack. */
  create(canvas: HTMLCanvasElement, shaders: ShaderPack, options?: Render2DOptions): SceneRenderer;
  /** Create a standalone body preview renderer for planet designer and celestial inspection. */
  preview(canvas: HTMLCanvasElement, shaders: ShaderPack): BodyPreview;
}

/** Service key for the public Canvas 2D renderer factory (`render.canvas@1.0.0`). */
export const CANVAS_DRAWING: ServiceKey<CanvasRendererFactory> = Object.freeze({ slot: 'render.canvas', version: '1.0.0' });

/** Service key for the public WebGL 2 renderer factory (`render.webgl@1.0.0`). */
export const WEBGL_DRAWING: ServiceKey<WebGLRendererFactory> = Object.freeze({ slot: 'render.webgl', version: '1.0.0' });

/** Service interface providing default GLSL shader packs and validation/parsing methods. */
export interface ShaderLibrary {
  /** Immutable default three-pass shader pack (scene, vector, text). */
  readonly defaults: ShaderPack;
  /** Validate a raw object or partial shader definition against the default pack. */
  validate(value: unknown): ShaderPack;
  /** Parse a .frag, .glsl or JSON shader file into a validated shader pack. */
  parse(text: string, filename: string): ShaderPack;
}

/** Service key for the public vector shader pack library (`render.vector-shaders@1.0.0`). */
export const VECTOR_SHADERS: ServiceKey<ShaderLibrary> = Object.freeze({ slot: 'render.vector-shaders', version: '1.0.0' });
