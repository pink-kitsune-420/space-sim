import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { universeSaveFormatService } from '../../packages/game-library/src/universe-save-services';
import { universeDiskService } from '../../apps/server/src/universe-disk';
import { captureDocument, FLIGHT_HUD_STATE, FLIGHT_PLANS, MANUAL_READER, JOIN_REVIEW, LOCAL_PILOTS, NODE_WEBSOCKET_CODECS, THROTTLE_HUD,
  type FleetViewInput, type FlightHudAdapter, type FlightHudReadout, type HostServiceAccess, type ManifestV2, type ModuleProfileV2,
  type OverlayPrimitive, type PredictionFactory, type RegisteredModuleV2, type TextConnection,
  type ThrottleLeverState, type TransportProvider } from '../../packages/game-api/src/index';
// @ts-expect-error reference.mjs is an untyped ESM script
import { check as checkReference, generate as generateReference } from '../../packages/module-tools/reference.mjs';
import { ModuleRegistryV2, moduleAssets } from '../../packages/game-runtime/src/modules-v2';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { saveWorld } from '../../packages/sim-core/src/save';
import { engineModuleServices } from '../../packages/sim-core/src/module-services';
import { nativeWebSocketCodecs } from '../../apps/server/src/websocket';
import { createViewHud } from '../../modules/view-hud/src/index';
import throttleInitialize from '../../modules/throttle-hud/src/index';
import throttleDescriptor from '../../modules/throttle-hud/module.json';
import throttleGuide from '../../modules/throttle-hud/docs/creators/usage.json';
import predictionInitialize from '../../modules/flight-prediction/src/index';
import predictionDescriptor from '../../modules/flight-prediction/module.json';
import predictionGuide from '../../modules/flight-prediction/docs/creators/usage.json';
import plansInitialize from '../../modules/flight-plans/src/index';
import plansDescriptor from '../../modules/flight-plans/module.json';
import plansGuide from '../../modules/flight-plans/docs/creators/usage.json';
import readoutInitialize from '../../examples/modules/throttle-hud/src/main';
import readoutDescriptor from '../../examples/modules/throttle-hud/module.json';
import probeInitialize, { PREDICTION_PROBE, createProbe } from '../../examples/modules/flight-prediction/src/main';
import probeDescriptor from '../../examples/modules/flight-prediction/module.json';
import summaryInitialize, { PLAN_SUMMARY } from '../../examples/modules/flight-plans/src/main';
import summaryDescriptor from '../../examples/modules/flight-plans/module.json';

import actionsInitialize from '../../modules/input-actions/src/index';
import actionsDescriptor from '../../modules/input-actions/module.json';
import actionsGuide from '../../modules/input-actions/docs/creators/usage.json';
import inspectorInitialize, { ACTION_INSPECTOR } from '../../examples/modules/input-actions/src/main';
import inspectorDescriptor from '../../examples/modules/input-actions/module.json';

import gamepadInitialize from '../../modules/input-gamepad/src/index';
import gamepadDescriptor from '../../modules/input-gamepad/module.json';
import gamepadGuide from '../../modules/input-gamepad/docs/creators/usage.json';
import customGamepadInitialize, { CUSTOM_GAMEPAD } from '../../examples/modules/input-gamepad/src/main';
import customGamepadDescriptor from '../../examples/modules/input-gamepad/module.json';

import keyboardInitialize from '../../modules/input-keyboard/src/index';
import keyboardDescriptor from '../../modules/input-keyboard/module.json';
import keyboardGuide from '../../modules/input-keyboard/docs/creators/usage.json';
import customKeyboardInitialize, { CUSTOM_KEYBOARD } from '../../examples/modules/input-keyboard/src/main';
import customKeyboardDescriptor from '../../examples/modules/input-keyboard/module.json';

import profilesInitialize from '../../modules/input-profiles/src/index';
import profilesDescriptor from '../../modules/input-profiles/module.json';
import profilesGuide from '../../modules/input-profiles/docs/creators/usage.json';
import normalizerInitialize, { PROFILE_VALIDATOR } from '../../examples/modules/input-profiles/src/main';
import normalizerDescriptor from '../../examples/modules/input-profiles/module.json';

import touchInitialize from '../../modules/input-touch/src/index';
import touchDescriptor from '../../modules/input-touch/module.json';
import touchGuide from '../../modules/input-touch/docs/creators/usage.json';
import virtualPadInitialize, { TOUCH_VIRTUAL_PAD } from '../../examples/modules/input-touch/src/main';
import virtualPadDescriptor from '../../examples/modules/input-touch/module.json';

import controllerInitialize from '../../modules/player-controller/src/index';
import controllerDescriptor from '../../modules/player-controller/module.json';
import controllerGuide from '../../modules/player-controller/docs/creators/usage.json';
import turretInitialize, { TURRET_CONTROLLER } from '../../examples/modules/player-controller/src/main';
import turretDescriptor from '../../examples/modules/player-controller/module.json';

import pilotsInitialize from '../../modules/local-pilots/src/index';
import pilotsDescriptor from '../../modules/local-pilots/module.json';
import pilotsGuide from '../../modules/local-pilots/docs/creators/usage.json';
import pilotHostInitialize, { PILOT_HOST_HELPER } from '../../examples/modules/local-pilots/src/main';
import pilotHostDescriptor from '../../examples/modules/local-pilots/module.json';

import menuInitialize from '../../modules/controller-menu/src/index';
import menuDescriptor from '../../modules/controller-menu/module.json';
import menuGuide from '../../modules/controller-menu/docs/creators/usage.json';
import minimalMenuInitialize, { MINIMAL_MENU } from '../../examples/modules/controller-menu/src/main';
import minimalMenuDescriptor from '../../examples/modules/controller-menu/module.json';

import netWebsocketInitialize from '../../modules/net-websocket/src/index';
import netWebsocketDescriptor from '../../modules/net-websocket/module.json';
import netWebsocketGuide from '../../modules/net-websocket/docs/creators/usage.json';
import wsClientInitialize, { WEBSOCKET_CLIENT, createWebSocketClientHelper } from '../../examples/modules/net-websocket/src/main';
import wsClientDescriptor from '../../examples/modules/net-websocket/module.json';

import netNodeWsInitialize from '../../modules/net-node-ws/src/index';
import netNodeWsDescriptor from '../../modules/net-node-ws/module.json';
import netNodeWsGuide from '../../modules/net-node-ws/docs/creators/usage.json';
import customNodeWsInitialize, { CUSTOM_NODE_WS } from '../../examples/modules/net-node-ws/src/main';
import customNodeWsDescriptor from '../../examples/modules/net-node-ws/module.json';

import netTabInitialize from '../../modules/net-tab/src/index';
import netTabDescriptor from '../../modules/net-tab/module.json';
import netTabGuide from '../../modules/net-tab/docs/creators/usage.json';
import tabBridgeInitialize, { TAB_BRIDGE } from '../../examples/modules/net-tab/src/main';
import tabBridgeDescriptor from '../../examples/modules/net-tab/module.json';

import netWebrtcInitialize from '../../modules/net-webrtc/src/index';
import netWebrtcDescriptor from '../../modules/net-webrtc/module.json';
import netWebrtcGuide from '../../modules/net-webrtc/docs/creators/usage.json';
import webrtcExchangeInitialize, { WEBRTC_EXCHANGE } from '../../examples/modules/net-webrtc/src/main';
import webrtcExchangeDescriptor from '../../examples/modules/net-webrtc/module.json';

import discoveryLanInitialize from '../../modules/discovery-lan/src/index';
import discoveryLanDescriptor from '../../modules/discovery-lan/module.json';
import discoveryLanGuide from '../../modules/discovery-lan/docs/creators/usage.json';
import lanScannerInitialize, { LAN_SCANNER } from '../../examples/modules/discovery-lan/src/main';
import lanScannerDescriptor from '../../examples/modules/discovery-lan/module.json';

import sessionFlightInitialize from '../../modules/session-flight/src/index';
import sessionFlightDescriptor from '../../modules/session-flight/module.json';
import sessionFlightGuide from '../../modules/session-flight/docs/creators/usage.json';
import flightHostManagerInitialize, { FLIGHT_HOST_MANAGER } from '../../examples/modules/session-flight/src/main';
import flightHostManagerDescriptor from '../../examples/modules/session-flight/module.json';

import sessionJoinInitialize from '../../modules/session-join/src/index';
import sessionJoinDescriptor from '../../modules/session-join/module.json';
import sessionJoinGuide from '../../modules/session-join/docs/creators/usage.json';
import joinNegotiatorInitialize, { JOIN_NEGOTIATOR } from '../../examples/modules/session-join/src/main';
import joinNegotiatorDescriptor from '../../examples/modules/session-join/module.json';

import joinReviewInitialize from '../../modules/join-review/src/index';
import joinReviewDescriptor from '../../modules/join-review/module.json';
import joinReviewGuide from '../../modules/join-review/docs/creators/usage.json';
import headlessJoinReviewInitialize from '../../examples/modules/join-review/src/main';
import headlessJoinReviewDescriptor from '../../examples/modules/join-review/module.json';

import chatConsoleInitialize from '../../modules/chat-console/src/index';
import chatConsoleDescriptor from '../../modules/chat-console/module.json';
import chatConsoleGuide from '../../modules/chat-console/docs/creators/usage.json';
import chatHelperInitialize, { CHAT_HELPER } from '../../examples/modules/chat-console/src/main';
import chatHelperDescriptor from '../../examples/modules/chat-console/module.json';

import renderCanvasInitialize from '../../modules/render-canvas/src/index';
import renderCanvasDescriptor from '../../modules/render-canvas/module.json';
import renderCanvasGuide from '../../modules/render-canvas/docs/creators/usage.json';
import canvasViewerInitialize, { CANVAS_VIEWER_HELPER } from '../../examples/modules/render-canvas/src/main';
import canvasViewerDescriptor from '../../examples/modules/render-canvas/module.json';

import renderWebglInitialize from '../../modules/render-webgl/src/index';
import renderWebglDescriptor from '../../modules/render-webgl/module.json';
import renderWebglGuide from '../../modules/render-webgl/docs/creators/usage.json';
import webglRendererInitialize, { WEBGL_RENDERER_HELPER } from '../../examples/modules/render-webgl/src/main';
import webglRendererDescriptor from '../../examples/modules/render-webgl/module.json';

import shadersVectorInitialize from '../../modules/shaders-vector/src/index';
import shadersVectorDescriptor from '../../modules/shaders-vector/module.json';
import shadersVectorGuide from '../../modules/shaders-vector/docs/creators/usage.json';
import customShadersInitialize, { CUSTOM_SHADERS_HELPER } from '../../examples/modules/shaders-vector/src/main';
import customShadersDescriptor from '../../examples/modules/shaders-vector/module.json';

import themeInitialize from '../../modules/theme/src/index';
import themeDescriptor from '../../modules/theme/module.json';
import themeGuide from '../../modules/theme/docs/creators/usage.json';
import themeProviderInitialize, { THEME_MANAGER_HELPER } from '../../examples/modules/theme/src/main';
import themeProviderDescriptor from '../../examples/modules/theme/module.json';

import themeCustomizerInitialize from '../../modules/theme-customizer/src/index';
import themeCustomizerDescriptor from '../../modules/theme-customizer/module.json';
import themeCustomizerGuide from '../../modules/theme-customizer/docs/creators/usage.json';
import customizerDialogInitialize, { CUSTOMIZER_DIALOG_HELPER } from '../../examples/modules/theme-customizer/src/main';
import customizerDialogDescriptor from '../../examples/modules/theme-customizer/module.json';

import appearanceTrainerInitialize, { trainerArtwork } from '../../modules/appearance-trainer/src/index';
import appearanceTrainerDescriptor from '../../modules/appearance-trainer/module.json';
import appearanceTrainerGuide from '../../modules/appearance-trainer/docs/creators/usage.json';
import trainerAppearanceExampleInitialize, { VEHICLE_ARTWORK_HELPER, scoutAppearance } from '../../examples/modules/appearance-trainer/src/main';
import trainerAppearanceExampleDescriptor from '../../examples/modules/appearance-trainer/module.json';

import cameraFollowInitialize from '../../modules/camera-follow/src/index';
import cameraFollowDescriptor from '../../modules/camera-follow/module.json';
import cameraFollowGuide from '../../modules/camera-follow/docs/creators/usage.json';
import cameraFollowExampleInitialize, { FLIGHT_CAMERA_HELPER } from '../../examples/modules/camera-follow/src/main';
import cameraFollowExampleDescriptor from '../../examples/modules/camera-follow/module.json';

import cameraSmartInitialize from '../../modules/camera-smart/src/index';
import cameraSmartDescriptor from '../../modules/camera-smart/module.json';
import cameraSmartGuide from '../../modules/camera-smart/docs/creators/usage.json';
import cameraSmartExampleInitialize, { SMART_CAMERA_HELPER } from '../../examples/modules/camera-smart/src/main';
import cameraSmartExampleDescriptor from '../../examples/modules/camera-smart/module.json';

import localViewsInitialize from '../../modules/local-views/src/index';
import localViewsDescriptor from '../../modules/local-views/module.json';
import localViewsGuide from '../../modules/local-views/docs/creators/usage.json';
import localViewsExampleInitialize, { LOCAL_VIEWS_HELPER } from '../../examples/modules/local-views/src/main';
import localViewsExampleDescriptor from '../../examples/modules/local-views/module.json';

import playerViewInitialize from '../../modules/player-view/src/index';
import playerViewDescriptor from '../../modules/player-view/module.json';
import playerViewGuide from '../../modules/player-view/docs/creators/usage.json';
import playerViewExampleInitialize, { PLAYER_VIEW_HELPER } from '../../examples/modules/player-view/src/main';
import playerViewExampleDescriptor from '../../examples/modules/player-view/module.json';

import viewHudInitialize from '../../modules/view-hud/src/index';
import viewHudDescriptor from '../../modules/view-hud/module.json';
import viewHudGuide from '../../modules/view-hud/docs/creators/usage.json';
import viewHudExampleInitialize, { VIEW_HUD_HELPER } from '../../examples/modules/view-hud/src/main';
import viewHudExampleDescriptor from '../../examples/modules/view-hud/module.json';

import hudLayoutInitialize from '../../modules/hud-layout/src/index';
import hudLayoutDescriptor from '../../modules/hud-layout/module.json';
import hudLayoutGuide from '../../modules/hud-layout/docs/creators/usage.json';
import hudLayoutExampleInitialize, { HUD_LAYOUT_HELPER } from '../../examples/modules/hud-layout/src/main';
import hudLayoutExampleDescriptor from '../../examples/modules/hud-layout/module.json';

import navballInitialize from '../../modules/navball/src/index';
import navballDescriptor from '../../modules/navball/module.json';
import navballGuide from '../../modules/navball/docs/creators/usage.json';
import navballExampleInitialize, { NAVBALL_VIEWER_HELPER } from '../../examples/modules/navball/src/main';
import navballExampleDescriptor from '../../examples/modules/navball/module.json';

import spinViewInitialize from '../../modules/spin-view/src/index';
import spinViewDescriptor from '../../modules/spin-view/module.json';
import spinViewGuide from '../../modules/spin-view/docs/creators/usage.json';
import spinViewExampleInitialize, { SPIN_VIEW_HELPER } from '../../examples/modules/spin-view/src/main';
import spinViewExampleDescriptor from '../../examples/modules/spin-view/module.json';

import fleetViewInitialize from '../../modules/fleet-view/src/index';
import fleetViewDescriptor from '../../modules/fleet-view/module.json';
import fleetViewGuide from '../../modules/fleet-view/docs/creators/usage.json';
import fleetViewExampleInitialize, { FLEET_VIEWER_HELPER } from '../../examples/modules/fleet-view/src/main';
import fleetViewExampleDescriptor from '../../examples/modules/fleet-view/module.json';

import flightSplitInitialize from '../../modules/flight-split/src/index';
import flightSplitDescriptor from '../../modules/flight-split/module.json';
import flightSplitGuide from '../../modules/flight-split/docs/creators/usage.json';
import flightSplitExampleInitialize, { FLIGHT_SPLIT_HELPER } from '../../examples/modules/flight-split/src/main';
import flightSplitExampleDescriptor from '../../examples/modules/flight-split/module.json';

import windowsInitialize from '../../modules/ui-windows/src/index';
import windowsDescriptor from '../../modules/ui-windows/module.json';
import windowsGuide from '../../modules/ui-windows/docs/creators/usage.json';

import maneuverBurnInitialize from '../../modules/maneuver-burn/src/index';
import maneuverBurnDescriptor from '../../modules/maneuver-burn/module.json';
import maneuverBurnGuide from '../../modules/maneuver-burn/docs/creators/usage.json';
import maneuverBurnExampleInitialize, { MANEUVER_BURN_EXECUTOR } from '../../examples/modules/maneuver-burn/src/main';
import maneuverBurnExampleDescriptor from '../../examples/modules/maneuver-burn/module.json';

import maneuverDisplayInitialize from '../../modules/maneuver-display/src/index';
import maneuverDisplayDescriptor from '../../modules/maneuver-display/module.json';
import maneuverDisplayGuide from '../../modules/maneuver-display/docs/creators/usage.json';
import maneuverDisplayExampleInitialize, { MANEUVER_DISPLAY_HELPER } from '../../examples/modules/maneuver-display/src/main';
import maneuverDisplayExampleDescriptor from '../../examples/modules/maneuver-display/module.json';

import maneuverEditorInitialize from '../../modules/maneuver-editor/src/index';
import maneuverEditorDescriptor from '../../modules/maneuver-editor/module.json';
import maneuverEditorGuide from '../../modules/maneuver-editor/docs/creators/usage.json';
import maneuverEditorExampleInitialize, { MANEUVER_EDITOR_HELPER } from '../../examples/modules/maneuver-editor/src/main';
import maneuverEditorExampleDescriptor from '../../examples/modules/maneuver-editor/module.json';

import orbitalAlarmsInitialize from '../../modules/orbital-alarms/src/index';
import orbitalAlarmsDescriptor from '../../modules/orbital-alarms/module.json';
import orbitalAlarmsGuide from '../../modules/orbital-alarms/docs/creators/usage.json';
import orbitalAlarmsExampleInitialize, { ORBITAL_ALARM_HELPER } from '../../examples/modules/orbital-alarms/src/main';
import orbitalAlarmsExampleDescriptor from '../../examples/modules/orbital-alarms/module.json';

import alarmPanelInitialize from '../../modules/alarm-panel/src/index';
import alarmPanelDescriptor from '../../modules/alarm-panel/module.json';
import alarmPanelGuide from '../../modules/alarm-panel/docs/creators/usage.json';
import alarmPanelExampleInitialize, { ALARM_PANEL_HELPER } from '../../examples/modules/alarm-panel/src/main';
import alarmPanelExampleDescriptor from '../../examples/modules/alarm-panel/module.json';

import transferPlannerInitialize from '../../modules/transfer-planner/src/index';
import transferPlannerDescriptor from '../../modules/transfer-planner/module.json';
import transferPlannerGuide from '../../modules/transfer-planner/docs/creators/usage.json';
import transferPlannerExampleInitialize, { TRANSFER_PLANNER_HELPER } from '../../examples/modules/transfer-planner/src/main';
import transferPlannerExampleDescriptor from '../../examples/modules/transfer-planner/module.json';

import physicsRailsInitialize from '../../modules/physics-rails/src/index';
import physicsRailsDescriptor from '../../modules/physics-rails/module.json';
import physicsRailsGuide from '../../modules/physics-rails/docs/creators/usage.json';
import physicsRailsExampleInitialize, { MOTION_KERNEL_HELPER } from '../../examples/modules/physics-rails/src/main';
import physicsRailsExampleDescriptor from '../../examples/modules/physics-rails/module.json';

import vehicleTrainerInitialize from '../../modules/vehicle-trainer/src/index';
import vehicleTrainerDescriptor from '../../modules/vehicle-trainer/module.json';
import vehicleTrainerGuide from '../../modules/vehicle-trainer/docs/creators/usage.json';
import vehicleTrainerExampleInitialize, { VEHICLE_TRAINER_HELPER } from '../../examples/modules/vehicle-trainer/src/main';
import vehicleTrainerExampleDescriptor from '../../examples/modules/vehicle-trainer/module.json';

import universeFilesInitialize from '../../modules/universe-files/src/index';
import universeFilesDescriptor from '../../modules/universe-files/module.json';
import universeFilesGuide from '../../modules/universe-files/docs/creators/usage.json';
import universeFilesExampleInitialize, { UNIVERSE_FILES_HELPER } from '../../examples/modules/universe-files/src/main';
import universeFilesExampleDescriptor from '../../examples/modules/universe-files/module.json';

import universeSavesInitialize from '../../modules/universe-saves/src/index';
import universeSavesDescriptor from '../../modules/universe-saves/module.json';
import universeSavesGuide from '../../modules/universe-saves/docs/creators/usage.json';
import universeSavesExampleInitialize, { UNIVERSE_SAVES_HELPER } from '../../examples/modules/universe-saves/src/main';
import universeSavesExampleDescriptor from '../../examples/modules/universe-saves/module.json';

import shellInitialize from '../../modules/ui-shell/src/index';
import shellDescriptor from '../../modules/ui-shell/module.json';
import shellGuide from '../../modules/ui-shell/docs/creators/usage.json';
import shellExampleInitialize, { SINGLE_PANEL_SHELL } from '../../examples/modules/ui-shell/src/main';
import shellExampleDescriptor from '../../examples/modules/ui-shell/module.json';
import windowsExampleInitialize, { NOTICE_WINDOWS } from '../../examples/modules/ui-windows/src/main';
import windowsExampleDescriptor from '../../examples/modules/ui-windows/module.json';
import modMenuInitialize from '../../modules/mod-menu/src/index';
import modMenuDescriptor from '../../modules/mod-menu/module.json';
import modMenuGuide from '../../modules/mod-menu/docs/creators/usage.json';
import modMenuExampleInitialize, { MODULE_PICKER } from '../../examples/modules/mod-menu/src/main';
import modMenuExampleDescriptor from '../../examples/modules/mod-menu/module.json';
import manualInitialize from '../../modules/manual/src/index';
import manualDescriptor from '../../modules/manual/module.json';
import manualGuide from '../../modules/manual/docs/creators/usage.json';
import manualExampleInitialize, { GUIDE_PUBLISHER } from '../../examples/modules/manual/src/main';
import manualExampleDescriptor from '../../examples/modules/manual/module.json';
import loggingInitialize from '../../modules/logging/src/index';
import loggingDescriptor from '../../modules/logging/module.json';
import loggingGuide from '../../modules/logging/docs/creators/usage.json';
import loggingExampleInitialize, { AUDIT_LOG } from '../../examples/modules/logging/src/main';
import loggingExampleDescriptor from '../../examples/modules/logging/module.json';
import profilerInitialize from '../../modules/profiler/src/index';
import profilerDescriptor from '../../modules/profiler/module.json';
import profilerGuide from '../../modules/profiler/docs/creators/usage.json';
import profilerExampleInitialize, { FRAME_TIMER } from '../../examples/modules/profiler/src/main';
import profilerExampleDescriptor from '../../examples/modules/profiler/module.json';
import academyUiInitialize from '../../modules/academy-ui/src/index';
import academyUiDescriptor from '../../modules/academy-ui/module.json';
import academyUiGuide from '../../modules/academy-ui/docs/creators/usage.json';
import academyUiExampleInitialize, { ACADEMY_UI_HELPER } from '../../examples/modules/academy-ui/src/main';
import academyUiExampleDescriptor from '../../examples/modules/academy-ui/module.json';
import tutorialRunnerInitialize from '../../modules/tutorial-runner/src/index';
import tutorialRunnerDescriptor from '../../modules/tutorial-runner/module.json';
import tutorialRunnerGuide from '../../modules/tutorial-runner/docs/creators/usage.json';
import tutorialRunnerExampleInitialize, { TUTORIAL_RUNNER_HELPER } from '../../examples/modules/tutorial-runner/src/main';
import tutorialRunnerExampleDescriptor from '../../examples/modules/tutorial-runner/module.json';
import orbitalLessonsInitialize from '../../modules/orbital-lessons/src/index';
import orbitalLessonsDescriptor from '../../modules/orbital-lessons/module.json';
import orbitalLessonsGuide from '../../modules/orbital-lessons/docs/creators/usage.json';
import orbitalLessonsExampleInitialize, { ORBITAL_COURSE_HELPER } from '../../examples/modules/orbital-lessons/src/main';
import orbitalLessonsExampleDescriptor from '../../examples/modules/orbital-lessons/module.json';
import audioControlsInitialize from '../../modules/audio-controls/src/index';
import audioControlsDescriptor from '../../modules/audio-controls/module.json';
import audioControlsGuide from '../../modules/audio-controls/docs/creators/usage.json';
import audioControlsExampleInitialize, { AUDIO_CONTROLS_HELPER } from '../../examples/modules/audio-controls/src/main';
import audioControlsExampleDescriptor from '../../examples/modules/audio-controls/module.json';
import audioProceduralInitialize from '../../modules/audio-procedural/src/index';
import audioProceduralDescriptor from '../../modules/audio-procedural/module.json';
import audioProceduralGuide from '../../modules/audio-procedural/docs/creators/usage.json';
import audioProceduralExampleInitialize, { AUDIO_PROCEDURAL_HELPER } from '../../examples/modules/audio-procedural/src/main';
import audioProceduralExampleDescriptor from '../../examples/modules/audio-procedural/module.json';

import universeSaveControlsInitialize from '../../modules/universe-save-controls/src/index';
import universeSaveControlsDescriptor from '../../modules/universe-save-controls/module.json';
import universeSaveControlsGuide from '../../modules/universe-save-controls/docs/creators/usage.json';
import universeSaveControlsExampleInitialize, { UNIVERSE_SAVE_CONTROLS_HELPER } from '../../examples/modules/universe-save-controls/src/main';
import universeSaveControlsExampleDescriptor from '../../examples/modules/universe-save-controls/module.json';

import universeServerStorageInitialize from '../../modules/universe-server-storage/src/index';
import universeServerStorageDescriptor from '../../modules/universe-server-storage/module.json';
import universeServerStorageGuide from '../../modules/universe-server-storage/docs/creators/usage.json';
import universeServerStorageExampleInitialize, { UNIVERSE_SERVER_STORAGE_HELPER } from '../../examples/modules/universe-server-storage/src/main';
import universeServerStorageExampleDescriptor from '../../examples/modules/universe-server-storage/module.json';

import planetDesignerInitialize from '../../modules/planet-designer/src/index';
import planetDesignerDescriptor from '../../modules/planet-designer/module.json';
import planetDesignerGuide from '../../modules/planet-designer/docs/creators/usage.json';
import planetDesignerExampleInitialize, { PLANET_DESIGNER_HELPER } from '../../examples/modules/planet-designer/src/main';
import planetDesignerExampleDescriptor from '../../examples/modules/planet-designer/module.json';

const planetDesignerAssets: Record<string, string> = {
  'assets/designer.css': readFileSync('modules/planet-designer/assets/designer.css', 'utf8'),
};

const maneuverEditorAssets: Record<string, string> = {
  'assets/editor.css': readFileSync('modules/maneuver-editor/assets/editor.css', 'utf8'),
};

const windowsAssets: Record<string, string> = {
  'assets/windows.css': readFileSync('modules/ui-windows/assets/windows.css', 'utf8'),
};

const hudLayoutAssets: Record<string, string> = {
  'assets/layout.css': readFileSync('modules/hud-layout/assets/layout.css', 'utf8'),
};

const vectorShaderAssets: Record<string, string> = {
  'assets/scene.vert': readFileSync('modules/shaders-vector/assets/scene.vert', 'utf8'),
  'assets/scene.frag': readFileSync('modules/shaders-vector/assets/scene.frag', 'utf8'),
  'assets/vector.vert': readFileSync('modules/shaders-vector/assets/vector.vert', 'utf8'),
  'assets/vector.frag': readFileSync('modules/shaders-vector/assets/vector.frag', 'utf8'),
  'assets/text.vert': readFileSync('modules/shaders-vector/assets/text.vert', 'utf8'),
  'assets/text.frag': readFileSync('modules/shaders-vector/assets/text.frag', 'utf8'),
};

const themeAssets: Record<string, string> = {
  'assets/theme.css': readFileSync('modules/theme/assets/theme.css', 'utf8'),
  'assets/hud.css': readFileSync('modules/theme/assets/hud.css', 'utf8'),
};

const themeCustomizerAssets: Record<string, string> = {
  'assets/controls.css': readFileSync('modules/theme-customizer/assets/controls.css', 'utf8'),
};

// The Creators guides link these examples; each test exercises the behavior its guide describes.
function registry(entries: readonly (readonly [unknown, RegisteredModuleV2['initialize'], unknown?, Record<string, string>?])[], hostServices: readonly HostServiceAccess[] = []): ModuleRegistryV2 {
  const result = new ModuleRegistryV2(hostServices);
  for (const [descriptor, initialize, guide, extraFiles] of entries) {
    const files = new Map<string, Uint8Array>(guide ? [['docs/creators/usage.json', new TextEncoder().encode(JSON.stringify(guide))] as const] : []);
    if (extraFiles) {
      for (const [path, content] of Object.entries(extraFiles)) {
        files.set(path, new TextEncoder().encode(content));
      }
    }
    result.register({ manifest: (descriptor as { manifest: ManifestV2 }).manifest, initialize }, moduleAssets(files));
  }
  return result;
}
const profile = (modules: readonly unknown[], providers: Record<string, string>, settings: ModuleProfileV2['settings'] = {}): ModuleProfileV2 => ({
  format: 'space-sim-profile/2', id: 'fixture.api-examples', capabilities: {}, settings, providers,
  modules: modules.map(descriptor => { const { id, version } = (descriptor as { manifest: ManifestV2 }).manifest; return { id, version }; }),
});

const createMockEl = (tag = 'div'): any => {
  const el: any = {
    tagName: tag.toUpperCase(),
    childNodes: [],
    children: [],
    dataset: {},
    classList: { add: vi.fn(), remove: vi.fn(), contains: () => false, toggle: vi.fn() },
    style: { getPropertyValue: () => '', getPropertyPriority: () => '', setProperty: vi.fn(), removeProperty: vi.fn() },
    append: vi.fn(),
    appendChild: vi.fn((node: any) => { el.childNodes.push(node); return node; }),
    remove: vi.fn(),
    getAttribute: () => null,
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    replaceChildren: vi.fn(),
    querySelector: (sel: string) => createMockEl(sel.startsWith('#') ? 'div' : 'span'),
    querySelectorAll: () => [],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    open: false,
    showModal: vi.fn(),
    close: vi.fn(),
  };
  return el;
};

it('replaces the hud.throttle provider with the readout example and keeps its draw path allocation-free', () => {
  const graph = registry([[throttleDescriptor, throttleInitialize, throttleGuide], [readoutDescriptor, readoutInitialize]]);
  const both = [throttleDescriptor, readoutDescriptor];
  expect(() => graph.prepare(profile(both, {}), 'browser', ['hud.throttle'])).toThrow('Select one provider for hud.throttle');
  const candidate = graph.prepare(profile(both, { 'hud.throttle': 'example.throttle-readout' }), 'browser', ['hud.throttle']);
  const lever: { -readonly [K in keyof ThrottleLeverState]: ThrottleLeverState[K] } = { world: {}, shipId: 'ship', throttle: .5, locked: false, firing: true };
  const requests: number[] = [];
  const adapter: FlightHudAdapter = { pilot: 0, navball: () => undefined, throttle: () => lever, setThrottle: value => requests.push(value) };
  const hud = createViewHud({ binding: { seatId: 'seat-0', viewportId: 'view-0', session: {} }, adapters: [{ key: FLIGHT_HUD_STATE, service: adapter }] });
  try {
    // The lock still records the unselected alternative, but only the selected provider initializes.
    expect(candidate.contributions('guide')).toEqual([]);
    hud.select([candidate.providedService(THROTTLE_HUD)]);
    hud.resize({ root: {} as HTMLElement, width: 400, height: 300, x: 0, y: 0 });
    hud.update(1 / 60);
    const first: OverlayPrimitive[] = [], second: OverlayPrimitive[] = [];
    hud.draw(first); hud.update(1 / 60); hud.draw(second);
    expect(first).toEqual([expect.objectContaining({ kind: 'text', text: 'THR 50% BURN' }), expect.objectContaining({ kind: 'line' })]);
    expect(second.every((shape, index) => shape === first[index])).toBe(true);
    lever.locked = true; hud.update(1 / 60); const locked: OverlayPrimitive[] = []; hud.draw(locked);
    expect(locked[0]).toMatchObject({ text: 'THR 50% LOCK' });
    hud.bind({ ...hud.binding, targetId: 'other' }); const rebound: OverlayPrimitive[] = []; hud.draw(rebound);
    expect(rebound).toEqual([]);
    expect(requests).toEqual([]);
    // A view without the flight adapter skips the instrument instead of failing.
    const bare = createViewHud({ binding: { seatId: 'seat-1', viewportId: 'view-1', session: {} }, adapters: [] });
    bare.select([candidate.providedService(THROTTLE_HUD)]); expect(bare.count).toBe(0); bare.dispose();
  } finally { hud.dispose(); candidate.dispose(); }
});

it('consumes view.prediction through the probe example without advancing the world, then cleans up with its provider', () => {
  const graph = registry([[predictionDescriptor, predictionInitialize, predictionGuide], [probeDescriptor, probeInitialize]]);
  const modules = [predictionDescriptor, probeDescriptor];
  const world = new World(DEFAULT_UNIVERSE, { id: 'api-example-prediction' });
  const candidate = graph.prepare(profile(modules, { 'view.prediction': 'spacelab.flight-prediction', 'example.prediction-probe': 'example.prediction-probe' }), 'node');
  try {
    const ship = world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' }); world.step();
    const state = world.ship(ship.id)!.state, before = JSON.stringify(saveWorld(world));
    const input = { context: world.context, state, body: world.body(ship.bodyId), surface: world.surface(ship.bodyId), shipId: ship.id, world };
    const result = candidate.providedService(PREDICTION_PROBE).trace(input);
    expect(result.end).toBe('closed'); expect(result.samples.length).toBeGreaterThan(40); expect(result.period).toBeGreaterThan(0);
    expect(JSON.stringify(saveWorld(world))).toBe(before);
    const probe = candidate.providedService(PREDICTION_PROBE);
    candidate.dispose();
    expect(() => probe.trace(input)).toThrow('Prediction provider disposed');
  } finally { candidate.dispose(); world.dispose(); }
});

it('reports an unfinished probe trace after its update limit and copies the path before disposing the preview', () => {
  const path = [{ time: 0, position: { x: 1, y: 0 }, velocity: { x: 0, y: 1 } }];
  let updates = 0, disposed = false;
  const preview = { path, update() { updates++; }, dispose() { disposed = true; path.length = 0; } };
  const factory = { create: () => preview as unknown as ReturnType<PredictionFactory['create']> };
  const result = createProbe(factory, 3).trace({} as Parameters<ReturnType<typeof createProbe>['trace']>[0]);
  expect(result).toEqual({ end: 'unfinished', samples: [{ time: 0, position: { x: 1, y: 0 }, velocity: { x: 0, y: 1 } }] });
  expect(updates).toBe(3); expect(disposed).toBe(true);
});

it('summarizes plans through the optional flight.plans service, reports rejected archives and works without a provider', () => {
  const graph = registry([[plansDescriptor, plansInitialize, plansGuide], [summaryDescriptor, summaryInitialize]]);
  const world = new World(DEFAULT_UNIVERSE, { id: 'api-example-plans' });
  const withPlans = graph.prepare(profile([plansDescriptor, summaryDescriptor], { 'flight.plans': 'spacelab.flight-plans', 'example.plan-summary': 'example.plan-summary' }), 'node');
  const without = graph.prepare(profile([summaryDescriptor], { 'example.plan-summary': 'example.plan-summary' }), 'node');
  try {
    const ship = world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    const plan = withPlans.providedService(FLIGHT_PLANS).capture(world, ship, [{ id: 'burn', label: 'Raise', bodyId: ship.bodyId, time: ship.state.time + 30, prograde: 12, radial: 0 }]);
    const archive = { format: 'space-sim-flight-plans/1', plans: [plan] };
    expect(withPlans.providedService(PLAN_SUMMARY).describe(archive)).toEqual([
      `${ship.id}: 1 node(s), starting around ${ship.bodyId}`, `  Raise at T+30.0 s around ${ship.bodyId}: prograde 12 m/s, radial 0 m/s`]);
    expect(withPlans.providedService(PLAN_SUMMARY).describe({ format: 'other', plans: [] })[0]).toMatch(/^Rejected\. Flight plan: /);
    expect(without.lock.order).toEqual(['example.plan-summary']);
    expect(without.providedService(PLAN_SUMMARY).describe(archive)).toEqual(['Flight plans are not available in this game.']);
  } finally { withPlans.dispose(); without.dispose(); world.dispose(); }
});

it('inspects flight action definitions and formats active bindings via input-actions example', () => {
  const graph = registry([[actionsDescriptor, actionsInitialize, actionsGuide], [inspectorDescriptor, inspectorInitialize]]);
  const candidate = graph.prepare(profile([actionsDescriptor, inspectorDescriptor], {
    'input.flight-actions': 'spacelab.input-actions',
    'example.flight-actions-inspector': 'example.flight-actions-inspector',
  }), 'browser');
  try {
    const inspector = candidate.providedService(ACTION_INSPECTOR);
    const summary = inspector.summarize();
    expect(summary.total).toBeGreaterThan(20);
    expect(summary.categories.flight).toBeGreaterThan(0);
    expect(summary.categories.warp).toBeGreaterThan(0);
    const engineDesc = inspector.describeBinding('spacelab.input-actions/engine');
    expect(engineDesc).toContain('Fire Main Engine');
    expect(engineDesc).toContain('held');
    expect(engineDesc).toContain('Space');
    expect(inspector.describeBinding('unknown')).toBe('Unknown action: unknown');
  } finally {
    candidate.dispose();
  }
});

it('samples custom gamepad inputs and formats button labels via input-gamepad example', () => {
  const graph = registry([[gamepadDescriptor, gamepadInitialize, gamepadGuide], [customGamepadDescriptor, customGamepadInitialize]]);
  const candidate = graph.prepare(profile([gamepadDescriptor, customGamepadDescriptor], {
    'input.gamepad': 'spacelab.input-gamepad',
    'example.gamepad-custom-source': 'example.gamepad-custom-source',
  }), 'browser');
  try {
    const helper = candidate.providedService(CUSTOM_GAMEPAD);
    expect(helper.format(0, 'xbox')).toBe('A');
    expect(helper.format(0, 'playstation')).toBe('Cross (✕)');
    expect(helper.format(0, 'nintendo')).toBe('Trigger / Btn 0');
    expect(helper.format(0, 'steam-deck')).toBe('A');

    const source = helper.createSource(0, 0, 1);
    const sinkValues = new Map<string, number>();
    const sink = { set: (action: string, value: number) => { sinkValues.set(action, value); } };
    const frame = { elapsed: 1 / 60, pilot: 0, flightAllowed: true, shortcutsAllowed: true };

    const mockPad = {
      connected: true,
      axes: [0],
      buttons: [{ value: 0 }, { value: 0 }],
    };
    vi.stubGlobal('navigator', { getGamepads: () => [mockPad] });
    try {
      source.sample(frame, sink);
      expect(sinkValues.size).toBe(0);

      mockPad.axes[0] = 0.8;
      mockPad.buttons[1] = { value: 1 };
      source.sample(frame, sink);
      expect(sinkValues.get('example.vehicle/steer')).toBeCloseTo(0.764, 2);
      expect(sinkValues.get('example.vehicle/boost')).toBe(1);

      source.release(0);
      sinkValues.clear();
      source.dispose();
      expect(() => source.sample(frame, sink)).toThrow('Gamepad source is disposed');
    } finally {
      vi.unstubAllGlobals();
    }
  } finally {
    candidate.dispose();
  }
});

it('samples keyboard shortcuts and respects reserved keys via input-keyboard example', () => {
  const graph = registry([[keyboardDescriptor, keyboardInitialize, keyboardGuide], [customKeyboardDescriptor, customKeyboardInitialize]]);
  const candidate = graph.prepare(profile([keyboardDescriptor, customKeyboardDescriptor], {
    'input.keyboard': 'spacelab.input-keyboard',
    'example.keyboard-custom-source': 'example.keyboard-custom-source',
  }), 'browser');
  try {
    const helper = candidate.providedService(CUSTOM_KEYBOARD);
    expect(helper.reserved.has('Space')).toBe(true);
    expect(helper.reserved.has('KeyP')).toBe(true);

    const listeners = new Map<string, (e: unknown) => void>();
    const fakeWindow = {
      addEventListener: (type: string, fn: (e: unknown) => void) => { listeners.set(type, fn); },
      removeEventListener: (type: string) => { listeners.delete(type); },
    };
    const fakeDoc = {
      hidden: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const prevWin = globalThis.window, prevDoc = globalThis.document;
    try {
      (globalThis as unknown as { window: unknown }).window = fakeWindow;
      (globalThis as unknown as { document: unknown }).document = fakeDoc;

      const source = helper.createSource(0);
      const sinkValues = new Map<string, number>();
      const sink = { set: (action: string, value: number) => { sinkValues.set(action, value); } };
      const frame = { elapsed: 1 / 60, pilot: 0, flightAllowed: true, shortcutsAllowed: true };

      listeners.get('keydown')?.({ code: 'Enter', altKey: false, preventDefault: () => {} });
      source.sample(frame, sink);
      expect(sinkValues.get('example.menu/select')).toBe(1);

      sinkValues.clear();
      source.sample(frame, sink);
      expect(sinkValues.get('example.menu/select')).toBeUndefined();

      source.dispose();
    } finally {
      (globalThis as unknown as { window: unknown }).window = prevWin;
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    }
  } finally {
    candidate.dispose();
  }
});

it('normalizes controller profiles and enforces deadzone bounds via input-profiles example', () => {
  const graph = registry([[profilesDescriptor, profilesInitialize, profilesGuide], [normalizerDescriptor, normalizerInitialize]]);
  const candidate = graph.prepare(profile([profilesDescriptor, normalizerDescriptor], {
    'input.flight-profiles': 'spacelab.input-profiles',
    'example.profile-normalizer': 'example.profile-normalizer',
  }), 'browser');
  try {
    const validator = candidate.providedService(PROFILE_VALIDATOR);
    const defaults = validator.getDefaults();
    expect(defaults.deadzone).toBe(0.15);
    expect(defaults.turnAxis).toBe(0);

    const normalized = validator.validateAndNormalize({
      deadzone: 0.85,
      buttons: { engine: [7, 7, 999] },
    });
    expect(normalized.deadzone).toBe(0.5);
    expect(normalized.buttons.engine).toEqual([7]);
  } finally {
    candidate.dispose();
  }
});

it('tracks pointer gestures across touch controls via input-touch example', () => {
  const graph = registry([[touchDescriptor, touchInitialize, touchGuide], [virtualPadDescriptor, virtualPadInitialize]]);
  const candidate = graph.prepare(profile([touchDescriptor, virtualPadDescriptor], {
    'input.touch': 'spacelab.input-touch',
    'example.touch-virtual-pad': 'example.touch-virtual-pad',
  }), 'browser');
  try {
    const helper = candidate.providedService(TOUCH_VIRTUAL_PAD);
    const createMockElement = () => {
      const handlers = new Map<string, (e: unknown) => void>();
      return {
        addEventListener: (type: string, fn: (e: unknown) => void) => { handlers.set(type, fn); },
        removeEventListener: (type: string) => { handlers.delete(type); },
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
        _fire: (type: string, e: unknown) => { handlers.get(type)?.(e); },
      };
    };
    const button = createMockElement(), slider = createMockElement();
    const fakeWin = { addEventListener: () => {}, removeEventListener: () => {} };
    const fakeDoc = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
    const prevWin = globalThis.window, prevDoc = globalThis.document;
    try {
      (globalThis as unknown as { window: unknown }).window = fakeWin;
      (globalThis as unknown as { document: unknown }).document = fakeDoc;

      const source = helper.bindControls(0, button as unknown as HTMLElement, slider as unknown as HTMLElement);
      const sinkValues = new Map<string, number>();
      const sink = { set: (action: string, value: number) => { sinkValues.set(action, value); } };
      const frame = { elapsed: 1 / 60, pilot: 0, flightAllowed: true, shortcutsAllowed: true };

      button._fire('pointerdown', { pointerId: 1, pointerType: 'touch', preventDefault: () => {} });
      source.sample(frame, sink);
      expect(sinkValues.get('example.touch/fire')).toBe(1);

      slider._fire('pointerdown', { pointerId: 2, pointerType: 'touch', clientY: 10, clientX: 50, preventDefault: () => {} });
      sinkValues.clear();
      source.sample(frame, sink);
      expect(sinkValues.get('example.touch/pitch')).toBeCloseTo(-0.8, 2);

      source.dispose();
    } finally {
      (globalThis as unknown as { window: unknown }).window = prevWin;
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    }
  } finally {
    candidate.dispose();
  }
});

it('routes namespaced intent to a custom control target adapter via player-controller example', () => {
  const graph = registry([[controllerDescriptor, controllerInitialize, controllerGuide], [turretDescriptor, turretInitialize]]);
  const candidate = graph.prepare(profile([controllerDescriptor, turretDescriptor], {
    'input.controller': 'spacelab.player-controller',
    'example.custom-control-target': 'example.custom-control-target',
  }), 'browser');
  try {
    const helper = candidate.providedService(TURRET_CONTROLLER);
    const { state, controller, target } = helper.createTurretSession('player-pilot');
    expect(controller.target).toEqual(target);

    controller.set('example.turret/yaw', 0.5);
    expect(state.yaw).toBe(0.5);

    controller.release();
    expect(state.released).toBe(true);
    expect(state.yaw).toBe(0);

    controller.dispose();
  } finally {
    candidate.dispose();
  }
});

it('manages local seat device assignments and release passes via local-pilots example', () => {
  const graph = registry([[pilotsDescriptor, pilotsInitialize, pilotsGuide], [pilotHostDescriptor, pilotHostInitialize]]);
  const candidate = graph.prepare(profile([pilotsDescriptor, pilotHostDescriptor], {
    'input.local-pilots': 'spacelab.local-pilots',
    'example.headless-pilot-host': 'example.headless-pilot-host',
  }), 'browser');
  try {
    const helper = candidate.providedService(PILOT_HOST_HELPER);
    const { registry: reg, devices, releases } = helper.createRegistry(['player-1', 'player-2']);
    expect(reg.count).toBe(2);
    expect(reg.playerId(0)).toBe('player-1');
    expect(reg.playerId(1)).toBe('player-2');

    reg.assign(0, 'keyboard');
    expect(devices.get(0)).toBe('keyboard');
    expect(releases.length).toBeGreaterThan(0);

    reg.dispose();
  } finally {
    candidate.dispose();
  }
});

it('configures player counts and device assignments headlessly via controller-menu example', () => {
  const graph = registry([
    [actionsDescriptor, actionsInitialize, actionsGuide],
    [pilotsDescriptor, pilotsInitialize, pilotsGuide],
    [profilesDescriptor, profilesInitialize, profilesGuide],
    [menuDescriptor, menuInitialize, menuGuide],
    [minimalMenuDescriptor, minimalMenuInitialize],
  ]);
  const candidate = graph.prepare(profile(
    [actionsDescriptor, pilotsDescriptor, profilesDescriptor, menuDescriptor, minimalMenuDescriptor],
    {
      'input.flight-actions': 'spacelab.input-actions',
      'input.local-pilots': 'spacelab.local-pilots',
      'input.flight-profiles': 'spacelab.input-profiles',
      'input.controller-menu': 'spacelab.controller-menu',
      'example.minimal-controller-menu': 'example.minimal-controller-menu',
    },
  ), 'browser');
  try {
    const prefs = candidate.providedService(LOCAL_PILOTS).preferences();
    const config = prefs.defaultLocalPlayers();
    expect(config.count).toBe(1);

    const menu = candidate.providedService(MINIMAL_MENU);
    const updated = menu.setPlayerCount(config, 3);
    expect(updated.count).toBe(3);

    const assigned = menu.assignDevice(updated, 1, 'keyboard');
    expect(assigned.slots[1]?.device).toBe('keyboard');
  } finally {
    candidate.dispose();
  }
});

it('connects and handles text messages via net-websocket client helper example', async () => {
  const graph = registry([[netWebsocketDescriptor, netWebsocketInitialize, netWebsocketGuide], [wsClientDescriptor, wsClientInitialize]]);
  const candidate = graph.prepare(profile([netWebsocketDescriptor, wsClientDescriptor], {
    'net.websocket': 'spacelab.net-websocket',
    'example.websocket-custom-client': 'example.websocket-custom-client',
  }), 'browser');
  try {
    const helper = candidate.providedService(WEBSOCKET_CLIENT);
    expect(helper).toBeDefined();
    const mockPeer: TextConnection = {
      label: 'test-peer',
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
    };
    const mockTransport: TransportProvider = {
      name: 'mock',
      schemes: ['ws'],
      connect: vi.fn(async () => mockPeer),
    };
    const client = await createWebSocketClientHelper(mockTransport).connect('ws://localhost:8080', new AbortController().signal);
    expect(client.address).toBe('ws://localhost:8080');
    client.send('ping');
    expect(mockPeer.send).toHaveBeenCalledWith('ping');
    mockPeer.onmessage?.('pong');
    expect(client.messages).toEqual(['pong']);
    client.close();
    expect(mockPeer.close).toHaveBeenCalled();
  } finally {
    candidate.dispose();
  }
});

it('accepts server upgrades via net-node-ws example', () => {
  const hostAccess: HostServiceAccess = { key: NODE_WEBSOCKET_CODECS, service: nativeWebSocketCodecs, tiers: ['network'], environments: ['node'] };
  const graph = registry([[netNodeWsDescriptor, netNodeWsInitialize, netNodeWsGuide], [customNodeWsDescriptor, customNodeWsInitialize]], [hostAccess]);
  const candidate = graph.prepare(profile([netNodeWsDescriptor, customNodeWsDescriptor], {
    'net.node-ws': 'spacelab.net-node-ws',
    'example.node-ws-custom-server': 'example.node-ws-custom-server',
  }), 'node');
  try {
    const helper = candidate.providedService(CUSTOM_NODE_WS);
    expect(helper).toBeDefined();
    const mockReq = { headers: {} } as any;
    const mockStream = { on: vi.fn(), write: vi.fn(), end: vi.fn(), destroy: vi.fn() } as any;
    const result = helper.upgrade(mockReq, mockStream, new Uint8Array(0));
    expect(result).toBeUndefined();
  } finally {
    candidate.dispose();
  }
});

it('creates scoped networks with custom channel factory via net-tab example', () => {
  const graph = registry([[netTabDescriptor, netTabInitialize, netTabGuide], [tabBridgeDescriptor, tabBridgeInitialize]]);
  const candidate = graph.prepare(profile([netTabDescriptor, tabBridgeDescriptor], {
    'net.tab': 'spacelab.net-tab',
    'example.tab-channel-bridge': 'example.tab-channel-bridge',
  }), 'browser');
  try {
    const bridge = candidate.providedService(TAB_BRIDGE);
    expect(bridge).toBeDefined();
    const network = bridge.createScopedNetwork('test-universe', 'space-sim-flight/1');
    expect(network.scope).toBe('test-universe');
    expect(network.protocolId).toBe('space-sim-flight/1');
    network.dispose();
  } finally {
    candidate.dispose();
  }
});

it('validates invitation format strings and generates codes via net-webrtc example', async () => {
  const graph = registry([[netWebrtcDescriptor, netWebrtcInitialize, netWebrtcGuide], [webrtcExchangeDescriptor, webrtcExchangeInitialize]]);
  const candidate = graph.prepare(profile([netWebrtcDescriptor, webrtcExchangeDescriptor], {
    'net.webrtc-signaling': 'spacelab.net-webrtc',
    'example.webrtc-manual-exchange': 'example.webrtc-manual-exchange',
  }), 'browser');
  try {
    const helper = candidate.providedService(WEBRTC_EXCHANGE);
    expect(helper.validateCode('SSO1.test-offer')).toBe('invite');
    expect(helper.validateCode('SSA1.test-reply')).toBe('reply');
    expect(helper.validateCode('random-text')).toBe('invalid');
  } finally {
    candidate.dispose();
  }
});

it('generates LAN candidate addresses and scans endpoints via discovery-lan example', async () => {
  const graph = registry([[discoveryLanDescriptor, discoveryLanInitialize, discoveryLanGuide], [lanScannerDescriptor, lanScannerInitialize]]);
  const candidate = graph.prepare(profile([discoveryLanDescriptor, lanScannerDescriptor], {
    'net.lan-discovery': 'spacelab.discovery-lan',
    'example.lan-service-scanner': 'example.lan-service-scanner',
  }), 'browser');
  try {
    const scanner = candidate.providedService(LAN_SCANNER);
    const candidates = scanner.generateCandidates(['192.168.1.5'], 8080);
    expect(candidates).toContain('192.168.1.5:8080');
    const mockTransport: TransportProvider = {
      name: 'mock',
      schemes: ['http'],
      connect: vi.fn(async () => { throw new Error('Refused'); }),
    };
    const found = await scanner.scan(mockTransport, 'space-sim-flight/1', ['http://192.168.1.5:8080'], { timeoutMs: 10 });
    expect(found).toEqual([]);
  } finally {
    candidate.dispose();
  }
});

it('starts authoritative flight session host and steps world via session-flight example', () => {
  const hostServices = engineModuleServices();
  const graph = registry([[sessionFlightDescriptor, sessionFlightInitialize, sessionFlightGuide], [flightHostManagerDescriptor, flightHostManagerInitialize]], hostServices);
  const candidate = graph.prepare(profile([sessionFlightDescriptor, flightHostManagerDescriptor], {
    'session.flight': 'spacelab.session-flight',
    'example.flight-session-host': 'example.flight-session-host',
  }), 'node');
  const world = new World(DEFAULT_UNIVERSE, { id: 'api-example-flight-host' });
  try {
    const manager = candidate.providedService(FLIGHT_HOST_MANAGER);
    const host = manager.startSession(world, { name: 'Test Flight' });
    expect(host.settings.name).toBe('Test Flight');
    expect(host.paused).toBe(false);
    manager.stepSession(host, 2);
    host.close();
  } finally {
    candidate.dispose();
    world.dispose();
  }
});

it('performs prejoin client negotiation via session-join example', async () => {
  const graph = registry([[sessionJoinDescriptor, sessionJoinInitialize, sessionJoinGuide], [joinNegotiatorDescriptor, joinNegotiatorInitialize]]);
  const candidate = graph.prepare(profile([sessionJoinDescriptor, joinNegotiatorDescriptor], {
    'session.join-pack': 'spacelab.session-join',
    'example.join-pack-negotiator': 'example.join-pack-negotiator',
  }), 'browser');
  try {
    const negotiator = candidate.providedService(JOIN_NEGOTIATOR);
    expect(negotiator).toBeDefined();
    let messageListener: ((text: string) => void) | undefined;
    const mockPeer: TextConnection = {
      label: 'peer',
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      get onmessage() { return messageListener ?? null; },
      set onmessage(fn) { messageListener = fn ?? undefined; },
      onclose: null,
    };
    const mockPort = {
      allowRuntimeCode: true,
      approved: vi.fn(async () => true),
      review: vi.fn(async () => true),
      cached: vi.fn(async () => undefined),
      stage: vi.fn(async () => ({ options: {} as any, dispose: vi.fn() })),
      remember: vi.fn(async () => {}),
    };
    const promise = negotiator.negotiate(mockPeer, mockPort);
    (messageListener as ((text: string) => void) | undefined)?.(JSON.stringify({ t: 'info', protocol: 'space-sim-flight/1' }));
    const result = await promise;
    expect(result.peer).toBeDefined();
  } finally {
    candidate.dispose();
  }
});

it('replaces join review provider and reviews package requirements headlessly via join-review example', async () => {
  const graph = registry([[joinReviewDescriptor, joinReviewInitialize, joinReviewGuide], [headlessJoinReviewDescriptor, headlessJoinReviewInitialize]]);
  const candidate = graph.prepare(profile([joinReviewDescriptor, headlessJoinReviewDescriptor], {
    'ui.join-review': 'example.headless-join-reviewer',
  }), 'browser', ['ui.join-review']);
  try {
    const reviewer = candidate.providedService(JOIN_REVIEW);
    expect(reviewer).toBeDefined();
    const safeOffer = {
      format: 'spacelab-join-offer/1' as const,
      id: 'offer-1',
      sessionId: 'sess-1',
      name: 'Safe Game',
      protocol: 'space-sim-flight/1',
      entitySchema: 'entities/1',
      model: 'default',
      fingerprint: 'fp',
      lockDigest: 'ld',
      packDigest: 'pd',
      packBytes: 100,
      packages: [
        { id: 'data.planets', version: '1.0.0', digest: 'd1', bytes: 100, license: 'MIT', containsCode: false, sourceIncluded: false, required: true, tier: 'platform' as const },
      ],
    };
    const approved = await reviewer.review(safeOffer, 'localhost:8080', new AbortController().signal);
    expect(approved).toBe(true);
  } finally {
    candidate.dispose();
  }
});

it('mounts chat console and logs formatted messages via chat-console example', () => {
  const graph = registry([[chatConsoleDescriptor, chatConsoleInitialize, chatConsoleGuide], [chatHelperDescriptor, chatHelperInitialize]]);
  const candidate = graph.prepare(profile([chatConsoleDescriptor, chatHelperDescriptor], {
    'ui.chat': 'spacelab.chat-console',
    'example.chat-history-formatter': 'example.chat-history-formatter',
  }), 'browser');
  try {
    const helper = candidate.providedService(CHAT_HELPER);
    expect(helper).toBeDefined();
    const mockDoc = {
      defaultView: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      createElement: (tag: string) => ({
        tagName: tag.toUpperCase(),
        classList: { add: vi.fn(), remove: vi.fn(), contains: () => false, toggle: vi.fn() },
        style: {} as any,
        append: vi.fn(),
        remove: vi.fn(),
        setAttribute: vi.fn(),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    };
    const mockRoot: any = {
      ownerDocument: mockDoc,
      classList: { add: vi.fn(), remove: vi.fn(), contains: () => false, toggle: vi.fn() },
      style: {} as any,
      innerHTML: '',
      append: vi.fn(),
      remove: vi.fn(),
      replaceChildren: vi.fn(),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
      clientWidth: 800,
      clientHeight: 600,
      offsetWidth: 400,
      offsetHeight: 300,
    };
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal('MutationObserver', class {
      observe() {}
      disconnect() {}
    });
    const chat = helper.mount({
      root: mockRoot,
      viewport: mockRoot,
      submit: vi.fn(),
    });
    expect(chat).toBeDefined();
    helper.logFormatted(chat, 'system', 'Welcome to the session');
    chat.clear();
    chat.dispose();
  } finally {
    vi.unstubAllGlobals();
    candidate.dispose();
  }
});

it('renders celestial scene frame to canvas 2D via render-canvas example', () => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const hostServices = engineModuleServices();
  const graph = registry([
    [renderCanvasDescriptor, renderCanvasInitialize, renderCanvasGuide],
    [canvasViewerDescriptor, canvasViewerInitialize],
  ], hostServices);
  const candidate = graph.prepare(profile([renderCanvasDescriptor, canvasViewerDescriptor], {
    'render.canvas': 'spacelab.render-canvas',
    'example.canvas-renderer': 'example.canvas-renderer',
  }), 'browser');
  try {
    const helper = candidate.providedService(CANVAS_VIEWER_HELPER);
    const mockCtx = {
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    };
    const mockCanvas: any = {
      clientWidth: 800,
      clientHeight: 600,
      width: 800,
      height: 600,
      getContext: (type: string) => type === '2d' ? mockCtx : null,
    };
    const renderer = helper.renderScene(mockCanvas, {
      camera: { center: { x: 0, y: 0 }, scale: 1, rotation: 0 },
      bodies: [],
      overlays: [],
      time: 15,
    });
    expect(renderer).toBeDefined();
    expect(mockCtx.setTransform).toHaveBeenCalled();
    renderer.dispose();
  } finally {
    vi.unstubAllGlobals();
    candidate.dispose();
  }
});

it('attempts webgl scene and preview creation handling environment limits via render-webgl example', () => {
  const hostServices = engineModuleServices();
  const graph = registry([
    [renderWebglDescriptor, renderWebglInitialize, renderWebglGuide],
    [webglRendererDescriptor, webglRendererInitialize],
  ], hostServices);
  const candidate = graph.prepare(profile([renderWebglDescriptor, webglRendererDescriptor], {
    'render.webgl': 'spacelab.render-webgl',
    'example.webgl-renderer': 'example.webgl-renderer',
  }), 'browser');
  try {
    const helper = candidate.providedService(WEBGL_RENDERER_HELPER);
    const mockCanvas: any = {
      clientWidth: 640,
      clientHeight: 480,
      getContext: () => null,
    };
    const dummyShaders: any = {
      format: 'space-sim-shaders/1',
      name: 'Dummy',
      passes: {
        scene: { vertex: 'void main() {}', fragment: 'void main() {}' },
        vector: { vertex: 'void main() {}', fragment: 'void main() {}' },
        text: { vertex: 'void main() {}', fragment: 'void main() {}' },
      },
    };
    const rendererResult = helper.tryCreateRenderer(mockCanvas, dummyShaders);
    expect(rendererResult.success).toBe(false);
    expect(rendererResult.error).toContain('WebGL 2 is unavailable');

    const previewResult = helper.tryCreatePreview(mockCanvas, dummyShaders);
    expect(previewResult.success).toBe(false);
    expect(previewResult.error).toContain('planet preview needs WebGL 2');
  } finally {
    candidate.dispose();
  }
});

it('inspects default shader passes, parses overrides and validates definitions via shaders-vector example', () => {
  const graph = registry([
    [shadersVectorDescriptor, shadersVectorInitialize, shadersVectorGuide, vectorShaderAssets],
    [customShadersDescriptor, customShadersInitialize],
  ]);
  const candidate = graph.prepare(profile([shadersVectorDescriptor, customShadersDescriptor], {
    'render.vector-shaders': 'spacelab.vector-shaders',
    'example.custom-shaders': 'example.custom-shaders',
  }), 'browser');
  try {
    const helper = candidate.providedService(CUSTOM_SHADERS_HELPER);
    const summary = helper.summarizeDefaults();
    expect(summary.format).toBe('space-sim-shaders/1');
    expect(summary.name).toBe('Default');
    expect(summary.passes).toEqual(['scene', 'vector', 'text']);

    const overridden = helper.loadFragmentOverride('neon.frag', 'void main() { gl_FragColor = vec4(1.0); }');
    expect(overridden.name).toBe('neon.frag');
    expect(overridden.passes.scene.fragment).toBe('void main() { gl_FragColor = vec4(1.0); }');

    const validCheck = helper.validatePack({
      format: 'space-sim-shaders/1',
      name: 'ValidPack',
      passes: { scene: { fragment: 'void main() {}' } },
    });
    expect(validCheck.valid).toBe(true);
    expect(validCheck.name).toBe('ValidPack');

    const invalidCheck = helper.validatePack({ format: 'wrong-format' });
    expect(invalidCheck.valid).toBe(false);
    expect(invalidCheck.error).toContain('Expected format');
  } finally {
    candidate.dispose();
  }
});

it('manages theme controller lifecycle, presets and summaries via theme example', () => {
  const graph = registry([
    [themeDescriptor, themeInitialize, themeGuide, themeAssets],
    [themeProviderDescriptor, themeProviderInitialize],
  ]);
  const candidate = graph.prepare(profile([themeDescriptor, themeProviderDescriptor], {
    'presentation.themes': 'spacelab.theme',
    'example.theme-provider': 'example.theme-provider',
  }), 'browser');
  try {
    const helper = candidate.providedService(THEME_MANAGER_HELPER);
    const storageMap = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, val: string) => { storageMap.set(key, val); },
    };
    const controller = helper.createController(mockStorage, { windowOpacity: 0.8 });
    expect(controller.defaults.windowOpacity).toBe(0.8);
    expect(controller.presets.length).toBeGreaterThan(0);

    const cyberApplied = helper.applyPreset(controller, 'orion-cyber');
    expect(cyberApplied).toBe(true);
    expect(controller.current().counterTheme).toBe('cyber');

    const summary = helper.summarize(controller);
    expect(summary.backdropStyle).toBeDefined();
    expect(typeof summary.gridEnabled).toBe('boolean');

    controller.dispose();
  } finally {
    candidate.dispose();
  }
});

it('mounts and toggles theme customizer dialog via theme-customizer example', () => {
  const graph = registry([
    [themeDescriptor, themeInitialize, themeGuide, themeAssets],
    [themeCustomizerDescriptor, themeCustomizerInitialize, themeCustomizerGuide, themeCustomizerAssets],
    [customizerDialogDescriptor, customizerDialogInitialize],
  ]);
  const candidate = graph.prepare(profile([themeDescriptor, themeCustomizerDescriptor, customizerDialogDescriptor], {
    'presentation.themes': 'spacelab.theme',
    'ui.theme-customizer': 'spacelab.theme-customizer',
    'example.customizer-dialog': 'example.customizer-dialog',
  }), 'browser');
  try {
    const helper = candidate.providedService(CUSTOMIZER_DIALOG_HELPER);
    const createMockEl = (tag = 'div'): any => {
      const el: any = {
        tagName: tag.toUpperCase(),
        childNodes: [],
        children: [],
        dataset: {},
        classList: { add: vi.fn(), remove: vi.fn(), contains: () => false, toggle: vi.fn() },
        style: { getPropertyValue: () => '', getPropertyPriority: () => '', setProperty: vi.fn(), removeProperty: vi.fn() },
        append: vi.fn(),
        appendChild: vi.fn((node: any) => { el.childNodes.push(node); return node; }),
        remove: vi.fn(),
        getAttribute: () => null,
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
        replaceChildren: vi.fn(),
        querySelector: (sel: string) => createMockEl(sel.startsWith('#') ? 'div' : 'span'),
        querySelectorAll: () => [],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        open: false,
        showModal: vi.fn(),
        close: vi.fn(),
      };
      return el;
    };
    const mockDoc: any = {
      defaultView: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      createElement: (tag: string) => createMockEl(tag),
      head: { append: vi.fn() },
    };
    const mockRoot = createMockEl('div');
    mockRoot.ownerDocument = mockDoc;
    const mounted = helper.mount(mockRoot);
    expect(mounted.customizer).toBeDefined();
    expect(mounted.theme).toBeDefined();

    const gridToggled = mounted.customizer.toggleGrid();
    expect(typeof gridToggled).toBe('boolean');

    mounted.customizer.open();
    mounted.customizer.close();
    mounted.customizer.dispose();
    mounted.theme.dispose();
  } finally {
    candidate.dispose();
  }
});

it('inspects contributed trainer and scout vehicle vector artwork via appearance-trainer example', () => {
  const flightGuideText = readFileSync('modules/appearance-trainer/docs/players/flight.json', 'utf8');
  const graph = registry([
    [appearanceTrainerDescriptor, appearanceTrainerInitialize, appearanceTrainerGuide, { 'docs/players/flight.json': flightGuideText }],
    [trainerAppearanceExampleDescriptor, trainerAppearanceExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([appearanceTrainerDescriptor, trainerAppearanceExampleDescriptor], {
    'example.trainer-appearance': 'example.trainer-appearance',
  }), 'browser');
  try {
    const helper = candidate.providedService(VEHICLE_ARTWORK_HELPER);
    const trainerInfo = helper.lookup(trainerArtwork, 'spacelab.trainer/orbit-trainer');
    expect(trainerInfo.found).toBe(true);
    expect(trainerInfo.points).toBe(4);
    expect(trainerInfo.hasFlame).toBe(true);

    const unknownInfo = helper.lookup(trainerArtwork, 'nonexistent');
    expect(unknownInfo.found).toBe(false);

    const composed = helper.compose([scoutAppearance]);
    const scoutInfo = helper.lookup(composed, 'example.probe/scout-probe');
    expect(scoutInfo.found).toBe(true);
    expect(scoutInfo.points).toBe(4);
    expect(scoutInfo.hasFlame).toBe(true);

    const contribs = candidate.contributions('vehicleAppearance');
    expect(contribs.some(c => c.value.vehicleId === 'spacelab.trainer/orbit-trainer')).toBe(true);
    expect(contribs.some(c => c.value.vehicleId === 'example.probe/scout-probe')).toBe(true);
  } finally {
    candidate.dispose();
  }
});

it('manages independent follow and flight camera updates via camera-follow example', () => {
  const graph = registry([
    [cameraFollowDescriptor, cameraFollowInitialize, cameraFollowGuide],
    [cameraFollowExampleDescriptor, cameraFollowExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([cameraFollowDescriptor, cameraFollowExampleDescriptor], {
    'view.camera': 'spacelab.camera-follow',
    'view.flight-camera': 'spacelab.camera-follow',
    'example.camera-follow': 'example.camera-follow',
  }), 'browser');
  try {
    const helper = candidate.providedService(FLIGHT_CAMERA_HELPER);
    const camera = helper.setupCamera(5, true);
    expect(camera.zoom).toBe(5);
    expect(camera.horizon).toBe(true);
    const frame = helper.trackTarget(camera, { x: 0, y: 0 }, { x: 1000, y: 2000 }, 1 / 60, false, 800, 600);
    expect(frame).toBeDefined();
    expect(frame.scale).toBeGreaterThan(0);
    expect(frame.center).toBeDefined();
    camera.dispose();
  } finally {
    candidate.dispose();
  }
});

it('selects priority candidate targets and starts guidance via camera-smart example', () => {
  const graph = registry([
    [cameraSmartDescriptor, cameraSmartInitialize, cameraSmartGuide],
    [cameraSmartExampleDescriptor, cameraSmartExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([cameraSmartDescriptor, cameraSmartExampleDescriptor], {
    'view.smart-camera': 'spacelab.camera-smart',
    'example.camera-smart': 'example.camera-smart',
  }), 'browser');
  try {
    const helper = candidate.providedService(SMART_CAMERA_HELPER);
    const targetA = { id: 'ship-1', name: 'Alpha', position: { x: 300, y: 0 } };
    const targetB = { id: 'ship-2', name: 'Beta', position: { x: 5000, y: 5000 } };
    const found = helper.findCandidate({ x: 0, y: 0 }, { x: -800, y: 0 }, 0, 1, [[targetA, targetB]]);
    expect(found).toBeDefined();
    expect(found?.id).toBe('ship-1');
    const control = helper.startGuidance(targetA, true);
    expect(control.target?.id).toBe('ship-1');
    control.dispose();
  } finally {
    candidate.dispose();
  }
});

it('computes responsive pane layouts and allocates viewports via local-views example', () => {
  const graph = registry([
    [cameraFollowDescriptor, cameraFollowInitialize, cameraFollowGuide],
    [localViewsDescriptor, localViewsInitialize, localViewsGuide],
    [localViewsExampleDescriptor, localViewsExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([cameraFollowDescriptor, localViewsDescriptor, localViewsExampleDescriptor], {
    'view.camera': 'spacelab.camera-follow',
    'view.local': 'spacelab.local-views',
    'example.local-views': 'example.local-views',
  }), 'browser');
  try {
    const helper = candidate.providedService(LOCAL_VIEWS_HELPER);
    const panes = helper.computePanes(2, 'side', 1000, 500);
    expect(panes).toHaveLength(2);
    expect(panes[0]!.w).toBe(0.5);
    expect(panes[1]!.w).toBe(0.5);

    const views = helper.createViews({
      bindings: [
        { viewportId: 'vp-0', seatId: 'seat-0', targetId: 'target-0' },
        { viewportId: 'vp-1', seatId: 'seat-1', targetId: 'target-1' },
      ],
      layout: 'side',
      mode: 'split',
      surface: () => ({ resize: vi.fn(), draw: vi.fn(), dispose: vi.fn() }),
    });
    expect(views.count).toBe(2);
    views.reflow(1000, 500);
    views.dispose();
  } finally {
    candidate.dispose();
  }
});

it('composes player view roles and rebinds seat identity via player-view example', () => {
  const graph = registry([
    [playerViewDescriptor, playerViewInitialize, playerViewGuide],
    [playerViewExampleDescriptor, playerViewExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([playerViewDescriptor, playerViewExampleDescriptor], {
    'ui.player-view': 'spacelab.player-view',
    'example.player-view': 'example.player-view',
  }), 'browser');
  try {
    const helper = candidate.providedService(PLAYER_VIEW_HELPER);
    const mockControllerAdapter = {
      resource: {},
      rebind: vi.fn(),
      release: vi.fn(),
      dispose: vi.fn(),
    };
    const sessionObj = {};
    const view = helper.composeView(
      { seatId: 'seat-0', viewportId: 'vp-0', session: sessionObj, playerId: 'p1', targetId: 'ship-1' },
      { input: mockControllerAdapter },
    );
    expect(view.binding.seatId).toBe('seat-0');
    expect(view.adapters.input).toBe(mockControllerAdapter);

    helper.rebindView(view, { seatId: 'seat-0', viewportId: 'vp-0', session: sessionObj, playerId: 'p1', targetId: 'ship-2' });
    expect(mockControllerAdapter.rebind).toHaveBeenCalled();
    expect(view.binding.targetId).toBe('ship-2');
    view.dispose();
  } finally {
    candidate.dispose();
  }
});

it('manages shared per-view HUD lifecycle, instruments, and overlays via view-hud example', () => {
  const graph = registry([
    [viewHudDescriptor, viewHudInitialize, viewHudGuide],
    [viewHudExampleDescriptor, viewHudExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([viewHudDescriptor, viewHudExampleDescriptor], {
    'ui.view-hud': 'spacelab.view-hud',
    'example.view-hud': 'example.view-hud',
  }), 'browser');
  try {
    const helper = candidate.providedService(VIEW_HUD_HELPER);
    const hud = helper.createHud({
      binding: { seatId: 'seat-0', viewportId: 'vp-0', session: {} },
      adapters: [],
    });
    expect(hud.count).toBe(0);

    const mockInstrument = {
      cancel: vi.fn(),
      rebind: vi.fn(),
      resize: vi.fn(),
      update: vi.fn(),
      draw: (into: any[]) => { into.push({ kind: 'circle', x: 50, y: 50, r: 20 }); },
      dispose: vi.fn(),
    };
    const testDef = {
      id: 'example.instrument',
      requires: [],
      create: () => mockInstrument,
    };
    helper.populateInstruments(hud, [testDef]);
    expect(hud.count).toBe(1);

    const mockRoot = createMockEl('div');
    const surface = { root: mockRoot, width: 400, height: 300, x: 0, y: 0 };
    const overlays = helper.renderFrame(hud, surface, 1 / 60);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ kind: 'circle', x: 50, y: 50 });

    hud.dispose();
    expect(mockInstrument.dispose).toHaveBeenCalled();
  } finally {
    candidate.dispose();
  }
});

it('manages responsive HUD layout obstacle avoidance via hud-layout example', () => {
  const mockDoc: any = {
    defaultView: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      AbortController: globalThis.AbortController,
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn(),
    },
    createElement: (tag: string) => createMockEl(tag),
    head: { append: vi.fn() },
    getElementById: vi.fn(),
  };
  const mockViewport = createMockEl('div');
  mockViewport.ownerDocument = mockDoc;
  const graph = registry([
    [windowsDescriptor, windowsInitialize, windowsGuide, windowsAssets],
    [hudLayoutDescriptor, hudLayoutInitialize, hudLayoutGuide, hudLayoutAssets],
    [hudLayoutExampleDescriptor, hudLayoutExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([windowsDescriptor, hudLayoutDescriptor, hudLayoutExampleDescriptor], {
    'ui.windows': 'spacelab.ui-windows',
    'ui.hud-layout': 'spacelab.hud-layout',
    'example.hud-layout': 'example.hud-layout',
  }), 'browser');
  try {
    const helper = candidate.providedService(HUD_LAYOUT_HELPER);
    const layout = helper.createLayout({ viewport: mockViewport });
    expect(layout.editing).toBe(false);

    const preferred = { x: 10, y: 10, width: 100, height: 50 };
    const fitted = helper.fitBounds(layout, preferred, 800, 600);
    expect(fitted.x).toBeGreaterThanOrEqual(0);
    expect(fitted.y).toBeGreaterThanOrEqual(0);
    expect(fitted.width).toBe(100);
    expect(fitted.height).toBe(50);
    layout.dispose();
  } finally {
    candidate.dispose();
  }
});

it('draws attitude indicator overlays via navball example', () => {
  const graph = registry([
    [navballDescriptor, navballInitialize, navballGuide],
    [navballExampleDescriptor, navballExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([navballDescriptor, navballExampleDescriptor], {
    'hud.navball': 'builtin.navball',
    'example.navball': 'example.navball',
  }), 'browser');
  try {
    const helper = candidate.providedService(NAVBALL_VIEWER_HELPER);
    const readout: FlightHudReadout = {
      state: {
        time: 100,
        position: { x: 0, y: 7000000 },
        velocity: { x: 7500, y: 0 },
        heading: 0,
        status: 'flying',
        throttle: 0,
        revision: 0,
      },
      radius: 6371000,
      spin: 0.00007292115,
      clearance: 629000,
      center: { x: 100, y: 100 },
      scale: 1,
      cameraRotation: 0,
      frameSetting: 0,
      orientation: 'horizon',
      pinned: false,
      dragging: false,
      editing: false,
    };
    const mockContext: any = {
      binding: { seatId: 'seat-0', viewportId: 'vp-0', session: {}, targetId: 'ship-1' },
      use: () => ({
        navball: () => readout,
        cancelGestures: vi.fn(),
      }),
    };
    const instrument = helper.createInstrument(mockContext);
    const overlays = helper.drawNavball(instrument);
    expect(overlays.length).toBeGreaterThan(0);
    expect(overlays.some(shape => shape.kind === 'circle')).toBe(true);
    instrument.dispose();
  } finally {
    candidate.dispose();
  }
});

it('smooths rotating body presentation during warp via spin-view example', () => {
  const hostServices = engineModuleServices();
  const graph = registry([
    [spinViewDescriptor, spinViewInitialize, spinViewGuide],
    [spinViewExampleDescriptor, spinViewExampleInitialize],
  ], hostServices);
  const candidate = graph.prepare(profile([spinViewDescriptor, spinViewExampleDescriptor], {
    'view.spin': 'spacelab.spin-view',
    'example.spin-view': 'example.spin-view',
  }), 'node');
  try {
    const helper = candidate.providedService(SPIN_VIEW_HELPER);
    const spin = helper.createSpin();
    const testBody = {
      id: 'earth',
      name: 'Earth',
      mass: 5.972e24,
      radius: 6371000,
      orbit: null,
      rotation: { period: 86400, direction: 1, phase: 0 },
    } as any;
    const angle = helper.getAngle(spin, testBody, 3600);
    expect(Number.isFinite(angle)).toBe(true);
    const pt = helper.transformPoint(spin, testBody, 3600, { x: 100, y: 0 });
    expect(Number.isFinite(pt.x)).toBe(true);
    expect(Number.isFinite(pt.y)).toBe(true);
    spin.dispose();
  } finally {
    candidate.dispose();
  }
});

it('culls and builds visible ship presentation lists via fleet-view example', () => {
  const graph = registry([
    [fleetViewDescriptor, fleetViewInitialize, fleetViewGuide],
    [fleetViewExampleDescriptor, fleetViewExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([fleetViewDescriptor, fleetViewExampleDescriptor], {
    'view.fleet': 'spacelab.fleet-view',
    'example.fleet-view': 'example.fleet-view',
  }), 'node');
  try {
    const helper = candidate.providedService(FLEET_VIEWER_HELPER);
    const fleet = helper.createFleet();
    const statsInitial = helper.readStats(fleet);
    expect(statsInitial.ships).toBe(0);

    const mockWorld: any = {
      system: {
        getBodyPosition: () => ({ x: 0, y: 0 }),
      },
      records: () => [],
      isAsleep: () => false,
      has: () => false,
    };
    const input: FleetViewInput = {
      world: mockWorld,
      time: 100,
      alpha: 1,
      paused: false,
      playerId: 'player-1',
      camera: {
        center: { x: 0, y: 0 },
        scale: 0.1,
        rotation: 0,
      } as any,
      width: 800,
      height: 600,
      previous: () => undefined,
      displayOffset: () => ({ x: 0, y: 0 }),
      playerName: () => 'Pilot',
    };
    const ships = helper.buildShips(fleet, input);
    expect(Array.isArray(ships)).toBe(true);
    fleet.dispose();
  } finally {
    candidate.dispose();
  }
});

it('initializes flight split-screen manager and coordinates guest views via flight-split example', () => {
  const mockDoc: any = {
    defaultView: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    createElement: (tag: string) => createMockEl(tag),
    head: { append: vi.fn() },
  };
  vi.stubGlobal('document', mockDoc);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const mockViewport = createMockEl('div');
  mockViewport.ownerDocument = mockDoc;

  const graph = registry([
    [pilotsDescriptor, pilotsInitialize, pilotsGuide],
    [profilesDescriptor, profilesInitialize, profilesGuide],
    [cameraFollowDescriptor, cameraFollowInitialize, cameraFollowGuide],
    [predictionDescriptor, predictionInitialize, predictionGuide],
    [fleetViewDescriptor, fleetViewInitialize, fleetViewGuide],
    [localViewsDescriptor, localViewsInitialize, localViewsGuide],
    [flightSplitDescriptor, flightSplitInitialize, flightSplitGuide],
    [flightSplitExampleDescriptor, flightSplitExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([
    pilotsDescriptor,
    profilesDescriptor,
    cameraFollowDescriptor,
    predictionDescriptor,
    fleetViewDescriptor,
    localViewsDescriptor,
    flightSplitDescriptor,
    flightSplitExampleDescriptor,
  ], {
    'input.local-pilots': 'spacelab.local-pilots',
    'input.flight-profiles': 'spacelab.input-profiles',
    'view.flight-camera': 'spacelab.camera-follow',
    'view.prediction': 'spacelab.flight-prediction',
    'view.fleet': 'spacelab.fleet-view',
    'view.local': 'spacelab.local-views',
    'view.flight-split': 'spacelab.flight-split',
    'example.flight-split': 'example.flight-split',
  }), 'browser');
  try {
    const helper = candidate.providedService(FLIGHT_SPLIT_HELPER);
    const mockHost: any = {
      primaryCanvas: () => createMockEl('canvas'),
      session: () => ({ id: 'session-1', players: new Map() }),
      ownWorld: () => undefined,
      presetId: () => 'orbit-trainer',
      isGodMode: () => false,
      keyboardFlight: () => ({ turn: 0, throttle: 0, engine: false }),
      execute: vi.fn(),
      notify: vi.fn(),
      changed: vi.fn(),
      isSessionError: (e: any): e is Error => e instanceof Error,
    };
    const split = helper.createSplit(mockViewport, mockHost);
    expect(split).toBeDefined();
    expect(split.split).toBe(false);
    helper.pollJoining(split);
    split.dispose();
  } finally {
    vi.unstubAllGlobals();
    candidate.dispose();
  }
});

it('integrates finite maneuver burn intent and transitions phases via maneuver-burn example', () => {
  const hostServices = engineModuleServices();
  const graph = registry([
    [maneuverBurnDescriptor, maneuverBurnInitialize, maneuverBurnGuide],
    [maneuverBurnExampleDescriptor, maneuverBurnExampleInitialize],
  ], hostServices);
  const candidate = graph.prepare(profile([
    maneuverBurnDescriptor,
    maneuverBurnExampleDescriptor,
  ], {
    'flight.maneuver-burn': 'spacelab.maneuver-burn',
    'example.maneuver-burn': 'example.maneuver-burn',
  }), 'node');
  try {
    const executor = candidate.providedService(MANEUVER_BURN_EXECUTOR);
    const vehicle = { mass: 1000, acceleration: 20, turnRate: 2, initialThrottle: 0 };
    // Burn of 200 m/s at 20 m/s^2 takes 10s. Centered at 100s, starts at 95s.
    const burn = executor.createBurn(100, { x: 200, y: 0 }, vehicle);
    expect(burn.phase).toBe('aligning');
    expect(burn.start).toBe(95);
    expect(burn.remaining).toBeCloseTo(200, 1);

    // Ship facing +X (heading 0), aligned with {x: 200, y: 0} at time 90 (< 95)
    const stateWait = { time: 90, position: { x: 0, y: 7000000 }, velocity: { x: 7500, y: 0 }, heading: 0, status: 'flying' as const, throttle: 0, revision: 0 };
    const stepWait = executor.stepBurn(burn, stateWait);
    expect(stepWait.phase).toBe('waiting');
    expect(stepWait.controls.engine).toBe(false);

    // At burn start (95s), transition to burning
    const stateBurn = { time: 95, position: { x: 0, y: 7000000 }, velocity: { x: 7500, y: 0 }, heading: 0, status: 'flying' as const, throttle: 0, revision: 1 };
    const stepBurn = executor.stepBurn(burn, stateBurn);
    expect(stepBurn.phase).toBe('burning');
    expect(stepBurn.controls.engine).toBe(true);
    expect(stepBurn.throttle).toBeGreaterThan(0);

    burn.dispose();
  } finally {
    candidate.dispose();
  }
});

it('computes impulse vectors and summarizes maneuver overlays via maneuver-display example', () => {
  const graph = registry([
    [maneuverDisplayDescriptor, maneuverDisplayInitialize, maneuverDisplayGuide],
    [maneuverDisplayExampleDescriptor, maneuverDisplayExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([
    maneuverDisplayDescriptor,
    maneuverDisplayExampleDescriptor,
  ], {
    'example.maneuver-display': 'example.maneuver-display',
  }), 'browser');
  try {
    const helper = candidate.providedService(MANEUVER_DISPLAY_HELPER);
    const sample = { position: { x: 7000000, y: 0 }, velocity: { x: 0, y: 7500 }, time: 0 };
    const delta = helper.computeDelta(sample, 100, 50);
    expect(delta.x).toBeCloseTo(50, 1);
    expect(delta.y).toBeCloseTo(100, 1);

    const summary = helper.summarize({
      time: 150,
      position: { x: 7000000, y: 0 },
      deltaVelocity: { x: 30, y: 40 },
      burnSeconds: 10,
      valid: true,
      completed: false,
      nodes: [{ id: 'node-1', label: 'NODE 1', time: 150, position: { x: 7000000, y: 0 }, deltaVelocity: { x: 30, y: 40 }, valid: true, selected: true }],
      path: [],
    });
    expect(summary.time).toBe(150);
    expect(summary.deltaV).toBeCloseTo(50, 1);
    expect(summary.valid).toBe(true);
    expect(summary.completed).toBe(false);
    expect(summary.nodeCount).toBe(1);
  } finally {
    candidate.dispose();
  }
});

it('initializes maneuver planner editor session and queries diagnostics via maneuver-editor example', () => {
  const hostServices = engineModuleServices();
  const mockDoc: any = {
    defaultView: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      ResizeObserver: class MockResizeObserver {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    },
    createElement: (tag: string) => {
      const el = createMockEl(tag);
      el.ownerDocument = mockDoc;
      return el;
    },
    head: { append: vi.fn() },
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const mockContainer = createMockEl('div');
  mockContainer.ownerDocument = mockDoc;

  const graph = registry([
    [windowsDescriptor, windowsInitialize, windowsGuide, windowsAssets],
    [predictionDescriptor, predictionInitialize, predictionGuide],
    [maneuverBurnDescriptor, maneuverBurnInitialize, maneuverBurnGuide],
    [maneuverDisplayDescriptor, maneuverDisplayInitialize, maneuverDisplayGuide],
    [maneuverEditorDescriptor, maneuverEditorInitialize, maneuverEditorGuide, maneuverEditorAssets],
    [maneuverEditorExampleDescriptor, maneuverEditorExampleInitialize],
  ], hostServices);
  const candidate = graph.prepare(profile([
    windowsDescriptor,
    predictionDescriptor,
    maneuverBurnDescriptor,
    maneuverDisplayDescriptor,
    maneuverEditorDescriptor,
    maneuverEditorExampleDescriptor,
  ], {
    'ui.windows': 'spacelab.ui-windows',
    'view.prediction': 'spacelab.flight-prediction',
    'flight.maneuver-burn': 'spacelab.maneuver-burn',
    'view.maneuver-planner': 'spacelab.maneuver-editor',
    'example.maneuver-editor': 'example.maneuver-editor',
  }), 'browser');
  try {
    const helper = candidate.providedService(MANEUVER_EDITOR_HELPER);
    const mockFlight = {
      world: {
        time: 100,
        ship: () => ({ id: 'ship-1', state: { time: 100, position: { x: 0, y: 7000000 }, velocity: { x: 7500, y: 0 }, heading: 0, status: 'flying', throttle: 0, revision: 0 } }),
        body: () => ({ id: 'earth', radius: 6371000, mu: 3.986004418e14 }),
      } as any,
      body: { id: 'earth', radius: 6371000, mu: 3.986004418e14 } as any,
      enabled: true,
      canWarp: true,
      paused: false,
      inputBlocked: false,
      warp: 1,
      requestedWarp: 1,
    };
    const session = helper.createSession({
      container: mockContainer,
      id: 'test-maneuver-editor',
      flight: () => mockFlight,
      setWarp: vi.fn(),
      setThrottle: vi.fn(),
      releaseControls: vi.fn(),
      notify: vi.fn(),
    });
    expect(session.isExecuting).toBe(false);
    expect(session.getDiagnostics()).toBeDefined();
    session.dispose();
  } finally {
    candidate.dispose();
  }
});

it('schedules simulation-time orbital alarms and inspects catalogue via orbital-alarms example', () => {
  const burnsGuideText = readFileSync('modules/orbital-alarms/docs/players/burns.json', 'utf8');
  const graph = registry([
    [orbitalAlarmsDescriptor, orbitalAlarmsInitialize, orbitalAlarmsGuide, { 'docs/players/burns.json': burnsGuideText }],
    [orbitalAlarmsExampleDescriptor, orbitalAlarmsExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([
    orbitalAlarmsDescriptor,
    orbitalAlarmsExampleDescriptor,
  ], {
    'flight.alarms': 'spacelab.orbital-alarms',
    'flight.alarm-catalogue': 'spacelab.orbital-alarms',
    'example.orbital-alarms': 'example.orbital-alarms',
  }), 'node');
  try {
    const helper = candidate.providedService(ORBITAL_ALARM_HELPER);
    const clock = helper.createClock();
    const sessionObj = {};
    const events = [
      { id: 'burn-1', kind: 'maneuver', label: 'Prograde burn', deadline: 100, time: 110, pause: true },
    ];

    // At now = 50, event is not due
    const noticesBefore = helper.syncClock(clock, sessionObj, 50, events);
    expect(noticesBefore.length).toBe(0);

    // Catalogue shows the pending alarm
    const catalogue = helper.readCatalogue(sessionObj);
    expect(catalogue.some(e => e.label === 'Prograde burn')).toBe(true);

    // At now = 100, deadline is reached
    const noticesDue = helper.syncClock(clock, sessionObj, 100, events);
    expect(noticesDue.length).toBe(1);
    expect(noticesDue[0]!.id).toBe('burn-1');
    expect(noticesDue[0]!.missed).toBe(false);

    clock.dispose();
  } finally {
    candidate.dispose();
  }
});

it('manages Alarms dock panel updates and countdown formatting via alarm-panel example', () => {
  const burnsGuideText = readFileSync('modules/orbital-alarms/docs/players/burns.json', 'utf8');
  const alarmsGuideText = readFileSync('modules/alarm-panel/docs/players/alarms.json', 'utf8');
  const mockDoc: any = {
    createElement: (tag: string) => createMockEl(tag),
  };
  const mockContainer = createMockEl('div');
  mockContainer.ownerDocument = mockDoc;

  const graph = registry([
    [orbitalAlarmsDescriptor, orbitalAlarmsInitialize, orbitalAlarmsGuide, { 'docs/players/burns.json': burnsGuideText }],
    [alarmPanelDescriptor, alarmPanelInitialize, alarmPanelGuide, { 'docs/players/alarms.json': alarmsGuideText }],
    [alarmPanelExampleDescriptor, alarmPanelExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([
    orbitalAlarmsDescriptor,
    alarmPanelDescriptor,
    alarmPanelExampleDescriptor,
  ], {
    'flight.alarms': 'spacelab.orbital-alarms',
    'flight.alarm-catalogue': 'spacelab.orbital-alarms',
    'view.alarms': 'spacelab.alarm-panel',
    'example.alarm-panel': 'example.alarm-panel',
  }), 'browser');
  try {
    const helper = candidate.providedService(ALARM_PANEL_HELPER);
    const mockWindowChrome: any = {
      body: createMockEl('div'),
      isOpen: true,
      onChange: vi.fn(),
      dispose: vi.fn(),
    };
    const mockWindows: any = {
      create: vi.fn(() => mockWindowChrome),
    };
    const mockShell: any = {
      addInstrument: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const sessionObj = {};
    const panel = helper.createPanel({
      container: mockContainer,
      windows: mockWindows,
      shell: mockShell,
      session: () => sessionObj,
    });
    expect(mockWindows.create).toHaveBeenCalled();
    expect(mockShell.addInstrument).toHaveBeenCalled();
    helper.updatePanel(panel);
    panel.dispose();
  } finally {
    candidate.dispose();
  }
});

it('queries transfer capabilities and runs bounded trajectory search via transfer-planner example', () => {
  const flightGuideText = readFileSync('modules/transfer-planner/docs/players/flight.json', 'utf8');
  const graph = registry([
    [plansDescriptor, plansInitialize, plansGuide],
    [transferPlannerDescriptor, transferPlannerInitialize, transferPlannerGuide, { 'docs/players/flight.json': flightGuideText }],
    [transferPlannerExampleDescriptor, transferPlannerExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([
    plansDescriptor,
    transferPlannerDescriptor,
    transferPlannerExampleDescriptor,
  ], {
    'flight.plans': 'spacelab.flight-plans',
    'flight.transfers': 'spacelab.transfer-planner',
    'example.transfer-planner': 'example.transfer-planner',
  }), 'node');
  try {
    const helper = candidate.providedService(TRANSFER_PLANNER_HELPER);
    const caps = helper.getCapabilities();
    expect(caps.relationships).toContain('same-body');

    const mockWorld: any = {
      ship: () => null,
      time: 100,
    };
    const request = {
      shipId: 'nonexistent-ship',
      destinationId: 'moon',
      periapsisAltitude: 50000,
      apoapsisAltitude: 50000,
    };
    const result = helper.runSearch(mockWorld, request, 10);
    expect(result.options).toEqual([]);
    expect(result.reason.length).toBeGreaterThan(0);
  } finally {
    candidate.dispose();
  }
});

it('computes orbital elements and validates motion services via physics-rails example', () => {
  const hostServices = engineModuleServices();
  const graph = registry([
    [physicsRailsDescriptor, physicsRailsInitialize, physicsRailsGuide],
    [physicsRailsExampleDescriptor, physicsRailsExampleInitialize],
  ], hostServices);
  const candidate = graph.prepare(profile([
    physicsRailsDescriptor,
    physicsRailsExampleDescriptor,
  ], {
    'motion': 'builtin.motion',
    'orbits': 'builtin.motion',
    'bodies': 'builtin.motion',
    'surfaces': 'builtin.motion',
    'rails': 'builtin.motion',
    'example.physics-rails': 'example.physics-rails',
  }), 'node');
  try {
    const helper = candidate.providedService(MOTION_KERNEL_HELPER);
    const diag = helper.diagnose();
    expect(diag.hasContext).toBe(true);
    expect(diag.railsCompatible).toBe(true);

    // Circular low earth orbit (r = 7000 km, v ~ 7546 m/s, mu = 3.986e14)
    const elements = helper.computeElements(
      { position: { x: 7000000, y: 0 }, velocity: { x: 0, y: 7546 } },
      3.986004418e14,
    );
    expect(elements.kind).toBe('elliptic');
    expect(elements.periapsis).toBeGreaterThan(6000000);
    expect(elements.apoapsis).toBeGreaterThan(6000000);
  } finally {
    candidate.dispose();
  }
});

it('queries vehicle definitions and trainer defaults via vehicle-trainer example', () => {
  const flightGuideText = readFileSync('modules/vehicle-trainer/docs/players/flight.json', 'utf8');
  const hostServices = engineModuleServices();
  const graph = registry([
    [vehicleTrainerDescriptor, vehicleTrainerInitialize, vehicleTrainerGuide, { 'docs/players/flight.json': flightGuideText }],
    [vehicleTrainerExampleDescriptor, vehicleTrainerExampleInitialize],
  ], hostServices);
  const candidate = graph.prepare(profile([
    vehicleTrainerDescriptor,
    vehicleTrainerExampleDescriptor,
  ], {
    'example.vehicle-trainer': 'example.vehicle-trainer',
  }), 'node');
  try {
    const helper = candidate.providedService(VEHICLE_TRAINER_HELPER);
    expect(helper.defaultTrainerId).toBe('spacelab.trainer/orbit-trainer');

    const custom = helper.getCustomVehicle();
    expect(custom.id).toBe('example.vehicle-trainer/trainer-scout');
    expect(custom.name).toBe('Scout trainer variant');
    expect(custom.handling?.acceleration).toBe(25);
    expect(custom.handling?.turnRate).toBe(3.5);
  } finally {
    candidate.dispose();
  }
});

it('reads and writes universe save files via universe-files example', async () => {
  const graph = registry([
    [universeFilesDescriptor, universeFilesInitialize, universeFilesGuide],
    [universeFilesExampleDescriptor, universeFilesExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([
    universeFilesDescriptor,
    universeFilesExampleDescriptor,
  ], {
    'universe.files': 'spacelab.universe-files',
    'example.universe-files': 'example.universe-files',
  }), 'browser');
  try {
    const helper = candidate.providedService(UNIVERSE_FILES_HELPER);
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const blob = new Blob([data]);
    const read = await helper.readFile(blob);
    expect(read).toEqual(data);

    const oversizedBlob = { size: 65 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob;
    await expect(helper.readFile(oversizedBlob)).rejects.toThrow('at most 64 MiB');

    const clicked: string[] = [];
    const fakeAnchor: any = {
      href: '',
      download: '',
      click: () => { clicked.push(fakeAnchor.download); },
      remove: () => {},
    };
    const fakeDoc = {
      createElement: (tag: string) => (tag === 'a' ? fakeAnchor : {}),
      body: { append: () => {} },
    };
    const prevDoc = globalThis.document;
    try {
      (globalThis as unknown as { document: unknown }).document = fakeDoc;
      await helper.writeFile('test.spaceuniverse', data);
      expect(clicked).toContain('test.spaceuniverse');
    } finally {
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    }
  } finally {
    candidate.dispose();
  }
});

it('orchestrates cancellable save and load workflows via universe-saves example', async () => {
  const hostServices = [...engineModuleServices(), universeSaveFormatService];
  const graph = registry([
    [universeSavesDescriptor, universeSavesInitialize, universeSavesGuide],
    [universeSavesExampleDescriptor, universeSavesExampleInitialize],
  ], hostServices);
  const candidate = graph.prepare(profile([
    universeSavesDescriptor,
    universeSavesExampleDescriptor,
  ], {
    'universe.saves': 'spacelab.universe-saves',
    'example.universe-saves': 'example.universe-saves',
  }), 'node');
  const world = new World(DEFAULT_UNIVERSE);
  try {
    const helper = candidate.providedService(UNIVERSE_SAVES_HELPER);
    let identity = {};
    let currentWorld: any = world;
    const restoredData: any[] = [];
    const commands = helper.createCommands({
      current: () => ({ identity, world: currentWorld, canSave: true, canLoad: true }),
      restore: async (raw, _signal, guard) => {
        guard();
        restoredData.push(raw);
      },
    });

    let savedFilename = '';
    let savedBytes: Uint8Array<ArrayBuffer> | undefined;
    const saveResult = await commands.save(async (name, bytes) => {
      savedFilename = name;
      savedBytes = bytes;
    });

    expect(savedFilename).toMatch(/\.spaceuniverse$/);
    expect(saveResult.universe.id).toBe(world.universe.id);
    expect(savedBytes).toBeDefined();

    await commands.load(async () => savedBytes!);
    expect(restoredData.length).toBe(1);

    commands.dispose();
    await expect(commands.save(async () => {})).rejects.toThrow('disposed');
  } finally {
    world.dispose();
    candidate.dispose();
  }
});

it('mounts Save and Load universe controls via universe-save-controls example', async () => {
  const graph = registry([
    [universeFilesDescriptor, universeFilesInitialize, universeFilesGuide],
    [universeSaveControlsDescriptor, universeSaveControlsInitialize, universeSaveControlsGuide],
    [universeSaveControlsExampleDescriptor, universeSaveControlsExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([
    universeFilesDescriptor,
    universeSaveControlsDescriptor,
    universeSaveControlsExampleDescriptor,
  ], {
    'universe.files': 'spacelab.universe-files',
    'ui.universe-saves': 'spacelab.universe-save-controls',
    'example.universe-save-controls': 'example.universe-save-controls',
  }), 'browser');
  try {
    const helper = candidate.providedService(UNIVERSE_SAVE_CONTROLS_HELPER);
    const listeners = new Map<string, Function>();
    const saveBtn: any = {
      ...createMockEl('button'),
      addEventListener: (event: string, cb: Function) => listeners.set(`save-${event}`, cb),
    };
    const loadBtn: any = {
      ...createMockEl('button'),
      addEventListener: (event: string, cb: Function) => listeners.set(`load-${event}`, cb),
    };
    const fileInput: any = {
      ...createMockEl('input'),
      files: [],
      addEventListener: (event: string, cb: Function) => listeners.set(`file-${event}`, cb),
    };
    const root = createMockEl('div');

    const saveCalls: string[] = [];
    const mockCommands: any = {
      save: vi.fn(async (_write, _signal) => {
        saveCalls.push('save');
        return { format: 'space-sim-world' };
      }),
      load: vi.fn(async (_read, _signal) => {}),
      dispose: vi.fn(),
    };

    let savedCalled = false;
    const controls = helper.mountControls({
      root,
      commands: mockCommands,
      controls: { save: saveBtn, load: loadBtn, file: fileInput },
      saved: () => { savedCalled = true; },
    });

    expect(controls.busy).toBe(false);

    await listeners.get('save-click')?.();
    expect(saveCalls).toContain('save');
    expect(savedCalled).toBe(true);

    controls.dispose();
  } finally {
    candidate.dispose();
  }
});

it('manages atomic world persistence and backups via universe-server-storage example', async () => {
  const hostServices = [universeDiskService];
  const graph = registry([
    [universeServerStorageDescriptor, universeServerStorageInitialize, universeServerStorageGuide],
    [universeServerStorageExampleDescriptor, universeServerStorageExampleInitialize],
  ], hostServices);
  const candidate = graph.prepare(profile([
    universeServerStorageDescriptor,
    universeServerStorageExampleDescriptor,
  ], {
    'universe.server-storage': 'spacelab.universe-server-storage',
    'example.universe-server-storage': 'example.universe-server-storage',
  }), 'node');
  const directory = await mkdtemp(join(tmpdir(), 'universe-example-store-'));
  try {
    const helper = candidate.providedService(UNIVERSE_SERVER_STORAGE_HELPER);
    const store = helper.createStore({
      directory,
      keepBackups: 2,
      restore: raw => raw,
      configurationError: () => false,
    });

    const mockSave: any = {
      format: 'space-sim-world',
      universe: { id: 'test-universe' },
      ships: [],
    };

    await store.save(mockSave);
    const loaded = await store.load();
    expect(loaded).toBeDefined();
    expect(loaded?.loaded).toMatchObject({ universe: { id: 'test-universe' } });

    const backupPath = await store.backup();
    expect(backupPath).toBeDefined();
    expect(typeof backupPath).toBe('string');

    const backups = await store.backupFiles();
    expect(backups.length).toBeGreaterThan(0);

    store.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
    candidate.dispose();
  }
});

it('provides planet appearance designer and query overrides via planet-designer example', async () => {
  const hostServices = engineModuleServices();
  const graph = registry([
    [planetDesignerDescriptor, planetDesignerInitialize, planetDesignerGuide, planetDesignerAssets],
    [planetDesignerExampleDescriptor, planetDesignerExampleInitialize],
  ], hostServices);
  const candidate = graph.prepare(profile([
    planetDesignerDescriptor,
    planetDesignerExampleDescriptor,
  ], {
    'ui.planet-designer': 'spacelab.planet-designer',
    'example.planet-designer': 'example.planet-designer',
  }), 'browser');
  const world = new World(DEFAULT_UNIVERSE);
  try {
    const helper = candidate.providedService(PLANET_DESIGNER_HELPER);
    expect(helper).toBeDefined();

    const mockDoc: any = {
      defaultView: {
        ...globalThis,
        AbortController: globalThis.AbortController,
        cancelAnimationFrame: vi.fn(),
        requestAnimationFrame: vi.fn(),
      },
      createElement: (tag: string) => {
        const el = createMockEl(tag);
        el.ownerDocument = mockDoc;
        el.closest = () => null;
        if (tag === 'select') {
          el.options = [];
          el.replaceChildren = vi.fn((...children: any[]) => {
            el.options = children;
            el.childNodes = children;
          });
        }
        return el;
      },
      head: { append: vi.fn() },
    };
    const mockRoot = mockDoc.createElement('div');

    const designer = helper.createDesigner({
      root: mockRoot,
      world: () => world,
      current: () => 'earth',
      download: () => {},
      confirm: () => true,
    });

    const body = world.system.getAllBodies()[0]!;
    const appearance = designer.appearanceFor(world, body);
    expect(appearance).toBeDefined();

    designer.refresh();
    designer.open();
    designer.dispose();
  } finally {
    world.dispose();
    candidate.dispose();
  }
});

const uiAssets: Record<string, string> = {
  'assets/windows.css': readFileSync('modules/ui-windows/assets/windows.css', 'utf8'),
  'assets/shell.css': readFileSync('modules/ui-shell/assets/shell.css', 'utf8'),
  'assets/mod-menu.css': readFileSync('modules/mod-menu/assets/mod-menu.css', 'utf8'),
  'assets/manual.css': readFileSync('modules/manual/assets/manual.css', 'utf8'),
};

function uiDocument(): any {
  const doc: any = {
    defaultView: {
      ...globalThis,
      AbortController: globalThis.AbortController,
      cancelAnimationFrame: vi.fn(),
      requestAnimationFrame: vi.fn(),
      ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    },
    createElement: (tag: string) => {
      const el = createMockEl(tag);
      el.ownerDocument = doc;
      el.closest = () => null;
      if (tag === 'select') {
        el.options = [];
        el.replaceChildren = (...children: any[]) => { el.options = children; el.childNodes = children; };
      }
      return el;
    },
    head: { append: vi.fn() },
    getElementById: vi.fn(),
    createComment: () => ({ replaceWith: vi.fn(), remove: vi.fn() }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  return doc;
}

it('opens a movable notice window via ui-windows example', () => {
  const graph = registry([
    [windowsDescriptor, windowsInitialize, windowsGuide, uiAssets],
    [windowsExampleDescriptor, windowsExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([windowsDescriptor, windowsExampleDescriptor], {
    'ui.windows': 'spacelab.ui-windows',
    'example.ui-windows': 'example.ui-windows',
  }), 'browser');
  try {
    const container = uiDocument().createElement('div');
    const notice = candidate.providedService(NOTICE_WINDOWS).create(container, 'notice', 'Notice');
    expect(notice.isOpen).toBe(false);
    notice.open();
    expect(notice.isOpen).toBe(true);
    notice.dispose();
  } finally {
    candidate.dispose();
  }
});

it('wraps one panel in a shell via ui-shell example', () => {
  const graph = registry([
    [windowsDescriptor, windowsInitialize, windowsGuide, uiAssets],
    [shellDescriptor, shellInitialize, shellGuide, uiAssets],
    [shellExampleDescriptor, shellExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([windowsDescriptor, shellDescriptor, shellExampleDescriptor], {
    'ui.windows': 'spacelab.ui-windows',
    'ui.shell': 'spacelab.ui-shell',
    'example.ui-shell': 'example.ui-shell',
  }), 'browser');
  try {
    const doc = uiDocument();
    const viewport = doc.createElement('div');
    const content = doc.createElement('div');
    content.before = vi.fn();
    const shell = candidate.providedService(SINGLE_PANEL_SHELL).create(viewport, content, vi.fn(), vi.fn());
    expect(shell.isOpen).toBe(false);
    shell.dispose();
  } finally {
    candidate.dispose();
  }
});

it('mounts the module picker via mod-menu example', () => {
  const graph = registry([
    [modMenuDescriptor, modMenuInitialize, modMenuGuide, uiAssets],
    [modMenuExampleDescriptor, modMenuExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([modMenuDescriptor, modMenuExampleDescriptor], {
    'ui.mod-menu': 'spacelab.mod-menu',
    'example.mod-menu': 'example.mod-menu',
  }), 'browser');
  try {
    const root = uiDocument().createElement('div');
    const port: any = {
      state: () => ({ installed: [], selected: {}, providers: {}, capabilities: {}, settings: {}, activeDigests: [], editable: true, busy: false }),
      compatible: () => [],
      select: vi.fn(), version: vi.fn(), setting: vi.fn(), capability: vi.fn(), provider: vi.fn(),
      includeRequired: vi.fn(), removeDependents: vi.fn(), cancel: vi.fn(),
      apply: async () => {}, remove: async () => {},
    };
    const view = candidate.providedService(MODULE_PICKER).mount(root, port);
    view.refresh();
    view.dispose();
  } finally {
    candidate.dispose();
  }
});

it('publishes and withdraws a guide via manual example', () => {
  const graph = registry([
    [windowsDescriptor, windowsInitialize, windowsGuide, uiAssets],
    [manualDescriptor, manualInitialize, manualGuide, uiAssets],
    [manualExampleDescriptor, manualExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([windowsDescriptor, manualDescriptor, manualExampleDescriptor], {
    'ui.windows': 'spacelab.ui-windows',
    'ui.window-content': 'spacelab.ui-windows',
    'ui.manual': 'spacelab.manual',
    'example.manual': 'example.manual',
  }), 'browser');
  try {
    const manual = candidate.providedService(MANUAL_READER);
    const lease = candidate.providedService(GUIDE_PUBLISHER).publish('example.manual/help', 'Example help', 'Read this first.');
    expect(manual.guides('creators').some(page => page.id === 'example.manual/help')).toBe(true);
    expect(() => candidate.providedService(GUIDE_PUBLISHER).publish('example.manual/help', 'Again', 'Duplicate.')).toThrow('duplicate');
    lease.dispose();
    expect(manual.guides('creators').some(page => page.id === 'example.manual/help')).toBe(false);
  } finally {
    candidate.dispose();
  }
});

it('records and reads scoped diagnostics via logging example', () => {
  const graph = registry([
    [loggingDescriptor, loggingInitialize, loggingGuide],
    [loggingExampleDescriptor, loggingExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([loggingDescriptor, loggingExampleDescriptor], {
    'diagnostics.logs': 'spacelab.logging',
    'example.logging': 'example.logging',
  }), 'node');
  try {
    const audit = candidate.providedService(AUDIT_LOG);
    audit.note('example.started', 'Started');
    audit.note('', 'Dropped: empty event name');
    const entries = audit.recent();
    expect(entries.map(entry => entry.event)).toEqual(['example.started']);
    expect(entries[0]).toMatchObject({ level: 'info', message: 'Started', module: { id: 'example.logging' } });
    expect(Object.isFrozen(entries[0])).toBe(true);
  } finally {
    candidate.dispose();
  }
});

it('times frames and summarizes them via profiler example', () => {
  const graph = registry([
    [profilerDescriptor, profilerInitialize, profilerGuide],
    [profilerExampleDescriptor, profilerExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([profilerDescriptor, profilerExampleDescriptor], {
    'diagnostics.profiler': 'spacelab.profiler',
    'example.profiler': 'example.profiler',
  }), 'browser');
  try {
    const timer = candidate.providedService(FRAME_TIMER).create();
    for (let i = 0; i < 3; i++) timer.frame(16.7, ['physics', 'hud']);
    const summary = timer.profiler.summary();
    expect(summary.frames).toBe(3);
    expect(summary.sections.physics.max).toBeGreaterThanOrEqual(0);
    timer.profiler.dispose();
  } finally {
    candidate.dispose();
  }
});

const academyAssets: Record<string, string> = {
  'assets/academy.css': readFileSync('modules/academy-ui/assets/academy.css', 'utf8'),
};

const orbitalLessonsAssets: Record<string, string> = {
  'docs/players/course.json': readFileSync('modules/orbital-lessons/docs/players/course.json', 'utf8'),
};

it('evaluates timed scalar holds, knowledge checks and versioned progress via tutorial-runner example', () => {
  const graph = registry([
    [tutorialRunnerDescriptor, tutorialRunnerInitialize, tutorialRunnerGuide],
    [tutorialRunnerExampleDescriptor, tutorialRunnerExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([tutorialRunnerDescriptor, tutorialRunnerExampleDescriptor], {
    'learning.runner': 'spacelab.tutorial-runner',
    'example.tutorial-runner': 'example.tutorial-runner',
  }), 'browser');
  try {
    const helper = candidate.providedService(TUTORIAL_RUNNER_HELPER);
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); },
    };
    const runner = helper.create('course/v1/seat-0', storage);
    const identity = {};
    const lesson = {
      id: 'orbit-hold',
      version: 2,
      title: 'Hold safe orbit',
      level: 'First flights' as const,
      introduction: 'Keep coasting.',
      deeper: 'Two-body Keplerian motion.',
      steps: [
        {
          title: 'Hold 2 s',
          instruction: 'Coast safely.',
          hint: 'Cut thrust.',
          conditions: [{ field: 'safe', operator: 'eq' as const, value: true }],
          holdSeconds: 2,
        },
        {
          title: 'Check',
          instruction: 'What keeps the ship turning?',
          hint: 'Central gravity.',
          question: {
            choices: ['Hidden thrust', 'Gravity'],
            correct: 1,
            explanation: 'Gravity bends the trajectory.',
          },
        },
      ],
    };
    expect(() => helper.evaluate(runner, { ...lesson, steps: [] }, [{ identity, time: 0, paused: false, values: { safe: true } }])).toThrow('Invalid lesson');
    helper.evaluate(runner, lesson, [
      { identity, time: 0, paused: false, values: { safe: true } },
      { identity, time: 1, paused: false, values: { safe: true } },
      { identity, time: 1, paused: true, values: { safe: true } },
      { identity, time: 3, paused: false, values: { safe: true } },
    ]);
    expect(runner.step).toBe(1);
    expect(runner.answer(0)).toBe(false);
    expect(runner.finished).toBe(false);
    expect(runner.answer(1)).toBe(true);
    expect(runner.finished).toBe(true);
    expect(runner.completed.has('orbit-hold@2')).toBe(true);
    expect(JSON.parse(saved.get('course/v1/seat-0') ?? '[]')).toEqual(['orbit-hold@2']);
    runner.dispose();
    expect(() => runner.start(lesson, { identity, time: 0, paused: false, values: { safe: true } })).toThrow('disposed');
  } finally {
    candidate.dispose();
  }
});

it('queries orbital course lessons, practice setups and target ratios via orbital-lessons example', () => {
  const graph = registry([
    [orbitalLessonsDescriptor, orbitalLessonsInitialize, orbitalLessonsGuide, orbitalLessonsAssets],
    [orbitalLessonsExampleDescriptor, orbitalLessonsExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([orbitalLessonsDescriptor, orbitalLessonsExampleDescriptor], {
    'learning.orbital-course': 'spacelab.orbital-lessons',
    'example.orbital-lessons': 'example.orbital-lessons',
  }), 'browser');
  try {
    const helper = candidate.providedService(ORBITAL_COURSE_HELPER);
    expect(helper.course.id).toBe('spacelab.orbital-academy');
    expect(helper.course.lessons).toHaveLength(24);
    expect(helper.byLevel('First flights').length).toBeGreaterThan(0);
    expect(helper.byLevel('Orbital skills').length).toBeGreaterThan(0);
    expect(helper.byLevel('Advanced').length).toBeGreaterThan(0);
    const transfer = helper.find('transfer');
    expect(transfer?.practice).toEqual({ kind: 'circle', bodyId: 'planet', low: 2, high: 2 });
    expect(transfer?.target).toEqual({ low: 2, high: 4 });
    expect(helper.find('nonexistent')).toBeUndefined();
    expect(candidate.contributions('guide').map(entry => entry.id)).toEqual([
      'spacelab.orbital-lessons/academy',
      'spacelab.orbital-lessons/lessons',
    ]);
  } finally {
    candidate.dispose();
  }
});

it('mounts the Academy flight panel, triggers explicit practice and draws target orbit overlays via academy-ui example', () => {
  const graph = registry([
    [tutorialRunnerDescriptor, tutorialRunnerInitialize, tutorialRunnerGuide],
    [orbitalLessonsDescriptor, orbitalLessonsInitialize, orbitalLessonsGuide, orbitalLessonsAssets],
    [academyUiDescriptor, academyUiInitialize, academyUiGuide, academyAssets],
    [academyUiExampleDescriptor, academyUiExampleInitialize],
  ]);
  expect(() => graph.prepare(profile([academyUiDescriptor, orbitalLessonsDescriptor], {
    'learning.orbital-course': 'spacelab.orbital-lessons',
    'learning.academy': 'spacelab.academy-ui',
  }), 'browser')).toThrow('learning.runner');
  const candidate = graph.prepare(profile([
    tutorialRunnerDescriptor,
    orbitalLessonsDescriptor,
    academyUiDescriptor,
    academyUiExampleDescriptor,
  ], {
    'learning.runner': 'spacelab.tutorial-runner',
    'learning.orbital-course': 'spacelab.orbital-lessons',
    'learning.academy': 'spacelab.academy-ui',
    'example.academy-ui': 'example.academy-ui',
  }), 'browser');
  try {
    const buttons = new Map<string, () => void>();
    let selectChange: (() => void) | undefined;
    const makeEl = (tag: string): any => {
      const el = createMockEl(tag);
      el.ownerDocument = doc;
      el.options = [];
      let text = '';
      Object.defineProperty(el, 'textContent', {
        get: () => text,
        set: (v: string) => { text = v; },
      });
      el.append = (...nodes: any[]) => {
        for (const node of nodes) {
          el.childNodes.push(node);
          if (tag === 'select' && node?.tagName === 'OPTGROUP') {
            el.options.push(...node.childNodes);
          }
        }
      };
      el.addEventListener = (event: string, fn: () => void) => {
        if (tag === 'button' && event === 'click') buttons.set(text, fn);
        if (tag === 'select' && event === 'change') selectChange = fn;
      };
      return el;
    };
    const doc: any = {
      ...uiDocument(),
      createElement: (tag: string) => makeEl(tag),
      createElementNS: (_ns: string, tag: string) => makeEl(tag),
      createTextNode: (text: string) => ({ textContent: text }),
    };
    const container = doc.createElement('div');
    const windowBody = doc.createElement('div');
    const windowClose = vi.fn();
    const dockDispose = vi.fn();
    const practiced: unknown[] = [];
    const identity = {};
    let simTime = 0;
    const readFlight = () => ({
      identity,
      time: simTime,
      paused: false,
      state: {
        time: simTime,
        position: { x: 1024, y: 0 },
        velocity: { x: 0, y: 300 },
        heading: Math.PI / 2,
        throttle: 0.5,
        status: 'flying' as const,
        revision: 1,
      },
      engine: false,
      body: { id: 'planet', name: 'Primus', radius: 512, mu: 5e7, surfaceTop: 520, soi: 20000 },
      orbit: {
        energy: -20000,
        angularMomentum: 307200,
        eccentricityVector: { x: 0, y: 0 },
        eccentricity: 0,
        semilatusRectum: 1024,
        periapsis: 1024,
        apoapsis: 1024,
        semiMajorAxis: 1024,
        period: 21,
        periapsisAngle: 0,
        kind: 'elliptic' as const,
        radial: false,
      },
      clearance: 512,
      analytic: true,
      prediction: 'closed',
      plannedNodes: 0,
      plannedDeltaV: 0,
      alarms: 0,
    });
    const panel = candidate.providedService(ACADEMY_UI_HELPER).mount({
      container,
      windows: {
        create: () => ({
          id: 'academy',
          title: 'Orbital Academy',
          icon: 'manual',
          element: doc.createElement('section'),
          body: windowBody,
          isOpen: true,
          pinned: true,
          isFront: true,
          open: vi.fn(),
          close: vi.fn(),
          toggle: vi.fn(),
          raise: vi.fn(),
          setPinned: vi.fn(),
          onChange: () => ({ dispose() {} }),
          dispose: windowClose,
        }),
      },
      shell: { addInstrument: () => ({ dispose: dockDispose }) },
      learnerKey: 'seat-0',
      read: readFlight,
      bindings: () => 'Controls · Engine: Space',
      practice: setup => { practiced.push(setup); },
    });
    // Select "coasting", which defines target orbit ratios.
    const selectEl = windowBody.childNodes[0].childNodes.find((n: any) => n.tagName === 'SELECT');
    selectEl.value = 'coasting';
    selectChange?.();
    buttons.get('Load practice setup')?.();
    expect(practiced).toHaveLength(1);
    simTime = 1;
    panel.update(0.2);
    const view: any = { body: { id: 'planet', position: { x: 10, y: 20 } } };
    const firstOverlay = panel.draw(view);
    const secondOverlay = panel.draw(view);
    expect(firstOverlay.length).toBeGreaterThan(0);
    expect(firstOverlay[0]).toBe(secondOverlay[0]);
    panel.dispose();
    expect(dockDispose).toHaveBeenCalledTimes(1);
    expect(windowClose).toHaveBeenCalledTimes(1);
    expect(panel.draw(view)).toEqual([]);
  } finally {
    candidate.dispose();
  }
});

it('mounts scoped flight sound controls, deduplicates contacts and restores borrowed DOM on disposal via audio-controls example', () => {
  const graph = registry([
    [audioControlsDescriptor, audioControlsInitialize, audioControlsGuide],
    [audioControlsExampleDescriptor, audioControlsExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([audioControlsDescriptor, audioControlsExampleDescriptor], {
    'audio.flight-controls': 'spacelab.audio-controls',
    'example.audio-controls': 'example.audio-controls',
  }), 'browser');
  try {
    const helper = candidate.providedService(AUDIO_CONTROLS_HELPER);
    const doc = uiDocument();
    doc.hidden = false;
    doc.defaultView.addEventListener = vi.fn();
    doc.defaultView.removeEventListener = vi.fn();
    const docListeners = new Map<string, (event: any) => void>();
    doc.addEventListener = (type: string, fn: (event: any) => void) => { docListeners.set(type, fn); };
    const subElements = new Map<string, any>();
    const root = doc.createElement('div');
    const originalChild = doc.createElement('span');
    root.childNodes = [originalChild];
    root.replaceChildren = (...nodes: any[]) => { root.childNodes = [...nodes]; };
    root.querySelector = (sel: string) => {
      if (!subElements.has(sel)) {
        const el = doc.createElement(sel.endsWith('-volume') ? 'input' : sel.endsWith('-toggle') ? 'button' : 'p');
        el.valueAsNumber = 50;
        subElements.set(sel, el);
      }
      return subElements.get(sel);
    };

    expect(() => helper.mount({ root, prefix: '1invalid' })).toThrow('Invalid audio control ID prefix');
    expect(root.childNodes).toEqual([originalChild]);

    const cues: string[] = [];
    const thrusts: number[] = [];
    let outputDisposed = false;
    const mockProvider = {
      id: 'mock.audio',
      version: '1.0.0',
      label: 'Mock Audio',
      create: () => ({
        resume: async () => {},
        suspend: () => {},
        setVolume: () => {},
        setThrust: (level: number) => { thrusts.push(level); },
        play: (cue: string) => { cues.push(cue); },
        dispose: () => { outputDisposed = true; },
      }),
    };

    const control = helper.mount({ root, prefix: 'flight-sound' }, mockProvider);
    docListeners.get('pointerdown')?.({ isTrusted: true });
    control.contact(10, 'land', true);
    control.contact(10, 'land', true);
    control.contact(12, 'splash', true);
    expect(cues).toEqual(['land', 'splash']);
    control.reset(20);
    control.contact(15, 'crash', true);
    expect(cues).toEqual(['land', 'splash']);
    control.update(0.75, true);
    expect(thrusts).toContain(0.75);
    control.dispose();
    expect(outputDisposed).toBe(true);
    expect(root.childNodes).toEqual([originalChild]);
  } finally {
    candidate.dispose();
  }
});

it('creates procedural audio outputs, clamps levels and schedules Web Audio voices via audio-procedural example', async () => {
  const graph = registry([
    [audioProceduralDescriptor, audioProceduralInitialize, audioProceduralGuide],
    [audioProceduralExampleDescriptor, audioProceduralExampleInitialize],
  ]);
  const candidate = graph.prepare(profile([audioProceduralDescriptor, audioProceduralExampleDescriptor], {
    'audio.procedural': 'builtin.audio',
    'example.audio-procedural': 'example.audio-procedural',
  }), 'browser');
  try {
    const helper = candidate.providedService(AUDIO_PROCEDURAL_HELPER);
    expect(helper.synth.id).toBe('builtin.audio');
    const startedVoices: number[] = [];
    let closed = false;
    class MockBufferSource {
      buffer: any = null;
      loop = false;
      onended: (() => void) | null = null;
      connect(next: any) { return next; }
      start(when = 0) { startedVoices.push(when); }
      stop() {}
      disconnect() {}
    }
    vi.stubGlobal('AudioBufferSourceNode', MockBufferSource);
    vi.stubGlobal('AudioContext', class {
      state = 'running';
      currentTime = 1;
      sampleRate = 8000;
      destination = {};
      async resume() { this.state = 'running'; }
      async suspend() { this.state = 'suspended'; }
      async close() { this.state = 'closed'; closed = true; }
      createGain() {
        return {
          gain: { value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect(next: any) { return next; },
          disconnect: vi.fn(),
        };
      }
      createBiquadFilter() {
        return {
          type: 'lowpass',
          frequency: { value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect(next: any) { return next; },
          disconnect: vi.fn(),
        };
      }
      createOscillator() {
        return {
          type: 'sine',
          frequency: { value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          onended: null,
          connect(next: any) { return next; },
          start: vi.fn((when = 0) => { startedVoices.push(when); }),
          stop: vi.fn(),
          disconnect: vi.fn(),
        };
      }
      createBuffer(_channels: number, length: number) {
        const data = new Float32Array(length);
        return { getChannelData: () => data };
      }
      createBufferSource() { return new MockBufferSource(); }
    });

    const output = helper.createOutput(0.5, 0.8);
    // Before resume(), no AudioContext is allocated.
    expect(startedVoices).toHaveLength(0);
    await output.resume();
    // 2 continuous sources (noise + rumble) start on initialization.
    expect(startedVoices).toHaveLength(2);
    helper.triggerCue(output, 'land', 0.3);
    expect(startedVoices).toHaveLength(3);
    output.suspend();
    output.dispose();
    expect(closed).toBe(true);
    helper.synth.dispose();
    expect(() => helper.createOutput()).toThrow('disposed');
  } finally {
    vi.unstubAllGlobals();
    candidate.dispose();
  }
});

it('generates reference pages for all 53 public game-api stems, enforces JSDoc on public exports and splits oversized topics', () => {
  const result = generateReference();
  const { bundle, text, state } = result;
  expect(checkReference(result)).toEqual([]);
  expect(state.api.publicDeclarations.size).toBeGreaterThanOrEqual(610);
  expect(state.api.namespaces.get('deterministicMath')).toBe('math');

  const gameApiPages = bundle.pages.filter((page: { id: string }) => page.id.startsWith('api-reference/game-api/'));
  expect(gameApiPages).toHaveLength(53);
  expect(gameApiPages.some((page: { id: string }) => page.id === 'api-reference/game-api/math')).toBe(true);
  expect(text).toContain('deterministicMath.sin');
  for (const page of bundle.pages) {
    expect(() => captureDocument({ blocks: page.blocks })).not.toThrow();
  }

  const split = generateReference(state, { pageLimit: { blocks: 160, bytes: 65536 } });
  const platformPages = split.bundle.pages.filter((page: { id: string }) =>
    page.id === 'api-reference/game-api/platform' || page.id.startsWith('api-reference/game-api/platform/'));
  expect(platformPages.map((page: { id: string }) => page.id)).toEqual([
    'api-reference/game-api/platform',
    'api-reference/game-api/platform/2',
  ]);
  for (const page of platformPages) {
    expect(() => captureDocument({ blocks: page.blocks })).not.toThrow();
  }

  const firstDecl = state.api.publicDeclarations.values().next().value!;
  const savedDoc = firstDecl.doc;
  try {
    firstDecl.doc = '';
    expect(checkReference(result)).toContain(`${firstDecl.path}: public declaration ${firstDecl.name} is missing a leading JSDoc comment`);
  } finally {
    firstDecl.doc = savedDoc;
  }
}, 30000);


