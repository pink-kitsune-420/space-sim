/** Legacy composition adapter; the portable client has no private engine imports. */
import type { TextConnection } from '../../game-api/src/index';
import { ClientSession as PortableClientSession } from '../../../modules/session-flight/src/client';
import type { ClientOptions } from '../../../modules/session-flight/src/client';
import { flightSessionServices } from './session-services';
export type { ClientOptions } from '../../../modules/session-flight/src/client';
export class ClientSession extends PortableClientSession {
  constructor(connection: TextConnection, options: ClientOptions) { super(flightSessionServices(), connection, options); }
}
