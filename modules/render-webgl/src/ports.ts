/** Licensed local renderer helper; first-party MIT source, see NOTICE. */
import type { RenderGeometry, Render2DOptions, RenderFrame, SceneFrame, State } from '@space-sim/game-api';
export interface RendererPorts extends Omit<Render2DOptions, 'geometry'> { readonly geometry: RenderGeometry }
const NEUTRAL: State = Object.freeze({ time: 0, position: Object.freeze({x: 0, y: 0}), velocity: Object.freeze({x: 0, y: 0}), heading: 0, throttle: 0, status: 'landed', revision: 0 });
export function sceneFrame(scene: SceneFrame): RenderFrame { return { ...scene, presentationTime: scene.time, state: { ...NEUTRAL, time: scene.time }, path: [], pathClosed: false, engine: false, showShip: false, showPad: false }; }
