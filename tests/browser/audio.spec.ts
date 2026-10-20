import { disableNetwork } from '../helpers/offline';
import { test, expect, type Page } from '@playwright/test';
import { useCanvas } from '../helpers/canvas';
import { openPanel, closePanel } from '../helpers/workspace';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

declare global {
  interface Window { audioProbe: { contexts: AudioContext[]; meters: AnalyserNode[]; tones: OscillatorNode[]; bursts: AudioBufferSourceNode[]; peak: number;
    nativeConnect: typeof AudioNode.prototype.connect } }
}

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  const state = await page.evaluate(() => ({
    contexts: window.audioProbe?.contexts.map(context => ({ state: context.state, time: context.currentTime })),
    tones: window.audioProbe?.tones.length,
    peak: window.audioProbe?.peak,
    flight: document.getElementById('debug')?.textContent,
  }));
  await info.attach('audio-state', { contentType: 'application/json', body: JSON.stringify(state) });
});

/** Tap the actual synthesized signal before the browser's destination, without changing
 * node timing or mocking Web Audio. This catches a silent graph as well as stuck engines. */
async function meter(page: Page): Promise<void> {
  await useCanvas(page);
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    window.audioProbe = { contexts: [], meters: [], tones: [], bursts: [], peak: 0, nativeConnect: connect };
    const meters = new Map<BaseAudioContext, AnalyserNode>();
    AudioNode.prototype.connect = function (this: AudioNode, target: AudioNode | AudioParam, ...rest: number[]) {
      const tap = meters.get(this.context);
      return Reflect.apply(connect, this, [target === this.context.destination && tap ? tap : target, ...rest]);
    } as typeof connect;
    const Original = AudioContext;
    window.AudioContext = class extends Original {
      override createOscillator(): OscillatorNode {
        const tone = super.createOscillator();
        window.audioProbe.tones.push(tone);
        return tone;
      }
      override createBufferSource(): AudioBufferSourceNode {
        const burst = super.createBufferSource();
        window.audioProbe.bursts.push(burst);
        return burst;
      }
      constructor(options?: AudioContextOptions) {
        super(options);
        const tap = this.createAnalyser();
        tap.fftSize = 2048;
        Reflect.apply(connect, tap, [this.destination]);
        meters.set(this, tap);
        window.audioProbe.contexts.push(this);
        window.audioProbe.meters.push(tap);
      }
    };
  });
}
async function rms(page: Page): Promise<number> {
  return page.evaluate(() => {
    const meter = window.audioProbe.meters.at(-1);
    // Suspended contexts retain the analyser's last buffer but emit no audio.
    if (!meter || meter.context.state !== 'running') return 0;
    const samples = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  });
}
async function volume(page: Page, value: number): Promise<void> {
  await page.locator('#sound-volume').evaluate((input: HTMLInputElement, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
const contexts = (page: Page) => page.evaluate(() => window.audioProbe.contexts.length);
const debug = async (page: Page) => JSON.parse(await page.locator('#debug').textContent() || '{}');

test('generated engine audio follows thrust, volume, mute and pause', async ({ page }) => {
  await meter(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('LANDED');
  expect(await contexts(page)).toBe(0);
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.down('Space');
  await expect.poll(() => rms(page)).toBeGreaterThan(.003);
  await volume(page, 0);
  await expect.poll(() => rms(page)).toBeLessThan(.0001);
  await volume(page, 60);
  await expect.poll(() => rms(page)).toBeGreaterThan(.003);
  await page.locator('#sound-toggle').evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => page.evaluate(() => window.audioProbe.contexts[0]?.state)).toBe('suspended');
  await page.locator('#sound-toggle').evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => rms(page)).toBeGreaterThan(.003);
  await page.keyboard.up('Space');
  await expect.poll(() => rms(page)).toBeLessThan(.0001);
  // A slow audio-device resume can leave this uncontrolled launch crashing during
  // the coast. Reset before testing a second burn, independent of flight timing.
  await page.locator('#reset').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('#status')).toHaveText('LANDED');
  await page.keyboard.down('Space');
  await expect.poll(() => rms(page)).toBeGreaterThan(.003);
  await page.locator('#pause').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await expect.poll(() => rms(page)).toBeLessThan(.0001);
  await page.keyboard.up('Space');
  expect(await contexts(page)).toBe(1);
  expect(errors).toEqual([]);
});

test('sound removal closes its context and leaves the world and renderer intact', async ({ page }) => {
  await meter(page);
  await page.goto('/');
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await expect.poll(() => contexts(page)).toBe(1);
  const before = await debug(page);
  await openPanel(page, 'settings');
  await page.locator('#renderer-toggle').click();
  expect(await contexts(page)).toBe(1);
  await openPanel(page, 'library');
  if (!await page.locator('.presentation-settings').evaluate(el => (el as HTMLDetailsElement).open)) await page.locator('.presentation-settings > summary').click();
  const sound = page.locator('input[data-module="builtin.audio"]');
  await sound.uncheck();
  await expect.poll(() => page.evaluate(() => window.audioProbe.contexts[0]?.state)).toBe('closed');
  await sound.check();
  await expect.poll(() => contexts(page)).toBe(2);
  await expect.poll(async () => (await debug(page)).presentation.modules).toContain('builtin.audio');
  const after = await debug(page);
  expect(after.world).toBe(before.world);
  expect(after.fingerprint).toBe(before.fingerprint);
  await openPanel(page, 'settings');
  await volume(page, 23);
  await page.locator('#sound-toggle').click();
  await page.reload();
  await openPanel(page, 'settings');
  await expect(page.locator('#sound-toggle')).toHaveText('Sound: Off');
  await expect(page.locator('#sound-volume')).toHaveValue('23');
  expect(await contexts(page)).toBe(0);
});

test('hidden tabs suspend sound without replaying the held engine on return', async ({ page }) => {
  await meter(page);
  await page.goto('/');
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.down('Space');
  await expect.poll(() => rms(page)).toBeGreaterThan(.003);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.audioProbe.contexts[0]?.state)).toBe('suspended');
  await page.keyboard.up('Space');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.audioProbe.contexts[0]?.state)).toBe('running');
  await expect.poll(() => rms(page)).toBeLessThan(.0001);
});

for (const terrain of [false, true]) for (const attitude of ['upright', 'side-on', 'side-on-god'] as const) {
test(`a gentle ${attitude} contact on ${terrain ? 'terrain' : 'a smooth planet'} plays one audible cue and stays quiet at rest`, async ({ page }) => {
  await meter(page);
  await page.goto('/');
  const universe = { schemaVersion: 1, id: 'audio-landing', name: 'Audio landing', defaultSystemId: 'test',
    systems: [{ id: 'test', name: 'Test', bodies: [{ id: 'rock', name: 'Rock', radius: 10, mu: 100,
      ...(terrain ? { surface: { kind: 'radial', generatorVersion: 1, seed: 0, sampleCount: 64, maxReliefMetres: 0,
        minFeatureWidthMetres: 4, orientationRadians: 0, mountainRangeCount: 0, craterCount: 0,
        pads: [{ id: 'pad', angleRadians: Math.PI / 2, widthMetres: 4, elevationMetres: 0 }] } } : {}) }],
      presets: [{ id: 'pad', name: 'Pad', bodyId: 'rock', kind: 'landed' },
        { id: 'descent', name: 'Gentle descent', bodyId: 'rock', kind: 'state', position: [0, 10.5],
          velocity: [0, -.5], headingRadians: attitude === 'upright' ? Math.PI / 2 : 0 }] }] };
  await page.locator('#universe-file').setInputFiles({ name: 'landing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(universe)) });
  await expect(page.locator('#status')).toHaveText('LANDED');
  await closePanel(page);
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await expect.poll(() => page.evaluate(() => window.audioProbe.contexts.at(-1)?.state)).toBe('running');
  if (attitude === 'side-on-god') { await openPanel(page, 'settings'); await page.locator('#god-mode').check(); await closePanel(page); }
  const before = await page.evaluate(() => window.audioProbe.tones.length + window.audioProbe.bursts.length);
  await page.evaluate(async () => {
    const tap = window.audioProbe.meters.at(-1)!;
    // Latch the real signal in the audio thread: a short thud can finish while
    // rendering blocks the main thread, leaving a polled analyser buffer silent.
    const source = `class PeakMeter extends AudioWorkletProcessor {
      constructor() { super(); this.peak = 0; this.sum = 0; this.count = 0; }
      process(inputs) {
        const samples = inputs[0][0];
        if (samples && samples.length) {
          for (let i = 0; i < samples.length; i++) {
            this.sum += samples[i] * samples[i];
            if (++this.count === 2048) {
              const level = Math.sqrt(this.sum / 2048);
              if (level > this.peak) { this.peak = level; this.port.postMessage(level); }
              this.sum = 0; this.count = 0;
            }
          }
        }
        return true;
      }
    }
    registerProcessor('flight-test-peak', PeakMeter);`;
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    try { await tap.context.audioWorklet.addModule(url); }
    finally { URL.revokeObjectURL(url); }
    window.audioProbe.peak = 0;
    const meter = new AudioWorkletNode(tap.context, 'flight-test-peak', { outputChannelCount: [1] });
    meter.port.onmessage = event => { window.audioProbe.peak = Math.max(window.audioProbe.peak, event.data); };
    Reflect.apply(window.audioProbe.nativeConnect, tap, [meter]);
    // The processor's output stays silent. Preserve the original audible route
    // and bypass the probe's destination rerouting to avoid a feedback cycle.
    Reflect.apply(window.audioProbe.nativeConnect, meter, [tap.context.destination]);
  });
  await page.locator('#preset').evaluate((select: HTMLSelectElement) => {
    select.value = 'descent'; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#status')).toHaveText('FLYING');
  await expect(page.locator('#status')).toHaveText(attitude === 'side-on' ? 'CRASHED' : 'LANDED');
  await expect.poll(() => page.evaluate(() => window.audioProbe.peak)).toBeGreaterThan(.003);
  if (terrain) await expect.poll(async () => (await debug(page)).contact?.time).toEqual(expect.any(Number));
  expect(await page.evaluate(() => window.audioProbe.tones.length + window.audioProbe.bursts.length)).toBe(before + 1);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.audioProbe.tones.length + window.audioProbe.bursts.length)).toBe(before + 1);
  await expect.poll(() => rms(page)).toBeLessThan(.0001);
  // A restored contact establishes a baseline; resuming emits only its normal cue.
  const voices = await page.evaluate(() => window.audioProbe.tones.length + window.audioProbe.bursts.length);
  await openPanel(page, 'fleet');
  const download = page.waitForEvent('download'); await page.locator('#save-world').click();
  const bytes = await readFile(await (await download).path());
  await page.locator('#world-file').setInputFiles({ name: 'contact.spaceuniverse', mimeType: 'application/zip', buffer: bytes });
  await expect(page.locator('#flight-message')).toContainText('Universe loaded');
  expect(await page.evaluate(() => window.audioProbe.tones.length + window.audioProbe.bursts.length)).toBe(voices);
  await closePanel(page); await page.locator('#pause').click();
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.audioProbe.tones.length + window.audioProbe.bursts.length)).toBe(voices + 1);
});
}

test('the offline game synthesizes audio with networking disabled', async ({ page, context }) => {
  await meter(page);
  await disableNetwork(context);
  await page.goto(pathToFileURL(resolve('dist/space-lab-offline.html')).href);
  await expect(page.locator('#status')).toHaveText('LANDED');
  await closePanel(page);
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.down('Space');
  await expect.poll(() => rms(page)).toBeGreaterThan(.003);
  await page.keyboard.up('Space');
  await expect.poll(() => rms(page)).toBeLessThan(.0001);
});

test('an unavailable audio device never prevents flight', async ({ page }) => {
  await useCanvas(page);
  await page.addInitScript(() => {
    window.AudioContext = class { constructor() { throw new Error('No audio device'); } } as typeof AudioContext;
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await page.keyboard.up('Space');
  await openPanel(page, 'settings');
  await expect(page.locator('#sound-toggle')).toHaveText('Sound: unavailable');
  expect(errors).toEqual([]);
});
