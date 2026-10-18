import type { WorldRead } from '../../../packages/game-api/src/index';
import type { Camera, Controls, GhostSample, ManeuverPreview, ResolvedBody, SimulationContext, State, Vec } from '../../../packages/game-api/src/index';
import type { Ship } from '../../../packages/sim-core/src/world';
import { clampWarpFactor } from '../../../packages/sim-core/src/warp';
import { maneuverDelta } from '../../../packages/modules/src/base/toolset/maneuver-planner';
import { createProjector, hermiteControls } from '../../../packages/render-2d/src/frame';
import { FloatingWindow } from './floating-window';
import { Prediction } from './prediction';
import type { Workspace } from './workspace';
import { ManeuverBurn } from './maneuver-burn';
import { IDLE, STEP } from '../../../packages/sim-core/src/constants';
import { deterministicMath as dm } from '../../../packages/game-api/src/index';

/** Hit the rendered cubic, rather than sparse sample vertices or their straight chords.
 * Closed previews retain an old epoch; roll a selected phase forward to its next passage. */
export function pickManeuverTime(path: readonly GhostSample[], closed: boolean, now: number, pointer: Vec,
  camera: Camera, origin: Vec, width: number, height: number, tolerance = 10): number | undefined {
  const project = createProjector(camera, width, height);
  const at = (p: Vec): Vec => project({ x: origin.x + p.x, y: origin.y + p.y });
  const period = closed && path.length > 1 ? path.at(-1)!.time - path[0]!.time : 0;
  let best = tolerance * tolerance, picked: number | undefined;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
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
export function maneuverWarpFactor(remaining: number): number {
  return remaining <= .25 ? 1 : clampWarpFactor(Math.min(10_000, remaining / .2));
}

interface Node {
  readonly shipId: string;
  readonly bodyId: string;
  readonly context: SimulationContext;
  readonly seed: State;
  time: number;
  sample: GhostSample;
  prograde: number;
  radial: number;
  valid: boolean;
  reason: string;
}
interface Flight {
  readonly world: WorldRead;
  readonly ship?: Ship;
  readonly body: ResolvedBody;
  readonly enabled: boolean;
  readonly canWarp: boolean;
  readonly paused: boolean;
  readonly inputBlocked: boolean;
  readonly warp: number;
  readonly requestedWarp: number;
}
interface PlannerOptions {
  readonly flight: () => Flight;
  readonly setWarp: (factor: number) => void;
  readonly setThrottle: (shipId: string, throttle: number) => void;
  readonly releaseControls: (shipId: string) => void;
  readonly notify: (text: string) => void;
  readonly event: (kind: string, detail: Record<string, unknown>) => void;
}

/** Local plans and opt-in host burn execution through normal session controls.
 * Preview contexts and node state stay outside world saves and fingerprints. */
export class ManeuverPlanner {
  private readonly window: FloatingWindow;
  private readonly preview = new Prediction(pass => this.options.event('maneuver-preview', pass));
  private readonly nodes = new Map<string, Node>();
  private world?: WorldRead;
  private current?: Node;
  private readonly prograde: HTMLInputElement;
  private readonly radial: HTMLInputElement;
  private readonly timing: HTMLInputElement;
  private readonly status: HTMLOutputElement;
  private readonly summary: HTMLOutputElement;
  private readonly result: HTMLOutputElement;
  private readonly warpButton: HTMLButtonElement;
  private readonly cancelWarp: HTMLButtonElement;
  private readonly executeButton: HTMLButtonElement;
  private readonly abortButton: HTMLButtonElement;
  private execution?: { node: Node; burn: ManeuverBurn; initialThrottle: number; expected?: State };
  private warping = false;
  private lastRequest = 1;
  private lastUi = -Infinity;

  get executing(): boolean { return !!this.execution; }

  /** Release controls while the current session still owns the execution's ship. */
  cancel(): void { this.abortExecution(); this.stopWarp(); }

  constructor(workspace: Workspace, private readonly options: PlannerOptions) {
    this.preview.maxMs = 1;
    this.window = new FloatingWindow({ id: 'maneuver', title: 'Maneuver', icon: 'trajectory', pinned: true,
      container: document.querySelector<HTMLElement>('#flight-console .viewport')!,
      place: () => ({ x: 24, y: 100 }), className: 'maneuver-window' });
    this.window.body.innerHTML = `
      <p class="maneuver-help">Click or tap the coast line to place a node. Click elsewhere on the line to move it.</p>
      <output id="maneuver-status" aria-live="polite">No node. Choose a point on your coast trajectory.</output>
      <div class="maneuver-fields">
        <label>Burn in (s)<input id="maneuver-time" type="number" min="0.1" step="any" inputmode="decimal"></label>
        <label>Prograde Δv (m/s)<input id="maneuver-prograde" type="number" step="any" min="-1000000" max="1000000" value="0" inputmode="decimal"></label>
        <div class="maneuver-adjust"><button type="button" data-adjust="prograde/-1">− Retrograde</button><button type="button" data-adjust="prograde/1">+ Prograde</button></div>
        <label>Radial Δv (m/s)<input id="maneuver-radial" type="number" step="any" min="-1000000" max="1000000" value="0" inputmode="decimal"></label>
        <div class="maneuver-adjust"><button type="button" data-adjust="radial/-1">− In</button><button type="button" data-adjust="radial/1">+ Out</button></div>
      </div>
      <output id="maneuver-summary"></output><output id="maneuver-result"></output>
      <div class="maneuver-adjust"><button id="maneuver-execute" type="button">Execute burn</button><button id="maneuver-abort" type="button" hidden>Abort burn</button><button id="maneuver-warp" type="button">Warp to burn</button><button id="maneuver-stop" type="button" hidden>Stop warp</button><button id="maneuver-delete" type="button">Delete node</button></div>
      <details class="panel-note"><summary>Flying the plan</summary><p class="maneuver-help">Execute burn handles warp, alignment, thrust and cutoff for the selected node (host only). Manual flight input or Abort burn takes over. Warp to burn leaves firing to you. The dashed line assumes an instant burn; finite burns can differ. Plans last for this flight session.</p></details>`;
    const get = <T extends HTMLElement>(id: string): T => this.window.body.querySelector<T>(`#maneuver-${id}`)!;
    this.prograde = get('prograde'); this.radial = get('radial'); this.timing = get('time');
    this.status = get('status'); this.summary = get('summary'); this.result = get('result');
    this.warpButton = get('warp'); this.cancelWarp = get('stop');
    this.executeButton = get('execute'); this.abortButton = get('abort');
    for (const input of [this.prograde, this.radial]) input.addEventListener('input', () => this.edit());
    this.timing.addEventListener('change', () => {
      const node = this.current, flight = this.options.flight(), seconds = this.timing.valueAsNumber;
      if (!node || !node.valid || !Number.isFinite(seconds) || seconds < .1) { this.refreshInputs(); return; }
      const sample = this.evaluate(node.seed, flight, flight.world.time + seconds);
      if (!sample || !this.inPrediction(sample.time, flight)) {
        this.options.notify('Choose a time within the visible coast prediction.'); this.refreshInputs(); return;
      }
      this.abortExecution(); this.stopWarp(); node.time = sample.time; node.sample = sample; this.preview.invalidate(); this.lastUi = -Infinity;
    });
    this.window.body.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-adjust]');
      if (!button || !this.current?.valid) return;
      const [axis, sign] = button.dataset.adjust!.split('/'), input = axis === 'prograde' ? this.prograde : this.radial;
      input.value = String((input.valueAsNumber || 0) + Number(sign) * ((event as MouseEvent).shiftKey ? 10 : 1));
      this.edit();
    });
    get('delete').addEventListener('click', () => {
      this.abortExecution();
      if (this.current) this.nodes.delete(this.current.shipId);
      this.stopWarp(); this.current = undefined; this.preview.invalidate(); this.lastUi = -Infinity;
    });
    this.warpButton.addEventListener('click', () => {
      this.abortExecution();
      const flight = this.options.flight();
      if (this.current?.valid && flight.canWarp && !flight.paused) {
        this.warping = true; this.lastRequest = flight.requestedWarp;
      }
    });
    this.cancelWarp.addEventListener('click', () => this.stopWarp());
    this.executeButton.addEventListener('click', () => this.execute());
    this.abortButton.addEventListener('click', () => this.abortExecution('Autonomous burn aborted.'));
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.abortExecution('Autonomous burn aborted: tab hidden.'); this.stopWarp(); } });
    workspace.addInstrument(this.window, 'Maneuver', 'Plan a burn by clicking the coast trajectory');
  }

  private stopWarp(): void {
    if (this.warping) { this.warping = false; this.options.setWarp(1); }
  }
  private abortExecution(reason?: string): void {
    const execution = this.execution;
    if (!execution) return;
    this.execution = undefined; this.stopWarp(); this.options.setWarp(1);
    this.options.releaseControls(execution.node.shipId);
    if (execution.burn.phase === 'burning') {
      execution.node.valid = false; execution.node.reason = `${reason ?? 'Burn interrupted.'} Click the coast line to replan.`;
      this.preview.invalidate();
    }
    this.lastUi = -Infinity;
    if (reason) this.options.notify(reason);
  }
  private alignmentSeconds(flight: Flight, delta: Vec): number {
    const error = Math.abs(dm.normalizeAngle(dm.atan2(delta.y, delta.x) - (flight.ship?.state.heading ?? 0)));
    return error < 1e-7 ? 0 : flight.world.context.vehicle.turnRate > 0 ? error / flight.world.context.vehicle.turnRate : Infinity;
  }
  private execute(): void {
    const node = this.current, flight = this.options.flight(), plan = this.snapshot();
    if (!node?.valid || !plan || !flight.canWarp || flight.paused || flight.inputBlocked || !flight.enabled || this.execution
      || flight.ship?.id !== node.shipId || flight.ship.state.status !== 'flying' || !(plan.burnSeconds > 0)
      || node.time - plan.burnSeconds / 2 - flight.world.time < this.alignmentSeconds(flight, plan.deltaVelocity) + .2) return;
    this.stopWarp();
    this.execution = { node, burn: new ManeuverBurn(node.time, plan.deltaVelocity, flight.world.context.vehicle), initialThrottle: flight.ship.state.throttle };
    this.warping = true; this.lastRequest = flight.requestedWarp; this.lastUi = -Infinity;
    this.options.event('maneuver-execute', { ship: node.shipId, time: node.time });
  }
  /** Called by LocalSession before each 10 ms step, after beforeAdvance checked pilot
   * input. Revalidates identity and the expected last step before commanding thrust. */
  step(manual: Controls): Controls {
    const execution = this.execution;
    if (!execution || this.warping) return manual;
    const flight = this.options.flight(), ship = flight.ship, { node, burn } = execution;
    if (!ship || ship.id !== node.shipId || ship.bodyId !== node.bodyId || flight.world !== this.world
      || flight.world.context !== node.context || !flight.enabled || flight.paused || flight.inputBlocked
      || ship.state.status !== 'flying' || ship.fault || flight.requestedWarp !== 1 || !node.valid) {
      this.abortExecution('Autonomous burn aborted: flight conditions changed.'); return IDLE;
    }
    const expected = execution.expected;
    if (expected && (Math.abs(ship.state.time - expected.time) > 1e-7
      || Math.hypot(ship.state.position.x - expected.position.x, ship.state.position.y - expected.position.y) > .001
      || Math.hypot(ship.state.velocity.x - expected.velocity.x, ship.state.velocity.y - expected.velocity.y) > 1e-5
      || ship.state.heading !== expected.heading || ship.state.throttle !== expected.throttle)) {
      this.abortExecution('Autonomous burn aborted: trajectory or throttle changed.'); return IDLE;
    }
    try {
      const command = burn.next(ship.state);
      if (command.throttle !== undefined && command.throttle !== ship.state.throttle) this.options.setThrottle(ship.id, command.throttle);
      if (burn.phase === 'complete') {
        this.execution = undefined; node.valid = false; node.reason = 'Burn complete. Click the coast line to plan the next maneuver.';
        this.preview.invalidate(); this.lastUi = -Infinity;
        this.options.notify('Maneuver complete. Engine off.'); this.options.event('maneuver-complete', { ship: ship.id, remaining: burn.remaining });
        return IDLE;
      }
      execution.expected = flight.world.context.advance(this.options.flight().ship!.state, command.controls, STEP,
        flight.body, flight.world.surface(flight.body.id));
      return command.controls;
    } catch (error) {
      this.abortExecution(error instanceof Error ? error.message : 'Autonomous burn aborted.'); return IDLE;
    }
  }
  private evaluate(seed: State, flight: Flight, time: number): GhostSample | undefined {
    const context = flight.world.context, surface = flight.world.surface(flight.body.id);
    const coast = seed.coast ?? context.keplerCoast(seed, flight.body, surface);
    if (!coast) return undefined;
    const evaluated = context.coastAt(coast, time, flight.body, surface, { cache: false });
    return evaluated.ok ? { time, ...evaluated.state } : undefined;
  }
  private prediction?: Prediction;
  private inPrediction(time: number, flight: Flight): boolean {
    const path = this.prediction?.path, last = path?.at(-1);
    if (!path?.length || !last) return false;
    const span = last.time - path[0]!.time;
    return time > flight.world.time && time <= (this.prediction?.pathEnd === 'closed' ? flight.world.time + span : last.time);
  }
  place(pointer: Vec, camera: Camera, origin: Vec, width: number, height: number, prediction: Prediction): boolean {
    const flight = this.options.flight(), ship = flight.ship;
    if (!flight.enabled || !ship || ship.state.status !== 'flying') return false;
    const time = pickManeuverTime(prediction.path, prediction.pathEnd === 'closed', ship.state.time, pointer, camera, origin, width, height);
    if (time === undefined) return false;
    if (!flight.world.context.capabilities.analyticCoast || flight.world.requiresWorldPrediction) {
      this.options.notify('Maneuver planning needs an unpowered Kepler coast in this world.'); return true;
    }
    const sample = this.evaluate(ship.state, flight, time);
    if (!sample) { this.options.notify('This point is beyond the safe analytic coast. Choose a point farther from the surface.'); return true; }
    this.prediction = prediction;
    const previous = this.nodes.get(ship.id);
    const node: Node = { shipId: ship.id, bodyId: ship.bodyId, context: flight.world.context,
      seed: structuredClone(ship.state), sample, time, prograde: previous?.prograde ?? 0, radial: previous?.radial ?? 0, valid: true, reason: '' };
    this.abortExecution(); this.stopWarp(); this.nodes.set(ship.id, node); this.current = node; this.preview.invalidate();
    this.refreshInputs(); this.lastUi = -Infinity; this.window.open();
    this.options.event('maneuver-node', { time, ship: ship.id });
    return true;
  }
  private edit(): void {
    const node = this.current;
    if (!node?.valid || !this.prograde.validity.valid || !this.radial.validity.valid) return;
    const prograde = this.prograde.valueAsNumber, radial = this.radial.valueAsNumber;
    if (!Number.isFinite(prograde) || !Number.isFinite(radial)) return;
    this.abortExecution(); this.stopWarp(); node.prograde = prograde; node.radial = radial; this.preview.invalidate(); this.lastUi = -Infinity;
  }
  private refreshInputs(): void {
    this.prograde.value = String(this.current?.prograde ?? 0); this.radial.value = String(this.current?.radial ?? 0);
    this.timing.value = this.current ? Math.max(0, this.current.time - this.options.flight().world.time).toFixed(1) : '';
  }
  /** Run before advancing the host so warped frames cannot cross the approach window. */
  beforeAdvance(controls: Controls): void {
    const flight = this.options.flight();
    if (this.execution && (controls.engine || controls.turn || controls.throttle || flight.paused || flight.inputBlocked
      || !flight.enabled || !flight.canWarp || flight.ship?.id !== this.execution.node.shipId || flight.world !== this.world
      || flight.ship.bodyId !== this.execution.node.bodyId || flight.ship.state.status !== 'flying'
      || flight.ship.state.throttle !== (this.execution.expected?.throttle ?? this.execution.initialThrottle)
      || flight.requestedWarp !== (this.warping ? this.lastRequest : 1))) this.abortExecution('Autonomous burn aborted.');
    if (!this.warping) return;
    const node = this.current;
    if (!node?.valid || flight.world !== this.world || !flight.enabled || !flight.canWarp || flight.paused || flight.ship?.id !== node.shipId
      || flight.ship.bodyId !== node.bodyId || flight.ship.state.status !== 'flying' || flight.ship.state.time < node.seed.time
      || controls.engine || controls.turn || controls.throttle || flight.requestedWarp !== this.lastRequest) { this.stopWarp(); return; }
    const dv = maneuverDelta(node.sample, node.prograde, node.radial), duration = Math.hypot(dv.x, dv.y) / flight.world.context.vehicle.acceleration;
    const lead = this.execution ? Math.max(10, this.alignmentSeconds(flight, dv) + 1) : 10;
    const remaining = node.time - flight.world.time - lead - (Number.isFinite(duration) ? duration / 2 : 0);
    const factor = maneuverWarpFactor(remaining);
    if (factor === 1) { this.stopWarp(); if (!this.execution) this.options.notify('Approaching the burn. Align with the amber diamond and fire manually.'); return; }
    if (factor !== flight.requestedWarp) this.options.setWarp(factor);
    this.lastRequest = this.options.flight().requestedWarp;
    if (this.options.flight().warp === 1) { this.abortExecution('Autonomous burn aborted: warp unavailable.'); this.stopWarp(); }
  }
  update(seconds: number, prediction: Prediction, engine: boolean): void {
    const flight = this.options.flight(), ship = flight.ship;
    this.prediction = prediction;
    if (flight.world !== this.world) { this.abortExecution(); this.stopWarp(); this.world = flight.world; this.nodes.clear(); this.current = undefined; this.preview.invalidate(); }
    const node = ship && this.nodes.get(ship.id);
    if (node !== this.current) { this.abortExecution(); this.stopWarp(); this.current = node; this.preview.invalidate(); this.refreshInputs(); this.lastUi = -Infinity; }
    if (node?.valid && ship && this.execution?.burn.phase !== 'burning') {
      const expected = node.bodyId === ship.bodyId && node.context === flight.world.context ? this.evaluate(node.seed, flight, ship.state.time) : undefined;
      if (!expected || engine || ship.state.status !== 'flying' || ship.state.time < node.seed.time
        || Math.hypot(expected.position.x-ship.state.position.x, expected.position.y-ship.state.position.y) > Math.max(.05, Math.hypot(ship.state.position.x, ship.state.position.y)*1e-8)
        || Math.hypot(expected.velocity.x-ship.state.velocity.x, expected.velocity.y-ship.state.velocity.y) > .05) {
        node.valid = false; node.reason = 'Trajectory changed. Click the coast line to replan.'; this.abortExecution(); this.stopWarp(); this.preview.invalidate(); this.lastUi = -Infinity;
      } else if (ship.state.time > node.time + 1) {
        node.valid = false; node.reason = 'Node passed. Click the coast line to plan the next burn.'; this.abortExecution(); this.stopWarp(); this.preview.invalidate(); this.lastUi = -Infinity;
      }
      if (node.valid && flight.enabled) {
        const dv = maneuverDelta(node.sample, node.prograde, node.radial);
        if (Math.hypot(dv.x, dv.y) > 0) this.preview.update(flight.world.context,
          { ...node.seed, ...node.sample, coast: undefined, contact: undefined, waterEntry: undefined,
            velocity: { x: node.sample.velocity.x + dv.x, y: node.sample.velocity.y + dv.y }, revision: node.seed.revision + 1 },
          flight.body, flight.world.surface(flight.body.id), ship.id, Math.max(seconds, .1), false);
      }
    }
    if (!flight.enabled) { this.abortExecution(); this.stopWarp(); this.preview.invalidate(); this.window.close(); }
    if (performance.now() - this.lastUi > 100) { this.lastUi = performance.now(); this.updateUi(flight); }
  }
  snapshot(): ManeuverPreview | undefined {
    const node = this.current, flight = this.options.flight();
    if (!node || !flight.enabled || node.bodyId !== flight.body.id) return undefined;
    const deltaVelocity = maneuverDelta(node.sample, node.prograde, node.radial), acceleration = flight.world.context.vehicle.acceleration;
    return { time: node.time, position: node.sample.position, deltaVelocity, valid: node.valid,
      burnSeconds: acceleration > 0 ? Math.hypot(deltaVelocity.x, deltaVelocity.y)/acceleration : 0, path: this.preview.path };
  }
  diagnostics(): Record<string, unknown> | null {
    const node = this.current, snapshot = this.snapshot();
    return node ? { time: node.time, position: node.sample.position, prograde: node.prograde, radial: node.radial,
      valid: node.valid, samples: this.preview.path.length, end: this.preview.pathEnd, deltaVelocity: snapshot?.deltaVelocity, warping: this.warping,
      execution: this.execution ? this.warping ? 'warping' : this.execution.burn.phase : null, remaining: this.execution?.burn.remaining } : null;
  }
  private updateUi(flight: Flight): void {
    const node = this.current, plan = this.snapshot(), dv = plan ? Math.hypot(plan.deltaVelocity.x, plan.deltaVelocity.y) : 0;
    const write = (element: HTMLElement, value: string): void => { if (element.textContent !== value) element.textContent = value; };
    write(this.status, node ? node.valid ? `T${node.time >= flight.world.time ? '−' : '+'}${Math.abs(node.time - flight.world.time).toFixed(1)} s · ${this.execution ? this.warping ? 'auto warp' : `${this.execution.burn.phase} · ${this.execution.burn.remaining.toFixed(2)} m/s remaining` : 'manual burn'}` : node.reason
      : 'No node. Choose a point on your coast trajectory.');
    write(this.summary, node ? `Δv ${dv.toFixed(1)} m/s · ${flight.world.context.vehicle.acceleration > 0 ? `Full-throttle burn ≈ ${plan?.burnSeconds.toFixed(1) ?? '0'} s` : 'No engine thrust available'}` : '');
    write(this.result, node?.valid && dv > 0 ? `${this.preview.text(node.seed)} · active body only` : '');
    if (document.activeElement !== this.timing) this.timing.value = node ? Math.max(0, node.time-flight.world.time).toFixed(1) : '';
    for (const input of [this.prograde, this.radial, this.timing]) input.disabled = !node?.valid || !!this.execution;
    this.executeButton.disabled = !!this.execution || !node?.valid || !flight.canWarp || flight.paused || flight.inputBlocked || !plan || dv === 0
      || flight.world.context.vehicle.acceleration <= 0 || node.time - plan.burnSeconds / 2 - flight.world.time < this.alignmentSeconds(flight, plan.deltaVelocity) + .2;
    this.executeButton.title = !flight.canWarp ? 'Autonomous execution is available on the host' : 'Warp, align, burn and cut off automatically; needs time to align before burn start';
    this.abortButton.hidden = !this.execution;
    this.warpButton.disabled = !!this.execution || !node?.valid || !flight.canWarp || flight.paused || !plan || dv === 0 || flight.world.context.vehicle.acceleration <= 0
      || node.time - flight.world.time <= 10 + plan.burnSeconds/2;
    this.warpButton.title = !flight.canWarp ? 'Only the host controls time warp' : 'Stops 10 seconds plus half the estimated burn duration before the node';
    this.cancelWarp.hidden = !this.warping || !!this.execution;
    for (const button of this.window.body.querySelectorAll<HTMLButtonElement>('[data-adjust]')) button.disabled = !node?.valid || !!this.execution;
  }
}
