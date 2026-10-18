import type { PaneRect, TwoPlayerLayout } from '@space-sim/game-api';

/** A pane as fractions of the flight view. */
export type { PaneRect } from '@space-sim/game-api';

/** Player panes: two side by side (landscape) or stacked (portrait); three with player 1
 * across the top; four in quarters. */
export function paneRects(count: number, layout: TwoPlayerLayout, width: number, height: number): PaneRect[] {
  if (count <= 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  if (count === 2) {
    const side = layout === 'side' || (layout === 'auto' && width >= height);
    return side ? [{ x: 0, y: 0, w: .5, h: 1 }, { x: .5, y: 0, w: .5, h: 1 }]
      : [{ x: 0, y: 0, w: 1, h: .5 }, { x: 0, y: .5, w: 1, h: .5 }];
  }
  if (count === 3) return [{ x: 0, y: 0, w: 1, h: .5 }, { x: 0, y: .5, w: .5, h: .5 }, { x: .5, y: .5, w: .5, h: .5 }];
  return [{ x: 0, y: 0, w: .5, h: .5 }, { x: .5, y: 0, w: .5, h: .5 }, { x: 0, y: .5, w: .5, h: .5 }, { x: .5, y: .5, w: .5, h: .5 }];
}

/** Dynamically computes pane rectangles based on which guest slots are separated vs shared.
 * When a guest is shared with Player 1, its pane collapses to zero width/height at the edge.
 * Separated guests and Player 1 receive packed rectangular tiles filling the viewport. */
export function dynamicPaneRects(
  totalCount: number,
  separatedGuests: ReadonlySet<number>,
  layout: TwoPlayerLayout,
  width: number,
  height: number
): { rects: PaneRect[]; visible: boolean[] } {
  if (totalCount <= 1 || separatedGuests.size === 0) {
    const rects: PaneRect[] = [{ x: 0, y: 0, w: 1, h: 1 }];
    const visible: boolean[] = [true];
    for (let slot = 1; slot < totalCount; slot++) {
      rects.push({ x: 1, y: 0, w: 0, h: 1 });
      visible.push(false);
    }
    return { rects, visible };
  }

  const activeSlots = [0, ...[...separatedGuests].filter(s => s > 0 && s < totalCount).sort((a, b) => a - b)];
  const tiles = paneRects(activeSlots.length, layout, width, height);

  const rects: PaneRect[] = new Array(totalCount);
  const visible: boolean[] = new Array(totalCount).fill(false);

  for (let k = 0; k < activeSlots.length; k++) {
    const slot = activeSlots[k]!;
    rects[slot] = tiles[k]!;
    visible[slot] = true;
  }

  const p1Rect = rects[0]!;
  for (let slot = 1; slot < totalCount; slot++) {
    if (!visible[slot]) {
      rects[slot] = { x: p1Rect.x + p1Rect.w, y: p1Rect.y, w: 0, h: p1Rect.h };
    }
  }

  return { rects, visible };
}

