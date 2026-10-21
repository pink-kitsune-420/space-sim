import type { OverlayPrimitive, SurfaceProfile, Vec } from '../../../packages/game-api/src/index';

/** Static scale references, derived from the same pad/terrain field as contact.
 * This presentation has no astronaut entity, controls or persisted state. */
export function successorReferences(profile: SurfaceProfile, query: (angle: number) => number,
  toWorld: (p: Vec) => Vec, scale: number): OverlayPrimitive[] {
  if (scale < .2) return [];
  const overlays: OverlayPrimitive[] = [], color = '#e4c58b';
  for (const pad of profile.pads) {
    if (pad.id !== 'landing-area' && pad.id !== 'ridge-lookout' && pad.id !== 'basin-station') continue;
    const a = pad.angleRadians;
    const point = (side: number, height: number): Vec => {
      const angle = a - side / profile.referenceRadius, radius = query(angle) + height;
      return toWorld({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    };
    const landing = pad.id === 'landing-area';
    if (landing && scale >= 5) {
      const figure = (x: number, h: number) => point(x + 6, h);
      overlays.push({ kind: 'circle', space: 'world', center: figure(0, 1.6), radius: .2, color, width: 1.4 },
        { kind: 'line', space: 'world', points: [figure(0, 1.4), figure(0, .65), figure(-.28, 0)], color, width: 1.4 },
        { kind: 'line', space: 'world', points: [figure(0, .65), figure(.28, 0)], color, width: 1.4 },
        { kind: 'line', space: 'world', points: [figure(-.4, .85), figure(0, 1.25), figure(.4, .85)], color, width: 1.4 });
      if (scale >= 10) overlays.push({ kind: 'text', space: 'world', at: figure(.6, 2.4), text: '1.8 m reference', color, align: 'left' });
    }
    if (!landing) overlays.push({ kind: 'line', space: 'world', points: [point(0, 0), point(0, 2.5), point(1.3, 2), point(0, 1.5)], color, width: 1.4 },
      { kind: 'text', space: 'world', at: point(0, 4), text: pad.id === 'ridge-lookout' ? 'Ridge Lookout · 140 m from pad' : 'Basin Station · 220 m from pad', color, align: 'center' });
  }
  return overlays;
}
