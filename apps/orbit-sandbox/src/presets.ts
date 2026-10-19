import { GRAVITATIONAL_CONSTANT } from './spacelab/sim-core';
import type { CelestialBody, PlanetPresetTemplate, RingBelt, RingParticle } from './types';

export const PRESET_TEMPLATES: readonly PlanetPresetTemplate[] = [
  {
    id: 'oceanic',
    name: 'Oceanic Garden',
    category: 'oceanic',
    radius: 512,
    mu: 13107200, // g = 50 m/s^2 at surface
    color: '#1a4f86',
    accentColor: '#3f7535',
    atmosphereColor: '#4aa3df60',
    surfaceFeatures: 'globe-lines',
    appearance: {
      style: 'oceanic',
      colors: ['#1a4f86', '#3f7535', '#c7a56a', '#f2f6f8'],
      water: 0.72,
      clouds: 0.6,
      ice: 0.15,
      turbulence: 0.3,
    },
    rotation: { period: 360, direction: -1 },
  },
  {
    id: 'rocky',
    name: 'Rocky Moon',
    category: 'rocky',
    radius: 128,
    mu: 204800, // Moon Parvus scale
    color: '#8f8d89',
    accentColor: '#c0bdb6',
    atmosphereColor: '#00000000',
    surfaceFeatures: 'craters',
    appearance: {
      style: 'rocky',
      colors: ['#8f8d89', '#4f4d4b', '#c0bdb6', '#8f8d89'],
      craters: 0.75,
      water: 0.0,
      ice: 0.1,
    },
    rotation: { period: 480, direction: -1 },
  },
  {
    id: 'gas-giant',
    name: 'Gas Giant (Rings)',
    category: 'gas',
    radius: 2048,
    mu: 350000000,
    color: '#d8b98e',
    accentColor: '#a5714a',
    atmosphereColor: '#e2cd9850',
    surfaceFeatures: 'smooth',
    appearance: {
      style: 'banded',
      colors: ['#d8b98e', '#a5714a', '#f4e8d2', '#c25a3c'],
      turbulence: 0.65,
    },
    rotation: { period: 180, direction: -1 },
    hasRings: true,
  },
  {
    id: 'icy',
    name: 'Icy World',
    category: 'icy',
    radius: 256,
    mu: 1200000,
    color: '#d6e3ee',
    accentColor: '#7f98ad',
    atmosphereColor: '#d6e3ee35',
    surfaceFeatures: 'craters',
    appearance: {
      style: 'icy',
      colors: ['#d6e3ee', '#7f98ad', '#ffffff', '#b4c9dc'],
      ice: 0.85,
      craters: 0.35,
    },
    rotation: { period: 400, direction: -1 },
  },
  {
    id: 'volcanic',
    name: 'Volcanic World',
    category: 'volcanic',
    radius: 320,
    mu: 2400000,
    color: '#3d2b24',
    accentColor: '#ff6a1f',
    atmosphereColor: '#a0482845',
    surfaceFeatures: 'craters',
    appearance: {
      style: 'volcanic',
      colors: ['#3d2b24', '#1e1613', '#ff6a1f', '#c9a83a'],
      glow: 0.8,
      craters: 0.5,
    },
    rotation: { period: 300, direction: -1 },
  },
  {
    id: 'star',
    name: 'Radiant Star',
    category: 'star',
    radius: 8192,
    mu: 6553600000,
    color: '#ffd27a',
    accentColor: '#ff8a2a',
    atmosphereColor: '#ffaa0080',
    surfaceFeatures: 'star',
    appearance: {
      style: 'star',
      colors: ['#fff8e6', '#ffd27a', '#ff8a2a', '#c8661c'],
      glow: 1.0,
    },
    rotation: { period: 2000, direction: -1 },
    isFixed: true,
  },
];

export function createRingParticles(innerRadius: number, outerRadius: number, count = 250, mu = 350000000): RingParticle[] {
  const particles: RingParticle[] = [];
  for (let i = 0; i < count; i++) {
    // Distribute radii with higher density in middle
    const fraction = (Math.sin(i * 12.9898) * 0.5 + 0.5);
    const r = innerRadius + fraction * (outerRadius - innerRadius);
    const angle = (Math.PI * 2 * (i / count)) + ((i * 37) % 100) / 100 * 0.1;
    // Keplerian circular speed: v = sqrt(mu / r) -> angular velocity = v / r = sqrt(mu / r^3)
    const angSpeed = -Math.sqrt(Math.max(1, mu) / (r * r * r));
    particles.push({
      angle,
      radius: r,
      speed: angSpeed,
      size: 1 + ((i * 17) % 3) * 0.5,
      opacity: 0.35 + ((i * 31) % 50) / 100,
    });
  }
  return particles;
}

export function createRingBelt(innerRadius: number, outerRadius: number, mu: number, color = 'rgba(216, 185, 142, 0.45)', count = 260): RingBelt {
  return {
    innerRadius,
    outerRadius,
    color,
    particleCount: count,
    particles: createRingParticles(innerRadius, outerRadius, count, mu),
  };
}

let bodyCounter = 0;

export function instantiateBody(
  templateId: string,
  pos: { x: number; y: number },
  vel: { x: number; y: number } = { x: 0, y: 0 },
  customOverrides: Partial<CelestialBody> = {},
): CelestialBody {
  const template = PRESET_TEMPLATES.find(p => p.id === templateId) ?? PRESET_TEMPLATES[0]!;
  bodyCounter++;
  const id = `${template.category}-${bodyCounter}`;
  const mu = customOverrides.mu ?? template.mu;
  const mass = customOverrides.mass ?? (mu / GRAVITATIONAL_CONSTANT);

  let rings: RingBelt | undefined;
  if (template.hasRings || customOverrides.rings) {
    const inR = customOverrides.rings?.innerRadius ?? Math.round(template.radius * 1.4);
    const outR = customOverrides.rings?.outerRadius ?? Math.round(template.radius * 2.3);
    rings = createRingBelt(inR, outR, template.mu);
  }

  return {
    id,
    name: `${template.name} ${bodyCounter}`,
    parentId: null,
    position: { x: pos.x, y: pos.y },
    velocity: { x: vel.x, y: vel.y },
    radius: template.radius,
    mass,
    mu,
    color: template.color,
    accentColor: template.accentColor,
    atmosphereColor: template.atmosphereColor,
    surfaceFeatures: template.surfaceFeatures,
    appearance: {
      ...template.appearance,
    },
    rotation: {
      period: template.rotation.period,
      direction: template.rotation.direction,
      phaseRadiansAtEpoch: 0,
    },
    isFixed: template.isFixed ?? false,
    rings,
    trail: [],
    ...customOverrides,
  };
}

export function createDefaultSolarSystem(): CelestialBody[] {
  bodyCounter = 0;
  // Central Star Lumen
  const star = instantiateBody('star', { x: 0, y: 0 }, { x: 0, y: 0 }, {
    id: 'lumen',
    name: 'Lumen (Star)',
    radius: 6000,
    mu: 6000000000,
    isFixed: true,
  });

  // Oceanic Home Planet Primus
  const primusDist = 32000;
  const primusSpeed = Math.sqrt(star.mu / primusDist);
  const primus = instantiateBody('oceanic', { x: primusDist, y: 0 }, { x: 0, y: primusSpeed }, {
    id: 'primus',
    name: 'Primus',
    parentId: 'lumen',
    radius: 640,
    mu: 16000000,
  });

  // Moon Parvus orbiting Primus
  const parvusDist = 2400;
  const parvusSpeed = Math.sqrt(primus.mu / parvusDist);
  const parvus = instantiateBody('rocky', { x: primusDist + parvusDist, y: 0 }, { x: 0, y: primusSpeed + parvusSpeed }, {
    id: 'parvus',
    name: 'Parvus (Moon)',
    parentId: 'primus',
    radius: 140,
    mu: 300000,
  });

  // Gas Giant Magnus with Rings
  const magnusDist = 72000;
  const magnusSpeed = Math.sqrt(star.mu / magnusDist);
  const magnus = instantiateBody('gas-giant', { x: 0, y: magnusDist }, { x: -magnusSpeed, y: 0 }, {
    id: 'magnus',
    name: 'Magnus (Gas Giant)',
    parentId: 'lumen',
    radius: 2200,
    mu: 420000000,
  });

  return [star, primus, parvus, magnus];
}
