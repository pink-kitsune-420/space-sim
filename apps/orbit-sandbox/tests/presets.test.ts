import { describe, it, expect } from 'vitest';
import {
  PRESET_TEMPLATES,
  instantiateBody,
  createRingParticles,
  createDefaultSolarSystem,
} from '../src/presets';

describe('Planet Presets & Ring Belt Generators', () => {
  it('provides all 6 core planet presets', () => {
    const categories = PRESET_TEMPLATES.map(p => p.category);
    expect(categories).toContain('oceanic');
    expect(categories).toContain('rocky');
    expect(categories).toContain('gas');
    expect(categories).toContain('icy');
    expect(categories).toContain('volcanic');
    expect(categories).toContain('star');
  });

  it('instantiates celestial body with correct physics and appearance values', () => {
    const body = instantiateBody('gas-giant', { x: 5000, y: 1000 }, { x: 0, y: 30 });

    expect(body.id).toContain('gas');
    expect(body.position.x).toBe(5000);
    expect(body.position.y).toBe(1000);
    expect(body.velocity.x).toBe(0);
    expect(body.velocity.y).toBe(30);
    expect(body.mass).toBeGreaterThan(0);
    expect(body.radius).toBeGreaterThan(1000);
    expect(body.rings).toBeDefined();
    expect(body.rings?.particles?.length).toBeGreaterThan(50);
  });

  it('generates ring particles with Keplerian circular orbital speeds', () => {
    const mu = 350000000;
    const innerR = 3000;
    const outerR = 6000;
    const count = 100;

    const particles = createRingParticles(innerR, outerR, count, mu);
    expect(particles.length).toBe(count);

    for (const p of particles) {
      expect(p.radius).toBeGreaterThanOrEqual(innerR);
      expect(p.radius).toBeLessThanOrEqual(outerR);
      // Keplerian angular velocity omega = sqrt(mu / r^3)
      const expectedAngSpeed = Math.sqrt(mu / Math.pow(p.radius, 3));
      expect(Math.abs(p.speed)).toBeCloseTo(expectedAngSpeed, 3);
    }
  });

  it('generates the default Primus solar system with stable hierarchies', () => {
    const bodies = createDefaultSolarSystem();
    expect(bodies.length).toBe(4);

    const star = bodies.find(b => b.surfaceFeatures === 'star');
    const primus = bodies.find(b => b.name.includes('Primus'));
    const parvus = bodies.find(b => b.name.includes('Parvus'));
    const magnus = bodies.find(b => b.name.includes('Magnus'));

    expect(star).toBeDefined();
    expect(primus).toBeDefined();
    expect(parvus).toBeDefined();
    expect(magnus).toBeDefined();

    expect(star?.isFixed).toBe(true);
    expect(primus?.parentId).toBe('lumen');
    expect(parvus?.parentId).toBe('primus');
    expect(magnus?.parentId).toBe('lumen');
  });
});
