import { CANVAS_DRAWING, KEYBOARD_INPUT, LOCAL_VIEWS, PLAYER_CONTROLLERS, VIEW_CAMERAS,
  type Disposable, type LocalViews, type PlayerController, type RenderBody } from '../../../packages/game-api/src/index';
import type { GamePackage } from '../../../packages/game-library/src/archive';
import { createBuiltinRegistry } from '../../../packages/modules/src/index';
import { loadSystem } from '../../../packages/sim-core/src/universe';
import { SurveySessionHost, restoreSurvey, surveySnapshot } from '../../../examples/bounded-survey/session';
import { SURVEY_ACTIONS } from '../../../examples/bounded-survey/world';
import { prepareBrowserTarget } from './target-modules';
import { environment } from './startup';
import { bundledGames } from './bundled-games';

const COLORS = ['#59e0b2', '#66b9ff', '#ffce73', '#ed91d6'];
/** Explicit adapters for the approved non-flight proofs. No flight world, pilot,
 * flight protocol, numerical motion context, audio or editor is constructed here. */
export function startNonFlight(game: GamePackage): Disposable {
  const target = prepareBrowserTarget(game.info.id, environment()), lifetime = new AbortController();
  let closed = false, frameId = 0;
  const owned: Disposable[] = [];
  const root = document.querySelector('main')!;
  root.replaceChildren(); root.style.cssText = 'height:100vh;display:flex;flex-direction:column;padding:1rem;gap:.75rem;overflow:auto';
  const heading = document.createElement('h1'); heading.textContent = game.info.name;
  const description = document.createElement('p'); description.textContent = game.info.description ?? '';
  const navigation = document.createElement('nav'), selection = document.createElement('select');
  selection.id = 'starter-game'; selection.setAttribute('aria-label', 'Game');
  for (const entry of bundledGames) { const option = new Option(entry.info.name, entry.info.id); selection.add(option); }
  selection.value = game.info.id;
  const play = document.createElement('button'); play.textContent = 'Play selected game';
  play.addEventListener('click', () => { const url = new URL(location.href); url.search = ''; url.searchParams.set('game', selection.value); location.assign(url.href); }, { signal: lifetime.signal });
  navigation.append(selection, play);
  const controls = document.createElement('div'); controls.className = 'fixture-controls';
  controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:.5rem;align-items:center';
  const status = document.createElement('p'); status.id = 'fixture-status'; status.setAttribute('role', 'status');
  const stage = document.createElement('section'); stage.id = 'starter-views'; stage.tabIndex = 0; stage.setAttribute('aria-label', 'Independent views');
  stage.style.cssText = 'position:relative;width:100%;height:65vh;min-height:250px;flex:1;background:#050b12';
  stage.addEventListener('pointerdown', () => stage.focus(), { signal: lifetime.signal });
  const debug = document.createElement('pre'); debug.id = 'fixture-debug'; debug.hidden = true;
  root.append(heading, description, navigation, controls, status, stage, debug);
  document.title = `Spacelab · ${game.info.name}`;
  const drawing = target.providedService(CANVAS_DRAWING);
  const button = (label: string, id: string, run: () => void) => {
    const element = document.createElement('button'); element.textContent = label; element.id = id;
    element.addEventListener('click', () => { try { run(); } catch (error) { status.textContent = String(error instanceof Error ? error.message : error); } }, { signal: lifetime.signal });
    controls.append(element); return element;
  };
  const choose = (label: string, id: string, values: readonly [string, string][], change: (value: string) => void) => {
    const wrapper = document.createElement('label'), element = document.createElement('select'); wrapper.textContent = `${label} `; element.id = id;
    for (const [value, text] of values) element.add(new Option(text, value));
    element.addEventListener('change', () => change(element.value), { signal: lifetime.signal }); wrapper.append(element); controls.append(wrapper); return element;
  };
  const diagnostics = (state: Record<string, unknown>) => {
    debug.textContent = JSON.stringify({ game: game.info.id, modules: target.lock.modules, providers: target.lock.providers, ...state });
  };
  let draw: (elapsed: number) => void;
  try {
    if (game.info.id === 'builtin.planet-viewer') {
      const content = createBuiltinRegistry(game.bundle.modules).prepare(game.bundle.profile, environment(), ['content']); owned.push(content);
      const universe = content.service<ReadonlyMap<string, import('../../../packages/game-api/src/index').UniverseDefinition>>('content').get(game.bundle.selection.universe);
      if (!universe) throw new Error('Select a compatible body-content provider');
      const system = loadSystem(universe, game.bundle.selection.system), epoch = 0;
      const star = system.getBodyPosition(system.rootBody.id, epoch);
      const bodies: RenderBody[] = system.getAllBodies().map(body => {
        const position = system.getBodyPosition(body.id, epoch), dx = star.x - position.x, dy = star.y - position.y, distance = Math.hypot(dx, dy);
        return { id: body.id, name: body.name, radius: body.radius, position, color: body.color, accentColor: body.accentColor,
          atmosphereColor: body.atmosphereColor, skyColor: body.skyColor, horizonColor: body.horizonColor, surfaceFeatures: body.surfaceFeatures,
          ...(distance ? { sunDirection: { x: dx / distance, y: dy / distance } } : {}) };
      });
      const canvas = document.createElement('canvas'); canvas.id = 'planet-view'; canvas.setAttribute('aria-label', 'Static celestial body view');
      canvas.style.cssText = 'width:100%;height:100%;display:block'; stage.append(canvas);
      const renderer = drawing.create(canvas), camera = target.providedService(VIEW_CAMERAS).create('planet-view'); owned.push(renderer, camera);
      const focus = choose('Body', 'viewer-body', bodies.map(body => [body.id, body.name]), value => { camera.focus(value); fit(); });
      focus.value = bodies.some(body => body.id === 'planet') ? 'planet' : bodies[0]!.id; camera.focus(focus.value);
      const transform = (id: string) => { const body = bodies.find(body => body.id === id); return body ? { position: body.position, orientation: 0 } : undefined; };
      const frame = () => camera.frame({ width: stage.clientWidth, height: stage.clientHeight, elapsed: .016, transform });
      function updateViewer() { diagnostics({ kind: 'static-viewer', epoch, body: focus.value, camera: frame() }); }
      function fit() { const body = bodies.find(body => body.id === focus.value)!; const current = frame(); camera.changeZoom(Math.min(stage.clientWidth, stage.clientHeight) / (body.radius * 2.6) / current.scale); updateViewer(); }
      button('Zoom in', 'viewer-zoom-in', () => { camera.changeZoom(1.5); updateViewer(); }); button('Zoom out', 'viewer-zoom-out', () => { camera.changeZoom(1 / 1.5); updateViewer(); });
      button('Fit body', 'viewer-fit', fit); fit();
      status.textContent = 'Static epoch. Select a body or zoom; no simulation is running.';
      draw = () => { renderer.drawScene({ camera: frame(), bodies, time: epoch, showScale: true }); };
    } else {
      const host = new SurveySessionHost(); owned.push(host);
      const world = host.world, factory = target.providedService(PLAYER_CONTROLLERS), viewsFactory = target.providedService(LOCAL_VIEWS);
      const overlays = Array.from(world.positions, (x, index) => ({ kind: 'circle' as const, space: 'world' as const,
        center: { x, y: index }, radius: .25, color: COLORS[index]!, fill: true }));
      // One fixture unit must remain visible in the smallest four-seat pane.
      const zooms = new Float64Array([32, 32, 32, 32]);
      const targets = [0, 1, 2, 3], players = targets.map(index => world.binding(index).playerId);
      let count = 1, pilot = 0, mode: 'split' | 'dynamic' = 'split', views: LocalViews | undefined, controllers: PlayerController[] = [];
      const keyboard = target.providedService(KEYBOARD_INPUT).create({ actions: SURVEY_ACTIONS, pilot: () => pilot,
        bindings: { 'fixture.survey/move': ['ArrowRight', 'KeyD'], 'fixture.survey/record': ['Space'] } }); owned.push(keyboard);
      const snapshotKey = `spacelab:${game.info.id}:state/1`;
      let viewWidth = 0, viewHeight = 0;
      const update = () => {
        for (let index = 0; index < overlays.length; index++) overlays[index]!.center.x = world.positions[index]!;
        status.textContent = `Shared tick ${world.tick}. ${Array.from(world.positions, (x, index) => `Marker ${index + 1}: ${x.toFixed(1)}, ${world.observations[index]} observations`).join(' · ')}`;
        diagnostics({ kind: 'bounded-survey', state: surveySnapshot(world), count, mode, pilot, targets: targets.slice(0, count),
          views: Array.from({ length: count }, (_, index) => ({ id: `map-${index + 20}`, target: views?.camera(`map-${index + 20}`).targetId })) });
      };
      const reflow = () => { views?.reflow(stage.clientWidth, stage.clientHeight); viewWidth = stage.clientWidth; viewHeight = stage.clientHeight; };
      const rebuild = () => {
        for (const controller of controllers) controller.dispose(); controllers = [];
        views?.dispose(); views = undefined; stage.replaceChildren();
        const bindings = Array.from({ length: count }, (_, index) => {
          const targetIndex = targets[index]!, binding = { ...world.binding(targetIndex), playerId: players[index]!, seatId: `seat-${index + 10}`, viewportId: `map-${index + 20}` };
          const controller = factory.create(world.controls, { pilot: index, sources: [keyboard] }); controller.select(binding); controllers.push(controller);
          return { seatId: binding.seatId, viewportId: binding.viewportId, targetId: binding.entityId };
        });
        views = viewsFactory.create({ bindings, mode, layout: 'auto', surface(binding) {
          const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', `Survey ${binding.seatId}`);
          canvas.style.cssText = 'position:absolute;outline:1px solid #263844;outline-offset:-1px'; stage.append(canvas); const renderer = drawing.create(canvas);
          return { resize(rect, _width, _height, visible) { canvas.hidden = !visible; canvas.style.left = `${rect.x * 100}%`; canvas.style.top = `${rect.y * 100}%`; canvas.style.width = `${rect.w * 100}%`; canvas.style.height = `${rect.h * 100}%`; },
            draw(camera) { const scale = String(camera.scale); if (canvas.dataset.scale !== scale) canvas.dataset.scale = scale; renderer.drawScene({ camera, time: world.tick, showScale: false, overlays }); },
            dispose() { renderer.dispose(); canvas.remove(); } };
        } });
        for (let index = 0; index < count; index++) views.camera(`map-${index + 20}`).changeZoom(zooms[index]!);
        reflow(); update();
      };
      const step = () => { host.step(); update(); };
      choose('Seats', 'survey-seats', [1, 2, 3, 4].map(number => [String(number), String(number)]), value => { count = Number(value); pilot = Math.min(pilot, count - 1); pilotChoice.value = String(pilot); rebuild(); });
      const pilotChoice = choose('Keyboard seat', 'survey-pilot', [0, 1, 2, 3].map(number => [String(number), String(number + 1)]), value => { if (Number(value) >= count) { pilotChoice.value = String(pilot); return; } for (const controller of controllers) controller.release(); pilot = Number(value); update(); });
      choose('Views', 'survey-mode', [['split', 'Split'], ['dynamic', 'Shared']], value => { mode = value as 'split' | 'dynamic'; rebuild(); });
      const instructions = document.createElement('p'); instructions.textContent = 'Click a view, hold Right/D to move or press Space to record, then advance one shared tick. Positions and observations are bounded fixture state.'; controls.append(instructions);
      button('Advance one tick', 'survey-step', () => { for (const controller of controllers) controller.sample({ elapsed: .01, flightAllowed: false, shortcutsAllowed: true }); step(); });
      for (const [label, value] of [['Move left', -1], ['Move right', 1]] as const) button(label, `survey-${value < 0 ? 'left' : 'right'}`, () => { const controller = controllers[pilot]!; controller.set('fixture.survey/move', value); step(); controller.release(); });
      button('Record observation', 'survey-record', () => { const controller = controllers[pilot]!; controller.set('fixture.survey/record', 1); step(); controller.release(); });
      button('Swap first two targets', 'survey-rebind', () => {
        if (count < 2) { status.textContent = 'Choose at least two seats to rebind targets.'; return; }
        for (const controller of controllers) controller.release();
        [targets[0], targets[1]] = [targets[1]!, targets[0]!];
        for (let index = 0; index < 2; index++) world.transfer(targets[index]!, players[index]!);
        rebuild();
      });
      button('Zoom this view', 'survey-zoom', () => { zooms[pilot] = zooms[pilot]! * 1.5; views!.camera(`map-${pilot + 20}`).changeZoom(1.5); update(); });
      button('Save survey state', 'survey-save', () => { localStorage.setItem(snapshotKey, JSON.stringify(surveySnapshot(world))); status.textContent = 'Survey state saved on this device.'; });
      button('Load survey state', 'survey-load', () => { const raw = localStorage.getItem(snapshotKey); if (!raw) throw new Error('No saved survey state');
        // Decode/validate before releasing controls or publishing the candidate state.
        const candidate = JSON.parse(raw); restoreSurvey(world, candidate);
        for (let index = 0; index < 4; index++) players[index] = world.binding(targets[index]!).playerId;
        rebuild(); status.textContent = 'Survey state loaded; held input was released.'; });
      rebuild();
      owned.push({ dispose() { for (const controller of controllers) controller.dispose(); views?.dispose(); } });
      draw = elapsed => { if (stage.clientWidth !== viewWidth || stage.clientHeight !== viewHeight) reflow(); views!.render(elapsed, world.transform); };
    }
  } catch (error) { close(); throw error; }
  let previous = performance.now();
  const frame = (now: number) => { if (closed) return; const elapsed = Math.min(.1, Math.max(0, (now - previous) / 1000)); previous = now; if (!document.hidden) draw(elapsed); frameId = requestAnimationFrame(frame); };
  frameId = requestAnimationFrame(frame);
  function close() {
    if (closed) return; closed = true; lifetime.abort(); cancelAnimationFrame(frameId);
    for (let index = owned.length - 1; index >= 0; index--) owned[index]!.dispose(); target.dispose();
  }
  window.addEventListener('pagehide', event => { if (!event.persisted) close(); }, { signal: lifetime.signal });
  return { dispose: close };
}
