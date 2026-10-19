import { flightSampleInFrame, createProjector, hermiteControls, maneuverDelta, deterministicMath as dm,
 type EvaluatedFlightNode, type FlightPlanProgress, type FlightPlan, type FlightPlanArchive, type FlightPlanNode, type FlightPlanService, type TransferPlanner, type WorldRead, type Camera, type Controls, type GhostSample, type ManeuverPreview, type SimulationContext, type State, type Vec,
 type NodeAlarmSettings, type OrbitalAlarmFactory, type ClockService, type CoreMotion, type FlightPrediction, type ManeuverBurnControl, type ManeuverBurnFactory,
 type PredictionFactory, type WindowChrome, type WindowSystem, type Disposable,
 type ManeuverFlight as Flight, type ManeuverPlannerOptions, type ManeuverPlannerControl } from '@space-sim/game-api';
import { ManeuverMap } from './map';
import { TransferControls } from './transfers';
import { NodeAlarms, DEFAULT_NODE_ALARM, type AlarmCandidate } from './alarms';
export interface ManeuverEditorServices {
 readonly windows: Pick<WindowSystem, 'create'>; readonly predictions: PredictionFactory; readonly burns: ManeuverBurnFactory;
 readonly plans?: FlightPlanService;
 readonly transfers?: TransferPlanner;
 readonly alarms?: OrbitalAlarmFactory;
 readonly clock: Pick<ClockService, 'stepSeconds' | 'idle'>; readonly motion: Pick<CoreMotion, 'clampWarpFactor'>;
}
function flightMotion(flight: Flight): SimulationContext {
  return flight.ship ? flight.world.contextFor(flight.ship) : flight.world.context;
}
export interface ManeuverEditorTuning { readonly previewMaxMs?: number; readonly uiRefreshMs?: number }

/** Hit the rendered cubic, rather than sparse sample vertices or their straight chords.
 * Closed previews retain an old epoch; roll a selected phase forward to its next passage.
 * Captured drags use infinite tolerance to project any pointer position onto the
 * nearest curve; latestTime bounds that projection to a supported initial leg. */
export function pickManeuverTime(path: readonly GhostSample[], closed: boolean, now: number, pointer: Vec,
  camera: Camera, origin: Vec, width: number, height: number, tolerance = 10, latestTime = Infinity): number | undefined {
  const project = createProjector(camera, width, height);
  const at = (p: Vec): Vec => project({ x: origin.x + p.x, y: origin.y + p.y });
  const period = closed && path.length > 1 ? path.at(-1)!.time - path[0]!.time : 0;
  let best = tolerance * tolerance, picked: number | undefined;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    if(b.time>=latestTime)break;
    // Numerical contact drifts have no analytic state that can seed an impulsive burn.
    if (b.linear || !(b.time > a.time) || (!closed && b.time <= now + .05)) continue;
    const [c1, c2] = hermiteControls(a, b), p0 = at(a.position), p1 = at(c1), p2 = at(c2), p3 = at(b.position);
    const length = Math.hypot(p1.x-p0.x, p1.y-p0.y) + Math.hypot(p2.x-p1.x, p2.y-p1.y) + Math.hypot(p3.x-p2.x, p3.y-p2.y);
    const count = Math.max(8, Math.min(128, Math.ceil(length / 8)));
    let prev = p0;
    for (let j = 1; j <= count; j++) {
      const t = j / count, u = 1-t;
      const next = { x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
        y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y };
      const dx = next.x-prev.x, dy = next.y-prev.y, l2 = dx*dx + dy*dy;
      const f = l2 ? Math.max(0, Math.min(1, ((pointer.x-prev.x)*dx + (pointer.y-prev.y)*dy)/l2)) : 0;
      const d2 = (pointer.x-prev.x-f*dx)**2 + (pointer.y-prev.y-f*dy)**2;
      let time = a.time + (b.time-a.time)*(j-1+f)/count;
      if (period > 0 && time <= now + .05) time += Math.ceil((now + .05-time)/period)*period;
      if (time > now + .05 && d2 < best) { best = d2; picked = time; }
      prev = next;
    }
  }
  return picked;
}

/** With at most 0.1 wall seconds accepted by HostSession, leave half the remaining
 * approach time unused on every warped frame, even after a long rendering stall. */
export function maneuverWarpFactor(remaining: number, clamp: CoreMotion['clampWarpFactor']): number {
  return remaining <= .25 ? 1 : clamp(Math.min(10_000, remaining / .2));
}

interface Node {
  readonly shipId: string;
  readonly id: string;
  label: string;
  completed?: boolean;
  alarm?: NodeAlarmSettings;
  bodyId: string;
  context: SimulationContext;
  seed: State;
  time: number;
  sample: GhostSample;
  prograde: number;
  radial: number;
  valid: boolean;
  reason: string;
}
/** Local plans and opt-in host burn execution through normal session controls.
 * Preview contexts and node state stay outside world saves and fingerprints. */
export class ManeuverPlanner implements ManeuverPlannerControl {
  private disposed = false;
  private readonly lifetime: AbortController;
  private readonly document: Document;
  private readonly id: string;
  private dock?: Disposable;
  private map?: ManeuverMap;
  private transferControls?: TransferControls;
  private alarmControls?: NodeAlarms;
  private readonly alarmCandidates:AlarmCandidate[]=[];
  private alarmManualEngine=false;
  private readonly alarmCandidatePool=new WeakMap<Node,{node:Node;deadline:number}>();
  private readonly window!: WindowChrome;
  private readonly preview: FlightPrediction;
  private readonly nodes = new Map<string, Node>();
  private readonly plans = new Map<string, Node[]>();
  private readonly anchors = new Map<string, FlightPlan>();
  private readonly needsReview = new Set<string>();
  private readonly chains = new Map<string, { readonly source: WorldRead; readonly seed: State }>();
  private planEvaluation?: { job: Generator<FlightPlanProgress, readonly EvaluatedFlightNode[]>; plan: FlightPlan; flight: Flight; nodes: Node[]; review: boolean; editableNode?: Node };
  private dragCoast?: {node:Node;path:readonly GhostSample[]};
  private nextNode = 1;
  private nodeSelect?: HTMLSelectElement;
  private world?: WorldRead;
  private current?: Node;
  private readonly prograde: HTMLInputElement;
  private readonly radial: HTMLInputElement;
  private readonly timing: HTMLInputElement;
  private readonly increment: HTMLSelectElement;
  private readonly status: HTMLOutputElement;
  private readonly summary: HTMLOutputElement;
  private readonly result: HTMLOutputElement;
  private readonly warpButton: HTMLButtonElement;
  private readonly cancelWarp: HTMLButtonElement;
  private readonly executeButton: HTMLButtonElement;
  private readonly abortButton: HTMLButtonElement;
  private execution?: { node: Node; burn: ManeuverBurnControl; initialThrottle: number; expected?: State };
  private warping = false;
  private lastRequest = 1;
  private lastUi = -Infinity;

  get executing(): boolean { return !!this.execution; }

  /** Release controls while the current session still owns the execution's ship. */
  cancel(): void { if (this.disposed) return; this.cancelPlanEvaluation(); this.abortExecution(); this.stopWarp(); this.transferControls?.cancel(); }

  constructor(private readonly services: ManeuverEditorServices, private readonly options: ManeuverPlannerOptions, private readonly tuning: ManeuverEditorTuning = {}) {
    this.id = options.id ?? 'maneuver';
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(this.id)) throw new Error('Invalid maneuver window identity');
    const previewMaxMs = tuning.previewMaxMs ?? 1, uiRefreshMs = tuning.uiRefreshMs ?? 100;
    if (!Number.isFinite(previewMaxMs) || previewMaxMs < .1 || previewMaxMs > 8 || !Number.isFinite(uiRefreshMs) || uiRefreshMs < 16 || uiRefreshMs > 1000) throw new Error('Invalid maneuver editor budget');
    this.document = options.container.ownerDocument;
    this.lifetime = new (this.document.defaultView?.AbortController ?? AbortController)();
    const document = this.document;
    const on = (target: EventTarget, type: string, listener: (event: Event) => void): void => target.addEventListener(type, listener, { signal: this.lifetime.signal });
    this.preview = services.predictions.create(pass => this.event('maneuver-preview', { ...pass }));
    this.preview.maxMs = previewMaxMs;
    try {
    this.window = services.windows.create({ id: this.id, title: 'Maneuver', icon: 'trajectory', pinned: true,
      container: options.container,
      place: () => ({ x: 24, y: 100 }), className: 'maneuver-window' });
    this.window.body.innerHTML = `
      <div class="maneuver-tabs" role="tablist" aria-label="Flight planning">
        <button id="${this.id}-node-tab" type="button" role="tab" aria-controls="${this.id}-node-view" aria-selected="true">Burn editor</button>
        <button id="${this.id}-transfers-tab" type="button" role="tab" aria-controls="${this.id}-transfers" aria-selected="false" ${services.transfers?'':'hidden'}>Transfer window</button>
      </div>
      <div class="maneuver-live-controls" id="${this.id}-live-controls" hidden><button id="${this.id}-stop" type="button" hidden>Stop warp</button><button id="${this.id}-abort" type="button" hidden>Abort burn</button></div>
      <section id="${this.id}-transfers" role="tabpanel" aria-labelledby="${this.id}-transfers-tab" hidden></section>
      <section id="${this.id}-node-view" role="tabpanel" aria-labelledby="${this.id}-node-tab" class="maneuver-node-view">
        <div id="${this.id}-plan-controls" ${services.plans?'':'hidden'}>
          <label class="maneuver-node-label">Plan node<select id="${this.id}-nodes" aria-label="Plan node"></select></label>
          <button id="${this.id}-review" class="maneuver-review" type="button" hidden>Review remaining nodes</button>
        </div>
        <output class="maneuver-summary" id="${this.id}-summary"></output>
        <output class="maneuver-status" id="${this.id}-status" aria-live="polite">Click the coast line to place a burn, or choose Transfer window.</output>
        <div class="maneuver-fields">
          <div class="maneuver-component"><label for="${this.id}-time">Node in <small>s</small></label><div class="maneuver-number"><button type="button" data-time="-10" aria-label="Move node 10 seconds earlier">−10</button><input id="${this.id}-time" type="number" min="0.1" step="any" inputmode="decimal"><button type="button" data-time="10" aria-label="Move node 10 seconds later">+10</button></div></div>
          <div class="maneuver-component"><label for="${this.id}-prograde">Prograde <small>m/s</small></label><div class="maneuver-number"><button type="button" data-adjust="prograde/-1" aria-label="Decrease prograde delta-v">−</button><input id="${this.id}-prograde" aria-label="Prograde delta-v" type="number" step="any" min="-1000000" max="1000000" value="0" inputmode="decimal"><button type="button" data-adjust="prograde/1" aria-label="Increase prograde delta-v">+</button></div></div>
          <div class="maneuver-component"><label for="${this.id}-radial">Radial <small>m/s</small></label><div class="maneuver-number"><button type="button" data-adjust="radial/-1" aria-label="Decrease radial delta-v">−</button><input id="${this.id}-radial" aria-label="Radial delta-v" type="number" step="any" min="-1000000" max="1000000" value="0" inputmode="decimal"><button type="button" data-adjust="radial/1" aria-label="Increase radial delta-v">+</button></div></div>
        </div>
        <label class="maneuver-step">Button step<select id="${this.id}-increment" aria-label="Adjustment step"><option value="0.1">0.1 m/s · fine</option><option value="1" selected>1 m/s · normal</option><option value="10">10 m/s · coarse</option><option value="100">100 m/s · large</option></select></label>
        <div class="maneuver-adjust maneuver-flight-actions"><button id="${this.id}-warp" type="button">Warp to node</button><button id="${this.id}-execute" type="button">Execute burn</button></div>
        <output class="maneuver-help" id="${this.id}-result"></output>
        <details id="${this.id}-alarms" ${services.alarms?'':'hidden'}></details>
        <details id="${this.id}-plan-actions" ${services.plans?'':'hidden'}><summary>Plan actions</summary>
          <div class="maneuver-adjust"><button id="${this.id}-add" type="button">Add node</button><button id="${this.id}-flown" type="button">Mark flown</button></div>
          <div class="maneuver-adjust"><button id="${this.id}-export" type="button">Export plan</button><button id="${this.id}-import" type="button">Load plan</button><input id="${this.id}-file" type="file" accept=".json,application/json" hidden></div>
        </details>
        <div class="maneuver-adjust maneuver-secondary"><button id="${this.id}-clear" type="button">Clear Δv</button><button id="${this.id}-delete" type="button">Delete node</button></div>
        <details class="panel-note"><summary>Flying the plan</summary><p class="maneuver-help">Warp to node only coasts, even with zero Δv or no engine. It stops 10 seconds before the node, plus half the estimated burn duration when available. Execute burn separately handles warp, alignment, thrust and cutoff (host only). Manual flight input or Abort burn takes over. Adjustment buttons use the selected step; Shift makes it ten times finer. Map drags use that step per 4 pixels. Shift on time buttons moves by 1 second. Escape cancels a map drag. Burn arrows show the delta-v direction at departure and arrival. Durations at the current throttle setting assume constant thrust and alignment; automatic execution still uses full throttle with a final-tick cutoff. The dashed line assumes an instant burn; finite burns can differ. Plans can be exported or saved with a universe when the shared plan service is available. Later nodes preview earlier impulsive burns. Review remaining nodes against actual flight after each flown burn; every automatic burn needs its own Execute action.</p></details>
      </section>`;
    const get = <T extends HTMLElement>(id: string): T => this.window.body.querySelector<T>(`#${this.id}-${id}`)!;
    if (services.transfers) this.transferControls = new TransferControls(get('transfers'), `${this.id}-transfer`, services.transfers, options, plan => {
      this.abortExecution(); this.stopWarp(); this.insertPlan(plan, this.options.flight());
      this.current = this.nodes.get(plan.shipId); this.rebuildPlan(true); this.refreshInputs(); this.showMode('node'); this.window.body.querySelector<HTMLButtonElement>(`#${this.id}-node-tab`)!.focus({preventScroll:true});
    }, this.lifetime.signal);
    if (services.alarms) this.alarmControls = new NodeAlarms(get('alarms'), services.alarms, options,
      node => this.alarmDeadline(node as Node), () => this.collectAlarms(),
      () => { if(this.warping){this.lastRequest=this.options.flight().requestedWarp;if(this.lastRequest<=1)this.warping=false;} },
      () => { this.stopWarp(); if(this.options.flight().requestedWarp!==1)this.options.setWarp(1); }, this.lifetime.signal);
    on(get('node-tab'),'click',()=>this.showMode('node'));
    on(get('transfers-tab'),'click',()=>this.openTransfers());
    on(this.window.body.querySelector('.maneuver-tabs')!,'keydown',event=>{
      const key=(event as KeyboardEvent).key;if(!['ArrowLeft','ArrowRight','Home','End'].includes(key)||!services.transfers)return;
      event.preventDefault();event.stopPropagation();const current=this.window.body.querySelector('[role="tab"][aria-selected="true"]')?.id.endsWith('node-tab')?'node':'transfers';
      const next=key==='Home'?'node':key==='End'?'transfers':current==='node'?'transfers':'node';this.showMode(next);get<HTMLButtonElement>(`${next}-tab`).focus();
    });
    this.showMode(services.transfers?'transfers':'node');
    this.prograde = get('prograde'); this.radial = get('radial'); this.timing = get('time');
    this.increment = get('increment');
    this.status = get('status'); this.summary = get('summary'); this.result = get('result');
    this.warpButton = get('warp'); this.cancelWarp = get('stop');
    this.executeButton = get('execute'); this.abortButton = get('abort');
    for (const [input,axis] of [[this.prograde,'prograde'],[this.radial,'radial']] as const) on(input, 'input', () => this.edit(axis));
    on(this.timing, 'change', () => {
      const node = this.current, flight = this.options.flight(), seconds = this.timing.valueAsNumber;
      if (!node || !node.valid || !Number.isFinite(seconds) || seconds < .1) { this.refreshInputs(); return; }
      if (!this.moveTime(flight.world.time + seconds)) {
        this.options.notify('Choose a time within the visible coast prediction.'); this.refreshInputs(); return;
      }
    });
    on(this.window.body, 'click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-adjust]');
      const timeButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-time]');
      if (timeButton && this.current?.valid && !this.execution) {
        if (!this.moveTime(this.current.time + Number(timeButton.dataset.time) * ((event as MouseEvent).shiftKey ? .1 : 1))) this.options.notify('Choose a time within the visible coast prediction.');
      }
      if (!button || !this.current?.valid || this.execution) return;
      const [axis, sign] = button.dataset.adjust!.split('/'), input = axis === 'prograde' ? this.prograde : this.radial;
      input.value = String((axis==='prograde'?this.current.prograde:this.current.radial) + Number(sign) * Number(this.increment.value) * ((event as MouseEvent).shiftKey ? .1 : 1));
      this.edit(axis==='prograde'?'prograde':'radial');
    });
    this.nodeSelect = get<HTMLSelectElement>('nodes');
    on(this.nodeSelect, 'change', () => {
      const shipId = this.options.flight().ship?.id, node = shipId && this.plans.get(shipId)?.find(n => n.id === this.nodeSelect!.value);
      if (!node || this.execution) return;
      this.stopWarp(); this.nodes.set(node.shipId, node); this.current = node; this.preview.invalidate(); this.refreshInputs(); this.lastUi = -Infinity;
    });
    on(get('add'), 'click', () => this.addNode());
    on(get('review'), 'click', () => this.rebuildPlan(true));
    on(get('flown'), 'click', () => {
      if (!this.current || this.execution) return;
      this.needsReview.add(this.current.shipId);
      this.stopWarp(); this.current.completed = true; this.current.valid = false; this.current.reason = 'Marked flown. Review remaining nodes against actual flight.';
      this.invalidateLater(this.current); this.preview.invalidate(); this.lastUi = -Infinity;
    });
    on(get('export'), 'click', () => {
      const blob = new Blob([JSON.stringify(this.savePlans(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'maneuver-plan.flightplan.json'; link.click(); URL.revokeObjectURL(url);
    });
    const file = get<HTMLInputElement>('file');
    on(get('import'), 'click', () => file.click());
    on(file, 'change', () => {
      const selected = file.files?.[0], world = this.options.flight().world; file.value = '';
      if (!selected) return;
      if (selected.size > 1024 * 1024) { this.options.notify('Flight plans must be at most 1 MiB.'); return; }
      void selected.text().then(text => {
        if (this.disposed || this.options.flight().world !== world) return;
        this.loadPlans(JSON.parse(text)); this.options.notify('Plan loaded. Review remaining nodes before flying.');
      }).catch(error => { if (!this.disposed && this.options.flight().world === world) this.options.notify(error instanceof Error ? error.message : 'Plan could not be loaded.'); });
    });
    on(get('clear'), 'click', () => { this.prograde.value = '0'; this.radial.value = '0'; this.edit(); });
    on(get('delete'), 'click', () => {
      this.abortExecution();
      const current = this.current;
      if (current) {
        const remaining = (this.plans.get(current.shipId) ?? []).filter(node => node !== current);
        if (remaining.length) { this.plans.set(current.shipId, remaining); this.nodes.set(current.shipId, remaining[0]!); }
        else { this.plans.delete(current.shipId); this.anchors.delete(current.shipId); this.nodes.delete(current.shipId); }
      }
      this.stopWarp(); this.current = current ? this.nodes.get(current.shipId) : undefined; this.rebuildPlan();
      this.preview.invalidate(); this.refreshInputs(); this.lastUi = -Infinity;
    });
    on(this.warpButton, 'click', () => {
      this.abortExecution();
      const flight = this.options.flight();
      if (this.current?.valid && !this.waiting(this.current) && this.current.bodyId===flight.ship?.bodyId && flight.canWarp && !flight.paused && !flight.inputBlocked && this.current.time > flight.world.time + 10) {
        this.warping = true; this.lastRequest = flight.requestedWarp;
      }
    });
    on(this.cancelWarp, 'click', () => this.stopWarp());
    on(this.executeButton, 'click', () => this.execute());
    on(this.abortButton, 'click', () => this.abortExecution('Autonomous burn aborted.'));
    on(document, 'visibilitychange', () => { if (document.hidden) { this.abortExecution('Autonomous burn aborted: tab hidden.'); this.stopWarp(); } });
    if (options.map) this.map = new ManeuverMap(options, {
      node: () => this.current, position:()=>this.current?this.nodePosition(this.current):undefined, enabled: () => !this.disposed && !!this.current && (this.current.valid || this.planEvaluation?.editableNode===this.current) && !this.execution && options.flight().enabled && !options.flight().inputBlocked,
      increment: () => Number(this.increment.value), open: () => this.window.open(),
      begin:()=>{const node=this.current;if(node&&node.bodyId!==options.flight().body.id)this.dragCoast={node,path:this.preview.path.filter(point=>point.bodyId===node.bodyId&&point.time<=node.time+1e-7)};},
      finish:()=>{this.dragCoast=undefined;},
      adjust: (axis, value) => { (axis === 'prograde' ? this.prograde : this.radial).value = String(value); this.edit(axis); },
      move: pointer => {
        const surface = options.map?.(), prediction = this.prediction; if (!surface || !prediction) return;
        const node=this.current,flight=options.flight(),laterBody=node&&node.bodyId!==flight.body.id;
        const path=laterBody?(this.dragCoast?.node===node?this.dragCoast.path:this.preview.path.filter(point=>point.bodyId===node.bodyId&&point.time<=node.time+1e-7)):prediction.path;
        const time = pickManeuverTime(path, !laterBody&&prediction.pathEnd === 'closed', flight.world.time, pointer,
          surface.camera, surface.origin, surface.element.clientWidth, surface.element.clientHeight, Infinity, laterBody?Infinity:prediction.path.find(point=>point.encounter)?.time);
        if (time !== undefined) this.moveTime(time);
      },
      restore: (time, prograde, radial) => { this.moveTime(time); this.prograde.value = String(prograde); this.radial.value = String(radial); this.edit(); },
    }, this.lifetime.signal);
    this.dock = options.shell?.addInstrument(this.window, 'Maneuver', 'Plan a burn by clicking the coast trajectory');
    } catch (error) {
      const errors: unknown[] = [error];
      for (const close of [() => this.cancelPlanEvaluation(), () => this.lifetime.abort(), () => this.transferControls?.dispose(), () => this.alarmControls?.dispose(), () => this.map?.dispose(), () => this.dock?.dispose(), () => this.preview.dispose(), () => this.window?.dispose()]) { try { close(); } catch (cleanup) { errors.push(cleanup); } }
      if (errors.length > 1) throw new AggregateError(errors, 'Maneuver editor creation failed');
      throw error;
    }
  }
  private event(kind: string, detail: Record<string, unknown>): void { this.options.event?.(kind, detail); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; const errors: unknown[] = [];
    for (const close of [() => this.cancelPlanEvaluation(), () => this.lifetime.abort(), () => this.transferControls?.dispose(), () => this.alarmControls?.dispose(), () => this.map?.dispose(), () => this.abortExecution(), () => this.stopWarp(), () => this.dock?.dispose(), () => this.preview.dispose(), () => this.window.dispose()]) { try { close(); } catch (error) { errors.push(error); } }
    this.plans.clear(); this.anchors.clear(); this.chains.clear(); this.needsReview.clear(); this.nodes.clear(); this.current = undefined; this.world = undefined; this.prediction = undefined; this.dock = undefined;
    if (errors.length) throw new AggregateError(errors, 'Maneuver editor cleanup failed');
  }

  private stopWarp(): void {
    if (this.warping) { this.warping = false; this.options.setWarp(1); }
  }
  private abortExecution(reason?: string): void {
    const execution = this.execution;
    if (!execution) return;
    this.execution = undefined; const errors: unknown[] = [];
    for (const close of [() => this.stopWarp(), () => this.options.setWarp(1), () => this.options.releaseControls(execution.node.shipId), () => execution.burn.dispose()]) { try { close(); } catch (error) { errors.push(error); } }
    if (execution.burn.phase === 'burning') {
      this.invalidateLater(execution.node); execution.node.valid = false; execution.node.reason = `${reason ?? 'Burn interrupted.'} Click the coast line to replan.`;
      try { this.preview.invalidate(); } catch (error) { errors.push(error); }
    }
    this.lastUi = -Infinity;
    if (reason) { try { this.options.notify(reason); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Maneuver execution cleanup failed');
  }
  private alignmentSeconds(flight: Flight, delta: Vec): number {
    const error = Math.abs(dm.normalizeAngle(dm.atan2(delta.y, delta.x) - (flight.ship?.state.heading ?? 0)));
    return error < 1e-7 ? 0 : flightMotion(flight).vehicle.turnRate > 0 ? error / flightMotion(flight).vehicle.turnRate : Infinity;
  }
  private execute(): void {
    const node = this.current, flight = this.options.flight(), plan = this.snapshot();
    if (!node?.valid || this.waiting(node) || !plan || !flight.canWarp || flight.paused || flight.inputBlocked || !flight.enabled || this.execution
      || flight.ship?.id !== node.shipId || flight.ship.bodyId !== node.bodyId || flight.ship.state.status !== 'flying' || !(plan.burnSeconds > 0)
      || node.time - plan.burnSeconds / 2 - flight.world.time < this.alignmentSeconds(flight, plan.deltaVelocity) + .2) return;
    this.stopWarp();
    this.execution = { node, burn: this.services.burns.create(node.time, plan.deltaVelocity, flightMotion(flight).vehicle), initialThrottle: flight.ship.state.throttle };
    this.warping = true; this.lastRequest = flight.requestedWarp; this.lastUi = -Infinity;
    this.event('maneuver-execute', { ship: node.shipId, time: node.time });
  }
  /** Called by LocalSession before each 10 ms step, after beforeAdvance checked pilot
   * input. Revalidates identity and the expected last step before commanding thrust. */
  step(manual: Controls): Controls {
    if (this.disposed) return manual;
    const execution = this.execution;
    if (!execution || this.warping) return manual;
    const flight = this.options.flight(), ship = flight.ship, { node, burn } = execution;
    if (!ship || ship.id !== node.shipId || ship.bodyId !== node.bodyId || flight.world !== this.world
      || flightMotion(flight) !== node.context || !flight.enabled || flight.paused || flight.inputBlocked
      || ship.state.status !== 'flying' || ship.fault || flight.requestedWarp !== 1 || !node.valid) {
      this.abortExecution('Autonomous burn aborted: flight conditions changed.'); return this.services.clock.idle;
    }
    const expected = execution.expected;
    if (expected && (Math.abs(ship.state.time - expected.time) > 1e-7
      || Math.hypot(ship.state.position.x - expected.position.x, ship.state.position.y - expected.position.y) > .001
      || Math.hypot(ship.state.velocity.x - expected.velocity.x, ship.state.velocity.y - expected.velocity.y) > 1e-5
      || ship.state.heading !== expected.heading || ship.state.throttle !== expected.throttle)) {
      this.abortExecution('Autonomous burn aborted: trajectory or throttle changed.'); return this.services.clock.idle;
    }
    try {
      const command = burn.next(ship.state);
      if (command.throttle !== undefined && command.throttle !== ship.state.throttle) this.options.setThrottle(ship.id, command.throttle);
      if (burn.phase === 'complete') {
        burn.dispose(); this.execution = undefined; node.completed = true; this.invalidateLater(node); node.valid = false; node.reason = this.services.plans ? 'Burn complete. Review remaining nodes against actual flight.' : 'Burn complete. Click the coast line to plan the next maneuver.';
        this.preview.invalidate(); this.lastUi = -Infinity;
        this.options.notify('Maneuver complete. Engine off.'); this.event('maneuver-complete', { ship: ship.id, remaining: burn.remaining });
        return this.services.clock.idle;
      }
      execution.expected = flightMotion(flight).advance(this.options.flight().ship!.state, command.controls, this.services.clock.stepSeconds,
        flight.body, flight.world.surface(flight.body.id));
      return command.controls;
    } catch (error) {
      this.abortExecution(error instanceof Error ? error.message : 'Autonomous burn aborted.'); return this.services.clock.idle;
    }
  }
  private intent(node: Node): FlightPlanNode {
    return { id: node.id, label: node.label, bodyId: node.bodyId, time: node.time, prograde: node.prograde, radial: node.radial, ...(node.completed ? { completed: true } : {}), ...(node.alarm ? { alarm:node.alarm } : {}) };
  }
  private waiting(node: Node): boolean {
    return (this.plans.get(node.shipId) ?? []).some(value => value !== node && !value.completed && value.time < node.time);
  }
  private invalidateLater(node: Node): void {
    this.needsReview.add(node.shipId);
    for (const later of this.plans.get(node.shipId) ?? []) if (later.time > node.time && !later.completed) {
      later.valid = false; later.reason = 'Earlier burn changed. Review remaining nodes against actual flight.';
    }
  }
  private rebuildPlan(review = false): void {
    const service = this.services.plans, flight = this.options.flight(), ship = flight.ship;
    if (!service || !ship || this.execution) return;
    const nodes = this.plans.get(ship.id); if (!nodes?.length) return;
    nodes.sort((a, b) => a.time - b.time);
    const intents = nodes.map(node => this.intent(node));
    try {
      const anchor = this.anchors.get(ship.id);
      const candidate = !anchor || review ? service.capture(flight.world, ship, intents) : { ...anchor, nodes: intents };
      const plan = service.read({ format: 'space-sim-flight-plans/1', plans: [candidate] }).plans[0]!;
      if (review) this.needsReview.delete(ship.id);
      this.anchors.set(ship.id, plan);
      const editableNode=this.current?.valid?this.current:this.planEvaluation?.editableNode;
      this.cancelPlanEvaluation();this.chains.delete(ship.id);
      for(const node of nodes)if(!node.completed){node.valid=false;node.reason='Evaluating coast and SOI handoffs…';}
      if(service.evaluateAsync) {
        this.planEvaluation={job:service.evaluateAsync(plan,flight.world),plan,flight,nodes,review,editableNode};
        this.advancePlanEvaluation();
      }else this.finishPlanEvaluation(service.evaluate(plan,flight.world),plan,flight,nodes,review);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Plan could not be reviewed.';
      for (const node of nodes) if (!node.completed) { node.valid = false; node.reason = reason; }
      this.options.notify(reason);
    }
    this.preview.invalidate(); this.lastUi = -Infinity;
  }
  private cancelPlanEvaluation():void {
    const pending=this.planEvaluation;this.planEvaluation=undefined;
    pending?.job.return([]);
  }
  private advancePlanEvaluation():void {
    const pending=this.planEvaluation;if(!pending)return;
    const flight=this.options.flight();
    if(flight.world!==pending.flight.world||flight.ship?.id!==pending.plan.shipId||flight.ship.controls.engine) {
      this.cancelPlanEvaluation();return;
    }
    const start=performance.now();
    try {
      for(let count=0;count<128&&performance.now()-start<1;count++) {
        const step=pending.job.next();
        if(step.done){this.planEvaluation=undefined;this.finishPlanEvaluation(step.value,pending.plan,pending.flight,pending.nodes,pending.review);return;}
      }
    }catch(error){
      this.cancelPlanEvaluation();const reason=error instanceof Error?error.message:'Plan evaluation failed.';
      for(const node of pending.nodes)if(!node.completed){node.valid=false;node.reason=reason;}
    }
  }
  private finishPlanEvaluation(evaluated:readonly EvaluatedFlightNode[],plan:FlightPlan,flight:Flight,nodes:Node[],review:boolean):void {
    const service=this.services.plans!,ship=flight.ship!;
    const first=evaluated.find(result=>result.valid&&result.after);
    if(first?.after) {
      const world=flight.world,source=Object.create(world) as WorldRead;
      Object.defineProperties(source,{requiresWorldPrediction:{value:false},predictShip:{value:()=>service.predict(plan,world)}});
      this.chains.set(ship.id,{source,seed:first.after});
    }else this.chains.delete(ship.id);
    for(const [index,result] of evaluated.entries()) {
      const node=nodes[index]!;node.valid=result.valid&&!this.needsReview.has(ship.id);
      node.reason=this.needsReview.has(ship.id)&&!node.completed?'Review remaining nodes against actual flight.':result.reason;
      if(result.seed&&result.before){node.seed=result.seed;node.sample=result.before;node.context=flightMotion(flight);}
      if(review)this.alarmControls?.touch(node);
    }
    if(review)this.options.notify('Plan reviewed against current flight. Execute each node separately or fly it manually.');
    this.preview.invalidate();this.lastUi=-Infinity;
  }
  /** Validate the unchanged live root before any pending burn, even if that burn
   * belongs to a future body. An SOI change requires a fresh actual-flight review. */
  private rootSeed(node:Node):{state:State;bodyId:string} {
    const anchor=this.anchors.get(node.shipId);
    return anchor?{state:{...anchor.epoch,status:'flying',throttle:0,revision:0},bodyId:anchor.bodyId}:{state:node.seed,bodyId:node.bodyId};
  }
  private addNode(): void {
    const flight = this.options.flight(), ship = flight.ship, current = this.current;
    if (!this.services.plans || !ship || !current || this.execution) return;
    const nodes = this.plans.get(ship.id) ?? [current];
    if (nodes.length >= 16) { this.options.notify('A plan supports at most 16 nodes.'); return; }
    const last = nodes.at(-1)!;
    const node: Node = { ...last, id: `node-${this.nextNode++}`, label: `Maneuver ${nodes.length + 1}`,
      time: Math.max(flight.world.time + 20, last.time + 20), prograde: 0, radial: 0, completed: false, alarm:undefined, valid: true, reason: '' };
    nodes.push(node); this.plans.set(ship.id, nodes); this.nodes.set(ship.id, node); this.current = node;
    this.rebuildPlan(); this.refreshInputs();
  }
  private refreshPlanList(): void {
    const select = this.nodeSelect; if (!select) return;
    const nodes = this.current ? this.plans.get(this.current.shipId) ?? [this.current] : [];
    const key = nodes.map(node => `${node.id}/${node.time}/${node.completed}/${node.valid}`).join('|') + `/${Math.floor(this.options.flight().world.time)}`;
    if (select.dataset.key !== key) {
      select.replaceChildren(...nodes.map((node, index) => {
        const option = this.document.createElement('option'); option.value = node.id;
        option.textContent = `${index + 1}. ${node.label} · ${node.completed ? 'flown' : node.valid ? `T−${Math.max(0,node.time-this.options.flight().world.time).toFixed(1)} s` : 'review needed'}`;
        return option;
      })); select.dataset.key = key;
    }
    select.value = this.current?.id ?? ''; select.disabled = !!this.execution || !nodes.length;
    for (const name of ['add', 'review', 'flown']) {
      const button = this.window.body.querySelector<HTMLButtonElement>(`#${this.id}-${name}`);
      if (button) { if(name==='review')button.hidden=!this.needsReview.has(this.current?.shipId??'')&&!nodes.some(node=>!node.completed&&!node.valid); button.disabled = !!this.execution || !nodes.length || (name === 'add' && nodes.length >= 16) || (name === 'flown' && !!this.current?.completed); }
    }
  }
  savePlans(): FlightPlanArchive {
    const plans: FlightPlan[] = [];
    for (const [shipId, nodes] of this.plans) {
      const anchor = this.anchors.get(shipId); if (anchor) plans.push({ ...anchor, nodes: nodes.map(node => this.intent(node)) });
    }
    return { format: 'space-sim-flight-plans/1', plans };
  }
  loadPlans(raw: unknown): void {
    if (this.disposed) return;
    const service = this.services.plans, archive = raw === undefined ? undefined : service?.read(raw);
    if (raw !== undefined && !service) throw new Error('Shared flight plans are unavailable in this game.');
    this.cancelPlanEvaluation(); this.abortExecution(); this.stopWarp(); this.plans.clear(); this.anchors.clear(); this.chains.clear(); this.needsReview.clear(); this.nodes.clear(); this.current = undefined; this.preview.invalidate();
    const flight = this.options.flight(); this.world = flight.world;
    for (const plan of archive?.plans ?? []) this.insertPlan(plan, flight);
    this.current = flight.ship ? this.nodes.get(flight.ship.id) : undefined; if(this.current)this.showMode('node'); this.refreshInputs(); this.lastUi = -Infinity;
  }
  private insertPlan(plan: FlightPlan, flight: Flight): void {
      const ship = flight.world.ship(plan.shipId); if (!ship) return;
      this.anchors.set(ship.id, plan); this.needsReview.add(ship.id);
      const seed: State = { ...plan.epoch, throttle: 0, status: 'flying', revision: 0 };
      const nodes: Node[] = plan.nodes.map(intent => ({ ...intent, shipId: ship.id, context: flight.world.contextFor(ship), seed,
        sample: seed, valid: false, reason: intent.completed ? 'Marked flown.' : 'Loaded plan. Review remaining nodes against actual flight.' }));
      for (const node of nodes) { const match = /^node-(\d+)$/.exec(node.id); if (match) this.nextNode = Math.max(this.nextNode, Number(match[1]) + 1); }
      this.plans.set(ship.id, nodes); if (nodes[0]) this.nodes.set(ship.id, nodes[0]);
  }
  private showMode(mode:'node'|'transfers'):void {
    if(mode==='transfers'&&!this.services.transfers)mode='node';
    for(const kind of ['node','transfers'] as const){
      const selected=kind===mode,tab=this.window.body.querySelector<HTMLButtonElement>(`#${this.id}-${kind}-tab`)!;
      tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
      this.window.body.querySelector<HTMLElement>(`#${this.id}-${kind==='node'?'node-view':'transfers'}`)!.hidden=!selected;
    }
  }
  openTransfers():void {
    if(this.disposed||!this.services.transfers||!this.options.flight().enabled)return;
    this.showMode('transfers');this.transferControls?.update();this.window.open();this.window.body.querySelector<HTMLButtonElement>(`#${this.id}-transfers-tab`)!.focus({preventScroll:true});
  }
  private evaluate(seed: State, flight: Flight, time: number, body = flight.body): GhostSample | undefined {
    const context = flightMotion(flight), surface = flight.world.surface(body.id);
    const coast = seed.coast ?? context.keplerCoast(seed, body, surface);
    if (!coast) return undefined;
    const evaluated = context.coastAt(coast, time, body, surface, { cache: false });
    return evaluated.ok ? { time, ...evaluated.state } : undefined;
  }
  private prediction?: FlightPrediction;
  private inPrediction(time: number, flight: Flight): boolean {
    const path = this.prediction?.path, last = path?.at(-1);
    if (!path?.length || !last) return false;
    const encounter = path.find(p => p.encounter);
    if (encounter && time >= encounter.time) return false;
    const span = last.time - path[0]!.time;
    return time > flight.world.time && time <= (this.prediction?.pathEnd === 'closed' ? flight.world.time + span : last.time);
  }
  place(pointer: Vec, camera: Camera, origin: Vec, width: number, height: number, prediction: FlightPrediction): boolean {
    if (this.disposed) return false;
    const flight = this.options.flight(), ship = flight.ship;
    if (!flight.enabled || !ship || ship.state.status !== 'flying') return false;
    const time = pickManeuverTime(prediction.path, prediction.pathEnd === 'closed', ship.state.time, pointer, camera, origin, width, height);
    if (time === undefined) return false;
    if (!flightMotion(flight).capabilities.analyticCoast || flight.world.requiresWorldPrediction) {
      this.options.notify('Maneuver planning needs an unpowered Kepler coast in this world.'); return true;
    }
    if (prediction.path.some(p => p.encounter && p.time <= time)) {
      this.options.notify('Place this node before the first SOI encounter. Later-body nodes need a chained flight plan.'); return true;
    }
    const sample = this.evaluate(ship.state, flight, time);
    if (!sample) { this.options.notify('This point is beyond the safe analytic coast. Choose a point farther from the surface.'); return true; }
    this.prediction = prediction;
    const previous = this.nodes.get(ship.id);
    const node: Node = { id: previous?.id ?? `node-${this.nextNode++}`, label: previous?.label ?? 'Maneuver', shipId: ship.id, bodyId: ship.bodyId, context: flightMotion(flight),
      seed: structuredClone(ship.state), sample, time, prograde: previous?.prograde ?? 0, radial: previous?.radial ?? 0, alarm:previous?.alarm, valid: true, reason: '' };
    this.abortExecution(); this.stopWarp(); this.nodes.set(ship.id, node); this.current = node;
    const existing = this.plans.get(ship.id);
    this.plans.set(ship.id, existing?.length ? existing.map(value => value === previous ? node : value) : [node]);
    if (!previous || !this.waiting(node)) { this.anchors.delete(ship.id); this.needsReview.delete(ship.id); }
    this.rebuildPlan(); this.alarmControls?.touch(node); this.preview.invalidate();
    this.refreshInputs(); this.lastUi = -Infinity; this.showMode('node'); this.window.open();
    this.event('maneuver-node', { time, ship: ship.id });
    return true;
  }
  private edit(axis?:'prograde'|'radial'): void {
    const node = this.current;
    if (!node || (!node.valid && !this.services.plans) || node.completed || !this.prograde.validity.valid || !this.radial.validity.valid) return;
    const prograde = axis==='radial'?node.prograde:this.prograde.valueAsNumber, radial = axis==='prograde'?node.radial:this.radial.valueAsNumber;
    if (!Number.isFinite(prograde) || !Number.isFinite(radial)) return;
    this.abortExecution(); this.stopWarp(); node.prograde = prograde; node.radial = radial; this.rebuildPlan(); this.alarmControls?.touch(node); this.preview.invalidate(); this.lastUi = -Infinity;
  }
  private moveTime(time: number): boolean {
    const node = this.current, flight = this.options.flight();
    if (!node || (!node.valid && !this.services.plans) || node.completed || this.execution || !Number.isFinite(time) || (!this.services.plans && !this.inPrediction(time, flight))) return false;
    const sample = this.evaluate(node.seed, flight, time, flight.world.body(node.bodyId)); if (!sample && !this.services.plans) return false;
    this.stopWarp(); node.time = time; if(sample)node.sample = sample; this.rebuildPlan(); this.alarmControls?.touch(node); this.preview.invalidate(); this.refreshInputs(); this.lastUi = -Infinity;
    return true;
  }
  private refreshInputs(): void {
    this.refreshPlanList();
    this.alarmControls?.updateUi(this.current,!!this.execution);
    // Formatting is display only. Editing one component keeps the other intent
    // at full double precision; archives never store these rounded strings.
    const display=(value:number)=>Math.abs(value)<1e-9?'0':String(Number(value.toPrecision(8)));
    this.prograde.value = display(this.current?.prograde ?? 0); this.radial.value = display(this.current?.radial ?? 0);
    this.prograde.title=String(this.current?.prograde??0)+' m/s';this.radial.title=String(this.current?.radial??0)+' m/s';
    this.timing.value = this.current ? Math.max(0, this.current.time - this.options.flight().world.time).toFixed(1) : '';
  }
  private alarmDeadline(node:Node):number {
    const flight=this.options.flight(),ship=flight.world.ship(node.shipId);if(!ship)return NaN;
    const context=flight.world.contextFor(ship),delta=maneuverDelta(node.sample,node.prograde,node.radial);
    const magnitude=Math.hypot(delta.x,delta.y),half=context.vehicle.acceleration>0?magnitude/context.vehicle.acceleration/2:0;
    const angle=magnitude>0?Math.abs(dm.normalizeAngle(dm.atan2(delta.y,delta.x)-ship.state.heading)):0;
    const alignment=context.vehicle.turnRate>0?angle/context.vehicle.turnRate:0;
    return node.time-half-Math.max((node.alarm??DEFAULT_NODE_ALARM).leadSeconds,alignment+1);
  }
  private collectAlarms():readonly AlarmCandidate[] {
    const flight=this.options.flight(),world=flight.world;this.alarmCandidates.length=0;
    if(world!==this.world)return this.alarmCandidates;
    for(const [id,nodes] of this.plans){
      const root=nodes.find(node=>!node.completed),ship=world.ship(id);
      if(!root?.valid||this.needsReview.has(id)||!ship||ship.state.status!=='flying'||ship.controls.engine
        ||(id===flight.ship?.id&&this.alarmManualEngine)||ship.bodyId!==root.bodyId||world.contextFor(ship)!==root.context||ship.state.time<root.seed.time
        ||this.execution?.node===root&&this.execution.burn.phase==='burning')continue;
      const body=world.body(root.bodyId),surface=world.surface(body.id),context=root.context;
      const coast=root.seed.coast??context.keplerCoast(root.seed,body,surface);
      const solved=coast&&context.coastAt(coast,ship.state.time,body,surface,{cache:false});
      if(!solved?.ok||Math.hypot(solved.state.position.x-ship.state.position.x,solved.state.position.y-ship.state.position.y)>Math.max(.05,Math.hypot(ship.state.position.x,ship.state.position.y)*1e-8)
        ||Math.hypot(solved.state.velocity.x-ship.state.velocity.x,solved.state.velocity.y-ship.state.velocity.y)>.05)continue;
      let candidate=this.alarmCandidatePool.get(root);
      if(!candidate){candidate={node:root,deadline:0};this.alarmCandidatePool.set(root,candidate);}
      candidate.deadline=this.alarmDeadline(root);this.alarmCandidates.push(candidate);
    }
    return this.alarmCandidates;
  }
  /** Run before advancing the host so warped frames cannot cross the approach window. */
  beforeAdvance(controls: Controls): void {
    if(this.disposed)return;
    this.beforeManeuverAdvance(controls);
    // A manual ignition on this frame changes the root even before physics runs.
    this.alarmManualEngine=controls.engine;this.alarmControls?.beforeAdvance();
  }
  private beforeManeuverAdvance(controls: Controls): void {
    const flight = this.options.flight();
    if (this.execution && (controls.engine || controls.turn || controls.throttle || flight.paused || flight.inputBlocked
      || !flight.enabled || !flight.canWarp || flight.ship?.id !== this.execution.node.shipId || flight.world !== this.world
      || flight.ship.bodyId !== this.execution.node.bodyId || flight.ship.state.status !== 'flying'
      || flight.ship.state.throttle !== (this.execution.expected?.throttle ?? this.execution.initialThrottle)
      || flight.requestedWarp !== (this.warping ? this.lastRequest : 1))) this.abortExecution('Autonomous burn aborted.');
    if (!this.warping) return;
    const node = this.current;
    if (!node?.valid || flight.world !== this.world || !flight.enabled || !flight.canWarp || flight.paused || flight.inputBlocked || flight.ship?.id !== node.shipId
      || flight.ship.bodyId !== node.bodyId || flight.ship.state.status !== 'flying' || flight.ship.state.time < node.seed.time
      || controls.engine || controls.turn || controls.throttle || flight.requestedWarp !== this.lastRequest) { this.stopWarp(); return; }
    const dv = maneuverDelta(node.sample, node.prograde, node.radial), duration = Math.hypot(dv.x, dv.y) / flightMotion(flight).vehicle.acceleration;
    const lead = this.execution ? Math.max(10, this.alignmentSeconds(flight, dv) + 1) : 10;
    const remaining = node.time - flight.world.time - lead - (Number.isFinite(duration) ? duration / 2 : 0);
    const factor = maneuverWarpFactor(remaining, this.services.motion.clampWarpFactor);
    if (factor === 1) { this.stopWarp(); if (!this.execution && (!this.alarmControls || this.current?.alarm?.enabled===false)) this.options.notify('Approaching the maneuver node. Warp stopped; engine remains under your control.'); return; }
    if (factor !== flight.requestedWarp) this.options.setWarp(factor);
    this.lastRequest = this.options.flight().requestedWarp;
    if (this.options.flight().warp === 1) { this.abortExecution('Autonomous burn aborted: warp unavailable.'); this.stopWarp(); }
  }
  update(seconds: number, prediction: FlightPrediction, engine: boolean): void {
    if (this.disposed) return;
    const flight = this.options.flight(), ship = flight.ship;
    this.prediction = prediction;
    if (flight.world !== this.world) { this.cancelPlanEvaluation(); this.abortExecution(); this.stopWarp(); this.world = flight.world; this.plans.clear(); this.anchors.clear(); this.chains.clear(); this.needsReview.clear(); this.nodes.clear(); this.current = undefined; this.preview.invalidate(); }
    const node = ship && this.nodes.get(ship.id);
    if (node !== this.current) { this.abortExecution(); this.stopWarp(); this.current = node; this.preview.invalidate(); this.refreshInputs(); this.lastUi = -Infinity; }
    if (node?.valid && ship && this.execution?.burn.phase !== 'burning') {
      const root = this.plans.get(ship.id)?.find(value => !value.completed) ?? node;
      const rootSeed=this.rootSeed(root);
      const expected = rootSeed.bodyId === ship.bodyId && root.context === flightMotion(flight) ? this.evaluate(rootSeed.state, flight, ship.state.time) : undefined;
      if (!expected || engine || ship.state.status !== 'flying' || ship.state.time < rootSeed.state.time
        || Math.hypot(expected.position.x-ship.state.position.x, expected.position.y-ship.state.position.y) > Math.max(.05, Math.hypot(ship.state.position.x, ship.state.position.y)*1e-8)
        || Math.hypot(expected.velocity.x-ship.state.velocity.x, expected.velocity.y-ship.state.velocity.y) > .05) {
        root.valid = false; root.reason = 'Trajectory changed. Review remaining nodes or click the coast line to replan.'; this.invalidateLater(root); node.valid = false; node.reason = root.reason; this.abortExecution(); this.stopWarp(); this.preview.invalidate(); this.lastUi = -Infinity;
      } else if (ship.state.time > root.time + 1) {
        root.valid = false; root.reason = 'Node passed. Mark it flown or delete it, then review remaining nodes.'; this.invalidateLater(root); node.valid = false; node.reason = root.reason; this.abortExecution(); this.stopWarp(); this.preview.invalidate(); this.lastUi = -Infinity;
      }
      if (node.valid && flight.enabled) {
        const dv = maneuverDelta(node.sample, node.prograde, node.radial);
        const chain = this.chains.get(ship.id);
        if (chain) this.preview.update(flightMotion(flight), chain.seed, flight.body, flight.world.surface(flight.body.id), ship.id, Math.max(seconds, .1), false, undefined, chain.source);
        else if (Math.hypot(dv.x, dv.y) > 0) this.preview.update(flightMotion(flight),
          { ...node.seed, ...node.sample, coast: undefined, contact: undefined, waterEntry: undefined,
            velocity: { x: node.sample.velocity.x + dv.x, y: node.sample.velocity.y + dv.y }, revision: node.seed.revision + 1 },
          flight.body, flight.world.surface(flight.body.id), ship.id, Math.max(seconds, .1), false);
      }
    }
    if (!flight.enabled) { this.abortExecution(); this.stopWarp(); this.preview.invalidate(); this.window.close(); }
    this.advancePlanEvaluation();
    this.transferControls?.update();
    this.map?.update();
    if (performance.now() - this.lastUi > (this.tuning.uiRefreshMs ?? 100)) { this.lastUi = performance.now(); this.updateUi(flight); }
  }
  private nodePosition(node:Node,flight=this.options.flight()):Vec {
    return flightSampleInFrame({...node.sample,frameId:node.bodyId,bodyId:node.bodyId},flight.body.id,flight.world.system).position;
  }
  snapshot(): ManeuverPreview | undefined {
    if (this.disposed) return undefined;
    const node = this.current, flight = this.options.flight();
    if (!node || !flight.enabled) return undefined;
    const deltaVelocity = maneuverDelta(node.sample, node.prograde, node.radial), acceleration = flightMotion(flight).vehicle.acceleration;
    const inFrame=(value:Node)=>this.nodePosition(value,flight);
    const throttle=flight.ship?.state.throttle??0,thrust=acceleration*throttle;
    return { nodes: (this.plans.get(node.shipId) ?? []).map(value => {
      const deltaVelocity=maneuverDelta(value.sample,value.prograde,value.radial),dv=Math.hypot(deltaVelocity.x,deltaVelocity.y);
      return {id:value.id,time:value.time,position:inFrame(value),label:value.label,selected:value===node,valid:value.valid,deltaVelocity,
        throttleBurnSeconds:dv===0?0:thrust>0?dv/thrust:null};
    }),
      time: node.time, position: inFrame(node), deltaVelocity, valid: node.valid,
      burnSeconds: acceleration > 0 ? Math.hypot(deltaVelocity.x, deltaVelocity.y)/acceleration : 0,
      throttle,throttleBurnSeconds:Math.hypot(deltaVelocity.x,deltaVelocity.y)===0?0:thrust>0?Math.hypot(deltaVelocity.x,deltaVelocity.y)/thrust:null,
      ...(this.execution?.node===node?{remainingDeltaV:this.execution.burn.remaining}:{}),path: this.preview.path };
  }
  diagnostics(): Record<string, unknown> | null {
    if (this.disposed) return null;
    const node = this.current, snapshot = this.snapshot();
    return node ? { time: node.time, position: node.sample.position, prograde: node.prograde, radial: node.radial,
      nodes: this.plans.get(node.shipId)?.length ?? 1, selected: node.id, completed: !!node.completed,
      valid: node.valid, samples: this.preview.path.length, end: this.preview.pathEnd, deltaVelocity: snapshot?.deltaVelocity, warping: this.warping,
      execution: this.execution ? this.warping ? 'warping' : this.execution.burn.phase : null, remaining: this.execution?.burn.remaining } : null;
  }
  private updateUi(flight: Flight): void {
    const node = this.current, plan = this.snapshot(), dv = plan ? Math.hypot(plan.deltaVelocity.x, plan.deltaVelocity.y) : 0;
    const write = (element: HTMLElement, value: string): void => { if (element.textContent !== value) element.textContent = value; };
    write(this.status, node ? node.valid ? `${this.waiting(node)?'Earlier burn pending · preview only · ':''}T${node.time >= flight.world.time ? '−' : '+'}${Math.abs(node.time - flight.world.time).toFixed(1)} s · ${this.execution ? this.warping ? 'auto warp' : `${this.execution.burn.phase} · ${this.execution.burn.remaining.toFixed(2)} m/s remaining` : this.warping ? 'coasting to node' : dv > 0 ? 'manual burn' : 'coast node'}` : node.reason
      : 'No node. Choose a point on your coast trajectory.');
    this.refreshPlanList();
    this.alarmControls?.updateUi(node,!!this.execution);
    write(this.summary, node ? `${flight.world.hasBody(node.bodyId)?flight.world.body(node.bodyId).name+' · ':''}Δv ${dv.toFixed(1)} m/s\n${plan?.throttleBurnSeconds==null?'No thrust at current setting':`Burn ≈ ${plan.throttleBurnSeconds.toFixed(1)} s at ${((plan.throttle??0)*100).toFixed(0)}% throttle`} · ${flightMotion(flight).vehicle.acceleration > 0 ? `full ≈ ${plan?.burnSeconds.toFixed(1) ?? '0'} s` : 'No engine thrust available'}` : '');
    write(this.result, node?.valid && dv > 0 ? `${this.preview.text(node.seed)} · impulsive estimate` : '');
    if (this.document.activeElement !== this.timing) this.timing.value = node ? Math.max(0, node.time-flight.world.time).toFixed(1) : '';
    for (const input of [this.prograde, this.radial, this.timing]) input.disabled = !node || (!node.valid && !this.services.plans) || !!node.completed || !!this.execution;
    this.executeButton.disabled = node?.bodyId !== flight.body.id || !!this.execution || !!node && this.waiting(node) || !node?.valid || !flight.canWarp || flight.paused || flight.inputBlocked || !plan || dv === 0
      || flightMotion(flight).vehicle.acceleration <= 0 || node.time - plan.burnSeconds / 2 - flight.world.time < this.alignmentSeconds(flight, plan.deltaVelocity) + .2;
    this.executeButton.title = !flight.canWarp ? 'Autonomous execution is available on the host' : 'Warp, align, burn and cut off automatically; needs time to align before burn start';
    this.abortButton.hidden = !this.execution;
    this.window.body.querySelector<HTMLElement>(`#${this.id}-live-controls`)!.hidden=!this.execution&&!this.warping;
    this.warpButton.disabled = node?.bodyId !== flight.body.id || !!this.execution || !!node && this.waiting(node) || this.warping || !node?.valid || !flight.canWarp || flight.paused || flight.inputBlocked || !plan
      || node.time - flight.world.time <= 10 + plan.burnSeconds/2;
    this.warpButton.title = !flight.canWarp ? 'Only the host controls time warp' : 'Stops 10 seconds plus half the estimated burn duration before the node';
    this.cancelWarp.hidden = !this.warping || !!this.execution;
    for (const button of this.window.body.querySelectorAll<HTMLButtonElement>('[data-adjust], [data-time], [id$="-clear"]')) button.disabled = !node?.valid || !!this.execution;
  }
}
