/** Host-only flight client composition adapter (`packages/net`); portable client has no private engine imports. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); use `FLIGHT_SESSIONS` (`session.flight@1.0.0`) or `modules/session-flight`. */
import type { TextConnection } from '../../game-api/src/index';
import { ClientSession as PortableClientSession } from '../../../modules/session-flight/src/client';
import type { ClientOptions } from '../../../modules/session-flight/src/client';
import { flightSessionServices } from './session-services';
export type { ClientOptions } from '../../../modules/session-flight/src/client';
/** Host compatibility flight client session bound to host engine services. Modules manage client sessions via `FLIGHT_SESSIONS` (`session.flight@1.0.0`). Host-only (`packages/net`). */
export class ClientSession extends PortableClientSession {
  constructor(connection: TextConnection, options: ClientOptions) { super(flightSessionServices(), connection, options); }
}
