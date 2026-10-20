import { WEBGL_DRAWING, type BodyPreview, type ModuleInitializationV2, type Render2DOptions, type SceneRenderer, type ServiceKey, type ShaderPack, type WebGLRendererFactory } from '@space-sim/game-api';

export interface WebGLRendererResult {
  readonly success: boolean;
  readonly renderer?: SceneRenderer;
  readonly error?: string;
}

export interface WebGLPreviewResult {
  readonly success: boolean;
  readonly preview?: BodyPreview;
  readonly error?: string;
}

export interface WebGLRendererHelper {
  tryCreateRenderer(canvas: HTMLCanvasElement, shaders: ShaderPack, options?: Render2DOptions): WebGLRendererResult;
  tryCreatePreview(canvas: HTMLCanvasElement, shaders: ShaderPack): WebGLPreviewResult;
}

export const WEBGL_RENDERER_HELPER: ServiceKey<WebGLRendererHelper> = Object.freeze({
  slot: 'example.webgl-renderer',
  version: '1.0.0',
});

export function createWebGLRendererHelper(factory: WebGLRendererFactory): WebGLRendererHelper {
  return Object.freeze({
    tryCreateRenderer(canvas: HTMLCanvasElement, shaders: ShaderPack, options?: Render2DOptions): WebGLRendererResult {
      try {
        const renderer = factory.create(canvas, shaders, options);
        return { success: true, renderer };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
    tryCreatePreview(canvas: HTMLCanvasElement, shaders: ShaderPack): WebGLPreviewResult {
      try {
        const preview = factory.preview(canvas, shaders);
        return { success: true, preview };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(WEBGL_DRAWING);
  context.provide(WEBGL_RENDERER_HELPER, createWebGLRendererHelper(factory));
}
