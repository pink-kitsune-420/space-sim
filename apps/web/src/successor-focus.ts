/*
 * Copyright (c) 2026 pink-kitsune-420. All Rights Reserved.
 * SPDX-License-Identifier: LicenseRef-Project
 * Proprietary Space Sim game code; personal, non-commercial evaluation only.
 * See ../../../games/space-sim-successor/LICENSE-GAME.txt for the full terms.
 */

import type { SurfaceProfile, Vec } from '../../../packages/game-api/src/index';

/** Body-fixed circumference target only. The face has no traversable latitude. */
export class SuccessorFocus {
  body?: 'planet' | 'moon';
  profile?: SurfaceProfile;
  angle?: number;
  tracking = false;
  clear(): void { this.body = undefined; this.profile = undefined; this.angle = undefined; this.tracking = false; }
  acquire(body: 'planet' | 'moon', profile: SurfaceProfile, relative: Vec, spin: number): boolean {
    if (!Number.isFinite(relative.x + relative.y + spin) || Math.hypot(relative.x, relative.y) < profile.referenceRadius * .02) return false;
    this.body = body; this.profile = profile;
    this.angle = ((Math.atan2(relative.y, relative.x) - spin) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return true;
  }
  point(radius: number, spin: number, origin: Vec): Vec | undefined {
    if (this.angle === undefined) return undefined;
    return { x: origin.x + radius * Math.cos(this.angle + spin), y: origin.y + radius * Math.sin(this.angle + spin) };
  }
}
