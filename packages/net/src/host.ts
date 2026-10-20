/** Host-only flight host session composition adapter (`packages/net`). Portable host implementation uses only public engine services. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); use `FLIGHT_SESSIONS` (`session.flight@1.0.0`) from `@space-sim/game-api`. */
import type { WorldControl } from '../../game-api/src/index';
import { HostSession as PortableHostSession } from '../../../modules/session-flight/src/host';
import type { HostSettings } from '../../../modules/session-flight/src/host';
import { flightSessionServices } from './session-services';
export { DEFAULT_HOST_SETTINGS, MAX_INPUT_LEAD_TICKS, SessionError } from '../../../modules/session-flight/src/host';
export type { HostSettings } from '../../../modules/session-flight/src/host';
/** Host compatibility authoritative flight session bound to host engine services. Modules manage flight sessions through `FLIGHT_SESSIONS` (`session.flight@1.0.0`). Host-only (`packages/net`). */
export class HostSession<W extends WorldControl = WorldControl> extends PortableHostSession<W> {
  constructor(world: W, settings: Partial<HostSettings> = {}, options: ConstructorParameters<typeof PortableHostSession>[3] = {}) {
    super(flightSessionServices(), world, settings, options);
  }
}
