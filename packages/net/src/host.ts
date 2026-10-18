/** Legacy composition adapter. Portable host implementation uses only public engine services. */
import type { WorldControl } from '../../game-api/src/index';
import { HostSession as PortableHostSession } from '../../../modules/session-flight/src/host';
import type { HostSettings } from '../../../modules/session-flight/src/host';
import { flightSessionServices } from './session-services';
export { DEFAULT_HOST_SETTINGS, MAX_INPUT_LEAD_TICKS, SessionError } from '../../../modules/session-flight/src/host';
export type { HostSettings } from '../../../modules/session-flight/src/host';
export class HostSession<W extends WorldControl = WorldControl> extends PortableHostSession<W> {
  constructor(world: W, settings: Partial<HostSettings> = {}, options: ConstructorParameters<typeof PortableHostSession>[3] = {}) {
    super(flightSessionServices(), world, settings, options);
  }
}
