import viewHudInitialize from '../../../modules/view-hud/src/index';
import { manifest as viewHudManifest, compatibility as viewHudCompatibility } from '../../../modules/view-hud/module.json';
import viewHudGuide from '../../../modules/view-hud/docs/creators/usage.json';
import { DEFAULT_SHADERS } from '../../../packages/render-2d/src/shaders';
import { CANVAS_DRAWING, WEBGL_DRAWING, PROCEDURAL_SOUND, createVehicleArtwork, type VehicleArtwork, type RendererProvider } from '../../../packages/game-api/src/index';
import type { ModuleCandidateV2 } from '../../../packages/game-runtime/src/modules-v2';
import { legacyTheme } from '../../../packages/render-2d/src/theme';
import appearanceTrainerInitialize from '../../../modules/appearance-trainer/src/index';
import { manifest as appearanceTrainerManifest, compatibility as appearanceTrainerCompatibility } from '../../../modules/appearance-trainer/module.json';
import appearanceTrainerGuide_0 from '../../../modules/appearance-trainer/docs/creators/usage.json';
import appearanceTrainerGuide_1 from '../../../modules/appearance-trainer/docs/players/flight.json';
import renderWebglInitialize from '../../../modules/render-webgl/src/index';
import { manifest as renderWebglManifest, compatibility as renderWebglCompatibility } from '../../../modules/render-webgl/module.json';
import renderWebglGuide_0 from '../../../modules/render-webgl/docs/creators/usage.json';
import audioProceduralInitialize from '../../../modules/audio-procedural/src/index';
import { manifest as audioProceduralManifest, compatibility as audioProceduralCompatibility } from '../../../modules/audio-procedural/module.json';
import audioProceduralGuide_0 from '../../../modules/audio-procedural/docs/creators/usage.json';
import viewerTargets from '../../../games/planet-viewer/targets.json';
import surveyTargets from '../../../games/survey-fixture/targets.json';
import inputKeyboardInitialize from '../../../modules/input-keyboard/src/index';
import { manifest as inputKeyboardManifest, compatibility as inputKeyboardCompatibility } from '../../../modules/input-keyboard/module.json';
import inputKeyboardGuide from '../../../modules/input-keyboard/docs/creators/usage.json';
import playerControllerInitialize from '../../../modules/player-controller/src/index';
import { manifest as playerControllerManifest, compatibility as playerControllerCompatibility } from '../../../modules/player-controller/module.json';
import playerControllerGuide from '../../../modules/player-controller/docs/creators/usage.json';
import renderCanvasInitialize from '../../../modules/render-canvas/src/index';
import { manifest as renderCanvasManifest, compatibility as renderCanvasCompatibility } from '../../../modules/render-canvas/module.json';
import renderCanvasGuide from '../../../modules/render-canvas/docs/creators/usage.json';
import { bundledRegistration, prepareBundledPlan } from '../../../packages/game-runtime/src/bundled-plan';
import { validateRuntimeSelection } from '../../../packages/game-library/src/runtime-selection';
import { engineModuleServices } from '../../../packages/sim-core/src/module-services';
import { universeSaveFormatService } from '../../../packages/game-library/src/universe-save-services';
import spaceSimTargets from '../../../games/space-sim/targets.json';
import starterTargets from '../../../games/flight-starter/targets.json';
import type { ModuleEnvironment } from '../../../packages/game-api/src/index';
import cameraFollowInitialize from '../../../modules/camera-follow/src/index';
import { manifest as cameraFollowManifest, compatibility as cameraFollowCompatibility } from '../../../modules/camera-follow/module.json';
import cameraFollowGuide from '../../../modules/camera-follow/docs/creators/usage.json';
import cameraSmartInitialize from '../../../modules/camera-smart/src/index';
import { manifest as cameraSmartManifest, compatibility as cameraSmartCompatibility } from '../../../modules/camera-smart/module.json';
import cameraSmartGuide from '../../../modules/camera-smart/docs/creators/usage.json';
import inputProfilesInitialize from '../../../modules/input-profiles/src/index';
import { manifest as inputProfilesManifest, compatibility as inputProfilesCompatibility } from '../../../modules/input-profiles/module.json';
import inputProfilesGuide from '../../../modules/input-profiles/docs/creators/usage.json';
import flightPredictionInitialize from '../../../modules/flight-prediction/src/index';
import { manifest as flightPredictionManifest, compatibility as flightPredictionCompatibility } from '../../../modules/flight-prediction/module.json';
import flightPredictionGuide from '../../../modules/flight-prediction/docs/creators/usage.json';
import fleetViewInitialize from '../../../modules/fleet-view/src/index';
import { manifest as fleetViewManifest, compatibility as fleetViewCompatibility } from '../../../modules/fleet-view/module.json';
import fleetViewGuide from '../../../modules/fleet-view/docs/creators/usage.json';
import localViewsInitialize from '../../../modules/local-views/src/index';
import { manifest as localViewsManifest, compatibility as localViewsCompatibility } from '../../../modules/local-views/module.json';
import localViewsGuide from '../../../modules/local-views/docs/creators/usage.json';
import localPilotsInitialize from '../../../modules/local-pilots/src/index';
import { manifest as localPilotsManifest, compatibility as localPilotsCompatibility } from '../../../modules/local-pilots/module.json';
import localPilotsGuide from '../../../modules/local-pilots/docs/creators/usage.json';
import flightSplitInitialize from '../../../modules/flight-split/src/index';
import { manifest as flightSplitManifest, compatibility as flightSplitCompatibility } from '../../../modules/flight-split/module.json';
import flightSplitGuide from '../../../modules/flight-split/docs/creators/usage.json';
import universeSavesInitialize from '../../../modules/universe-saves/src/index';
import { manifest as universeSavesManifest, compatibility as universeSavesCompatibility } from '../../../modules/universe-saves/module.json';
import universeSavesGuide from '../../../modules/universe-saves/docs/creators/usage.json';
import universeFilesInitialize from '../../../modules/universe-files/src/index';
import { manifest as universeFilesManifest, compatibility as universeFilesCompatibility } from '../../../modules/universe-files/module.json';
import universeFilesGuide from '../../../modules/universe-files/docs/creators/usage.json';
import universeSaveControlsInitialize from '../../../modules/universe-save-controls/src/index';
import { manifest as universeSaveControlsManifest, compatibility as universeSaveControlsCompatibility } from '../../../modules/universe-save-controls/module.json';
import universeSaveControlsGuide from '../../../modules/universe-save-controls/docs/creators/usage.json';
import audioControlsInitialize from '../../../modules/audio-controls/src/index';
import { manifest as audioControlsManifest, compatibility as audioControlsCompatibility } from '../../../modules/audio-controls/module.json';
import audioControlsGuide from '../../../modules/audio-controls/docs/creators/usage.json';
import throttleInitialize from '../../../modules/throttle-hud/src/index';
import { manifest as throttleManifest, compatibility as throttleCompatibility } from '../../../modules/throttle-hud/module.json';
import throttleGuide from '../../../modules/throttle-hud/docs/creators/usage.json';
import playerViewInitialize from '../../../modules/player-view/src/index';
import { manifest as playerViewManifest, compatibility as playerViewCompatibility } from '../../../modules/player-view/module.json';
import playerViewGuide from '../../../modules/player-view/docs/creators/usage.json';

import flightPlansInitialize from '../../../modules/flight-plans/src/index';
import { manifest as flightPlansManifest, compatibility as flightPlansCompatibility } from '../../../modules/flight-plans/module.json';
import flightPlansGuide from '../../../modules/flight-plans/docs/creators/usage.json';

import transfersInitialize from '../../../modules/transfer-planner/src/index';
import { manifest as transfersManifest, compatibility as transfersCompatibility } from '../../../modules/transfer-planner/module.json';
import transfersGuide from '../../../modules/transfer-planner/docs/creators/usage.json';
import transfersFlightGuide from '../../../modules/transfer-planner/docs/players/flight.json';

import alarmsInitialize from '../../../modules/orbital-alarms/src/index';
import { manifest as alarmsManifest, compatibility as alarmsCompatibility } from '../../../modules/orbital-alarms/module.json';
import alarmsGuide from '../../../modules/orbital-alarms/docs/creators/usage.json';
import alarmsBurnsGuide from '../../../modules/orbital-alarms/docs/players/burns.json';

import alarmPanelInitialize from '../../../modules/alarm-panel/src/index';
import { manifest as alarmPanelManifest, compatibility as alarmPanelCompatibility } from '../../../modules/alarm-panel/module.json';
import alarmPanelGuide from '../../../modules/alarm-panel/docs/creators/usage.json';
import alarmPanelPlayersGuide from '../../../modules/alarm-panel/docs/players/alarms.json';

/** Inert registrations. Only the exact references selected by a target initialize. */
export const browserTargetModules = Object.freeze([
  bundledRegistration({ manifest: alarmPanelManifest, compatibility: alarmPanelCompatibility }, alarmPanelInitialize, { 'docs/creators/usage.json': alarmPanelGuide, 'docs/players/alarms.json': alarmPanelPlayersGuide }),
  bundledRegistration({ manifest: alarmsManifest, compatibility: alarmsCompatibility }, alarmsInitialize, { 'docs/creators/usage.json': alarmsGuide, 'docs/players/burns.json': alarmsBurnsGuide }),
  bundledRegistration({ manifest: transfersManifest, compatibility: transfersCompatibility }, transfersInitialize, { 'docs/creators/usage.json': transfersGuide, 'docs/players/flight.json': transfersFlightGuide }),
  bundledRegistration({ manifest: flightPlansManifest, compatibility: flightPlansCompatibility }, flightPlansInitialize, { 'docs/creators/usage.json': flightPlansGuide }),
  bundledRegistration({ manifest: playerViewManifest, compatibility: playerViewCompatibility }, playerViewInitialize, { 'docs/creators/usage.json': playerViewGuide }),
  bundledRegistration({ manifest: throttleManifest, compatibility: throttleCompatibility }, throttleInitialize, { 'docs/creators/usage.json': throttleGuide }),
  bundledRegistration({ manifest: viewHudManifest, compatibility: viewHudCompatibility }, viewHudInitialize, { 'docs/creators/usage.json': viewHudGuide }),
  bundledRegistration({ manifest: appearanceTrainerManifest, compatibility: appearanceTrainerCompatibility }, appearanceTrainerInitialize, { 'docs/creators/usage.json': appearanceTrainerGuide_0, 'docs/players/flight.json': appearanceTrainerGuide_1 }),
  bundledRegistration({ manifest: renderWebglManifest, compatibility: renderWebglCompatibility }, renderWebglInitialize, { 'docs/creators/usage.json': renderWebglGuide_0 }),
  bundledRegistration({ manifest: audioProceduralManifest, compatibility: audioProceduralCompatibility }, audioProceduralInitialize, { 'docs/creators/usage.json': audioProceduralGuide_0 }),
  bundledRegistration({ manifest: inputKeyboardManifest, compatibility: inputKeyboardCompatibility }, inputKeyboardInitialize, { 'docs/creators/usage.json': inputKeyboardGuide }),
  bundledRegistration({ manifest: playerControllerManifest, compatibility: playerControllerCompatibility }, playerControllerInitialize, { 'docs/creators/usage.json': playerControllerGuide }),
  bundledRegistration({ manifest: renderCanvasManifest, compatibility: renderCanvasCompatibility }, renderCanvasInitialize, { 'docs/creators/usage.json': renderCanvasGuide }),
  bundledRegistration({ manifest: cameraFollowManifest, compatibility: cameraFollowCompatibility }, cameraFollowInitialize, { 'docs/creators/usage.json': cameraFollowGuide }),
  bundledRegistration({ manifest: cameraSmartManifest, compatibility: cameraSmartCompatibility }, cameraSmartInitialize, { 'docs/creators/usage.json': cameraSmartGuide }),
  bundledRegistration({ manifest: inputProfilesManifest, compatibility: inputProfilesCompatibility }, inputProfilesInitialize, { 'docs/creators/usage.json': inputProfilesGuide }),
  bundledRegistration({ manifest: flightPredictionManifest, compatibility: flightPredictionCompatibility }, flightPredictionInitialize, { 'docs/creators/usage.json': flightPredictionGuide }),
  bundledRegistration({ manifest: fleetViewManifest, compatibility: fleetViewCompatibility }, fleetViewInitialize, { 'docs/creators/usage.json': fleetViewGuide }),
  bundledRegistration({ manifest: localViewsManifest, compatibility: localViewsCompatibility }, localViewsInitialize, { 'docs/creators/usage.json': localViewsGuide }),
  bundledRegistration({ manifest: localPilotsManifest, compatibility: localPilotsCompatibility }, localPilotsInitialize, { 'docs/creators/usage.json': localPilotsGuide }),
  bundledRegistration({ manifest: flightSplitManifest, compatibility: flightSplitCompatibility }, flightSplitInitialize, { 'docs/creators/usage.json': flightSplitGuide }),
  bundledRegistration({ manifest: universeSavesManifest, compatibility: universeSavesCompatibility }, universeSavesInitialize, { 'docs/creators/usage.json': universeSavesGuide }),
  bundledRegistration({ manifest: universeFilesManifest, compatibility: universeFilesCompatibility }, universeFilesInitialize, { 'docs/creators/usage.json': universeFilesGuide }),
  bundledRegistration({ manifest: universeSaveControlsManifest, compatibility: universeSaveControlsCompatibility }, universeSaveControlsInitialize, { 'docs/creators/usage.json': universeSaveControlsGuide }),
  bundledRegistration({ manifest: audioControlsManifest, compatibility: audioControlsCompatibility }, audioControlsInitialize, { 'docs/creators/usage.json': audioControlsGuide }),
]);
export function browserTargetSelection(gameId: string) {
  return validateRuntimeSelection(gameId === 'builtin.planet-viewer' ? viewerTargets : gameId === 'builtin.survey-fixture' ? surveyTargets : gameId === 'builtin.flight-starter' ? starterTargets : spaceSimTargets);
}
export function prepareBrowserTarget(gameId: string, environment: ModuleEnvironment) {
  const selection = browserTargetSelection(gameId), plan = selection.plans[environment];
  if (!plan || environment === 'node') throw new Error(`This browser adapter does not support ${environment}`);
  return prepareBundledPlan(plan, environment, browserTargetModules, [universeSaveFormatService, ...engineModuleServices()]);
}

/** Legacy display IDs retain their save/profile identity over selected public services. */
export function browserPresentationProviders(target: ModuleCandidateV2) {
  const baseArtwork = createVehicleArtwork(target.contributions('vehicleAppearance').map(item => item.value));
  let currentArtwork = baseArtwork;
  const vehicles: VehicleArtwork = Object.freeze({ get: (id?: string) => currentArtwork.get(id) });
  const options = { vehicles, theme: legacyTheme };
  const renderers: RendererProvider[] = [];
  if (target.lock.providers[WEBGL_DRAWING.slot]) {
    const drawing = target.providedService(WEBGL_DRAWING);
    renderers.push({ id: 'builtin.webgl', version: '0.1.0', label: 'WebGL', capabilities: { shaders: true, overlays: true, effects: true },
      create: (canvas, supplied) => drawing.create(canvas, supplied?.shaders ?? DEFAULT_SHADERS, options) });
  }
  if (target.lock.providers[CANVAS_DRAWING.slot]) {
    const drawing = target.providedService(CANVAS_DRAWING);
    renderers.push({ id: 'builtin.canvas', version: '0.1.0', label: '2D', capabilities: { shaders: false, overlays: true },
      create: canvas => drawing.create(canvas, options) });
  }
  return { vehicleArtwork: vehicles, setVehicleArtwork(value?: VehicleArtwork) { currentArtwork = value ?? baseArtwork; }, renderers: Object.freeze(renderers.map(provider => Object.freeze({ ...provider, capabilities: Object.freeze({ ...provider.capabilities }) }))), audio: target.lock.providers[PROCEDURAL_SOUND.slot] ? target.providedService(PROCEDURAL_SOUND) : false as const };
}
