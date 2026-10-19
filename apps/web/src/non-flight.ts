import { CANVAS_DRAWING, WEBGL_DRAWING, KEYBOARD_INPUT, LOCAL_VIEWS, PLAYER_CONTROLLERS, VIEW_CAMERAS, PLAYER_VIEWS,
  type Disposable, type LocalViews, type PlayerController, type PlayerView, type RenderBody, type SceneRenderer } from '../../../packages/game-api/src/index';
import type { GamePackage } from '../../../packages/game-library/src/archive';
import { createBuiltinRegistry } from '../../../packages/modules/src/index';
import { loadSystem } from '../../../packages/sim-core/src/universe';
import { generateSurface } from '../../../packages/sim-core/src/surface';
import { DEFAULT_SHADERS } from '../../../packages/render-2d/src/shaders';
import { loadGraphicsQuality } from './graphics';
import { bindViewShortcuts, bindViewerControls } from './viewer-controls';
import { SurveySessionHost, restoreSurvey, surveySnapshot } from '../../../examples/bounded-survey/session';
import { SURVEY_ACTIONS } from '../../../examples/bounded-survey/world';
import { prepareBrowserTarget } from './target-modules';
import { environment } from './startup';
import { bundledGames, bundledGameCategory } from './bundled-games';
import './non-flight.css';

const COLORS = ['#59e0b2', '#66b9ff', '#ffce73', '#ed91d6'];
/** Explicit adapters for the approved non-flight proofs. No flight world, pilot,
 * flight protocol, numerical motion context, audio or editor is constructed here. */
export function startNonFlight(game: GamePackage): Disposable {
  const target = prepareBrowserTarget(game.info.id, environment()), lifetime = new AbortController();
  let closed = false, frameId = 0;
  const owned: Disposable[] = [];
  const root = document.querySelector('main')!;
  root.replaceChildren(); root.className = 'starter-page'; root.removeAttribute('style');
  const heading = document.createElement('h1'); heading.textContent = game.info.name;
  const description = document.createElement('p'); description.textContent = game.info.description ?? '';
  const navigation = document.createElement('nav'), selection = document.createElement('select');
  const headingArea = document.createElement('div'), sidebar = document.createElement('aside');
  headingArea.className = 'starter-heading'; navigation.className = 'starter-navigation'; sidebar.className = 'starter-tools';
  selection.id = 'starter-game'; selection.setAttribute('aria-label', 'Game');
  for (const [category, label] of [['game', 'Games'], ['example', 'Examples & tests']] as const) {
    const group = document.createElement('optgroup'); group.label = label;
    for (const entry of bundledGames) if (bundledGameCategory(entry.info.id) === category) group.append(new Option(entry.info.name, entry.info.id));
    selection.append(group);
  }
  selection.value = game.info.id;
  const play = document.createElement('button'); play.textContent = 'Play selected game';
  play.addEventListener('click', () => { const url = new URL(location.href); url.search = ''; url.searchParams.set('game', selection.value); location.assign(url.href); }, { signal: lifetime.signal });
  navigation.append(selection, play);
  const controls = document.createElement('div'); controls.className = 'fixture-controls';
  const status = document.createElement('p'); status.id = 'fixture-status'; status.setAttribute('role', 'status');
  const stage = document.createElement('section'); stage.id = 'starter-views'; stage.tabIndex = 0; stage.setAttribute('aria-label', 'Independent views');
  stage.addEventListener('pointerdown', () => stage.focus(), { signal: lifetime.signal });
  const debug = document.createElement('pre'); debug.id = 'fixture-debug'; debug.hidden = true;
  const help = document.createElement('details'), helpTitle = document.createElement('summary'), steps = document.createElement('ol');
  help.id = 'starter-help'; help.open = true; helpTitle.textContent = 'What to try';
  const suggestions = game.info.id === 'builtin.planet-viewer' ? [
    'Choose a body, then zoom in to inspect it. Time is paused.',
    'Drag to pan; pinch or scroll to zoom. Keyboard: arrows, +/−, R to fit.',
  ] : [
    'Choose up to four seats. Keyboard seat selects the view you control.',
    'Move left or right. Each camera follows its marker.',
    'Record observation adds one to the selected marker’s counter.',
    'Try zooming, swapping targets, or saving and loading state.',
  ];
  for (const text of suggestions) { const item = document.createElement('li'); item.textContent = text; steps.append(item); }
  help.append(helpTitle, steps); headingArea.append(heading, description, navigation); sidebar.append(help, controls);
  root.append(headingArea, sidebar, status, stage, debug);
  document.title = `Spacelab · ${game.info.name}`;
  const drawing = target.providedService(CANVAS_DRAWING);
  let controlTarget: HTMLElement = controls;
  const group = (title: string) => {
    const fieldset = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = title;
    fieldset.append(legend); controls.append(fieldset); controlTarget = fieldset;
  };
  const button = (label: string, id: string, run: () => void) => {
    const element = document.createElement('button'); element.textContent = label; element.id = id;
    element.addEventListener('click', () => { try { run(); } catch (error) { status.textContent = String(error instanceof Error ? error.message : error); } }, { signal: lifetime.signal });
    controlTarget.append(element); return element;
  };
  const choose = (label: string, id: string, values: readonly [string, string][], change: (value: string) => void) => {
    const wrapper = document.createElement('label'), element = document.createElement('select'); wrapper.textContent = `${label} `; element.id = id;
    for (const [value, text] of values) element.add(new Option(text, value));
    element.addEventListener('change', () => change(element.value), { signal: lifetime.signal }); wrapper.append(element); controlTarget.append(wrapper); return element;
  };
  const diagnostics = (state: Record<string, unknown>) => {
    debug.textContent = JSON.stringify({ game: game.info.id, modules: target.lock.modules, providers: target.lock.providers, ...state });
  };
  let draw: (elapsed: number) => void;
  try {
    if (game.info.id === 'builtin.planet-viewer') {
      const theme = { highQuality: loadGraphicsQuality() === 'high' };
      const content = createBuiltinRegistry(game.bundle.modules).prepare(game.bundle.profile, environment(), ['content']); owned.push(content);
      const universe = content.service<ReadonlyMap<string, import('../../../packages/game-api/src/index').UniverseDefinition>>('content').get(game.bundle.selection.universe);
      if (!universe) throw new Error('Select a compatible body-content provider');
      const system = loadSystem(universe, game.bundle.selection.system), epoch = 0;
      const star = system.getBodyPosition(system.rootBody.id, epoch);
      const bodies: RenderBody[] = system.getAllBodies().map(body => {
        const position = system.getBodyPosition(body.id, epoch), dx = star.x - position.x, dy = star.y - position.y, distance = Math.hypot(dx, dy);
        return { id: body.id, name: body.name, radius: body.radius, position, color: body.color, accentColor: body.accentColor,
          atmosphereColor: body.atmosphereColor, skyColor: body.skyColor, horizonColor: body.horizonColor, surfaceFeatures: body.surfaceFeatures,
          appearance: body.appearance, surface: body.surface && body.surfaceFeatures !== 'star' ? generateSurface(body) : undefined,
          ...(distance ? { sunDirection: { x: dx / distance, y: dy / distance } } : {}) };
      });
      stage.classList.add('planet-stage'); stage.setAttribute('aria-label', 'Planet view: drag to pan, pinch or scroll to zoom');
      stage.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + - R Home');
      const camera = target.providedService(VIEW_CAMERAS).create('planet-view'); owned.push(camera);
      let renderer: SceneRenderer | undefined, rendererKind: 'webgl' | '2d' = 'webgl';
      owned.push({ dispose() { renderer?.dispose(); } });
      const pan = { x: 0, y: 0 }, view = { center: { x: 0, y: 0 }, rotation: 0, scale: 1 };
      group('Body and zoom');
      const focus = choose('Body', 'viewer-body', bodies.map(body => [body.id, body.name]), value => { camera.focus(value); fit(); });
      focus.value = bodies.some(body => body.id === 'planet') ? 'planet' : bodies[0]!.id; camera.focus(focus.value);
      const transform = (id: string) => { const body = bodies.find(body => body.id === id); return body ? { position: body.position, orientation: 0 } : undefined; };
      const frame = () => {
        const tracked = camera.frame({ width: stage.clientWidth, height: stage.clientHeight, elapsed: .016, transform });
        view.center.x = tracked.center.x + pan.x; view.center.y = tracked.center.y + pan.y;
        view.rotation = tracked.rotation; view.scale = tracked.scale; return view;
      };
      function updateViewer() { diagnostics({ kind: 'static-viewer', epoch, body: focus.value, renderer: rendererKind, quality: theme.highQuality ? 'high' : 'low', camera: frame() }); }
      function fit() { pan.x = pan.y = 0; const body = bodies.find(body => body.id === focus.value)!; const current = frame(); camera.changeZoom(Math.min(stage.clientWidth, stage.clientHeight) / (body.radius * 2.6) / current.scale); updateViewer(); }
      button('Zoom in', 'viewer-zoom-in', () => { camera.changeZoom(1.5); updateViewer(); }); button('Zoom out', 'viewer-zoom-out', () => { camera.changeZoom(1 / 1.5); updateViewer(); });
      button('Fit body', 'viewer-fit', fit); fit();
      group('Graphics');
      const rendererChoice = choose('Renderer', 'viewer-renderer', [['webgl', 'WebGL'], ['2d', '2D']], value => {
        try { replaceRenderer(value as 'webgl' | '2d'); }
        catch { rendererChoice.value = rendererKind; status.textContent = `${value === 'webgl' ? 'WebGL' : '2D'} unavailable; using ${rendererKind === 'webgl' ? 'WebGL' : '2D'}.`; }
      });
      function replaceRenderer(kind: 'webgl' | '2d') {
        // Context types cannot be switched on the same canvas. Prepare first so a
        // failed replacement leaves the current view and its controls usable.
        const canvas = document.createElement('canvas'); canvas.id = 'planet-view'; canvas.setAttribute('aria-label', 'Static celestial body view');
        canvas.style.cssText = 'width:100%;height:100%;display:block';
        const next = kind === 'webgl' ? target.providedService(WEBGL_DRAWING).create(canvas, DEFAULT_SHADERS) : drawing.create(canvas);
        stage.replaceChildren(canvas); renderer?.dispose(); renderer = next; rendererKind = kind; rendererChoice.value = kind;
        status.textContent = 'Time paused.'; updateViewer();
      }
      try { replaceRenderer('webgl'); }
      catch { replaceRenderer('2d'); status.textContent = 'WebGL unavailable; using 2D.'; }
      const quality = choose('Detail', 'viewer-quality', [['high', 'Detailed'], ['low', 'Simple']], value => { theme.highQuality = value === 'high'; updateViewer(); });
      quality.value = theme.highQuality ? 'high' : 'low';
      const interactions = {
        pan(x: number, y: number) { const scale = frame().scale; pan.x -= x / scale; pan.y += y / scale; updateViewer(); },
        zoom(factor: number) { camera.changeZoom(factor); updateViewer(); }, fit,
      };
      const shortcuts = bindViewShortcuts(stage, target.providedService(KEYBOARD_INPUT), interactions);
      owned.push(shortcuts, bindViewerControls(stage, interactions));
      draw = elapsed => { shortcuts.sample(elapsed); renderer!.drawScene({ camera: frame(), bodies, time: epoch, theme, showScale: true }); };
    } else {
      const host = new SurveySessionHost(); owned.push(host);
      const world = host.world, factory = target.providedService(PLAYER_CONTROLLERS), viewsFactory = target.providedService(LOCAL_VIEWS), playerViews = target.providedService(PLAYER_VIEWS);
      const overlays = Array.from(world.positions, (x, index) => ({ kind: 'circle' as const, space: 'world' as const,
        center: { x, y: index }, radius: .25, color: COLORS[index]!, fill: true }));
      // One fixture unit must remain visible in the smallest four-seat pane.
      const zooms = new Float64Array([32, 32, 32, 32]);
      const targets = [0, 1, 2, 3], players = targets.map(index => world.binding(index).playerId);
      let count = 1, pilot = 0, mode: 'split' | 'dynamic' = 'split', views: LocalViews | undefined, controllers: PlayerController[] = [], bases: PlayerView[] = [];
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
        for (const base of bases) base.dispose(); bases = [];
        for (const controller of controllers) controller.dispose(); controllers = [];
        views?.dispose(); views = undefined; stage.replaceChildren();
        const bindings = Array.from({ length: count }, (_, index) => {
          const targetIndex = targets[index]!, binding = { ...world.binding(targetIndex), playerId: players[index]!, seatId: `seat-${index + 10}`, viewportId: `map-${index + 20}` };
          const controller = factory.create(world.controls, { pilot: index, sources: [keyboard] }); controllers.push(controller);
          return { seatId: binding.seatId, viewportId: binding.viewportId, playerId: binding.playerId, targetId: binding.entityId };
        });
        views = viewsFactory.create({ bindings, mode, layout: 'auto', surface(binding) {
          const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', `Survey ${binding.seatId}`);
          canvas.style.cssText = 'position:absolute;outline:1px solid #263844;outline-offset:-1px'; stage.append(canvas); const renderer = drawing.create(canvas);
          return { resize(rect, _width, _height, visible) { canvas.hidden = !visible; canvas.style.left = `${rect.x * 100}%`; canvas.style.top = `${rect.y * 100}%`; canvas.style.width = `${rect.w * 100}%`; canvas.style.height = `${rect.h * 100}%`; },
            draw(camera) { const scale = String(camera.scale); if (canvas.dataset.scale !== scale) canvas.dataset.scale = scale; renderer.drawScene({ camera, time: world.tick, showScale: false, overlays }); },
            dispose() { renderer.dispose(); canvas.remove(); } };
        } });
        for (let index = 0; index < count; index++) bases.push(playerViews.create({ binding: { ...bindings[index]!, session: host, context: world }, adapters: {
          input: playerViews.controller(controllers[index]!), camera: playerViews.camera(views.camera(bindings[index]!.viewportId)),
        } }));
        for (let index = 0; index < count; index++) views.camera(`map-${index + 20}`).changeZoom(zooms[index]!);
        reflow(); update();
      };
      const step = () => { host.step(); update(); };
      group('Views and controls');
      choose('Seats', 'survey-seats', [1, 2, 3, 4].map(number => [String(number), String(number)]), value => { count = Number(value); pilot = Math.min(pilot, count - 1); pilotChoice.value = String(pilot); rebuild(); });
      const pilotChoice = choose('Keyboard seat', 'survey-pilot', [0, 1, 2, 3].map(number => [String(number), String(number + 1)]), value => { if (Number(value) >= count) { pilotChoice.value = String(pilot); return; } for (const controller of controllers) controller.release(); pilot = Number(value); update(); });
      choose('Views', 'survey-mode', [['split', 'Split'], ['dynamic', 'Shared']], value => { mode = value as 'split' | 'dynamic'; rebuild(); });
      group('Move and record');
      const instructions = document.createElement('p'); instructions.className = 'fixture-keyboard'; instructions.textContent = 'Keyboard: click a view, hold Right/D or Space, then Advance one tick.'; controlTarget.append(instructions);
      button('Advance one tick', 'survey-step', () => { for (const controller of controllers) controller.sample({ elapsed: .01, flightAllowed: false, shortcutsAllowed: true }); step(); });
      for (const [label, value] of [['Move left', -1], ['Move right', 1]] as const) button(label, `survey-${value < 0 ? 'left' : 'right'}`, () => { const controller = controllers[pilot]!; controller.set('fixture.survey/move', value); step(); controller.release(); });
      button('Record observation', 'survey-record', () => { const controller = controllers[pilot]!; controller.set('fixture.survey/record', 1); step(); controller.release(); });
      group('Cameras');
      button('Swap first two targets', 'survey-rebind', () => {
        if (count < 2) { status.textContent = 'Choose at least two seats to rebind targets.'; return; }
        for (const controller of controllers) controller.release();
        [targets[0], targets[1]] = [targets[1]!, targets[0]!];
        for (let index = 0; index < 2; index++) world.transfer(targets[index]!, players[index]!);
        rebuild();
      });
      button('Zoom in this view', 'survey-zoom', () => { zooms[pilot] = zooms[pilot]! * 1.5; views!.camera(`map-${pilot + 20}`).changeZoom(1.5); update(); });
      const zoomView = (factor: number) => { zooms[pilot] = zooms[pilot]! * factor; views!.camera(`map-${pilot + 20}`).changeZoom(factor); update(); };
      button('Zoom out this view', 'survey-zoom-out', () => zoomView(1 / 1.5));
      const fitView = () => zoomView(32 / zooms[pilot]!);
      button('Reset this view', 'survey-fit', fitView);
      const cameraHint = document.createElement('p'); cameraHint.className = 'fixture-keyboard'; cameraHint.textContent = 'Click a view: +/− to zoom, R to reset.'; controlTarget.append(cameraHint);
      const shortcuts = bindViewShortcuts(stage, target.providedService(KEYBOARD_INPUT), { zoom: zoomView, fit: fitView }); owned.push(shortcuts);
      group('Saved state');
      button('Save survey state', 'survey-save', () => { localStorage.setItem(snapshotKey, JSON.stringify(surveySnapshot(world))); status.textContent = 'Survey state saved on this device.'; });
      button('Load survey state', 'survey-load', () => { const raw = localStorage.getItem(snapshotKey); if (!raw) throw new Error('No saved survey state');
        // Decode/validate before releasing controls or publishing the candidate state.
        const candidate = JSON.parse(raw); restoreSurvey(world, candidate);
        for (let index = 0; index < 4; index++) players[index] = world.binding(targets[index]!).playerId;
        rebuild(); status.textContent = 'Survey state loaded; held input was released.'; });
      owned.push({ dispose() { for (const base of bases) base.dispose(); for (const controller of controllers) controller.dispose(); views?.dispose(); } });
      rebuild();
      draw = elapsed => { shortcuts.sample(elapsed); if (stage.clientWidth !== viewWidth || stage.clientHeight !== viewHeight) reflow(); views!.render(elapsed, world.transform); };
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
