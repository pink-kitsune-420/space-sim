import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, firefox } from '@playwright/test';
import { createServer } from 'vite';

// Exercise the real transport in separate browser processes without simulation/rendering.
// No public service is contacted unless --stun is supplied. Reports omit SDP, addresses,
// credentials and candidate IDs. A local success does not qualify cross-network play.
const { values } = parseArgs({ options: {
  stun: { type: 'boolean', default: false },
  out: { type: 'string', default: 'private-docs/measurements/multiplayer-audit.json' },
} });
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, values.out);
const report = { schema: 1, recordedAt: new Date().toISOString(), scope: 'same-machine separate browser processes',
  publicStunRequested: values.stun, scenarios: [] };
const server = await createServer({ root: resolve(root, 'apps/web'), configFile: false,
  server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'audit-empty-page',
    configureServer(dev) {
      dev.middlewares.use('/__multiplayer-audit', (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Multiplayer transport audit</title>');
      });
    },
  }] });
const browsers = [];

/** Install observation before importing the application's unmodified transport. */
async function observer(browser, url) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(url);
  await page.evaluate(async () => {
    const Native = window.RTCPeerConnection;
    const audit = window.audit = { peers: [], errors: [], received: [] };
    window.RTCPeerConnection = class extends Native {
      constructor(config) {
        super(config);
        audit.peers.push(this);
        this.addEventListener('icecandidateerror', event => audit.errors.push({ code: event.errorCode }));
      }
    };
    audit.api = await import('/src/webrtc.ts');
    audit.counts = sdp => {
      const counts = {};
      for (const match of (sdp ?? '').matchAll(/^a=candidate:.*? typ (\w+)/gm)) {
        counts[match[1]] = (counts[match[1]] ?? 0) + 1;
      }
      return counts;
    };
    audit.snapshot = () => {
      const pc = audit.peers[0];
      return { gathering: pc.iceGatheringState, candidates: audit.counts(pc.localDescription?.sdp) };
    };
    audit.diagnostics = async () => {
      const pc = audit.peers[0];
      const stats = await pc.getStats();
      const transports = [...stats.values()].filter(stat => stat.type === 'transport');
      const selected = transports.map(stat => stats.get(stat.selectedCandidatePairId)).filter(Boolean);
      return { ...audit.snapshot(), connection: pc.connectionState, ice: pc.iceConnectionState,
        errors: audit.errors, pairs: selected.map(pair => ({
          state: pair.state, local: stats.get(pair.localCandidateId)?.candidateType,
          remote: stats.get(pair.remoteCandidateId)?.candidateType,
          protocol: stats.get(pair.localCandidateId)?.protocol,
          roundTripSeconds: pair.currentRoundTripTime,
        })) };
    };
  });
  return page;
}

/** Transfer more than one transport chunk, including multibyte text, both ways. */
async function scenario(hostBrowser, guestBrowser, stun) {
  const result = { host: hostBrowser.browserType().name(), guest: guestBrowser.browserType().name(), stun };
  const pages = [];
  try {
    const url = `${server.resolvedUrls.local[0]}__multiplayer-audit`;
    const host = await observer(hostBrowser, url); pages.push(host);
    const guest = await observer(guestBrowser, url); pages.push(guest);
    const offer = await host.evaluate(async stun => {
      const start = performance.now();
      const a = window.audit;
      a.invite = await a.api.createInvite(stun);
      return { code: a.invite.code, export: a.snapshot(), elapsedMs: performance.now() - start };
    }, stun);
    result.offer = { ...offer, code: undefined };
    const reply = await guest.evaluate(async code => {
      const start = performance.now();
      const a = window.audit;
      a.reply = await a.api.answerInvite(code);
      // Install immediately, before the host can send application data.
      a.waiting = a.reply.connection.then(connection => {
        a.connection = connection;
        connection.onmessage = text => a.received.push(text);
      });
      a.waiting.catch(() => {});
      return { code: a.reply.code, export: a.snapshot(), elapsedMs: performance.now() - start };
    }, offer.code);
    result.reply = { ...reply, code: undefined };
    await host.evaluate(async code => {
      const a = window.audit;
      a.connection = await a.invite.accept(code);
      a.connection.onmessage = text => a.received.push(text);
    }, reply.code);
    await guest.evaluate(() => window.audit.waiting);
    result.connected = true;
    const ascii = 'orbital-flight '.repeat(8192);
    await host.evaluate(text => window.audit.connection.send(text), ascii);
    await guest.waitForFunction(() => window.audit.received.length === 1);
    assert.equal(await guest.evaluate(() => window.audit.received[0]), ascii);
    await guest.evaluate(text => window.audit.connection.send(text), ascii);
    await host.waitForFunction(() => window.audit.received.length === 1);
    assert.equal(await host.evaluate(() => window.audit.received[0]), ascii);
    result.asciiEqualBothWays = true;
    await host.evaluate(() => { window.audit.received = []; });
    await guest.evaluate(() => { window.audit.received = []; });
    const payload = 'Orbital flight 🚀 '.repeat(8192);
    await host.evaluate(text => window.audit.connection.send(text), payload);
    await guest.waitForFunction(() => window.audit.received.length === 1, undefined, { timeout: 15000 });
    result.hostToGuest = integrity(payload, await guest.evaluate(() => window.audit.received[0]));
    await guest.evaluate(text => window.audit.connection.send(text), payload);
    await host.waitForFunction(() => window.audit.received.length === 1, undefined, { timeout: 15000 });
    result.guestToHost = integrity(payload, await host.evaluate(() => window.audit.received[0]));
    result.payloadCodeUnitsEachWay = payload.length;
    result.hostDiagnostics = await host.evaluate(() => window.audit.diagnostics());
    result.guestDiagnostics = await guest.evaluate(() => window.audit.diagnostics());
    result.ok = result.hostToGuest.equal && result.guestToHost.equal;
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    result.ok = false;
    // Exception messages from browsers can contain network addresses; retain only a class.
    result.failure = error.name;
    for (const [i, page] of pages.entries()) {
      try { result[i === 0 ? 'hostDiagnostics' : 'guestDiagnostics'] = await page.evaluate(() => window.audit.diagnostics()); }
      catch { /* initialization may have failed */ }
    }
    process.exitCode = 1;
  } finally {
    await Promise.all(pages.map(page => page.context().close()));
  }
  report.scenarios.push(result);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${result.host} -> ${result.guest}, STUN ${stun ? 'on' : 'off'}: `
    + `connected=${result.connected === true}, ASCII=${result.asciiEqualBothWays === true}, `
    + `Unicode=${result.ok ? 'PASS' : 'FAIL'}`);
}

/** Describe differences in the synthetic payload without printing message text. */
function integrity(expected, actual) {
  assert.equal(typeof actual, 'string');
  let firstMismatch = -1;
  for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
    if (expected.charCodeAt(i) !== actual.charCodeAt(i)) { firstMismatch = i; break; }
  }
  return { equal: expected === actual, sentCodeUnits: expected.length, receivedCodeUnits: actual.length,
    firstMismatch, expectedCodeUnit: firstMismatch >= 0 ? expected.charCodeAt(firstMismatch) : undefined,
    receivedCodeUnit: firstMismatch >= 0 ? actual.charCodeAt(firstMismatch) : undefined };
}

try {
  await server.listen();
  browsers.push(await chromium.launch());
  browsers.push(await firefox.launch());
  report.browserVersions = browsers.map(browser => ({ name: browser.browserType().name(), version: browser.version() }));
  for (const stun of values.stun ? [false, true] : [false]) {
    await scenario(browsers[0], browsers[1], stun);
    await scenario(browsers[1], browsers[0], stun);
  }
} finally {
  await Promise.all(browsers.map(browser => browser.close()));
  await server.close();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Private report: ${output}`);
}
