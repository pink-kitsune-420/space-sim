import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionDefinitionV2, InputFrame } from '../../packages/game-api/src/index';
import { createKeyboardSource } from '../../modules/input-keyboard/src/index';

class DeviceTarget extends EventTarget {
  listeners = 0;
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    this.listeners++; super.addEventListener(type, callback, options);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    this.listeners--; super.removeEventListener(type, callback, options);
  }
}
function browser() {
  const window = new DeviceTarget(), document = Object.assign(new DeviceTarget(), { hidden: false });
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  return { window, document, key(type: 'keydown' | 'keyup', code: string, modifiers: object = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false }, modifiers);
    window.dispatchEvent(event); return event;
  } };
}
const actions: readonly ActionDefinitionV2[] = [
  { id: 'fixture.survey/move', label: 'Move marker', category: 'flight', mode: 'held', defaultKeys: ['ArrowLeft'] },
  { id: 'fixture.survey/record', label: 'Record', category: 'system', mode: 'press', defaultKeys: ['KeyO'] },
  { id: 'fixture.survey/save', label: 'Save', category: 'system', mode: 'press', defaultKeys: ['Ctrl+KeyS'] },
];
const frame: InputFrame = { elapsed: .01, pilot: 0, flightAllowed: true, shortcutsAllowed: true };
afterEach(() => vi.unstubAllGlobals());
describe('portable keyboard sampling', () => {
  it('samples unrelated namespaced actions and preserves quick press edges and chords', () => {
    const device = browser(), source = createKeyboardSource({ actions, pilot: () => 0 }), values = new Map<string, number>();
    const sink = { set: (id: string, value: number) => values.set(id, value) };
    device.key('keydown', 'KeyO'); device.key('keyup', 'KeyO');
    device.key('keydown', 'ArrowLeft'); device.key('keydown', 'KeyS', { ctrlKey: true });
    source.sample(frame, sink);
    expect([...values.keys()]).toEqual(['fixture.survey/move', 'fixture.survey/record', 'fixture.survey/save']);
    values.clear(); source.sample(frame, sink); expect([...values.keys()]).toEqual(['fixture.survey/move']);
    device.key('keyup', 'ArrowLeft'); values.clear(); source.sample(frame, sink); expect(values.size).toBe(0);
    source.dispose(); expect(device.window.listeners + device.document.listeners).toBe(0);
  });
  it('releases on reassignment, capture suppression, hidden/blur and disposal without affecting another seat', () => {
    const device = browser(); let pilot: number | undefined = 0, capture = true;
    const source = createKeyboardSource({ actions, pilot: () => pilot, capture: () => capture });
    const values: string[] = [], sink = { set: (id: string) => values.push(id) };
    device.key('keydown', 'ArrowLeft'); source.sample({ ...frame, pilot: 1 }, sink); expect(values).toEqual([]);
    source.release(1); source.sample(frame, sink); expect(values).toEqual(['fixture.survey/move']);
    values.length = 0; pilot = 1; source.sample({ ...frame, pilot: 1 }, sink); expect(values).toEqual([]);
    for (const event of ['blur', 'pagehide']) {
      device.key('keydown', 'ArrowLeft'); device.window.dispatchEvent(new Event(event));
      source.sample({ ...frame, pilot: 1 }, sink); expect(values).toEqual([]);
    }
    device.key('keydown', 'ArrowLeft'); capture = false; source.sample({ ...frame, pilot: 1 }, sink); capture = true;
    source.sample({ ...frame, pilot: 1 }, sink); expect(values).toEqual([]);
    device.key('keydown', 'ArrowLeft'); device.document.hidden = true; device.document.dispatchEvent(new Event('visibilitychange'));
    device.document.hidden = false; source.sample({ ...frame, pilot: 1 }, sink); expect(values).toEqual([]);
    source.dispose(); expect(device.window.listeners + device.document.listeners).toBe(0);
    expect(() => source.sample(frame, sink)).toThrow('disposed');
  });
  it('drops suppressed held flight intent rather than replaying it when flight resumes', () => {
    const device = browser(), source = createKeyboardSource({ actions, pilot: () => 0 });
    device.key('keydown', 'ArrowLeft');
    const sink = { set: vi.fn() }; source.sample({ ...frame, flightAllowed: false }, sink);
    source.sample(frame, sink); expect(sink.set).not.toHaveBeenCalled(); source.dispose();
  });
});
