import { describe, expect, it } from 'vitest';
import { validateCameraTarget } from '../../packages/game-runtime/src/presentation';
import type { MultiViewportCameraFrame } from '../../packages/game-api/src/index';

describe('multi-viewport camera support', () => {
  it('accepts single CameraTarget backwards-compatibly', () => {
    const single = { center: { x: 1000, y: 2000 }, rotation: 1.25 };
    const validated = validateCameraTarget(single);
    expect(validated).toEqual({ center: { x: 1000, y: 2000 }, rotation: 1.25 });

    const minimal = { center: { x: 0, y: 0 } };
    expect(validateCameraTarget(minimal)).toEqual({ center: { x: 0, y: 0 } });
  });

  it('validates MultiViewportCameraFrame rect bounds within [0..1]', () => {
    const splitFrame = {
      viewports: [
        { seatSlot: 0, center: { x: 0, y: 0 }, rect: { x: 0, y: 0, width: 0.5, height: 1 } },
        { seatSlot: 1, center: { x: 100, y: 200 }, rotation: 0.5, scale: 2.0, rect: { x: 0.5, y: 0, width: 0.5, height: 1 } },
      ],
    };

    const validated = validateCameraTarget(splitFrame) as MultiViewportCameraFrame;
    expect(validated.viewports).toHaveLength(2);
    expect(validated.viewports[0]!.seatSlot).toBe(0);
    expect(validated.viewports[0]!.rect).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
    expect(validated.viewports[1]!.seatSlot).toBe(1);
    expect(validated.viewports[1]!.center).toEqual({ x: 100, y: 200 });
    expect(validated.viewports[1]!.rotation).toBe(0.5);
    expect(validated.viewports[1]!.scale).toBe(2.0);

    const quadFrame = {
      viewports: [
        { seatSlot: 0, center: { x: 0, y: 0 }, rect: { x: 0, y: 0, width: 0.5, height: 0.5 } },
        { seatSlot: 1, center: { x: 0, y: 0 }, rect: { x: 0.5, y: 0, width: 0.5, height: 0.5 } },
        { seatSlot: 2, center: { x: 0, y: 0 }, rect: { x: 0, y: 0.5, width: 0.5, height: 0.5 } },
        { seatSlot: 3, center: { x: 0, y: 0 }, rect: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } },
      ],
    };
    const validatedQuad = validateCameraTarget(quadFrame) as MultiViewportCameraFrame;
    expect(validatedQuad.viewports).toHaveLength(4);
  });

  it('rejects negative or overlapping/overflowing viewport rects', () => {
    // Negative x or y
    expect(() => validateCameraTarget({
      viewports: [{ seatSlot: 0, center: { x: 0, y: 0 }, rect: { x: -0.1, y: 0, width: 0.5, height: 1 } }],
    })).toThrow();
    expect(() => validateCameraTarget({
      viewports: [{ seatSlot: 0, center: { x: 0, y: 0 }, rect: { x: 0, y: -0.1, width: 0.5, height: 1 } }],
    })).toThrow();

    // Non-positive width or height
    expect(() => validateCameraTarget({
      viewports: [{ seatSlot: 0, center: { x: 0, y: 0 }, rect: { x: 0, y: 0, width: 0, height: 1 } }],
    })).toThrow();
    expect(() => validateCameraTarget({
      viewports: [{ seatSlot: 0, center: { x: 0, y: 0 }, rect: { x: 0, y: 0, width: 0.5, height: -0.5 } }],
    })).toThrow();

    // Overflowing boundaries
    expect(() => validateCameraTarget({
      viewports: [{ seatSlot: 0, center: { x: 0, y: 0 }, rect: { x: 0.6, y: 0, width: 0.5, height: 1 } }],
    })).toThrow();
    expect(() => validateCameraTarget({
      viewports: [{ seatSlot: 0, center: { x: 0, y: 0 }, rect: { x: 0, y: 0.6, width: 0.5, height: 0.5 } }],
    })).toThrow();

    // Overlapping viewports
    expect(() => validateCameraTarget({
      viewports: [
        { seatSlot: 0, center: { x: 0, y: 0 }, rect: { x: 0, y: 0, width: 0.6, height: 1 } },
        { seatSlot: 1, center: { x: 0, y: 0 }, rect: { x: 0.5, y: 0, width: 0.5, height: 1 } },
      ],
    })).toThrow();

    // Empty viewports array
    expect(() => validateCameraTarget({ viewports: [] })).toThrow();
  });
});
