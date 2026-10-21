import { dragCamera, type Camera, type CameraExtension, type CameraTarget, type Vec, type SmartCameraControl, type SmartTargetMatch, type CameraFocusTarget } from '@space-sim/game-api';
import { cameraScale, cameraRotation, type CameraTuning, tuning } from './transform';

/** Far enough out to frame a full-scale solar system (about 1e13 m across). */
export const MIN_ZOOM = 1e-13;
const MAX_ZOOM = 50;

/** The pilot's camera: follow the ship, a free (planet-centred or dragged) view, or a module
 * camera mode. Presentation state only; nothing here reaches the simulation. */
export class CameraController {
  /** `follow`, `free`, or a module camera contribution ID. */
  constructor(options: CameraTuning = {}, private readonly smart?: SmartCameraControl<SmartTargetMatch>) { this.options = tuning(options); this.zoom = this.options.initialZoom; }
  private readonly options: Required<CameraTuning>;
  private disposed = false;
  private live(): void { if (this.disposed) throw new Error('Flight camera disposed'); }
  mode = 'follow';
  /** Free-view centre relative to the active body (metres). */
  pan: Vec = { x: 0, y: 0 };
  zoom = 10;
  rotation = 0;
  /** Viewer-selected fixed orientation in radians, independent of ship attitude. */
  manualRotation?: number;
  horizon = true;
  /** Free view reached by dragging, rather than the planet-centred overview. */
  dragged = false;
  /** The latest drawn camera, in system coordinates. */
  last: Camera = { center: { x: 0, y: 0 }, rotation: 0, scale: 1 };

  /** Inertial pan velocity (world metres per second). */
  panVelocity: Vec = { x: 0, y: 0 };

  /** Active smart-fling target being flown toward. */
  get smartTarget(): SmartTargetMatch | undefined { return this.smart?.target; }
  set smartTarget(target: SmartTargetMatch | undefined) { if (this.smart) this.smart.target = target; }

  /** Locked focus target being tracked. */
  get focusTarget(): CameraFocusTarget | undefined { return this.smart?.focus; }
  set focusTarget(target: CameraFocusTarget | undefined) {
    if (!this.smart) return;
    if (target && (target.id !== this.smart.focus?.id || target.kind !== this.smart.focus?.kind)) this.manualRotation = undefined;
    this.smart.focus = target;
  }

  private readonly smartFrame: { origin: Vec; pan: Vec; velocity: Vec; scale: number; elapsed: number; instant: boolean; targetPosition?: Vec }
    = { origin: { x: 0, y: 0 }, pan: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, scale: 1, elapsed: 0, instant: false };

  get follow(): boolean { return this.mode === 'follow'; }
  label(cameras: readonly CameraExtension[]): string {
    if (this.mode === 'follow') return 'Follow ship';
    if (this.focusTarget) {
      return this.focusTarget.kind === 'body'
        ? `${this.focusTarget.name} view`
        : `Focus: ${this.focusTarget.name}`;
    }
    if (this.mode === 'free') return this.dragged ? 'Free camera' : 'Planet view';
    return cameras.find(c => c.id === this.mode)?.hook.label ?? 'Follow ship';
  }
  scale(width: number, height: number): number { return cameraScale(width, height, this.zoom, this.options); }
  setZoom(zoom: number, maximum = this.options.initialZoom): void { this.live(); this.zoom = Math.max(MIN_ZOOM, Math.min(maximum, zoom)); }
  changeZoom(factor: number): void { this.live(); this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor)); }

  followShip(): void { this.live(); this.manualRotation = undefined; this.mode = 'follow'; this.pan = { x: 0, y: 0 }; this.dragged = false; this.stopFling(); this.clearFocus(); }
  planetView(bodyRadius?: number): void {
    this.live();
    this.manualRotation = undefined;
    this.mode = 'free'; this.pan = { x: 0, y: 0 }; this.dragged = false; this.stopFling(); this.clearFocus(); this.rotation = 0;
    if (bodyRadius && bodyRadius > 0) this.setZoom(.35 * this.options.referenceMetres / bodyRadius);
  }
  /** Recentre a view on the ship. */
  recenter(): void { this.followShip(); }
  /** Clear any focused or in-flight smart target. */
  clearFocus(): void {
    if (this.smart?.focus || this.smart?.target) this.manualRotation = undefined;
    this.smart?.clear();
  }
  /** Follow ship → planet view → each module mode → follow ship. A dragged view returns to following. */
  cycle(cameras: readonly CameraExtension[], bodyRadius?: number): void {
    this.live();
    this.manualRotation = undefined;
    this.stopFling();
    this.clearFocus();
    if (this.mode === 'follow') { this.planetView(bodyRadius); return; }
    if (this.mode === 'free' && !this.dragged) {
      this.dragged = true;
      this.rotation = 0;
      return;
    }
    const next = this.mode === 'free' ? cameras[0]
      : cameras[cameras.findIndex(c => c.id === this.mode) + 1];
    if (next) { this.mode = next.id; this.dragged = false; } else this.followShip();
  }
  /** Leave a module mode that is no longer available. */
  retain(cameras: readonly CameraExtension[]): void {
    this.live();
    if (this.mode !== 'follow' && this.mode !== 'free' && !cameras.some(c => c.id === this.mode)) this.followShip();
  }
  /** Keep a free view fixed in space when the active body changes. */
  rebase(oldBody: Vec, newBody: Vec): void {
    this.live();
    if (this.mode === 'free') this.pan = { x: this.pan.x + oldBody.x - newBody.x, y: this.pan.y + oldBody.y - newBody.y };
  }
  /** Screen-space drag (CSS pixels) from whichever mode is active into a free view. */
  drag(delta: Vec, body: Vec, ship: Vec, width: number, height: number): void {
    this.live();
    this.stopFling();
    this.clearFocus();
    const relative = this.mode === 'free' ? this.pan : this.mode === 'follow' ? ship
      : { x: this.last.center.x - body.x, y: this.last.center.y - body.y };
    this.pan = dragCamera({ center: relative, rotation: this.rotation, scale: this.scale(width, height) }, delta).center;
    this.mode = 'free'; this.dragged = true; this.rotation = this.manualRotation ?? 0;
  }

  stopFling(): void {
    this.panVelocity = { x: 0, y: 0 };
    this.smart?.stop();
  }

  /** Throw the camera with screen-space velocity (CSS pixels/sec), allowing it to coast and decelerate. */
  fling(screenVelocity: Vec, width: number, height: number, smartTarget?: SmartTargetMatch): void {
    this.live();
    if (this.mode !== 'free') return;
    const c = Math.cos(this.rotation), s = Math.sin(this.rotation);
    const scale = this.scale(width, height);
    if (scale <= 0) return;
    this.panVelocity = {
      x: (-c * screenVelocity.x + s * screenVelocity.y) / scale,
      y: (s * screenVelocity.x + c * screenVelocity.y) / scale,
    };
    if (smartTarget) this.smart?.start(smartTarget, smartTarget.isPilotedShip);
    else this.smart?.stop();
  }

  /** This frame's camera. `ship` is body-relative; `target` comes from the selected module
   * mode (undefined when it is unavailable, which returns to following the ship). */
  update(options: { readonly body: Vec; readonly ship: Vec; readonly elapsed: number; readonly instant: boolean;
    readonly width: number; readonly height: number; readonly target?: CameraTarget; readonly focusPosition?: Vec }): Camera {
    this.live();
    const { body, ship } = options;
    if (this.mode !== 'follow' && this.mode !== 'free' && !options.target) this.followShip();

    const scale = this.scale(options.width, options.height);

    const frame = this.smartFrame;
    frame.origin = body; frame.pan = this.pan; frame.velocity = this.panVelocity;
    frame.scale = scale; frame.elapsed = options.elapsed; frame.instant = options.instant; frame.targetPosition = options.focusPosition;
    const previousFocus = this.smart?.focus;
    const guided = this.mode === 'free' ? this.smart?.update(frame) : undefined;
    if (previousFocus !== this.smart?.focus) this.manualRotation = undefined;
    if (guided) {
      this.pan = guided.pan; this.panVelocity = guided.velocity;
      if (guided.follow) this.followShip();
    } else if (this.mode === 'free' && (this.panVelocity.x !== 0 || this.panVelocity.y !== 0)) {
      // Regular free fling inertia
      this.pan = {
        x: this.pan.x + this.panVelocity.x * options.elapsed,
        y: this.pan.y + this.panVelocity.y * options.elapsed,
      };
      // Exponential friction deceleration
      const friction = Math.exp(-options.elapsed * 3.5);
      this.panVelocity = {
        x: this.panVelocity.x * friction,
        y: this.panVelocity.y * friction,
      };
      if (Math.hypot(this.panVelocity.x, this.panVelocity.y) * scale < 0.5) {
        this.panVelocity = { x: 0, y: 0 };
      }
    }

    const relative = this.mode === 'follow' ? ship : this.mode === 'free' ? this.pan : undefined;
    const center = relative ? { x: body.x + relative.x, y: body.y + relative.y } : options.target!.center;
    const goal = this.manualRotation ?? (this.mode !== 'follow' && this.mode !== 'free' && options.target?.rotation !== undefined ? options.target.rotation
      : (this.mode === 'follow' && this.horizon) ? Math.PI / 2 - Math.atan2(ship.y, ship.x) : 0);
    this.rotation = this.mode === 'free' ? goal : cameraRotation(this.rotation, goal, options.instant ? Infinity : options.elapsed, this.options);
    this.last = { center, rotation: this.rotation, scale };
    return this.last;
  }
  dispose(): void { if (this.disposed) return; this.stopFling(); this.clearFocus(); this.smart?.dispose(); this.disposed = true; }

}
