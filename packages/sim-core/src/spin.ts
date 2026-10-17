import type { Body, State, Vec } from '../../game-api/src/index';
import * as dm from './dmath';

/** Signed spin rate of a body in rad/s (0 when it does not rotate). */
export function spinRate(body: Body): number {
  const rotation = body.rotation;
  return rotation ? rotation.direction * 2 * Math.PI / rotation.period : 0;
}

/** Angle of the body-fixed frame at `time`, in (-π, π]. Whole turns are removed before the
 * angle is formed, so it stays exact to rounding at any epoch and through any warp. */
export function spinAngle(body: Body, time: number): number {
  const rotation = body.rotation;
  if (!rotation) return 0;
  const turns = time / rotation.period;
  return dm.normalizeAngle(rotation.phase + rotation.direction * 2 * Math.PI * (turns - Math.floor(turns)));
}

/** Rotate a vector by `angle`: body-fixed to inertial for the frame angle, inertial to body-fixed for its negative. */
export function rotate(v: Vec, angle: number): Vec {
  if (angle === 0) return v;
  const c = dm.cos(angle), s = dm.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Velocity of the rotating ground (or water) at an inertial position: ω × r. */
export function groundVelocity(omega: number, position: Vec): Vec {
  return { x: -omega * position.y, y: omega * position.x };
}

/** True when this state's position, velocity and heading are body-fixed rather than inertial. */
export function bodyFixed(state: State, body: Body): boolean {
  return state.status !== 'flying' && body.rotation !== undefined;
}

/** The state as it appears in the body-centred inertial frame: a resting ship on a rotating
 * body is carried round with the ground. Flying states and non-rotating bodies are returned as is. */
export function inertialState(state: State, body: Body): State {
  if (!bodyFixed(state, body)) return state;
  const angle = spinAngle(body, state.time), position = rotate(state.position, angle);
  return { ...state, position, velocity: groundVelocity(spinRate(body), position),
    heading: dm.normalizeAngle(state.heading + angle) };
}

/** Inertial position of a state (see `inertialState`), without building a new state. */
export function inertialPosition(state: State, body: Body): Vec {
  return bodyFixed(state, body) ? rotate(state.position, spinAngle(body, state.time)) : state.position;
}

/** Place a preset authored in the body-fixed frame at its epoch. Landed starts already are
 * body-fixed; a flying start is turned with the ground. An orbit keeps its own inertial speed,
 * while an explicit `state` start moves relative to the ground (a gentle descent stays gentle). */
export function groundPreset(state: State, body: Body, groundRelative: boolean): State {
  if (state.status !== 'flying' || !body.rotation) return state;
  const angle = spinAngle(body, state.time), position = rotate(state.position, angle);
  let velocity = rotate(state.velocity, angle);
  if (groundRelative) {
    const ground = groundVelocity(spinRate(body), position);
    velocity = { x: velocity.x + ground.x, y: velocity.y + ground.y };
  }
  return { ...state, position, velocity, heading: dm.normalizeAngle(state.heading + angle) };
}
