import { describe, expect, it } from 'vitest';
import { loopback } from '../../packages/net/src/connection';
import { BoundedSurvey } from '../fixtures/bounded-survey';
import { SurveySessionHost, decodeSurveyCommand, decodeSurveySnapshot, restoreSurvey, surveySnapshot, type SurveyCommand } from '../fixtures/bounded-survey-session';
const command = (seq: number, value = 1): SurveyCommand => ({ schema: 'spacelab-survey-command/1', seq,
  player: 'surveyor-a', entity: 'marker-0', action: 'fixture.survey/move', value });

describe('bounded non-flight session adapter', () => {
  it('replicates explicit commands and state over the public text port and preserves deterministic replay/save/restore', async () => {
    const host = new SurveySessionHost(), mirror = new BoundedSurvey(), [server, client] = loopback();
    host.accept(server, 'surveyor-a'); client.onmessage = text => restoreSurvey(mirror, JSON.parse(text));
    const replay = new SurveySessionHost();
    for (let tick = 1; tick <= 8; tick++) {
      const input = command(tick, tick < 5 ? 1 : -0.5); client.send(JSON.stringify(input)); await Promise.resolve();
      replay.apply(decodeSurveyCommand(JSON.parse(JSON.stringify(input))));
      host.step(); replay.step(); await Promise.resolve();
      expect(surveySnapshot(mirror)).toEqual(surveySnapshot(host.world));
    }
    expect(surveySnapshot(replay.world)).toEqual(surveySnapshot(host.world));
    const saved = JSON.parse(JSON.stringify(surveySnapshot(host.world))), restored = new BoundedSurvey();
    restoreSurvey(restored, saved); expect(surveySnapshot(restored)).toEqual(saved);
    restored.step(); expect(restored.positions[0]).toBe(saved.positions[0]); // Held controls are not persisted.
    host.dispose(); replay.dispose();
  });
  it('validates ownership and ordered sequences, releases disconnects and refuses stale owners', async () => {
    const host = new SurveySessionHost(), [server, client] = loopback(), reasons: string[] = [];
    client.onclose = reason => reasons.push(reason); host.accept(server, 'surveyor-a');
    client.send(JSON.stringify(command(1))); await Promise.resolve(); host.step(); expect(host.world.positions[0]).toBe(1);
    client.send(JSON.stringify(command(1))); await Promise.resolve(); await Promise.resolve(); host.step();
    expect(reasons).toEqual(['Survey command rejected']); expect(host.world.positions[0]).toBe(1);
    const priorOwner = host.world.binding(0);
    host.world.transfer(0, 'surveyor-next'); expect(() => host.apply(command(2))).toThrow('ownership');
    host.world.controls.setAction(host.world.binding(0), 'fixture.survey/move', 1);
    host.world.controls.release(priorOwner); host.step(); expect(host.world.positions[0]).toBe(2);
    const saved = surveySnapshot(host.world), restored = new BoundedSurvey(); restoreSurvey(restored, saved);
    expect(restored.binding(0).playerId).toBe('surveyor-next'); host.dispose();
  });
  it('rejects unknown schemas, extra fields and unbounded state before candidate mutation', () => {
    const world = new BoundedSurvey(), original = surveySnapshot(world);
    for (const invalid of [{ ...original, schema: 'space-sim-ships/1' }, { ...original, positions: [Infinity, 0, 0, 0] },
      { ...original, tick: -1 }, { ...original, arbitrary: {} }, { ...original, owners: ['unknown'] }]) {
      expect(() => decodeSurveySnapshot(invalid)).toThrow(); expect(() => restoreSurvey(world, invalid)).toThrow(); expect(surveySnapshot(world)).toEqual(original);
    }
    for (const invalid of [{ ...command(1), value: NaN }, { ...command(1), seq: 0 }, { ...command(1), action: 'flight.engine' },
      { ...command(1), args: {} }, { ...command(1), schema: 'unknown/1' }]) expect(() => decodeSurveyCommand(invalid)).toThrow();
  });
});
