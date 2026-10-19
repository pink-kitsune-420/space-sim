import { deterministicMath as dm, maneuverDelta, type Controls, type EvaluatedFlightNode, type FlightPlan, type FlightPlanNode, type FlightPlanProgress, type FlightPlanService, type ManeuverBurnControl, type ManeuverBurnFactory, type ManeuverPlannerOptions, type State, type WorldRead, type Ship,type ClockService, type CoreMotion } from '@space-sim/game-api';
import {findEncounter,prepareArrival,type EncounterResult,type ArrivalResult} from './encounter';

interface Run {
 readonly shipId: string;
 readonly world: WorldRead;
 readonly once: boolean;
 readonly permissionId: string;
 autoWarp: boolean;
 prepareAt?: number;
 preparing?: boolean;
 bodyId?: string;
 root?: State;
 plan?: FlightPlan;
 job?: Generator<FlightPlanProgress, readonly EvaluatedFlightNode[]>;
 encounterJob?:Generator<void,EncounterResult>;
 arrivalJob?:Generator<void,ArrivalResult>;
 encounter?:{time:number;bodyId:string};
 awaitingBody?:string;
 enteredBody?:string;
 node?: EvaluatedFlightNode;
 burn?: ManeuverBurnControl;
 expected?: State;
 status: string;
}
export interface FleetPlans {
 nodes(shipId: string): readonly FlightPlanNode[];
 reviewed(shipId: string, plan: FlightPlan, nodes: readonly EvaluatedFlightNode[]): void;
 completed(shipId: string, nodeId: string): void;
 invalidated?(shipId: string, reason: string): void;
 retargeted?(shipId:string,node:FlightPlanNode):void;
}
/** Per-ship, explicitly armed, session-local execution. The host alone supplies owned
 * ship controls. Forecasts are disposable; only the session advances the real clock.
 * Follow-clock plans only slow time; explicitly enabled auto-warp plans share
 * a clock coordinator bounded by every running ship’s preparation deadline. */
export class FleetPlansRunner {
 private readonly runs = new Map<string, Run>();
 private disposed = false;
 private nextPermission=1;
 constructor(private readonly options: ManeuverPlannerOptions, private readonly plans: FlightPlanService,
  private readonly burns: ManeuverBurnFactory, private readonly clock: Pick<ClockService, 'stepSeconds' | 'idle'>,
  private readonly store: FleetPlans, private readonly clampWarp: CoreMotion['clampWarpFactor'],private alignmentWarp=4) {}
 setAlignmentWarp(factor:number):void {this.alignmentWarp=factor;}
 has(shipId: string): boolean { return this.runs.has(shipId); }
 isBurning(shipId:string):boolean {return !!this.runs.get(shipId)?.burn;}
 autoWarp(shipId:string):boolean {return this.runs.get(shipId)?.autoWarp??false;}
 setAutoWarp(shipId:string,enabled:boolean):void {const run=this.runs.get(shipId);if(run&&!run.burn)run.autoWarp=enabled;}
 status(shipId: string): string { return this.runs.get(shipId)?.status ?? ''; }
 get reviewing():boolean {for(const run of this.runs.values())if(run.job||run.encounterJob||run.arrivalJob)return true;return false;}
 get active(): boolean { return this.runs.size > 0; }
 get burning(): boolean { for (const run of this.runs.values()) if (run.burn) return true; return false; }
 ownsNode(shipId: string, nodeId: string): boolean { return this.runs.has(shipId) && this.store.nodes(shipId).find(node=>!node.completed)?.id===nodeId; }
 arm(shipId: string, once = false, autoWarp = false): void {
  const flight = this.options.flight(), port = this.options.fleet;
  if (this.disposed || !port?.owns(shipId) || !flight.canWarp || !flight.enabled) return;
  this.stop(shipId);
  if (this.runs.size >= 64 || !this.store.nodes(shipId).some(node => !node.completed)) return;
  this.runs.set(shipId, { shipId, world: flight.world, once, autoWarp, permissionId:`plan-${this.nextPermission++}`, status: 'Reviewing actual flight…' });
 }
 stop(shipId: string, reason?: string): void {
  const run = this.runs.get(shipId); if (!run) return;
  this.runs.delete(shipId); run.job?.return([]);run.encounterJob?.return({reason:'cancelled'});run.arrivalJob?.return({reason:'cancelled'}); run.burn?.dispose();
  if(run.burn)this.store.invalidated?.(shipId,reason??'Burn interrupted. Review actual flight before rearming.');
  // The owner cuts thrust even if pause or another window interrupted execution.
  if(this.options.flight().world===run.world){
   this.options.releaseControls(shipId);
   if (run.burn) this.options.setThrottle(shipId, 0);
  }
  if (reason) this.options.notify(`${run.world.ship(shipId)?.name ?? 'Ship'}: ${reason}`);
 }
 manualWarp(): void {
  for(const run of this.runs.values())if(run.autoWarp||run.burn||run.status==='Waiting for host warp approval'||run.status==='Approaching burn at real time')this.fail(run,'Manual warp took over.');
 }
 clear(): void { for (const id of this.runs.keys()) this.stop(id); }
 dispose(): void { if (this.disposed) return; this.clear(); this.disposed = true; }
 private fail(run: Run, reason: string): void { this.store.invalidated?.(run.shipId,reason); this.stop(run.shipId, `${reason} Automatic plan stopped; review before rearming.`); }
 private review(run: Run): void {
  const ship = run.world.ship(run.shipId)!;
  run.job?.return([]);run.encounterJob?.return({reason:'replaced'});run.arrivalJob?.return({reason:'replaced'});
  run.job=undefined;run.encounterJob=undefined;run.arrivalJob=undefined;run.encounter=undefined;run.plan=undefined;
  run.node = undefined; run.expected = undefined;run.prepareAt=undefined;run.preparing=false;
  for(const node of this.store.nodes(ship.id)){
   if(node.completed)continue;
   if(node.time>ship.state.time+1e-7||Math.hypot(node.prograde,node.radial)>1e-8)break;
   this.store.completed(ship.id,node.id);
  }
  run.root = { ...ship.state }; run.bodyId = ship.bodyId;
  const next=this.store.nodes(ship.id).find(node=>!node.completed);
  if(next&&next.bodyId!==ship.bodyId){
   run.awaitingBody=next.bodyId;run.encounterJob=findEncounter(run.world,ship.id,next.bodyId,next.time);
   run.status=`Checking the actual coast to ${run.world.body(next.bodyId).name}…`;return;
  }
  if(next&&(run.awaitingBody===ship.bodyId||next.targetOrbit&&next.time<=ship.state.time)){
   run.enteredBody=ship.bodyId;
   if(next.targetOrbit){run.arrivalJob=prepareArrival(run.world,ship.id,next,this.burns);run.status='Reviewing capture against the actual encounter…';return;}
   run.awaitingBody=undefined;
   if(next.time<=ship.state.time){this.fail(run,'Encounter reached. This older node has no target orbit; choose an arrival orbit and replan before burning.');return;}
  }
  const candidate = this.plans.capture(run.world, ship, this.store.nodes(ship.id));
  run.plan = this.plans.read({ format: 'space-sim-flight-plans/1', plans: [candidate] }).plans[0]!;
  run.status = 'Reviewing actual flight…';
  if (this.plans.evaluateAsync) run.job = this.plans.evaluateAsync(run.plan, run.world);
  else this.reviewed(run, this.plans.evaluate(run.plan, run.world));
 }
 private reviewed(run: Run, results: readonly EvaluatedFlightNode[]): void {
  run.job = undefined;
  this.store.reviewed(run.shipId, run.plan!, results);
  const next = results.find(node => !node.intent.completed);
  if (!next) { this.stop(run.shipId); return; }
  if (!next.valid || !next.before || !next.seed) { this.fail(run, next.reason || 'No valid next burn.'); return; }
  run.node = next; run.status = 'Following the clock · next burn prepared';
 }
 private followsCoast(run:Run,ship:Ship):boolean {
  if(ship.bodyId!==run.bodyId||!run.root||ship.controls.engine)return false;
  const context=run.world.contextFor(ship),body=run.world.body(ship.bodyId),surface=run.world.surface(body.id),
   coast=run.root.coast??context.keplerCoast(run.root,body,surface),actual=coast&&context.coastAt(coast,ship.state.time,body,surface,{cache:false});
  return !!actual?.ok&&Math.hypot(actual.state.position.x-ship.state.position.x,actual.state.position.y-ship.state.position.y)<=Math.max(.05,Math.hypot(ship.state.position.x,ship.state.position.y)*1e-8)
   &&Math.hypot(actual.state.velocity.x-ship.state.velocity.x,actual.state.velocity.y-ship.state.velocity.y)<=.05;
 }
 /** Advance detached validation only. Browser hosts may call between frames;
  * clock decisions and ignition remain exclusively in beforeAdvance/step. */
 advanceReviews():void {
  if(this.disposed)return;
  const flight=this.options.flight(),start=performance.now();
  for(const run of this.runs.values()){
   if(!run.job&&!run.encounterJob&&!run.arrivalJob)continue;
   if(flight.world!==run.world||!flight.enabled||!flight.canWarp||!this.options.fleet?.owns(run.shipId))continue;
   try{this.advanceReview(run,start);}catch(error){this.fail(run,error instanceof Error?error.message:'Plan evaluation failed.');}
  }
 }
 private advanceReview(run:Run,start:number):void {
  // One shared millisecond across ships; the yield guard is a backstop rather
  // than a limit that stretches cheap forecast samples across many frames.
  for(let count=0;(run.job||run.encounterJob||run.arrivalJob)&&count<4096&&performance.now()-start<1;count++){
   if(run.encounterJob){
    const result=run.encounterJob.next();if(!result.done)continue;
    run.encounterJob=undefined;
    if(!result.value.entry){this.fail(run,result.value.reason);break;}
    run.encounter={time:result.value.entry.time,bodyId:run.awaitingBody!};run.prepareAt=result.value.entry.time;
    run.status=`Coasting to ${run.world.body(run.encounter.bodyId).name} · capture review at SOI entry`;break;
   }
   if(run.arrivalJob){
    const result=run.arrivalJob.next();if(!result.done)continue;
    run.arrivalJob=undefined;
    if(!result.value.node){this.fail(run,result.value.reason);break;}
    const actual=run.world.ship(run.shipId);if(!actual||!this.followsCoast(run,actual)){this.fail(run,'Trajectory changed while reviewing the arrival.');break;}
    if(!this.store.retargeted){this.fail(run,'Encounter reached. This host cannot update the arrival; review and replan before burning.');break;}
    this.store.retargeted(run.shipId,result.value.node);run.awaitingBody=undefined;this.review(run);continue;
   }
   const result=run.job!.next();if(result.done){this.reviewed(run,result.value);break;}
  }
 }
 /** Called once per display frame, before normal/warped simulation advancement. */
 beforeAdvance(manual: Controls): void {
  const flight = this.options.flight(), budgetStart = performance.now();
  for (const run of this.runs.values()) {
   const ship = flight.world.ship(run.shipId);
   if (flight.world !== run.world || !flight.enabled || !flight.canWarp || !this.options.fleet?.owns(run.shipId)
    || !ship || ship.fault || ship.state.status !== 'flying') { this.fail(run, 'Flight authority or conditions changed.'); continue; }
   if (flight.ship?.id === run.shipId && (manual.engine || manual.turn || manual.throttle)) { this.fail(run, 'Manual flight took over.'); continue; }
   if (flight.paused || flight.inputBlocked) {
    if (run.burn) this.fail(run, 'Burn interrupted.');
    continue;
   }
   try {
    if(run.enteredBody&&ship.bodyId!==run.enteredBody){this.fail(run,'The ship left the destination before capture. Replan the arrival.');continue;}
    if (run.burn) {
     if (ship.bodyId !== run.bodyId) { this.fail(run, 'Body changed during a finite burn.'); continue; }
     if (flight.requestedWarp !== 1 && !(run.autoWarp&&this.alignmentWarp>1&&run.burn.phase==='aligning'&&run.burn.start-ship.state.time>.45)) this.options.fleet.requestSlowWarp(run.shipId);
     continue;
    }
    if ((!run.plan&&!run.encounterJob&&!run.arrivalJob&&!run.encounter) || ship.bodyId !== run.bodyId) this.review(run);
    if (run.job||run.encounterJob||run.arrivalJob) this.advanceReview(run,budgetStart);
    if (!this.runs.has(run.shipId) || !run.node&&!run.encounter) continue;
    const context = flight.world.contextFor(ship);
    if (!this.followsCoast(run,ship)) {
     this.fail(run, 'Trajectory changed.'); continue;
    }
    if(run.encounter){
     if(ship.state.time>run.encounter.time+this.clock.stepSeconds){this.review(run);}
     continue;
    }
    const { intent, before } = run.node!;
    if (Math.hypot(intent.prograde,intent.radial)>1e-8&&ship.state.time > intent.time + this.clock.stepSeconds) { this.fail(run, 'Burn window passed.'); continue; }
    const delta = maneuverDelta(before!, intent.prograde, intent.radial), magnitude = Math.hypot(delta.x, delta.y);
    if (magnitude <= 1e-8) {
     run.prepareAt=intent.time;
     if (ship.bodyId===intent.bodyId&&ship.state.time >= intent.time) this.complete(run);
     continue;
    }
    const angle = Math.abs(dm.normalizeAngle(dm.atan2(delta.y, delta.x) - ship.state.heading));
    const alignment = angle < 1e-7 ? 0 : context.vehicle.turnRate > 0 ? angle / context.vehicle.turnRate : Infinity;
    const start = intent.time - magnitude / context.vehicle.acceleration / 2;
    if (!Number.isFinite(alignment) || !(context.vehicle.acceleration > 0)) { this.fail(run, 'No steering or thrust available.'); continue; }
    run.prepareAt=start-alignment-1;
    const remaining = run.prepareAt - ship.state.time;
    const scope={id:run.autoWarp?run.permissionId:`node/${intent.id}`,mode:run.autoWarp?'auto-warp' as const:'slowdown' as const};
    let allowed: boolean | undefined;
    // Ask ahead without changing the clock. Auto-warp consent lasts for this run.
    if(flight.requestedWarp>1&&remaining<=Math.max(15,flight.requestedWarp*2)&&this.options.fleet.authorizeWarp){
     allowed=this.options.fleet.authorizeWarp(run.shipId,scope);
     run.status=allowed?'Following the clock · approach approved':'Waiting for host warp approval';
    }
    if (!run.autoWarp && flight.requestedWarp > 1 && remaining <= Math.max(.25, flight.warp * .1 + this.clock.stepSeconds)) {
     if(this.options.fleet.authorizeWarp){
      allowed??=this.options.fleet.authorizeWarp(run.shipId,scope);
      if(allowed)this.options.setWarp(1);
     }else allowed=this.options.fleet.requestSlowWarp(run.shipId);
     run.preparing=!!allowed;
     run.status=allowed?'Approaching burn at real time':'Waiting for host warp approval';
     continue;
    }
    if (remaining > .01 || ship.bodyId!==intent.bodyId || flight.requestedWarp!==1) continue;
    if (start - ship.state.time < alignment - this.clock.stepSeconds) { this.fail(run, 'Insufficient alignment time.'); continue; }
    run.burn = this.burns.create(intent.time, delta, context.vehicle); run.status = 'Aligning and executing burn';
   } catch (error) { this.fail(run, error instanceof Error ? error.message : 'Plan evaluation failed.'); }
  }
  this.coordinateWarp();
 }
 /** One shared clock decision, bounded by every running ship's next preparation.
  * HostSession applies its independent thrust/contact/orbit/SOI safety limits. */
 private coordinateWarp():void {
  const flight=this.options.flight(),port=this.options.fleet;
  if(this.disposed||flight.paused||flight.inputBlocked||!flight.enabled||!flight.canWarp||!port?.authorizeWarp)return;
  let owner:Run|undefined,deadline=Infinity,hold=false,alignment=false,canAlign=this.alignmentWarp>1;
  for(const run of this.runs.values()){
   if(run.world!==flight.world)continue;
   hold||=!!run.burn||!!run.job||!!run.encounterJob||!!run.arrivalJob||!run.node&&!run.encounter||!!run.preparing;
   if(run.burn){
    alignment=true;canAlign&&=run.burn.phase==='aligning'&&run.burn.start-flight.world.time>.45;
   }else{
    canAlign&&=!run.job&&!run.encounterJob&&!run.arrivalJob&&!!run.node&&!run.preparing;
    if(run.prepareAt!==undefined)deadline=Math.min(deadline,run.prepareAt);
   }
   if(!run.autoWarp)continue;
   try {
    if(port.authorizeWarp(run.shipId,{id:run.permissionId,mode:'auto-warp'}))owner??=run;
    else run.status='Waiting for host auto-warp approval';
   }catch(error){this.fail(run,error instanceof Error?error.message:'Auto-warp refused.');}
  }
  if(!owner||!this.runs.has(owner.shipId))return;
  const remaining=deadline-flight.world.time;
  const factor=hold?(alignment&&canAlign&&remaining>.45?this.alignmentWarp:1):!Number.isFinite(remaining)||remaining<=.25?1:this.clampWarp(remaining/.2);
  if(factor!==this.options.flight().requestedWarp)this.options.setWarp(factor);
  if(factor>1){const actual=this.options.flight();owner.status=`${owner.encounter?`Coasting to ${flight.world.body(owner.encounter.bodyId).name}`:'Auto-warp'} · ${actual.warp}×${actual.warpReason?' · '+actual.warpReason:''}`;}
 }
 private complete(run: Run): void {
  const node = run.node!;
  run.burn?.dispose(); run.burn = undefined; run.expected = undefined;
  this.options.releaseControls(run.shipId); this.options.setThrottle(run.shipId, 0);
  this.store.completed(run.shipId, node.intent.id);
  this.options.notify(`${run.world.ship(run.shipId)?.name ?? 'Ship'}: ${node.intent.label} complete. Engine off.`);
  run.plan = undefined; run.node = undefined;run.prepareAt=undefined;run.preparing=false;
  run.awaitingBody=undefined;run.enteredBody=undefined;run.encounter=undefined;
  if (run.once || !this.store.nodes(run.shipId).some(value => !value.completed)) this.stop(run.shipId);
 }
 /** Called before every compatible fixed tick, including for unselected ships. */
 step(): void {
  const flight = this.options.flight();
  // The host accepts at most .1 wall seconds at up to 4x: leave .45 simulation
  // seconds before ignition so every ship returns to normal fixed ticks in time.
  if(flight.requestedWarp>1)for(const run of this.runs.values())if(run.burn&&(this.alignmentWarp<=1||run.burn.phase!=='aligning'||run.burn.start-flight.world.time<=.45)){
   this.options.setWarp(1);break;
  }
  for (const run of this.runs.values()) {
   const burn = run.burn; if (!burn) continue;
   const ship = flight.world.ship(run.shipId), expected = run.expected;
   if (flight.world !== run.world || flight.paused || flight.inputBlocked || !flight.enabled || !flight.canWarp
    || this.options.flight().requestedWarp !== 1 && !(this.alignmentWarp>1&&flight.requestedWarp===this.alignmentWarp&&burn.phase==='aligning') || !this.options.fleet?.owns(run.shipId) || !ship || ship.bodyId !== run.bodyId || ship.state.status !== 'flying' || ship.fault) {
    this.fail(run, 'Burn conditions changed.'); continue;
   }
   if (expected && (Math.abs(ship.state.time - expected.time) > 1e-7 || Math.hypot(ship.state.position.x - expected.position.x, ship.state.position.y - expected.position.y) > .001
    || Math.hypot(ship.state.velocity.x - expected.velocity.x, ship.state.velocity.y - expected.velocity.y) > 1e-5 || ship.state.heading !== expected.heading || ship.state.throttle !== expected.throttle)) {
    this.fail(run, 'Trajectory or throttle changed during burn.'); continue;
   }
   try {
    const command = burn.next(ship.state);
    if (command.throttle !== undefined && command.throttle !== ship.state.throttle) this.options.setThrottle(ship.id, command.throttle);
    if (burn.phase === 'complete') { this.complete(run); continue; }
    const current = flight.world.ship(ship.id)!, context = flight.world.contextFor(current);
    run.expected = context.advance(current.state, command.controls, this.clock.stepSeconds, flight.world.body(ship.bodyId), flight.world.surface(ship.bodyId));
    this.options.fleet.setControls(ship.id, command.controls);
   } catch (error) { this.fail(run, error instanceof Error ? error.message : 'Burn failed.'); }
  }
 }
}
