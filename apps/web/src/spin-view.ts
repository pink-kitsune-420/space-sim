import { coreRotationService } from '../../../packages/sim-core/src/module-services';
import { SpinView as SharedSpinView } from '../../../modules/spin-view/src/index';
export { SPIN_HOLD_RADIANS_PER_FRAME } from '../../../modules/spin-view/src/index';
/** Explicit fixed-rotation host bridge until manifest-selected view startup. */
export class SpinView extends SharedSpinView { constructor() { super(coreRotationService); } }
