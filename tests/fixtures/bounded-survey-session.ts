import type { ControlTargetBinding, TextConnection } from '../../packages/game-api/src/index';
import { BoundedSurvey } from './bounded-survey';

/** A bounded explicit non-flight codec, deliberately unrelated to the flight world/session API. */
export interface SurveySnapshot {
  readonly schema: 'spacelab-survey-state/1';
  readonly tick: number;
  readonly owners: readonly string[];
  readonly positions: readonly number[];
  readonly observations: readonly number[];
}
export interface SurveyCommand {
  readonly schema: 'spacelab-survey-command/1'; readonly seq: number;
  readonly player: string; readonly entity: string;
  readonly action: 'fixture.survey/move' | 'fixture.survey/record'; readonly value: number;
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const object = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid survey record');
  return raw as Record<string, unknown>;
};
function fields(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).length !== expected.length || expected.some(key => !(key in value))) throw new Error('Invalid survey fields');
}
export function decodeSurveySnapshot(raw: unknown): SurveySnapshot {
  const value = object(raw); fields(value, ['schema', 'tick', 'owners', 'positions', 'observations']);
  if (value.schema !== 'spacelab-survey-state/1' || !Number.isSafeInteger(value.tick) || (value.tick as number) < 0
    || !Array.isArray(value.owners) || value.owners.length !== 4 || !value.owners.every(id)
    || !Array.isArray(value.positions) || value.positions.length !== 4 || !value.positions.every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 10)
    || !Array.isArray(value.observations) || value.observations.length !== 4 || !value.observations.every(item => Number.isInteger(item) && item >= 0 && item <= 100)) throw new Error('Invalid survey snapshot');
  return { schema: 'spacelab-survey-state/1', tick: value.tick as number, owners: [...value.owners], positions: [...value.positions], observations: [...value.observations] };
}
export function decodeSurveyCommand(raw: unknown): SurveyCommand {
  const value = object(raw); fields(value, ['schema', 'seq', 'player', 'entity', 'action', 'value']);
  if (value.schema !== 'spacelab-survey-command/1' || !Number.isSafeInteger(value.seq) || (value.seq as number) < 1
    || !id(value.player) || typeof value.entity !== 'string' || !/^marker-[0-3]$/.test(value.entity)
    || !['fixture.survey/move', 'fixture.survey/record'].includes(value.action as string)
    || typeof value.value !== 'number' || !Number.isFinite(value.value) || Math.abs(value.value) > 1) throw new Error('Invalid survey command');
  return value as unknown as SurveyCommand;
}
export function surveySnapshot(world: BoundedSurvey): SurveySnapshot {
  return decodeSurveySnapshot({ schema: 'spacelab-survey-state/1', tick: world.tick,
    owners: Array.from({ length: 4 }, (_, index) => world.binding(index).playerId), positions: [...world.positions], observations: [...world.observations] });
}
export function restoreSurvey(world: BoundedSurvey, raw: unknown): void {
  const snapshot = decodeSurveySnapshot(raw);
  // Validate the complete candidate before mutating anything. Restore never replays held intent.
  for (let index = 0; index < 4; index++) world.transfer(index, snapshot.owners[index]!);
  world.positions.set(snapshot.positions); world.observations.set(snapshot.observations); world.tick = snapshot.tick;
}
export class SurveySessionHost {
  readonly world = new BoundedSurvey();
  readonly commands: SurveyCommand[] = [];
  private readonly peers = new Map<TextConnection, { player: string; seq: number }>();
  accept(peer: TextConnection, assignedPlayer: string): void {
    if (!id(assignedPlayer)) throw new Error('Invalid assigned survey player');
    const state = { player: assignedPlayer, seq: 0 }; this.peers.set(peer, state);
    peer.onmessage = text => {
      try {
        if (text.length > 2048) throw new Error('Survey command too large');
        const command = decodeSurveyCommand(JSON.parse(text));
        if (command.player !== state.player || command.seq <= state.seq) throw new Error('Survey identity or sequence rejected');
        this.apply(command); state.seq = command.seq;
      } catch { peer.close('Survey command rejected'); }
    };
    peer.onclose = () => {
      this.peers.delete(peer);
      for (let index = 0; index < 4; index++) {
        const binding = this.world.binding(index); if (binding.playerId === assignedPlayer) this.world.controls.release(binding);
      }
    };
  }
  apply(raw: unknown): void {
    const command = decodeSurveyCommand(raw), index = Number(command.entity.slice(-1));
    const binding: ControlTargetBinding = { ...this.world.binding(index), playerId: command.player };
    if (!this.world.controls.canControl(binding)) throw new Error('Survey ownership rejected');
    this.world.controls.setAction(binding, command.action, command.value); this.commands.push(command);
  }
  step(): void {
    this.world.step(); const text = JSON.stringify(surveySnapshot(this.world));
    for (const peer of this.peers.keys()) peer.send(text);
  }
  dispose(): void {
    for (const peer of this.peers.keys()) peer.close('Survey host stopped');
    this.peers.clear();
    for (let index = 0; index < 4; index++) this.world.controls.release(this.world.binding(index));
  }
}
