import './style.css';
import { Clock, IDLE, MODEL, STEP, initialState, magnitude, planet, predict, step,
  type Controls, type Preset, type Sample } from '../../../packages/sim-core/src/index';
import { CanvasRenderer, blendAngle } from '../../../packages/render-2d/src/index';

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}
const canvas = document.querySelector('canvas')!;
const renderer = new CanvasRenderer(canvas);
const clock = new Clock();
const keys = new Set<string>();
const pointers = new Map<number, string>();
const preset = element<HTMLSelectElement>('preset');
const slider = element<HTMLInputElement>('throttle');
const pauseButton = element<HTMLButtonElement>('pause');
const cameraButton = element<HTMLButtonElement>('camera');
const orientationButton = element<HTMLButtonElement>('orientation');
let state = initialState();
let paused = false;
let pauseReason = '';
let follow = true;
let horizon = false;
let zoom = 1;
let rotation = 0;
let lastWall: number | undefined;
let previousEngine = false;
let preview: Sample[] = [];
let job: ReturnType<typeof predict> | undefined;
let jobPoints: Sample[] = [];
let predictionEpoch = 0;
let jobEpoch = 0;
let lastPrediction = -Infinity;
let predictionComplete = false;
let previewGenerationMs = 0;
let jobWorkMs = 0;
let lastHud = -Infinity;
const frameWork: number[] = [];
const simulationWork: number[] = [];
const frameIntervals: number[] = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function controls(): Controls {
  const held = new Set([...pointers.values()]);
  return {
    turn: Number(keys.has('ArrowLeft') || held.has('left')) - Number(keys.has('ArrowRight') || held.has('right')),
    throttle: Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown')),
    engine: keys.has('Space') || held.has('engine'),
  };
}
function release(): void {
  keys.clear(); pointers.clear(); previousEngine = false;
  for (const button of document.querySelectorAll('[data-hold]')) button.setAttribute('aria-pressed', 'false');
  element('burn').setAttribute('aria-pressed', 'false');
}
function invalidatePrediction(): void {
  job = undefined; preview = []; jobPoints = [];
  lastPrediction = -Infinity; predictionComplete = false;
}
function setPaused(value: boolean, reason = ''): void {
  paused = value; pauseReason = reason;
  release(); clock.reset(); lastWall = undefined;
  pauseButton.textContent = paused ? 'Resume' : 'Pause';
  pauseButton.setAttribute('aria-pressed', String(paused));
}
function reset(): void {
  release(); state = initialState(preset.value as Preset); rotation = 0; zoom = 1;
  invalidatePrediction(); setPaused(false); lastHud = -Infinity;
}
function changeZoom(factor: number): void { zoom = Math.max(0.15, Math.min(20, zoom * factor)); }
function toggleCamera(): void {
  follow = !follow; cameraButton.textContent = follow ? 'Follow ship' : 'Planet view';
}
function toggleOrientation(): void {
  horizon = !horizon; orientationButton.textContent = horizon ? 'Horizon up' : 'North up';
}
pauseButton.addEventListener('click', () => setPaused(!paused));
element('reset').addEventListener('click', reset);
preset.addEventListener('change', reset);
cameraButton.addEventListener('click', toggleCamera);
orientationButton.addEventListener('click', toggleOrientation);
element('zoom-in').addEventListener('click', () => changeZoom(1.3));
element('zoom-out').addEventListener('click', () => changeZoom(1 / 1.3));
slider.addEventListener('input', () => {
  state = { ...state, throttle: Number(slider.value) / 100, revision: state.revision + 1 };
});
const flightKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
const shortcuts = new Set(['KeyP', 'KeyR', 'KeyC', 'KeyH', 'Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract']);
window.addEventListener('keydown', event => {
  // Native controls keep their own arrows/Space; flight shortcuts only run outside them.
  if ((event.target as HTMLElement).closest('input, select, button, summary, a')) return;
  if (!flightKeys.has(event.code) && !shortcuts.has(event.code)) return;
  event.preventDefault();
  if (flightKeys.has(event.code)) { if (!paused) keys.add(event.code); return; }
  if (event.repeat) return;
  if (event.code === 'KeyP') setPaused(!paused);
  if (event.code === 'KeyR') reset();
  if (event.code === 'KeyC') toggleCamera();
  if (event.code === 'KeyH') toggleOrientation();
  if (event.code === 'Equal' || event.code === 'NumpadAdd') changeZoom(1.3);
  if (event.code === 'Minus' || event.code === 'NumpadSubtract') changeZoom(1 / 1.3);
});
window.addEventListener('keyup', event => { keys.delete(event.code); });
window.addEventListener('blur', () => setPaused(true, 'Window lost focus'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true, 'Tab was hidden');
});
window.addEventListener('pagehide', () => setPaused(true, 'Page was hidden'));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-hold]')) {
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('pointerdown', event => {
    if (paused || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, button.dataset.hold!);
    button.setAttribute('aria-pressed', 'true');
  });
  const end = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    button.setAttribute('aria-pressed', String([...pointers.values()].includes(button.dataset.hold!)));
  };
  button.addEventListener('pointerup', end);
  button.addEventListener('pointercancel', end);
  button.addEventListener('lostpointercapture', end);
  // A focused hold button can also be operated with keyboard Space or Enter.
  button.addEventListener('keydown', event => {
    if ((event.code === 'Space' || event.code === 'Enter') && !paused) {
      event.preventDefault(); pointers.set(-1, button.dataset.hold!); button.setAttribute('aria-pressed', 'true');
    }
  });
  button.addEventListener('keyup', event => {
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault(); pointers.delete(-1); button.setAttribute('aria-pressed', 'false');
    }
  });
  button.addEventListener('blur', () => { pointers.delete(-1); button.setAttribute('aria-pressed', 'false'); });
}

function updatePrediction(now: number, engine: boolean): void {
  if (engine !== previousEngine) { invalidatePrediction(); previousEngine = engine; }
  if (!job && (now - lastPrediction > 500 || preview.length === 0)) {
    job = predict(state); jobPoints = []; jobEpoch = state.time;
    lastPrediction = now; jobWorkMs = 0; predictionComplete = false;
  }
  const begin = performance.now();
  while (job && performance.now() - begin < 2) {
    const result = job.next();
    if (result.done) {
      preview = jobPoints; predictionEpoch = jobEpoch; job = undefined; predictionComplete = true;
      previewGenerationMs = jobWorkMs + performance.now() - begin;
    } else jobPoints.push(result.value);
  }
  jobWorkMs += performance.now() - begin;
}

function quantile(values: number[], q: number): string {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0).toFixed(2);
}
function hud(engine: boolean): void {
  const r = magnitude(state.position);
  const radial = (state.position.x * state.velocity.x + state.position.y * state.velocity.y) / r;
  element('altitude').textContent = Math.max(0, r - planet.radius).toFixed(1);
  element('speed').textContent = magnitude(state.velocity).toFixed(1);
  element('vertical').textContent = `${radial >= 0 ? '+' : ''}${radial.toFixed(1)}`;
  element('heading').textContent = ((state.heading * 180 / Math.PI + 360) % 360).toFixed(0);
  element('time').textContent = `${Math.floor(state.time / 60).toString().padStart(2, '0')}:${(state.time % 60).toFixed(2).padStart(5, '0')}`;
  element('status').textContent = paused ? 'PAUSED' : state.status.toUpperCase();
  element('throttle-value').textContent = `${Math.round(state.throttle * 100)}%`;
  if (document.activeElement !== slider) slider.value = String(Math.round(state.throttle * 100));
  element('burn').setAttribute('aria-pressed', String(engine && !paused));
  element('prediction').textContent = `${predictionComplete ? 'Ready' : 'Sampling'} · age ${Math.max(0, state.time - predictionEpoch).toFixed(1)} s`;
  element('flight-message').textContent = paused ? `${pauseReason || 'Flight paused'}. Select Resume to continue.`
    : state.status === 'crashed' ? 'Surface impact. Reset flight to try again.'
      : state.status === 'landed' ? 'On the surface. Hold Space to launch.'
        : engine ? 'ENGINE ACTIVE · Coast preview assumes cutoff now' : 'COASTING · Let momentum do the work';
  const diagnostics = {
    model: MODEL, body: planet.id, stepSeconds: STEP, steps: clock.lastSteps,
    droppedSeconds: clock.droppedSeconds, predictionAgeSeconds: Math.max(0, state.time - predictionEpoch),
    predictionWorkMs: previewGenerationMs, samples: preview.length,
    workP50Ms: quantile(frameWork, .5), workP95Ms: quantile(frameWork, .95), workP99Ms: quantile(frameWork, .99),
    workWorstMs: Math.max(0, ...frameWork).toFixed(2), simulationP95Ms: quantile(simulationWork, .95),
    intervalP95Ms: quantile(frameIntervals, .95),
    viewport: `${canvas.clientWidth}×${canvas.clientHeight}`, dpr: window.devicePixelRatio,
    time: state.time, engine: engine && !paused, position: state.position, velocity: state.velocity,
  };
  element('debug').textContent = JSON.stringify(diagnostics, null, 2);
}

function frame(now: number): void {
  const begin = performance.now();
  const elapsed = lastWall === undefined ? 0 : (now - lastWall) / 1000;
  lastWall = now;
  const command = paused ? IDLE : controls();
  if (!paused) clock.advance(elapsed, () => { state = step(state, command); });
  const simWork = performance.now() - begin;
  updatePrediction(now, command.engine);
  const target = horizon ? Math.PI / 2 - Math.atan2(state.position.y, state.position.x) : 0;
  rotation = blendAngle(rotation, target, reducedMotion.matches ? 1 : Math.min(1, elapsed / .12));
  const scale = Math.min(canvas.clientWidth, canvas.clientHeight) / 1500 * zoom;
  renderer.draw({ state, path: preview, engine: command.engine && !paused,
    camera: { center: follow ? state.position : { x: 0, y: 0 }, rotation, scale } });
  frameWork.push(performance.now() - begin); simulationWork.push(simWork);
  if (elapsed > 0) frameIntervals.push(elapsed * 1000);
  for (const values of [frameWork, simulationWork, frameIntervals]) if (values.length > 600) values.shift();
  if (now - lastHud > 80) { hud(command.engine); lastHud = now; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
