import { CanvasRenderer, PlanetPreview, WebGLRenderer, type Renderer } from '../../packages/render-2d/src/index';
import { initialState } from '../../packages/sim-core/src/index';

/** Compare actual pixels with a fixed camera and clock, without simulation or HUD movement. */
export function audit(rendererType: 'canvas' | 'webgl', highQuality: boolean) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1000px;height:800px;display:block';
  document.body.replaceChildren(canvas);
  if (rendererType === 'webgl' && !canvas.getContext('webgl2')) return null;
  const renderer: Renderer = rendererType === 'canvas' ? new CanvasRenderer(canvas) : new WebGLRenderer(canvas);
  const gl = rendererType === 'webgl' ? canvas.getContext('webgl2')! : null;
  const originalClock = Object.getOwnPropertyDescriptor(performance, 'now');
  let time = 10000;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => time });
  function sample(starDensity: number, starsVisible = true, clock = 10000) {
    time = clock;
    renderer.draw({
      state: initialState(), path: [], pathClosed: false, engine: false, showScale: false,
      camera: { center: { x: 0, y: 0 }, rotation: 0, scale: 1 },
      bodies: [{ id: 'far', name: '', position: { x: 1e10, y: 1e10 }, radius: 1 }],
      shipWorldPosition: { x: 1e10, y: 1e10 }, padPosition: { x: 1e10, y: 1e10 },
      theme: { backdropStyle: 'void', nebulaVisible: false, galaxiesVisible: false,
        gridEnabled: false, animatedNebula: false, starDensity, starsVisible, highQuality },
    });
    const pixels = gl ? new Uint8Array(canvas.width * canvas.height * 4)
      : canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    if (gl) gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels as Uint8Array);
    let hash = 2166136261, bright = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      for (let c = 0; c < 3; c++) hash = Math.imul(hash ^ pixels[i + c]!, 16777619);
      if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 50) bright++;
    }
    return { hash: hash >>> 0, bright, error: gl?.getError() ?? 0 };
  }
  try {
    return {
      densities: [0.2, 0.5, 1, 2, 2.5].map(density => sample(density)),
      first: sample(1), repeat: sample(1), later: sample(1, true, 12000),
      hidden: sample(2, false), hiddenLater: sample(2, false, 12000),
    };
  } finally {
    if (originalClock) Object.defineProperty(performance, 'now', originalClock);
    else Reflect.deleteProperty(performance, 'now');
    renderer.dispose?.();
  }
}

export async function previewStars() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:800px;height:600px;display:block';
  document.body.replaceChildren(canvas);
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const preview = new PlanetPreview(canvas);
  try {
    for (let attempt = 0; !preview.ready; attempt++) {
      if (preview.error) throw new Error(preview.error);
      if (attempt >= 3000) throw new Error('Planet preview shader did not finish compiling');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    preview.draw({ id: 'rock', name: 'Rock', position: { x: 0, y: 0 }, radius: 10 }, 0.3);
    const height = Math.floor(canvas.height / 4);
    const pixels = new Uint8Array(canvas.width * height * 4);
    // An outer quarter contains only sky, outside the centered planet.
    gl.readPixels(0, 0, canvas.width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let bright = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 50) bright++;
    }
    return { bright, error: gl.getError() };
  } finally { preview.dispose(); }
}
