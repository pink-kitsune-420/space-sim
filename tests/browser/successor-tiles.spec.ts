import { test, expect, type Page } from '@playwright/test';
import { useCanvas, useLowGraphics } from '../helpers/canvas';
import { openPanel, closePanel } from '../helpers/workspace';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform } from 'node:os';
import successor from '../../games/space-sim-successor/game.json' with { type: 'json' };

const debug = async (page: Page) => JSON.parse(await page.locator('#debug').textContent() || '{}');
const evidence = 'private-docs/proposals/games/evidence/successor-tile-prototype';

for (const renderer of ['Canvas', 'WebGL']) {
  test(`${renderer} bounded tiles: all sizes, bodies and world scales with rotation and silhouette`, async ({ page }, info) => {
    test.setTimeout(renderer === 'Canvas' ? 240000 : 600000);
    await page.setViewportSize(renderer === 'Canvas' ? { width: 1100, height: 800 } : { width: 640, height: 480 });
    await useLowGraphics(page);
    if (renderer === 'Canvas') await useCanvas(page);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const counts = { tiles: 0, draws: 0, fills: 0 };
      (window as unknown as { tileCounts: typeof counts }).tileCounts = counts;
      const proto = WebGL2RenderingContext.prototype;
      for (const [name, key] of [['drawArraysInstanced', 'tiles'], ['drawArrays', 'draws']] as const) {
        const original = proto[name];
        Object.defineProperty(proto, name, { value: function (...args: unknown[]) {
          counts[key]++; return Reflect.apply(original, this, args);
        } });
      }
      const original = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (...args) { counts.fills++; return original.apply(this, args); };
    });
    await page.goto('/?game=space-sim-successor');
    await expect(page.locator('#status')).toHaveText('LANDED');
    await expect.poll(async () => (await debug(page)).renderer).toBe(renderer === 'Canvas' ? 'builtin.canvas' : 'builtin.webgl');
    await mkdir(evidence, { recursive: true });
    const results: unknown[] = [];
    for (const scale of [2, 4, 8]) for (const [preset, body] of [['pad', 'planet'], ['parvus-pad', 'moon']]) {
      await openPanel(page, 'setup');
      await page.locator('#system-select').selectOption(scale === 4 ? 'primus-system' : `primus-system-${scale}x`);
      await page.locator('#preset').selectOption(preset!);
      for (const size of ['0.25', '0.5', '1']) {
        await page.locator('#successor-tile-size').selectOption(size);
        await closePanel(page);
        await expect.poll(async () => (await debug(page)).successorTiles?.tileMetres).toBe(Number(size));
        await expect.poll(async () => (await debug(page)).successorTiles?.visibleChunks).toBeGreaterThan(0);
        const d = await debug(page);
        expect(d.body).toBe(body); expect(d.vehicle.contactRadiusMetres).toBe(2.5);
        expect(Math.abs(d.groundClearance)).toBeLessThan(1e-6);
        expect(d.successorTiles.visibleChunks).toBeLessThan(100);
        expect(d.successorTiles.residentChunks).toBeLessThanOrEqual(512);
        expect(d.successorTiles.bufferBytes).toBeLessThan(2_000_000);
        if (renderer === 'Canvas' || scale === 4 || size === '0.5') await page.screenshot({ path: `${evidence}/${renderer}-${scale}x-${body}-${size}m-${info.project.name}.png` });
        results.push({ scale, body, size, stats: d.successorTiles });
        await openPanel(page, 'setup');
      }
      await closePanel(page);
      const compareBoundary = scale === 4 && body === 'planet';
      const tiledImage = compareBoundary ? (await page.locator('#flight-view').screenshot()).toString('base64') : '';
      const boundaryCamera = compareBoundary ? (await debug(page)).camera : null;
      const boundaryCssWidth = compareBoundary ? await page.locator('#flight-view').evaluate(canvas => canvas.clientWidth) : 0;
      // Selecting vector baseline retires derived buffers; physical contact is unchanged.
      await openPanel(page, 'setup');
      await page.locator('#successor-tile-size').selectOption('0'); await closePanel(page);
      await expect.poll(async () => (await debug(page)).successorTiles?.bufferBytes).toBe(0);
      expect(Math.abs((await debug(page)).groundClearance)).toBeLessThan(1e-6);
      if (renderer === 'Canvas' || scale === 4) await page.screenshot({ path: `${evidence}/${renderer}-${scale}x-${body}-vector-${info.project.name}.png` });
      if (compareBoundary) {
        const vectorImage = (await page.locator('#flight-view').screenshot()).toString('base64');
        const comparison = await page.evaluate(async ({ tiledImage, vectorImage, scale, cssWidth }) => {
          const load = async (png: string) => {
            const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
            return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
          };
          const a = await load(tiledImage), b = await load(vectorImage);
          // Locator screenshots use device pixels; the camera scale uses CSS pixels.
          const pixelRatio = a.width / cssWidth;
          const boundary = a.height / 2 + 2.5 * scale * pixelRatio;
          let changedSky = 0, changedGround = 0;
          // Left of the ship/reference; exclude a 3 CSS px antialias band around the physical edge.
          for (let y = 0; y < Math.min(a.height, boundary + 80 * pixelRatio); y++) for (let x = Math.ceil(30 * pixelRatio); x < a.width * .2; x++) {
            const i = (y * a.width + x) * 4;
            const different = Math.max(Math.abs(a.data[i]! - b.data[i]!), Math.abs(a.data[i+1]! - b.data[i+1]!), Math.abs(a.data[i+2]! - b.data[i+2]!)) > 10;
            if (different && y < boundary - 3 * pixelRatio) changedSky++;
            if (different && y > boundary + 3 * pixelRatio) changedGround++;
          }
          return { changedSky, changedGround, pixelRatio };
        }, { tiledImage, vectorImage, scale: boundaryCamera.scale, cssWidth: boundaryCssWidth });
        expect(comparison.changedSky).toBeLessThan(50);
        expect(comparison.changedGround).toBeGreaterThan(100);
        results.push({ pixelBoundaryComparison: comparison });
      }

      await openPanel(page, 'setup'); await page.locator('#successor-tile-size').selectOption('0.5'); await closePanel(page);
      await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
      await page.keyboard.press('KeyC');
      await expect.poll(async () => (await debug(page)).camera?.mode).toBe('free');
      await expect.poll(async () => (await debug(page)).successorTiles?.visibleChunks).toBe(0);
      if (renderer === 'Canvas' || scale === 4) await page.screenshot({ path: `${evidence}/${renderer}-${scale}x-${body}-silhouette-${info.project.name}.png` });
      for (const site of ['ridge-lookout', 'basin-station']) {
        await openPanel(page, 'setup'); await page.locator('#preset').selectOption(`${body}-${site}`); await closePanel(page);
        await expect(page.locator('#status')).toHaveText('LANDED');
        await expect.poll(async () => (await debug(page)).successorTiles?.visibleChunks).toBeGreaterThan(0);
        expect(Math.abs((await debug(page)).groundClearance)).toBeLessThan(1e-6);
        if (renderer === 'Canvas' || scale === 4) await page.screenshot({ path: `${evidence}/${renderer}-${scale}x-${body}-${site}-${info.project.name}.png` });
      }

    }
    // Warm matched workload: actual browser counters, frame intervals, existing work profiler, heap.
    for (const mode of ['0', '0.25', '0.5', '1']) {
      await openPanel(page, 'setup'); await page.locator('#system-select').selectOption('primus-system');
      await page.locator('#preset').selectOption('pad'); await page.locator('#successor-tile-size').selectOption(mode); await closePanel(page);
      await page.waitForTimeout(5500); // replace the profiler's rolling warmup samples
      let heapAfterGC: unknown;
      if (info.project.name === 'chromium') {
        const cdp = await page.context().newCDPSession(page); await cdp.send('HeapProfiler.collectGarbage');
        heapAfterGC = await cdp.send('Runtime.getHeapUsage'); await cdp.detach();
      }
      const measurement = await page.evaluate(async () => {
        const counts = (window as unknown as { tileCounts: { tiles: number; draws: number; fills: number } }).tileCounts;
        const initial = { ...counts }, intervals: number[] = []; let previous = performance.now(), start = previous;
        await new Promise<void>(resolve => {
          function frame(now: number) {
            intervals.push(now - previous); previous = now;
            if (now - start < 5000) requestAnimationFrame(frame); else resolve();
          }
          requestAnimationFrame(frame);
        });
        intervals.sort((a, b) => a - b);
        const gl = document.createElement('canvas').getContext('webgl2');
        const extension = gl?.getExtension('WEBGL_debug_renderer_info');
        const gpu = extension ? gl!.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null;
        return { frames: intervals.length, intervalP50: intervals[Math.floor(intervals.length * .5)],
          intervalP95: intervals[Math.floor(intervals.length * .95)],
          actualTileDrawsPerFrame: (counts.tiles - initial.tiles) / intervals.length,
          actualOtherDrawsPerFrame: (counts.draws - initial.draws) / intervals.length,
          actualCanvasFillsPerFrame: (counts.fills - initial.fills) / intervals.length,
          heap: (() => { const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory; return m ? { usedJSHeapSize: m.usedJSHeapSize, totalJSHeapSize: m.totalJSHeapSize, jsHeapSizeLimit: m.jsHeapSizeLimit } : null; })(),
          gpu };
      });
      results.push({ measurement: true, mode, ...measurement, heapAfterGC, diagnostics: await debug(page) });
    }
    // Production rotation fixtures and slopes use the unchanged world/profile and hull.
    const definition = successor.bundle.modules[0]!.data.universes[0]!.definition;
    const fixture = { ...definition, id: 'successor-tile-rotation-check', systems: definition.systems.map(system => ({ ...system,
      bodies: system.bodies.map(b => ({ ...b, ...('rotation' in b && b.rotation ? { rotation: { ...b.rotation, phaseRadiansAtEpoch: Math.PI / 4 } } : {}) })),
      presets: [...system.presets, ...['planet', 'moon'].filter(id => system.bodies.some(b => b.id === id)).map(id => ({
        id: `${id}-slope`, name: `${id} slope check`, bodyId: id, kind: 'landed', phaseRadians: Math.PI / 2 - 65 / system.bodies.find(b => b.id === id)!.radius, zoom: 30,
      }))] })) };
    await openPanel(page, 'setup');
    await page.locator('#universe-file').setInputFiles({ name: 'tile-rotation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    for (const preset of ['pad', 'parvus-pad', 'planet-slope', 'moon-slope']) {
      await page.locator('#preset').selectOption(preset); await closePanel(page);
      await expect(page.locator('#status')).toHaveText('LANDED');
      await expect.poll(async () => (await debug(page)).successorTiles?.visibleChunks).toBeGreaterThan(0);
      expect(Math.abs((await debug(page)).groundClearance)).toBeLessThan(1e-6);
      await page.locator('#camera-north').click();
      await page.screenshot({ path: `${evidence}/${renderer}-rotated-${preset}-${info.project.name}.png` });
      await openPanel(page, 'setup');
    }
    await writeFile(`${evidence}/${renderer}-${info.project.name}-measurements.json`, JSON.stringify({
      browser: info.project.name, userAgent: await page.evaluate(() => navigator.userAgent), renderer, cpu: cpus()[0]?.model,
      platform: platform(), viewport: { ...page.viewportSize(), devicePixelRatio: await page.evaluate(() => window.devicePixelRatio) }, graphics: 'low, void backdrop',
      caveat: 'Headless browser; Chromium heap collected after explicit GC. Hardware GPU not qualified. Fixed landing-sector prototype, not streaming. ssssas-pjs7 remains open.', results,
    }, null, 2));
    expect(errors).toEqual([]);
  });
}

for (const renderer of ['Canvas']) {
  test(`${renderer} landmark inspection starts leave signs readable`, async ({ page }, info) => {
    test.setTimeout(180000);
    await useLowGraphics(page); if (renderer === 'Canvas') await useCanvas(page);
    await page.setViewportSize(renderer === 'Canvas' ? { width: 1100, height: 800 } : { width: 640, height: 480 });
    await page.goto('/?game=space-sim-successor'); await expect(page.locator('#status')).toHaveText('LANDED');
    for (const scale of [2, 4, 8]) for (const body of ['planet', 'moon']) for (const site of ['ridge-lookout', 'basin-station']) {
      await openPanel(page, 'setup');
      await page.locator('#system-select').selectOption(scale === 4 ? 'primus-system' : `primus-system-${scale}x`);
      await page.locator('#preset').selectOption(`${body}-${site}`); await closePanel(page);
      await expect(page.locator('#status')).toHaveText('LANDED');
      await expect.poll(async () => (await debug(page)).successorTiles?.visibleChunks).toBeGreaterThan(0);
      expect(Math.abs((await debug(page)).groundClearance)).toBeLessThan(1e-6);
      await page.screenshot({ path: `${evidence}/${renderer}-${scale}x-${body}-${site}-${info.project.name}.png` });
    }
  });
}
