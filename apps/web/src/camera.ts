import type { Camera, CameraExtension, CameraTarget, Vec } from '../../../packages/game-api/src/index';
import { blendAngle, dragCamera } from '../../../packages/render-2d/src/index';

/** Far enough out to frame a full-scale solar system (about 1e13 m across). */
export const MIN_ZOOM = 1e-13;
const MAX_ZOOM = 50;

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
  private dragged = false;
  /** The latest drawn camera, in system coordinates. */
  last: Camera = { center: { x: 0, y: 0 }, rotation: 0, scale: 1 };

  get follow(): boolean { return this.mode === 'follow'; }
  label(cameras: readonly CameraExtension[]): string {
    if (this.mode === 'follow') return 'Follow ship';
    if (this.mode === 'free') return this.dragged ? 'Free camera' : 'Planet view';
    return cameras.find(c => c.id === this.mode)?.hook.label ?? 'Follow ship';
  }
  scale(width: number, height: number): number { return Math.min(width, height) / 1500 * this.zoom; }
  setZoom(zoom: number, maximum = 10): void { this.zoom = Math.max(MIN_ZOOM, Math.min(maximum, zoom)); }
  changeZoom(factor: number): void { this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor)); }

  followShip(): void { this.mode = 'follow'; this.pan = { x: 0, y: 0 }; this.dragged = false; }
  planetView(): void { this.mode = 'free'; this.pan = { x: 0, y: 0 }; this.dragged = false; }
  /** Recentre a free view on the active body; other modes are unchanged. */
  recenter(): void { this.pan = { x: 0, y: 0 }; this.dragged = false; }
  /** Follow ship → planet view → each module mode → follow ship. A dragged view returns to following. */
  cycle(cameras: readonly CameraExtension[]): void {
    if (this.mode === 'follow') { this.planetView(); return; }
    const next = this.mode === 'free' ? (this.dragged ? undefined : cameras[0])
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
    const relative = this.mode === 'free' ? this.pan : this.mode === 'follow' ? ship
      : { x: this.last.center.x - body.x, y: this.last.center.y - body.y };
    this.pan = dragCamera({ center: relative, rotation: this.rotation, scale: this.scale(width, height) }, delta).center;
    this.mode = 'free'; this.dragged = true;
  }

  /** This frame's camera. `ship` is body-relative; `target` comes from the selected module
   * mode (undefined when it is unavailable, which returns to following the ship). */
  update(options: { readonly body: Vec; readonly ship: Vec; readonly elapsed: number; readonly instant: boolean;
    readonly width: number; readonly height: number; readonly target?: CameraTarget }): Camera {
    const { body, ship } = options;
    if (this.mode !== 'follow' && this.mode !== 'free' && !options.target) this.followShip();
    const relative = this.mode === 'follow' ? ship : this.mode === 'free' ? this.pan : undefined;
    const center = relative ? { x: body.x + relative.x, y: body.y + relative.y } : options.target!.center;
    const goal = this.mode !== 'follow' && this.mode !== 'free' && options.target?.rotation !== undefined ? options.target.rotation
      : this.horizon ? Math.PI / 2 - Math.atan2(ship.y, ship.x) : 0;
    this.rotation = blendAngle(this.rotation, goal, options.instant ? 1 : Math.min(1, options.elapsed / .12));
    this.last = { center, rotation: this.rotation, scale: this.scale(options.width, options.height) };
    return this.last;
  }
}
