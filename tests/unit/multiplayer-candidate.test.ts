import { expect, it } from 'vitest';
import { prepareGame, DEFAULT_PROFILE } from '../../packages/modules/src/index';
import { validateUniverse } from '../../packages/sim-core/src/universe';
import { saveWorld } from '../../packages/sim-core/src/save';
import { verifyServerCandidate } from '../../apps/web/src/multiplayer-candidate';
import { browserSessionFactory } from '../../apps/web/src/module-session';
import { HostSession } from '../../packages/net/src/host';
import { loopback } from '../../packages/net/src/connection';
import type { AuthoritativeLock } from '../../packages/game-api/src/index';
import fixture from '../fixtures/world-save-v1.json';

const installed = { environment: 'offline' as const, profile: DEFAULT_PROFILE, data: [], code: [] };
function savedServer() {
  return prepareGame({ environment: 'node', universe: validateUniverse(fixture.universe) });
}
function candidate(prepared: ReturnType<typeof prepareGame>) {
  return { lock: prepared.world.lock, fingerprint: prepared.world.simulationFingerprint,
    universe: prepared.world.universe, systemId: prepared.world.system.system.id };
}

it('reconstructs an older server universe with installed modules and leaves the solo world intact', async () => {
  const server = savedServer(), solo = prepareGame({ environment: 'offline' });
  const host = new HostSession(server.world);
  try {
    expect(server.world.simulationFingerprint).not.toBe(solo.world.simulationFingerprint);
    const before = saveWorld(solo.world);
    const verified = verifyServerCandidate(candidate(server), installed);
    expect(verified).toEqual({ ok: true, simulationFingerprint: server.world.simulationFingerprint });
    const [serverPeer, clientPeer] = loopback();
    const joining = browserSessionFactory.join(clientPeer, { name: 'Old world visitor',
      lock: solo.world.lock, simulationFingerprint: solo.world.simulationFingerprint,
      verifyCandidate: received => verifyServerCandidate(received, installed) }, new AbortController().signal);
    host.accept(serverPeer);
    const session = await joining;
    expect(session.world.simulationFingerprint).toBe(server.world.simulationFingerprint);
    expect(session.world.universe).toEqual(server.world.universe);
    expect(saveWorld(solo.world)).toEqual(before);
    session.dispose();
  } finally { host.close(); server.candidate.dispose(); solo.candidate.dispose(); }
});

it.each(['modules', 'settings', 'geometry', 'fingerprint', 'universe'])('rejects incompatible or inconsistent server %s', changed => {
  const server = savedServer();
  try {
    const received = structuredClone(candidate(server));
    const lock = received.lock as AuthoritativeLock;
    if (changed === 'modules') received.lock = { ...lock, modules: [...lock.modules, { id: 'missing.authority', version: '1.0.0' }] };
    if (changed === 'settings') received.lock = { ...lock, settings: { 'builtin.motion': { acceleration: 999 } } };
    if (changed === 'geometry') received.lock = { ...lock, physicalGeometry: {} };
    if (changed === 'fingerprint') received.fingerprint = '0'.repeat(64);
    if (changed === 'universe') received.universe = validateUniverse({ ...received.universe,
      systems: received.universe.systems.map(system => ({ ...system, bodies: system.bodies.map(body => ({ ...body, radius: (body.radius ?? 128) * 2 })) })) });
    expect(verifyServerCandidate(received, installed).ok).toBe(false);
  } finally { server.candidate.dispose(); }
});
