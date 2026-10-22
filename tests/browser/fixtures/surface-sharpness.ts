import { WebGLRenderer } from '../../../modules/render-webgl/src/webgl';
import { legacyRenderPorts } from '../../../packages/render-2d/src/compatibility';
import { DEFAULT_SHADERS } from '../../../packages/render-2d/src/index';
import { requestedBuiltinGame } from '../../../apps/web/src/bundled-games';
import { buildOverview } from '../../../apps/web/src/successor-overview';
import { appearanceAt, MATERIAL_DOMAINS } from '../../../apps/web/src/successor-materials';
import { prepareGame } from '../../../packages/modules/src/index';
import { querySurface } from '../../../packages/sim-core/src/surface';
import { initialState } from '../../../packages/sim-core/src/index';

declare const __SURFACE_FIXTURE_SLOT__: string;
async function run({ id, spin, rotation, base, scale, hidden = false }: { id: 'planet' | 'moon'; spin: number; rotation: number; base: number; scale: number; hidden?: boolean }) {
  const game = requestedBuiltinGame('?game=space-sim-successor');
  const { world, candidate } = prepareGame({ environment: 'browser', data: game.bundle.modules, profile: game.bundle.profile,
    universeKey: game.bundle.selection.universe, systemId: 'primus-system' });
  const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:1280px;height:900px;position:absolute;left:0;top:0';
  document.body.append(canvas);
  const renderer = new WebGLRenderer(canvas, DEFAULT_SHADERS, { ...legacyRenderPorts, maxPixelRatio: 1 });
  const gl = canvas.getContext('webgl2')!; let summaryUploads = 0;
  const upload = gl.texImage2D.bind(gl);
  gl.texImage2D = ((...args: unknown[]) => { if (args[2] === gl.R8UI || args[2] === gl.R32F) summaryUploads++; return Reflect.apply(upload, gl, args); }) as typeof gl.texImage2D;
  try {
    const p = world.surface(id)!, domain = MATERIAL_DOMAINS[id], pad = p.pads.find(p => p.id === 'landing-area')!.angleRadians;
    const radius = querySurface(p, pad).groundRadius, overview = buildOverview(p, domain), cs = Math.cos(spin), ss = Math.sin(spin);
    const centerRadius = radius + (hidden ? 480 / scale : 0);
    const origin = { x: base, y: -base }, localCenter = { x: centerRadius * Math.cos(pad), y: centerRadius * Math.sin(pad) };
    const center = { x: origin.x + localCenter.x * cs - localCenter.y * ss, y: origin.y + localCenter.x * ss + localCenter.y * cs };
    const frame = { state: initialState(), path: [], pathClosed: false, engine: false, camera: { center, rotation, scale },
      bodies: [{ id, name: id, radius: p.referenceRadius, position: origin, rotation: spin, surface: p, overview }],
      theme: { highQuality: false, backdropStyle: 'void' as const, starsVisible: false, nebulaVisible: false, galaxiesVisible: false, gridEnabled: false },
      showShip: false, showScale: false, showBodyLabels: false, showShipLabels: false };
    renderer.draw(frame); renderer.draw(frame); gl.finish();
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const address = (x: number, y: number) => appearanceAt(domain, x * Math.sin(pad) - y * Math.cos(pad),
      x * Math.cos(pad) + y * Math.sin(pad) - p.referenceRadius);
    let checked = 0, wrong = 0, worst = 0; const failures = [];
    const cr = Math.cos(rotation), sr = Math.sin(rotation);
    for (let offset = -500; offset <= 500; offset += 13) for (const depth of [3, 7, 11, 15]) {
      const angle = pad + offset / p.referenceRadius, r = querySurface(p, angle).groundRadius - depth;
      const x = r * Math.cos(angle), y = r * Math.sin(angle);
      const dx = (x - localCenter.x) * cs - (y - localCenter.y) * ss, dy = (x - localCenter.x) * ss + (y - localCenter.y) * cs;
      const sx = Math.floor(640 + (dx * cr - dy * sr) * scale) + .5, sy = Math.floor(450 - (dx * sr + dy * cr) * scale) + .5;
      if (sx < 2 || sx >= 1278 || sy < 2 || sy >= 898) continue;
      const px = (sx - 640) / scale, py = (450 - sy) / scale;
      const wx = px * cr + py * sr, wy = -px * sr + py * cr;
      const bx = localCenter.x + wx * cs + wy * ss, by = localCenter.y - wx * ss + wy * cs;
      const identity = address(bx, by);
      if ([-1.6, 0, 1.6].some(a => [-1.6, 0, 1.6].some(b => address(bx + a, by + b) !== identity))) continue;
      const expected = [1, 3, 5].map(i => parseInt(domain.colors[identity].slice(i, i + 2), 16));
      const index = ((canvas.height - 1 - Math.floor(sy)) * canvas.width + Math.floor(sx)) * 4;
      const actual = [...pixels.slice(index, index + 3)];
      const error = Math.max(...expected.map((v, i) => Math.abs(v - actual[i]!)));
      checked++; worst = Math.max(worst, error); if (error > 17) { wrong++; failures.push({ offset, depth, expected, actual, error }); }
    }
    return { checked, wrong, worst, failures, glError: gl.getError(), summaryUploads, backing: [canvas.width, canvas.height] };
  } finally { renderer.dispose(); canvas.remove(); candidate.dispose(); }
}
Object.assign(window, { ['surfaceSharpness_' + __SURFACE_FIXTURE_SLOT__]: { run } });
