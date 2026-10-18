import type { ActionDefinitionV2, ControlTargetAdapter, ControlTargetBinding, LocalCameraFactory, ViewTargetTransform } from '../../packages/game-api/src/index';

/** Deliberately bounded non-flight fixture; no bodies, ships or object replication. */
export const SURVEY_ACTIONS: readonly ActionDefinitionV2[] = Object.freeze([
  { id: 'fixture.survey/move', label: 'Move survey marker', category: 'system', mode: 'axis', defaultKeys: [] },
  { id: 'fixture.survey/record', label: 'Record observation', category: 'system', mode: 'press', defaultKeys: [] },
]);
export class BoundedSurvey {
  readonly positions = new Float64Array(4);
  readonly observations = new Uint8Array(4);
  private readonly motion = new Float64Array(4);
  private readonly recording = new Uint8Array(4);
  private readonly owners = ['surveyor-a', 'surveyor-b', 'surveyor-c', 'surveyor-d'];
  private readonly targets: readonly ViewTargetTransform[];
  tick = 0;
  constructor() {
    const survey = this;
    this.targets = Array.from({ length: 4 }, (_, index) => Object.freeze({
      position: Object.freeze({ get x() { return survey.positions[index]!; }, y: index }), orientation: 0,
    }));
  }
  binding(index: number): ControlTargetBinding {
    if (!Number.isInteger(index) || index < 0 || index > 3) throw new Error('Invalid survey seat');
    return { seatId: `seat-${index + 10}`, playerId: this.owners[index]!, entityId: `marker-${index}`, viewportId: `map-${index + 20}` };
  }
  transfer(index: number, playerId: string): void {
    const binding = this.binding(index);
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(playerId)) throw new Error('Invalid survey owner');
    this.controls.release(binding); this.owners[index] = playerId;
  }
  private entity(id: string): number { return /^marker-[0-3]$/.test(id) ? Number(id.slice(-1)) : -1; }
  transform = (id: string): ViewTargetTransform | undefined => this.targets[this.entity(id)];
  private owns(binding: ControlTargetBinding): boolean {
    const index = this.entity(binding.entityId); return index >= 0 && binding.playerId === this.owners[index];
  }
  readonly controls: ControlTargetAdapter = {
    schema: 'spacelab-control-target/1', canControl: binding => this.owns(binding), actions: () => SURVEY_ACTIONS.map(action => action.id),
    setAction: (binding, action, value) => {
      if (!this.owns(binding)) throw new Error('Survey ownership rejected');
      if (!Number.isFinite(value) || Math.abs(value) > 1) throw new Error('Survey action is out of bounds');
      const index = this.entity(binding.entityId);
      if (action === 'fixture.survey/move') this.motion[index] = value;
      else if (action === 'fixture.survey/record') { if (value > 0) this.recording[index] = 1; }
      else throw new Error('Unsupported survey action');
    },
    release: binding => {
      const index = this.entity(binding.entityId); if (index < 0 || !this.owns(binding)) return;
      this.motion[index] = 0; this.recording[index] = 0;
    },
  };
  /** Only the authoritative scheduler calls this, once per tick. */
  step(): void {
    for (let index = 0; index < 4; index++) {
      this.positions[index] = Math.max(-10, Math.min(10, this.positions[index]! + this.motion[index]!));
      this.observations[index] = Math.min(100, this.observations[index]! + this.recording[index]!);
      this.recording[index] = 0;
    }
    this.tick++;
  }
}

/** Replaceable public camera fixture; no Space Sim camera or application imports. */
export function surveyCameras(rotation = 0): LocalCameraFactory {
  return { create(viewportId) {
    let targetId: string | undefined, zoom = 1, disposed = false;
    const center = { x: 0, y: 0 }, camera = { center, rotation, scale: 1 };
    return { viewportId, get targetId() { return targetId; }, get mode() { return targetId ? 'follow' as const : 'free' as const; },
      focus(id) { targetId = id; }, changeZoom(factor) { zoom *= factor; },
      frame(input) {
        if (disposed) throw new Error('Survey camera disposed');
        const target = targetId ? input.transform(targetId) : undefined;
        if (target) { center.x = target.position.x; center.y = target.position.y; }
        camera.scale = zoom; return camera;
      }, dispose() { disposed = true; },
    };
  } };
}
