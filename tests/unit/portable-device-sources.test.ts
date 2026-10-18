import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionDefinitionV2, InputFrame } from '../../packages/game-api/src/index';
import { createGamepadSource } from '../../modules/input-gamepad/src/index';
import { createTouchSource } from '../../modules/input-touch/src/index';

const actions: readonly ActionDefinitionV2[] = [
  { id: 'fixture.survey/move', label: 'Move survey marker', category: 'system', mode: 'axis', defaultKeys: [] },
  { id: 'fixture.survey/record', label: 'Record observation', category: 'system', mode: 'press', defaultKeys: [] },
];
const frame: InputFrame = { elapsed: .01, pilot: 0, flightAllowed: true, shortcutsAllowed: true };
afterEach(() => vi.unstubAllGlobals());
describe('portable gamepad actions', () => {
  it('samples non-flight actions, releases reassigned/disconnected intent and does not replay held buttons', () => {
    const pad = { connected: true, axes: [0], buttons: [{ value: 0 }] }; let assigned = 0;
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    const source = createGamepadSource({ actions, bindings: [{ action: actions[0]!.id, axis: 0 }, { action: actions[1]!.id, button: 0 }], deadzone: .15,
      pad: pilot => pilot === assigned ? 0 : undefined });
    const values = new Map<string, number>(), sink = { set: (id: string, value: number) => values.set(id, value) };
    source.sample(frame, sink); pad.axes[0] = 1; pad.buttons[0]!.value = 1; source.sample(frame, sink);
    expect([...values.values()]).toEqual([1, 1]); values.clear(); source.sample(frame, sink);
    expect([...values.keys()]).toEqual([actions[0]!.id]); values.clear();
    assigned = 1; source.sample(frame, sink); source.sample({ ...frame, pilot: 1 }, sink); expect(values.size).toBe(0);
    pad.axes[0] = 0; pad.buttons[0]!.value = 0; source.sample({ ...frame, pilot: 1 }, sink);
    pad.axes[0] = -.5; source.sample({ ...frame, pilot: 1 }, sink); expect(values.get(actions[0]!.id)).toBeCloseTo(-.35 / .85);
    values.clear(); pad.connected = false; source.sample({ ...frame, pilot: 1 }, sink); expect(values.size).toBe(0);
    pad.connected = true; source.sample({ ...frame, pilot: 1 }, sink); expect(values.size).toBe(0);
    source.dispose(); expect(() => source.sample(frame, sink)).toThrow('disposed');
  });
});
class PointerArea extends EventTarget {
  captures = new Set<number>();
  setPointerCapture(id: number) { this.captures.add(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  pointer(type: string, x = 50) {
    this.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: 50 }));
  }
}
describe('portable touch actions', () => {
  it('samples caller-owned non-flight controls and clears captures on cancellation/reassignment/disposal', () => {
    vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    const axis = new PointerArea(), record = new PointerArea(); let pilot = 0;
    const source = createTouchSource({ actions, pilot: () => pilot, bindings: [
      { action: actions[0]!.id, element: axis as unknown as HTMLElement, gesture: 'axis-x' },
      { action: actions[1]!.id, element: record as unknown as HTMLElement, gesture: 'hold' },
    ] });
    const values = new Map<string, number>(), sink = { set: (id: string, value: number) => values.set(id, value) };
    axis.pointer('pointerdown', 75); record.pointer('pointerdown'); record.pointer('pointerup'); source.sample(frame, sink);
    expect([...values.values()]).toEqual([.5, 1]);
    values.clear(); axis.pointer('pointercancel'); source.sample(frame, sink); expect(values.size).toBe(0);
    axis.pointer('pointerdown', 100); pilot = 1; source.sample({ ...frame, pilot: 1 }, sink); expect(values.size).toBe(0); expect(axis.captures.size).toBe(0);
    record.pointer('pointerdown'); record.pointer('pointercancel'); source.sample({ ...frame, pilot: 1 }, sink); expect(values.size).toBe(0);
    axis.pointer('pointerdown', 100); source.dispose(); expect(axis.captures.size).toBe(0);
    axis.pointer('pointerdown', 100); expect(axis.captures.size).toBe(0);
  });
});
