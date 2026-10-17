import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, randomHex } from '../../packages/net/src/sha256';
import { MAX_CLIENT_MESSAGE, parseClientMessage, parseHostMessage } from '../../packages/net/src/protocol';
import { serverUrl } from '../../packages/net/src/websocket';

describe('network protocol', () => {
  it.each(['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'pilot ✳ 宇宙 🚀', 'x'.repeat(10_000)])(
    'hashes like node:crypto (%#)', text => {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    });

  it('makes random hex of the requested size', () => {
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex(16)).not.toBe(randomHex(16));
  });

  it.each([
    ['localhost', 'ws://localhost:6464/ws'],
    ['192.168.1.20:7000', 'ws://192.168.1.20:7000/ws'],
    ['[::1]', 'ws://[::1]:6464/ws'],
    ['[::1]:80', 'ws://[::1]/ws'], // 80 is ws: default
    ['http://game.example', 'ws://game.example/ws'],
    ['https://game.example:8443/', 'wss://game.example:8443/ws'],
    ['wss://game.example/custom', 'wss://game.example/custom'],
    ['  example.org  ', 'ws://example.org:6464/ws'],
  ])('reads the server address %s', (input, url) => {
    expect(serverUrl(input)).toBe(url);
  });

  it('uses wss for bare addresses from secure pages and rejects other schemes', () => {
    expect(serverUrl('example.org', true)).toBe('wss://example.org:6464/ws');
    expect(() => serverUrl('ftp://example.org')).toThrow('is not a server address');
    expect(() => serverUrl(' ')).toThrow('Enter a server address.');
  });

  it('validates client commands strictly', () => {
    expect(parseClientMessage('{"t":"join","name":"Ada","token":"0123456789abcdef0123456789abcdef"}'))
      .toEqual({ t: 'join', name: 'Ada', token: '0123456789abcdef0123456789abcdef' });
    expect(parseClientMessage('{"t":"input","seq":3,"ship":"ship-1","tick":9,"turn":-1,"throttle":0.5,"engine":false,"set":1}'))
      .toEqual({ t: 'input', seq: 3, ship: 'ship-1', tick: 9, turn: -1, throttle: 0.5, engine: false, set: 1 });
    expect(() => parseClientMessage('{"t":"join","name":"Ada","token":"short"}')).toThrow('token must be 32 hex digits');
    expect(() => parseClientMessage('{"t":"input","seq":-1,"ship":"s","tick":0,"turn":0,"throttle":0,"engine":true}')).toThrow('seq must be an integer');
    expect(() => parseClientMessage('{"t":"remove","ship":"../../etc"}')).toThrow('ship must be an id');
    expect(() => parseClientMessage('{"t":"god","ship":"ship-1","on":"yes"}')).toThrow('on must be boolean');
    expect(() => parseClientMessage('[]')).toThrow('message must be an object');
    expect(() => parseClientMessage('{"t":"admin"}')).toThrow('unknown message type admin');
    expect(() => parseClientMessage(`{"t":"ping","id":1,"pad":"${'x'.repeat(MAX_CLIENT_MESSAGE)}"}`)).toThrow('message exceeds');
  });

  it('validates host messages without trusting the host', () => {
    expect(parseHostMessage('{"t":"pong","id":4,"tick":12}')).toEqual({ t: 'pong', id: 4, tick: 12 });
    expect(parseHostMessage('{"t":"error","code":"weird","message":"Bye"}')).toEqual({ t: 'error', code: 'invalid', message: 'Bye' });
    expect(() => parseHostMessage('{"t":"snapshot","tick":1,"time":-1,"paused":false,"ships":[]}')).toThrow('time must be finite');
    expect(() => parseHostMessage('{"t":"snapshot","tick":1,"time":0.01,"paused":false,"ships":[{"controls":[0,0,2]}]}'))
      .toThrow('ship.controls must be [turn, throttle, engine]');
    expect(() => parseHostMessage('{"t":"players","players":[{"id":"p","name":"A","connected":"yes"}]}')).toThrow('player.connected must be boolean');
  });

  it('validates protocol version 3 lock, fingerprint, and moduleState', () => {
    const validFingerprint = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const info = parseHostMessage(JSON.stringify({
      t: 'info', protocol: 'space-sim-net/4', model: 'default/v1', worldId: 'w-1', name: 'Server', password: false,
      players: 1, maxPlayers: 8, fingerprint: validFingerprint,
    }));
    expect(info).toMatchObject({ t: 'info', protocol: 'space-sim-net/4', fingerprint: validFingerprint });

    expect(() => parseHostMessage(JSON.stringify({
      t: 'info', protocol: 'space-sim-net/4', model: 'default/v1', worldId: 'w-1', name: 'Server', password: false,
      players: 1, maxPlayers: 8, fingerprint: 'short',
    }))).toThrow('fingerprint must be 64 hex digits');

    const welcome = parseHostMessage(JSON.stringify({
      t: 'welcome', playerId: 'p-1', universe: { schemaVersion: 1 }, systemId: 'sys-1', tick: 0, time: 0, paused: false,
      rules: { maxPlayers: 8, maxShipsPerPlayer: 4, allowGodMode: true, snapshotEveryTicks: 5 }, players: [], ships: [],
      lock: { format: 'space-sim-auth-lock/1', profileId: 'test', modules: [], order: [], providers: {}, settings: {}, contentDigests: {}, physicalGeometry: {}, rules: [], forces: [] },
      fingerprint: validFingerprint,
      moduleState: { 'test.rule': { state: { version: 1, value: 42 }, randomState: 12345 } },
    }));
    expect(welcome).toMatchObject({
      t: 'welcome',
      fingerprint: validFingerprint,
      lock: { format: 'space-sim-auth-lock/1' },
      moduleState: { 'test.rule': { state: { version: 1, value: 42 }, randomState: 12345 } },
    });

    expect(() => parseHostMessage(JSON.stringify({
      t: 'welcome', playerId: 'p-1', universe: { schemaVersion: 1 }, systemId: 'sys-1', tick: 0, time: 0, paused: false,
      rules: { maxPlayers: 8, maxShipsPerPlayer: 4, allowGodMode: true, snapshotEveryTicks: 5 }, players: [], ships: [],
      lock: { format: 'invalid' },
    }))).toThrow('invalid lock format');

    const snap = parseHostMessage(JSON.stringify({
      t: 'snapshot', tick: 10, time: 0.1, paused: false, ships: [],
      moduleState: { 'test.rule': { state: { version: 1, value: 'active' }, randomState: 99 } },
    }));
    expect(snap).toMatchObject({
      t: 'snapshot',
      moduleState: { 'test.rule': { state: { version: 1, value: 'active' }, randomState: 99 } },
    });

    expect(() => parseHostMessage(JSON.stringify({
      t: 'snapshot', tick: 10, time: 0.1, paused: false, ships: [],
      moduleState: { 'test.rule': { state: { version: -1, value: 0 }, randomState: 99 } },
    }))).toThrow('moduleState version must be a non-negative integer');
  });
});
