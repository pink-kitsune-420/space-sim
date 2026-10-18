import { canonicalJson } from '../../../packages/game-runtime/src/authoritative';
import { installGamePackages } from '../../../packages/game-library/src/runtime-selection';
import { LocalPilotRegistry } from './local-players';
import { ALLOW_RUNTIME_CODE } from '../../../packages/game-runtime/src/build-policy';
import { reconstructProgress, savedProgressConfiguration } from '../../../packages/game-library/src/progress-configuration';
import { isZip } from '../../../packages/game-library/src/zip';
import { createBuiltinRegistry, loadInstalledWorld, DEFAULT_PROFILE, MAX_MODULE_BYTES, universeDataModule, validateDataModule, type DataModule } from '../../../packages/modules/src/index';
import { GAME_EXAMPLES, PRESENTATION_EXAMPLES, exampleProfile } from '../../../examples/modules/index';
import { moduleLibrary } from './module-library';
import { ModuleManager } from './module-manager';
import { LabManager } from './lab-manager';
import { Workspace } from './workspace';
import { initHudLayout } from './hud-layout';
import { HudVisibility } from './hud-visibility';
import { initChatWindow } from './chat-window';
import { initFlightWindows } from './flight-windows';
import { initManual } from './manual';
import { artifactModules, validatePackage, type GamePackage } from '../../../packages/game-library/src/archive';
import { createPresentationRegistry, presentationProfile } from '../../../packages/modules/src/browser';
import builtinGame from '../../../games/space-sim/game.json' with { type: 'json' };
import builtinOrbitSandbox from '../../../games/orbit-sandbox/game.json' with { type: 'json' };
import { initOrbitSandbox, type OrbitSandboxInstance } from '../../orbit-sandbox/src/main';
import universeCatalog from '../../../games/space-sim/universes/catalog.json';
import { encodeUniverseSave, decodeUniverseSave } from '../../../packages/game-library/src/save-package';
import { decodeDataFile, encodeDataFile } from '../../../packages/game-library/src/data-file';
import { encodeUniverse, decodeUniverse } from '../../../packages/game-library/src/universe';
import { MAX_ARCHIVE_BYTES } from '../../../packages/game-library/src/compression';
import { parseModuleImport, type ModuleBundle } from './modules';
import { bindFlightInput } from './input';
import {
  ACTION_DEFINITIONS, buildKeyLookup, formatKeyCode, isFlightAction, loadKeybindings,
  resetKeybindings, saveKeybindings, type ActionId, type KeyBindings,
} from './input-config';
import { GamepadManager, isButtonDown } from './gamepad';
import { TouchControlsManager, type TouchMode } from './touch-controls';
import { SplitScreen, GuestPilot } from './split-screen';
import { ControllerMenu } from './controller-menu';
import { PLAYER_COLORS, setPlayerCount, setSlotNavball, defaultNavballPlacement } from './local-players';
import { shipNavballState, shipAutoFrame, drawNavball, setNavballPlacementProvider, navballFootprint, TRACK as NAVBALL_TRACK, GLYPH as NAVBALL_GLYPH, type NavballFrame } from '../../../packages/modules/src/base/toolset/navball';
import { ThrottleLever, THROTTLE_LEVER_SPACE, type ThrottleLeverState } from './throttle-lever';
import { builtinUniverses, createLocalWorld, prepareLocalWorld, requestedModules, worldModules, rememberWorldModules, environment } from './startup';
import { Presentation, presentationSnapshot } from './presentation';
import { CameraController, findSmartThrowTarget, type SmartCandidate } from './camera';
import { CommandBar, checkCommandKeys } from './commands';
import { cache, shown, element, show, download, downloadBytes, message } from './ui';
import { Prediction } from './prediction';
import { OtherOrbits, showOtherOrbits, type OtherOrbitMode } from './other-orbits';
import { ManeuverPlanner } from './maneuver-planner';
import { SpinView } from './spin-view';
import { loadGraphicsQuality, saveGraphicsQuality } from './graphics';
import { PlanetDesigner } from './planet-designer';
import './style.css';
import {
  DEFAULT_UNIVERSE, IDLE, MODEL, STEP,
  magnitude, querySurface, nextWarpFactor, rotate, spinAngle, spinRate,
  findDominantBodyForWorldPos,
  type Controls, type ResolvedBody, type State,
  type UniverseDefinition, type Vec, type SurfaceContactEvent
} from '../../../packages/sim-core/src/index';
import { cleanName, type World, type Ship, type WorldEvent } from '../../../packages/sim-core/src/world';
import { MAX_PLAYER_NAME, saveWorld, type SavedPlayer } from '../../../packages/sim-core/src/save';
import { ClientSession } from '../../../packages/net/src/client';
import type { Connection } from '../../../packages/net/src/connection';
import { connectWebSocket, serverUrl } from '../../../packages/net/src/websocket';
import { LocalDiscovery, LocalHost, connectLocal, type LocalAdvert } from '../../../packages/net/src/broadcast';
import { lanCandidates, scanServers } from '../../../packages/net/src/discovery';
import { OCEAN_UNIVERSE, TERRAIN_UNIVERSE } from '../../../packages/scenarios/builtin';
import { type Camera, type RenderShip, saveThemeSettings, hashWorldSeed, screenToWorld, project } from '../../../packages/render-2d/src/index';
import { initThemeCustomizer } from './theme-customizer';
import type { CommandExtension, PresentationSnapshot, OverlayPrimitive } from '../../../packages/game-api/src/index';
import { Profiler, createRows } from './profiler';
import { FleetView } from './fleet-view';
import { STRESS_OWNER, STRESS_ROCK_PREFIX, clearStress, populateStress } from '../../../packages/scenarios/stress';
import { LocalSession, RemoteSession, SessionError, type ChatLine, type GameSession } from './session';
import { JoinIdentity, rememberToken, saveName, savedName, tokenFor } from './identity';
import { verifyServerCandidate } from './multiplayer-candidate';
import { answerInvite, createInvite, isInviteCode, isReplyCode, type ConnectionDiagnostics, type Invite, type Reply } from './webrtc';
import { connectionRequest, inviteFromText, inviteLink, serverLink, serverAddressForPage } from './connection-links';
import { desktopHostToken, hostOnComputer, type DesktopHost } from './desktop-host';

let canvas = element<HTMLCanvasElement>('flight-view');
let moduleManager: ModuleManager | undefined;
let labManager: LabManager | undefined;
const defaultGame = validatePackage(builtinGame) as GamePackage;
const orbitSandboxGame = validatePackage(builtinOrbitSandbox) as GamePackage;
let activeGameInfo = { ...defaultGame.info };
let orbitSandboxInstance: OrbitSandboxInstance | undefined;
/** Renderer provider, presentation modules and their hooks; started below once input exists. */
const presentation = new Presentation(canvas, {
  onCanvas: next => { canvas = next; cache.set('flight-view', next); attachCanvasListeners(next); },
  release: () => release(),
  event: (kind, detail) => profiler.event(kind, detail),
});
const profiler = new Profiler(() => presentation.rendering.renderer?.features?.flush?.());
const keys = new Set<string>();
const pointers = new Map<number, string>();
/** Persistent lever burns belong to one pilot, ship and world; held flight controls cancel them. */
const leverBurns: ({ world: object; shipId: string } | undefined)[] = new Array(4);
let restoreFullscreenOnResume = false;
const workspace = new Workspace(() => release(), () => {
  if (restoreFullscreenOnResume && !document.fullscreenElement) {
    requestAppFullscreen(true);
  }
});

const hudLayout = initHudLayout();
initFlightWindows(workspace);

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
const graphicsButton = element<HTMLButtonElement>('graphics-toggle');
let graphicsQuality = loadGraphicsQuality();
const themeCustomizer = initThemeCustomizer();
saveThemeSettings({ highQuality: graphicsQuality === 'high' });
function syncGraphicsButton(): void {
  graphicsButton.textContent = `Graphics: ${graphicsQuality === 'high' ? 'High' : 'Low'}`;
  graphicsButton.setAttribute('aria-pressed', String(graphicsQuality === 'high'));
}
syncGraphicsButton();
graphicsButton.addEventListener('click', () => {
  graphicsQuality = graphicsQuality === 'high' ? 'low' : 'high';
  saveGraphicsQuality(graphicsQuality);
  syncGraphicsButton();
  saveThemeSettings({ highQuality: graphicsQuality === 'high' });
  profiler.event('graphics', { quality: graphicsQuality });
});
const godModeToggle = element<HTMLInputElement>('god-mode');
const GOD_MODE_KEY = 'space-sim:god-mode:v1';
try {
  const savedGod = localStorage.getItem(GOD_MODE_KEY);
  if (savedGod !== null) godModeToggle.checked = savedGod === 'true';
} catch { /* ignore */ }
const runInBackgroundToggle = element<HTMLInputElement>('run-in-background');
const RUN_IN_BACKGROUND_KEY = 'space-sim:run-in-background:v1';
try {
  runInBackgroundToggle.checked = localStorage.getItem(RUN_IN_BACKGROUND_KEY) === 'true';
} catch { /* ignore */ }
const throwCheatToggle = document.getElementById('throw-cheat-toggle') as HTMLInputElement | null;
const throwShipToggleBtn = document.getElementById('throw-ship-toggle') as HTMLButtonElement | null;
const THROW_CHEAT_KEY = 'space-sim:throw-cheat:v1';
let throwCheatEnabled = false;
try {
  throwCheatEnabled = localStorage.getItem(THROW_CHEAT_KEY) === 'true';
  if (throwCheatToggle) throwCheatToggle.checked = throwCheatEnabled;
} catch { /* ignore */ }
const profilerPanel = element<HTMLElement>('profiler');
const profilerButton = element<HTMLButtonElement>('profiler-toggle');
const fullscreenButton = element<HTMLButtonElement>('fullscreen');
const controlsToggle = element<HTMLButtonElement>('controls-toggle');
const playersToggle = element<HTMLButtonElement>('players-toggle');
const controlsDialog = element<HTMLDialogElement>('controls-dialog');
const controlsClose = element<HTMLButtonElement>('controls-close');
const tabKeyboardBtn = element<HTMLButtonElement>('tab-keyboard-btn');
const tabPlayersBtn = element<HTMLButtonElement>('tab-players-btn');
const tabGamepadBtn = element<HTMLButtonElement>('tab-gamepad-btn');
const tabKeyboard = element<HTMLElement>('tab-keyboard');
const tabPlayers = element<HTMLElement>('tab-players');
const tabGamepad = element<HTMLElement>('tab-gamepad');
const keybindingsList = element<HTMLElement>('keybindings-list');
const resetKeybindingsBtn = element<HTMLButtonElement>('reset-keybindings');

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
let maneuverTap: { id: number; x: number; y: number } | undefined;
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

const padSites = new WeakMap<import('../../../packages/game-api/src/index').WorldRead, Map<string, { position: Vec; normal: Vec }>>();
/** Pad markers per body; terrain is generated by the world on load, never in draw(). */
function preparePads(world: import('../../../packages/game-api/src/index').WorldRead): void {
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
const otherOrbits = new OtherOrbits();
const spinView = new SpinView();
const designer = new PlanetDesigner(element('planet-designer'), () => session.world, () => activeBody?.id);

const pilotName = (): string => cleanName(nameInput.value, MAX_PLAYER_NAME) || 'Pilot';
const isHosting = (): boolean => session === local && local.hosting;
/** Single player on this browser's own world: blur pauses and Reset restarts the clock. */
const isSolo = (): boolean => session === local && !local.hosting;
/** Records only: a pilot's list never needs to evaluate sleeping ships. */
const ownShips = (): Ship[] => [...session.world.records()].filter(s => s.ownerId === session.playerId);
const selectedShip = (): Ship | undefined => selectedShipId ? session.world.ship(selectedShipId) : undefined;
const maneuver = new ManeuverPlanner(workspace, {
  flight: () => ({ world: session.world, ship: selectedShip(), body: activeBody,
    enabled: presentation.isEnabled('builtin.maneuver-planner'), canWarp: session.canWarp,
    paused: session.paused, inputBlocked: controlsDialog.open || hudLayout.editing || document.hidden,
    warp: session.warp, requestedWarp: session.requestedWarp }),
  setThrottle: (shipId, throttle) => session.setThrottle(shipId, throttle),
  releaseControls: shipId => {
    if (session === local && local.world.record(shipId)?.ownerId === local.playerId) local.host.setControls(local.playerId, shipId, IDLE);
  },
  setWarp, notify, event: (kind, detail) => profiler.event(kind, detail),
});
function notify(text: string, seconds = 5): void {
  notice = { text, until: performance.now() + seconds * 1000 };
  lastHud = -Infinity;
}

const viewport = canvas.parentElement as HTMLElement;
const hudVisibility = new HudVisibility(viewport);
profilerPanel.hidden = !hudVisibility.visible('profiler');
profilerButton.setAttribute('aria-pressed', String(!profilerPanel.hidden));
let controllerMenu: ControllerMenu;
const splitModeToggleBtn = element<HTMLButtonElement>('split-mode-toggle');
const qbSplitGroup = element<HTMLDivElement>('qb-split-group');

function syncSplitModeButton(): void {
  if (!splitModeToggleBtn || !qbSplitGroup) return;
  const isSplitActive = splitScreen.split;
  qbSplitGroup.style.display = isSplitActive ? '' : 'none';
  if (isSplitActive) {
    const isForced = splitScreen.config.screenMode === 'split';
    splitModeToggleBtn.textContent = isForced ? 'Forced Split' : 'Dynamic Screen';
    splitModeToggleBtn.title = isForced
      ? 'Screen mode: Forced Split (Always split). Click for Dynamic.'
      : 'Screen mode: Dynamic (Packs together). Click for Forced Split.';
    splitModeToggleBtn.setAttribute('aria-pressed', String(isForced));
  }
}

splitModeToggleBtn?.addEventListener('click', () => {
  const nextMode = splitScreen.config.screenMode === 'split' ? 'dynamic' : 'split';
  splitScreen.setConfig({ ...splitScreen.config, screenMode: nextMode });
  syncSplitModeButton();
  notify(nextMode === 'split' ? 'Forced split screen enabled (always split).' : 'Dynamic screen mode enabled.');
});

const splitScreen = new SplitScreen(viewport, {
  gamepads: gamepadManager,
  session: () => session,
  ownWorld: () => session === local ? local : undefined,
  presetId: () => preset.value || 'pad',
  isGodMode: () => godModeToggle.checked,
  keyboardFlight: () => keyboardFlight(),
  resolveFlight: (slot, command) => withThrottleLever(slot, command),
  releaseFlight: slot => { leverBurns[slot] = undefined; },
  inputEnabled: () => !controlsDialog.open && !hudLayout.editing && !document.hidden,
  consumesPad: (slot, pad) => controllerConsumesFlight(slot, pad),
  execute: action => executeAction(action),
  notify: text => notify(text),
  changed: () => {
    controllerMenu?.renderPlayers();
    syncSplitModeButton();
  },
  onGuestPointer: (guest, action, event) => handleGuestPointer(guest, action, event),
  isSlotThrowing: slot => isSlotThrowing(slot),
});
initManual({
  readControls: () => ({ keys: keybindings, players: splitScreen.config, pads: gamepadManager.getDiagnostics(), controllerEnabled: gamepadManager.getSettings().enabled }),
  openControls: () => controlsToggle.click(),
});
viewport.addEventListener('hud-layout-edit', () => { release(); workspace.close(); });
viewport.addEventListener('hud-layout-reset', () => {
  let config = splitScreen.config;
  for (let slot = 0; slot < config.slots.length; slot++) config = setSlotNavball(config, slot, defaultNavballPlacement(slot));
  splitScreen.setConfig(config);
});
controllerMenu = new ControllerMenu(
  splitScreen,
  gamepadManager,
  () => pilotName(),
  () => controlsDialog.open,
);


const chatOverlay = document.getElementById('chat-overlay');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form') as HTMLFormElement | null;
const chatInput = document.getElementById('chat-input') as HTMLInputElement | null;
const chatToggleBtn = document.getElementById('chat-toggle');
const chatMinimizeBtn = document.getElementById('chat-minimize');
const chatMinPill = document.getElementById('chat-min-pill');
const chatUnreadDot = document.getElementById('chat-unread-dot');

let chatMinimized = false;
try {
  chatMinimized = localStorage.getItem('space-sim:chat:minimized') === 'true';
} catch {}

function setChatMinimized(minimized: boolean, focusInput = false): void {
  if (!minimized && focusInput && !hudVisibility.visible('chat')) hudVisibility.set('chat', true);
  chatMinimized = minimized;
  try {
    localStorage.setItem('space-sim:chat:minimized', String(minimized));
  } catch {}
  chatOverlay?.classList.toggle('minimized', minimized);
  if (chatMinPill) chatMinPill.hidden = !minimized;
  chatToggleBtn?.setAttribute('aria-pressed', String(!minimized));
  chatToggleBtn?.classList.toggle('active', !minimized);
  if (!minimized) {
    if (chatUnreadDot) chatUnreadDot.hidden = true;
    if (focusInput) chatInput?.focus();
  }
}

// Initial state
setChatMinimized(chatMinimized);
initChatWindow();

function logChatMessage(kind: 'system' | 'error' | 'success' | 'chat', text: string, sender?: string): void {
  if (!chatMessages) return;
  const msg = document.createElement('div');
  msg.className = `chat-msg ${kind}`;
  if (sender) {
    const s = document.createElement('span');
    s.className = 'sender';
    s.textContent = `${sender}:`;
    msg.appendChild(s);
  } else if (kind === 'system') {
    const t = document.createElement('span');
    t.className = 'chat-tag';
    t.textContent = 'SYSTEM';
    msg.appendChild(t);
  } else if (kind === 'error') {
    const t = document.createElement('span');
    t.className = 'chat-tag';
    t.textContent = 'ERROR';
    msg.appendChild(t);
  } else if (kind === 'success') {
    const t = document.createElement('span');
    t.className = 'chat-tag';
    t.textContent = 'OK';
    msg.appendChild(t);
  }
  const content = document.createTextNode(` ${text}`);
  msg.appendChild(content);
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  while (chatMessages.children.length > 60) {
    chatMessages.firstElementChild?.remove();
  }
  if (chatMinimized && chatUnreadDot) {
    chatUnreadDot.hidden = false;
  }
}

/** A chat line from the session: every pilot in the world sees the same ones. */
function showChatLine(line: ChatLine): void {
  logChatMessage('chat', line.text, line.from === undefined ? line.name : line.from === session.playerId ? `${line.name} (you)` : line.name);
}

/** Place a ship through the session (throw, orbit and teleport cheats). A remote host
 * applies it with its next update, or refuses with a notice. False if refused here. */
function placeShip(ship: Ship, bodyId: string, position: Vec, velocity: Vec, heading: number | undefined, done: string): boolean {
  if (!throwCheatEnabled) { notify('Throw cheat is disabled. Enable it in Settings to place a vessel.'); return false; }
  try { session.teleport(ship.id, bodyId, position, velocity, heading); } catch (error) {
    logChatMessage('error', message(error));
    notify(message(error));
    return false;
  }
  logChatMessage('success', session.kind === 'client' ? `${done} (sent to the host)` : done);
  return true;
}

function executeChatCommand(cmdStr: string): void {
  const parts = cmdStr.slice(1).trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const args = parts.slice(1);
  const ship = selectedShip() ?? ownShips()[0];

  switch (cmd) {
    case 'help':
    case '?': {
      logChatMessage('system', 'Flight commands:');
      logChatMessage('system', '/throw [on|off] — Toggle slingshot throw & teleport cheat (T or Alt+Drag)');
      logChatMessage('system', '/orbit [body] [alt_km] — Teleport into circular orbit (e.g. /orbit Parvus 100)');
      logChatMessage('system', '/throw [vx] [vy] — Slingshot throw with velocity vector in m/s');
      logChatMessage('system', '/circ — Circularize current orbit around dominant body');
      logChatMessage('system', '/tp [body] — Teleport ship to celestial body orbit');
      logChatMessage('system', '/god — Toggle god mode (invulnerable)');
      logChatMessage('system', '/warp [factor] — Set time warp rate (1-10000)');
      logChatMessage('system', '/spawn [preset] — Spawn a new vessel');
      logChatMessage('system', '/split [force|dynamic|1-4] — Toggle or configure split screen mode');
      logChatMessage('system', '/clear — Clear chat messages');
      logChatMessage('system', 'Tip: Hold Alt and drag in space (or press T / click "Throw") to sling your ship into orbit!');
      break;
    }
    case 'clear': {
      if (chatMessages) chatMessages.innerHTML = '';
      logChatMessage('system', 'Chat cleared.');
      break;
    }
    case 'orbit': {
      if (!throwCheatEnabled) {
        logChatMessage('error', 'Throw / orbit cheat is disabled. Type /throw on or enable it in Settings to unlock.');
        return;
      }
      if (!ship) {
        logChatMessage('error', 'No active vessel to place in orbit.');
        return;
      }
      let targetBodyName = activeBody?.name ?? 'Primus';
      let altKm = 200;
      if (args.length === 1) {
        const num = parseFloat(args[0]!);
        if (Number.isFinite(num)) {
          altKm = num;
        } else {
          targetBodyName = args[0]!;
        }
      } else if (args.length >= 2) {
        targetBodyName = args[0]!;
        altKm = parseFloat(args[1]!) || 200;
      }
      const bodies = session.world.system.getAllBodies();
      const targetBody = bodies.find(b => b.name.toLowerCase() === targetBodyName.toLowerCase())
        ?? bodies.find(b => b.id.toLowerCase() === targetBodyName.toLowerCase())
        ?? session.world.body(activeBody.id);
      const r = targetBody.radius + altKm * 1000;
      const vCirc = Math.sqrt(targetBody.mu / r);
      const pos = { x: 0, y: r };
      const vel = { x: vCirc, y: 0 };
      if (!placeShip(ship, targetBody.id, pos, vel, 0,
        `Teleported ${ship.name} into ${altKm} km circular orbit around ${targetBody.name} (${vCirc.toFixed(1)} m/s).`)) return;
      cameraControl.followShip();
      syncCameraButton();
      break;
    }
    case 'throw': {
      if (args.length === 0) {
        setThrowCheat(!throwCheatEnabled);
        logChatMessage('success', `Throw / orbit cheat ${throwCheatEnabled ? 'ENABLED' : 'DISABLED'}.`);
        return;
      }
      const sub = args[0]!.toLowerCase();
      if (sub === 'on' || sub === 'enable' || sub === 'true' || sub === '1') {
        setThrowCheat(true);
        logChatMessage('success', 'Throw / orbit cheat ENABLED. Drag with Alt or press T to sling ship.');
        return;
      }
      if (sub === 'off' || sub === 'disable' || sub === 'false' || sub === '0') {
        setThrowCheat(false);
        logChatMessage('system', 'Throw / orbit cheat DISABLED.');
        return;
      }
      if (!throwCheatEnabled) {
        logChatMessage('error', 'Throw / orbit cheat is disabled. Type /throw on or enable it in Settings to unlock.');
        return;
      }
      if (!ship) {
        logChatMessage('error', 'No active vessel to throw.');
        return;
      }
      const vx = parseFloat(args[0] ?? '0') || 0;
      const vy = parseFloat(args[1] ?? '0') || 0;
      placeShip(ship, ship.bodyId, ship.state.position, { x: vx, y: vy }, undefined,
        `Threw ${ship.name} with velocity (${vx.toFixed(1)}, ${vy.toFixed(1)}) m/s.`);
      break;
    }
    case 'circ':
    case 'circularize': {
      if (!throwCheatEnabled) {
        logChatMessage('error', 'Throw / orbit cheat is disabled. Type /throw on or enable it in Settings to unlock.');
        return;
      }
      if (!ship) {
        logChatMessage('error', 'No active vessel to circularize.');
        return;
      }
      const body = session.world.body(ship.bodyId);
      const p = ship.state.position;
      const r = Math.hypot(p.x, p.y);
      if (r <= body.radius) {
        logChatMessage('error', 'Cannot circularize while on or below surface.');
        return;
      }
      const vCirc = Math.sqrt(body.mu / r);
      const currentV = ship.state.velocity;
      const ccw = { x: -p.y / r * vCirc, y: p.x / r * vCirc };
      const cw = { x: p.y / r * vCirc, y: -p.x / r * vCirc };
      const dotCcw = ccw.x * currentV.x + ccw.y * currentV.y;
      const chosen = dotCcw >= 0 ? ccw : cw;
      placeShip(ship, ship.bodyId, p, chosen, undefined,
        `Circularized orbit around ${body.name} at ${(r - body.radius).toFixed(0)} m altitude (${vCirc.toFixed(1)} m/s).`);
      break;
    }
    case 'tp':
    case 'teleport': {
      if (!throwCheatEnabled) {
        logChatMessage('error', 'Throw / orbit cheat is disabled. Type /throw on or enable it in Settings to unlock.');
        return;
      }
      if (!ship) {
        logChatMessage('error', 'No active vessel to teleport.');
        return;
      }
      const targetName = args[0] || 'Primus';
      const bodies = session.world.system.getAllBodies();
      const targetBody = bodies.find(b => b.name.toLowerCase() === targetName.toLowerCase())
        ?? bodies.find(b => b.id.toLowerCase() === targetName.toLowerCase());
      if (!targetBody) {
        logChatMessage('error', `Unknown celestial body: "${targetName}".`);
        return;
      }
      const alt = Math.max(50_000, targetBody.radius * 0.15);
      const r = targetBody.radius + alt;
      const vCirc = Math.sqrt(targetBody.mu / r);
      if (!placeShip(ship, targetBody.id, { x: 0, y: r }, { x: vCirc, y: 0 }, 0,
        `Teleported to ${targetBody.name} in ${(alt / 1000).toFixed(0)} km orbit.`)) return;
      cameraControl.followShip();
      syncCameraButton();
      break;
    }
    case 'god': {
      const nextGod = !godModeToggle.checked;
      godModeToggle.checked = nextGod;
      try { localStorage.setItem(GOD_MODE_KEY, String(nextGod)); } catch { /* ignore */ }
      try {
        session.setGodModeAll(nextGod);
      } catch (error) {
        godModeToggle.checked = !nextGod;
        notify(message(error));
        logChatMessage('error', `Could not update God Mode: ${message(error)}`);
        break;
      }
      logChatMessage('success', `God Mode ${nextGod ? 'ENABLED for all ships (invulnerable)' : 'DISABLED'}.`);
      break;
    }
    case 'reset': {
      reset();
      logChatMessage('success', 'Quick reset: vessel respawned at scenario start.');
      break;
    }
    case 'resetworld': {
      resetWorld();
      break;
    }
    case 'warp': {
      const factor = parseInt(args[0] ?? '1', 10);
      if (Number.isFinite(factor) && factor >= 1 && factor <= 10000) {
        if (!session.canWarp) { logChatMessage('error', 'Only the host can activate time warp.'); return; }
        setWarp(factor);
        if (session.warp === factor) logChatMessage('success', `Time warp set to ${factor}×.`);
        else logChatMessage('system', `Time warp ${session.warp}×${session.warpReason ? `: ${session.warpReason}` : ''}.`);
      } else {
        logChatMessage('error', 'Usage: /warp [1-10000]');
      }
      break;
    }
    case 'spawn': {
      const presetId = args[0] || session.world.presetId(preset.value || 'pad');
      try {
        session.spawn(presetId, false);
        logChatMessage('success', `Spawned vessel with preset "${presetId}".`);
      } catch (e) {
        logChatMessage('error', `Failed to spawn: ${(e as Error).message}`);
      }
      break;
    }
    case 'split':
    case 'splitscreen': {
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'force' || sub === 'forced' || sub === 'split' || sub === 'always') {
        splitScreen.setConfig({ ...splitScreen.config, screenMode: 'split' });
        syncSplitModeButton();
        logChatMessage('success', 'Forced split screen ENABLED (always split).');
      } else if (sub === 'dynamic' || sub === 'auto' || sub === 'pack') {
        splitScreen.setConfig({ ...splitScreen.config, screenMode: 'dynamic' });
        syncSplitModeButton();
        logChatMessage('success', 'Dynamic screen mode ENABLED (merges when together, splits when apart).');
      } else if (sub === '1' || sub === '2' || sub === '3' || sub === '4') {
        const count = Number(sub) as 1 | 2 | 3 | 4;
        splitScreen.setConfig(setPlayerCount(splitScreen.config, count));
        syncSplitModeButton();
        logChatMessage('success', `Split screen set to ${count} ${count === 1 ? 'player' : 'players'}.`);
      } else {
        const nextMode = splitScreen.config.screenMode === 'dynamic' ? 'split' : 'dynamic';
        splitScreen.setConfig({ ...splitScreen.config, screenMode: nextMode });
        syncSplitModeButton();
        logChatMessage('success', `Screen mode switched to ${nextMode === 'split' ? 'FORCED SPLIT SCREEN (always split)' : 'DYNAMIC (merges when together)'}.`);
      }
      break;
    }
    default: {
      logChatMessage('error', `Unknown command: "/${cmd}". Type /help for available commands.`);
    }
  }
}

function handleChatSubmit(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (trimmed.startsWith('/')) {
    executeChatCommand(trimmed);
  } else {
    // Shown when the session echoes it back, in the order every pilot sees.
    session.chat(trimmed);
  }
}

chatForm?.addEventListener('submit', event => {
  event.preventDefault();
  if (!chatInput) return;
  const text = chatInput.value;
  chatInput.value = '';
  handleChatSubmit(text);
});

chatMinimizeBtn?.addEventListener('click', () => setChatMinimized(true));
chatMinPill?.addEventListener('click', () => setChatMinimized(false, true));

chatToggleBtn?.addEventListener('click', () => {
  if (!hudVisibility.visible('chat')) {
    hudVisibility.set('chat', true); setChatMinimized(false, true); return;
  }
  if (chatMinimized) {
    setChatMinimized(false, true);
  } else if (document.activeElement === chatInput) {
    setChatMinimized(true);
  } else {
    chatInput?.focus();
  }
});

window.addEventListener('keydown', event => {
  if (event.code === 'Enter') {
    if (document.activeElement === chatInput) {
      // Handled by form submit
    } else if (!document.activeElement?.closest('input, select, textarea, [contenteditable]')) {
      event.preventDefault();
      setChatMinimized(false, true);
    }
  } else if (event.code === 'Slash') {
    if (document.activeElement !== chatInput && !document.activeElement?.closest('input, select, textarea, [contenteditable]')) {
      event.preventDefault();
      hudVisibility.set('chat', true);
      setChatMinimized(false);
      if (chatInput) {
        chatInput.focus();
        chatInput.value = '/';
      }
    }
  } else if (event.code === 'Escape') {
    if (document.activeElement === chatInput) {
      chatInput?.blur();
      setChatMinimized(true);
      event.preventDefault();
    }
  }
});

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
  show('module-status', session.world.soloPreview ? 'Solo preview. Export module/profile to keep your settings. Universe saves and hosting are unavailable for this profile.' : `Using compatible simulation profile${fpText}.`);
  moduleManager?.refresh();
  labManager?.refresh();
  pauseButton.disabled = session !== local;
  pauseButton.title = session === local ? '' : 'The host controls pausing';
  syncWarpUI();
}

/** Switch which world the console shows and flies. Joining or leaving a game also
 * returns the camera to the piloted ship. */
function useSession(next: GameSession, recenter = true): void {
  maneuver.cancel();
  release();
  otherOrbits.clear();
  session.onchat = null;
  session = next;
  splitScreen.sync();
  next.onchat = showChatLine;
  preparePads(next.world);
  selectedShipId = undefined;
  selectShip(ownShips()[0]?.id);
  syncUniverseSelect();
  syncSystemSelect();
  syncPresetSelect();
  syncLocks();
  if (recenter) {
    cameraControl.followShip();
    cameraControl.rotation = cameraControl.horizon ? Math.PI / 2 - Math.atan2(state.position.y, state.position.x) : 0;
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
  local.dispose();
  local = next;
  if (session.kind === 'local') {
    cameraControl.followShip();
    cameraControl.horizon = true;
    useSession(local, true);
  }
}

/** Pilot another of this player's ships. Held input is released first. */
function selectShip(id: string | undefined): void {
  release();
  selectedShipId = id;
  lastTerrainContact = undefined;
  invalidatePrediction();
  const ship = selectedShip();
  presentation.audio.reset(ship?.state.contact?.time ?? ship?.state.time);
  if (ship) {
    if (godModeToggle.checked && !ship.state.godMode) {
      try { session.setGodMode(ship.id, true); } catch { /* ignore */ }
    } else {
      godModeToggle.checked = ship.state.godMode === true;
    }
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

function focusOnShipForNewWorld(): void {
  cameraControl.followShip();
  cameraControl.horizon = true;
  cameraControl.rotation = Math.PI / 2 - Math.atan2(state.position.y, state.position.x);
  if (cameraControl.zoom < 10) cameraControl.zoom = 10;
  syncCameraButton();
}

function setUniverse(u: UniverseDefinition, preferredSystemId?: string): void {
  const world = createLocalWorld(u, preferredSystemId);
  universes.set(u.id, u);
  replaceLocalWorld(world);
  reset();
  focusOnShipForNewWorld();
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
  focusOnShipForNewWorld();
}

function switchSystem(systemId: string): void {
  const current = worldModules(local.world);
  const prepared = prepareLocalWorld(current?.baseUniverse ?? local.world.universe, systemId, current ?? {});
  const world = prepared.world;
  replaceLocalWorld(world);
  prepared.runtime.activate(prepared.candidate);
  reset();
  focusOnShipForNewWorld();
  profiler.event('system-switch', { system: world.systemId });
}

/** Make the opt-in surface examples visible immediately on selection. */
function showSurfaceWorld(u: UniverseDefinition): void {
  setUniverse(u);
  element('flight-console').scrollIntoView({ block: 'start' });
}

function keyboardFlight(): Controls {
  if (controlsDialog.open || hudLayout.editing || document.hidden) return IDLE;
  let kbTurn = 0;
  if (isActionActive('turnLeft')) kbTurn += 1;
  if (isActionActive('turnRight')) kbTurn -= 1;
  let kbThrottle = 0;
  if (isActionActive('throttleUp')) kbThrottle += 1;
  if (isActionActive('throttleDown')) kbThrottle -= 1;
  return { turn: kbTurn, throttle: kbThrottle, engine: isActionActive('engine') };
}

function controls(elapsed = 0): Controls {
  if (controlsDialog.open || hudLayout.editing || document.hidden) return IDLE;
  const held = new Set([...pointers.values()]);
  const touch = touchControls.pollFlight();

  // Keyboard controls: only if player 1 has the keyboard assigned
  let kbTurn = 0;
  let kbThrottle = 0;
  let kbEngine = false;
  if (splitScreen.keyboardSlot === 0) {
    if (isActionActive('turnLeft') || held.has('left')) kbTurn += 1;
    if (isActionActive('turnRight') || held.has('right')) kbTurn -= 1;
    if (isActionActive('throttleUp')) kbThrottle += 1;
    if (isActionActive('throttleDown')) kbThrottle -= 1;
    kbEngine = isActionActive('engine') || held.has('engine');
  }

  // Controllers assigned to player 1
  let gpTurn = 0;
  let gpThrottle = 0;
  let gpEngine = false;
  let gpZoom = 0;
  for (const pad of splitScreen.padsOf(0)) {
    if (controllerConsumesFlight(0, pad)) continue;
    const input = gamepadManager.flight(pad);
    if (Math.abs(input.turn) > Math.abs(gpTurn)) gpTurn = input.turn;
    if (input.throttle !== 0) gpThrottle = input.throttle;
    if (input.engine) gpEngine = true;
    if (Math.abs(input.zoom) > Math.abs(gpZoom)) gpZoom = input.zoom;
  }
  if (gpZoom && elapsed > 0 && !isSlotThrowing(0)) cameraControl.changeZoom(Math.exp(gpZoom * 2.2 * elapsed));

  // Blend inputs:
  const turn = Math.abs(gpTurn) > 0.01
    ? gpTurn
    : Math.abs(touch.turn) > 0.01
      ? touch.turn
      : kbTurn;

  const throttle = gpThrottle !== 0
    ? gpThrottle
    : touch.throttle !== 0
      ? touch.throttle
      : kbThrottle;

  const engine = kbEngine || gpEngine || touch.engine;

  return withThrottleLever(0, { turn, throttle, engine });
}
function release(): void {
  leverBurns.fill(undefined);
  moduleManager?.devices.release();
  keys.clear(); pointers.clear();
  if (local && session === local) for (const guest of splitScreen.guests.values()) {
    guest.controls = IDLE;
    if (guest.playerId && guest.shipId) local.guestControls(guest.playerId, guest.shipId, IDLE);
  }
  cancelControllerCursors();
  cameraControl.stopFling();
  cameraDrag = undefined; canvasTouches.clear(); lastPinchDistance = undefined;
  maneuverTap = undefined;
  canvas.classList.remove('dragging');
  for (const button of document.querySelectorAll('[data-hold]')) button.setAttribute('aria-pressed', 'false');
  element('burn').setAttribute('aria-pressed', 'false'); shown.set('burn', 'false');
}
function invalidatePrediction(): void {
  prediction.invalidate();
}
let autoPaused = false;
/** Pausing is the world's owner's call: here, or the host for everyone. */
function setPaused(value: boolean, reason = ''): void {
  if (session !== local) return;
  if (!value || !reason) autoPaused = false;
  if (value !== local.paused) {
    profiler.event(value ? 'pause' : 'resume', { reason: reason || 'user', time: state.time });
    if (!reason) presentation.audio.play(value ? 'pause' : 'resume');
    if (value) presentation.audio.update(0, true);
  }
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
    const previousWarp = session.warp;
    session.setWarp(factor);
    if (session.warp !== previousWarp) {
      presentation.audio.play('warp');
      if (session.warp > 1) presentation.audio.update(0, true);
    }
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
  show('warp-rate', session.warp > 1 ? `WARP · ${session.warp}×${spinView.holding.has(activeBody.id) ? ' · SPIN HELD' : ''}` : 'REAL TIME · 1×');
  if (lastWarp > 1 && session.warp === 1 && session.warpReason) {
    notify(`Warp dropped: ${session.warpReason}`);
    profiler.event('warp-drop', { reason: session.warpReason, time: state.time });
  }
  lastWarp = session.warp;
}
/** Losing focus pauses a solo flight (unless Run in background is enabled) and auto-resumes on focus; shared worlds keep running. */
function autoPause(reason: string): void {
  if (isSolo() && !runInBackgroundToggle.checked) {
    if (!local.paused) {
      autoPaused = true;
      setPaused(true, reason);
    } else {
      release();
    }
    return;
  }
  release();
  handleEvents(session.update(0, selectedShipId, IDLE));
}
function autoResume(reason: string): void {
  if (isSolo() && autoPaused && local.paused) {
    autoPaused = false;
    setPaused(false, reason);
  }
}
function fitZoom(start: State, presetId = preset.value): void {
  const selectedPreset = session.world.system.presets.find(p => p.id === presetId);
  if (start.status === 'landed') {
    cameraControl.zoom = selectedPreset && typeof selectedPreset.zoom === 'number'
      ? Math.max(10, selectedPreset.zoom)
      : 10;
  } else if (selectedPreset && typeof selectedPreset.zoom === 'number') {
    cameraControl.zoom = selectedPreset.zoom;
  } else {
    cameraControl.setZoom(1500 / (magnitude(start.position) * 2.8));
  }
}
/** Quick reset: restarts the piloted vessel at the scenario start without wiping the world or other ships. */
function reset(): void {
  release();
  const presetId = session.world.presetId(preset.value);
  const ship = selectedShip();
  const isGod = godModeToggle.checked;
  try {
    if (ship && session.world.record(ship.id)) {
      session.respawn(ship.id, presetId);
      if (session === local) {
        local.settle();
        if (isGod) local.world.setGodMode(ship.id, true);
      }
    } else {
      const id = session.spawn(presetId, isGod);
      if (id) selectShip(id);
    }
  } catch (error) {
    if (!(error instanceof SessionError)) throw error;
    notify(error.message);
  }
  syncSelected();
  lastTerrainContact = undefined;
  presentation.audio.reset(state.time);
  cameraControl.followShip();
  cameraControl.horizon = true;
  const startState = session.world.presetState(presetId).state;
  cameraControl.rotation = Math.PI / 2 - Math.atan2(startState.position.y, startState.position.x);
  fitZoom(startState, presetId);
  lastStatus = state.status;
  syncCameraButton();
  invalidatePrediction(); setPaused(false);
  show('active-body', activeBody.name.toUpperCase());
  profiler.event('reset', { preset: preset.value, body: activeBody.id });
}

/** Full world reset (Host only): rewinds the entire universe clock to zero and resets all ships. */
function resetWorld(): void {
  if (session !== local) {
    notify('Only the host can reset the world.');
    logChatMessage('error', 'Only the host can reset the world.');
    return;
  }
  release();
  splitScreen.resetGuests();
  const presetId = session.world.presetId(preset.value);
  const isGod = godModeToggle.checked;
  try {
    local.world.reset();
    local.settle();
    selectedShipId = undefined;
    selectShip(local.spawn(presetId, isGod));
    if (isGod) local.world.setGodModeAll(true);
    notify('World reset: clock rewound to T+0, all ships reset.');
    logChatMessage('system', 'World reset: clock rewound to T+0, all ships reset.');
  } catch (error) {
    if (!(error instanceof SessionError)) throw error;
    notify(error.message);
  }
  syncSelected();
  lastTerrainContact = undefined;
  cameraControl.followShip();
  cameraControl.horizon = true;
  const startState = session.world.presetState(presetId).state;
  cameraControl.rotation = Math.PI / 2 - Math.atan2(startState.position.y, startState.position.x);
  fitZoom(startState, presetId);
  lastStatus = state.status;
  syncCameraButton();
  invalidatePrediction(); setPaused(false);
  show('active-body', activeBody.name.toUpperCase());
  profiler.event('reset-world', { preset: preset.value, body: activeBody.id });
}
function changeZoom(factor: number): void { cameraControl.changeZoom(factor); }
/** Follow ship → planet view → module camera modes → follow ship. */
function toggleCamera(): void {
  cameraControl.cycle(presentation.cameras, activeBody?.radius);
  syncCameraButton();
  profiler.event('camera', { mode: cameraControl.mode });
}
function syncCameraButton(): void {
  cameraControl.retain(presentation.cameras);
  const label = cameraControl.label(presentation.cameras);
  if (cameraButton.textContent !== label) cameraButton.textContent = label;
  const orientLabel = cameraControl.horizon ? 'Horizon up' : 'North up';
  if (orientationButton.textContent !== orientLabel) orientationButton.textContent = orientLabel;
}
function toggleProfiler(): void {
  profilerPanel.hidden = !profilerPanel.hidden;
  hudVisibility.set('profiler', !profilerPanel.hidden);
  profilerButton.setAttribute('aria-pressed', String(!profilerPanel.hidden));
  lastPanel = -Infinity;
}

function bodyWorldPosition(bodyId: string, time: number, pos: Vec): Vec {
  const bodyPos = session.world.system.getBodyPosition(bodyId, time);
  return { x: bodyPos.x + pos.x, y: bodyPos.y + pos.y };
}

class VelocityTracker {
  private samples: Array<{ x: number; y: number; time: number }> = [];

  reset(): void {
    this.samples.length = 0;
  }

  add(x: number, y: number): void {
    const now = performance.now();
    this.samples.push({ x, y, time: now });
    while (this.samples.length > 1 && now - this.samples[0]!.time > 120) {
      this.samples.shift();
    }
  }

  getVelocity(): Vec {
    const now = performance.now();
    while (this.samples.length > 1 && now - this.samples[0]!.time > 120) {
      this.samples.shift();
    }
    if (this.samples.length < 2) return { x: 0, y: 0 };
    const latest = this.samples[this.samples.length - 1]!;
    if (now - latest.time > 80) return { x: 0, y: 0 }; // held stationary before release
    const oldest = this.samples[0]!;
    const dt = (latest.time - oldest.time) / 1000;
    if (dt < 0.005) return { x: 0, y: 0 };
    const vx = (latest.x - oldest.x) / dt;
    const vy = (latest.y - oldest.y) / dt;
    const speed = Math.hypot(vx, vy);
    const maxSpeed = 4500;
    const factor = speed > maxSpeed ? maxSpeed / speed : 1;
    return { x: vx * factor, y: vy * factor };
  }
}

const touchVelocityTracker = new VelocityTracker();
const pointerVelocityTracker = new VelocityTracker();
const canvasTouches = new Map<number, { x: number; y: number }>();
let lastPinchDistance: number | undefined;

interface FlightSlingshot {
  pointerId: number;
  screenStart: Vec;
  originWorld: Vec;
  dominantBody: ResolvedBody;
  dominantWorldPos: Vec;
  relPos: Vec;
  pointerWorld: Vec;
  pullVelocity: Vec;
  circularVelocity: Vec;
  circularSpeed: number;
  currentSpeed: number;
  isSnappingCircular: boolean;
  slot?: number;
  targetShipId?: string;
  sourceCanvas?: HTMLCanvasElement;
}
let activeFlightSlingshot: FlightSlingshot | null = null;
let isThrowModeActive = false;
let isThrowKeyDown = false;
let throwKeyDownTime = 0;
let isTouchSlingHolding = false;

function setThrowCheat(enabled: boolean): void {
  throwCheatEnabled = enabled;
  try {
    localStorage.setItem(THROW_CHEAT_KEY, String(enabled));
  } catch { /* ignore */ }
  if (throwCheatToggle) throwCheatToggle.checked = enabled;
  if (!enabled && isThrowModeActive) {
    setThrowMode(false);
  }
  updateThrowCheatUI();
}

function updateThrowCheatUI(): void {
  if (throwCheatToggle) throwCheatToggle.checked = throwCheatEnabled;
  if (throwShipToggleBtn) {
    throwShipToggleBtn.style.display = throwCheatEnabled ? '' : 'none';
    throwShipToggleBtn.classList.toggle('active', isThrowModeActive);
    throwShipToggleBtn.setAttribute('aria-pressed', String(isThrowModeActive));
  }
  touchControls.setSlingVisible(throwCheatEnabled);
  touchControls.setSlingActive(isThrowModeActive);
}

function setThrowMode(active: boolean): void {
  if (!throwCheatEnabled && active) {
    notify('Throw cheat is disabled. Enable it in Settings or type /throw on in chat.');
    logChatMessage('error', 'Throw cheat is disabled. Type /throw on or enable it in Settings to unlock.');
    return;
  }
  isThrowModeActive = active;
  updateThrowModeUI();
  if (isThrowModeActive) {
    notify('Throw mode active: Click/touch & drag in space to aim trajectory. Press Shift to snap circular.');
  }
}

function toggleThrowMode(): void {
  setThrowMode(!isThrowModeActive);
}

function updateThrowModeUI(): void {
  const active = isThrowModeActive || isThrowKeyDown || isTouchSlingHolding;
  if (throwShipToggleBtn) {
    throwShipToggleBtn.classList.toggle('active', isThrowModeActive);
    throwShipToggleBtn.setAttribute('aria-pressed', String(isThrowModeActive));
  }
  touchControls.setSlingActive(isThrowModeActive);
  canvas.classList.toggle('throw-mode-cursor', active);
}

function findDominantCelestialBody(worldPos: Vec, time: number, hintBodyId?: string): { body: ResolvedBody; bodyPos: Vec; relPos: Vec; dist: number } {
  return findDominantBodyForWorldPos(session.world.system, worldPos, time, hintBodyId);
}

function computeBodyCircularVelocity(relPos: Vec, dist: number, body: ResolvedBody, preferredDir?: Vec): { velocity: Vec; speed: number } {
  const r = Math.max(body.radius * 1.01, dist);
  const vCirc = Math.sqrt(body.mu / r);
  const rx = relPos.x / r;
  const ry = relPos.y / r;
  const ccw = { x: -ry * vCirc, y: rx * vCirc };
  const cw = { x: ry * vCirc, y: -rx * vCirc };
  if (preferredDir && (preferredDir.x !== 0 || preferredDir.y !== 0)) {
    const dotCcw = ccw.x * preferredDir.x + ccw.y * preferredDir.y;
    const dotCw = cw.x * preferredDir.x + cw.y * preferredDir.y;
    return { velocity: dotCcw >= dotCw ? ccw : cw, speed: vCirc };
  }
  return { velocity: ccw, speed: vCirc };
}

function updateFlightSlingshotHud(): void {
  const hud = document.getElementById('flight-slingshot-hud');
  if (!hud) return;
  if (!activeFlightSlingshot) {
    hud.classList.add('hidden');
    return;
  }
  hud.classList.remove('hidden');
  const velEl = document.getElementById('fhud-vel');
  const circEl = document.getElementById('fhud-circ');
  const bodyEl = document.getElementById('fhud-body');
  const snapEl = document.getElementById('fhud-snap-badge');
  if (velEl) velEl.textContent = `${activeFlightSlingshot.currentSpeed.toFixed(1)} m/s`;
  if (circEl) circEl.textContent = `${activeFlightSlingshot.circularSpeed.toFixed(1)} m/s`;
  if (bodyEl) bodyEl.textContent = activeFlightSlingshot.dominantBody.name.toUpperCase();
  if (snapEl) {
    if (activeFlightSlingshot.isSnappingCircular) {
      snapEl.classList.remove('hidden');
    } else {
      snapEl.classList.add('hidden');
    }
  }
}

function formatDistance(meters: number): string {
  const abs = Math.abs(meters);
  if (abs >= 1e6) return `${(meters / 1e6).toFixed(1)}Mm`;
  if (abs >= 1e3) return `${(meters / 1e3).toFixed(1)}km`;
  return `${meters.toFixed(0)}m`;
}

function formatTrajectoryStats(
  shipState: { readonly position: Vec; readonly velocity: Vec; readonly status: string; readonly coast?: { readonly bodyId: string; readonly mu: number; readonly position: Vec; readonly velocity: Vec } },
  body: ResolvedBody,
  context: { readonly capabilities: { readonly orbitalDiagnostics?: boolean }; readonly services: { readonly orbits: { elements(s: any, mu: number): any } } },
): string {
  const r = Math.hypot(shipState.position.x, shipState.position.y);
  const alt = Math.max(0, r - body.radius);
  const spd = Math.hypot(shipState.velocity.x, shipState.velocity.y);
  let traj = `Alt ${formatDistance(alt)} · ${spd.toFixed(1)}m/s`;

  if (shipState.status === 'flying' && context.capabilities.orbitalDiagnostics) {
    try {
      const source = shipState.coast?.bodyId === body.id && shipState.coast.mu === body.mu ? shipState.coast : shipState;
      const el = context.services.orbits.elements(source, body.mu);
      const peAlt = el.periapsis - body.radius;
      const peStr = `Pe ${formatDistance(peAlt)}`;
      const apStr = el.apoapsis === null ? 'Ap Esc' : `Ap ${formatDistance(el.apoapsis - body.radius)}`;
      traj = `Alt ${formatDistance(alt)} · ${peStr} · ${apStr}`;
    } catch {
      // Numerical fallback
    }
  }
  return traj;
}

function buildSlingshotOverlay(s: FlightSlingshot, cameraScale: number, accentColor = '#38ef7d'): OverlayPrimitive[] {
  const slingList: OverlayPrimitive[] = [];
  slingList.push({
    kind: 'circle',
    space: 'world',
    center: s.originWorld,
    radius: 12 / cameraScale,
    color: accentColor,
    width: 2,
  });
  slingList.push({
    kind: 'circle',
    space: 'world',
    center: s.originWorld,
    radius: 3 / cameraScale,
    color: '#ffffff',
    fill: true,
  });

  const dragDist = Math.hypot(s.pointerWorld.x - s.originWorld.x, s.pointerWorld.y - s.originWorld.y);
  if (s.isSnappingCircular || dragDist * cameraScale < 6) {
    const circVel = s.circularVelocity;
    const speed = s.circularSpeed;
    if (speed > 0) {
      const arrowLen = 50 / cameraScale;
      const dirX = circVel.x / speed;
      const dirY = circVel.y / speed;
      const tipX = s.originWorld.x + dirX * arrowLen;
      const tipY = s.originWorld.y + dirY * arrowLen;
      slingList.push({
        kind: 'line',
        space: 'world',
        points: [s.originWorld, { x: tipX, y: tipY }],
        color: '#00d2ff',
        width: 3,
      });
      const perpX = -dirY;
      const perpY = dirX;
      const barbLen = 10 / cameraScale;
      slingList.push({
        kind: 'line',
        space: 'world',
        points: [
          { x: tipX - dirX * barbLen + perpX * (barbLen * 0.5), y: tipY - dirY * barbLen + perpY * (barbLen * 0.5) },
          { x: tipX, y: tipY },
          { x: tipX - dirX * barbLen - perpX * (barbLen * 0.5), y: tipY - dirY * barbLen - perpY * (barbLen * 0.5) },
        ],
        color: '#00d2ff',
        width: 2,
      });
    }
  } else {
    slingList.push({
      kind: 'line',
      space: 'world',
      points: [s.originWorld, s.pointerWorld],
      color: '#ff4d4d',
      width: 1.5,
    });
    const pullSpeed = Math.hypot(s.pullVelocity.x, s.pullVelocity.y);
    if (pullSpeed > 0) {
      const dirX = s.pullVelocity.x / pullSpeed;
      const dirY = s.pullVelocity.y / pullSpeed;
      const arrowPx = Math.min(120, Math.max(30, pullSpeed * 0.05));
      const arrowWorldLen = arrowPx / cameraScale;
      const tipX = s.originWorld.x + dirX * arrowWorldLen;
      const tipY = s.originWorld.y + dirY * arrowWorldLen;
      slingList.push({
        kind: 'line',
        space: 'world',
        points: [s.originWorld, { x: tipX, y: tipY }],
        color: accentColor,
        width: 3,
      });
      const perpX = -dirY;
      const perpY = dirX;
      const barbWorldLen = 12 / cameraScale;
      slingList.push({
        kind: 'line',
        space: 'world',
        points: [
          { x: tipX - dirX * barbWorldLen + perpX * (barbWorldLen * 0.5), y: tipY - dirY * barbWorldLen + perpY * (barbWorldLen * 0.5) },
          { x: tipX, y: tipY },
          { x: tipX - dirX * barbWorldLen - perpX * (barbWorldLen * 0.5), y: tipY - dirY * barbWorldLen - perpY * (barbWorldLen * 0.5) },
        ],
        color: accentColor,
        width: 2,
      });
    }
  }
  return slingList;
}

interface NavballDragState {
  slot: number;
  pinned: boolean;
  pointerId: number;
  startPointer: { x: number; y: number };
  startNavballCenter: { x: number; y: number };
  paneWidth: number;
  paneHeight: number;
}
let activeNavballDrag: NavballDragState | null = null;

interface NavballHitResult {
  slot: number;
  isPin: boolean;
  center: Vec;
  scale: number;
  pinned: boolean;
}

/** Use identical fitted geometry for drawing and pointer/controller picking in every pane. */
function resolveNavballCenter(slot: number, width: number, height: number, scale: number): Vec {
  const placement = splitScreen.config.slots[slot]?.navball ?? defaultNavballPlacement(slot);
  const paneCanvas = slot > 0 && splitScreen.isSeparated(slot) ? splitScreen.guests.get(slot)?.canvas ?? canvas : canvas;
  return hudLayout.navballCenter(placement, width, height, scale, paneCanvas, slot > 0);
}

function throttleInputHeld(slot: number): boolean {
  let held = splitScreen.keyboardSlot === slot && (isActionActive('engine')
    || isActionActive('throttleUp') || isActionActive('throttleDown'));
  for (const pad of splitScreen.padsOf(slot)) {
    const input = gamepadManager.flight(pad);
    held ||= input.engine || input.throttle !== 0;
  }
  if (slot === 0) {
    const touch = touchControls.pollFlight();
    held ||= touch.engine || touch.throttle !== 0;
    for (const action of pointers.values()) held ||= action === 'engine';
  }
  return held;
}

/** Feed lever burns through the same session input path as keys, including local guest seats. */
function withThrottleLever(slot: number, command: Controls): Controls {
  const burn = leverBurns[slot];
  if (!burn) return command;
  const guest = slot > 0 ? splitScreen.guests.get(slot) : undefined;
  const ship = slot === 0 ? selectedShip() : guest?.ship(session);
  const owner = slot === 0 ? session.playerId : guest?.playerId;
  if (burn.world !== session.world || ship?.id !== burn.shipId || ship.ownerId !== owner
    || slot >= splitScreen.active || session.paused || controlsDialog.open || hudLayout.editing || document.hidden
    || ship.state.status === 'crashed' || ship.fault || throttleInputHeld(slot)) {
    leverBurns[slot] = undefined;
    return command;
  }
  return { turn: command.turn, throttle: command.throttle, engine: true };
}

function throttleLeverState(slot: number): ThrottleLeverState | undefined {
  if (slot >= splitScreen.active || !presentation.isEnabled('builtin.navball')) return undefined;
  const guest = slot > 0 ? splitScreen.guests.get(slot) : undefined;
  const ship = slot === 0 ? selectedShip() : guest?.ship(session);
  const owner = slot === 0 ? session.playerId : guest?.playerId;
  if (!ship || session.world.record(ship.id)?.ownerId !== owner) return undefined;
  const firing = ship.controls.engine && ship.state.throttle > 0 && !session.paused
    && ship.state.status !== 'crashed' && !ship.fault && session.warp === 1;
  return { world: session.world, shipId: ship.id, throttle: firing ? ship.state.throttle : 0,
    locked: throttleInputHeld(slot) || session.paused || controlsDialog.open || hudLayout.editing || document.hidden,
    firing };
}

const throttleLevers = Array.from({ length: 4 }, (_, slot) => new ThrottleLever(slot,
  () => throttleLeverState(slot), value => {
    const state = throttleLeverState(slot);
    if (!state || state.locked) return;
    if (slot === 0) session.setThrottle(state.shipId, value);
    else {
      const guest = splitScreen.guests.get(slot);
      if (session === local && guest?.playerId) local.setGuestThrottle(guest.playerId, state.shipId, value);
    }
    leverBurns[slot] = value > 0 ? { world: state.world, shipId: state.shipId } : undefined;
  }));

function syncThrottleLevers(): void {
  for (let slot = 0; slot < throttleLevers.length; slot++) {
    const pane = slot > 0 && splitScreen.isSeparated(slot) ? splitScreen.guests.get(slot)?.canvas ?? canvas : canvas;
    const width = pane.clientWidth, height = pane.clientHeight;
    const scale = Math.min(1, Math.max(.65, Math.min(width / 600, height / 450)));
    const center = resolveNavballCenter(slot, width, height, scale);
    throttleLevers[slot]!.sync(pane.parentElement!, pane.offsetLeft + center.x - navballFootprint(scale, slot > 0).side - THROTTLE_LEVER_SPACE,
      pane.offsetTop + center.y - 76);
  }
}

function hitTestNavball(
  screenPos: Vec,
  targetSlot: number | 'all',
  viewportWidth: number,
  viewportHeight: number,
): NavballHitResult | undefined {
  if (!presentation.isEnabled('builtin.navball')) return undefined;
  const slots: number[] = targetSlot === 'all'
    ? Array.from({ length: splitScreen.active }, (_, i) => i)
    : [targetSlot];

  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i]!;
    if (targetSlot === 'all' && slot > 0 && splitScreen.isSeparated(slot)) continue;
    const placement = splitScreen.config.slots[slot]?.navball ?? defaultNavballPlacement(slot);
    const scale = Math.min(1, Math.max(0.65, Math.min(viewportWidth / 600, viewportHeight / 450)));
    const center = resolveNavballCenter(slot, viewportWidth, viewportHeight, scale);
    const pinPos: Vec = { x: center.x + (NAVBALL_TRACK + 2) * scale * 0.72, y: center.y - (NAVBALL_TRACK + 2) * scale * 0.72 };

    const dPin = Math.hypot(screenPos.x - pinPos.x, screenPos.y - pinPos.y);
    if (dPin <= 22 * scale) {
      return { slot, isPin: true, center, scale, pinned: placement.pinned };
    }

    const dDial = Math.hypot(screenPos.x - center.x, screenPos.y - center.y);
    if (dDial <= (NAVBALL_TRACK + NAVBALL_GLYPH + 8) * scale) {
      return { slot, isPin: false, center, scale, pinned: placement.pinned };
    }
  }
  return undefined;
}

function handleGuestPointer(guest: GuestPilot, action: 'down' | 'move' | 'up', event: PointerEvent): boolean | void {
  const gCanvas = guest.canvas;
  const guestShip = guest.ship(session);
  if (!guestShip || !guest.view || !guest.body) return false;

  if (action === 'down') {
    const rect = gCanvas.getBoundingClientRect();
    const screenPos = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const navHit = hitTestNavball(screenPos, guest.slot, gCanvas.clientWidth, gCanvas.clientHeight);
    if (navHit) {
      if (navHit.isPin && !hudLayout.editing) {
        const newPinned = !navHit.pinned;
        splitScreen.setConfig(setSlotNavball(splitScreen.config, navHit.slot, { pinned: newPinned }));
        notify(`Player ${navHit.slot + 1} Navball ${newPinned ? 'Pinned' : 'Unlocked (Drag to Move)'}.`);
        return true;
      }
      if (!navHit.pinned || hudLayout.editing) {
        activeNavballDrag = {
          slot: navHit.slot,
          pinned: navHit.pinned,
          pointerId: event.pointerId,
          startPointer: { x: event.clientX, y: event.clientY },
          startNavballCenter: { ...navHit.center },
          paneWidth: gCanvas.clientWidth,
          paneHeight: gCanvas.clientHeight,
        };
        try { gCanvas.setPointerCapture(event.pointerId); } catch {}
        return true;
      }
    }

    if (hudLayout.editing) return true;
    const canThrow = isThrowModeActive || isThrowKeyDown || isTouchSlingHolding || event.altKey;
    if (!canThrow || !throwCheatEnabled) return false;

    const originWorld = screenToWorld(screenPos, guest.camera.last, gCanvas.clientWidth, gCanvas.clientHeight);
    const dom = findDominantCelestialBody(originWorld, guest.view.time, guest.body?.id);
    const circ = computeBodyCircularVelocity(dom.relPos, dom.dist, dom.body);

    activeFlightSlingshot = {
      pointerId: event.pointerId,
      screenStart: { x: event.clientX, y: event.clientY },
      originWorld: { x: dom.bodyPos.x + dom.relPos.x, y: dom.bodyPos.y + dom.relPos.y },
      dominantBody: dom.body,
      dominantWorldPos: dom.bodyPos,
      relPos: { ...dom.relPos },
      pointerWorld: originWorld,
      pullVelocity: { x: 0, y: 0 },
      circularVelocity: circ.velocity,
      circularSpeed: circ.speed,
      currentSpeed: 0,
      isSnappingCircular: event.shiftKey,
      slot: guest.slot,
      targetShipId: guestShip.id,
      sourceCanvas: gCanvas,
    };
    guest.camera.stopFling();
    try {
      gCanvas.setPointerCapture(event.pointerId);
    } catch { /* ignore */ }
    updateFlightSlingshotHud();
    return true;
  }

  if (action === 'move') {
    if (activeNavballDrag && activeNavballDrag.pointerId === event.pointerId && activeNavballDrag.slot === guest.slot) {
      const dx = event.clientX - activeNavballDrag.startPointer.x;
      const dy = event.clientY - activeNavballDrag.startPointer.y;
      const newX = activeNavballDrag.startNavballCenter.x + dx;
      const newY = activeNavballDrag.startNavballCenter.y + dy;
      const fracX = Math.max(0.02, Math.min(0.98, newX / activeNavballDrag.paneWidth));
      const fracY = Math.max(0.02, Math.min(0.98, newY / activeNavballDrag.paneHeight));
      splitScreen.setConfig(setSlotNavball(splitScreen.config, activeNavballDrag.slot, {
        anchor: 'custom',
        x: fracX,
        y: fracY,
        pinned: activeNavballDrag.pinned,
      }));
      return true;
    }

    if (activeFlightSlingshot && activeFlightSlingshot.pointerId === event.pointerId && activeFlightSlingshot.slot === guest.slot) {
      const curDomPos = session.world.system.getBodyPosition(activeFlightSlingshot.dominantBody.id, guest.view.time);
      activeFlightSlingshot.dominantWorldPos = curDomPos;
      activeFlightSlingshot.originWorld = {
        x: curDomPos.x + activeFlightSlingshot.relPos.x,
        y: curDomPos.y + activeFlightSlingshot.relPos.y,
      };
      const rect = gCanvas.getBoundingClientRect();
      const screenPos = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const pointerWorld = screenToWorld(screenPos, guest.camera.last, gCanvas.clientWidth, gCanvas.clientHeight);
      activeFlightSlingshot.pointerWorld = pointerWorld;
      const dragDx = activeFlightSlingshot.originWorld.x - pointerWorld.x;
      const dragDy = activeFlightSlingshot.originWorld.y - pointerWorld.y;
      const pullVel = { x: dragDx * 0.5, y: dragDy * 0.5 };
      activeFlightSlingshot.pullVelocity = pullVel;
      const circ = computeBodyCircularVelocity(
        activeFlightSlingshot.relPos,
        Math.hypot(activeFlightSlingshot.relPos.x, activeFlightSlingshot.relPos.y),
        activeFlightSlingshot.dominantBody,
        pullVel,
      );
      activeFlightSlingshot.circularVelocity = circ.velocity;
      activeFlightSlingshot.circularSpeed = circ.speed;
      activeFlightSlingshot.isSnappingCircular = event.shiftKey;
      activeFlightSlingshot.currentSpeed = activeFlightSlingshot.isSnappingCircular
        ? circ.speed
        : Math.hypot(pullVel.x, pullVel.y);
      updateFlightSlingshotHud();
      return true;
    }
  }

  if (action === 'up') {
    if (activeNavballDrag && activeNavballDrag.pointerId === event.pointerId && activeNavballDrag.slot === guest.slot) {
      activeNavballDrag = null;
      if (gCanvas.hasPointerCapture(event.pointerId)) {
        try { gCanvas.releasePointerCapture(event.pointerId); } catch { /* Ignore */ }
      }
      return true;
    }

    if (activeFlightSlingshot && activeFlightSlingshot.pointerId === event.pointerId && activeFlightSlingshot.slot === guest.slot) {
      const s = activeFlightSlingshot;
      const dragDist = Math.hypot(event.clientX - s.screenStart.x, event.clientY - s.screenStart.y);
      const ship = s.targetShipId ? session.world.ship(s.targetShipId) : guest.ship(session);
      if (ship && event.type !== 'pointercancel') {
        let finalVel: Vec;
        if (dragDist < 6 || s.isSnappingCircular) {
          finalVel = s.circularVelocity;
        } else {
          finalVel = s.pullVelocity;
        }
        const finalSpeed = Math.hypot(finalVel.x, finalVel.y);
        const heading = Math.atan2(finalVel.y, finalVel.x);
        if (placeShip(ship, s.dominantBody.id, s.relPos, finalVel, heading,
          `Vessel ${ship.name.toUpperCase()} placed into orbit around ${s.dominantBody.name} (${finalSpeed.toFixed(1)} m/s).`)) {
          guest.camera.followShip();
          show('flight-message', `Placed ${ship.name} in orbit around ${s.dominantBody.name}`);
        }
      }
      activeFlightSlingshot = null;
      updateFlightSlingshotHud();
      if (gCanvas.hasPointerCapture(event.pointerId)) {
        try { gCanvas.releasePointerCapture(event.pointerId); } catch { /* Ignore */ }
      }
      return true;
    }
  }
}

interface ControllerCursor {
  slot: number;
  screenPos: { x: number; y: number };
  worldPos: Vec;
  visible: boolean;
  lastMovedTime: number;
  isThrowing: boolean;
  aimingPad?: number;
  interactingPad?: number;
  throwOriginWorld?: Vec;
  throwOriginScreen?: Vec;
  pullVelocity?: Vec;
  speed?: number;
  circularVelocity?: Vec;
  circularSpeed?: number;
  isSnappingCircular?: boolean;
  dominantBody?: ResolvedBody;
  relPos?: Vec;
  accentColor: string;
}

const controllerCursors = new Map<number, ControllerCursor>();
const lastPadDpadUp = new Map<number, boolean>();
const lastPadAButton = new Map<number, boolean>();
const guestNavballFrames = new Map<string, NavballFrame>();
let p1ThrowFrozenCamera: Camera | undefined;
const guestThrowFrozenCameras = new Map<number, Camera>();

function cancelControllerCursors(): void {
  controllerCursors.clear();
  lastPadDpadUp.clear();
  lastPadAButton.clear();
  p1ThrowFrozenCamera = undefined;
  guestThrowFrozenCameras.clear();
}

function isSlotThrowing(slot: number): boolean {
  if (controllerCursors.get(slot)?.isThrowing) return true;
  if (activeFlightSlingshot && (activeFlightSlingshot.slot ?? 0) === slot) return true;
  return false;
}

function controllerConsumesFlight(slot: number, padIndex: number): boolean {
  const cursor = controllerCursors.get(slot);
  if (!cursor) return false;
  if (cursor.isThrowing) return true;
  const pad = navigator.getGamepads?.()[padIndex];
  if (!pad || (!isButtonDown(pad.buttons[0]) && !isButtonDown(pad.buttons[11]))) return false;
  if (cursor.interactingPad === padIndex) return true;
  const guest = slot > 0 && splitScreen.isSeparated(slot) ? splitScreen.guests.get(slot) : undefined;
  const hit = hitTestNavball(cursor.screenPos, slot, guest?.canvas.clientWidth ?? canvas.clientWidth,
    guest?.canvas.clientHeight ?? canvas.clientHeight);
  return !!hit && (hit.isPin || !hit.pinned);
}

function updateControllerCursors(elapsed: number): void {
  if (!gamepadManager.enabled || controlsDialog.open || hudLayout.editing || document.hidden) { cancelControllerCursors(); return; }
  const gamepads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  const maxSlot = splitScreen.active;

  for (const slot of controllerCursors.keys()) {
    const cursor = controllerCursors.get(slot)!;
    const pads = splitScreen.padsOf(slot);
    if (slot >= maxSlot || !pads.length || (cursor.isThrowing && cursor.aimingPad !== undefined && !pads.includes(cursor.aimingPad))) {
      controllerCursors.delete(slot);
      guestThrowFrozenCameras.delete(slot);
      if (slot === 0) p1ThrowFrozenCamera = undefined;
    }
  }
  for (const index of lastPadDpadUp.keys()) {
    if (!gamepads[index]?.connected) { lastPadDpadUp.delete(index); lastPadAButton.delete(index); }
  }

  for (let slot = 0; slot < maxSlot; slot++) {
    const padIndices = splitScreen.padsOf(slot);
    if (!padIndices.length) continue;

    let ship: Ship | undefined;
    let body: ResolvedBody | undefined;
    let bodyPos: Vec | undefined;
    let viewPos: Vec | undefined;
    let cam: Camera | undefined;
    let guest: GuestPilot | undefined;
    let width = 0;
    let height = 0;
    let time = 0;

    if (slot === 0) {
      ship = ownShips().find(s => s.id === selectedShipId) ?? ownShips()[0] ?? selectedShip();
      body = activeBody;
      time = view.time;
      bodyPos = session.world.system.getBodyPosition(activeBody.id, time);
      viewPos = view?.position;
      cam = cameraControl.last;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
    } else {
      guest = splitScreen.guests.get(slot);
      ship = guest?.ship(session);
      body = guest?.body;
      time = guest?.view?.time ?? view.time;
      if (body && guest?.view) {
        bodyPos = session.world.system.getBodyPosition(body.id, time);
        viewPos = guest.view.position;
      }
      const separated = splitScreen.isSeparated(slot);
      cam = separated ? guest?.camera.last : cameraControl.last;
      width = separated ? (guest?.canvas.clientWidth ?? canvas.clientWidth) : canvas.clientWidth;
      height = separated ? (guest?.canvas.clientHeight ?? canvas.clientHeight) : canvas.clientHeight;
    }

    if (!ship || !body || !bodyPos || !viewPos || !cam || width <= 0 || height <= 0) continue;

    const shipWorldPos = { x: bodyPos.x + viewPos.x, y: bodyPos.y + viewPos.y };
    const accentColor = PLAYER_COLORS[slot] ?? '#38ef7d';

    let cursor = controllerCursors.get(slot);
    if (!cursor) {
      const initScreen = project(shipWorldPos, cam, width, height);
      cursor = {
        slot,
        screenPos: {
          x: Math.max(20, Math.min(width - 20, initScreen.x)),
          y: Math.max(20, Math.min(height - 20, initScreen.y)),
        },
        worldPos: shipWorldPos,
        visible: false,
        lastMovedTime: 0,
        isThrowing: false,
        accentColor,
      };
      controllerCursors.set(slot, cursor);
    }
    cursor.accentColor = accentColor;
    if (!throwCheatEnabled) cursor.isThrowing = false;

    for (const padIndex of padIndices) {
      const pad = gamepads[padIndex];
      if (!pad) continue;

      // Right Stick: moves the virtual cursor for this viewport (or Left Stick while aiming a throw)
      let rawX = pad.axes[2] ?? 0;
      let rawY = pad.axes[3] ?? 0;
      if (Math.hypot(rawX, rawY) < 0.15 && cursor.isThrowing) {
        const altX = pad.axes[0] ?? 0;
        const altY = pad.axes[1] ?? 0;
        if (Math.hypot(altX, altY) >= 0.15) {
          rawX = altX;
          rawY = altY;
        }
      }
      const stickDist = Math.hypot(rawX, rawY);
      if (stickDist > 0.15) {
        const norm = Math.min(1, (stickDist - 0.15) / 0.75);
        const vx = (rawX / stickDist) * norm;
        const vy = (rawY / stickDist) * norm;
        const CURSOR_SPEED = 650; // pixels per second across viewport
        cursor.screenPos.x = Math.max(0, Math.min(width, cursor.screenPos.x + vx * CURSOR_SPEED * elapsed));
        cursor.screenPos.y = Math.max(0, Math.min(height, cursor.screenPos.y + vy * CURSOR_SPEED * elapsed));
        cursor.visible = true;
        cursor.lastMovedTime = performance.now();
      }

      // Convert current screen position to world coordinates
      cursor.worldPos = screenToWorld(cursor.screenPos, cam, width, height);

      // Controller cursor interaction with navball (Pin / Drag)
      if (!cursor.isThrowing && presentation.isEnabled('builtin.navball')) {
        const aBtn = !!(pad.buttons[0]?.pressed || (pad.buttons[0]?.value ?? 0) > 0.5);
        const r3Btn = !!(pad.buttons[11]?.pressed || (pad.buttons[11]?.value ?? 0) > 0.5);
        const interactBtn = aBtn || r3Btn;
        if (!interactBtn && cursor.interactingPad === padIndex) cursor.interactingPad = undefined;
        const navPlacement = splitScreen.config.slots[slot]?.navball ?? defaultNavballPlacement(slot);
        const navScale = Math.min(1, Math.max(0.65, Math.min(width / 600, height / 450)));
        const navCenter = resolveNavballCenter(slot, width, height, navScale);
        const navPinPos: Vec = { x: navCenter.x + (NAVBALL_TRACK + 2) * navScale * 0.72, y: navCenter.y - (NAVBALL_TRACK + 2) * navScale * 0.72 };
        const dPin = Math.hypot(cursor.screenPos.x - navPinPos.x, cursor.screenPos.y - navPinPos.y);
        const dDial = Math.hypot(cursor.screenPos.x - navCenter.x, cursor.screenPos.y - navCenter.y);

        const lastBtnState = lastPadAButton.get(padIndex) ?? false;
        lastPadAButton.set(padIndex, interactBtn);

        if (interactBtn && !lastBtnState && dPin <= 22 * navScale) {
          cursor.interactingPad = padIndex;
          const newPinned = !navPlacement.pinned;
          splitScreen.setConfig(setSlotNavball(splitScreen.config, slot, { pinned: newPinned }));
          notify(`Player ${slot + 1} Navball ${newPinned ? 'Pinned' : 'Unlocked (Drag to Move)'}.`);
        } else if (interactBtn && !navPlacement.pinned && dDial <= (NAVBALL_TRACK + NAVBALL_GLYPH + 8) * navScale) {
          cursor.interactingPad = padIndex;
          const fracX = Math.max(0.02, Math.min(0.98, cursor.screenPos.x / width));
          const fracY = Math.max(0.02, Math.min(0.98, cursor.screenPos.y / height));
          splitScreen.setConfig(setSlotNavball(splitScreen.config, slot, {
            anchor: 'custom',
            x: fracX,
            y: fracY,
            pinned: false,
          }));
        }
      }

      // D-Pad Up: activates the slingshot throw feature
      const profile = splitScreen.config.slots[slot]?.profile;
      const throwActionHeld = profile?.buttons?.throwShip ? profile.buttons.throwShip.some(b => isButtonDown(pad.buttons[b])) : false;
      const isThrowDown = throwCheatEnabled && throwActionHeld;
      const wasThrowDown = lastPadDpadUp.get(padIndex) ?? false;
      lastPadDpadUp.set(padIndex, isThrowDown);

      if (isThrowDown && !wasThrowDown) {
        // Just pressed D-pad Up: anchor the slingshot at the ship
        cursor.isThrowing = true;
        cursor.aimingPad = padIndex;
        if (slot === 0) {
          cameraControl.stopFling();
          cameraDrag = undefined;
        } else if (guest) {
          guest.camera.stopFling();
        }
        const dom = findDominantCelestialBody(shipWorldPos, time, ship.bodyId);
        cursor.dominantBody = dom.body;
        cursor.relPos = { ...dom.relPos };
        cursor.throwOriginWorld = { x: dom.bodyPos.x + dom.relPos.x, y: dom.bodyPos.y + dom.relPos.y };
        cursor.throwOriginScreen = project(cursor.throwOriginWorld, cam, width, height);
        cursor.screenPos.x = Math.max(0, Math.min(width, cursor.throwOriginScreen.x));
        cursor.screenPos.y = Math.max(0, Math.min(height, cursor.throwOriginScreen.y));
        cursor.worldPos = cursor.throwOriginWorld;
        cursor.visible = true;
        cursor.lastMovedTime = performance.now();
        cursor.speed = 0;
        cursor.pullVelocity = { x: 0, y: 0 };
        cursor.isSnappingCircular = false;
      } else if (isThrowDown && cursor.isThrowing && cursor.dominantBody && cursor.relPos) {
        // Holding D-pad Up and dragging with the right stick:
        // Update anchor position with the dominant body's current world position so it stays still in 3D space!
        const currentDomPos = session.world.system.getBodyPosition(cursor.dominantBody.id, time);
        cursor.throwOriginWorld = { x: currentDomPos.x + cursor.relPos.x, y: currentDomPos.y + cursor.relPos.y };
        cursor.throwOriginScreen = project(cursor.throwOriginWorld, cam, width, height);

        // Pull vector is from anchor to cursor.
        // Slingshot throw velocity is in the OTHER direction (anchor - cursorWorld).
        const dragDx = cursor.throwOriginWorld.x - cursor.worldPos.x;
        const dragDy = cursor.throwOriginWorld.y - cursor.worldPos.y;
        const pullVel = { x: dragDx * 0.5, y: dragDy * 0.5 };
        const pullSpeed = Math.hypot(pullVel.x, pullVel.y);

        const snapBtn = !!(pad.buttons[2]?.pressed || pad.buttons[4]?.pressed || pad.buttons[10]?.pressed);
        cursor.isSnappingCircular = snapBtn;

        const circ = computeBodyCircularVelocity(cursor.relPos, Math.hypot(cursor.relPos.x, cursor.relPos.y), cursor.dominantBody, pullVel);
        cursor.circularVelocity = circ.velocity;
        cursor.circularSpeed = circ.speed;

        if (snapBtn) {
          cursor.pullVelocity = circ.velocity;
          cursor.speed = circ.speed;
        } else {
          cursor.pullVelocity = pullVel;
          cursor.speed = pullSpeed;
        }
      } else if (!isThrowDown && wasThrowDown && cursor.isThrowing && cursor.throwOriginWorld) {
        // Released D-pad Up: throw in the other direction if dragged
        cursor.isThrowing = false;
        if (slot === 0) {
          p1ThrowFrozenCamera = undefined;
        } else {
          guestThrowFrozenCameras.delete(slot);
        }
        const screenDist = cursor.throwOriginScreen
          ? Math.hypot(cursor.screenPos.x - cursor.throwOriginScreen.x, cursor.screenPos.y - cursor.throwOriginScreen.y)
          : 0;

        if (screenDist > 12 && cursor.speed && cursor.speed > 5 && cursor.dominantBody && cursor.relPos && cursor.pullVelocity) {
          const finalVel = cursor.isSnappingCircular ? (cursor.circularVelocity ?? cursor.pullVelocity) : cursor.pullVelocity;
          const finalSpeed = Math.hypot(finalVel.x, finalVel.y);
          const heading = Math.atan2(finalVel.y, finalVel.x);
          if (placeShip(ship, cursor.dominantBody.id, cursor.relPos, finalVel, heading,
            `Vessel ${ship.name.toUpperCase()} launched via slingshot into orbit around ${cursor.dominantBody.name} (${finalSpeed.toFixed(1)} m/s).`)) {
            if (slot > 0 && guest) {
              guest.camera.followShip();
            } else {
              cameraControl.followShip();
              syncCameraButton();
            }
            show('flight-message', `Placed ${ship.name} in orbit around ${cursor.dominantBody.name}`);
            profiler.event('pad-throw', { slot, ship: ship.id, speed: finalSpeed });
          }
        } else {
          if (slot > 0 && guest) {
            guest.camera.followShip();
          } else {
            cameraControl.followShip();
            syncCameraButton();
          }
        }
      }
    }
  }
}

function buildControllerCursorOverlay(cursor: ControllerCursor, camScale: number): OverlayPrimitive[] {
  const out: OverlayPrimitive[] = [];
  if (!cursor.visible) return out;

  const color = cursor.accentColor;

  if (cursor.isThrowing && cursor.throwOriginWorld && cursor.pullVelocity) {
    // 1. Slingshot Anchor circle at origin
    out.push({
      kind: 'circle',
      space: 'world',
      center: cursor.throwOriginWorld,
      radius: 12 / camScale,
      color,
      width: 2,
    });
    out.push({
      kind: 'circle',
      space: 'world',
      center: cursor.throwOriginWorld,
      radius: 3 / camScale,
      color: '#ffffff',
      fill: true,
    });

    const speed = cursor.speed ?? 0;
    const dragDist = Math.hypot(cursor.worldPos.x - cursor.throwOriginWorld.x, cursor.worldPos.y - cursor.throwOriginWorld.y);

    if (cursor.isSnappingCircular) {
      const circVel = cursor.circularVelocity ?? cursor.pullVelocity;
      const cSpeed = cursor.circularSpeed ?? speed;
      if (cSpeed > 0) {
        const arrowLen = 50 / camScale;
        const dirX = circVel.x / cSpeed;
        const dirY = circVel.y / cSpeed;
        const tipX = cursor.throwOriginWorld.x + dirX * arrowLen;
        const tipY = cursor.throwOriginWorld.y + dirY * arrowLen;
        out.push({
          kind: 'line',
          space: 'world',
          points: [cursor.throwOriginWorld, { x: tipX, y: tipY }],
          color: '#00d2ff',
          width: 3,
        });
        const perpX = -dirY;
        const perpY = dirX;
        const barbLen = 10 / camScale;
        out.push({
          kind: 'line',
          space: 'world',
          points: [
            { x: tipX - dirX * barbLen + perpX * (barbLen * 0.5), y: tipY - dirY * barbLen + perpY * (barbLen * 0.5) },
            { x: tipX, y: tipY },
            { x: tipX - dirX * barbLen - perpX * (barbLen * 0.5), y: tipY - dirY * barbLen - perpY * (barbLen * 0.5) },
          ],
          color: '#00d2ff',
          width: 2,
        });
      }
    } else if (dragDist * camScale > 6 && speed > 0) {
      // Pull line (red) from origin to dragged cursor
      out.push({
        kind: 'line',
        space: 'world',
        points: [cursor.throwOriginWorld, cursor.worldPos],
        color: '#ff4d4d',
        width: 2,
      });

      // Throw arrow in the OTHER direction (opposite to pull)
      const dirX = cursor.pullVelocity.x / speed;
      const dirY = cursor.pullVelocity.y / speed;
      const arrowPx = Math.min(120, Math.max(30, speed * 0.05));
      const arrowLen = arrowPx / camScale;
      const tipX = cursor.throwOriginWorld.x + dirX * arrowLen;
      const tipY = cursor.throwOriginWorld.y + dirY * arrowLen;

      out.push({
        kind: 'line',
        space: 'world',
        points: [cursor.throwOriginWorld, { x: tipX, y: tipY }],
        color,
        width: 3,
      });
      const perpX = -dirY;
      const perpY = dirX;
      const barbLen = 12 / camScale;
      out.push({
        kind: 'line',
        space: 'world',
        points: [
          { x: tipX - dirX * barbLen + perpX * (barbLen * 0.5), y: tipY - dirY * barbLen + perpY * (barbLen * 0.5) },
          { x: tipX, y: tipY },
          { x: tipX - dirX * barbLen - perpX * (barbLen * 0.5), y: tipY - dirY * barbLen - perpY * (barbLen * 0.5) },
        ],
        color,
        width: 2,
      });
    }

    // Reticle at current cursor position
    const crossR = 9 / camScale;
    out.push({
      kind: 'circle',
      space: 'world',
      center: cursor.worldPos,
      radius: crossR,
      color: cursor.isSnappingCircular ? '#00d2ff' : color,
      width: 1.5,
    });
    out.push({
      kind: 'circle',
      space: 'world',
      center: cursor.worldPos,
      radius: 2 / camScale,
      color: '#ffffff',
      fill: true,
    });

    const snapLabel = cursor.isSnappingCircular ? ' [CIRC]' : '';
    const infoText = `${speed.toFixed(0)} m/s${snapLabel} · Release D-Pad ↑`;
    out.push({
      kind: 'text',
      space: 'world',
      at: { x: cursor.worldPos.x, y: cursor.worldPos.y - 16 / camScale },
      color: cursor.isSnappingCircular ? '#00d2ff' : color,
      align: 'center',
      text: infoText,
    });

    return out;
  }

  // Normal virtual cursor for the viewpoint (when not actively throwing):
  // Clean, subtle vector reticle in the player's color
  const reticleR = 7 / camScale;
  out.push({
    kind: 'circle',
    space: 'world',
    center: cursor.worldPos,
    radius: reticleR,
    color,
    width: 1.5,
  });
  out.push({
    kind: 'circle',
    space: 'world',
    center: cursor.worldPos,
    radius: 1.5 / camScale,
    color: '#ffffff',
    fill: true,
  });

  const tickIn = 3 / camScale;
  const tickOut = 9 / camScale;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    out.push({
      kind: 'line',
      space: 'world',
      points: [
        { x: cursor.worldPos.x + dx * tickIn, y: cursor.worldPos.y + dy * tickIn },
        { x: cursor.worldPos.x + dx * tickOut, y: cursor.worldPos.y + dy * tickOut },
      ],
      color,
      width: 1.5,
    });
  }

  return out;
}

function initiateCameraFling(vel: Vec, width: number, height: number): void {
  const world = session.world;
  const bodies: SmartCandidate[] = world.system.getAllBodies().map(b => ({
    kind: 'body',
    id: b.id,
    name: b.name,
    position: world.system.getBodyPosition(b.id, view.time),
  }));

  const ships: SmartCandidate[] = [];
  const piloted = cameraControl.mode === 'free' ? undefined : selectedShip();
  if (piloted) {
    ships.push({
      kind: 'ship',
      id: piloted.id,
      name: piloted.name,
      position: bodyWorldPosition(activeBody.id, view.time, view.position),
      isPilotedShip: true,
    });
  }
  for (const s of world.records()) {
    if (piloted && s.id === piloted.id) continue;
    ships.push({
      kind: 'ship',
      id: s.id,
      name: s.name,
      position: bodyWorldPosition(s.bodyId, view.time, s.state.position),
      isPilotedShip: false,
    });
  }

  const smartTarget = findSmartThrowTarget({
    currentCenter: cameraControl.last.center,
    screenVelocity: vel,
    cameraRotation: cameraControl.rotation,
    scale: cameraControl.scale(width, height),
    bodies,
    ships,
    currentFocusId: cameraControl.focusTarget?.id,
  });

  cameraControl.fling(vel, width, height, smartTarget);
  syncCameraButton();
}

const endCameraDrag = (event: PointerEvent): void => {
  if (event.type === 'pointerup' && maneuverTap?.id === event.pointerId && cameraDrag?.id === event.pointerId && !cameraDrag.moved
    && Math.hypot(event.clientX-maneuverTap.x, event.clientY-maneuverTap.y) < 6
    && event.button === 0 && !isSlotThrowing(0) && canvasTouches.size < 2) {
    const rect = canvas.getBoundingClientRect();
    maneuver.place({ x: event.clientX - rect.left, y: event.clientY - rect.top }, cameraControl.last,
      session.world.system.getBodyPosition(activeBody.id, view.time), canvas.clientWidth, canvas.clientHeight, prediction);
  }
  if (maneuverTap?.id === event.pointerId) maneuverTap = undefined;
  if (activeNavballDrag && activeNavballDrag.pointerId === event.pointerId) {
    activeNavballDrag = null;
    if (canvas.hasPointerCapture(event.pointerId)) {
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* Ignore */ }
    }
    return;
  }
  if (activeFlightSlingshot && activeFlightSlingshot.pointerId === event.pointerId) {
    const s = activeFlightSlingshot;
    const dragDist = Math.hypot(event.clientX - s.screenStart.x, event.clientY - s.screenStart.y);
    const ship = s.targetShipId
      ? session.world.ship(s.targetShipId)
      : (selectedShip() ?? ownShips()[0]);
    if (ship) {
      let finalVel: Vec;
      if (dragDist < 6 || s.isSnappingCircular) {
        finalVel = s.circularVelocity;
      } else {
        finalVel = s.pullVelocity;
      }
      const finalSpeed = Math.hypot(finalVel.x, finalVel.y);
      const heading = Math.atan2(finalVel.y, finalVel.x);
      if (placeShip(ship, s.dominantBody.id, s.relPos, finalVel, heading,
        `Vessel ${ship.name.toUpperCase()} placed into orbit around ${s.dominantBody.name} (${finalSpeed.toFixed(1)} m/s).`)) {
        if (s.slot !== undefined && s.slot > 0) {
          const guest = splitScreen.guests.get(s.slot);
          if (guest) guest.camera.followShip();
        } else {
          cameraControl.followShip();
          syncCameraButton();
        }
        show('flight-message', `Placed ${ship.name} in orbit around ${s.dominantBody.name}`);
      }
    }
    const canvasToRelease = s.sourceCanvas ?? canvas;
    activeFlightSlingshot = null;
    updateFlightSlingshotHud();
    if (canvasToRelease.hasPointerCapture(event.pointerId)) {
      try { canvasToRelease.releasePointerCapture(event.pointerId); } catch { /* Ignore */ }
    }
    return;
  }
  if (canvasTouches.has(event.pointerId)) {
    canvasTouches.delete(event.pointerId);
    if (canvasTouches.size < 2) lastPinchDistance = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) {
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* Ignore */ }
    }
  }
  if (cameraDrag?.id === event.pointerId) {
    if (cameraDrag.moved) {
      const vel = pointerVelocityTracker.getVelocity();
      if (Math.hypot(vel.x, vel.y) > 25) {
        initiateCameraFling(vel, canvas.clientWidth, canvas.clientHeight);
      }
    }
    pointerVelocityTracker.reset();
    cameraDrag = undefined;
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(event.pointerId)) {
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* Ignore */ }
    }
  }
};

function attachCanvasListeners(target: HTMLCanvasElement): void {
  // Wheel & Trackpad pinch zoom
  target.addEventListener('wheel', event => {
    if (!Number.isFinite(event.deltaY)) return;
    event.preventDefault();
    if (event.ctrlKey) {
      // Trackpad pinch gesture (browsers synthesize ctrlKey + wheel for trackpad pinch gestures)
      const factor = Math.exp(-event.deltaY * 0.015);
      changeZoom(factor);
      return;
    }
    // Standard mouse wheel
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1;
    const pixels = Math.max(-500, Math.min(500, event.deltaY * unit));
    changeZoom(Math.exp(-pixels * .002));
  }, { passive: false });

  // Native Touch Events: 2-finger pinch-to-zoom and 1-finger drag to move/throw the camera
  let touchPinchDist: number | undefined;
  let singleTouchLast: { x: number; y: number } | undefined;
  let isPinching = false;
  let lastTouchZoomTime = -Infinity;

  target.addEventListener('touchstart', event => {
    if (activeNavballDrag || hudLayout.editing) { event.preventDefault(); singleTouchLast = undefined; touchVelocityTracker.reset(); return; }
    const wantsThrow = throwCheatEnabled && (isThrowModeActive || event.altKey || isThrowKeyDown || isTouchSlingHolding);
    if (wantsThrow) return;
    cameraControl.stopFling();
    if (event.touches.length >= 2) {
      isPinching = true;
      const t0 = event.touches[0]!;
      const t1 = event.touches[1]!;
      touchPinchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      singleTouchLast = undefined;
    } else if (event.touches.length === 1 && !isPinching) {
      singleTouchLast = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY };
      touchVelocityTracker.reset();
      touchVelocityTracker.add(event.touches[0]!.clientX, event.touches[0]!.clientY);
    }
  }, { passive: false });

  target.addEventListener('touchmove', event => {
    if (activeNavballDrag || hudLayout.editing) { event.preventDefault(); return; }
    if (event.touches.length >= 2) {
      event.preventDefault();
      isPinching = true;
      const t0 = event.touches[0]!;
      const t1 = event.touches[1]!;
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      if (touchPinchDist !== undefined && touchPinchDist > 5 && dist > 5) {
        const factor = dist / touchPinchDist;
        if (Number.isFinite(factor) && factor > 0.05 && factor < 20) {
          lastTouchZoomTime = performance.now();
          changeZoom(factor);
        }
      }
      touchPinchDist = dist;
    } else if (event.touches.length === 1 && !isPinching && singleTouchLast) {
      const t = event.touches[0]!;
      touchVelocityTracker.add(t.clientX, t.clientY);
      const delta = { x: t.clientX - singleTouchLast.x, y: t.clientY - singleTouchLast.y };
      if (Math.hypot(delta.x, delta.y) >= 1) {
        event.preventDefault();
        cameraControl.drag(delta, session.world.system.getBodyPosition(activeBody.id, view.time), view.position,
          target.clientWidth, target.clientHeight);
        syncCameraButton();
        target.classList.add('dragging');
        singleTouchLast = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: false });

  const endTouch = (event: TouchEvent) => {
    if (event.touches.length >= 2) {
      const t0 = event.touches[0]!;
      const t1 = event.touches[1]!;
      touchPinchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    } else {
      touchPinchDist = undefined;
      if (event.touches.length === 0) {
        target.classList.remove('dragging');
        singleTouchLast = undefined;
        if (!isPinching) {
          const vel = touchVelocityTracker.getVelocity();
          if (Math.hypot(vel.x, vel.y) > 25) {
            initiateCameraFling(vel, target.clientWidth, target.clientHeight);
          }
        }
        isPinching = false;
        touchVelocityTracker.reset();
      }
    }
  };

  target.addEventListener('touchend', endTouch);
  target.addEventListener('touchcancel', endTouch);

  // Safari gesture events for iOS
  let lastGestureScale = 1;
  target.addEventListener('gesturestart', event => {
    (event as Event).preventDefault();
    lastGestureScale = 1;
  }, { passive: false });
  target.addEventListener('gesturechange', event => {
    (event as Event).preventDefault();
    const e = event as unknown as { scale: number };
    if (Number.isFinite(e.scale) && e.scale > 0) {
      const deltaScale = e.scale / lastGestureScale;
      lastGestureScale = e.scale;
      changeZoom(deltaScale);
    }
  }, { passive: false });
  target.addEventListener('gestureend', event => {
    (event as Event).preventDefault();
    lastGestureScale = 1;
  }, { passive: false });

  // Pointer events: mouse drag/throw and fallback for pointer-only touchscreen devices
  target.addEventListener('pointerdown', event => {
    cameraControl.stopFling();

    const rect = target.getBoundingClientRect();
    const screenPos = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const navHit = hitTestNavball(screenPos, splitScreen.split ? 'all' : 0, target.clientWidth, target.clientHeight);
    if (navHit) {
      if (navHit.isPin && !hudLayout.editing) {
        event.preventDefault();
        const newPinned = !navHit.pinned;
        splitScreen.setConfig(setSlotNavball(splitScreen.config, navHit.slot, { pinned: newPinned }));
        notify(`Player ${navHit.slot + 1} Navball ${newPinned ? 'Pinned' : 'Unlocked (Drag to Move)'}.`);
        return;
      }
      if (!navHit.pinned || hudLayout.editing) {
        event.preventDefault();
        target.focus();
        activeNavballDrag = {
          slot: navHit.slot,
          pinned: navHit.pinned,
          pointerId: event.pointerId,
          startPointer: { x: event.clientX, y: event.clientY },
          startNavballCenter: { ...navHit.center },
          paneWidth: target.clientWidth,
          paneHeight: target.clientHeight,
        };
        try { target.setPointerCapture(event.pointerId); } catch {}
        return;
      }
    }

    if (hudLayout.editing) { event.preventDefault(); return; }
    const wantsThrow = event.altKey || isThrowModeActive || isThrowKeyDown || isTouchSlingHolding;
    if (wantsThrow) {
      if (!throwCheatEnabled) {
        notify('Throw cheat is disabled. Enable it in Settings or type /throw on in chat.');
        logChatMessage('error', 'Throw cheat is disabled. Type /throw on or enable it in Settings to unlock.');
        return;
      }
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault();
      target.focus();
      try { target.setPointerCapture(event.pointerId); } catch {}
      const originWorld = screenToWorld(screenPos, cameraControl.last, target.clientWidth, target.clientHeight);
      let chosenShip = selectedShip() ?? ownShips()[0];
      const allShips = session.world.records();
      let bestDist = Infinity;
      for (const s of allShips) {
        const sBodyPos = session.world.system.getBodyPosition(s.bodyId, view.time);
        const sWorld = { x: sBodyPos.x + s.state.position.x, y: sBodyPos.y + s.state.position.y };
        const sDist = Math.hypot(sWorld.x - originWorld.x, sWorld.y - originWorld.y) * cameraControl.last.scale;
        if (sDist < 80 && sDist < bestDist) {
          bestDist = sDist;
          chosenShip = s;
        }
      }
      const targetSlot = chosenShip
        ? ([...splitScreen.guests.entries()].find(([_, g]) => g.playerId === chosenShip.ownerId)?.[0] ?? 0)
        : 0;
      const dom = findDominantCelestialBody(originWorld, view.time, chosenShip?.bodyId ?? activeBody?.id);
      const circ = computeBodyCircularVelocity(dom.relPos, dom.dist, dom.body);
      activeFlightSlingshot = {
        pointerId: event.pointerId,
        screenStart: { x: event.clientX, y: event.clientY },
        originWorld,
        dominantBody: dom.body,
        dominantWorldPos: dom.bodyPos,
        relPos: dom.relPos,
        pointerWorld: originWorld,
        pullVelocity: { x: 0, y: 0 },
        circularVelocity: circ.velocity,
        circularSpeed: circ.speed,
        currentSpeed: 0,
        isSnappingCircular: event.shiftKey,
        slot: targetSlot,
        targetShipId: chosenShip?.id,
        sourceCanvas: canvas,
      };
      updateFlightSlingshotHud();
      return;
    }
    if (isSlotThrowing(0)) return;
    if (event.isPrimary && event.button === 0 && !navHit && canvasTouches.size === 0) {
      maneuverTap = { id: event.pointerId, x: event.clientX, y: event.clientY };
    } else maneuverTap = undefined;
    if (event.pointerType === 'touch') {
      canvasTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (canvasTouches.size === 2) {
        const [a, b] = [...canvasTouches.values()];
        lastPinchDistance = Math.hypot(b!.x - a!.x, b!.y - a!.y);
      } else if (canvasTouches.size === 1) {
        cameraDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        pointerVelocityTracker.reset();
        pointerVelocityTracker.add(event.clientX, event.clientY);
      }
      return;
    }
    if (event.pointerType !== 'mouse' || (event.button !== 0 && event.button !== 1)) return;
    if (isSlotThrowing(0)) return;
    event.preventDefault();
    target.focus();
    try { target.setPointerCapture(event.pointerId); } catch { /* Ignore */ }
    cameraDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    pointerVelocityTracker.reset();
    pointerVelocityTracker.add(event.clientX, event.clientY);
  });

  target.addEventListener('pointermove', event => {
    if (maneuverTap?.id === event.pointerId && Math.hypot(event.clientX-maneuverTap.x, event.clientY-maneuverTap.y) >= 6) maneuverTap = undefined;
    if (activeNavballDrag && activeNavballDrag.pointerId === event.pointerId) {
      const dx = event.clientX - activeNavballDrag.startPointer.x;
      const dy = event.clientY - activeNavballDrag.startPointer.y;
      const newX = activeNavballDrag.startNavballCenter.x + dx;
      const newY = activeNavballDrag.startNavballCenter.y + dy;
      const fracX = Math.max(0.02, Math.min(0.98, newX / activeNavballDrag.paneWidth));
      const fracY = Math.max(0.02, Math.min(0.98, newY / activeNavballDrag.paneHeight));
      splitScreen.setConfig(setSlotNavball(splitScreen.config, activeNavballDrag.slot, {
        anchor: 'custom',
        x: fracX,
        y: fracY,
        pinned: activeNavballDrag.pinned,
      }));
      return;
    }
    if (activeFlightSlingshot && activeFlightSlingshot.pointerId === event.pointerId) {
      const curDomPos = session.world.system.getBodyPosition(activeFlightSlingshot.dominantBody.id, view.time);
      activeFlightSlingshot.dominantWorldPos = curDomPos;
      activeFlightSlingshot.originWorld = {
        x: curDomPos.x + activeFlightSlingshot.relPos.x,
        y: curDomPos.y + activeFlightSlingshot.relPos.y,
      };
      const rect = target.getBoundingClientRect();
      const screenPos = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const pointerWorld = screenToWorld(screenPos, cameraControl.last, target.clientWidth, target.clientHeight);
      activeFlightSlingshot.pointerWorld = pointerWorld;
      const dragDx = activeFlightSlingshot.originWorld.x - pointerWorld.x;
      const dragDy = activeFlightSlingshot.originWorld.y - pointerWorld.y;
      const pullVel = { x: dragDx * 0.5, y: dragDy * 0.5 };
      activeFlightSlingshot.pullVelocity = pullVel;
      const circ = computeBodyCircularVelocity(
        activeFlightSlingshot.relPos,
        Math.hypot(activeFlightSlingshot.relPos.x, activeFlightSlingshot.relPos.y),
        activeFlightSlingshot.dominantBody,
        pullVel,
      );
      activeFlightSlingshot.circularVelocity = circ.velocity;
      activeFlightSlingshot.circularSpeed = circ.speed;
      activeFlightSlingshot.isSnappingCircular = event.shiftKey;
      activeFlightSlingshot.currentSpeed = activeFlightSlingshot.isSnappingCircular
        ? circ.speed
        : Math.hypot(pullVel.x, pullVel.y);
      updateFlightSlingshotHud();
      return;
    }
    if (event.pointerType === 'touch') {
      if (performance.now() - lastTouchZoomTime < 80) return;
      if (canvasTouches.has(event.pointerId)) {
        canvasTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (canvasTouches.size >= 2) {
          const [a, b] = [...canvasTouches.values()];
          const dist = Math.hypot(b!.x - a!.x, b!.y - a!.y);
          if (lastPinchDistance && lastPinchDistance > 5 && dist > 5) {
            changeZoom(dist / lastPinchDistance);
          }
          lastPinchDistance = dist;
          return;
        } else if (cameraDrag && cameraDrag.id === event.pointerId) {
          if (isSlotThrowing(0)) return;
          pointerVelocityTracker.add(event.clientX, event.clientY);
          const delta = { x: event.clientX - cameraDrag.x, y: event.clientY - cameraDrag.y };
          if (Math.hypot(delta.x, delta.y) >= 1) {
            cameraControl.drag(delta, session.world.system.getBodyPosition(activeBody.id, view.time), view.position,
              target.clientWidth, target.clientHeight);
            syncCameraButton();
            cameraDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: true };
            target.classList.add('dragging');
          }
        }
      }
      return;
    }
    if (!cameraDrag || cameraDrag.id !== event.pointerId) return;
    if (isSlotThrowing(0)) return;
    pointerVelocityTracker.add(event.clientX, event.clientY);
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
hudVisibility.bind('navball', 'Navballs', () => presentation.isEnabled('builtin.navball'),
  value => presentation.setEnabled('builtin.navball', value), () => presentation.setEnabled('builtin.navball', true));
hudVisibility.bind('profiler', 'Profiler', () => !profilerPanel.hidden,
  value => { if (value !== !profilerPanel.hidden) toggleProfiler(); }, () => { if (!profilerPanel.hidden) toggleProfiler(); });

setNavballPlacementProvider(() => {
  const p1Placement = splitScreen.config.slots[0]?.navball ?? defaultNavballPlacement(0);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const scale = Math.min(1, Math.max(0.65, Math.min(w / 600, h / 450)));
  const center = resolveNavballCenter(0, w, h, scale);
  const isDragging = activeNavballDrag?.slot === 0;
  return {
    x: center.x,
    y: center.y,
    scale,
    accentColor: PLAYER_COLORS[0],
    playerLabel: splitScreen.split ? 'P1' : undefined,
    pinned: p1Placement.pinned,
    isDragging,
    editing: hudLayout.editing,
  };
});




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
element('reset-world').addEventListener('click', resetWorld);
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
    downloadBytes(`${universe.id}.spacedata`, bytes);
    show('universe-status', `Exported ${universe.name}: ${(bytes.length / 1024).toFixed(1)} KiB of reusable universe definitions (.spacedata).`);
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
    if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Data files must be at most 32 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const packaged = isZip(bytes);
    if (!packaged && file.size > MAX_MODULE_BYTES) throw new Error('Legacy module files must be at most 4 MiB.');
    const text = packaged ? JSON.stringify(await decodeDataFile(bytes, 'content')) : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
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
    focusOnShipForNewWorld();
    show('module-status', local.world.soloPreview ? 'Module loaded into a new solo preview. Universe saves and hosting are unavailable; export the module/profile to keep it.' : 'Module profile loaded into a new world.');
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
element('export-module').addEventListener('click', async () => {
  const data = worldModules(session.world)?.data;
  try {
    if (data?.length === 1) downloadBytes(`${data[0]!.manifest.id}.spacedata`, await encodeDataFile('content', data[0]!));
    else if (data?.length) exportModuleProfile();
  } catch (error) { show('module-status', `Data was not exported: ${message(error)}`); }
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
  const enabled = godModeToggle.checked;
  try { localStorage.setItem(GOD_MODE_KEY, String(enabled)); } catch { /* ignore */ }
  try {
    session.setGodModeAll(enabled);
  } catch (error) {
    godModeToggle.checked = !enabled;
    notify(message(error));
  }
  profiler.event('god-mode', { enabled: godModeToggle.checked });
  lastHud = -Infinity;
});
runInBackgroundToggle.addEventListener('change', () => {
  try { localStorage.setItem(RUN_IN_BACKGROUND_KEY, String(runInBackgroundToggle.checked)); } catch { /* ignore */ }
  if (runInBackgroundToggle.checked && autoPaused && isSolo() && local.paused) {
    autoPaused = false;
    setPaused(false, 'Run in background enabled');
  }
  updateBackground();
});
cameraButton.addEventListener('click', toggleCamera);
orientationButton.addEventListener('click', toggleOrientation);
interface KeyboardLock {
  lock?(keyCodes?: readonly string[]): Promise<void>;
  unlock?(): void;
}
interface ExtendedFullscreenOptions extends FullscreenOptions {
  /** Firefox FullscreenOptions extension (dom.fullscreen.keyboard_lock.enabled). */
  keyboardLock?: 'browser' | 'none';
}
let wasFullscreen = false;
let exitingFullscreenIntentionally = false;
function syncFullscreenKeyboardLock(active: boolean): void {
  const keyboard = (navigator as Navigator & { readonly keyboard?: KeyboardLock }).keyboard;
  if (!keyboard) return;
  if (active) {
    void keyboard.lock?.(['Escape'])?.catch(() => {});
  } else {
    keyboard.unlock?.();
  }
}
function syncFullscreenButton(): void {
  const isFs = !!document.fullscreenElement || restoreFullscreenOnResume;
  fullscreenButton.setAttribute('aria-pressed', String(isFs));
  fullscreenButton.textContent = isFs ? 'Exit fullscreen' : 'Fullscreen';
}
function requestAppFullscreen(keepRestoreOnError = false): void {
  if (document.fullscreenElement) {
    restoreFullscreenOnResume = false;
    syncFullscreenButton();
    return;
  }
  const userActivation = (navigator as Navigator & { readonly userActivation?: { readonly isActive: boolean } }).userActivation;
  if (keepRestoreOnError && userActivation && !userActivation.isActive) {
    syncFullscreenButton();
    return;
  }
  syncFullscreenKeyboardLock(true);
  const options: ExtendedFullscreenOptions = { navigationUI: 'hide', keyboardLock: 'browser' };
  const promise = document.documentElement.requestFullscreen?.(options);
  if (!promise) {
    if (!keepRestoreOnError) restoreFullscreenOnResume = false;
    syncFullscreenButton();
    return;
  }
  void promise.then(() => {
    restoreFullscreenOnResume = false;
    syncFullscreenKeyboardLock(true);
    syncFullscreenButton();
  }).catch(() => {
    if (!keepRestoreOnError) restoreFullscreenOnResume = false;
    syncFullscreenButton();
  });
}
function toggleFullscreen(): void {
  if (!document.fullscreenElement && (!restoreFullscreenOnResume || !workspace.isOpen)) {
    exitingFullscreenIntentionally = false;
    requestAppFullscreen(false);
  } else {
    exitingFullscreenIntentionally = true;
    restoreFullscreenOnResume = false;
    syncFullscreenKeyboardLock(false);
    syncFullscreenButton();
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {
        exitingFullscreenIntentionally = false;
      });
    } else {
      exitingFullscreenIntentionally = false;
    }
  }
}
fullscreenButton.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement;
  const exitedViaBrowserEscape = wasFullscreen && !isFs && !exitingFullscreenIntentionally;
  wasFullscreen = isFs;
  if (isFs) {
    exitingFullscreenIntentionally = false;
    restoreFullscreenOnResume = false;
    syncFullscreenKeyboardLock(true);
  } else {
    exitingFullscreenIntentionally = false;
    syncFullscreenKeyboardLock(false);
    if (exitedViaBrowserEscape) {
      restoreFullscreenOnResume = true;
      workspace.handleFullscreenEscape();
    }
  }
  syncFullscreenButton();
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

// Fleet & Navigation
function cycleShip(direction: number): void {
  const own = ownShips();
  if (cameraControl.mode === 'free' || own.length < 2) {
    cyclePlanet(direction);
    return;
  }
  const index = own.findIndex(s => s.id === selectedShipId);
  selectShip(own[(index + direction + own.length) % own.length]!.id);
}

function cyclePlanet(direction: number): void {
  const bodies = session.world.system.getAllBodies();
  if (bodies.length === 0) return;
  const currentTargetId = cameraControl.focusTarget?.kind === 'body' ? cameraControl.focusTarget.id : activeBody.id;
  const currentIndex = bodies.findIndex(b => b.id === currentTargetId);
  const nextIndex = (currentIndex + direction + bodies.length) % bodies.length;
  const nextBody = bodies[nextIndex]!;

  cameraControl.planetView(nextBody.radius);
  cameraControl.focusTarget = { kind: 'body', id: nextBody.id, name: nextBody.name };
  cameraControl.smartTarget = undefined;
  cameraControl.mode = 'free';
  cameraControl.dragged = false;
  cameraControl.rotation = 0;
  show('active-body', nextBody.name.toUpperCase());
  syncCameraButton();
  notify(`Viewing ${nextBody.name}`);
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
  if (piloted && document.activeElement !== godModeToggle) {
    if (godModeToggle.checked && !piloted.state.godMode) {
      try { session.setGodModeAll(true); } catch { /* ignore */ }
    } else if (!godModeToggle.checked && piloted.state.godMode) {
      godModeToggle.checked = true;
    }
  }
  const resetWorldBtn = element<HTMLButtonElement>('reset-world');
  if (resetWorldBtn) {
    resetWorldBtn.disabled = session !== local;
    resetWorldBtn.title = session === local ? 'Reset World (Host only): rewind clock to T+0 and reset all vessels' : 'Only the host can reset the world';
  }
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

// Multiplayer transports share the loaded LocalSession: same-browser tabs, WebRTC
// invites, and the desktop executable's LAN listener. Dedicated servers own their world.
type MpMode = 'invite' | 'server';
const MP_MODE_KEY = 'space-sim-mp-mode';
let invite: Invite | undefined;
let reply: Reply | undefined;
/** Gathering addresses for a reply code (a few seconds). */
let answering = false;
let pending: ClientSession | undefined;
let localHost: LocalHost | undefined;
let discovery: LocalDiscovery | undefined;
let scan: AbortController | undefined;
let connectingServer = false;
let serverShareAddress: string | undefined;
let computerHost: DesktopHost | undefined;
let computerHosting = false;
let computerStarting = false;
let computerGeneration = 0;
let recentConnectionReport: (() => ConnectionDiagnostics) | undefined;
let inviteGeneration = 0;
let inviteGathering: AbortController | undefined;
const sameBrowser = typeof BroadcastChannel === 'function';
const connectedPilotIds = new Set<string>();
const orbitMode = element<HTMLSelectElement>('other-orbit-mode');
try {
  const saved = localStorage.getItem('space-sim.other-orbits/1');
  if (saved === 'always' || saved === 'off') orbitMode.value = saved;
} catch { /* defaults remain available without storage */ }
orbitMode.addEventListener('change', () => {
  otherOrbits.clear();
  try { localStorage.setItem('space-sim.other-orbits/1', orbitMode.value); } catch { /* session-only preference */ }
});
const isConnectedPilot = (id: string): boolean => connectedPilotIds.has(id);
nameInput.value = savedName();
nameInput.addEventListener('change', () => {
  nameInput.value = cleanName(nameInput.value, MAX_PLAYER_NAME);
  saveName(nameInput.value);
  if (session === local) {
    local.host.seatHost(pilotName(), local.token);
    localHost?.announce();
  }
});

function mpStatus(text: string): void { show('mp-status', text); show('local-mp-status', text); }
function setMpMode(mode: MpMode, remember = true): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.mp-modes [role="tab"]')) {
    const selected = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    element(`mp-panel-${tab.dataset.mode}`).hidden = !selected;
  }
  if (remember) try { localStorage.setItem(MP_MODE_KEY, mode); } catch { /* storage unavailable */ }
}
const mpTabs = [...document.querySelectorAll<HTMLButtonElement>('.mp-modes [role="tab"]')];
for (const tab of mpTabs) {
  tab.addEventListener('click', () => setMpMode(tab.dataset.mode as MpMode));
  tab.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = mpTabs[(mpTabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : mpTabs.length - 1)) % mpTabs.length]!;
    setMpMode(next.dataset.mode as MpMode);
    next.focus();
  });
}
{
  let saved: string | null = null;
  try { saved = localStorage.getItem(MP_MODE_KEY); } catch { /* storage unavailable */ }
  setMpMode(saved === 'invite' ? 'invite' : 'server', false);
}
element('local-multiplayer').hidden = !sameBrowser;
// Debug controls share the normal session actions and lifecycle.
element('debug-host-game').addEventListener('click', () => element<HTMLButtonElement>('host-game').click());
element('debug-stop-hosting').addEventListener('click', () => element<HTMLButtonElement>('stop-hosting').click());
element('debug-leave-game').addEventListener('click', () => element<HTMLButtonElement>('leave-game').click());

function updateMultiplayer(): void {
  const hosting = isHosting();
  const offline = session === local && !hosting;
  const cannotHost = session.world.soloPreview || !!pending || answering || connectingServer || computerStarting;
  element('mp-offline').hidden = !offline || !!reply;
  element('local-browser-controls').hidden = !offline || !!reply;
  element<HTMLButtonElement>('debug-host-game').disabled = cannotHost;
  element('debug-stop-hosting').hidden = !hosting;
  element('debug-leave-game').hidden = session === local;
  element('mp-reply').hidden = !reply;
  element('mp-hosting').hidden = !hosting;
  element('mp-computer-host').hidden = !desktopHostToken;
  element<HTMLButtonElement>('host-computer').disabled = cannotHost;
  element<HTMLButtonElement>('host-game').disabled = cannotHost;
  element('mp-computer-hosting').hidden = !computerHosting;
  element('mp-browser-host-note').hidden = computerHosting;
  element('create-invite').hidden = computerHosting;
  element('internet-row').hidden = computerHosting;
  element('invite-panel').hidden = !invite;
  element('mp-online').hidden = session === local;
  joinButton.disabled = !!pending || connectingServer;
  element('copy-server-link').hidden = !serverShareAddress && !computerHost;
  element('mp-diagnostics').hidden = !invite && !reply && !recentConnectionReport;
  element<HTMLButtonElement>('answer-invite').disabled = answering || !!pending;
  if (session !== local) {
    connectionLabel.innerHTML = '<i></i> ONLINE';
    connectionLabel.append(` · ${remote?.client.hostName.toUpperCase() ?? ''}`);
  } else if (hosting) {
    connectionLabel.innerHTML = '<i></i> HOSTING';
    connectionLabel.append(` · ${local.host.connectedCount()} ${local.host.connectedCount() === 1 ? 'PILOT' : 'PILOTS'}`);
  } else connectionLabel.innerHTML = localLabel;
  // Other tabs' worlds are listed while this one could join them.
  if (offline && sameBrowser && !discovery) discovery = new LocalDiscovery(renderLocalWorlds);
  else if (!offline && discovery) { discovery.close(); discovery = undefined; }
  if (!offline || pending || reply || answering || connectingServer) stopScan();
  renderLocalWorlds(discovery?.worlds() ?? []);
  lastLists = -Infinity;
}
let playersKey = '';
function updatePlayers(): void {
  const players = session === local && !local.hosting ? [] : session.players();
  connectedPilotIds.clear();
  for (const player of players.length ? players : session.players()) if (player.connected) connectedPilotIds.add(player.id);
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
  if (isHosting()) {
    localHost?.announce();
    updateMultiplayer();
  }
}

/** A list row: a label with detail, and a Join button. */
function joinRow(label: string, detail: string, action: string, onjoin: () => void, disabled = false): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'mp-found';
  const text = document.createElement('span');
  text.textContent = `● ${label}`;
  const small = document.createElement('small');
  small.textContent = detail;
  text.append(small);
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Join';
  button.setAttribute('aria-label', action);
  button.disabled = disabled || !!pending;
  button.addEventListener('click', onjoin);
  item.append(text, button);
  return item;
}
function renderLocalWorlds(worlds: readonly LocalAdvert[]): void {
  element('local-worlds').replaceChildren(...worlds.map(world => joinRow(world.name,
    `${world.players}/${world.maxPlayers} ${world.maxPlayers === 1 ? 'pilot' : 'pilots'}`, `Join ${world.name}`,
    () => void joinLocal(world.host), world.players >= world.maxPlayers)));
  element('local-empty').hidden = worlds.length > 0;
}

async function copy(textarea: HTMLTextAreaElement): Promise<void> {
  try { await navigator.clipboard.writeText(textarea.value); mpStatus('Copied.'); } catch {
    textarea.select();
    mpStatus(document.execCommand('copy') ? 'Copied.' : 'Select the code and copy it.');
  }
}
async function copyLink(value: string): Promise<void> {
  const output = element<HTMLTextAreaElement>('mp-share-link');
  output.value = value;
  output.hidden = false;
  await copy(output);
}
element('copy-server-link').addEventListener('click', () => {
  if (computerHost) void copyLink(computerHost.addresses[0] ?? computerHost.localAddress);
  else if (serverShareAddress) void copyLink(serverLink(serverShareAddress, location.protocol === 'https:'));
});
element('copy-invite-link').addEventListener('click', () => {
  if (!invite) return;
  const link = inviteLink(location.href, invite.code);
  if (link) void copyLink(link);
  else mpStatus('This game is an offline file. Use Copy invite; your friend can paste it into their own copy.');
});
element('mp-diagnostics').addEventListener('click', () => {
  const report = invite?.diagnostics() ?? reply?.diagnostics() ?? recentConnectionReport?.();
  if (report) download('space-sim-connection.json', JSON.stringify({ version: 1, ...report }, null, 2));
});

function beginHosting(): boolean {
  if (session !== local || local.hosting || pending || answering || connectingServer) return false;
  if (local.world.soloPreview) { mpStatus('Custom flight profiles are solo previews; use the built-in default to host.'); return false; }
  local.hosting = true;
  serverShareAddress = undefined;
  rememberToken(local.world.id, local.token, local.playerId);
  local.host.seatHost(pilotName(), local.token);
  if (local.paused) setPaused(false);
  if (sameBrowser) {
    localHost = new LocalHost(() => ({ name: `${pilotName()} · ${local.world.system.system.name}`, worldId: local.world.id,
      players: local.host.connectedCount(), maxPlayers: local.host.settings.maxPlayers }), connection => local.accept(connection));
  }
  mpStatus(sameBrowser
    ? 'Hosting. Other tabs can join from Tools → Multiplayer debugging. For friends elsewhere, create one invite per player in Online.'
    : 'Hosting. Create one invite per player and send it to them (chat, email…). They send back a reply code.');
  profiler.event('host-start', { world: local.world.id });
  syncLocks();
  updateMultiplayer();
  return true;
}
element('host-game').addEventListener('click', () => {
  if (!computerStarting) beginHosting();
});
element('host-computer').addEventListener('click', async () => {
  if (!desktopHostToken || computerStarting || session !== local || local.hosting) return;
  computerHosting = true;
  if (!beginHosting()) { computerHosting = false; updateMultiplayer(); return; }
  computerStarting = true;
  const generation = ++computerGeneration;
  updateMultiplayer();
  mpStatus('Starting hosting on this computer…');
  try {
    const host = await hostOnComputer(connection => {
      if (computerHosting && isHosting() && generation === computerGeneration) local.accept(connection);
      else connection.close('The host stopped hosting.');
    }, reason => {
      if (generation !== computerGeneration) return;
      stopHosting();
      syncLocks();
      updateMultiplayer();
      mpStatus(reason);
    });
    if (!computerHosting || !isHosting() || generation !== computerGeneration) { host.stop(); return; }
    computerHost = host;
    const links = host.addresses.length ? host.addresses : [host.localAddress];
    element('mp-computer-links').replaceChildren(...links.map(address => {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.href = address;
      link.textContent = address;
      link.target = '_blank';
      link.rel = 'noopener';
      row.append(link);
      return row;
    }));
    mpStatus(host.addresses.length
      ? 'Hosting your loaded world. Copy a game link for friends on the same network.'
      : 'Hosting your loaded world. No network address found; the displayed link works only on this computer.');
  } catch (error) {
    if (generation === computerGeneration) {
      stopHosting();
      syncLocks();
      mpStatus(message(error));
    }
  } finally {
    computerStarting = false;
    updateMultiplayer();
  }
});
function cancelInvite(): void {
  inviteGeneration++;
  inviteGathering?.abort();
  inviteGathering = undefined;
  element<HTMLButtonElement>('create-invite').disabled = false;
  element('mp-share-link').hidden = true;
  recentConnectionReport = invite?.diagnostics ?? recentConnectionReport;
  invite?.cancel();
  invite = undefined;
  updateMultiplayer();
}
function stopHosting(reason = 'The host stopped hosting.'): void {
  computerGeneration++;
  computerHost?.stop();
  computerHost = undefined;
  computerHosting = false;
  element('mp-computer-links').replaceChildren();
  cancelInvite();
  local.host.close(reason);
  localHost?.close(reason);
  localHost = undefined;
  local.hosting = false;
}
element('stop-hosting').addEventListener('click', () => {
  stopHosting();
  mpStatus('Stopped hosting. Remote ships stay in this world.');
  profiler.event('host-stop', {});
  syncLocks();
  updateMultiplayer();
  updateBackground();
});
element('create-invite').addEventListener('click', async () => {
  const button = element<HTMLButtonElement>('create-invite');
  button.disabled = true;
  mpStatus('Preparing an invite… Finding addresses can take up to 45 seconds.');
  element('mp-share-link').hidden = true;
  const generation = ++inviteGeneration;
  const gathering = new AbortController();
  inviteGathering?.abort();
  inviteGathering = gathering;
  try {
    invite?.cancel();
    invite = undefined;
    const made = await createInvite(stunToggle.checked, gathering.signal);
    if (!isHosting() || generation !== inviteGeneration) { made.cancel(); return; }
    invite = made;
    recentConnectionReport = made.diagnostics;
    element<HTMLTextAreaElement>('invite-code').value = made.code;
    element<HTMLTextAreaElement>('host-reply').value = '';
    mpStatus(made.stun
      ? 'Send the invite link or code to one friend. Paste their reply here. Some networks need a server link instead.'
      : 'Send the invite to one player on your network. Paste the reply code they send back in step 2.');
  } catch (error) {
    if (generation === inviteGeneration) {
      invite = undefined;
      mpStatus(`Could not create an invite: ${message(error)}`);
    }
  } finally {
    if (generation === inviteGeneration) button.disabled = false;
    if (inviteGathering === gathering) inviteGathering = undefined;
    updateMultiplayer();
  }
});
element('cancel-invite').addEventListener('click', () => { cancelInvite(); mpStatus('Invite cancelled.'); });
element('copy-invite').addEventListener('click', () => void copy(element<HTMLTextAreaElement>('invite-code')));
element('accept-reply').addEventListener('click', async () => {
  const current = invite;
  const button = element<HTMLButtonElement>('accept-reply');
  if (!current || button.disabled) return;
  button.disabled = true;
  mpStatus('Connecting the player…');
  try {
    const connection = await current.accept(element<HTMLTextAreaElement>('host-reply').value);
    if (invite === current) invite = undefined;
    // Hosting stopped while the link opened.
    if (!isHosting()) { connection.close('The host stopped hosting.'); return; }
    local.accept(connection);
    mpStatus('Player connected. Create another invite for the next player.');
  } catch (error) {
    recentConnectionReport = current.diagnostics;
    if (invite === current) mpStatus(message(error));
  } finally {
    button.disabled = false;
    updateMultiplayer();
  }
});
element<HTMLTextAreaElement>('host-reply').addEventListener('paste', event => {
  const code = event.clipboardData?.getData('text').trim();
  if (!code || !isReplyCode(code)) return;
  event.preventDefault();
  element<HTMLTextAreaElement>('host-reply').value = code;
  element<HTMLButtonElement>('accept-reply').click();
});

function startClient(connection: Connection): void {
  const identity = new JoinIdentity();
  const joiningWorld = local.world;
  const installed = worldModules(joiningWorld);
  const code = [...GAME_EXAMPLES, ...moduleLibrary.modules(environment()).filter(m => m.manifest.authority === 'authoritative')];
  const client: ClientSession = new ClientSession(connection, {
    name: pilotName(), ...(passwordInput.value ? { password: passwordInput.value } : {}),
    token: (worldId, hostId) => identity.token(worldId, hostId),
    saveToken: (worldId, token, playerId) => identity.remember(worldId, token, playerId, client.hostSeat),
    lock: joiningWorld.lock, simulationFingerprint: joiningWorld.simulationFingerprint,
    createContext: installed?.createContext,
    rules: joiningWorld.rules, forces: joiningWorld.forces, commands: joiningWorld.commands,
    verifyCandidate: candidate => {
      if (local.world !== joiningWorld) return { ok: false, reason: 'Your local game changed while joining. Try joining again.' };
      if (!installed) return { ok: false, reason: 'Load an installed game before joining this server.' };
      if (installed.runtime) return moduleManager!.devices.verifyCandidate(candidate);
      return verifyServerCandidate(candidate, { environment: environment(), profile: installed.profile, data: installed.data, code });
    },
  });
  pending = client;
  updateMultiplayer();
  client.onjoined = () => {
    pending = undefined;
    // Joining ends anything this tab offered to others.
    if (isHosting()) stopHosting('The host joined another game.');
    if (session === local && !local.paused) setPaused(true, 'Playing online');
    remote = new RemoteSession(client);
    useSession(remote);
    mpStatus(`Joined ${client.hostName}. Your ships are listed under Fleet.`);
    notify(`Welcome to ${client.hostName}.`);
    logChatMessage('system', `Joined ${client.hostName}. Messages you type here reach every pilot.`);
    profiler.event('join', { world: client.worldId });
  };
  client.onplayers = () => { lastLists = -Infinity; };
  client.onnotice = text => { notify(text); logChatMessage('system', text); };
  client.onclose = reason => {
    identity.release();
    if (pending === client) pending = undefined;
    if (remote?.client === client) {
      remote = undefined;
      useSession(local);
      setPaused(true, `Left the online game (${reason})`);
      logChatMessage('system', `Left the online game: ${reason}`);
      profiler.event('leave', { reason });
    }
    if (/password/i.test(reason)) { element('password-row').hidden = false; setMpMode('server'); }
    mpStatus(reason);
    updateMultiplayer();
  };
}

/** Player side of an invite: make the reply code, then wait for the host to accept it. */
async function answerInviteCode(text: string): Promise<void> {
  if (pending || reply || answering || session !== local || isHosting()) return;
  answering = true;
  updateMultiplayer();
  mpStatus('Reading the invite…');
  let answer: Reply;
  try { answer = await answerInvite(text); } catch (error) {
    mpStatus(message(error));
    return;
  } finally {
    answering = false;
    updateMultiplayer();
  }
  if (session !== local || isHosting() || pending) { answer.cancel(); return; }
  reply = answer;
  recentConnectionReport = answer.diagnostics;
  element<HTMLTextAreaElement>('reply-code').value = answer.code;
  mpStatus('Step 2: send this reply code to the host.');
  updateMultiplayer();
  try {
    const connection = await answer.connection;
    if (reply !== answer) { connection.close('Cancelled.'); return; }
    reply = undefined;
    startClient(connection);
  } catch (error) {
    // Cancelled or replaced: whatever came after owns the panel now.
    if (reply !== answer) return;
    reply = undefined;
    recentConnectionReport = answer.diagnostics;
    mpStatus(message(error));
  }
  updateMultiplayer();
}
element('answer-invite').addEventListener('click', () => {
  const text = inviteFromText(element<HTMLTextAreaElement>('invite-input').value);
  if (!text) { mpStatus('Paste the invite code the host sent you.'); return; }
  void answerInviteCode(text);
});
element<HTMLTextAreaElement>('invite-input').addEventListener('paste', event => {
  const code = inviteFromText(event.clipboardData?.getData('text') ?? '');
  if (!isInviteCode(code)) return;
  event.preventDefault();
  element<HTMLTextAreaElement>('invite-input').value = code;
  void answerInviteCode(code);
});

const isLoopback = (url: string): boolean => {
  try { return /^(localhost|127(\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/i.test(new URL(url).hostname); } catch { return false; }
};
async function join(): Promise<void> {
  const text = inviteFromText(joinInput.value);
  if (!text || pending || reply || connectingServer || session !== local || isHosting()) return;
  // An invite pasted where a server address goes.
  if (isInviteCode(text)) {
    element<HTMLTextAreaElement>('invite-input').value = text;
    joinInput.value = '';
    setMpMode('invite');
    await answerInviteCode(text);
    return;
  }
  let url: string;
  try { url = serverUrl(text, location.protocol === 'https:'); } catch (error) { mpStatus(message(error)); return; }
  stopScan();
  mpStatus(`Connecting to ${url}…`);
  connectingServer = true;
  joinButton.disabled = true;
  try {
    const connection = await connectWebSocket(url);
    if (session !== local || isHosting() || pending || reply) { connection.close('Another connection was selected.'); return; }
    serverShareAddress = url;
    startClient(connection);
  } catch (error) {
    mpStatus(location.protocol === 'https:' && url.startsWith('ws:') ? `${message(error)} Secure pages can only reach wss:// servers.`
      : isLoopback(url) ? `Could not reach a Space Sim server on ${new URL(url).host}. Choose Host on this computer in the desktop game, `
        + 'or start the dedicated server (npm run server, or the space-sim-server program). To test with another tab, use Tools → Multiplayer debugging.'
      : `${message(error)} Check the address and that the server is running and reachable (firewall, same network).`);
  } finally { connectingServer = false; updateMultiplayer(); }
}
async function joinLocal(host: string): Promise<void> {
  if (pending || reply || session !== local || isHosting()) return;
  mpStatus('Joining the world in another tab…');
  try { startClient(await connectLocal(host)); } catch (error) { mpStatus(message(error)); }
  updateMultiplayer();
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

// LAN scan: browsers cannot see this computer's address, so it tries likely ones.
function stopScan(): void {
  scan?.abort();
  scan = undefined;
  element<HTMLButtonElement>('scan-lan').textContent = 'Scan local network';
}
element('scan-lan').addEventListener('click', async () => {
  if (scan) { stopScan(); mpStatus('Scan stopped.'); return; }
  if (location.protocol === 'https:') {
    mpStatus('Secure (https) pages cannot reach local servers. Open the game from the server itself, or the desktop app, to scan.');
    return;
  }
  const current = scan = new AbortController();
  const list = element('lan-servers');
  list.replaceChildren();
  list.hidden = false;
  element<HTMLButtonElement>('scan-lan').textContent = 'Stop scan';
  let found = 0;
  const results = await scanServers(lanCandidates([location.hostname, joinInput.value]), {
    signal: current.signal,
    onprogress: (done, total) => { if (scan === current) mpStatus(`Scanning ${done}/${total}… ${found ? `${found} found.` : ''}`); },
    onfound: server => {
      found++;
      const row = joinRow(server.name, `${server.address} · ${server.players}/${server.maxPlayers}${server.password ? ' · password' : ''}`
        + `${server.compatible ? '' : ' · other version'}`, `Join ${server.name} at ${server.address}`, () => {
        joinInput.value = server.address;
        if (server.password) element('password-row').hidden = false;
        void join();
      }, !server.compatible);
      if (!server.compatible) {
        const link = document.createElement('a');
        link.href = serverLink(server.address);
        link.textContent = 'Open server game';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = 'The client and server use different multiplayer versions. Open the matching game served by this server, or update both together.';
        row.querySelector('small')!.append(' · ', link);
      }
      list.append(row);
    },
  });
  if (scan !== current) return;
  stopScan();
  mpStatus(results.length ? `Found ${results.length} ${results.length === 1 ? 'server' : 'servers'}.`
    : 'No servers found on the usual addresses. Enter the server\'s address (shown in its window) above.');
});

// Closing or reloading the tab says goodbye at once instead of leaving others waiting.
window.addEventListener('pagehide', () => {
  otherOrbits.clear();
  if (isHosting()) stopHosting('The host closed the game.');
  remote?.client.leave();
  discovery?.close();
  discovery = undefined;
});

// A universe save contains progress; reusable definitions export separately as .spacedata.
element('save-world').addEventListener('click', async () => {
  if (session !== local || local.world.soloPreview) return;
  rememberToken(local.world.id, local.token, local.playerId);
  const save = saveWorld(local.world, { players: local.host.roster(), hostId: local.playerId, paused: local.paused,
    savedAt: new Date().toISOString() });
  try {
    downloadBytes(`${save.universe.id.replace(/[^a-z0-9._-]/gi, '-').slice(0, 80)}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.spaceuniverse`, await encodeUniverseSave(save));
    notify(`Universe saved with ${save.ships.length} ${save.ships.length === 1 ? 'ship' : 'ships'}. A dedicated server can run it with --import.`);
    profiler.event('world-save', { ships: save.ships.length });
  } catch (error) { notify(`Universe was not saved: ${message(error)}`); }
});
const worldFileInput = element<HTMLInputElement>('world-file');
element('load-world').addEventListener('click', () => worldFileInput.click());
worldFileInput.addEventListener('change', async () => {
  const file = worldFileInput.files?.[0];
  if (!file) return;
  const originalWorld = session.world;
  try {
    if (session !== local || local.hosting) throw new Error('Load universe saves in your solo game.');
    if (file.size > 64 * 1024 * 1024) throw new Error('Universe save files must be at most 64 MiB.');
    const saved = await decodeUniverseSave(new Uint8Array(await file.arrayBuffer()));
    if (session.world !== originalWorld || session !== local || local.hosting) throw new Error('The active session changed while loading.');
    let installedProfile = worldModules(local.world);
    const configuration = savedProgressConfiguration(saved);
    let restoredArtifacts: readonly import('../../../packages/game-runtime/src/artifact').CodeArtifact[] | undefined;
    let restoredCode: readonly import('../../../packages/game-api/src/index').RegisteredModule[] | undefined;
    if (configuration) {
      await moduleLibrary.open();
      const restored = await reconstructProgress(configuration, moduleLibrary.store, environment(), { data: [...moduleLibrary.data.values()],
        code: GAME_EXAMPLES, allowRuntimeCode: ALLOW_RUNTIME_CODE, approvedLegacyDigests: new Set(configuration.code.map(ref => ref.digest)) });
      const active = local.world.configuration;
      if (canonicalJson(active ?? null) !== canonicalJson(configuration) && restored.executablePackages.length) {
        if (!ALLOW_RUNTIME_CODE) throw new Error('This build does not allow imported code');
        if (!confirm(`This progress requires installed code with full access to saved data, input and the network. Only enable code from people you trust. Enable these exact packages?\n${restored.executablePackages.map(p => `${p.id}@${p.version} SHA-256 ${p.digest}`).join('\n')}`)) throw new Error('Progress activation cancelled; the active game was retained');
      }
      restoredCode = restored.code; restoredArtifacts = restored.artifacts;
      installedProfile = { ...restored, baseUniverse: (saved as { universe: UniverseDefinition }).universe,
        universeKey: `builtin.content/${(saved as { universe: UniverseDefinition }).universe.id}`, createContext: installedProfile!.createContext };
    }
    if (installedProfile?.runtime) {
      await moduleManager!.devices.loadWorldGame(installedProfile.runtime, { profile: installedProfile.profile, data: installedProfile.data,
        code: restoredCode ?? [...GAME_EXAMPLES, ...moduleLibrary.modules(environment()).filter(m => m.manifest.authority === 'authoritative')], configuration, restore: saved }, prepared => {
        checkCommandKeys(prepared.loaded.world.commands);
        rememberWorldModules(prepared.loaded.world, { ...installedProfile, createContext: prepared.createContext });
        const next = new LocalSession(prepared.loaded.world, { name: pilotName(), players: prepared.loaded.players,
          ...(prepared.loaded.hostId ? { hostId: prepared.loaded.hostId } : {}) });
        prepared.candidate.own({ dispose: () => next.host.dispose() });
        if (restoredArtifacts) moduleLibrary.replace([...moduleLibrary.artifacts.filter(m => m.manifest.authority === 'presentation'), ...restoredArtifacts]);
        moduleManager!.resetData(installedProfile!.data);
        local.dispose(); local = next; useSession(local, true); setPaused(true, 'Universe loaded');
      });
      notify('Universe loaded.');
      return;
    }
    const loaded = loadInstalledWorld(saved, { environment: environment(),
      data: worldModules(local.world)?.data, code: [...GAME_EXAMPLES, ...moduleLibrary.modules(environment()).filter(m => m.manifest.authority === 'authoritative'
        && worldModules(local.world)?.profile.modules.some(ref => ref.id === m.manifest.id))] });
    if (loaded.prepared) rememberWorldModules(loaded.world, { data: worldModules(local.world)?.data ?? [], profile: loaded.prepared.profile,
      baseUniverse: installedProfile?.baseUniverse ?? loaded.world.universe,
      universeKey: installedProfile?.universeKey ?? `builtin.content/${loaded.world.universe.id}`, createContext: loaded.prepared.createContext });
    if (!universes.has(loaded.world.universe.id)) universes.set(loaded.world.universe.id, loaded.world.universe);
    replaceLocalWorld(loaded.world, { players: loaded.players, ...(loaded.hostId ? { hostId: loaded.hostId } : {}) });
    setPaused(true, 'Universe loaded');
    notify('Universe loaded.');
    profiler.event('world-load', { world: loaded.world.id, ships: loaded.world.size });
  } catch (error) {
    alert(`Universe was not loaded: ${message(error)}`);
  } finally {
    worldFileInput.value = '';
  }
});

function executeAction(action: ActionId): void {
  if (controlsDialog.open || hudLayout.editing) return;
  if (isSlotThrowing(0)) {
    const cameraAlteringActions = new Set<ActionId>([
      'camera', 'orientation', 'cycleShip', 'cycleShipPrev', 'cyclePlanet', 'cyclePlanetPrev', 'zoomIn', 'zoomOut',
    ]);
    if (cameraAlteringActions.has(action)) return;
  }
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
    case 'cyclePlanet':
      cyclePlanet(1);
      break;
    case 'cyclePlanetPrev':
      cyclePlanet(-1);
      break;
    case 'throwShip':
      toggleThrowMode();
      break;
  }
}

gamepadManager.onShortcut(action => executeAction(action));
touchControls.onShortcut(action => executeAction(action));
touchControls.onZoom(factor => changeZoom(factor));
touchControls.attach(element('flight-view').parentElement!);
hudVisibility.bind('touch', 'Touch controls', () => document.getElementById('touch-overlay')?.hasAttribute('hidden') === false,
  value => { release(); touchControls.saveMode(value ? 'always' : 'never'); }, () => touchControls.saveMode('auto'));
touchControls.onSlingHold(holding => {
  isTouchSlingHolding = holding;
  updateThrowModeUI();
});
updateThrowCheatUI();

throwShipToggleBtn?.addEventListener('click', () => {
  toggleThrowMode();
});
throwCheatToggle?.addEventListener('change', () => {
  setThrowCheat(throwCheatToggle.checked);
  logChatMessage(throwCheatEnabled ? 'success' : 'system', `Throw / orbit cheat ${throwCheatEnabled ? 'ENABLED' : 'DISABLED'}.`);
});

window.addEventListener('keydown', event => {
  if (controlsDialog.open || hudLayout.editing) return;
  if (event.target && (event.target as HTMLElement).closest('input, select, textarea, [contenteditable]')) return;
  const actions = keyLookup.get(event.code);
  if (actions?.includes('throwShip')) {
    if (event.repeat) return;
    if (!throwCheatEnabled) {
      notify('Throw cheat is disabled. Enable it in Settings or type /throw on in chat.');
      logChatMessage('error', 'Throw cheat is disabled. Type /throw on or enable it in Settings to unlock.');
      return;
    }
    isThrowKeyDown = true;
    throwKeyDownTime = performance.now();
    updateThrowModeUI();
  }
});

window.addEventListener('keyup', event => {
  const actions = keyLookup.get(event.code);
  if (actions?.includes('throwShip') && isThrowKeyDown) {
    isThrowKeyDown = false;
    const duration = performance.now() - throwKeyDownTime;
    if (duration < 350 && !activeFlightSlingshot) {
      toggleThrowMode();
    } else {
      updateThrowModeUI();
    }
  }
});

bindFlightInput({
  keys, pointers, paused: () => session.paused, autoPause, autoResume, visibility: updateBackground,
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
        if (action === 'throwShip') continue;
        if (!isFlightAction(action)) executeAction(action);
      }
    }
  },
});

// Controls & Remapping Modal Management
let listeningChip: { action: ActionId; keyIndex?: number; element: HTMLElement } | null = null;

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

playersToggle.addEventListener('click', () => {
  release(); cancelControllerCursors();
  activeFlightSlingshot = null; updateFlightSlingshotHud();
  renderKeybindingsList();
  selectControlsTab('players');
  controlsDialog.showModal();
});

controlsToggle.addEventListener('click', () => {
  release(); cancelControllerCursors();
  activeFlightSlingshot = null; updateFlightSlingshotHud();
  renderKeybindingsList();
  selectControlsTab('keyboard');
  controlsDialog.showModal();
});

controlsClose.addEventListener('click', () => {
  stopListening();
  controlsDialog.close();
});

controlsDialog.addEventListener('close', () => {
  release(); cancelControllerCursors();
  stopListening();
});

function selectControlsTab(tab: 'keyboard' | 'players' | 'gamepad' | 'touch'): void {
  tabKeyboardBtn.classList.toggle('active', tab === 'keyboard');
  tabKeyboardBtn.setAttribute('aria-selected', String(tab === 'keyboard'));
  tabPlayersBtn.classList.toggle('active', tab === 'players');
  tabPlayersBtn.setAttribute('aria-selected', String(tab === 'players'));
  tabGamepadBtn.classList.toggle('active', tab === 'gamepad');
  tabGamepadBtn.setAttribute('aria-selected', String(tab === 'gamepad'));
  tabTouchBtn.classList.toggle('active', tab === 'touch');
  tabTouchBtn.setAttribute('aria-selected', String(tab === 'touch'));

  tabKeyboard.hidden = tab !== 'keyboard';
  tabPlayers.hidden = tab !== 'players';
  tabGamepad.hidden = tab !== 'gamepad';
  tabTouch.hidden = tab !== 'touch';

  if (tab === 'players' || tab === 'gamepad') controllerMenu.open();
  if (tab === 'touch') touchOverlayMode.value = touchControls.getMode();
}

tabKeyboardBtn.addEventListener('click', () => selectControlsTab('keyboard'));
tabPlayersBtn.addEventListener('click', () => selectControlsTab('players'));
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
window.addEventListener('error', event => profiler.event('error',
  { message: event.message, source: event.filename, line: event.lineno, column: event.colno }));
window.addEventListener('unhandledrejection', event => profiler.event('error', { message: String(event.reason) }));

/** Hidden tabs get no animation frames; a hosting tab (or solo flight with Run in background enabled)
 * keeps the world moving on a timer. Browsers slow a hidden page's own timers to about once
 * a second, and later to once a minute, which stalls hosted players' world (their inputs
 * then miss the host's schedule). A worker's timer is not throttled that way, so it paces
 * the world; a page timer is the fallback where workers cannot start (some file:// pages). */
let background: { stop(): void } | undefined;
let backgroundAt = 0;
function ticker(tick: () => void, ms: number): { stop(): void } {
  let timer: ReturnType<typeof setInterval> | undefined;
  let worker: Worker | undefined;
  const fallback = (): void => {
    worker?.terminate();
    worker = undefined;
    timer ??= setInterval(tick, ms);
  };
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = () => { URL.revokeObjectURL(url); tick(); };
    worker.onerror = () => { URL.revokeObjectURL(url); fallback(); };
  } catch { fallback(); }
  return { stop: () => { worker?.terminate(); if (timer) clearInterval(timer); } };
}
function updateBackground(): void {
  const wanted = document.hidden && (isHosting() || (isSolo() && runInBackgroundToggle.checked && !local.paused));
  if (wanted && !background) {
    backgroundAt = performance.now();
    background = ticker(() => {
      const now = performance.now();
      handleEvents(local.catchUp((now - backgroundAt) / 1000, selectedShipId));
      backgroundAt = now;
    }, 50);
  } else if (!wanted && background) {
    background.stop();
    background = undefined;
    lastWall = undefined;
  }
}

function updatePrediction(seconds: number, engine: boolean): void {
  prediction.update(session.world.context, state, activeBody, session.world.surface(activeBody.id),
    selectedShip()?.id, seconds, engine, selectedShip()?.controls, session.world);
  maneuver.update(seconds, prediction, engine);
  const others = Math.max(0, connectedPilotIds.size - 1);
  const mode = orbitMode.value as OtherOrbitMode;
  otherOrbits.update(session.world, splitScreen.active > 1 ? undefined : session.playerId,
    isConnectedPilot, performance.now(), showOtherOrbits(mode, others));
  show('other-orbit-status', mode === 'off' ? 'Other orbit previews are off.'
    : mode === 'auto' && others > 8 ? 'Hidden in Auto: more than 8 other pilots. Choose Always to show previews.'
    : 'Faint coast previews refresh about once a second. Future burns are unknown.');
}

function activeOrbitSource(): { readonly position: Vec; readonly velocity: Vec } {
  return state.coast?.bodyId === activeBody.id && state.coast.mu === activeBody.mu ? state.coast : state;
}

function groundClearance(): number {
  const surface = session.world.surface(activeBody.id);
  // Terrain turns with the body; a flying state is inertial.
  const local = state.status === 'flying' ? rotate(state.position, -spinAngle(activeBody, state.time)) : state.position;
  const ground = surface ? querySurface(surface, Math.atan2(local.y, local.x)).firstContactRadius : activeBody.radius;
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
    hud: { editing: hudLayout.editing, navballs: Array.from({ length: splitScreen.active }, (_, slot) => {
      const pane = slot > 0 && splitScreen.isSeparated(slot) ? splitScreen.guests.get(slot)?.canvas ?? canvas : canvas;
      const width = pane.clientWidth, height = pane.clientHeight;
      const scale = Math.min(1, Math.max(0.65, Math.min(width / 600, height / 450)));
      return { slot, ...resolveNavballCenter(slot, width, height, scale), scale, width, height };
    }) },
    localPlayers: { count: splitScreen.active, screenMode: splitScreen.config.screenMode,
      guests: [...splitScreen.guests].map(([slot, guest]) => ({ slot, ship: guest.shipId,
        status: guest.state?.status, controls: guest.controls, separated: splitScreen.isSeparated(slot) })),
      cursors: [...controllerCursors].map(([slot, cursor]) => ({ slot, aiming: cursor.isThrowing, visible: cursor.visible,
        screenPosition: cursor.screenPos })) },
    rttMs: remote && Number.isFinite(remote.client.rttMs) ? +remote.client.rttMs.toFixed(1) : null,
    stepSeconds: STEP, tick: world.tick, steps: session === local ? local.clockStats.steps : null,
    droppedSeconds: session === local ? local.clockStats.droppedSeconds : null,
    dynamics: state.dynamics ?? 'numerical', coastEpochSeconds: state.coast?.epochSeconds ?? null,
    solver: state.solver ?? null, orbit: world.context.capabilities.orbitalDiagnostics ? world.context.services.orbits.elements(activeOrbitSource(), activeBody.mu) : null,
    motionCapabilities: world.context.capabilities, modelIdentity: world.context.modelIdentity,
    coastCache: world.context.coastCacheStats(state.coast),
    samples: prediction.path.length, predictionEnd: prediction.pass && prediction.passKey !== prediction.pathKey ? 'tracing' : prediction.pathEnd, predictionPasses: prediction.passCount,
    predictionWorkMs: prediction.lastPass.workMs, predictionCoarse: prediction.lastPass.coarse,
    otherOrbits: { ...otherOrbits.stats, mode: orbitMode.value, otherPilots: Math.max(0, connectedPilotIds.size - 1) },
    maneuver: maneuver.diagnostics(),
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
      presentation.audio.contact(event.contact.time, event.status === 'crashed' ? 'crash'
        : event.contact.material === 'water' ? 'splash' : 'land', !session.paused && session.warp === 1);
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
function otherShips(
  time: number,
  alpha: number,
  camera: Camera,
  skipId: string | undefined = selectedShipId,
  width: number = canvas.clientWidth,
  height: number = canvas.clientHeight,
): RenderShip[] {
  return fleetView.build({
    world: session.world,
    time,
    alpha,
    paused: session.paused,
    skipId,
    playerId: session.playerId,
    camera,
    width,
    height,
    previous: id => session.previous(id),
    displayOffset: id => session.displayOffset(id),
    playerName: id => session.playerName(id),
    display: (s, bodyId) => spinView.state(s, session.world.body(bodyId)),
    interpolate: (from, to, alpha, bodyId) => spinView.interpolate(from, to, alpha, session.world.body(bodyId)),
    isRock: ship => ship.ownerId === STRESS_OWNER && ship.id.startsWith(STRESS_ROCK_PREFIX),
  });
}

/** What the pilot sees, for presentation modules: interpolated, detached and frozen. */
function presentationView(elapsed: number, bodyPosition: Vec): PresentationSnapshot {
  const world = session.world, ship = selectedShip(), last = prediction.path.at(-1);
  const analyticOrbits = world.context.capabilities.orbitalDiagnostics;
  return presentationSnapshot({
    time: view.time, tick: world.tick, paused: session.paused, elapsed,
    viewport: { width: canvas.clientWidth, height: canvas.clientHeight, pixelRatio: window.devicePixelRatio || 1 },
    body: { id: activeBody.id, name: activeBody.name, radius: activeBody.radius, mu: activeBody.mu, position: bodyPosition,
      ...(activeBody.rotation ? { spin: spinRate(activeBody) } : {}) },
    ...(ship ? { ship: { id: ship.id, name: ship.name, bodyId: activeBody.id, state: view, controls: ship.controls,
      position: { x: bodyPosition.x + view.position.x, y: bodyPosition.y + view.position.y }, ...(ship.fault ? { fault: ship.fault } : {}) } } : {}),
    vehicle: world.context.vehicle, analyticOrbits,
    orbit: analyticOrbits && ship && state.status === 'flying' ? world.context.services.orbits.elements(activeOrbitSource(), activeBody.mu) : null,
    groundClearance: ship ? groundClearance() : null,
    prediction: { status: !ship ? 'none' : prediction.pass && prediction.passKey !== prediction.pathKey ? 'tracing' : prediction.pathEnd,
      samples: prediction.path.length, ...(last ? { last } : {}) },
    maneuver: maneuver.snapshot(),
    moduleState: world.moduleState,
  });
}

function frame(now: number): void {
  const elapsed = lastWall === undefined ? 0 : (now - lastWall) / 1000;
  lastWall = now;
  profiler.begin(elapsed * 1000);
  moduleManager?.devices.sample(elapsed, !session.paused && !workspace.isOpen && !document.hidden, !workspace.isOpen && !document.hidden);
  splitScreen.pollPads();
  splitScreen.sync();
  if (session.paused || controlsDialog.open || hudLayout.editing || document.hidden) leverBurns.fill(undefined);
  splitScreen.applyInput(elapsed);
  const command = session.paused ? IDLE : controls(elapsed);
  maneuver.beforeAdvance(command);
  handleEvents(session === local ? local.update(elapsed, selectedShipId, command, maneuver.executing ? () => maneuver.step(command) : undefined)
    : session.update(elapsed, selectedShipId, command));
  syncSelected();
  if (state.status !== lastStatus) {
    // Smooth-body collisions change status without a terrain-contact event.
    // Terrain contacts already play through handleEvents, so only fill that gap.
    if (lastStatus === 'flying' && state.status !== 'flying' && !session.world.surface(activeBody.id)) {
      presentation.audio.contact(state.time, state.status === 'crashed' ? 'crash' : 'land',
        !session.paused && session.warp === 1);
    }
    profiler.event('status', { from: lastStatus, to: state.status, time: state.time,
      speed: +magnitude(state.velocity).toFixed(2) });
    lastStatus = state.status;
  }
  profiler.lap('physics');
  const ship = selectedShip();
  const engine = (session === local ? !!ship?.controls.engine : command.engine && !!ship) && !session.paused;
  presentation.audio.update(engine && ship && state.status !== 'crashed' && !ship.fault && session.warp === 1 ? state.throttle : 0,
    !orbitSandboxInstance?.isOpen());
  updatePrediction(elapsed, engine);
  profiler.lap('prediction');
  const before = selectedShipId ? session.previous(selectedShipId) : undefined;
  spinView.update(session.world.system.getAllBodies(), state.time, elapsed, reducedMotion.matches);
  view = session.paused || !before || before.bodyId !== activeBody.id ? spinView.state(state, activeBody)
    : spinView.interpolate(before.state, state, session.alpha, activeBody);
  if (ship) {
    const offset = session.displayOffset(ship.id);
    if (offset.x || offset.y) view = { ...view, position: { x: view.position.x + offset.x, y: view.position.y + offset.y } };
  }
  for (const guest of splitScreen.guests.values()) {
    guest.refresh(session);
    if (guest.state && guest.body) {
      const gBefore = guest.shipId ? session.previous(guest.shipId) : undefined;
      guest.view = session.paused || !gBefore || gBefore.bodyId !== guest.body.id
        ? spinView.state(guest.state, guest.body)
        : spinView.interpolate(gBefore.state, guest.state, session.alpha, guest.body);
      const gShip = guest.ship(session);
      if (gShip) {
        const offset = session.displayOffset(gShip.id);
        if (offset.x || offset.y) {
          guest.view = { ...guest.view, position: { x: guest.view.position.x + offset.x, y: guest.view.position.y + offset.y } };
        }
      }
    } else {
      guest.view = undefined;
    }
  }
  // Resolved bodies for renderer
  const world = session.world;
  // High quality lights every body from the system's star; starless systems stay unlit.
  const star = graphicsQuality === 'high' ? world.system.getAllBodies().find(b => b.surfaceFeatures === 'star') : undefined;
  const starPos = star && world.system.getBodyPosition(star.id, view.time);
  const renderBodies = world.system.getAllBodies().map(b => {
    const pos = world.system.getBodyPosition(b.id, view.time);
    const toStar = starPos && b !== star ? Math.hypot(starPos.x - pos.x, starPos.y - pos.y) : 0;
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
      ...(b.rotation ? { rotation: spinView.angle(b, view.time) } : {}),
      ...(toStar > 0 ? { sunDirection: { x: (starPos!.x - pos.x) / toStar, y: (starPos!.y - pos.y) / toStar } } : {}),
      ...(graphicsQuality === 'high' ? { appearance: designer.appearanceFor(world, b) } : {}),
    };
  });

  const activeBodyPos = world.system.getBodyPosition(activeBody.id, view.time);
  const shipWorld = ship ? bodyWorldPosition(activeBody.id, view.time, view.position) : { x: 1e30, y: 1e30 };
  const pad = padSites.get(world)!.get(activeBody.id);
  const padAt = pad && spinView.point(activeBody, view.time, pad.position);
  const padWorld = padAt ? { x: activeBodyPos.x + padAt.x, y: activeBodyPos.y + padAt.y } : { x: 1e30, y: 1e30 };

  // Presentation hooks share one frozen snapshot, built only when a module needs it.
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const dynamic = splitScreen.updateDynamic(view, activeBody, cameraControl, width, height, now);
  let snapshot: PresentationSnapshot | undefined;
  const base = (): PresentationSnapshot => snapshot ??= presentationView(elapsed, activeBodyPos);
  const mode = cameraControl.mode;
  const lastFocusTarget = cameraControl.focusTarget;
  const target = mode !== 'follow' && mode !== 'free'
    ? presentation.camera(mode, () => Object.freeze({ ...base(), scale: cameraControl.scale(width, height) })) : undefined;

  let focusPosition: Vec | undefined;
  const focus = cameraControl.smartTarget ?? cameraControl.focusTarget;
  if (focus) {
    if (focus.kind === 'body') {
      const has = world.system.getAllBodies().some(b => b.id === focus.id);
      if (has) {
        focusPosition = world.system.getBodyPosition(focus.id, view.time);
      } else {
        cameraControl.clearFocus();
      }
    } else if (focus.kind === 'ship') {
      const targetShip = world.ship(focus.id);
      if (targetShip) {
        focusPosition = bodyWorldPosition(targetShip.bodyId, view.time, targetShip.state.position);
      } else {
        cameraControl.clearFocus();
      }
    }
  }

  const cameraShipPos = (dynamic.centroid && cameraControl.mode === 'follow' && !cameraControl.dragged && !cameraControl.focusTarget)
    ? dynamic.centroid
    : view.position;
  let camera = cameraControl.update({ body: activeBodyPos, ship: cameraShipPos, elapsed, instant: reducedMotion.matches,
    width, height, ...(target ? { target } : {}), ...(focusPosition ? { focusPosition } : {}) });
  if (dynamic.zoomScale && dynamic.zoomScale < 1 && cameraControl.mode === 'follow' && !cameraControl.dragged && !cameraControl.focusTarget) {
    camera = { ...camera, scale: camera.scale * dynamic.zoomScale };
  }

  const isP1Throwing = isSlotThrowing(0);
  const p1Cursor = controllerCursors.get(0);
  const p1AnchorBody = (p1Cursor?.isThrowing ? p1Cursor.dominantBody : undefined) ??
    (activeFlightSlingshot && (activeFlightSlingshot.slot ?? 0) === 0 ? activeFlightSlingshot.dominantBody : undefined);
  const p1AnchorRelPos = (p1Cursor?.isThrowing ? p1Cursor.relPos : undefined) ??
    (activeFlightSlingshot && (activeFlightSlingshot.slot ?? 0) === 0 ? activeFlightSlingshot.relPos : undefined);

  if (isP1Throwing && p1AnchorBody && p1AnchorRelPos) {
    const curDomPos = session.world.system.getBodyPosition(p1AnchorBody.id, view.time);
    const anchorWorld = { x: curDomPos.x + p1AnchorRelPos.x, y: curDomPos.y + p1AnchorRelPos.y };
    if (!p1ThrowFrozenCamera) {
      p1ThrowFrozenCamera = {
        center: { x: camera.center.x - anchorWorld.x, y: camera.center.y - anchorWorld.y },
        rotation: camera.rotation,
        scale: camera.scale,
      };
    }
    camera = {
      center: { x: anchorWorld.x + p1ThrowFrozenCamera.center.x, y: anchorWorld.y + p1ThrowFrozenCamera.center.y },
      rotation: p1ThrowFrozenCamera.rotation,
      scale: p1ThrowFrozenCamera.scale,
    };
    cameraControl.last = camera;
  } else {
    p1ThrowFrozenCamera = undefined;
  }

  if (mode !== cameraControl.mode || cameraControl.focusTarget !== lastFocusTarget) syncCameraButton();
  updateControllerCursors(elapsed);
  syncThrottleLevers();
  const others = otherShips(view.time, session.alpha, camera, selectedShipId, width, height);
  const baseOverlays = presentation.overlays(() => Object.freeze({ ...base(), camera }));
  let overlays: OverlayPrimitive[] = [...otherOrbits.overlays(world, view.time, session.playerId, camera, width, height), ...(baseOverlays ?? [])];

  if (activeFlightSlingshot && (!activeFlightSlingshot.slot || activeFlightSlingshot.slot === 0 || !splitScreen.isSeparated(activeFlightSlingshot.slot))) {
    const curDomPos = session.world.system.getBodyPosition(activeFlightSlingshot.dominantBody.id, view.time);
    activeFlightSlingshot.dominantWorldPos = curDomPos;
    activeFlightSlingshot.originWorld = {
      x: curDomPos.x + activeFlightSlingshot.relPos.x,
      y: curDomPos.y + activeFlightSlingshot.relPos.y,
    };
    const sList = buildSlingshotOverlay(activeFlightSlingshot, camera.scale, PLAYER_COLORS[activeFlightSlingshot.slot ?? 0]);
    overlays.push(...sList);
  }

  const liveP1Cursor = controllerCursors.get(0);
  if (liveP1Cursor) {
    overlays.push(...buildControllerCursorOverlay(liveP1Cursor, camera.scale));
  }

  if (splitScreen.split) {
    for (const [slot, guest] of splitScreen.guests) {
      if (splitScreen.isSeparated(slot)) continue;
      const guestShip = guest.ship(session);
      if (!guestShip || !guest.body || !guest.state || !guest.view) continue;
      const gR = Math.hypot(guest.view.position.x, guest.view.position.y);
      const gAlt = Math.max(0, gR - guest.body.radius);
      const gFrame = shipAutoFrame(guest.state.status, gAlt, guest.body.radius, guestNavballFrames.get(guestShip.id));
      guestNavballFrames.set(guestShip.id, gFrame);
      const gNavState = shipNavballState(guest.state, { radius: guest.body.radius, spin: guest.body.rotation ? spinRate(guest.body) : 0 }, gFrame);
      if (gNavState && presentation.isEnabled('builtin.navball')) {
        const gTurn = Math.PI / 2 - gNavState.zenith;
        const gScale = Math.min(1, Math.max(0.65, Math.min(width / 600, height / 450)));
        const gPlacement = splitScreen.config.slots[slot]?.navball ?? defaultNavballPlacement(slot);
        const gCenter = resolveNavballCenter(slot, width, height, gScale);
        const gTraj = formatTrajectoryStats(guest.state, guest.body, session.world.context);
        const isDragging = activeNavballDrag?.slot === slot;
        const guestNavPrimitives = drawNavball(
          gNavState,
          gCenter,
          gTurn,
          'horizon',
          PLAYER_COLORS[slot],
          `P${slot + 1}`,
          gScale,
          gTraj,
          gPlacement.pinned,
          isDragging,
          hudLayout.editing,
        );
        overlays.push(...guestNavPrimitives);
      }
      const jCursor = controllerCursors.get(slot);
      if (jCursor) {
        overlays.push(...buildControllerCursorOverlay(jCursor, camera.scale));
      }
    }
  }

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
    padNormal: pad && spinView.point(activeBody, view.time, pad.normal),
    shipLabel: ship?.name.toUpperCase(),
    ships: others,
    showScale: hudVisibility.visible('scale'),
    showShipLabels: hudVisibility.visible('labels'),
    theme: {
      ...themeCustomizer.getSettings(),
      highQuality: graphicsQuality === 'high',
      worldSeed: (themeCustomizer.getSettings().shaderSeed && themeCustomizer.getSettings().shaderSeed !== 0)
        ? themeCustomizer.getSettings().shaderSeed!
        : hashWorldSeed(world.id),
    },
    ...(overlays.length ? { overlays } : {}),
  }, profiler);

  if (splitScreen.split) {
    for (const [slot, guest] of splitScreen.guests) {
      if (!splitScreen.isSeparated(slot)) continue;
      const guestShip = guest.ship(session);
      if (!guestShip || !guest.body || !guest.view || !guest.state) continue;

      const gEngine = guest.controls.engine && !session.paused;
      guest.prediction.update(
        session.world.context,
        guest.state,
        guest.body,
        session.world.surface(guest.body.id),
        guestShip.id,
        elapsed,
        gEngine,
        guestShip.controls,
        session.world,
      );

      const gWidth = guest.canvas.clientWidth;
      const gHeight = guest.canvas.clientHeight;
      if (gWidth === 0 || gHeight === 0) continue;

      const gBodyPos = world.system.getBodyPosition(guest.body.id, guest.view.time);
      let gCamera = guest.camera.update({
        body: gBodyPos,
        ship: guest.view.position,
        elapsed,
        instant: reducedMotion.matches,
        width: gWidth,
        height: gHeight,
      });

      const isGuestThrowing = isSlotThrowing(slot);
      const gCursor = controllerCursors.get(slot);
      const gAnchorBody = (gCursor?.isThrowing ? gCursor.dominantBody : undefined) ??
        (activeFlightSlingshot && activeFlightSlingshot.slot === slot ? activeFlightSlingshot.dominantBody : undefined);
      const gAnchorRelPos = (gCursor?.isThrowing ? gCursor.relPos : undefined) ??
        (activeFlightSlingshot && activeFlightSlingshot.slot === slot ? activeFlightSlingshot.relPos : undefined);

      if (isGuestThrowing && gAnchorBody && gAnchorRelPos) {
        const curDomPos = session.world.system.getBodyPosition(gAnchorBody.id, guest.view.time);
        const anchorWorld = { x: curDomPos.x + gAnchorRelPos.x, y: curDomPos.y + gAnchorRelPos.y };
        let frozen = guestThrowFrozenCameras.get(slot);
        if (!frozen) {
          frozen = {
            center: { x: gCamera.center.x - anchorWorld.x, y: gCamera.center.y - anchorWorld.y },
            rotation: gCamera.rotation,
            scale: gCamera.scale,
          };
          guestThrowFrozenCameras.set(slot, frozen);
        }
        gCamera = {
          center: { x: anchorWorld.x + frozen.center.x, y: anchorWorld.y + frozen.center.y },
          rotation: frozen.rotation,
          scale: frozen.scale,
        };
        guest.camera.last = gCamera;
      } else {
        guestThrowFrozenCameras.delete(slot);
      }

      const gRenderer = splitScreen.rendererFor(guest, presentation.provider, presentation.rendering.shaders);
      if (!gRenderer) continue;

      const gShipWorld = bodyWorldPosition(guest.body.id, guest.view.time, guest.view.position);
      const gPad = padSites.get(world)?.get(guest.body.id);
      const gPadAt = gPad && spinView.point(guest.body, guest.view.time, gPad.position);
      const gPadWorld = gPadAt ? { x: gBodyPos.x + gPadAt.x, y: gBodyPos.y + gPadAt.y } : { x: 1e30, y: 1e30 };

      const gOthers = otherShips(guest.view.time, session.alpha, gCamera, guest.shipId, gWidth, gHeight);

      const gOverlays: OverlayPrimitive[] = [...otherOrbits.overlays(world, guest.view.time, guest.playerId ?? session.playerId, gCamera, gWidth, gHeight)];
      const gR = Math.hypot(guest.view.position.x, guest.view.position.y);
      const gAlt = Math.max(0, gR - guest.body.radius);
      const gFrame = shipAutoFrame(guest.state.status, gAlt, guest.body.radius, guestNavballFrames.get(guestShip.id));
      guestNavballFrames.set(guestShip.id, gFrame);
      const gNavState = shipNavballState(guest.state, { radius: guest.body.radius, spin: guest.body.rotation ? spinRate(guest.body) : 0 }, gFrame);
      if (gNavState && presentation.isEnabled('builtin.navball')) {
        const gTurn = Math.PI / 2 - gNavState.zenith;
        const gScale = Math.min(1, Math.max(0.65, Math.min(gWidth / 600, gHeight / 450)));
        const gPlacement = splitScreen.config.slots[slot]?.navball ?? defaultNavballPlacement(slot);
        const gCenter = resolveNavballCenter(slot, gWidth, gHeight, gScale);
        const gTraj = formatTrajectoryStats(guest.state, guest.body, session.world.context);
        const isDragging = activeNavballDrag?.slot === slot;
        gOverlays.push(...drawNavball(
          gNavState,
          gCenter,
          gTurn,
          'horizon',
          PLAYER_COLORS[slot],
          `P${slot + 1}`,
          gScale,
          gTraj,
          gPlacement.pinned,
          isDragging,
          hudLayout.editing,
        ));
      }
      if (activeFlightSlingshot && activeFlightSlingshot.slot === slot) {
        const curDomPos = session.world.system.getBodyPosition(activeFlightSlingshot.dominantBody.id, guest.view.time);
        activeFlightSlingshot.dominantWorldPos = curDomPos;
        activeFlightSlingshot.originWorld = {
          x: curDomPos.x + activeFlightSlingshot.relPos.x,
          y: curDomPos.y + activeFlightSlingshot.relPos.y,
        };
        gOverlays.push(...buildSlingshotOverlay(activeFlightSlingshot, gCamera.scale, PLAYER_COLORS[slot]));
      }
      const jCursor = controllerCursors.get(slot);
      if (jCursor) {
        gOverlays.push(...buildControllerCursorOverlay(jCursor, gCamera.scale));
      }

      gRenderer.draw({
        state: guest.view,
        path: guest.prediction.path,
        pathClosed: guest.prediction.pathEnd === 'closed' && (!guest.prediction.pass || guest.prediction.pathKey === guest.prediction.passKey),
        engine: gEngine,
        camera: gCamera,
        bodies: renderBodies,
        shipWorldPosition: gShipWorld,
        pathOrigin: gBodyPos,
        padPosition: gPadWorld,
        padNormal: gPad && spinView.point(guest.body, guest.view.time, gPad.normal),
        shipLabel: guestShip.name.toUpperCase(),
        ships: gOthers,
        showScale: hudVisibility.visible('scale'),
        showShipLabels: hudVisibility.visible('labels'),
        theme: {
          ...themeCustomizer.getSettings(),
          highQuality: graphicsQuality === 'high',
          worldSeed: (themeCustomizer.getSettings().shaderSeed && themeCustomizer.getSettings().shaderSeed !== 0)
            ? themeCustomizer.getSettings().shaderSeed!
            : hashWorldSeed(world.id),
        },
        ...(gOverlays.length ? { overlays: gOverlays } : {}),
      });
    }
  }

  // Staggered DOM work: HUD at 12.5 Hz, diagnostics, lists and profiler panel at 4 Hz.
  if (now - lastHud > 80) {
    hud(engine);
    if (splitScreen.split) {
      splitScreen.updateTags(
        {
          name: pilotName(),
          status: (godModeToggle.checked ? '[INVULNERABLE] ' : '') + (session.paused ? 'PAUSED' : !selectedShip() ? 'NO SHIP' : state.status.toUpperCase()),
          text: selectedShip() ? formatTrajectoryStats(state, activeBody, session.world.context) : '',
        },
        guest => {
          const s = guest.state;
          const b = guest.body;
          if (!s || !b) return { status: 'NO SHIP', text: '' };
          return {
            status: (godModeToggle.checked ? '[INVULNERABLE] ' : '') + s.status.toUpperCase(),
            text: formatTrajectoryStats(s, b, session.world.context),
          };
        },
      );
    }
    syncSplitModeButton();
    lastHud = now;
  }
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
  pilots: new LocalPilotRegistry({ config: () => splitScreen.config, count: () => splitScreen.active,
    playerId: pilot => pilot === 0 ? session.playerId : splitScreen.guests.get(pilot)?.playerId,
    change: config => { splitScreen.setConfig(config); splitScreen.sync(); },
    release: pilot => {
      if (pilot === undefined || pilot === 0) { release(); return; }
      moduleManager?.devices.release(pilot);
      leverBurns[pilot] = undefined;
      const guest = splitScreen.guests.get(pilot);
      if (guest) {
        guest.controls = IDLE;
        if (session === local && guest.playerId && guest.shipId) local.guestControls(guest.playerId, guest.shipId, IDLE);
      }
    },
  }),
  world: () => session.world,
  current: () => ({ profile: worldModules(local.world)?.profile ?? DEFAULT_PROFILE,
    data: worldModules(local.world)?.data ?? [], editable: session === local && !local.hosting,
    universe: worldModules(local.world)?.baseUniverse ?? local.world.universe, universeKey: worldModules(local.world)?.universeKey ?? `builtin.content/${local.world.universe.id}`,
    resolvedUniverse: local.world.universe,
    systemId: local.world.systemId }),
  apply: async (profile, data, selection, runtime) => {
    const current = worldModules(local.world);
    if (runtime) {
      await moduleManager!.devices.loadWorldGame(runtime, { profile, data,
        code: [...GAME_EXAMPLES, ...moduleLibrary.modules(environment()).filter(m => m.manifest.authority === 'authoritative')],
        universe: current?.baseUniverse ?? local.world.universe, universeKey: selection.universe, systemId: selection.system }, prepared => {
          checkCommandKeys(prepared.loaded.world.commands);
          const next = new LocalSession(prepared.loaded.world, { name: pilotName() });
          prepared.candidate.own({ dispose: () => next.host.dispose() });
          rememberWorldModules(prepared.loaded.world, { data, profile, baseUniverse: current?.baseUniverse ?? local.world.universe,
            universeKey: selection.universe, createContext: prepared.createContext, runtime });
          local.dispose(); local = next; useSession(local, true); reset(); focusOnShipForNewWorld();
      });
      return;
    }
    const prepared = prepareLocalWorld(current?.baseUniverse ?? local.world.universe, selection.system,
      { data, profile, universeKey: selection.universe });
    replaceLocalWorld(prepared.world);
    prepared.runtime.activate(prepared.candidate);
    reset();
    focusOnShipForNewWorld();
  },
});
function switchToOrbitSandbox(): void {
  if (orbitSandboxInstance?.isOpen()) return;
  moduleManager?.devices.clear();
  setPaused(true, 'Playing Orbit Sandbox');
  const flightConsole = document.getElementById('flight-console');
  const sandboxWorkspace = document.getElementById('orbit-sandbox-workspace');
  if (flightConsole) flightConsole.hidden = true;
  if (sandboxWorkspace) sandboxWorkspace.hidden = false;

  if (!orbitSandboxInstance) {
    orbitSandboxInstance = initOrbitSandbox({
      onOpenMenu: () => {
        workspace.open('library');
      },
      onLaunchInSpaceSim: (universe) => {
        switchToSpaceSim();
        importUniverse(universe);
        show('universe-status', `Loaded ${universe.name} from Orbit Sandbox. Ready to fly.`);
        workspace.close(true, false);
      },
    });
  }
  orbitSandboxInstance.start();
  activeGameInfo = { ...orbitSandboxGame.info };
  show('active-game', orbitSandboxGame.info.name);
  document.title = `Spacelab · ${orbitSandboxGame.info.name}`;
  workspace.close(false, false);
}

function switchToSpaceSim(): void {
  if (orbitSandboxInstance?.isOpen()) {
    orbitSandboxInstance.stop();
  }
  const sandboxWorkspace = document.getElementById('orbit-sandbox-workspace');
  const flightConsole = document.getElementById('flight-console');
  if (sandboxWorkspace) sandboxWorkspace.hidden = true;
  if (flightConsole) flightConsole.hidden = false;
  activeGameInfo = { ...defaultGame.info };
  show('active-game', defaultGame.info.name);
  document.title = `Spacelab · ${defaultGame.info.name}`;
}

labManager = new LabManager({
  builtin: defaultGame,
  builtins: [defaultGame, orbitSandboxGame],
  install: plugin => moduleManager!.install(plugin), legacy: loadModuleText,
  installDevicePackage: (bytes, source) => moduleManager!.installDevicePackage(bytes, source),
  universe: universe => { importUniverse(universe); show('universe-status', `Loaded ${universe.name}. Export a compressed universe or save its setup as a game.`); },
  editable: () => session === local && !local.hosting,
  world: () => session.world,
  capture: async () => {
    const bundle = currentModuleBundle();
    const world = local.world, runtime = await moduleManager!.devices.capture();
    if (local.world !== world || session !== local || local.hosting) throw new Error('The active session changed while exporting');
    return { format: 'space-lab-game/1', info: { ...activeGameInfo, id: `local.game-${crypto.randomUUID()}` }, bundle,
      plugins: moduleLibrary.artifacts.filter(a => bundle.code?.some(ref => ref.id === a.manifest.id)), ...(runtime ? { runtime } : {}) };
  },
  play: async game => {
    if (session !== local || local.hosting) throw new Error('Leave multiplayer before switching games');
    if (game.info.id === 'builtin.orbit-sandbox') {
      switchToOrbitSandbox();
      return;
    }
    const previousWorld = local.world;
    const code = artifactModules(game.plugins, environment());
    const authoritative = [...GAME_EXAMPLES, ...code.filter(m => m.manifest.authority === 'authoritative')];
    const display = code.filter(m => m.manifest.authority === 'presentation');
    const displayProfile = presentation.compatibleGameProfile(game.bundle.presentation ?? presentationProfile(presentation.provider.id));
    // Resolve both profiles before any initializer or source evaluation.
    createBuiltinRegistry(game.bundle.modules, authoritative).resolve(game.bundle.profile, environment(), ['motion', 'content']);
    createPresentationRegistry([...PRESENTATION_EXAMPLES, ...display]).resolve(displayProfile, environment(), ['renderer']);
    if (game.runtime) {
      await moduleManager!.devices.loadWorldGame(game.runtime, { profile: game.bundle.profile, data: game.bundle.modules, code: authoritative,
        install: () => installGamePackages(game, moduleLibrary.store, { environment: environment(), allowRuntimeCode: ALLOW_RUNTIME_CODE }, 'Game library'),
        universe: DEFAULT_UNIVERSE, universeKey: game.bundle.selection.universe, systemId: game.bundle.selection.system }, prepared => {
        const next = new LocalSession(prepared.loaded.world, { name: pilotName() });
        prepared.candidate.own({ dispose: () => next.host.dispose() });
        checkCommandKeys(prepared.loaded.world.commands);
        presentation.applyGame(display, displayProfile);
        rememberWorldModules(prepared.loaded.world, { data: game.bundle.modules, profile: game.bundle.profile,
          baseUniverse: DEFAULT_UNIVERSE, universeKey: game.bundle.selection.universe, createContext: prepared.createContext, runtime: game.runtime });
        switchToSpaceSim(); moduleLibrary.replace(game.plugins); moduleManager!.resetData(game.bundle.modules);
        for (const data of game.bundle.modules) moduleLibrary.installData(data);
        local.dispose(); local = next; activeGameInfo = { ...game.info };
        useSession(local, true); reset(); focusOnShipForNewWorld();
      });
      return;
    }
    await installGamePackages(game, moduleLibrary.store, { environment: environment(), allowRuntimeCode: ALLOW_RUNTIME_CODE }, 'Game library');
    if (local.world !== previousWorld || session !== local || local.hosting) throw new Error('The active session changed while installing game packages');
    const prepared = prepareLocalWorld(DEFAULT_UNIVERSE, game.bundle.selection.system,
      { data: game.bundle.modules, profile: game.bundle.profile, universeKey: game.bundle.selection.universe, code: authoritative });
    let next: LocalSession;
    try {
      next = new LocalSession(prepared.world, { name: pilotName() });
      moduleManager!.devices.loadLegacyGame(() => {
        if (local.world !== previousWorld || session !== local || local.hosting) throw new Error('The active session changed while loading');
        presentation.applyGame(display, displayProfile);
        prepared.runtime.activate(prepared.candidate);
        switchToSpaceSim();
        moduleLibrary.replace(game.plugins);
        moduleManager!.resetData(game.bundle.modules);
        for (const data of game.bundle.modules) moduleLibrary.installData(data);
        local.dispose();
        local = next;
        activeGameInfo = { ...game.info };
        useSession(local, true);
        reset();
        focusOnShipForNewWorld();
      });
    } catch (error) { prepared.candidate.dispose(); throw error; }
  },
});
void labManager.start();
element('presentation-list').addEventListener('change', () => moduleManager?.refresh());
useSession(local);
const requestedGame = new URLSearchParams(location.search).get('game');
if (requestedGame === 'orbit-sandbox') {
  switchToOrbitSandbox();
}
if (document.querySelector('meta[name="space-sim-server"]')) {
  // This page came from a dedicated server: joining it is one click away.
  joinInput.value = serverAddressForPage(location.href);
  serverShareAddress = joinInput.value;
  setMpMode('server', false);
  mpStatus('This page comes from a Space Sim server. Enter your pilot name and choose Join.');
}
function connectFromLink(): void {
  const requestedConnection = connectionRequest(location.hash);
  if (!requestedConnection.invite && !requestedConnection.join) return;
  // Consume once. Reloading must not silently claim another seat or reuse an expired offer.
  history.replaceState(null, '', location.pathname + location.search);
  workspace.open('multiplayer');
  if (requestedConnection.invite) {
    setMpMode('invite', false);
    element<HTMLTextAreaElement>('invite-input').value = requestedConnection.invite;
    void answerInviteCode(requestedConnection.invite);
  } else if (document.querySelector('meta[name="space-sim-server"]')) void join();
}
window.addEventListener('hashchange', connectFromLink);
connectFromLink();
updateMultiplayer();
profiler.event('session', { model: MODEL, userAgent: navigator.userAgent });
requestAnimationFrame(frame);
