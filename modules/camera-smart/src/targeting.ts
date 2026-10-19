import type { SmartCameraCandidate, SmartCameraSearch } from '@space-sim/game-api';

/** Priority and object meaning belong to the caller; the policy only scores visible geometry. */
export function findSmartCameraTarget<T extends SmartCameraCandidate>(options: SmartCameraSearch<T>): T | undefined {
  const { currentCenter, screenVelocity, cameraRotation, scale, groups, currentFocusId } = options;
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  const screenSpeed = Math.hypot(screenVelocity.x, screenVelocity.y);
  if (screenSpeed < 650) return undefined;
  const c = Math.cos(cameraRotation), s = Math.sin(cameraRotation);
  const worldVelX = (-c * screenVelocity.x + s * screenVelocity.y) / scale;
  const worldVelY = (s * screenVelocity.x + c * screenVelocity.y) / scale;
  const worldSpeed = Math.hypot(worldVelX, worldVelY);
  if (worldSpeed <= 0) return undefined;
  const dirX = worldVelX / worldSpeed, dirY = worldVelY / worldSpeed;
  const maxAngleCos = Math.cos(50 * Math.PI / 180);
  const maxScreenReach = Math.max(900, screenSpeed * 2.2);
  for (const candidates of groups) {
    let best: T | undefined, bestScore = Infinity;
    for (const candidate of candidates) {
      if (candidate.id === currentFocusId) continue;
      const dx = candidate.position.x - currentCenter.x, dy = candidate.position.y - currentCenter.y;
      const worldDist = Math.hypot(dx, dy), screenDist = worldDist * scale;
      if (screenDist < 150 || screenDist > maxScreenReach) continue;
      const dot = (dx * dirX + dy * dirY) / worldDist;
      if (dot < maxAngleCos) continue;
      const score = screenDist * (1 + (1 - dot) * 1.5);
      if (score < bestScore) { bestScore = score; best = candidate; }
    }
    if (best) return best;
  }
  return undefined;
}
