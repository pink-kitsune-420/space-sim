import { describe, expect, it } from 'vitest';
import { fitHudRect, type HudRect } from '../../apps/web/src/hud-layout';

const overlap = (a: HudRect, b: HudRect): boolean => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

describe('HUD fitting', () => {
  it('keeps a dial and its readouts clear of the screenshot-size dock and telemetry', () => {
    const obstacles = [
      { x: 1300, y: 64, width: 54, height: 504 },
      { x: 498, y: 567, width: 370, height: 45 },
      { x: 12, y: 490, width: 360, height: 120 },
    ];
    const fitted = fitHudRect({ x: 1174, y: 386, width: 200, height: 223 }, 1366, 622, obstacles);
    expect(obstacles.every(r => !overlap(fitted, r))).toBe(true);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(1358);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(614);
    expect(fitted.x).toBeGreaterThan(1000);
  });

  it('finds the gap between the phone top HUD and touch controls', () => {
    const obstacles = [
      { x: 8, y: 8, width: 359, height: 155 },
      { x: 8, y: 574, width: 359, height: 230 },
    ];
    const fitted = fitHudRect({ x: 260, y: 650, width: 200, height: 200 }, 375, 812, obstacles);
    expect(obstacles.every(r => !overlap(fitted, r))).toBe(true);
    expect(fitted.y).toBeGreaterThanOrEqual(171);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(566);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(367);
  });

  it('preserves a free preferred position and clamps saved positions when the pane shrinks', () => {
    const preferred = { x: 300, y: 200, width: 200, height: 223 };
    expect(fitHudRect(preferred, 900, 600, [])).toEqual(preferred);
    const fitted = fitHudRect(preferred, 320, 300, []);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(312);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(292);
  });

  it('remains bounded and deterministic when a pane is completely occupied', () => {
    const preferred = { x: 500, y: 500, width: 180, height: 180 };
    const obstacles = [{ x: 0, y: 0, width: 320, height: 240 }];
    const fitted = fitHudRect(preferred, 320, 240, obstacles);
    expect(fitted).toEqual(fitHudRect(preferred, 320, 240, obstacles));
    expect(fitted.x).toBeGreaterThanOrEqual(8);
    expect(fitted.y).toBeGreaterThanOrEqual(8);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(312);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(232);
  });
});
