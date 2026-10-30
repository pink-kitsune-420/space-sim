/*
 * Copyright (c) 2026 pink-kitsune-420. All Rights Reserved.
 * SPDX-License-Identifier: LicenseRef-Project
 * Proprietary Space Sim game code; personal, non-commercial use and modding permitted.
 * See ../games/space-sim-successor/LICENSE-GAME.txt for the full terms.
 */

/** Build-only entry compiled with the existing Vite toolchain. No live sessions. */
import definition from '../games/space-sim-successor/planet-preview.json';
import { generateSurface, surfaceIdentity } from '../packages/sim-core/src/surface';
import { bakePlanetSurface } from '../packages/sim-core/src/planet-surface';
import { buildOverview } from '../apps/web/src/successor-overview';
import { MATERIAL_DOMAINS } from '../apps/web/src/successor-materials';
import { encodeStarterProducts } from '../apps/web/src/starter-product-format';
import type { PlanetSurfaceDefinition } from '../packages/game-api/src/index';

export function buildStarterProducts() {
  return definition.data.universes[0]!.definition.systems[0]!.bodies.filter(b => b.surface?.generatorVersion === 2).map(raw => {
    const bodyId = raw.id as 'planet' | 'moon', body = { radius: raw.radius, surface: raw.surface as PlanetSurfaceDefinition };
    const physical = bakePlanetSurface(body.surface), profile = generateSurface(body);
    const encoded = encodeStarterProducts({ physical, overview: buildOverview(profile, MATERIAL_DOMAINS[bodyId]) });
    return { bodyId, surfaceIdentity: surfaceIdentity(body), ...encoded };
  });
}
