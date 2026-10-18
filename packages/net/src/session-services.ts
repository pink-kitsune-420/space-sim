/** Legacy composition root. Portable session modules receive these through declared core services. */
import { CORE_WORLD, CORE_SAVE, CORE_CLOCK, CORE_MOTION, CORE_COMMANDS, type FlightSessionServices, type ServiceKey } from '../../game-api/src/index';
import { engineModuleServices } from '../../sim-core/src/module-services';
const services = engineModuleServices();
const service = <T>(key: ServiceKey<T>): T => services.find(entry => entry.key.slot === key.slot)!.service as T;
const ports: FlightSessionServices = Object.freeze({ world: service(CORE_WORLD), save: service(CORE_SAVE), clock: service(CORE_CLOCK), motion: service(CORE_MOTION), commands: service(CORE_COMMANDS) });
export function flightSessionServices(): FlightSessionServices { return ports; }
