/** Compatibility entry; local/remote flight behavior is owned by the session module. */
import type { WorldControl, LocalSessionOptions } from '../../../packages/game-api/src/index';
import type { World } from '../../../packages/sim-core/src/world';
import { flightSessionServices } from '../../../packages/net/src/session-services';
import { LocalSession as PortableLocalSession } from '../../../modules/session-flight/src/session';
export { RemoteSession, SessionError } from '../../../modules/session-flight/src/session';
export type { GameSession, ChatLine } from '../../../modules/session-flight/src/session';
export class LocalSession<W extends WorldControl = World> extends PortableLocalSession<W> {
  constructor(world: W, options: LocalSessionOptions) { super(flightSessionServices(), world, options); }
}
