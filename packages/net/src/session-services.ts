/** Host-only session services composition root (`packages/net`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); portable session modules receive these through declared core services (`CORE_WORLD`, `CORE_SAVE`, `CORE_CLOCK`, `CORE_MOTION`, `CORE_COMMANDS`). */
import { CORE_WORLD, CORE_SAVE, CORE_CLOCK, CORE_MOTION, CORE_COMMANDS, type FlightSessionServices, type ServiceKey } from '../../game-api/src/index';
import { engineModuleServices } from '../../sim-core/src/module-services';
const services = engineModuleServices();
const service = <T>(key: ServiceKey<T>): T => services.find(entry => entry.key.slot === key.slot)!.service as T;
const ports: FlightSessionServices = Object.freeze({ world: service(CORE_WORLD), save: service(CORE_SAVE), clock: service(CORE_CLOCK), motion: service(CORE_MOTION), commands: service(CORE_COMMANDS) });
/** Returns the frozen core engine services required by flight session host and client implementations. Modules receive `FlightSessionServices` via core service keys (`CORE_WORLD`, `CORE_SAVE`, `CORE_CLOCK`, `CORE_MOTION`, `CORE_COMMANDS`). Host-only (`packages/net`). */
export function flightSessionServices(): FlightSessionServices { return ports; }
