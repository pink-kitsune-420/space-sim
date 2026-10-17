import { createBuiltinRegistry, loadInstalledWorld, DEFAULT_PROFILE, MAX_MODULE_BYTES, exportDataModule, universeDataModule, validateDataModule, type DataModule } from '../../../packages/modules/src/index';
import { GAME_EXAMPLES, PRESENTATION_EXAMPLES, exampleProfile } from '../../../examples/modules/index';
import { moduleLibrary } from './module-library';
import { ModuleManager } from './module-manager';
import { LabManager } from './lab-manager';
import { Workspace } from './workspace';
import { artifactModules, validatePackage, type GamePackage } from '../../../packages/game-library/src/archive';
import { createPresentationRegistry, presentationProfile } from '../../../packages/modules/src/browser';
import builtinGame from '../../../games/space-sim/game.json' with { type: 'json' };
import universeCatalog from '../../../games/space-sim/universes/catalog.json';
import { encodeUniverse, decodeUniverse } from '../../../packages/game-library/src/universe';
import { MAX_ARCHIVE_BYTES } from '../../../packages/game-library/src/compression';
import { parseModuleImport, type ModuleBundle } from './modules';
import { bindFlightInput } from './input';
import {
  ACTION_DEFINITIONS, buildKeyLookup, formatKeyCode, isFlightAction, loadKeybindings,
  resetKeybindings, saveKeybindings, type ActionId, type KeyBindings,
} from './input-config';
import { GamepadManager } from './gamepad';
import { TouchControlsManager, type TouchMode } from './touch-controls';
import { builtinUniverses, createLocalWorld, prepareLocalWorld, requestedModules, worldModules, rememberWorldModules, environment } from './startup';
import { Presentation, presentationSnapshot } from './presentation';
import { CameraController } from './camera';
import { CommandBar } from './commands';
import { cache, shown, element, show, download, downloadBytes, message } from './ui';
import { Prediction } from './prediction';
import './style.css';
import {
  DEFAULT_UNIVERSE, IDLE, MODEL, STEP,
  magnitude, querySurface, nextWarpFactor,
  type Controls, type ResolvedBody, type State,
  type UniverseDefinition, type Vec, type SurfaceContactEvent
} from '../../../packages/sim-core/src/index';
import { cleanName, type World, type Ship, type WorldEvent } from '../../../packages/sim-core/src/world';
import { MAX_PLAYER_NAME, saveWorld, type SavedPlayer } from '../../../packages/sim-core/src/save';
import { ClientSession } from '../../../packages/net/src/client';
import type { Connection } from '../../../packages/net/src/connection';
import { connectWebSocket, serverUrl } from '../../../packages/net/src/websocket';
import { OCEAN_UNIVERSE, TERRAIN_UNIVERSE } from '../../../packages/scenarios/builtin';
import { interpolateState, type Camera, type RenderShip } from '../../../packages/render-2d/src/index';
import type { CommandExtension, PresentationSnapshot } from '../../../packages/game-api/src/index';
import { Profiler, createRows } from './profiler';
import { FleetView } from './fleet-view';
import { STRESS_OWNER, STRESS_ROCK_PREFIX, clearStress, populateStress } from '../../../packages/scenarios/stress';
import { LocalSession, RemoteSession, SessionError, type GameSession } from './session';
import { rememberToken, saveName, savedName, tokenFor } from './identity';
import { answerInvite, createInvite, isInviteCode, type Invite, type Reply } from './webrtc';

let canvas = element<HTMLCanvasElement>('flight-view');
let moduleManager: ModuleManager | undefined;
let labManager: LabManager | undefined;
const defaultGame = validatePackage(builtinGame) as GamePackage;
let activeGameInfo = { ...defaultGame.info };
/** Renderer provider, presentation modules and their hooks; started below once input exists. */
const presentation = new Presentation(canvas, {
  onCanvas: next => { canvas = next; cache.set('flight-view', next); attachCanvasListeners(next); },
  release: () => release(),
  event: (kind, detail) => profiler.event(kind, detail),
});
const profiler = new Profiler(() => presentation.rendering.renderer?.features?.flush?.());
const keys = new Set<string>();
const pointers = new Map<number, string>();
new Workspace(() => release());

const universes = builtinUniverses();
const terrainUniverse = TERRAIN_UNIVERSE;
const oceanUniverse = OCEAN_UNIVERSE;

// UI elements
const universeSelect = element<HTMLSelectElement>('universe-select');
const systemSelect = element<HTMLSelectElement>('system-select');
const loadUniverseBtn = element<HTMLButtonElement>('load-universe');
const universeFileInput = element<HTMLInputElement>('universe-file');
const exportUniverseBtn = element<HTMLButtonElement>('export-universe');
const preset = element<HTMLSelectElement>('preset');
const slider = element<HTMLInputElement>('throttle');
const pauseButton = element<HTMLButtonElement>('pause');
const warpDownButton = element<HTMLButtonElement>('warp-down');
const warpUpButton = element<HTMLButtonElement>('warp-up');
const warpFactorSpan = element<HTMLElement>('warp-factor');
let lastWarp = 1;
const cameraButton = element<HTMLButtonElement>('camera');
const orientationButton = element<HTMLButtonElement>('orientation');
const godModeToggle = element<HTMLInputElement>('god-mode');
const profilerPanel = element<HTMLElement>('profiler');
const profilerButton = element<HTMLButtonElement>('profiler-toggle');
const fullscreenButton = element<HTMLButtonElement>('fullscreen');
const controlsToggle = element<HTMLButtonElement>('controls-toggle');
const controlsDialog = element<HTMLDialogElement>('controls-dialog');
const controlsClose = element<HTMLButtonElement>('controls-close');
const tabKeyboardBtn = element<HTMLButtonElement>('tab-keyboard-btn');
const tabGamepadBtn = element<HTMLButtonElement>('tab-gamepad-btn');
const tabKeyboard = element<HTMLElement>('tab-keyboard');
const tabGamepad = element<HTMLElement>('tab-gamepad');
const keybindingsList = element<HTMLElement>('keybindings-list');
const resetKeybindingsBtn = element<HTMLButtonElement>('reset-keybindings');

const gamepadStatus = element<HTMLElement>('gamepad-status');
const gamepadEnabled = element<HTMLInputElement>('gamepad-enabled');
const gamepadDeadzone = element<HTMLInputElement>('gamepad-deadzone');
const deadzoneValue = element<HTMLElement>('deadzone-value');
const gamepadTurnAxis = element<HTMLSelectElement>('gamepad-turn-axis');
const gamepadTurnInvert = element<HTMLInputElement>('gamepad-turn-invert');
const gamepadThrottleAxis = element<HTMLSelectElement>('gamepad-throttle-axis');
const gamepadThrottleInvert = element<HTMLInputElement>('gamepad-throttle-invert');
const gamepadAxesDisplay = element<HTMLElement>('gamepad-axes-display');
const gamepadButtonsDisplay = element<HTMLElement>('gamepad-buttons-display');
const resetGamepadBtn = element<HTMLButtonElement>('reset-gamepad');
const tabTouchBtn = element<HTMLButtonElement>('tab-touch-btn');
const tabTouch = element<HTMLElement>('tab-touch');
const touchOverlayMode = element<HTMLSelectElement>('touch-overlay-mode');

let keybindings: KeyBindings = loadKeybindings();
let keyLookup = buildKeyLookup(keybindings);
const gamepadManager = new GamepadManager();
const touchControls = new TouchControlsManager();

function refreshKeyLookup(): void {
  keyLookup = buildKeyLookup(keybindings);
}

function isActionActive(action: ActionId): boolean {
  const codes = keybindings[action];
  if (!codes) return false;
  for (const c of codes) {
    if (keys.has(c)) return true;
  }
  return false;
}
const updateRows = createRows(element('profiler-rows'));
const shipList = element<HTMLUListElement>('ship-list');
const spawnButton = element<HTMLButtonElement>('spawn-ship');
const removeButton = element<HTMLButtonElement>('remove-ship');
const nameInput = element<HTMLInputElement>('player-name');
const joinInput = element<HTMLInputElement>('join-address');
const joinButton = element<HTMLButtonElement>('join-game');
const passwordInput = element<HTMLInputElement>('join-password');
const stunToggle = element<HTMLInputElement>('internet-play');
const connectionLabel = document.querySelector<HTMLElement>('.connection')!;
const localLabel = connectionLabel.innerHTML;

// Sessions: this browser's own world (single player or hosting), or someone else's.
let local: LocalSession;
let session: GameSession;
let remote: RemoteSession | undefined;
let selectedShipId: string | undefined;
let activeBody: ResolvedBody;
/** The piloted ship's latest physics state. */
let state: State;
let view: State;
const cameraControl = new CameraController();
let cameraDrag: { id: number; x: number; y: number; moved: boolean } | undefined;
let lastWall: number | undefined;
let lastHud = -Infinity;
let lastDebug = -Infinity;
let lastPanel = -Infinity;
let lastLists = -Infinity;
let lastStatus: State['status'] = 'landed';
let lastTerrainContact: SurfaceContactEvent | undefined;
let lastSize = '';
let notice = { text: '', until: 0 };
/** Own ship ids when a remote spawn was requested; the new one is selected on arrival. */
let awaitingSpawn: Set<string> | undefined;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const padSites = new WeakMap<World, Map<string, { position: Vec; normal: Vec }>>();
/** Pad markers per body; terrain is generated by the world on load, never in draw(). */
function preparePads(world: World): void {
  if (padSites.has(world)) return;
  const system = world.system, profiles = world.surfaces;
  const pads = new Map<string, { position: Vec; normal: Vec }>();
  for (const body of system.getAllBodies()) {
    const profile = profiles.get(body.id);
    const p = system.presets.find(p => p.bodyId === body.id && p.kind === 'landed');
    const start = p ? system.initialState(p.id, profile).state.position : undefined;
    let angle = start ? Math.atan2(start.y, start.x) : profile?.pads[0]?.angleRadians ?? Math.PI / 2;
    if (profile && querySurface(profile, angle).material === 'water') {
      let dry: number | undefined;
      for (let i = 0; i < profile.sampleCount; i++) {
        const a = profile.orientationRadians + i * 2 * Math.PI / profile.sampleCount;
        if (querySurface(profile, a).material === 'rock') { dry = a; break; }
      }
      if (dry === undefined) continue;
      angle = dry;
    }
    const ground = profile ? querySurface(profile, angle) : undefined;
    const r = ground?.groundRadius ?? body.radius;
    pads.set(body.id, { position: start ?? { x: Math.cos(angle) * r, y: Math.sin(angle) * r },
      normal: ground?.normal ?? { x: Math.cos(angle), y: Math.sin(angle) } });
  }
  padSites.set(world, pads);
}

const prediction = new Prediction(pass => profiler.event('prediction', pass));

const pilotName = (): string => cleanName(nameInput.value, MAX_PLAYER_NAME) || 'Pilot';
const isHosting = (): boolean => session === local && local.hosting;
/** Single player on this browser's own world: blur pauses and Reset restarts the clock. */
const isSolo = (): boolean => session === local && !local.hosting;
/** Records only: a pilot's list never needs to evaluate sleeping ships. */
const ownShips = (): Ship[] => [...session.world.records()].filter(s => s.ownerId === session.playerId);
const selectedShip = (): Ship | undefined => selectedShipId ? session.world.ship(selectedShipId) : undefined;
function notify(text: string, seconds = 5): void {
  notice = { text, until: performance.now() + seconds * 1000 };
  lastHud = -Infinity;
}

function syncUniverseSelect(): void {
  universeSelect.innerHTML = '';
  const current = session.world.universe;
  const list = universes.get(current.id) === current ? [...universes.values()] : [current, ...[...universes.values()].filter(u => u.id !== current.id)];
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const u of list) {
    const category = universeCatalog.universes.find(entry => entry.id === u.id)?.category;
    const groupName = category === 'sandbox' ? 'Sandbox worlds' : category === 'astronomy' ? 'Astronomy' : 'Imported worlds';
    let group = groups.get(groupName);
    if (!group) { group = document.createElement('optgroup'); group.label = groupName; groups.set(groupName, group); universeSelect.append(group); }
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `${u.name}${u.id === DEFAULT_UNIVERSE.id ? ' (Default)' : ''}`;
    group.appendChild(opt);
  }
  universeSelect.value = current.id;
}

function syncSystemSelect(): void {
  systemSelect.innerHTML = '';
  const universe = session.world.universe;
  for (const s of universe.systems) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name}${s.id === universe.defaultSystemId ? ' (Default)' : ''}`;
    systemSelect.appendChild(opt);
  }
  systemSelect.value = session.world.systemId;
  show('system-label', session.world.system.system.name.toUpperCase());
}

function syncPresetSelect(): void {
  const currentVal = preset.value;
  preset.innerHTML = '';
  for (const p of session.world.system.presets) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    preset.appendChild(opt);
  }
  if (session.world.system.presets.some(p => p.id === currentVal)) {
    preset.value = currentVal;
  } else {
    preset.value = session.world.system.presets[0]?.id ?? 'pad';
  }
}

/** The universe and system belong to whoever hosts the world. */
function syncLocks(): void {
  const locked = session !== local || local.hosting;
  for (const control of [universeSelect, systemSelect, loadUniverseBtn, element<HTMLButtonElement>('try-terrain'),
    element<HTMLButtonElement>('try-ocean'), element<HTMLButtonElement>('load-world'),
    element<HTMLButtonElement>('load-module'), element<HTMLButtonElement>('reset-modules')]) control.disabled = locked;
  element<HTMLButtonElement>('save-world').disabled = session !== local || session.world.soloPreview;
  element<HTMLButtonElement>('host-game').disabled = session.world.soloPreview;
  const moduleState = worldModules(session.world);
  show('module-name', moduleState?.data.map(m => m.manifest.name).join(', ')
    || (moduleState && moduleState.profile.id !== DEFAULT_PROFILE.id ? moduleState.profile.id : 'Built-in default'));
  element<HTMLButtonElement>('export-module').disabled = !moduleState?.data.length;
  const fpText = session.world.simulationFingerprint ? ` (${session.world.simulationFingerprint.slice(0, 8)})` : '';
  show('module-status', session.world.soloPreview ? 'Solo preview. Export module/profile to keep your settings. World saves and hosting are unavailable for this profile.' : `Using compatible simulation profile${fpText}.`);
  moduleManager?.refresh();
  labManager?.refresh();
  pauseButton.disabled = session !== local;
  pauseButton.title = session === local ? '' : 'The host controls pausing';
  syncWarpUI();
}

/** Switch which world the console shows and flies. Joining or leaving a game also
 * returns the camera to the piloted ship. */
function useSession(next: GameSession, recenter = true): void {
  release();
  session = next;
  preparePads(next.world);
  selectedShipId = undefined;
  selectShip(ownShips()[0]?.id);
  syncUniverseSelect();
  syncSystemSelect();
  syncPresetSelect();
  syncLocks();
  if (recenter) {
    cameraControl.followShip(); cameraControl.rotation = 0;
    syncCameraButton();
    fitZoom(state);
  }
  commandBar.sync(next.world.commands);
  invalidatePrediction();
  lastWall = undefined;
  updateMultiplayer();
}

/** Replace this browser's own world (new universe, loaded save). */
function replaceLocalWorld(world: World, options: { readonly players?: readonly SavedPlayer[]; readonly hostId?: string } = {}): void {
  const token = tokenFor(world.id);
  let next: LocalSession;
  try { next = new LocalSession(world, { name: pilotName(), ...(token ? { token } : {}), ...options }); }
  catch (error) { world.dispose(); throw error; }
  local.world.dispose();
  local = next;
  if (session.kind === 'local') useSession(local, false);
}

/** Pilot another of this player's ships. Held input is released first. */
function selectShip(id: string | undefined): void {
  release();
  selectedShipId = id;
  lastTerrainContact = undefined;
  invalidatePrediction();
  const ship = selectedShip();
  if (ship) {
    godModeToggle.checked = ship.state.godMode === true;
    // A different ship, not a sphere-of-influence change.
    activeBody = session.world.body(ship.bodyId);
  }
  awaitingSpawn = undefined;
  syncSelected();
  lastStatus = state.status;
  cameraControl.recenter();
  lastHud = lastLists = -Infinity;
  profiler.event('select-ship', { ship: id ?? null });
}

/** Refresh the piloted ship's state and frame after the world moved. */
function syncSelected(): void {
  const world = session.world;
  let ship = selectedShip();
  if (!ship || ship.ownerId !== session.playerId) {
    const next = ownShips()[0];
    if (next && next.id !== selectedShipId) { selectShip(next.id); return; }
    ship = undefined;
  }
  if (awaitingSpawn) {
    const fresh = ownShips().find(s => !awaitingSpawn!.has(s.id));
    if (fresh) { selectShip(fresh.id); return; }
  }
  if (!ship) {
    // Nothing to pilot (for example a full server): show the system without a ship.
    activeBody = world.system.rootBody;
    state = { time: world.time, position: { x: 0, y: activeBody.radius }, velocity: { x: 0, y: 0 },
      heading: Math.PI / 2, throttle: 0, status: 'landed', revision: 0 };
    return;
  }
  if (activeBody && ship.bodyId !== activeBody.id && world.hasBody(activeBody.id)) {
    const time = ship.state.time;
    cameraControl.rebase(world.system.getBodyPosition(activeBody.id, time), world.system.getBodyPosition(ship.bodyId, time));
    activeBody = world.body(ship.bodyId);
    lastTerrainContact = undefined;
    invalidatePrediction();
    show('active-body', activeBody.name.toUpperCase());
    profiler.event('soi-transition', { body: activeBody.id, time });
  }
  activeBody = world.body(ship.bodyId);
  state = ship.state;
}

function setUniverse(u: UniverseDefinition, preferredSystemId?: string): void {
  const world = createLocalWorld(u, preferredSystemId);
  universes.set(u.id, u);
  replaceLocalWorld(world);
  reset();
  profiler.event('universe-load', { universe: u.id, system: world.systemId });
}

/** An imported universe becomes ordinary game content while retaining enabled plugins. */
function importUniverse(universe: UniverseDefinition): void {
  if (!isSolo()) throw new Error('Import a universe in your solo game');
  const current = worldModules(local.world), adapter = universeDataModule(universe);
  const data = [adapter, ...(current?.data ?? []).filter(m => m.manifest.id !== adapter.manifest.id)];
  const profile = current?.profile ?? DEFAULT_PROFILE;
  const prepared = prepareLocalWorld(DEFAULT_UNIVERSE, universe.defaultSystemId, {
    data, universeKey: `${adapter.manifest.id}/${universe.id}`,
    profile: { ...profile, modules: [...profile.modules.filter(m => m.id !== adapter.manifest.id),
      { id: adapter.manifest.id, version: adapter.manifest.version }] },
  });
  replaceLocalWorld(prepared.world);
  prepared.runtime.activate(prepared.candidate);
  reset();
}

function switchSystem(systemId: string): void {
  const current = worldModules(local.world);
  const prepared = prepareLocalWorld(current?.baseUniverse ?? local.world.universe, systemId, current ?? {});
  const world = prepared.world;
  replaceLocalWorld(world);
  prepared.runtime.activate(prepared.candidate);
  reset();
  profiler.event('system-switch', { system: world.systemId });
}

/** Make the opt-in surface examples visible immediately on selection. */
function showSurfaceWorld(u: UniverseDefinition): void {
  setUniverse(u);
  showSurfaceOverview();
  element('flight-console').scrollIntoView({ block: 'start' });
}
function showSurfaceOverview(): void {
  const profile = session.world.surface(activeBody.id);
  if (!profile) return;
  cameraControl.planetView(); cameraControl.horizon = false; cameraControl.rotation = 0;
  cameraControl.zoom = 1500 / (2.8 * profile.bounds.maxRadius);
  syncCameraButton();
  orientationButton.textContent = 'North up';
}

function controls(): Controls {
  const held = new Set([...pointers.values()]);
  const gp = gamepadManager.pollFlight();
  const touch = touchControls.pollFlight();

  // Keyboard / touch button steering: CCW (+1) if turnLeft pressed; CW (-1) if turnRight pressed
  let kbTurn = 0;
  if (isActionActive('turnLeft') || held.has('left')) kbTurn += 1;
  if (isActionActive('turnRight') || held.has('right')) kbTurn -= 1;

  // Keyboard / touch button throttle: +1 if throttleUp pressed; -1 if throttleDown pressed
  let kbThrottle = 0;
  if (isActionActive('throttleUp')) kbThrottle += 1;
  if (isActionActive('throttleDown')) kbThrottle -= 1;

  // Keyboard / touch engine burn
  const kbEngine = isActionActive('engine') || held.has('engine');

  // Blend inputs:
  // Gamepad analog stick takes highest priority if outside deadzone,
  // then virtual touchscreen joystick, then keyboard/pointer
  const turn = Math.abs(gp.turn) > 0.01
    ? gp.turn
    : Math.abs(touch.turn) > 0.01
      ? touch.turn
      : kbTurn;

  const throttle = gp.throttle !== 0
    ? gp.throttle
    : touch.throttle !== 0
      ? touch.throttle
      : kbThrottle;

  const engine = kbEngine || gp.engine || touch.engine;

  return { turn, throttle, engine };
}
function release(): void {
  keys.clear(); pointers.clear();
  cameraDrag = undefined; canvas.classList.remove('dragging');
  for (const button of document.querySelectorAll('[data-hold]')) button.setAttribute('aria-pressed', 'false');
  element('burn').setAttribute('aria-pressed', 'false'); shown.set('burn', 'false');
}
function invalidatePrediction(): void {
  prediction.invalidate();
}
/** Pausing is the world's owner's call: here, or the host for everyone. */
function setPaused(value: boolean, reason = ''): void {
  if (session !== local) return;
  if (value !== local.paused) profiler.event(value ? 'pause' : 'resume', { reason: reason || 'user', time: state.time });
  local.setPaused(value, value ? reason : '');
  const ship = selectedShip();
  if (!value && ship?.fault) local.world.clearFault(ship.id);
  release(); lastWall = undefined;
  lastHud = lastDebug = -Infinity;
  syncPauseButton();
}
function syncPauseButton(): void {
  const paused = session.paused;
  const text = paused ? 'Resume' : 'Pause';
  if (pauseButton.textContent !== text) pauseButton.textContent = text;
  pauseButton.setAttribute('aria-pressed', String(paused));
}

function setWarp(factor: number): void {
  if (!session.canWarp) {
    notify('Only the host can activate time warp.');
    return;
  }
  try {
    session.setWarp(factor);
    syncWarpUI();
    profiler.event('warp', { factor: session.warp, requested: factor, time: state.time });
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

function warpUp(): void {
  if (!session.canWarp) { notify('Only the host can activate time warp.'); return; }
  const next = nextWarpFactor(session.requestedWarp, 1);
  setWarp(next);
}

function warpDown(): void {
  if (!session.canWarp) { notify('Only the host can activate time warp.'); return; }
  const prev = nextWarpFactor(session.requestedWarp, -1);
  setWarp(prev);
}

function resetWarp(): void {
  if (!session.canWarp) { notify('Only the host can activate time warp.'); return; }
  setWarp(1);
}

function syncWarpUI(): void {
  const canWarp = session.canWarp;
  warpDownButton.disabled = !canWarp;
  warpUpButton.disabled = !canWarp;
  warpDownButton.title = canWarp ? 'Decrease time warp ([ or ,)' : 'Only the host controls time warp';
  warpUpButton.title = canWarp ? 'Increase time warp (] or .)' : 'Only the host controls time warp';
  const warpText = `${session.warp}×`;
  if (warpFactorSpan.textContent !== warpText) warpFactorSpan.textContent = warpText;
  show('warp-rate', session.warp > 1 ? `WARP · ${session.warp}×` : 'REAL TIME · 1×');
  if (lastWarp > 1 && session.warp === 1 && session.warpReason) {
    notify(`Warp dropped: ${session.warpReason}`);
    profiler.event('warp-drop', { reason: session.warpReason, time: state.time });
  }
  lastWarp = session.warp;
}
/** Losing focus pauses a solo flight; shared worlds keep running, so only release input. */
function autoPause(reason: string): void {
  if (isSolo()) { setPaused(true, reason); return; }
  release();
  handleEvents(session.update(0, selectedShipId, IDLE));
}
function fitZoom(start: State, presetId = preset.value): void {
  const selectedPreset = session.world.system.presets.find(p => p.id === presetId);
  if (selectedPreset && typeof selectedPreset.zoom === 'number') {
    cameraControl.zoom = selectedPreset.zoom;
  } else if (start.status === 'landed') {
    cameraControl.zoom = 1;
  } else {
    cameraControl.setZoom(1500 / (magnitude(start.position) * 2.8));
  }
}
/** Start over at the selected scenario. Alone in a solo world this is a fresh flight with
 * the clock at zero; in a shared world (or with a fleet) the piloted ship respawns. */
function reset(): void {
  release();
  const presetId = session.world.presetId(preset.value);
  const ship = selectedShip();
  try {
    if (isSolo() && session.world.size <= 1) {
      local.world.reset();
      local.settle();
      selectedShipId = undefined;
      selectShip(local.spawn(presetId, godModeToggle.checked));
    } else if (ship) {
      session.respawn(ship.id, presetId);
      if (session === local) local.settle();
    } else {
      const id = session.spawn(presetId, godModeToggle.checked);
      if (id) selectShip(id);
    }
  } catch (error) {
    if (!(error instanceof SessionError)) throw error;
    notify(error.message);
  }
  syncSelected();
  lastTerrainContact = undefined;
  cameraControl.rotation = 0;
  fitZoom(session.world.presetState(presetId).state, presetId);
  cameraControl.recenter();
  lastStatus = state.status;
  syncCameraButton();
  invalidatePrediction(); setPaused(false);
  show('active-body', activeBody.name.toUpperCase());
  profiler.event('reset', { preset: preset.value, body: activeBody.id });
}
function changeZoom(factor: number): void { cameraControl.changeZoom(factor); }
/** Follow ship → planet view → module camera modes → follow ship. */
function toggleCamera(): void {
  cameraControl.cycle(presentation.cameras);
  syncCameraButton();
  profiler.event('camera', { mode: cameraControl.mode });
}
function syncCameraButton(): void {
  cameraControl.retain(presentation.cameras);
  const label = cameraControl.label(presentation.cameras);
  if (cameraButton.textContent !== label) cameraButton.textContent = label;
}
function toggleProfiler(): void {
  profilerPanel.hidden = !profilerPanel.hidden;
  profilerButton.setAttribute('aria-pressed', String(!profilerPanel.hidden));
  lastPanel = -Infinity;
}

function bodyWorldPosition(bodyId: string, time: number, pos: Vec): Vec {
  const bodyPos = session.world.system.getBodyPosition(bodyId, time);
  return { x: bodyPos.x + pos.x, y: bodyPos.y + pos.y };
}

const endCameraDrag = (event: PointerEvent): void => {
  if (cameraDrag?.id !== event.pointerId) return;
  cameraDrag = undefined; canvas.classList.remove('dragging');
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
};

function attachCanvasListeners(target: HTMLCanvasElement): void {
  target.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey || !Number.isFinite(event.deltaY)) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1;
    const pixels = Math.max(-500, Math.min(500, event.deltaY * unit));
    changeZoom(Math.exp(-pixels * .002));
  }, { passive: false });
  target.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    target.focus(); target.setPointerCapture(event.pointerId);
    cameraDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  });
  target.addEventListener('pointermove', event => {
    if (!cameraDrag || cameraDrag.id !== event.pointerId) return;
    const delta = { x: event.clientX - cameraDrag.x, y: event.clientY - cameraDrag.y };
    if (!cameraDrag.moved && Math.hypot(delta.x, delta.y) < 3) return;
    cameraControl.drag(delta, session.world.system.getBodyPosition(activeBody.id, view.time), view.position,
      target.clientWidth, target.clientHeight);
    syncCameraButton();
    cameraDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: true };
    target.classList.add('dragging');
  });
  target.addEventListener('pointerup', endCameraDrag);
  target.addEventListener('pointercancel', endCameraDrag);
  target.addEventListener('lostpointercapture', endCameraDrag);
}
const requested = requestedModules();
presentation.start(requested.presentation);



/** Module commands: buttons and keys for the active world's command table. The session sends
 * each request to the authoritative host, which checks and applies it. */
const commandBar = new CommandBar(element('module-commands'), issueCommand);
function issueCommand(command: CommandExtension): void {
  const ship = selectedShip();
  if (!ship) { notify('No ship to command.'); return; }
  try {
    session.command(ship.id, command.id);
    profiler.event('module-command', { command: command.id, ship: ship.id });
  } catch (error) {
    if (!(error instanceof SessionError)) throw error;
    notify(error.message);
  }
  lastHud = -Infinity;
}

function toggleOrientation(): void {
  cameraControl.horizon = !cameraControl.horizon; orientationButton.textContent = cameraControl.horizon ? 'Horizon up' : 'North up';
}
pauseButton.addEventListener('click', () => setPaused(!session.paused));
warpDownButton.addEventListener('click', warpDown);
warpUpButton.addEventListener('click', warpUp);
element('reset').addEventListener('click', reset);
preset.addEventListener('change', () => {
  const builtinSurface = session.world.universe === terrainUniverse || session.world.universe === oceanUniverse;
  if (builtinSurface) {
    cameraControl.followShip(); cameraControl.horizon = true; orientationButton.textContent = 'Horizon up';
    syncCameraButton();
  }
  reset();
  if (builtinSurface && state.status === 'landed') cameraControl.zoom = 12;
});
universeSelect.addEventListener('change', () => {
  const chosen = universes.get(universeSelect.value);
  if (chosen) {
    if (chosen === terrainUniverse || chosen === oceanUniverse) showSurfaceWorld(chosen);
    else setUniverse(chosen);
  }
});
element('try-terrain').addEventListener('click', () => showSurfaceWorld(terrainUniverse));
element('try-ocean').addEventListener('click', () => showSurfaceWorld(oceanUniverse));
systemSelect.addEventListener('change', () => {
  try {
    switchSystem(systemSelect.value);
    if (session.world.universe === terrainUniverse || session.world.universe === oceanUniverse) showSurfaceOverview();
  }
  catch (error) { systemSelect.value = session.world.systemId; alert(String(error)); }
});

loadUniverseBtn.addEventListener('click', () => universeFileInput.click());
universeFileInput.addEventListener('change', async () => {
  const file = universeFileInput.files?.[0];
  if (!file) return;
  const originalWorld = session.world;
  try {
    if (!isSolo()) throw new Error('Import a universe in your solo game');
    if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Universe files must be at most 32 MiB');
    const validated = await decodeUniverse(new Uint8Array(await file.arrayBuffer()));
    if (session.world !== originalWorld || !isSolo()) throw new Error('The active session changed while importing');
    importUniverse(validated);
    show('universe-status', `Loaded ${validated.name} · ${validated.systems.length} systems. JSON and compressed universe files are supported.`);
    show('flight-message', `Loaded universe "${validated.name}" · ${session.world.system.system.name}`);
  } catch (err) {
    show('universe-status', `Universe was not loaded: ${message(err)}`);
    alert(`Failed to load universe file: ${message(err)}`);
  } finally {
    universeFileInput.value = '';
  }
});

exportUniverseBtn.addEventListener('click', async () => {
  try {
    const universe = session.world.universe;
    const bytes = await encodeUniverse(universe);
    downloadBytes(`${universe.id}.spaceuniverse`, bytes);
    const original = new TextEncoder().encode(JSON.stringify(universe)).length;
    show('universe-status', `Exported ${universe.name}: ${(bytes.length / 1024).toFixed(1)} KiB compressed, ${Math.round((1 - bytes.length / original) * 100)}% smaller than JSON.`);
  } catch (error) { show('universe-status', `Universe was not exported: ${message(error)}`); }
});
element('export-universe-json').addEventListener('click', () => {
  const universe = session.world.universe;
  download(`space-sim-universe-${universe.id}.json`, JSON.stringify(universe, null, 2));
});

// A data import is validated and built as a candidate before the active world changes.
const moduleInput = element<HTMLInputElement>('module-file');
element('load-module').addEventListener('click', () => moduleInput.click());
moduleInput.addEventListener('change', async () => {
  const file = moduleInput.files?.[0], originalWorld = session.world;
  if (!file) return;
  try {
    if (file.size > MAX_MODULE_BYTES) throw new Error('Module files must be at most 4 MiB.');
    const text = await file.text();
    if (session.world !== originalWorld) throw new Error('The active session changed while loading.');
    loadModuleText(text);
  } catch (error) { show('module-status', `Module was not loaded: ${message(error)}`); }
  finally { moduleInput.value = ''; }
});
function loadModuleText(text: string): void {
  if (session !== local || local.hosting) throw new Error('Load modules in your solo game.');
  const originalWorld = session.world;
  const imported = parseModuleImport(text);
  const bundle = imported.format === 'space-sim-module-profile/1' ? imported : undefined;
  const usesCode = bundle ? moduleLibrary.requireProfile(bundle.profile, bundle.presentation, bundle.code) : false;
  const apply = () => {
    if (bundle) moduleLibrary.requireProfile(bundle.profile, bundle.presentation, bundle.code);
    if (session.world !== originalWorld || session !== local || local.hosting) throw new Error('The active session changed while loading.');
    const data: readonly DataModule[] = bundle?.modules ?? [imported as DataModule];
    const addedUniverse = bundle ? undefined : data[0]?.data.universes?.[0];
    const universeKey = bundle?.selection.universe ?? (addedUniverse
      ? addedUniverse.target ?? `${data[0]!.manifest.id}/${addedUniverse.definition.id}`
      : worldModules(local.world)?.universeKey ?? `builtin.content/${local.world.universe.id}`);
    const baseUniverse = bundle ? DEFAULT_UNIVERSE : worldModules(local.world)?.baseUniverse ?? local.world.universe;
    const prepared = prepareLocalWorld(baseUniverse, bundle ? bundle.selection.system : addedUniverse ? undefined : local.world.systemId,
      { data, ...(bundle ? { profile: bundle.profile } : {}), universeKey });
    try { if (bundle?.presentation) presentation.apply(bundle.presentation); } catch (error) { prepared.candidate.dispose(); throw error; }
    replaceLocalWorld(prepared.world);
    prepared.runtime.activate(prepared.candidate);
    reset();
    show('module-status', local.world.soloPreview ? 'Module loaded into a new solo preview. World saves and hosting are unavailable; export the module/profile to keep it.' : 'Module profile loaded into a new world.');
  };
  const enable = element<HTMLButtonElement>('enable-imported-profile');
  enable.hidden = true;
  if (usesCode) {
    enable.hidden = false;
    enable.onclick = () => { try { apply(); enable.hidden = true; } catch (error) { show('module-status', `Profile was not enabled: ${message(error)}`); } };
    show('module-status', 'Profile inspected. Enabling runs the installed trusted code listed in its requirements and starts a new world.');
  } else apply();
}
element('reset-modules').addEventListener('click', () => {
  if (session !== local || local.hosting) return;
  setUniverse(DEFAULT_UNIVERSE);
});
element('export-module').addEventListener('click', () => {
  const data = worldModules(session.world)?.data;
  if (data?.length === 1) download(`${data[0]!.manifest.id}.json`, exportDataModule(data[0]!));
  else if (data?.length) exportModuleProfile();
});
function currentModuleBundle(): ModuleBundle {
  const current = worldModules(session.world);
  let data = current?.data ?? [];
  let profile = current?.profile ?? DEFAULT_PROFILE;
  let universeKey = current?.universeKey ?? `builtin.content/${session.world.universe.id}`;
  const base = current?.baseUniverse ?? session.world.universe;
  const builtin = builtinUniverses().get(base.id);
  // Include legacy universe imports as ordinary data. Rewrite only documented
  // universe reference fields when changing their namespace for portable export.
  if (universeKey.startsWith('builtin.content/') && JSON.stringify(base) !== JSON.stringify(builtin)) {
    const adapter = universeDataModule(base), oldKey = `builtin.content/${base.id}`;
    const newKey = `${adapter.manifest.id}/${base.id}`;
    data = [adapter, ...data.map(m => validateDataModule({ ...m, data: { ...m.data,
      ...(m.data.universes ? { universes: m.data.universes.map(e => e.target === oldKey ? { ...e, target: newKey } : e) } : {}),
      ...(m.data.presets ? { presets: m.data.presets.map(e => e.universe === oldKey ? { ...e, universe: newKey } : e) } : {}),
      ...(m.data.appearance ? { appearance: m.data.appearance.map(e => e.universe === oldKey ? { ...e, universe: newKey } : e) } : {}),
    } }))];
    profile = { ...profile, modules: [...profile.modules, { id: adapter.manifest.id, version: adapter.manifest.version }] };
    if (universeKey === oldKey) universeKey = newKey;
  }
  const code = moduleLibrary.artifacts.filter(a => profile.modules.some(m => m.id === a.manifest.id) || presentation.profile?.modules.some(m => m.id === a.manifest.id))
    .map(a => ({ id: a.manifest.id, version: a.manifest.version, digest: a.digest }));
  const bundle: ModuleBundle = { format: 'space-sim-module-profile/1', profile, modules: data,
    ...(code.length ? { code } : {}), presentation: presentation.profile,
    selection: { universe: universeKey, system: session.world.systemId } };
  return bundle;
}
function exportModuleProfile(): void {
  download('space-sim-profile.json', JSON.stringify(currentModuleBundle(), null, 2));
}
element('export-profile').addEventListener('click', exportModuleProfile);

godModeToggle.addEventListener('change', () => {
  const ship = selectedShip();
  if (!ship) return;
  try { session.setGodMode(ship.id, godModeToggle.checked); } catch (error) {
    godModeToggle.checked = !godModeToggle.checked;
    notify(message(error));
  }
  profiler.event('god-mode', { enabled: godModeToggle.checked });
  lastHud = -Infinity;
});
cameraButton.addEventListener('click', toggleCamera);
orientationButton.addEventListener('click', toggleOrientation);
function toggleFullscreen(): void {
  if (!document.fullscreenElement) {
    void document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    void document.exitFullscreen?.().catch(() => {});
  }
}
fullscreenButton.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement;
  fullscreenButton.setAttribute('aria-pressed', String(isFs));
  fullscreenButton.textContent = isFs ? 'Exit fullscreen' : 'Fullscreen';
  profiler.event('fullscreen', { active: isFs });
});
profilerButton.addEventListener('click', toggleProfiler);
element('zoom-in').addEventListener('click', () => changeZoom(1.3));
element('zoom-out').addEventListener('click', () => changeZoom(1 / 1.3));
element<HTMLInputElement>('profiler-precise').addEventListener('change', event => {
  profiler.precise = (event.target as HTMLInputElement).checked;
  profiler.event('profiler-precise', { enabled: profiler.precise });
});
for (const id of ['export-log', 'export-log-diagnostics']) element(id).addEventListener('click', exportLog);
slider.addEventListener('input', () => {
  const ship = selectedShip();
  if (ship) session.setThrottle(ship.id, Number(slider.value) / 100);
});

// Fleet
function cycleShip(direction: number): void {
  const own = ownShips();
  if (own.length < 2) return;
  const index = own.findIndex(s => s.id === selectedShipId);
  selectShip(own[(index + direction + own.length) % own.length]!.id);
}
spawnButton.addEventListener('click', () => {
  try {
    const before = new Set(ownShips().map(s => s.id));
    const id = session.spawn(session.world.presetId(preset.value), godModeToggle.checked);
    if (id) {
      selectShip(id);
      fitZoom(state);
      notify(`${selectedShip()!.name} launched. Your other ships keep flying.`);
    } else {
      awaitingSpawn = before;
    }
    profiler.event('spawn-ship', { preset: preset.value });
  } catch (error) {
    if (!(error instanceof SessionError)) throw error;
    notify(error.message);
  }
  lastLists = -Infinity;
});
removeButton.addEventListener('click', () => {
  const ship = selectedShip();
  if (!ship) return;
  try { session.remove(ship.id); } catch (error) {
    if (!(error instanceof SessionError)) throw error;
    notify(error.message);
    return;
  }
  profiler.event('remove-ship', { ship: ship.id });
  if (session === local) syncSelected();
  lastLists = -Infinity;
});
shipList.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-ship]');
  if (button) selectShip(button.dataset.ship);
});

let fleetKey = '';
const SHIP_LIST_LIMIT = 40;
function updateLists(): void {
  const world = session.world;
  const own = ownShips();
  const piloted = selectedShip();
  if (piloted && document.activeElement !== godModeToggle) godModeToggle.checked = piloted.state.godMode === true;
  const limit = session === local ? local.host.settings.maxShipsPerPlayer : remote?.client.rules?.maxShipsPerPlayer ?? 1;
  spawnButton.disabled = own.length >= limit;
  removeButton.disabled = own.length <= 1 || !selectedShipId;
  // A stress-tested world can hold tens of thousands of ships: list a bounded number.
  const others: Ship[] = [];
  let otherCount = 0;
  for (const ship of world.records()) {
    if (ship.ownerId === session.playerId) continue;
    if (others.length < SHIP_LIST_LIMIT) others.push(ship);
    otherCount++;
  }
  const ships = [...own.slice(0, SHIP_LIST_LIMIT), ...others];
  const hidden = own.length + otherCount - ships.length;
  const key = `${selectedShipId}|${hidden}|${ships.map(s => `${s.id}/${s.name}/${s.ownerId}/${s.bodyId}/${s.state.status}/${s.fault ? 1 : 0}`).join(',')}`;
  show('stress-count', `${(world.size - own.length).toLocaleString()} other objects · ${world.asleepCount.toLocaleString()} asleep`);
  if (key !== fleetKey) {
    fleetKey = key;
    const more: HTMLLIElement[] = [];
    if (hidden > 0) {
      const item = document.createElement('li');
      item.className = 'foreign';
      item.textContent = `+ ${hidden.toLocaleString()} more ${hidden === 1 ? 'ship' : 'ships'}`;
      more.push(item);
    }
    shipList.replaceChildren(...ships.map(ship => {
      const item = document.createElement('li');
      const status = ship.fault ? 'STOPPED' : ship.state.water && ship.state.status !== 'crashed' ? ship.state.water.toUpperCase() : ship.state.status.toUpperCase();
      const name = document.createElement('b');
      const detail = document.createElement('small');
      detail.textContent = `${world.body(ship.bodyId).name.toUpperCase()} · ${status}`;
      if (ship.ownerId === session.playerId) {
        name.textContent = ship.name;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.ship = ship.id;
        button.setAttribute('aria-current', String(ship.id === selectedShipId));
        button.title = ship.id === selectedShipId ? 'Piloting' : 'Pilot this ship';
        button.append(name, detail);
        item.append(button);
      } else {
        item.className = 'foreign';
        name.textContent = `${ship.name} · ${session.playerName(ship.ownerId) ?? 'Unknown pilot'}`;
        const row = document.createElement('span');
        row.append(name, detail);
        item.append(row);
      }
      return item;
    }), ...more);
  }
  updatePlayers();
}

// Stress test: many ships and asteroids in this browser's own world.
interface StressRequest { readonly ships?: number; readonly asteroids?: number; readonly burn?: boolean; readonly seed?: number }
let stressSeed = 1;
function stressShips(): Ship[] {
  return [...local.world.records()].filter(s => s.ownerId === STRESS_OWNER && !s.id.startsWith(STRESS_ROCK_PREFIX));
}
function stressTest(request: StressRequest): string {
  if (session !== local || local.hosting) return 'Stress tests run in your own solo world (not while hosting or online).';
  const ships = Math.max(0, Math.min(20000, Math.floor(request.ships ?? 0)));
  const asteroids = Math.max(0, Math.min(200000, Math.floor(request.asteroids ?? 0)));
  const begin = performance.now();
  const result = populateStress(local.world, { ships, asteroids, burn: request.burn ?? false, seed: request.seed ?? stressSeed++ });
  const ms = performance.now() - begin;
  lastLists = -Infinity;
  profiler.event('stress-spawn', { ships, asteroids: result.asteroids, kinds: result.kinds, ms: +ms.toFixed(1) });
  return `Spawned ${ships.toLocaleString()} ships and ${result.asteroids.toLocaleString()} asteroids in ${ms.toFixed(0)} ms.`;
}
function stressEngines(on: boolean): string {
  if (session !== local) return 'Stress tests run in your own solo world.';
  const ships = stressShips();
  for (const ship of ships) {
    if (on) local.world.setThrottle(ship.id, 1);
    local.world.setControls(ship.id, on ? { turn: 0, throttle: 0, engine: true } : IDLE);
  }
  profiler.event(on ? 'stress-burn' : 'stress-cut', { ships: ships.length });
  return `${on ? 'Engines on' : 'Engines off'} for ${ships.length.toLocaleString()} ships.`;
}
const stressStatus = (text: string): void => show('stress-status', text);
element('stress-spawn').addEventListener('click', () => stressStatus(stressTest({
  ships: Number(element<HTMLInputElement>('stress-ships').value), asteroids: Number(element<HTMLInputElement>('stress-asteroids').value) })));
element('stress-burn').addEventListener('click', () => stressStatus(stressEngines(true)));
element('stress-cut').addEventListener('click', () => stressStatus(stressEngines(false)));
element('stress-clear').addEventListener('click', () => {
  if (session !== local) return;
  const removed = clearStress(local.world);
  lastLists = -Infinity;
  profiler.event('stress-clear', { removed });
  stressStatus(`Removed ${removed.toLocaleString()} objects.`);
});
/** Automation hook for scripts/stress/browser-bench.mjs (the same as the panel's buttons). */
(window as unknown as { spaceSimStress?: (request: StressRequest) => string }).spaceSimStress = stressTest;

// Multiplayer
let invite: Invite | undefined;
let reply: Reply | undefined;
let pending: ClientSession | undefined;
nameInput.value = savedName();
nameInput.addEventListener('change', () => {
  nameInput.value = cleanName(nameInput.value, MAX_PLAYER_NAME);
  saveName(nameInput.value);
  if (session === local) local.host.seatHost(pilotName(), local.token);
});

function mpStatus(text: string): void { show('mp-status', text); }
function updateMultiplayer(): void {
  const hosting = isHosting();
  element('mp-offline').hidden = session !== local || hosting || !!reply;
  element('mp-reply').hidden = !reply;
  element('mp-hosting').hidden = !hosting;
  element('invite-panel').hidden = !invite;
  element('mp-online').hidden = session === local;
  element('internet-row').hidden = session !== local;
  joinButton.disabled = !!pending;
  if (session !== local) {
    connectionLabel.innerHTML = '<i></i> ONLINE';
    connectionLabel.append(` · ${remote?.client.hostName.toUpperCase() ?? ''}`);
  } else if (hosting) {
    connectionLabel.innerHTML = '<i></i> HOSTING';
    connectionLabel.append(` · ${local.host.connectedCount()} ${local.host.connectedCount() === 1 ? 'PILOT' : 'PILOTS'}`);
  } else connectionLabel.innerHTML = localLabel;
  lastLists = -Infinity;
}
let playersKey = '';
function updatePlayers(): void {
  const players = session === local && !local.hosting ? [] : session.players();
  const key = players.map(p => `${p.id}/${p.name}/${p.connected}`).join(',');
  if (key === playersKey) return;
  playersKey = key;
  element('player-list').replaceChildren(...players.map(player => {
    const item = document.createElement('li');
    item.className = player.connected ? '' : 'away';
    let ships = 0;
    for (const ship of session.world.records()) if (ship.ownerId === player.id) ships++;
    item.textContent = `${player.connected ? '●' : '○'} ${player.name}${player.id === session.playerId ? ' (you)' : ''}${player.host ? ' · host' : ''}`;
    const detail = document.createElement('small');
    detail.textContent = `${ships} ${ships === 1 ? 'ship' : 'ships'}`;
    item.append(detail);
    return item;
  }));
  if (isHosting()) updateMultiplayer();
}

async function copy(textarea: HTMLTextAreaElement): Promise<void> {
  try { await navigator.clipboard.writeText(textarea.value); mpStatus('Copied.'); } catch {
    textarea.select();
    mpStatus(document.execCommand('copy') ? 'Copied.' : 'Select the code and copy it.');
  }
}

element('host-game').addEventListener('click', () => {
  if (session !== local) return;
  if (local.world.soloPreview) { mpStatus('Custom flight profiles are solo previews; use the built-in default to host.'); return; }
  local.hosting = true;
  rememberToken(local.world.id, local.token, local.playerId);
  local.host.seatHost(pilotName(), local.token);
  if (local.paused) setPaused(false);
  mpStatus('Hosting. Create one invite per player and send it to them (chat, email…). They send back a reply code.');
  profiler.event('host-start', { world: local.world.id });
  syncLocks();
  updateMultiplayer();
});
function cancelInvite(): void {
  invite?.cancel();
  invite = undefined;
  updateMultiplayer();
}
element('stop-hosting').addEventListener('click', () => {
  cancelInvite();
  local.host.close('The host stopped hosting.');
  local.hosting = false;
  mpStatus('Stopped hosting. Remote ships stay in this world.');
  profiler.event('host-stop', {});
  syncLocks();
  updateMultiplayer();
  updateBackground();
});
element('create-invite').addEventListener('click', async () => {
  const button = element<HTMLButtonElement>('create-invite');
  button.disabled = true;
  mpStatus('Preparing an invite…');
  try {
    invite?.cancel();
    invite = await createInvite(stunToggle.checked);
    element<HTMLTextAreaElement>('invite-code').value = invite.code;
    element<HTMLTextAreaElement>('host-reply').value = '';
    mpStatus('Send the invite to one player. Paste the reply they send you below.');
  } catch (error) {
    invite = undefined;
    mpStatus(`Could not create an invite: ${message(error)}`);
  } finally {
    button.disabled = false;
    updateMultiplayer();
  }
});
element('cancel-invite').addEventListener('click', cancelInvite);
element('copy-invite').addEventListener('click', () => void copy(element<HTMLTextAreaElement>('invite-code')));
element('accept-reply').addEventListener('click', async () => {
  const current = invite;
  if (!current) return;
  mpStatus('Connecting the player…');
  try {
    const connection = await current.accept(element<HTMLTextAreaElement>('host-reply').value);
    if (invite === current) invite = undefined;
    local.accept(connection);
    mpStatus('Player connected. Create another invite for the next player.');
  } catch (error) {
    mpStatus(message(error));
  }
  updateMultiplayer();
});

function startClient(connection: Connection): void {
  const client = new ClientSession(connection, {
    name: pilotName(), ...(passwordInput.value ? { password: passwordInput.value } : {}),
    token: tokenFor, saveToken: rememberToken,
    lock: local.world.lock, simulationFingerprint: local.world.simulationFingerprint,
    createContext: worldModules(local.world)?.createContext,
    rules: local.world.rules, forces: local.world.forces, commands: local.world.commands,
  });
  pending = client;
  updateMultiplayer();
  client.onjoined = () => {
    pending = undefined;
    if (session === local && !local.paused) setPaused(true, 'Playing online');
    remote = new RemoteSession(client);
    useSession(remote);
    mpStatus(`Joined ${client.hostName}. Your ships are listed under Fleet.`);
    notify(`Welcome to ${client.hostName}.`);
    profiler.event('join', { world: client.worldId });
  };
  client.onplayers = () => { lastLists = -Infinity; };
  client.onnotice = text => notify(text);
  client.onclose = reason => {
    if (pending === client) pending = undefined;
    if (remote?.client === client) {
      remote = undefined;
      useSession(local);
      setPaused(true, `Left the online game (${reason})`);
      profiler.event('leave', { reason });
    }
    if (/password/i.test(reason)) element('password-row').hidden = false;
    mpStatus(reason);
    updateMultiplayer();
  };
}
async function join(): Promise<void> {
  const text = joinInput.value.trim();
  if (!text || pending || reply) return;
  if (isInviteCode(text)) {
    mpStatus('Answering the invite…');
    try {
      const answer = await answerInvite(text, stunToggle.checked);
      reply = answer;
      element<HTMLTextAreaElement>('reply-code').value = answer.code;
      mpStatus('Send this reply code to the host. You join as soon as they paste it.');
      updateMultiplayer();
      const connection = await answer.connection;
      if (reply !== answer) { connection.close('Cancelled.'); return; }
      reply = undefined;
      startClient(connection);
    } catch (error) {
      reply = undefined;
      mpStatus(message(error));
    }
    updateMultiplayer();
    return;
  }
  let url: string;
  try { url = serverUrl(text, location.protocol === 'https:'); } catch (error) { mpStatus(message(error)); return; }
  mpStatus(`Connecting to ${url}…`);
  joinButton.disabled = true;
  try { startClient(await connectWebSocket(url)); } catch (error) {
    mpStatus(location.protocol === 'https:' && url.startsWith('ws:') ? `${message(error)} Secure pages can only reach wss:// servers.` : message(error));
  } finally { updateMultiplayer(); }
}
joinButton.addEventListener('click', () => void join());
joinInput.addEventListener('keydown', event => { if (event.key === 'Enter') void join(); });
element('cancel-join').addEventListener('click', () => {
  reply?.cancel();
  reply = undefined;
  mpStatus('Invite cancelled.');
  updateMultiplayer();
});
element('copy-reply').addEventListener('click', () => void copy(element<HTMLTextAreaElement>('reply-code')));
element('leave-game').addEventListener('click', () => remote?.client.leave());

// World files: the whole world (clock, every ship, pilots) as portable JSON.
element('save-world').addEventListener('click', () => {
  if (session !== local || local.world.soloPreview) return;
  rememberToken(local.world.id, local.token, local.playerId);
  const save = saveWorld(local.world, { players: local.host.roster(), hostId: local.playerId, paused: local.paused,
    savedAt: new Date().toISOString() });
  download(`space-sim-world-${local.world.id}.json`, JSON.stringify(save, null, 1));
  notify(`World saved with ${local.world.size} ${local.world.size === 1 ? 'ship' : 'ships'}. A dedicated server can run it with --import.`);
  profiler.event('world-save', { ships: local.world.size });
});
const worldFileInput = element<HTMLInputElement>('world-file');
element('load-world').addEventListener('click', () => worldFileInput.click());
worldFileInput.addEventListener('change', async () => {
  const file = worldFileInput.files?.[0];
  if (!file) return;
  const originalWorld = session.world;
  try {
    if (session !== local || local.hosting) throw new Error('Load worlds in your solo game.');
    if (file.size > 64 * 1024 * 1024) throw new Error('World files must be at most 64 MiB.');
    const text = await file.text();
    if (session.world !== originalWorld || session !== local || local.hosting) throw new Error('The active session changed while loading.');
    const installedProfile = worldModules(local.world);
    const loaded = loadInstalledWorld(JSON.parse(text), { environment: environment(),
      data: worldModules(local.world)?.data, code: [...GAME_EXAMPLES, ...moduleLibrary.modules(environment()).filter(m => m.manifest.authority === 'authoritative'
        && worldModules(local.world)?.profile.modules.some(ref => ref.id === m.manifest.id))] });
    if (loaded.prepared) rememberWorldModules(loaded.world, { data: worldModules(local.world)?.data ?? [], profile: loaded.prepared.profile,
      baseUniverse: installedProfile?.baseUniverse ?? loaded.world.universe,
      universeKey: installedProfile?.universeKey ?? `builtin.content/${loaded.world.universe.id}`, createContext: loaded.prepared.createContext });
    if (!universes.has(loaded.world.universe.id)) universes.set(loaded.world.universe.id, loaded.world.universe);
    replaceLocalWorld(loaded.world, { players: loaded.players, ...(loaded.hostId ? { hostId: loaded.hostId } : {}) });
    setPaused(true, 'World loaded');
    profiler.event('world-load', { world: loaded.world.id, ships: loaded.world.size });
  } catch (error) {
    alert(`World was not loaded: ${message(error)}`);
  } finally {
    worldFileInput.value = '';
  }
});

function executeAction(action: ActionId): void {
  switch (action) {
    case 'warpUp':
      warpUp();
      break;
    case 'warpDown':
      warpDown();
      break;
    case 'warpReset':
      resetWarp();
      break;
    case 'pause':
      setPaused(!session.paused);
      break;
    case 'reset':
      reset();
      break;
    case 'camera':
      toggleCamera();
      break;
    case 'orientation':
      toggleOrientation();
      break;
    case 'fullscreen':
      toggleFullscreen();
      break;
    case 'profiler':
      toggleProfiler();
      break;
    case 'zoomIn':
      changeZoom(1.3);
      break;
    case 'zoomOut':
      changeZoom(1 / 1.3);
      break;
    case 'cycleShip':
      cycleShip(1);
      break;
    case 'cycleShipPrev':
      cycleShip(-1);
      break;
  }
}

gamepadManager.onShortcut(action => executeAction(action));
touchControls.onShortcut(action => executeAction(action));
touchControls.attach(element('flight-view').parentElement!);

bindFlightInput({
  keys, pointers, paused: () => session.paused, autoPause, visibility: updateBackground,
  isFlightKey(code) {
    const actions = keyLookup.get(code);
    return actions ? actions.some(isFlightAction) : false;
  },
  isShortcutKey(code) {
    const actions = keyLookup.get(code);
    return actions ? actions.some(a => !isFlightAction(a)) : false;
  },
  command(code) {
    const command = commandBar.byKey(code);
    if (command) issueCommand(command);
    return !!command;
  },
  shortcut(code) {
    const actions = keyLookup.get(code);
    if (actions) {
      for (const action of actions) {
        if (!isFlightAction(action)) executeAction(action);
      }
    }
  },
});

// Controls & Remapping Modal Management
let listeningChip: { action: ActionId; keyIndex?: number; element: HTMLElement } | null = null;
let diagnosticsRaf: number | undefined;

function stopListening(): void {
  if (listeningChip) {
    listeningChip.element.classList.remove('listening');
    renderKeybindingsList();
    listeningChip = null;
  }
}

function renderKeybindingsList(): void {
  keybindingsList.innerHTML = '';

  for (const def of ACTION_DEFINITIONS) {
    const row = document.createElement('div');
    row.className = 'key-action-row';

    const info = document.createElement('div');
    info.className = 'key-action-info';

    const name = document.createElement('span');
    name.className = 'key-action-name';
    name.textContent = def.name;

    const desc = document.createElement('span');
    desc.className = 'key-action-desc';
    desc.textContent = def.description;

    info.appendChild(name);
    info.appendChild(desc);
    row.appendChild(info);

    const badges = document.createElement('div');
    badges.className = 'key-badges-cell';

    const currentKeys = keybindings[def.id] || [];
    currentKeys.forEach((k, idx) => {
      const chip = document.createElement('span');
      chip.className = 'key-chip';
      chip.setAttribute('role', 'button');
      chip.setAttribute('tabindex', '0');
      chip.title = `Click to remap ${formatKeyCode(k)}`;

      const label = document.createElement('span');
      label.textContent = formatKeyCode(k);
      chip.appendChild(label);

      const remove = document.createElement('span');
      remove.className = 'remove-key';
      remove.textContent = '×';
      remove.title = 'Remove key';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        currentKeys.splice(idx, 1);
        saveKeybindings(keybindings);
        refreshKeyLookup();
        renderKeybindingsList();
      });
      chip.appendChild(remove);

      chip.addEventListener('click', () => {
        stopListening();
        listeningChip = { action: def.id, keyIndex: idx, element: chip };
        chip.classList.add('listening');
        label.textContent = 'Press key...';
      });

      badges.appendChild(chip);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-key-btn';
    addBtn.textContent = '+ Add';
    addBtn.title = `Add alternative key for ${def.name}`;
    addBtn.addEventListener('click', () => {
      stopListening();
      listeningChip = { action: def.id, element: addBtn };
      addBtn.classList.add('listening');
      addBtn.textContent = 'Press key...';
    });
    badges.appendChild(addBtn);

    row.appendChild(badges);
    keybindingsList.appendChild(row);
  }
}

// Global capture listener when remapping a key in the modal
window.addEventListener('keydown', (e) => {
  if (!listeningChip) return;
  e.preventDefault();
  e.stopPropagation();

  if (e.code === 'Escape') {
    stopListening();
    return;
  }

  const { action, keyIndex } = listeningChip;
  const list = keybindings[action] || [];

  if (keyIndex !== undefined) {
    if (e.code === 'Backspace' || e.code === 'Delete') {
      list.splice(keyIndex, 1);
    } else {
      list[keyIndex] = e.code;
    }
  } else {
    if (!list.includes(e.code) && e.code !== 'Backspace' && e.code !== 'Delete') {
      list.push(e.code);
    }
  }

  saveKeybindings(keybindings);
  refreshKeyLookup();
  stopListening();
}, true);

function renderGamepadTab(): void {
  const settings = gamepadManager.getSettings();
  gamepadEnabled.checked = settings.enabled;
  gamepadDeadzone.value = String(Math.round(settings.deadzone * 100));
  deadzoneValue.textContent = `${Math.round(settings.deadzone * 100)}%`;
  gamepadTurnAxis.value = String(settings.turnAxis);
  gamepadTurnInvert.checked = settings.invertTurn;
  gamepadThrottleAxis.value = String(settings.throttleAxis);
  gamepadThrottleInvert.checked = settings.invertThrottle;
  touchOverlayMode.value = touchControls.getMode();
}

function updateGamepadDiagnostics(): void {
  const diags = gamepadManager.getDiagnostics();
  const primary = diags.find(d => d.connected);

  if (!primary) {
    gamepadStatus.textContent = 'No controller detected. Connect a Steam Deck, Xbox, PlayStation (DualSense / DualShock), or joystick and press any button.';
    gamepadStatus.classList.remove('connected');
    gamepadAxesDisplay.innerHTML = '<span class="control-note">Waiting for controller input…</span>';
    gamepadButtonsDisplay.innerHTML = '';
    return;
  }

  const tagClass = primary.family;
  gamepadStatus.innerHTML = `Connected: <b>${primary.id}</b> <span class="gamepad-family-tag ${tagClass}">${primary.familyName}</span> (${primary.axes.length} axes, ${primary.buttons.length} buttons)`;
  gamepadStatus.classList.add('connected');

  if (gamepadTurnAxis.options.length !== primary.axes.length) {
    gamepadTurnAxis.innerHTML = '';
    gamepadThrottleAxis.innerHTML = '';
    for (let i = 0; i < primary.axes.length; i++) {
      const optT = document.createElement('option');
      optT.value = String(i);
      optT.textContent = `Axis ${i}${i === 0 ? ' (Left Stick X / Roll)' : i === 1 ? ' (Left Stick Y / Pitch)' : i === 2 ? ' (Right Stick X)' : i === 3 ? ' (Right Stick Y)' : ''}`;
      gamepadTurnAxis.appendChild(optT);

      const optP = document.createElement('option');
      optP.value = String(i);
      optP.textContent = `Axis ${i}${i === 0 ? ' (Left Stick X / Roll)' : i === 1 ? ' (Left Stick Y / Pitch)' : i === 2 ? ' (Right Stick X)' : i === 3 ? ' (Right Stick Y)' : ''}`;
      gamepadThrottleAxis.appendChild(optP);
    }
    const currentSettings = gamepadManager.getSettings();
    gamepadTurnAxis.value = String(currentSettings.turnAxis);
    gamepadThrottleAxis.value = String(currentSettings.throttleAxis);
  }

  let axesHtml = '';
  primary.axes.forEach((val, i) => {
    const clamped = Math.max(-1, Math.min(1, val));
    const widthPct = Math.abs(clamped) * 50;
    const leftPct = clamped < 0 ? 50 - widthPct : 50;
    axesHtml += `
      <div class="axis-meter">
        <span class="axis-meter-label">Axis ${i}</span>
        <div class="axis-meter-track">
          <div class="axis-meter-center"></div>
          <div class="axis-meter-fill" style="left: ${leftPct}%; width: ${widthPct}%;"></div>
        </div>
        <span class="axis-meter-val">${clamped >= 0 ? '+' : ''}${clamped.toFixed(2)}</span>
      </div>`;
  });
  gamepadAxesDisplay.innerHTML = axesHtml;

  let buttonsHtml = '';
  primary.buttons.forEach((btn, i) => {
    buttonsHtml += `<span class="btn-indicator ${btn.pressed ? 'pressed' : ''}" title="Button ${i}: ${btn.label}">${btn.label.slice(0, 3)}</span>`;
  });
  gamepadButtonsDisplay.innerHTML = buttonsHtml;
}

function startDiagnosticsLoop(): void {
  if (diagnosticsRaf) return;
  const tick = () => {
    if (controlsDialog.open) {
      updateGamepadDiagnostics();
      diagnosticsRaf = requestAnimationFrame(tick);
    } else {
      diagnosticsRaf = undefined;
    }
  };
  diagnosticsRaf = requestAnimationFrame(tick);
}

function stopDiagnosticsLoop(): void {
  if (diagnosticsRaf) {
    cancelAnimationFrame(diagnosticsRaf);
    diagnosticsRaf = undefined;
  }
}

controlsToggle.addEventListener('click', () => {
  renderKeybindingsList();
  renderGamepadTab();
  controlsDialog.showModal();
  startDiagnosticsLoop();
});

controlsClose.addEventListener('click', () => {
  stopListening();
  controlsDialog.close();
  stopDiagnosticsLoop();
});

controlsDialog.addEventListener('close', () => {
  stopListening();
  stopDiagnosticsLoop();
});

function selectControlsTab(tab: 'keyboard' | 'gamepad' | 'touch'): void {
  tabKeyboardBtn.classList.toggle('active', tab === 'keyboard');
  tabKeyboardBtn.setAttribute('aria-selected', String(tab === 'keyboard'));
  tabGamepadBtn.classList.toggle('active', tab === 'gamepad');
  tabGamepadBtn.setAttribute('aria-selected', String(tab === 'gamepad'));
  tabTouchBtn.classList.toggle('active', tab === 'touch');
  tabTouchBtn.setAttribute('aria-selected', String(tab === 'touch'));

  tabKeyboard.hidden = tab !== 'keyboard';
  tabGamepad.hidden = tab !== 'gamepad';
  tabTouch.hidden = tab !== 'touch';

  if (tab === 'gamepad') renderGamepadTab();
  if (tab === 'touch') touchOverlayMode.value = touchControls.getMode();
}

tabKeyboardBtn.addEventListener('click', () => selectControlsTab('keyboard'));
tabGamepadBtn.addEventListener('click', () => selectControlsTab('gamepad'));
tabTouchBtn.addEventListener('click', () => selectControlsTab('touch'));

touchOverlayMode.addEventListener('change', () => {
  touchControls.saveMode(touchOverlayMode.value as TouchMode);
});

resetKeybindingsBtn.addEventListener('click', () => {
  keybindings = resetKeybindings();
  refreshKeyLookup();
  renderKeybindingsList();
});

resetGamepadBtn.addEventListener('click', () => {
  gamepadManager.resetSettings();
  renderGamepadTab();
});

gamepadEnabled.addEventListener('change', () => {
  gamepadManager.saveSettings({ enabled: gamepadEnabled.checked });
});
gamepadDeadzone.addEventListener('input', () => {
  const val = Number(gamepadDeadzone.value);
  deadzoneValue.textContent = `${val}%`;
  gamepadManager.saveSettings({ deadzone: val / 100 });
});
gamepadTurnAxis.addEventListener('change', () => {
  gamepadManager.saveSettings({ turnAxis: Number(gamepadTurnAxis.value) });
});
gamepadTurnInvert.addEventListener('change', () => {
  gamepadManager.saveSettings({ invertTurn: gamepadTurnInvert.checked });
});
gamepadThrottleAxis.addEventListener('change', () => {
  gamepadManager.saveSettings({ throttleAxis: Number(gamepadThrottleAxis.value) });
});
gamepadThrottleInvert.addEventListener('change', () => {
  gamepadManager.saveSettings({ invertThrottle: gamepadThrottleInvert.checked });
});
window.addEventListener('error', event => profiler.event('error',
  { message: event.message, source: event.filename, line: event.lineno, column: event.colno }));
window.addEventListener('unhandledrejection', event => profiler.event('error', { message: String(event.reason) }));

/** Hidden tabs get no animation frames; a hosting tab keeps its players' world moving on
 * a timer, which browsers slow to about once a second. */
let background: ReturnType<typeof setInterval> | undefined;
let backgroundAt = 0;
function updateBackground(): void {
  const wanted = document.hidden && isHosting();
  if (wanted && !background) {
    backgroundAt = performance.now();
    background = setInterval(() => {
      const now = performance.now();
      handleEvents(local.catchUp((now - backgroundAt) / 1000, selectedShipId));
      backgroundAt = now;
    }, 100);
  } else if (!wanted && background) {
    clearInterval(background);
    background = undefined;
    lastWall = undefined;
  }
}

function updatePrediction(seconds: number, engine: boolean): void {
  prediction.update(session.world.context, state, activeBody, session.world.surface(activeBody.id),
    selectedShip()?.id, seconds, engine, selectedShip()?.controls, session.world);
}

function activeOrbitSource(): { readonly position: Vec; readonly velocity: Vec } {
  return state.coast?.bodyId === activeBody.id && state.coast.mu === activeBody.mu ? state.coast : state;
}

function groundClearance(): number {
  const surface = session.world.surface(activeBody.id);
  const ground = surface ? querySurface(surface, Math.atan2(state.position.y, state.position.x)).firstContactRadius : activeBody.radius;
  return magnitude(state.position) - ground;
}

function diagnostics(engine: boolean): Record<string, unknown> {
  const summary = profiler.summary();
  const world = session.world;
  return {
    renderer: presentation.provider.id, shader: presentation.rendering.shaders.name,
    presentation: presentation.diagnostics(), commands: world.commands.map(c => c.id),
    fingerprint: world.simulationFingerprint,
    physicalTerrain: world.surfaces.size > 0,
    contact: lastTerrainContact ?? null,
    groundClearance: groundClearance(),
    water: state.water ?? null,
    waterDepth: Math.max(0, (world.surface(activeBody.id)?.seaRadiusMetres ?? 0) - magnitude(state.position)),
    predictionLast: prediction.path.at(-1) ?? null,
    vehicle: world.context.vehicle, soloPreview: world.soloPreview,
    model: MODEL, body: activeBody.id, system: world.systemId, universe: world.universe.id,
    session: session === local ? (local.hosting ? 'host' : 'local') : 'client', world: world.id,
    ship: selectedShipId ?? null, ships: world.size, asleep: world.asleepCount, fleetView: { ...fleetView.stats },
    players: session.players().filter(p => p.connected).length,
    rttMs: remote && Number.isFinite(remote.client.rttMs) ? +remote.client.rttMs.toFixed(1) : null,
    stepSeconds: STEP, tick: world.tick, steps: session === local ? local.clockStats.steps : null,
    droppedSeconds: session === local ? local.clockStats.droppedSeconds : null,
    dynamics: state.dynamics ?? 'numerical', coastEpochSeconds: state.coast?.epochSeconds ?? null,
    solver: state.solver ?? null, orbit: world.context.capabilities.orbitalDiagnostics ? world.context.services.orbits.elements(activeOrbitSource(), activeBody.mu) : null,
    motionCapabilities: world.context.capabilities, modelIdentity: world.context.modelIdentity,
    coastCache: world.context.coastCacheStats(state.coast),
    samples: prediction.path.length, predictionEnd: prediction.pass && prediction.passKey !== prediction.pathKey ? 'tracing' : prediction.pathEnd, predictionPasses: prediction.passCount,
    predictionWorkMs: prediction.lastPass.workMs, predictionCoarse: prediction.lastPass.coarse,
    workP50Ms: summary.work.p50.toFixed(2), workP95Ms: summary.work.p95.toFixed(2), workP99Ms: summary.work.p99.toFixed(2),
    workWorstMs: summary.work.max.toFixed(2), simulationP95Ms: summary.sections.physics.p95.toFixed(2),
    predictionP95Ms: summary.sections.prediction.p95.toFixed(2),
    renderP95Ms: profiler.group(['background', 'planet', 'path', 'ship', 'overlay']).p95.toFixed(2),
    intervalP95Ms: summary.interval.p95.toFixed(2), slowFrames: summary.slowFrames,
    viewport: `${canvas.clientWidth}×${canvas.clientHeight}`, dpr: window.devicePixelRatio,
    time: state.time, engine: engine && !session.paused, position: state.position, velocity: state.velocity, heading: state.heading,
    godMode: state.godMode ?? false,
    camera: { ...cameraControl.last, follow: cameraControl.follow, mode: cameraControl.mode },
  };
}

function hud(engine: boolean): void {
  syncCameraButton();
  commandBar.sync(session.world.commands);
  const terrainNotice = element('terrain-notice');
  terrainNotice.hidden = session.world.surfaces.size === 0;
  const ship = selectedShip();
  const paused = session.paused;
  const r = magnitude(state.position);
  const radial = (state.position.x * state.velocity.x + state.position.y * state.velocity.y) / r;
  show('altitude', ship ? Math.max(0, groundClearance()).toFixed(1) : '—');
  show('speed', magnitude(state.velocity).toFixed(1));
  show('vertical', `${radial >= 0 ? '+' : ''}${radial.toFixed(1)}`);
  show('heading', ((state.heading * 180 / Math.PI + 360) % 360).toFixed(0));
  show('time', `${Math.floor(state.time / 60).toString().padStart(2, '0')}:${(state.time % 60).toFixed(2).padStart(5, '0')}`);
  syncWarpUI();
  show('status', paused ? 'PAUSED' : !ship ? 'NO SHIP' : ship.fault ? 'STOPPED'
    : state.water && state.status !== 'crashed' ? state.water.toUpperCase() : state.status.toUpperCase());
  show('active-body', activeBody.name.toUpperCase());
  show('throttle-value', `${Math.round(state.throttle * 100)}%`);
  if (document.activeElement !== slider) slider.value = String(Math.round(state.throttle * 100));
  const burning = String(engine && !paused);
  if (shown.get('burn') !== burning) { element('burn').setAttribute('aria-pressed', burning); shown.set('burn', burning); }
  show('prediction', prediction.text(state));
  const analytic = session.world.context.capabilities.orbitalDiagnostics;
  const orbit = analytic && ship && state.status === 'flying' ? session.world.context.services.orbits.elements(activeOrbitSource(), activeBody.mu) : null;
  show('periapsis', !analytic ? 'Unavailable · custom motion' : !orbit ? '—'
    : `${(orbit.periapsis - activeBody.radius).toFixed(1)} m`);
  show('apoapsis', !analytic ? 'Unavailable · custom motion' : !orbit ? '—'
    : orbit.apoapsis === null ? 'Escape' : `${(orbit.apoapsis - activeBody.radius).toFixed(1)} m`);
  syncPauseButton();
  show('flight-message', performance.now() < notice.until ? notice.text
    : session.world.fault ? `${session.world.fault}. Reset flight to restart the world.`
    : paused ? session === local ? `${session.pauseReason || 'Flight paused'}. Select Resume to continue.`
      : `${session.pauseReason}. The flight continues when the host resumes.`
    : !ship ? 'No ship to pilot. Launch one under Fleet when there is room.'
    : ship.fault ? `Motion stopped: ${ship.fault} Reset flight to try again.`
    : state.status === 'crashed' ? `${state.water ? 'Heavy water impact' : 'Surface impact'} on ${activeBody.name}. Reset flight to try again.`
      : state.water === 'floating' ? 'Floating on water. Thrust outward to launch or inward to dive.'
        : state.water === 'submerged' ? `Underwater · depth ${Math.max(0, -groundClearance()).toFixed(2)} m. Buoyancy and drag act on the ship.`
      : state.status === 'landed' ? `On the surface of ${activeBody.name}. Hold Space to launch.`
        : engine ? 'ENGINE ACTIVE · Coast preview assumes cutoff now' : 'COASTING · Let momentum do the work');
}

function profilerPanelUpdate(): void {
  const summary = profiler.summary();
  show('profiler-fps', `${summary.fps.toFixed(0)} FPS · work p95 ${summary.work.p95.toFixed(2)} ms`);
  updateRows(summary);
  const slow = profiler.lastSlow;
  show('profiler-slow', slow ? `Slow frames ${summary.slowFrames} · last ${(performance.now() / 1000 - slow.t).toFixed(1)} s ago: `
    + `${slow.intervalMs as number} ms, ${slow.cause as string}` : 'No slow frames');
  profiler.drawGraph(element<HTMLCanvasElement>('profiler-graph'));
}

function exportLog(): void {
  const now = new Date();
  const report = {
    format: 'space-sim-log/1', exportedAt: now.toISOString(), sessionStartedAt: profiler.startedAt.toISOString(),
    model: MODEL, note: 'Local diagnostic log created by the player. Nothing is uploaded.',
    environment: { userAgent: navigator.userAgent, language: navigator.language,
      hardwareConcurrency: navigator.hardwareConcurrency, screen: `${screen.width}×${screen.height}`,
      viewport: `${canvas.clientWidth}×${canvas.clientHeight}`, dpr: window.devicePixelRatio, precise: profiler.precise },
    diagnostics: diagnostics(controls().engine), profile: profiler.summary(),
    events: profiler.log(), frames: profiler.history(),
  };
  const text = JSON.stringify(report, null, 2);
  download(`space-sim-log-${now.toISOString().replace(/[:.]/g, '-')}.json`, text);
  profiler.event('export', { bytes: new Blob([text]).size });
}

/** World events for the piloted ship: contacts, and motion faults in a solo world. */
function handleEvents(events: readonly WorldEvent[]): void {
  for (const event of events) {
    if (event.type === 'world-fault') {
      invalidatePrediction();
      if (isSolo()) setPaused(true, event.message);
      continue;
    }
    if (event.shipId !== selectedShipId) continue;
    if (event.type === 'contact') {
      lastTerrainContact = event.contact;
      profiler.event('terrain-contact', { ...event.contact, status: event.status, position: selectedShip()?.state.position });
    } else if (event.type === 'fault') {
      profiler.event('motion-failed', { message: event.message, time: state.time });
      invalidatePrediction();
      if (isSolo()) setPaused(true, `Motion stopped: ${event.message}`);
    }
  }
}

const fleetView = new FleetView();
function otherShips(time: number, alpha: number, camera: Camera): RenderShip[] {
  return fleetView.build({ world: session.world, time, alpha, paused: session.paused, skipId: selectedShipId,
    playerId: session.playerId, camera, width: canvas.clientWidth, height: canvas.clientHeight,
    previous: id => session.previous(id), displayOffset: id => session.displayOffset(id),
    playerName: id => session.playerName(id),
    isRock: ship => ship.ownerId === STRESS_OWNER && ship.id.startsWith(STRESS_ROCK_PREFIX) });
}

/** What the pilot sees, for presentation modules: interpolated, detached and frozen. */
function presentationView(elapsed: number, bodyPosition: Vec): PresentationSnapshot {
  const world = session.world, ship = selectedShip(), last = prediction.path.at(-1);
  const analyticOrbits = world.context.capabilities.orbitalDiagnostics;
  return presentationSnapshot({
    time: view.time, tick: world.tick, paused: session.paused, elapsed,
    viewport: { width: canvas.clientWidth, height: canvas.clientHeight, pixelRatio: window.devicePixelRatio || 1 },
    body: { id: activeBody.id, name: activeBody.name, radius: activeBody.radius, mu: activeBody.mu, position: bodyPosition },
    ...(ship ? { ship: { id: ship.id, name: ship.name, bodyId: activeBody.id, state: view, controls: ship.controls,
      position: { x: bodyPosition.x + view.position.x, y: bodyPosition.y + view.position.y }, ...(ship.fault ? { fault: ship.fault } : {}) } } : {}),
    vehicle: world.context.vehicle, analyticOrbits,
    orbit: analyticOrbits && ship && state.status === 'flying' ? world.context.services.orbits.elements(activeOrbitSource(), activeBody.mu) : null,
    groundClearance: ship ? groundClearance() : null,
    prediction: { status: !ship ? 'none' : prediction.pass && prediction.passKey !== prediction.pathKey ? 'tracing' : prediction.pathEnd,
      samples: prediction.path.length, ...(last ? { last } : {}) },
    moduleState: world.moduleState,
  });
}

function frame(now: number): void {
  const elapsed = lastWall === undefined ? 0 : (now - lastWall) / 1000;
  lastWall = now;
  profiler.begin(elapsed * 1000);
  const command = session.paused ? IDLE : controls();
  handleEvents(session.update(elapsed, selectedShipId, command));
  syncSelected();
  if (state.status !== lastStatus) {
    profiler.event('status', { from: lastStatus, to: state.status, time: state.time,
      speed: +magnitude(state.velocity).toFixed(2) });
    lastStatus = state.status;
  }
  profiler.lap('physics');
  const ship = selectedShip();
  const engine = command.engine && !session.paused && !!ship;
  updatePrediction(elapsed, engine);
  profiler.lap('prediction');
  const before = selectedShipId ? session.previous(selectedShipId) : undefined;
  view = session.paused || !before || before.bodyId !== activeBody.id ? state : interpolateState(before.state, state, session.alpha);
  if (ship) {
    const offset = session.displayOffset(ship.id);
    if (offset.x || offset.y) view = { ...view, position: { x: view.position.x + offset.x, y: view.position.y + offset.y } };
  }
  // Resolved bodies for renderer
  const world = session.world;
  const renderBodies = world.system.getAllBodies().map(b => {
    const pos = world.system.getBodyPosition(b.id, view.time);
    const parentPos = b.parentId ? world.system.getBodyPosition(b.parentId, view.time) : undefined;
    const orbitR = b.ephemeris.kind === 'circular-kepler'
      ? (b.ephemeris.radius ?? b.ephemeris.radiusMetres)
      : undefined;
    return {
      id: b.id,
      name: b.name,
      position: pos,
      radius: b.radius,
      surface: world.surface(b.id),
      color: b.color,
      accentColor: b.accentColor,
      atmosphereColor: b.atmosphereColor,
      horizonColor: b.horizonColor,
      skyColor: b.skyColor,
      surfaceFeatures: b.surfaceFeatures,
      parentPosition: parentPos,
      orbitRadius: orbitR,
    };
  });

  const activeBodyPos = world.system.getBodyPosition(activeBody.id, view.time);
  const shipWorld = ship ? bodyWorldPosition(activeBody.id, view.time, view.position) : { x: 1e30, y: 1e30 };
  const pad = padSites.get(world)!.get(activeBody.id);
  const padWorld = pad ? { x: activeBodyPos.x + pad.position.x, y: activeBodyPos.y + pad.position.y } : { x: 1e30, y: 1e30 };

  // Presentation hooks share one frozen snapshot, built only when a module needs it.
  const width = canvas.clientWidth, height = canvas.clientHeight;
  let snapshot: PresentationSnapshot | undefined;
  const base = (): PresentationSnapshot => snapshot ??= presentationView(elapsed, activeBodyPos);
  const mode = cameraControl.mode;
  const target = mode !== 'follow' && mode !== 'free'
    ? presentation.camera(mode, () => Object.freeze({ ...base(), scale: cameraControl.scale(width, height) })) : undefined;
  const camera = cameraControl.update({ body: activeBodyPos, ship: view.position, elapsed, instant: reducedMotion.matches,
    width, height, ...(target ? { target } : {}) });
  if (mode !== cameraControl.mode) syncCameraButton();
  const overlays = presentation.overlays(() => Object.freeze({ ...base(), camera }));
  const others = otherShips(view.time, session.alpha, camera);
  presentation.rendering.renderer!.draw({
    state: view,
    path: prediction.path,
    pathClosed: prediction.pathEnd === 'closed' && (!prediction.pass || prediction.pathKey === prediction.passKey),
    engine,
    camera,
    bodies: renderBodies,
    shipWorldPosition: shipWorld,
    pathOrigin: activeBodyPos,
    padPosition: padWorld,
    padNormal: pad?.normal,
    shipLabel: ship?.name.toUpperCase(),
    ships: others,
    ...(overlays ? { overlays } : {}),
  }, profiler);

  // Staggered DOM work: HUD at 12.5 Hz, diagnostics, lists and profiler panel at 4 Hz.
  if (now - lastHud > 80) { hud(engine); lastHud = now; }
  if (now - lastDebug > 250) {
    element('debug').textContent = JSON.stringify(diagnostics(engine), null, 2); lastDebug = now;
  }
  if (now - lastLists > 250) {
    updateLists(); lastLists = now;
    presentation.updatePanels(() => Object.freeze({ ...base(), camera }));
  }
  if (!profilerPanel.hidden && now - lastPanel > 250) { profilerPanelUpdate(); lastPanel = now; }
  const size = `${canvas.width}×${canvas.height}@${window.devicePixelRatio}`;
  if (size !== lastSize) { profiler.event('canvas', { size }); lastSize = size; }
  profiler.lap('hud');
  profiler.end();
  requestAnimationFrame(frame);
}

// Start: a solo world with one ship at the first scenario.
const initialGame = prepareLocalWorld(DEFAULT_UNIVERSE, defaultGame.bundle.selection.system, {
  data: defaultGame.bundle.modules, profile: requested.example ? exampleProfile(requested.example) : defaultGame.bundle.profile,
  universeKey: defaultGame.bundle.selection.universe,
});
initialGame.runtime.activate(initialGame.candidate);
local = new LocalSession(initialGame.world, { name: pilotName() });
session = local;
syncPresetSelect();
local.spawn(local.world.presetId(preset.value || 'pad'), false);
moduleManager = new ModuleManager(presentation, {
  current: () => ({ profile: worldModules(local.world)?.profile ?? DEFAULT_PROFILE,
    data: worldModules(local.world)?.data ?? [], editable: session === local && !local.hosting,
    universe: worldModules(local.world)?.baseUniverse ?? local.world.universe, universeKey: worldModules(local.world)?.universeKey ?? `builtin.content/${local.world.universe.id}`,
    resolvedUniverse: local.world.universe,
    systemId: local.world.systemId }),
  apply: (profile, data, selection) => {
    const current = worldModules(local.world);
    const prepared = prepareLocalWorld(current?.baseUniverse ?? local.world.universe, selection.system,
      { data, profile, universeKey: selection.universe });
    replaceLocalWorld(prepared.world);
    prepared.runtime.activate(prepared.candidate);
    reset();
  },
});
labManager = new LabManager({
  builtin: defaultGame,
  install: plugin => moduleManager!.install(plugin), legacy: loadModuleText,
  universe: universe => { importUniverse(universe); show('universe-status', `Loaded ${universe.name}. Export a compressed universe or save its setup as a game.`); },
  editable: () => session === local && !local.hosting,
  world: () => session.world,
  capture: () => {
    const bundle = currentModuleBundle();
    return { format: 'space-lab-game/1', info: { ...activeGameInfo, id: `local.game-${crypto.randomUUID()}` }, bundle,
      plugins: moduleLibrary.artifacts.filter(a => bundle.code?.some(ref => ref.id === a.manifest.id)) };
  },
  play: game => {
    if (session !== local || local.hosting) throw new Error('Leave multiplayer before switching games');
    const code = artifactModules(game.plugins, environment());
    const authoritative = [...GAME_EXAMPLES, ...code.filter(m => m.manifest.authority === 'authoritative')];
    const display = code.filter(m => m.manifest.authority === 'presentation');
    const displayProfile = presentation.compatibleGameProfile(game.bundle.presentation ?? presentationProfile(presentation.provider.id));
    // Resolve both profiles before any initializer or source evaluation.
    createBuiltinRegistry(game.bundle.modules, authoritative).resolve(game.bundle.profile, environment(), ['motion', 'content']);
    createPresentationRegistry([...PRESENTATION_EXAMPLES, ...display]).resolve(displayProfile, environment(), ['renderer']);
    const prepared = prepareLocalWorld(DEFAULT_UNIVERSE, game.bundle.selection.system,
      { data: game.bundle.modules, profile: game.bundle.profile, universeKey: game.bundle.selection.universe, code: authoritative });
    let next: LocalSession;
    try {
      next = new LocalSession(prepared.world, { name: pilotName() });
      presentation.applyGame(display, displayProfile);
    } catch (error) { prepared.candidate.dispose(); throw error; }
    prepared.runtime.activate(prepared.candidate);
    moduleLibrary.replace(game.plugins);
    moduleManager!.resetData(game.bundle.modules);
    local.world.dispose();
    local = next;
    activeGameInfo = { ...game.info };
    useSession(local, false);
    reset();
  },
});
void labManager.start();
element('presentation-list').addEventListener('change', () => moduleManager?.refresh());
useSession(local);
if (document.querySelector('meta[name="space-sim-server"]')) {
  // This page came from a dedicated server: joining it is one click away.
  joinInput.value = location.origin;
  mpStatus('This page comes from a Space Sim server. Enter your pilot name and choose Join.');
}
profiler.event('session', { model: MODEL, userAgent: navigator.userAgent });
requestAnimationFrame(frame);
