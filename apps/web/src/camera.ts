import type { Camera, CameraExtension, CameraTarget, Vec } from '../../../packages/game-api/src/index';
import { blendAngle, dragCamera } from '../../../packages/render-2d/src/index';

/** Far enough out to frame a full-scale solar system (about 1e13 m across). */
export const MIN_ZOOM = 1e-13;
const MAX_ZOOM = 50;

export interface SmartCandidate {
  readonly kind: 'ship' | 'body';
  readonly id: string;
  readonly name: string;
  readonly position: Vec;
  readonly isPilotedShip?: boolean;
}

export interface SmartTargetMatch {
  readonly kind: 'ship' | 'body';
  readonly id: string;
  readonly name: string;
  readonly isPilotedShip?: boolean;
}

export interface CameraFocusTarget {
  readonly kind: 'ship' | 'body';
  readonly id: string;
  readonly name: string;
}

/**
 * Smart throwing candidate target search.
 * Given a throw velocity and system candidates, selects:
 * 1. The closest ship along the throw direction (ships take priority).
 * 2. If no ships, the closest body along the throw direction.
 * Eases up on smart focus if the player isn't dragging fast (returns undefined for slow drags,
 * or tightens reach/cone for moderate drags).
 */
export function findSmartThrowTarget(options: {
  readonly currentCenter: Vec;
  readonly screenVelocity: Vec;
  readonly cameraRotation: number;
  readonly scale: number;
  readonly bodies: readonly SmartCandidate[];
  readonly ships: readonly SmartCandidate[];
  readonly currentFocusId?: string;
}): SmartTargetMatch | undefined {
  const { currentCenter, screenVelocity, cameraRotation, scale, bodies, ships, currentFocusId } = options;
  if (!Number.isFinite(scale) || scale <= 0) return undefined;

  const screenSpeed = Math.hypot(screenVelocity.x, screenVelocity.y);
  // Easy up if not dragging fast: slow and moderate drags (< 650 px/s) do not smart-focus
  if (screenSpeed < 650) return undefined;

  const c = Math.cos(cameraRotation), s = Math.sin(cameraRotation);
  const worldVelX = (-c * screenVelocity.x + s * screenVelocity.y) / scale;
  const worldVelY = (s * screenVelocity.x + c * screenVelocity.y) / scale;
  const worldSpeed = Math.hypot(worldVelX, worldVelY);
  if (worldSpeed <= 0) return undefined;

  const dirX = worldVelX / worldSpeed;
  const dirY = worldVelY / worldSpeed;

  const maxAngleCos = Math.cos(50 * Math.PI / 180);
  const maxScreenReach = Math.max(900, screenSpeed * 2.2);

  const evaluate = (candidates: readonly SmartCandidate[]): SmartCandidate | undefined => {
    let best: SmartCandidate | undefined;
    let bestScore = Infinity;

    for (const cand of candidates) {
      if (cand.id === currentFocusId) continue;
      const dx = cand.position.x - currentCenter.x;
      const dy = cand.position.y - currentCenter.y;
      const worldDist = Math.hypot(dx, dy);
      const screenDist = worldDist * scale;

      // Skip targets within local vicinity of camera center (< 150 px)
      if (screenDist < 150) continue;
      // Skip targets beyond reach
      if (screenDist > maxScreenReach) continue;

      const dot = (dx * dirX + dy * dirY) / worldDist;
      // Target must be in front of the throw within the allowed angle cone
      if (dot < maxAngleCos) continue;

      // Score: prioritize closest along throw vector with bonus for center alignment
      const score = screenDist * (1 + (1 - dot) * 1.5);
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    return best;
  };

  // Ship takes priority over body!
  const bestShip = evaluate(ships);
  if (bestShip) {
    return {
      kind: 'ship',
      id: bestShip.id,
      name: bestShip.name,
      isPilotedShip: bestShip.isPilotedShip,
    };
  }

  const bestBody = evaluate(bodies);
  if (bestBody) {
    return {
      kind: 'body',
      id: bestBody.id,
      name: bestBody.name,
    };
  }

  return undefined;
}

/** The pilot's camera: follow the ship, a free (planet-centred or dragged) view, or a module
 * camera mode. Presentation state only; nothing here reaches the simulation. */
export class CameraController {
  /** `follow`, `free`, or a module camera contribution ID. */
  mode = 'follow';
  /** Free-view centre relative to the active body (metres). */
  pan: Vec = { x: 0, y: 0 };
  zoom = 10;
  rotation = 0;
  horizon = true;
  /** Free view reached by dragging, rather than the planet-centred overview. */
  dragged = false;
  /** The latest drawn camera, in system coordinates. */
  last: Camera = { center: { x: 0, y: 0 }, rotation: 0, scale: 1 };

  /** Inertial pan velocity (world metres per second). */
  panVelocity: Vec = { x: 0, y: 0 };

  /** Active smart-fling target being flown toward. */
  smartTarget: SmartTargetMatch | undefined;

  /** Locked focus target being tracked. */
  focusTarget: CameraFocusTarget | undefined;

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
  scale(width: number, height: number): number { return Math.min(width, height) / 1500 * this.zoom; }
  setZoom(zoom: number, maximum = 10): void { this.zoom = Math.max(MIN_ZOOM, Math.min(maximum, zoom)); }
  changeZoom(factor: number): void { this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor)); }

  followShip(): void { this.mode = 'follow'; this.pan = { x: 0, y: 0 }; this.dragged = false; this.stopFling(); this.clearFocus(); }
  planetView(bodyRadius?: number): void {
    this.mode = 'free'; this.pan = { x: 0, y: 0 }; this.dragged = false; this.stopFling(); this.clearFocus(); this.rotation = 0;
    if (bodyRadius && bodyRadius > 0) this.setZoom(525 / bodyRadius);
  }
  /** Recentre a view on the ship. */
  recenter(): void { this.followShip(); }
  /** Clear any focused or in-flight smart target. */
  clearFocus(): void { this.focusTarget = undefined; this.smartTarget = undefined; }
  /** Follow ship → planet view → each module mode → follow ship. A dragged view returns to following. */
  cycle(cameras: readonly CameraExtension[], bodyRadius?: number): void {
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
    if (this.mode !== 'follow' && this.mode !== 'free' && !cameras.some(c => c.id === this.mode)) this.followShip();
  }
  /** Keep a free view fixed in space when the active body changes. */
  rebase(oldBody: Vec, newBody: Vec): void {
    if (this.mode === 'free') this.pan = { x: this.pan.x + oldBody.x - newBody.x, y: this.pan.y + oldBody.y - newBody.y };
  }
  /** Screen-space drag (CSS pixels) from whichever mode is active into a free view. */
  drag(delta: Vec, body: Vec, ship: Vec, width: number, height: number): void {
    this.stopFling();
    this.clearFocus();
    const relative = this.mode === 'free' ? this.pan : this.mode === 'follow' ? ship
      : { x: this.last.center.x - body.x, y: this.last.center.y - body.y };
    this.pan = dragCamera({ center: relative, rotation: this.rotation, scale: this.scale(width, height) }, delta).center;
    this.mode = 'free'; this.dragged = true; this.rotation = 0;
  }

  stopFling(): void {
    this.panVelocity = { x: 0, y: 0 };
    this.smartTarget = undefined;
  }

  /** Throw the camera with screen-space velocity (CSS pixels/sec), allowing it to coast and decelerate. */
  fling(screenVelocity: Vec, width: number, height: number, smartTarget?: SmartTargetMatch): void {
    if (this.mode !== 'free') return;
    const c = Math.cos(this.rotation), s = Math.sin(this.rotation);
    const scale = this.scale(width, height);
    if (scale <= 0) return;
    this.panVelocity = {
      x: (-c * screenVelocity.x + s * screenVelocity.y) / scale,
      y: (s * screenVelocity.x + c * screenVelocity.y) / scale,
    };
    this.smartTarget = smartTarget;
    if (smartTarget) {
      this.focusTarget = undefined;
    }
  }

  /** This frame's camera. `ship` is body-relative; `target` comes from the selected module
   * mode (undefined when it is unavailable, which returns to following the ship). */
  update(options: { readonly body: Vec; readonly ship: Vec; readonly elapsed: number; readonly instant: boolean;
    readonly width: number; readonly height: number; readonly target?: CameraTarget; readonly focusPosition?: Vec }): Camera {
    const { body, ship } = options;
    if (this.mode !== 'follow' && this.mode !== 'free' && !options.target) this.followShip();

    const scale = this.scale(options.width, options.height);

    // Smart fling towards a candidate target
    if (this.mode === 'free' && this.smartTarget && options.focusPosition) {
      const currentCenter = { x: body.x + this.pan.x, y: body.y + this.pan.y };
      const dx = options.focusPosition.x - currentCenter.x;
      const dy = options.focusPosition.y - currentCenter.y;
      const dist = Math.hypot(dx, dy);
      const distPx = dist * scale;
      const speedPx = Math.hypot(this.panVelocity.x, this.panVelocity.y) * scale;

      const finishArrival = () => {
        this.pan = { x: options.focusPosition!.x - body.x, y: options.focusPosition!.y - body.y };
        this.panVelocity = { x: 0, y: 0 };
        const arrived = this.smartTarget!;
        this.smartTarget = undefined;
        if (arrived.isPilotedShip) {
          this.followShip();
        } else {
          this.focusTarget = { kind: arrived.kind, id: arrived.id, name: arrived.name };
        }
      };

      if (options.instant || distPx < 1.0) {
        finishArrival();
      } else {
        // Natural braking curve: stopping speed from distance d at comfortable deceleration (3600 px/s²)
        const a = 3600;
        const maxBrakeSpeedPx = Math.sqrt(2 * a * distPx);
        // Brisk approach when far away (up to 3500 px/s), bounded cleanly by the braking curve
        const approachSpeedPx = Math.min(3500, Math.max(speedPx, distPx * 4.0));
        const desiredSpeedPx = Math.min(approachSpeedPx, maxBrakeSpeedPx);
        const desiredSpeedWorld = scale > 0 ? desiredSpeedPx / scale : 0;

        const ux = dist > 0 ? dx / dist : 0;
        const uy = dist > 0 ? dy / dist : 0;
        const desiredVel = { x: ux * desiredSpeedWorld, y: uy * desiredSpeedWorld };

        // Steer velocity smoothly towards target; tighten steering as we get close to eliminate lateral drift
        const blendRate = distPx < 300 ? 20.0 : 12.0;
        const blend = 1 - Math.exp(-options.elapsed * blendRate);
        this.panVelocity = {
          x: this.panVelocity.x + (desiredVel.x - this.panVelocity.x) * blend,
          y: this.panVelocity.y + (desiredVel.y - this.panVelocity.y) * blend,
        };

        const stepX = this.panVelocity.x * options.elapsed;
        const stepY = this.panVelocity.y * options.elapsed;
        const stepAlongTarget = stepX * ux + stepY * uy;

        // If this frame's step reaches or overshoots the target, or if remaining distance is within docking range, arrive cleanly
        if (stepAlongTarget >= dist || distPx < 2.0) {
          finishArrival();
        } else {
          this.pan = {
            x: this.pan.x + stepX,
            y: this.pan.y + stepY,
          };
        }
      }
    } else if (this.mode === 'free' && this.focusTarget && options.focusPosition) {
      // Locked onto target in orbit or flight
      this.pan = { x: options.focusPosition.x - body.x, y: options.focusPosition.y - body.y };
      this.panVelocity = { x: 0, y: 0 };
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
    const goal = this.mode !== 'follow' && this.mode !== 'free' && options.target?.rotation !== undefined ? options.target.rotation
      : (this.mode === 'follow' && this.horizon) ? Math.PI / 2 - Math.atan2(ship.y, ship.x) : 0;
    this.rotation = this.mode === 'free' ? 0 : blendAngle(this.rotation, goal, options.instant ? 1 : Math.min(1, options.elapsed / .12));
    this.last = { center, rotation: this.rotation, scale };
    return this.last;
  }
}
