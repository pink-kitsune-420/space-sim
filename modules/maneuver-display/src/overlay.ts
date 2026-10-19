/** Removable vector display for the host's local maneuver editor. Public API only. */
import type { ModuleManifest, OverlayPrimitive, PresentationView, RegisteredModule, Vec } from '@space-sim/game-api';

export const MANEUVER_COLOR = '#f7c775';
export { maneuverDelta } from '@space-sim/game-api';

export function drawManeuver(view: PresentationView): OverlayPrimitive[] {
  const plan = view.maneuver;
  if (!plan) return [];
  const world = (p: Vec): Vec => ({ x: p.x + view.body.position.x, y: p.y + view.body.position.y });
  const color = plan.valid ? MANEUVER_COLOR : '#c68484', center = world(plan.position), size = 7 / view.camera.scale;
  const out: OverlayPrimitive[] = [{ kind: 'line', space: 'world', color, width: 2, closed: true,
    points: [{ x: center.x, y: center.y + size }, { x: center.x + size, y: center.y },
      { x: center.x, y: center.y - size }, { x: center.x - size, y: center.y }] }];
  const dv = Math.hypot(plan.deltaVelocity.x, plan.deltaVelocity.y);
  if (dv > 0 && plan.valid) {
    const dx = plan.deltaVelocity.x / dv, dy = plan.deltaVelocity.y / dv, length = 30 / view.camera.scale;
    const tip = { x: center.x + dx * length, y: center.y + dy * length }, head = 5 / view.camera.scale;
    out.push({ kind: 'line', space: 'world', color, width: 2, points: [center, tip] },
      { kind: 'line', space: 'world', color, width: 2, points: [
        { x: tip.x - (dx + dy) * head, y: tip.y - (dy - dx) * head }, tip,
        { x: tip.x - (dx - dy) * head, y: tip.y - (dy + dx) * head }] });
    // Subdivide the same timed Hermite curves used by the coast renderer. Bounded to 160 dashes.
    const path = plan.path, stride = Math.max(1, Math.ceil((path.length - 1) / 160));
    for (let i = 1; i < path.length; i += stride) {
      const a = path[i - 1]!, b = path[Math.min(path.length - 1, i + stride - 1)]!, dt = b.time - a.time;
      const point = (t: number): Vec => {
        if (b.linear) return world({ x: a.position.x + (b.position.x - a.position.x) * t, y: a.position.y + (b.position.y - a.position.y) * t });
        const t2 = t * t, t3 = t2 * t;
        return world({ x: (2*t3-3*t2+1)*a.position.x + (t3-2*t2+t)*dt*a.velocity.x + (-2*t3+3*t2)*b.position.x + (t3-t2)*dt*b.velocity.x,
          y: (2*t3-3*t2+1)*a.position.y + (t3-2*t2+t)*dt*a.velocity.y + (-2*t3+3*t2)*b.position.y + (t3-t2)*dt*b.velocity.y });
      };
      out.push({ kind: 'line', space: 'world', color: '#f7c775bb', width: 1.5, points: [point(0), point(.25), point(.5), point(.7)] });
    }
  }
  for (const node of plan.nodes ?? []) {
    if (node.selected) continue;
    const at = world(node.position), marker = 5 / view.camera.scale, tint = node.valid ? MANEUVER_COLOR : '#c68484';
    out.push({ kind: 'line', space: 'world', color: tint, width: 1, closed: true,
      points: [{x:at.x,y:at.y+marker},{x:at.x+marker,y:at.y},{x:at.x,y:at.y-marker},{x:at.x-marker,y:at.y}] },
      { kind: 'text', space: 'world', color: tint, at: {x:at.x,y:at.y+14/view.camera.scale}, align: 'center',
        text: `${node.label} · T${node.time>=view.time?'−':'+'}${Math.abs(node.time-view.time).toFixed(1)} s` });
  }
  out.push({ kind: 'text', space: 'world', color, at: { x: center.x, y: center.y + 17 / view.camera.scale }, align: 'center',
    text: plan.valid ? `NODE · ${dv.toFixed(1)} m/s · T${plan.time >= view.time ? '−' : '+'}${Math.abs(plan.time - view.time).toFixed(1)} s` : 'NODE · replan' });
  return out;
}

const manifest: ModuleManifest = {
  format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'builtin.maneuver-planner', name: 'Maneuver planner',
  version: '0.1.0', kind: 'provider', authority: 'presentation', environments: ['browser', 'offline'],
  dependencies: [], provides: [], requires: [], slots: [], before: [], after: [], settings: {}, license: 'LicenseRef-Project',
};
export const maneuverPlanner: RegisteredModule = { manifest, initialize(context) {
  context.contributeLayer({ name: 'maneuver', label: 'Planned burn and trajectory', draw: drawManeuver });
} };
