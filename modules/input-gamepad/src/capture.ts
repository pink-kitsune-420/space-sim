/** Numeric device state owned by one input provider, never a retained browser Gamepad. */
export type GamepadState = Pick<Gamepad, 'index' | 'id' | 'connected' | 'axes' | 'buttons'>;
type CapturedPad = {
  index: number; id: string; connected: boolean; axes: number[];
  buttons: {pressed: boolean; touched: boolean; value: number}[];
};
/** Internal current-frame storage. Readers are synchronous and must not retain these arrays. */
export interface GamepadCapture {
  read(captureId?: number): {readonly byIndex: readonly (GamepadState | undefined)[]; readonly connected: readonly GamepadState[]};
  dispose(): void;
}
/** Validate only the explicit cache hint; missing identity always requests fresh device data. */
export function validateCaptureId(captureId: number | undefined): void {
  if (captureId !== undefined && (!Number.isSafeInteger(captureId) || captureId < 0)) throw new Error('Input captureId must be a non-negative safe integer');
}
/** Reuses current-device/channel buffers; disconnected records and shrunken topology are released.
 * Equal explicit IDs reuse copied numbers, not mutable native objects. Failed native reads are
 * cached for that explicit ID too; callers retain their existing error/fallback policy. */
export function createGamepadCapture(): GamepadCapture {
  const byIndex: (CapturedPad | undefined)[] = [], connected: CapturedPad[] = [];
  const snapshot = {byIndex, connected};
  let lastId: number | undefined, failed = false, failure: unknown, disposed = false;
  return {
    read(captureId) {
      if (disposed) throw new Error('Gamepad capture is disposed');
      validateCaptureId(captureId);
      if (captureId !== undefined && captureId === lastId) {if (failed) throw failure; return snapshot;}
      lastId = captureId; failed = false; failure = undefined;
      try {
        const raw = typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function' ? undefined : navigator.getGamepads();
        byIndex.length = raw?.length ?? 0; let count = 0;
        for (let index = 0; index < byIndex.length; index++) {
          const pad = raw![index];
          if (!pad?.connected) {byIndex[index] = undefined; continue;}
          let record = byIndex[index];
          if (!record) byIndex[index] = record = {index, id: '', connected: true, axes: [], buttons: []};
          record.index = pad.index ?? index; record.id = pad.id ?? ''; record.connected = pad.connected;
          record.axes.length = pad.axes.length;
          for (let axis = 0; axis < pad.axes.length; axis++) record.axes[axis] = pad.axes[axis]!;
          const prior = record.buttons.length; record.buttons.length = pad.buttons.length;
          for (let button = 0; button < pad.buttons.length; button++) {
            if (button >= prior) record.buttons[button] = {pressed: false, touched: false, value: 0};
            const target = record.buttons[button]!, source = pad.buttons[button]!;
            target.pressed = source.pressed; target.touched = source.touched; target.value = source.value;
          }
          connected[count++] = record;
        }
        connected.length = count; return snapshot;
      } catch (error) {
        byIndex.length = connected.length = 0; failed = true; failure = error; throw error;
      }
    },
    dispose() {disposed = true; byIndex.length = connected.length = 0; lastId = undefined; failure = undefined;}
  };
}
