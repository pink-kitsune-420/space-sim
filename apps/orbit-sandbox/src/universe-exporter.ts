import { encodeUniverse } from './spacelab/game-library';
import type { UniverseDefinition, SystemDefinition, CelestialBodyDefinition, PresetDefinition } from './spacelab/sim-core';
import { validateUniverse } from './spacelab/sim-core';
import type { CelestialBody } from './types';

export function sanitizeId(raw: string): string {
  const clean = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'body';
}

export function compileToUniverse(
  bodies: readonly CelestialBody[],
  universeId = 'orbit-sandbox-universe',
  universeName = 'Orbit Sandbox Universe',
): UniverseDefinition {
  if (bodies.length === 0) {
    throw new Error('Sandbox must contain at least one celestial body to export a universe.');
  }

  // Find root/central body: highest mass or star
  let central = bodies[0]!;
  for (const b of bodies) {
    if (b.surfaceFeatures === 'star' || b.mass > central.mass) {
      central = b;
    }
  }

  const systemId = 'sandbox-system';
  const compiledBodies: CelestialBodyDefinition[] = [];

  for (const b of bodies) {
    const isCentral = b.id === central.id;
    const parentId = isCentral ? null : (b.parentId ?? central.id);

    // Ensure valid rotation
    const rotationPeriod = Math.max(60, b.rotation.period);
    // Breakup check: omega^2 * r^3 < mu
    const omega = (2 * Math.PI) / rotationPeriod;
    const safePeriod = omega * omega * Math.pow(b.radius, 3) < b.mu
      ? rotationPeriod
      : Math.ceil(Math.sqrt((4 * Math.PI * Math.PI * Math.pow(b.radius, 3)) / b.mu) * 1.5);

    const ephemeris = {
      kind: 'fixed-inertial' as const,
      position: [b.position.x, b.position.y] as [number, number],
      velocity: [b.velocity.x, b.velocity.y] as [number, number],
    };

    const bodyDef: CelestialBodyDefinition = {
      id: sanitizeId(b.id),
      name: b.name,
      parentId: parentId ? sanitizeId(parentId) : null,
      radius: Math.max(32, Math.round(b.radius)),
      radiusMetres: Math.max(32, Math.round(b.radius)),
      mass: b.mass,
      mu: b.mu,
      color: b.color,
      accentColor: b.accentColor,
      atmosphereColor: b.atmosphereColor,
      surfaceFeatures: b.surfaceFeatures,
      appearance: {
        style: b.appearance.style,
        colors: [...b.appearance.colors],
        water: b.appearance.water,
        clouds: b.appearance.clouds,
        ice: b.appearance.ice,
        craters: b.appearance.craters,
        turbulence: b.appearance.turbulence,
        glow: b.appearance.glow,
      },
      rotation: {
        period: safePeriod,
        direction: b.rotation.direction === 1 ? 1 : -1,
        phaseRadiansAtEpoch: b.rotation.phaseRadiansAtEpoch ?? 0,
      },
      ephemeris,
    };

    compiledBodies.push(bodyDef);
  }

  // Create flight presets (e.g. orbit above the main terrestrial body)
  const targetPlanet = compiledBodies.find(b => b.surfaceFeatures !== 'star') ?? compiledBodies[0]!;
  const targetRadius = targetPlanet.radius ?? targetPlanet.radiusMetres ?? 512;
  const presets: PresetDefinition[] = [
    {
      id: `${targetPlanet.id}-low-orbit`,
      name: `${targetPlanet.name} Low Orbit`,
      bodyId: targetPlanet.id,
      kind: 'circular-orbit',
      radius: targetRadius * 1.5,
      radiusMetres: targetRadius * 1.5,
      altitude: targetRadius * 0.5,
      phaseRadians: Math.PI / 2,
      direction: -1,
      headingRadians: 0,
    },
  ];

  if (targetPlanet.surfaceFeatures !== 'star') {
    presets.push({
      id: `${targetPlanet.id}-surface`,
      name: `${targetPlanet.name} North Landing`,
      bodyId: targetPlanet.id,
      kind: 'landed',
      position: [0, targetRadius],
      velocity: [0, 0],
      headingRadians: Math.PI / 2,
    });
  }

  const system: SystemDefinition = {
    id: systemId,
    name: 'Orbit Sandbox Planetary System',
    description: 'Custom gravitational system generated dynamically from Spacelab Orbit Sandbox.',
    centralBodyId: sanitizeId(central.id),
    bodies: compiledBodies,
    presets,
  };

  const universe: UniverseDefinition = {
    schemaVersion: 1,
    id: sanitizeId(universeId),
    name: universeName,
    description: 'Interactive universe authored in the Spacelab Orbit Sandbox.',
    author: 'Spacelab Orbit Sandbox',
    defaultSystemId: systemId,
    systems: [system],
  };

  // Run rigorous validation against official universe engine rules
  return validateUniverse(universe);
}

/** Reusable definitions share the host's .spacedata codec; this never saves simulation progress. */
export async function compressUniverse(universe: UniverseDefinition): Promise<Uint8Array<ArrayBuffer>> {
  return encodeUniverse(universe);
}

export function downloadFile(filename: string, content: BlobPart, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportUniverseFiles(
  bodies: readonly CelestialBody[],
  universeId: string,
  universeName: string,
): Promise<{ jsonString: string; compressedBytes: Uint8Array; universe: UniverseDefinition }> {
  const universe = compileToUniverse(bodies, universeId, universeName);
  const jsonString = JSON.stringify(universe, null, 2);
  const compressedBytes = await compressUniverse(universe);
  return { jsonString, compressedBytes, universe };
}

export function stageUniverseForSpaceSim(universe: UniverseDefinition): {
  deepLinkUrl: string;
  success: boolean;
} {
  try {
    const raw = JSON.stringify(universe);
    localStorage.setItem('space-sim:staged-universe', raw);
    localStorage.setItem('space-sim:last-imported-universe', raw);
    // Base64 encode for hash/parameter deep linking if small
    const b64 = btoa(encodeURIComponent(raw));
    const deepLinkUrl = `http://localhost:5173/?imported=sandbox#universe=${b64}`;
    return { deepLinkUrl, success: true };
  } catch {
    return { deepLinkUrl: 'http://localhost:5173/', success: false };
  }
}
