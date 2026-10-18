/** Legacy host adapter; actual flight session factory belongs to its editable package. */
import { createSessionFactory } from '../../../modules/session-flight/src/factory';
import { flightSessionServices } from '../../../packages/net/src/session-services';
export const browserSessionFactory = createSessionFactory(flightSessionServices());
