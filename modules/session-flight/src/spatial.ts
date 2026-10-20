/**
 * Spatial Interest Management & Bounding Calculations (RFC REC-10).
 * Implements viewport intersection and forward velocity trajectory cone lookahead.
 */

export interface BoundingBox2D {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface Vec2D {
  readonly x: number;
  readonly y: number;
}

/** Default trajectory cone lookahead horizon in seconds. */
export const DEFAULT_LOOKAHEAD_SECONDS = 5;
/** Default minimum trajectory cone radius in metres (500m). */
export const MIN_CONE_RADIUS_METRES = 500;
/** Default trajectory cone half-angle in degrees (15 degrees). */
export const DEFAULT_CONE_ANGLE_DEG = 15;
/** Tangent of 15 degrees: tan(15 deg) ~= 0.2679491924311227 */
export const TAN_15_DEG = Math.tan((15 * Math.PI) / 180);

/**
 * Checks whether two 2D axis-aligned bounding boxes intersect:
 * minX_A <= maxX_B && maxX_A >= minX_B && minY_A <= maxY_B && maxY_A >= minY_B.
 */
export function intersectsBox(a: BoundingBox2D, b: BoundingBox2D): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Computes the minimum Euclidean distance from a 2D point (px, py) to a line segment
 * from (x0, y0) to (x1, y1).
 */
export function distancePointToSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = px - x0;
    const ey = py - y0;
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((px - x0) * dx + (py - y0) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const projX = x0 + t * dx;
  const projY = y0 + t * dy;
  const diffX = px - projX;
  const diffY = py - projY;
  return Math.sqrt(diffX * diffX + diffY * diffY);
}

/**
 * Computes the radius of interest cone for a given speed:
 * R_cone = max(minRadius, speed * lookaheadSeconds * tan(coneAngleDeg)).
 */
export function computeTrajectoryConeRadius(
  speed: number,
  lookaheadSeconds = DEFAULT_LOOKAHEAD_SECONDS,
  coneAngleDeg = DEFAULT_CONE_ANGLE_DEG,
  minRadius = MIN_CONE_RADIUS_METRES
): number {
  const tanAngle = coneAngleDeg === 15 ? TAN_15_DEG : Math.tan((coneAngleDeg * Math.PI) / 180);
  const dynamicRadius = speed * lookaheadSeconds * tanAngle;
  return Math.max(minRadius, dynamicRadius);
}

/**
 * Tests whether a chunk with center point C is within the forward trajectory cone
 * of a vessel at position p with velocity v over lookahead time T:
 * Center of cone at future time: p_future = p + v * T.
 * Radius: R_cone = max(500m, ||v|| * T * tan(15 deg)).
 * Distance from C to segment (p -> p_future) <= R_cone.
 */
export function isChunkInTrajectoryCone(
  chunkCenter: Vec2D,
  position: Vec2D,
  velocity: Vec2D,
  lookaheadSeconds = DEFAULT_LOOKAHEAD_SECONDS,
  coneAngleDeg = DEFAULT_CONE_ANGLE_DEG,
  minRadius = MIN_CONE_RADIUS_METRES
): boolean {
  const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
  const rCone = computeTrajectoryConeRadius(speed, lookaheadSeconds, coneAngleDeg, minRadius);
  const pFutureX = position.x + velocity.x * lookaheadSeconds;
  const pFutureY = position.y + velocity.y * lookaheadSeconds;
  const dist = distancePointToSegment(chunkCenter.x, chunkCenter.y, position.x, position.y, pFutureX, pFutureY);
  return dist <= rCone;
}

/**
 * Parses a canonical spatial chunk key into its components.
 * Supports:
 * - "b:<bodyId>:c:<x>:<y>"
 * - "b:<bodyId>:c:<x>:<y>:<z>"
 * - "chunk:<x>:<y>"
 * - "chunk:<x>:<y>:<z>"
 */
export function parseChunkKey(key: string): { bodyId?: string; x: number; y: number; z?: number } | null {
  const bodyMatch = /^b:([a-z0-9-]+):c:(-?[0-9]+):(-?[0-9]+)(?::(-?[0-9]+))?$/.exec(key);
  if (bodyMatch) {
    const bodyId = bodyMatch[1]!;
    const x = parseInt(bodyMatch[2]!, 10);
    const y = parseInt(bodyMatch[3]!, 10);
    const z = bodyMatch[4] !== undefined ? parseInt(bodyMatch[4], 10) : undefined;
    return { bodyId, x, y, ...(z !== undefined ? { z } : {}) };
  }
  const chunkMatch = /^chunk:(-?[0-9]+):(-?[0-9]+)(?::(-?[0-9]+))?$/.exec(key);
  if (chunkMatch) {
    const x = parseInt(chunkMatch[1]!, 10);
    const y = parseInt(chunkMatch[2]!, 10);
    const z = chunkMatch[3] !== undefined ? parseInt(chunkMatch[3], 10) : undefined;
    return { x, y, ...(z !== undefined ? { z } : {}) };
  }
  return null;
}

/**
 * Formats chunk coordinates into a canonical chunk key.
 */
export function formatChunkKey(bodyId: string | undefined, x: number, y: number, z?: number): string {
  const suffix = z !== undefined ? `:${x}:${y}:${z}` : `:${x}:${y}`;
  return bodyId ? `b:${bodyId}:c${suffix}` : `chunk${suffix}`;
}

/**
 * Computes axis-aligned bounding box for a chunk at (x, y) with a given chunk size.
 */
export function chunkBounds(x: number, y: number, chunkSize: number): BoundingBox2D {
  const minX = x * chunkSize;
  const minY = y * chunkSize;
  return {
    minX,
    minY,
    maxX: minX + chunkSize,
    maxY: minY + chunkSize,
  };
}

/**
 * Computes the center coordinate of a chunk at (x, y) with a given chunk size.
 */
export function chunkCenter(x: number, y: number, chunkSize: number): Vec2D {
  return {
    x: (x + 0.5) * chunkSize,
    y: (y + 0.5) * chunkSize,
  };
}
