import { magnitude, normalizeAngle, planet, type Sample, type State, type Vec } from '../../sim-core/src/index';

export interface Camera { readonly center: Vec; readonly rotation: number; readonly scale: number }
export interface RenderFrame {
  readonly state: State;
  readonly path: readonly Sample[];
  readonly camera: Camera;
  readonly engine: boolean;
}
export interface Renderer { draw(frame: RenderFrame): void }

export function project(p: Vec, camera: Camera, width: number, height: number): Vec {
  const x = p.x - camera.center.x, y = p.y - camera.center.y;
  const c = Math.cos(camera.rotation), s = Math.sin(camera.rotation);
  return { x: width / 2 + (x * c - y * s) * camera.scale,
    y: height / 2 - (x * s + y * c) * camera.scale };
}

export function blendAngle(current: number, target: number, fraction: number): number {
  return normalizeAngle(current + normalizeAngle(target - current) * Math.max(0, Math.min(1, fraction)));
}

export class CanvasRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
    this.ctx = ctx;
  }
  draw({ state, path, camera, engine }: RenderFrame): void {
    const { canvas, ctx } = this;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080f19'; ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 100; i++) {
      const x = ((i * 7919 + 31) % 1000) / 1000 * width;
      const y = ((i * 3571 + 71) % 1000) / 1000 * height;
      ctx.fillStyle = i % 4 === 0 ? '#77869c' : '#28374b';
      ctx.fillRect(x, y, i % 4 === 0 ? 1.5 : 1, 1);
    }
    ctx.strokeStyle = '#152332'; ctx.lineWidth = 1;
    for (let x = width / 2 % 80; x < width; x += 80) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = height / 2 % 80; y < height; y += 80) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    const body = project({ x: 0, y: 0 }, camera, width, height);
    const radius = planet.radius * camera.scale;
    const glow = ctx.createRadialGradient(body.x, body.y, radius * 0.9, body.x, body.y, radius * 1.08);
    glow.addColorStop(0, '#29495380'); glow.addColorStop(1, '#29495300');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(body.x, body.y, radius * 1.08, 0, 2 * Math.PI); ctx.fill();
    const gradient = ctx.createLinearGradient(body.x - radius, body.y - radius, body.x + radius, body.y + radius);
    gradient.addColorStop(0, '#233c47'); gradient.addColorStop(1, '#101e2b');
    ctx.fillStyle = gradient; ctx.strokeStyle = '#659497'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(body.x, body.y, radius, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(body.x, body.y, radius, 0, 2 * Math.PI); ctx.clip();
    ctx.strokeStyle = '#35505a60'; ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.ellipse(body.x, body.y, radius * Math.max(0.12, Math.abs(i) / 2.2), radius, camera.rotation, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(body.x, body.y + i * radius / 3, radius, radius * 0.13, camera.rotation, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    ctx.font = '11px ui-monospace, monospace'; ctx.fillStyle = '#7b929d'; ctx.textAlign = 'center';
    ctx.fillText('PRIMUS', body.x, body.y + 4);
    ctx.strokeStyle = '#8ddbc1'; ctx.lineWidth = 1.3; ctx.setLineDash([4, 5]); ctx.beginPath();
    path.forEach((sample, i) => {
      if (i % 10 !== 0 && i !== path.length - 1) return;
      const p = project(sample.position, camera, width, height);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke(); ctx.setLineDash([]);
    const pad = project({ x: 0, y: planet.radius }, camera, width, height);
    ctx.strokeStyle = '#dba76a'; ctx.beginPath(); ctx.moveTo(pad.x - 7, pad.y); ctx.lineTo(pad.x + 7, pad.y); ctx.stroke();
    const ship = project(state.position, camera, width, height);
    ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(-state.heading - camera.rotation);
    if (engine && state.status === 'flying') {
      ctx.fillStyle = '#e0a665'; ctx.beginPath(); ctx.moveTo(-7, -3); ctx.lineTo(-15 - state.throttle * 15, 0); ctx.lineTo(-7, 3); ctx.fill();
    }
    ctx.fillStyle = state.status === 'crashed' ? '#ef8c7a' : '#e8f8ef'; ctx.strokeStyle = '#080f19';
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, -6); ctx.lineTo(-4, 0); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#95a9b5'; ctx.textAlign = 'left';
    ctx.fillText(state.status === 'crashed' ? 'SIGNAL LOST' : 'VESSEL 01', ship.x + 16, ship.y - 13);
    // Scale annotation is in world metres, independent of canvas device pixels.
    const metres = 10 ** Math.floor(Math.log10(100 / camera.scale));
    const pixels = metres * camera.scale;
    ctx.strokeStyle = '#66808c'; ctx.beginPath(); ctx.moveTo(24, height - 27); ctx.lineTo(24 + pixels, height - 27); ctx.stroke();
    ctx.fillText(`${metres} m`, 24, height - 36);
    ctx.textAlign = 'right'; ctx.fillText(`R ${magnitude(state.position).toFixed(1)} m`, width - 24, height - 27);
  }
}
