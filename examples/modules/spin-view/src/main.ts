import {
  SPIN_VIEWS,
  type Body,
  type SpinViewControl,
  type SpinViewFactory,
  type State,
  type Vec,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface SpinViewHelper {
  createSpin(): SpinViewControl;
  getAngle(control: SpinViewControl, body: Body, time: number): number;
  transformPoint(control: SpinViewControl, body: Body, time: number, point: Vec): Vec;
  transformState(control: SpinViewControl, state: State, body: Body): State;
}

export const SPIN_VIEW_HELPER: ServiceKey<SpinViewHelper> = Object.freeze({
  slot: 'example.spin-view',
  version: '1.0.0',
});

export function createSpinViewHelper(factory: SpinViewFactory): SpinViewHelper {
  return Object.freeze({
    createSpin(): SpinViewControl {
      return factory.create();
    },
    getAngle(control: SpinViewControl, body: Body, time: number): number {
      return control.angle(body, time);
    },
    transformPoint(control: SpinViewControl, body: Body, time: number, point: Vec): Vec {
      return control.point(body, time, point);
    },
    transformState(control: SpinViewControl, state: State, body: Body): State {
      return control.state(state, body);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(SPIN_VIEWS);
  context.provide(SPIN_VIEW_HELPER, createSpinViewHelper(factory));
}
