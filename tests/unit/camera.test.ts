import { expect, it } from 'vitest';
import { blendAngle, project } from '../../packages/render-2d/src/index';

it('projects a shared world transform with +Y up and camera-relative subtraction', () => {
  const center = { x: 1e12, y: -1e12 };
  const camera = { center, rotation: 0, scale: 2 };
  expect(project({ x: center.x + 2, y: center.y + 3 }, camera, 800, 600)).toEqual({ x: 404, y: 294 });
  const p = project({ x: 1, y: 0 }, { center: { x: 0, y: 0 }, rotation: Math.PI / 2, scale: 1 }, 800, 600);
  expect(p.x).toBeCloseTo(400); expect(p.y).toBeCloseTo(299);
});

it('blends the shortest angular path through wraparound and allows retargeting', () => {
  const degrees = Math.PI / 180;
  expect(Math.abs(blendAngle(179 * degrees, -179 * degrees, .5))).toBeCloseTo(Math.PI);
  expect(blendAngle(0, Math.PI / 2, .5)).toBeCloseTo(Math.PI / 4);
  expect(blendAngle(Math.PI / 4, 0, 1)).toBe(0);
});
