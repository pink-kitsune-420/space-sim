import type { SmartCameraControl, SmartCameraTarget } from '@space-sim/game-api';

/** One independent guidance/focus state. Output and working vectors are reused per frame. */
export function createSmartCamera<T extends SmartCameraTarget>(): SmartCameraControl<T> {
  let disposed = false, followOnArrival = false;
  const step = { pan: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, follow: false };
  const live = (): void => { if (disposed) throw new Error('Smart camera disposed'); };
  const control: SmartCameraControl<T> = {
    target: undefined, focus: undefined,
    start(target, follow = false) { live(); control.target = target; control.focus = undefined; followOnArrival = follow; },
    stop() { control.target = undefined; followOnArrival = false; },
    clear() { control.stop(); control.focus = undefined; },
    update(frame) {
      live();
      const position = frame.targetPosition;
      if (!control.target && !control.focus) return undefined;
      if (!position) { control.clear(); return undefined; }
      const { origin, pan, velocity, scale, elapsed, instant } = frame;
      if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(elapsed) || elapsed < 0
        || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('Invalid smart camera frame');
      step.pan.x = pan.x; step.pan.y = pan.y;
      step.velocity.x = velocity.x; step.velocity.y = velocity.y; step.follow = false;
      if (!control.target) {
        step.pan.x = position.x - origin.x; step.pan.y = position.y - origin.y;
        step.velocity.x = step.velocity.y = 0;
        return step;
      }
      const dx = position.x - (origin.x + pan.x), dy = position.y - (origin.y + pan.y);
      const dist = Math.hypot(dx, dy), distPx = dist * scale;
      let arrived = instant || distPx < 1;
      if (!arrived) {
        const speedPx = Math.hypot(velocity.x, velocity.y) * scale;
        const maxBrakeSpeedPx = Math.sqrt(2 * 3600 * distPx);
        const approachSpeedPx = Math.min(3500, Math.max(speedPx, distPx * 4));
        const desiredSpeedWorld = Math.min(approachSpeedPx, maxBrakeSpeedPx) / scale;
        const ux = dist > 0 ? dx / dist : 0, uy = dist > 0 ? dy / dist : 0;
        const blend = 1 - Math.exp(-elapsed * (distPx < 300 ? 20 : 12));
        step.velocity.x = velocity.x + (ux * desiredSpeedWorld - velocity.x) * blend;
        step.velocity.y = velocity.y + (uy * desiredSpeedWorld - velocity.y) * blend;
        const stepX = step.velocity.x * elapsed, stepY = step.velocity.y * elapsed;
        arrived = stepX * ux + stepY * uy >= dist || distPx < 2;
        if (!arrived) { step.pan.x += stepX; step.pan.y += stepY; }
      }
      if (arrived) {
        step.pan.x = position.x - origin.x; step.pan.y = position.y - origin.y;
        step.velocity.x = step.velocity.y = 0; step.follow = followOnArrival;
        control.focus = followOnArrival ? undefined : control.target;
        control.stop();
      }
      return step;
    },
    dispose() { if (disposed) return; control.clear(); disposed = true; },
  };
  return control;
}
