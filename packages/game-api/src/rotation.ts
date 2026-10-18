import type { Body, State, Vec } from './state';
import type { ServiceKey } from './modules-v2';
/** Fixed prescribed sidereal rotation. SI metres/seconds, radians; pure queries never
 * advance body state. This does not declare support for dynamic N-body orientation. */
export interface RotationMath {
 spinRate(body: Body): number;
 spinAngle(body: Body, time: number): number;
 rotate(vector: Vec, angle: number): Vec;
 groundVelocity(omega: number, position: Vec): Vec;
 bodyFixed(state: State, body: Body): boolean;
}
export const CORE_ROTATION: ServiceKey<RotationMath> = Object.freeze({ slot: 'core.rotation', version: '1.0.0' });
