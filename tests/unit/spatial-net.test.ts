import { describe, expect, it } from 'vitest';
import { createSparsePageStore } from '../../packages/game-api/src/index';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { loopback } from '../../packages/net/src/connection';
import { ClientSession } from '../../packages/net/src/client';
import { HostSession } from '../../packages/net/src/host';
import {
  MAX_SUBSCRIBED_CHUNKS,
  MAX_CHUNK_BYTES_PER_TICK,
  PROTOCOL,
  SPATIAL_CHUNK_PROTOCOL,
  parseClientMessage,
  parseHostMessage,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from '../../packages/net/src/protocol';
import {
  intersectsBox,
  distancePointToSegment,
  computeTrajectoryConeRadius,
  isChunkInTrajectoryCone,
  parseChunkKey,
  formatChunkKey,
  chunkBounds,
  chunkCenter,
} from '../../packages/net/src/spatial';

describe('Spatial Interest Management & Seed-First Net Sync (RFC REC-10)', () => {
  describe('Spatial Math & Trajectory Cone Calculations (Section 3.1)', () => {
    it('detects 2D bounding box intersections correctly', () => {
      const boxA = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      const boxB = { minX: 50, minY: 50, maxX: 150, maxY: 150 };
      const boxC = { minX: 200, minY: 200, maxX: 300, maxY: 300 };

      expect(intersectsBox(boxA, boxB)).toBe(true);
      expect(intersectsBox(boxB, boxA)).toBe(true);
      expect(intersectsBox(boxA, boxC)).toBe(false);
      expect(intersectsBox(boxB, boxC)).toBe(false);
    });

    it('calculates point-to-segment Euclidean distance', () => {
      // Segment along X axis from (0, 0) to (100, 0)
      expect(distancePointToSegment(50, 20, 0, 0, 100, 0)).toBeCloseTo(20);
      // Point before start of segment
      expect(distancePointToSegment(-30, 40, 0, 0, 100, 0)).toBeCloseTo(50);
      // Point past end of segment
      expect(distancePointToSegment(130, 40, 0, 0, 100, 0)).toBeCloseTo(50);
      // Degenerate segment (point)
      expect(distancePointToSegment(30, 40, 0, 0, 0, 0)).toBeCloseTo(50);
    });

    it('computes trajectory cone radius with minimum clamping and dynamic speed scaling', () => {
      // Speed 0 -> clamped to MIN_CONE_RADIUS_METRES (500m)
      expect(computeTrajectoryConeRadius(0)).toBe(500);

      // Low speed (e.g. 50 m/s): 50 * 5 * tan(15 deg) ~= 66.98m -> clamped to 500m
      expect(computeTrajectoryConeRadius(50)).toBe(500);

      // High speed (e.g. 1000 m/s): 1000 * 5 * tan(15 deg) ~= 1339.75m -> > 500m
      const highSpeedRadius = computeTrajectoryConeRadius(1000);
      expect(highSpeedRadius).toBeGreaterThan(1300);
      expect(highSpeedRadius).toBeCloseTo(1000 * 5 * Math.tan((15 * Math.PI) / 180));
    });

    it('evaluates whether chunk center falls within the lookahead trajectory cone', () => {
      const position = { x: 0, y: 0 };
      const velocity = { x: 200, y: 0 }; // 200 m/s along +X over 5s -> endpoint (1000, 0)
      // Radius will be max(500, 200 * 5 * tan(15 deg)) = 500m

      // Chunk in path at (500, 200): distance to line is 200m <= 500m -> true
      expect(isChunkInTrajectoryCone({ x: 500, y: 200 }, position, velocity)).toBe(true);

      // Chunk far perpendicular at (500, 700): distance is 700m > 500m -> false
      expect(isChunkInTrajectoryCone({ x: 500, y: 700 }, position, velocity)).toBe(false);

      // Chunk past future horizon at (1600, 0): distance to (1000, 0) is 600m > 500m -> false
      expect(isChunkInTrajectoryCone({ x: 1600, y: 0 }, position, velocity)).toBe(false);

      // Chunk behind vessel at (-600, 0): distance to (0, 0) is 600m > 500m -> false
      expect(isChunkInTrajectoryCone({ x: -600, y: 0 }, position, velocity)).toBe(false);
    });

    it('parses and formats canonical chunk keys', () => {
      expect(parseChunkKey('b:earth:c:1:-2')).toEqual({ bodyId: 'earth', x: 1, y: -2 });
      expect(parseChunkKey('b:moon:c:0:0:3')).toEqual({ bodyId: 'moon', x: 0, y: 0, z: 3 });
      expect(parseChunkKey('chunk:4:5')).toEqual({ x: 4, y: 5 });
      expect(parseChunkKey('chunk:-1:-2:3')).toEqual({ x: -1, y: -2, z: 3 });
      expect(parseChunkKey('invalid:key')).toBeNull();

      expect(formatChunkKey('earth', 1, -2)).toBe('b:earth:c:1:-2');
      expect(formatChunkKey(undefined, 4, 5)).toBe('chunk:4:5');

      const bounds = chunkBounds(2, 3, 1000);
      expect(bounds).toEqual({ minX: 2000, minY: 3000, maxX: 3000, maxY: 4000 });
      expect(chunkCenter(2, 3, 1000)).toEqual({ x: 2500, y: 3500 });
    });
  });

  describe('Protocol Encoding & Message Validation (Section 2)', () => {
    it('correctly converts binary buffers to and from Base64 strings', () => {
      const original = new Uint8Array([0, 1, 2, 255, 128, 64, 32, 16, 8, 4, 2, 1]);
      const encoded = uint8ArrayToBase64(original);
      const decoded = base64ToUint8Array(encoded);
      expect(decoded).toEqual(original);
    });

    it('validates protocol version constants', () => {
      expect(PROTOCOL).toBe('space-sim-net/6');
      expect(SPATIAL_CHUNK_PROTOCOL).toBe('space-sim-spatial/1');
    });

    it('parses valid sub-chunks and unsub-chunks client messages', () => {
      const sub = parseClientMessage(
        JSON.stringify({
          t: 'sub-chunks',
          bodyId: 'earth',
          chunkKeys: ['b:earth:c:0:1', 'b:earth:c:0:2'],
        })
      );
      expect(sub).toEqual({
        t: 'sub-chunks',
        bodyId: 'earth',
        chunkKeys: ['b:earth:c:0:1', 'b:earth:c:0:2'],
      });

      const unsub = parseClientMessage(
        JSON.stringify({
          t: 'unsub-chunks',
          bodyId: 'earth',
          chunkKeys: ['b:earth:c:0:1'],
        })
      );
      expect(unsub).toEqual({
        t: 'unsub-chunks',
        bodyId: 'earth',
        chunkKeys: ['b:earth:c:0:1'],
      });
    });

    it('parses valid chunk-delta host messages', () => {
      const msg = parseHostMessage(
        JSON.stringify({
          t: 'chunk-delta',
          bodyId: 'earth',
          tick: 42,
          deltas: [
            { key: 'b:earth:c:0:1', delta: 'AQIDBA==', revision: 1 },
          ],
        })
      );
      expect(msg).toEqual({
        t: 'chunk-delta',
        bodyId: 'earth',
        tick: 42,
        deltas: [
          { key: 'b:earth:c:0:1', delta: 'AQIDBA==', revision: 1 },
        ],
      });
    });
  });

  describe('Host & Client Integration (Section 6 Verification Test Cases)', () => {
    it('1. handles sub-chunks and unsub-chunks messages between client and host', () => {
      const [clientEnd, hostEnd] = loopback(deliver => deliver());
      const hostWorld = new World(DEFAULT_UNIVERSE, { id: 'w-host' });
      const host = new HostSession(hostWorld);
      const client = new ClientSession(clientEnd, { name: 'Pilot' });
      host.accept(hostEnd);

      expect(client.phase).toBe('joined');
      const playerId = client.playerId!;

      // Initially no subscriptions
      expect(host.getSubscriptions(playerId).size).toBe(0);

      // Subscribe to two chunks
      client.subChunks('earth', ['b:earth:c:0:1', 'b:earth:c:0:2']);
      expect(host.getSubscriptions(playerId).has('b:earth:c:0:1')).toBe(true);
      expect(host.getSubscriptions(playerId).has('b:earth:c:0:2')).toBe(true);
      expect(host.getSubscriptions(playerId).size).toBe(2);

      // Unsubscribe from one chunk
      client.unsubChunks('earth', ['b:earth:c:0:1']);
      expect(host.getSubscriptions(playerId).has('b:earth:c:0:1')).toBe(false);
      expect(host.getSubscriptions(playerId).has('b:earth:c:0:2')).toBe(true);
      expect(host.getSubscriptions(playerId).size).toBe(1);

      client.leave();
      host.dispose();
      hostWorld.dispose();
    });

    it('2. routes chunk-delta only to clients subscribed to that specific chunk key', () => {
      const [clientAEnd, hostAEnd] = loopback(deliver => deliver());
      const [clientBEnd, hostBEnd] = loopback(deliver => deliver());
      const hostWorld = new World(DEFAULT_UNIVERSE, { id: 'w-host' });
      const pageStore = createSparsePageStore(1024);
      const host = new HostSession(hostWorld, {}, { pageStore });

      const deltasA: string[] = [];
      const deltasB: string[] = [];

      const clientA = new ClientSession(clientAEnd, {
        name: 'PilotA',
        onChunkDelta: (_bodyId, payloads) => {
          for (const p of payloads) deltasA.push(p.key);
        },
      });
      const clientB = new ClientSession(clientBEnd, {
        name: 'PilotB',
        onChunkDelta: (_bodyId, payloads) => {
          for (const p of payloads) deltasB.push(p.key);
        },
      });

      host.accept(hostAEnd);
      host.accept(hostBEnd);

      // Client A subscribes to chunk 0:1, Client B subscribes to chunk 1:0
      clientA.subChunks('earth', ['b:earth:c:0:1']);
      clientB.subChunks('earth', ['b:earth:c:1:0']);

      // Host modifies both chunks
      const dataA = new Uint8Array(1024);
      dataA.fill(1);
      const dataB = new Uint8Array(1024);
      dataB.fill(2);

      pageStore.setPage('b:earth:c:0:1', dataA);
      pageStore.setPage('b:earth:c:1:0', dataB);

      // Step host to trigger delta broadcast
      host.step();

      // Client A should have received only chunk 0:1
      expect(deltasA).toEqual(['b:earth:c:0:1']);
      // Client B should have received only chunk 1:0
      expect(deltasB).toEqual(['b:earth:c:1:0']);

      clientA.leave();
      clientB.leave();
      host.dispose();
      hostWorld.dispose();
    });

    it('3. rejects invalid chunk key syntax or excessive (>128) chunk subscriptions', () => {
      // 3a. Invalid chunk key syntax throws in parser
      expect(() =>
        parseClientMessage(
          JSON.stringify({
            t: 'sub-chunks',
            bodyId: 'earth',
            chunkKeys: ['invalid-key!'],
          })
        )
      ).toThrow('invalid chunk key format');

      // 3b. More than 128 keys in a single message throws in parser
      const oversizedKeys = Array.from({ length: 129 }, (_, i) => `b:earth:c:0:${i}`);
      expect(() =>
        parseClientMessage(
          JSON.stringify({
            t: 'sub-chunks',
            bodyId: 'earth',
            chunkKeys: oversizedKeys,
          })
        )
      ).toThrow(`chunkKeys must be a list of at most ${MAX_SUBSCRIBED_CHUNKS} keys`);

      // 3c. Cumulative subscription over 128 keys is rejected by host
      const [clientEnd, hostEnd] = loopback(deliver => deliver());
      const hostWorld = new World(DEFAULT_UNIVERSE, { id: 'w-host' });
      const host = new HostSession(hostWorld);
      let noticeMessage = '';
      const client = new ClientSession(clientEnd, {
        name: 'Pilot',
        onnotice: text => {
          noticeMessage = text;
        },
      });
      host.accept(hostEnd);

      const batch1 = Array.from({ length: 100 }, (_, i) => `b:earth:c:0:${i}`);
      const batch2 = Array.from({ length: 30 }, (_, i) => `b:earth:c:1:${i}`);

      client.subChunks('earth', batch1);
      expect(host.getSubscriptions(client.playerId!).size).toBe(100);

      // Subscribing 30 more would reach 130 > 128 -> rejected with notice
      client.subChunks('earth', batch2);
      expect(noticeMessage).toContain(`Exceeded maximum chunk subscriptions (${MAX_SUBSCRIBED_CHUNKS})`);
      expect(host.getSubscriptions(client.playerId!).size).toBe(100);

      client.leave();
      host.dispose();
      hostWorld.dispose();
    });

    it('4. throttles outbound chunk delta byte rate when multiple pages are modified simultaneously', () => {
      const [clientEnd, hostEnd] = loopback(deliver => deliver());
      const hostWorld = new World(DEFAULT_UNIVERSE, { id: 'w-host' });
      const pageSize = 2048; // 2 KiB per page
      const pageStore = createSparsePageStore(pageSize);
      const host = new HostSession(hostWorld, {}, { pageStore });

      const receivedPerTick: number[][] = [];
      let currentTickDeltas: number[] = [];

      const client = new ClientSession(clientEnd, {
        name: 'Pilot',
        onChunkDelta: (_bodyId, payloads) => {
          currentTickDeltas.push(payloads.length);
        },
      });
      host.accept(hostEnd);

      // Subscribe to 40 chunks: 40 * 2048 = 81,920 bytes (> 64 KiB)
      const numPages = 40;
      const keys = Array.from({ length: numPages }, (_, i) => `b:earth:c:${i}:0`);
      client.subChunks('earth', keys);

      // Host modifies all 40 pages in the same tick
      for (const key of keys) {
        const buf = new Uint8Array(pageSize);
        buf.fill(7);
        pageStore.setPage(key, buf);
      }

      // Tick 1
      currentTickDeltas = [];
      host.step();
      receivedPerTick.push(currentTickDeltas);

      // 64 KiB budget allows max 32 pages of 2048 bytes (32 * 2048 = 65,536 bytes)
      const tick1Count = receivedPerTick[0]!.reduce((sum, n) => sum + n, 0);
      expect(tick1Count).toBe(32);
      expect(tick1Count * pageSize).toBeLessThanOrEqual(MAX_CHUNK_BYTES_PER_TICK);

      // Tick 2: Drains the remaining 8 pages
      currentTickDeltas = [];
      host.step();
      receivedPerTick.push(currentTickDeltas);

      const tick2Count = receivedPerTick[1]!.reduce((sum, n) => sum + n, 0);
      expect(tick2Count).toBe(8);

      // All 40 pages delivered across the two consecutive ticks
      expect(tick1Count + tick2Count).toBe(numPages);

      client.leave();
      host.dispose();
      hostWorld.dispose();
    });

    it('5. client correctly updates local SparsePageStore upon receiving chunk delta', () => {
      const [clientEnd, hostEnd] = loopback(deliver => deliver());
      const hostWorld = new World(DEFAULT_UNIVERSE, { id: 'w-host' });
      const hostStore = createSparsePageStore(2048);
      const clientStore = createSparsePageStore(2048);

      const host = new HostSession(hostWorld, {}, { pageStore: hostStore });
      const dirtyEvents: Array<{ bodyId: string; key: string }> = [];

      const client = new ClientSession(clientEnd, {
        name: 'Pilot',
        pageStore: clientStore,
        onChunkDirty: (bodyId, chunkKey) => {
          dirtyEvents.push({ bodyId, key: chunkKey });
        },
      });
      host.accept(hostEnd);

      const chunkKey = 'b:earth:c:10:20';
      client.subChunks('earth', [chunkKey]);

      // Host writes distinctive test data into the page
      const testBuffer = new Uint8Array(2048);
      testBuffer[0] = 0xde;
      testBuffer[1] = 0xad;
      testBuffer[2] = 0xbe;
      testBuffer[3] = 0xef;
      testBuffer[2047] = 0x99;
      hostStore.setPage(chunkKey, testBuffer);

      // Client does not have the page yet
      expect(clientStore.getPage(chunkKey)).toBeUndefined();

      // Host steps and broadcasts delta
      host.step();

      // Client local SparsePageStore has received and committed the binary page
      const clientPage = clientStore.getPage(chunkKey);
      expect(clientPage).toBeDefined();
      expect(clientPage).toEqual(testBuffer);

      // onChunkDirty callback was triggered
      expect(dirtyEvents).toEqual([{ bodyId: 'earth', key: chunkKey }]);

      client.leave();
      host.dispose();
      hostWorld.dispose();
    });
  });
});
