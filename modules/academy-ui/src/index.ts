import { ACADEMY_PANELS, ORBITAL_COURSE, TUTORIAL_RUNNERS, type AcademyPanel,
  type AcademyPanelFactory, type AcademyPanelOptions, type AcademyOrbitPreview, type ModuleInitializationV2,
  type OrbitalCourse, type OverlayPrimitive, type TutorialRunnerFactory } from '@space-sim/game-api';
import { conicPoints, observeFlight, previewOrbit } from './flight';

export function createAcademyPanels(runners: TutorialRunnerFactory, course: OrbitalCourse, css = ''): AcademyPanelFactory & { dispose(): void } {
  const panels = new Set<AcademyPanel>(); let disposed = false;
  return { create(options: AcademyPanelOptions) {
    if (disposed) throw Error('Academy provider is disposed');
    const runner = runners.create({ storage: options.storage, storageKey: `${course.id}/v${course.version}/${options.learnerKey}` });
    const document = options.container.ownerDocument, root = document.createElement('section');
    root.className = 'academy'; root.setAttribute('aria-label', 'Orbital Academy');
    const style = document.createElement('style'); style.textContent = css; root.append(style);
    const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
      const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
    };
    const heading = element('h2', 'Learn by flying'), intro = element('p', 'Start with a short flight, or choose any advanced lesson. Practice changes your selected ship only when you ask.');
    const summary = element('p', '', 'academy-summary'), select = element('select'); select.setAttribute('aria-label', 'Choose a lesson');
    for (const level of ['First flights', 'Orbital skills', 'Advanced'] as const) {
      const group = element('optgroup'); group.label = level;
      for (const lesson of course.lessons.filter(item => item.level === level)) { const option = element('option', lesson.title); option.value = lesson.id; group.append(option); }
      select.append(group);
    }
    const title = element('h3'), description = element('p'), actions = element('div', '', 'academy-actions');
    const button = (label: string, action: () => void) => {
      const node = element('button', label); node.type = 'button'; node.addEventListener('click', () => {
        try { action(); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
      }); return node;
    };
    const practice = button('Load practice setup', () => start(true)), current = button('Guide my current flight', () => start(false));
    const stop = button('Stop guidance', () => { runner.stop(); preview = undefined; render(); });
    actions.append(practice, current, stop);
    const caution = element('p', 'Loading or restarting practice repositions your selected ship, cuts thrust and leaves time paused. Close this window to fly, then resume when ready. The small objective button reopens your lesson.', 'academy-note');
    const status = element('p'); status.setAttribute('role', 'status'); status.className = 'academy-feedback';
    const objective = element('div', '', 'academy-objective'), objectiveTitle = element('strong'), instruction = element('p'), answers = element('div', '', 'academy-answers');
    objective.append(objectiveTitle, instruction, answers);
    const hint = element('details'), hintTitle = element('summary', 'Show a hint'), hintText = element('p'); hint.append(hintTitle, hintText);
    const deeper = element('details'), deeperTitle = element('summary', 'Go deeper'), deeperText = element('p'); deeper.append(deeperTitle, deeperText);
    const previewLabel = element('label', '', 'academy-preview'), previewToggle = element('input'); previewToggle.type = 'checkbox'; previewToggle.checked = true;
    previewLabel.append(previewToggle, document.createTextNode(' Show suggested orbit'));
    const previewNote = element('p', 'The dashed cyan guide shows an example target orbit. It does not predict your burns, steer the ship or guarantee an encounter.', 'academy-note');
    const figure = element('figure', '', 'academy-diagram');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Suggested orbit compared with current coast');
    const shape = (tag: 'polyline' | 'circle', stroke: string) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      node.setAttribute('fill', tag === 'circle' ? '#152e38' : 'none'); node.setAttribute('stroke', stroke); node.setAttribute('vector-effect', 'non-scaling-stroke'); svg.append(node); return node;
    };
    const currentCurve = shape('polyline', '#7d8d98'), targetCurve = shape('polyline', '#7edbd0'), bodyDisc = shape('circle', '#7390a3'), shipDot = shape('circle', '#ffffff');
    targetCurve.setAttribute('stroke-dasharray', '5 4'); shipDot.setAttribute('fill', '#ffffff');
    figure.append(svg, element('figcaption', 'Cyan: suggested orbit · gray: current coast · white: ship'));
    const telemetry = element('output', '', 'academy-telemetry'), bindings = element('p', '', 'academy-bindings');
    root.append(heading, intro, summary, select, title, description, figure, actions, caution, status, objective, hint, deeper, previewLabel, previewNote, telemetry, bindings);
    const window = options.windows.create({ id: 'academy', title: course.title, icon: 'manual', container: options.container, pinned: true, className: 'academy-window', place: () => ({ x: 18, y: 64 }) });
    const hud = element('button', '', 'academy-hud'); hud.type = 'button'; hud.hidden = true;
    hud.addEventListener('click', () => window.open()); options.container.append(hud);
    let dock: { dispose(): void } | undefined;
    try { window.body.append(root); dock = options.shell.addInstrument(window, 'Academy', 'Guided orbital flights and advanced lessons'); }
    catch (error) { hud.remove(); runner.dispose(); window.dispose(); throw error; }
    let selected = course.lessons[0]!, preview: AcademyOrbitPreview | undefined, elapsed = Infinity, closed = false, rendered = '', lastIdentity: object | undefined;
    const previewLines: { a: { x: number; y: number }; b: { x: number; y: number }; index: number }[] = [];
    const previewOverlays: OverlayPrimitive[] = [];
    function setPreview(): void {
      const flight = options.read(); preview = undefined; previewLines.length = 0; previewOverlays.length = 0;
      if (selected.target && flight && runner.lesson && !runner.interrupted) {
        try { preview = previewOrbit(flight, selected.target); } catch { /* Incompatible current flight: guidance stays usable. */ }
      }
      if (preview) {
        for (let i = 0; i < preview.points.length - 1; i += 2) {
          const a = { x: 0, y: 0 }, b = { x: 0, y: 0 }; previewLines.push({ a, b, index: i });
          previewOverlays.push({ kind: 'line', space: 'world', color: '#7edbd0', width: 1.5, points: [a, b] });
        }
      }
    }
    function render(): void {
      summary.textContent = `${course.lessons.filter(lesson => runner.completed.has(`${lesson.id}@${lesson.version}`)).length} / ${course.lessons.length} lessons completed · all lessons available`;
      for (const option of select.options) {
        const lesson = course.lessons.find(item => item.id === option.value)!;
        option.textContent = `${runner.completed.has(`${lesson.id}@${lesson.version}`) ? '✓ ' : ''}${lesson.title}`;
      }
      title.textContent = selected.title; description.textContent = selected.introduction; deeperText.textContent = selected.deeper;
      practice.textContent = runner.lesson ? 'Restart practice' : 'Load practice setup'; stop.disabled = !runner.lesson;
      const step = runner.lesson && !runner.finished ? selected.steps[runner.step] : undefined;
      objective.hidden = !step || runner.interrupted; hint.hidden = !step || runner.interrupted;
      status.textContent = runner.feedback || (runner.lesson ? 'Follow the objective. Your ship remains under your control.' : 'Choose practice, or start guidance over your current flight.');
      objectiveTitle.textContent = step ? `${runner.step + 1} / ${selected.steps.length} · ${step.title}` : '';
      hud.hidden = !runner.lesson;
      hud.textContent = runner.finished ? 'Lesson complete · choose another' : runner.interrupted ? 'Flight changed · restart guidance' : `Academy · ${step?.title ?? selected.title}`;
      instruction.textContent = step?.instruction ?? ''; hintText.textContent = step?.hint ?? ''; answers.replaceChildren();
      for (const [index, choice] of (step?.question?.choices ?? []).entries()) answers.append(button(choice, () => { runner.answer(index); hint.open = false; render(); }));
      previewLabel.hidden = !selected.target; previewNote.hidden = !selected.target;
      figure.hidden = !selected.target || !runner.lesson;
      rendered = `${runner.step}/${runner.finished}/${runner.interrupted}/${runner.feedback}`;
    }
    function start(load: boolean): void {
      if (load) options.practice(selected.practice);
      const flight = options.read(); if (!flight) throw Error('Select an owned ship before starting guidance.');
      if (!flight.analytic) throw Error('These orbital lessons require the analytic two-body flight provider.');
      runner.start(selected, observeFlight(flight)); lastIdentity = flight.identity; hint.open = false; setPreview(); render();
    }
    select.addEventListener('change', () => {
      selected = course.lessons.find(item => item.id === select.value)!; runner.stop(); preview = undefined; hint.open = false; deeper.open = false; render();
    });
    render(); window.open();
    const panel: AcademyPanel = {
      update(seconds) {
        if (closed) return;
        elapsed += seconds;
        if (elapsed < .1 || (!window.isOpen && !runner.lesson)) return;
        elapsed = 0;
        const flight = options.read();
        if (!flight) { runner.stop(); preview = undefined; status.textContent = 'Select an owned ship to use the academy.'; return; }
        if (runner.lesson) {
          runner.update(observeFlight(flight));
          if (runner.interrupted || (lastIdentity && flight.identity !== lastIdentity)) preview = undefined;
          const stamp = `${runner.step}/${runner.finished}/${runner.interrupted}/${runner.feedback}`;
          if (stamp !== rendered) { hint.open = false; render(); }
        }
        if (flight.state.status === 'crashed') { status.textContent = 'Ship crashed. Restart practice when you are ready.'; if (runner.lesson) hud.textContent = 'Ship crashed · restart practice'; }
        if (!window.isOpen) return;
        figure.hidden = !preview || !previewToggle.checked || preview.bodyId !== flight.body.id;
        if (!figure.hidden && preview) {
          const orbit = flight.orbit;
          const actual = orbit?.kind === 'elliptic' && orbit.apoapsis !== null && !orbit.radial ? conicPoints(orbit.periapsis, orbit.apoapsis, orbit.periapsisAngle ?? 0) : [];
          // Always show the whole target, independent of the player's flight camera.
          const extent = Math.max(flight.body.radius, ...preview.points.map(p => Math.hypot(p.x, p.y)), ...actual.map(p => Math.hypot(p.x, p.y)), Math.hypot(flight.state.position.x, flight.state.position.y)) * 1.12;
          svg.setAttribute('viewBox', `${-extent} ${-extent} ${extent * 2} ${extent * 2}`);
          targetCurve.setAttribute('points', preview.points.map(p => `${p.x},${-p.y}`).join(' '));
          currentCurve.setAttribute('points', actual.map(p => `${p.x},${-p.y}`).join(' '));
          bodyDisc.setAttribute('r', String(flight.body.radius));
          shipDot.setAttribute('r', String(extent * .025)); shipDot.setAttribute('cx', String(flight.state.position.x)); shipDot.setAttribute('cy', String(-flight.state.position.y));
        }
        const orbit = flight.orbit, fmt = (value: number | null | undefined, unit: string) => value !== undefined && value !== null && Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : '—';
        telemetry.textContent = `${flight.body.name} · ${flight.paused ? 'Paused' : flight.engine ? 'Thrusting' : 'Coasting'}\nClearance ${fmt(flight.clearance, 'm')} · speed ${fmt(Math.hypot(flight.state.velocity.x, flight.state.velocity.y), 'm/s')}\nPeriapsis altitude ${fmt(orbit ? orbit.periapsis - flight.body.radius : null, 'm')} · apoapsis altitude ${fmt(orbit?.apoapsis ? orbit.apoapsis - flight.body.radius : null, 'm')}\ne ${orbit ? orbit.eccentricity.toFixed(3) : '—'} · period ${fmt(orbit?.period, 's')}\nε ${fmt(orbit?.energy, 'J/kg')} · h ${fmt(orbit?.angularMomentum, 'm²/s')}`;
        bindings.textContent = options.bindings();
      },
      draw(view) {
        if (closed || !runner.lesson || runner.interrupted || !previewToggle.checked || !preview || preview.bodyId !== view.body.id) return [];
        const points = preview.points, offset = view.body.position;
        for (const line of previewLines) {
          const a = points[line.index]!, b = points[line.index + 1]!;
          line.a.x = a.x + offset.x; line.a.y = a.y + offset.y; line.b.x = b.x + offset.x; line.b.y = b.y + offset.y;
        }
        return previewOverlays;
      },
      dispose() { if (closed) return; closed = true; panels.delete(panel); runner.dispose(); hud.remove(); dock?.dispose(); window.dispose(); preview = undefined; },
    };
    panels.add(panel); return panel;
  }, dispose() { if (disposed) return; disposed = true; for (const panel of [...panels]) panel.dispose(); panels.clear(); } };
}
/**
 * Contributes the Orbital Academy flight UI panel and world-space target orbit preview provider.
 * Provides learning.academy@1.0.0 in slot learning.academy.
 * Requires learning.runner@^1.0.0 and learning.orbital-course@^1.0.0.
 */
export default function initialize(context: ModuleInitializationV2): void {
  // The host explicitly supplies the compatible flight and window adapters at mount.
  context.provide(ACADEMY_PANELS, context.own(createAcademyPanels(context.use(TUTORIAL_RUNNERS), context.use(ORBITAL_COURSE), context.assets.text('assets/academy.css'))));
  context.contributeGuide({ id: 'academy-ui', audience: 'creators', title: 'Academy flight adapter', summary: 'Explicit practice actions and read-only orbital guidance.', asset: 'docs/creators/usage.json' });
}
