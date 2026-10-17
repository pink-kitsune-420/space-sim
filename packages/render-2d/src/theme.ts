import type {
  Camera, RenderThemeOptions, ThemeBackdropStyle, ThemeCounterStyle, ThemeGridStyle, ThemeWindowStyle,
} from '../../game-api/src/index';

export type { ThemeBackdropStyle, ThemeCounterStyle, ThemeGridStyle, ThemeWindowStyle, RenderThemeOptions };

export interface ThemeSettings extends RenderThemeOptions {
  backdropStyle: ThemeBackdropStyle;
  nebulaVisible: boolean;
  nebulaIntensity: number; // 0.0 to 2.0
  starsVisible: boolean;
  starDensity: number; // 0.5 to 2.0
  dustVisible: boolean;
  galaxiesVisible: boolean;
  animatedNebula: boolean;
  shaderSeed: number; // 0 = default universe seed, > 0 = custom seed

  gridEnabled: boolean;
  gridStyle: ThemeGridStyle;
  gridSpacing: number; // in pixels, e.g. 80
  gridOpacity: number; // 0.1 to 1.0
  gridLabels: boolean;
  gridColor?: string; // Hex color string, e.g. '#38bdf8'

  counterTheme: ThemeCounterStyle;
  hudColor?: string; // Optional custom HUD phosphor/telemetry color, e.g. '#00f0ff'
  windowStyle?: ThemeWindowStyle;
  windowColor?: string; // Optional custom window accent hex color, e.g. '#00f0ff'
  hudScanlines: boolean;
  hudGlow: boolean;
  hudChamfer: boolean;
  compactHud: boolean;
  highQuality: boolean;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  previewColor: string;
  settings: Partial<ThemeSettings>;
}

export const DEFAULT_THEME_SETTINGS: Readonly<ThemeSettings> = Object.freeze({
  backdropStyle: 'galactic',
  nebulaVisible: true,
  nebulaIntensity: 1.0,
  starsVisible: true,
  starDensity: 1.0,
  dustVisible: true,
  galaxiesVisible: true,
  animatedNebula: true,
  shaderSeed: 0,

  gridEnabled: false,
  gridStyle: 'off',
  gridSpacing: 80,
  gridOpacity: 0.45,
  gridLabels: false,
  gridColor: '#38bdf8',

  counterTheme: 'spacelab',
  hudColor: '#38bdf8',
  windowStyle: 'classic',
  windowColor: '#38bdf8',
  hudScanlines: false,
  hudGlow: false,
  hudChamfer: false,
  compactHud: false,
  highQuality: true,
});

export const THEME_PRESETS: readonly ThemePreset[] = Object.freeze([
  {
    id: 'galactic-spacelab',
    name: 'Spacelab Default',
    description: 'Luminous Milky Way galactic plane with authentic, clean Spacelab flight instrumentation.',
    previewColor: '#ff9933',
    settings: {
      backdropStyle: 'galactic',
      nebulaVisible: true,
      nebulaIntensity: 1.0,
      counterTheme: 'spacelab',
      hudColor: '#38bdf8',
      windowStyle: 'classic',
      windowColor: '#38bdf8',
      gridStyle: 'off',
      gridEnabled: false,
      gridOpacity: 0.45,
      gridColor: '#38bdf8',
      hudGlow: false,
      hudScanlines: false,
      hudChamfer: false,
    },
  },
  {
    id: 'orion-cyber',
    name: 'Dynamic Cosmos & Cyber HUD',
    description: 'Seed-generated deep-sky nebulae, dark dust pillars & spiral galaxies mapped across the universe.',
    previewColor: '#00f0ff',
    settings: {
      backdropStyle: 'nebula',
      nebulaVisible: true,
      nebulaIntensity: 0.65,
      counterTheme: 'cyber',
      hudColor: '#00f0ff',
      windowStyle: 'cyber',
      windowColor: '#00f0ff',
      gridStyle: 'cartesian',
      gridEnabled: true,
      gridOpacity: 0.5,
      gridColor: '#00f0ff',
      hudGlow: true,
      hudScanlines: true,
      hudChamfer: true,
    },
  },
  {
    id: 'carina-solar',
    name: 'Carina Nursery & Solar Gold',
    description: 'Fiery gold and crimson protostellar pillars paired with radiant solar telemetry.',
    previewColor: '#ffd700',
    settings: {
      backdropStyle: 'carina',
      nebulaVisible: true,
      nebulaIntensity: 0.70,
      counterTheme: 'solar',
      hudColor: '#ffd700',
      windowStyle: 'solar',
      windowColor: '#ffd700',
      gridStyle: 'hex',
      gridEnabled: true,
      gridOpacity: 0.4,
      gridColor: '#ffd700',
      hudGlow: true,
      hudScanlines: false,
      hudChamfer: false,
    },
  },
  {
    id: 'galactic-tactical',
    name: 'Milky Way Core & Tactical',
    description: 'Luminous galactic plane and dark dust rifts with military aerospace telemetry.',
    previewColor: '#ff6600',
    settings: {
      backdropStyle: 'galactic',
      nebulaVisible: true,
      nebulaIntensity: 1.1,
      counterTheme: 'tactical',
      hudColor: '#ff6600',
      windowStyle: 'tactical',
      windowColor: '#ff6600',
      gridStyle: 'dots',
      gridEnabled: true,
      gridOpacity: 0.45,
      gridColor: '#ff6600',
      hudGlow: false,
      hudScanlines: false,
      hudChamfer: true,
    },
  },
  {
    id: 'aurora-glass',
    name: 'Auroral Veil & Glassmorphism',
    description: 'Undulating solar wind emerald curtains with frosted glass holographic counters.',
    previewColor: '#00ffaa',
    settings: {
      backdropStyle: 'aurora',
      nebulaVisible: true,
      nebulaIntensity: 1.15,
      counterTheme: 'aurora',
      hudColor: '#00ffaa',
      windowStyle: 'aurora',
      windowColor: '#00ffaa',
      gridStyle: 'cartesian',
      gridEnabled: true,
      gridOpacity: 0.35,
      gridColor: '#00ffaa',
      hudGlow: true,
      hudScanlines: false,
      hudChamfer: false,
    },
  },
  {
    id: 'supernova-radar',
    name: 'Supernova Remnant & Polar Radar',
    description: 'Filamentary shockwave shells centered with polar distance range rings.',
    previewColor: '#ff007f',
    settings: {
      backdropStyle: 'supernova',
      nebulaVisible: true,
      nebulaIntensity: 1.3,
      counterTheme: 'cyber',
      hudColor: '#ff007f',
      windowStyle: 'cyber',
      windowColor: '#ff007f',
      gridStyle: 'polar',
      gridEnabled: true,
      gridOpacity: 0.45,
      gridColor: '#ff007f',
      hudGlow: true,
      hudScanlines: true,
      hudChamfer: true,
    },
  },
  {
    id: 'obsidian-apollo',
    name: 'Deep Field & Apollo 1969 CRT',
    description: 'Pitch-black obsidian void with twinkling distant galaxies and vintage amber phosphor.',
    previewColor: '#ffb300',
    settings: {
      backdropStyle: 'void',
      nebulaVisible: false,
      counterTheme: 'apollo',
      hudColor: '#ffb300',
      windowStyle: 'apollo',
      windowColor: '#ffb300',
      gridStyle: 'polar',
      gridEnabled: true,
      gridOpacity: 0.4,
      gridColor: '#ffb300',
      hudGlow: true,
      hudScanlines: true,
      hudChamfer: false,
    },
  },
  {
    id: 'classic-spacelab',
    name: 'Classic Spacelab Minimal',
    description: 'The original understated slate-blue deep space aesthetic and clean flight instrumentation.',
    previewColor: '#6d8893',
    settings: {
      backdropStyle: 'spacelab',
      nebulaVisible: false,
      counterTheme: 'spacelab',
      hudColor: '#6d8893',
      windowStyle: 'classic',
      windowColor: '#6d8893',
      gridStyle: 'cartesian',
      gridEnabled: true,
      gridOpacity: 0.4,
      gridColor: '#6d8893',
      hudGlow: false,
      hudScanlines: false,
      hudChamfer: false,
    },
  },
  {
    id: 'custom-chroma',
    name: 'Custom Chroma HUD',
    description: 'Full-spectrum customizable HUD instrumentation, custom phosphor colors, and bespoke styling.',
    previewColor: '#a855f7',
    settings: {
      backdropStyle: 'galactic',
      counterTheme: 'custom',
      hudColor: '#a855f7',
      windowStyle: 'classic',
      windowColor: '#a855f7',
      gridStyle: 'cartesian',
      gridEnabled: true,
      gridOpacity: 0.45,
      gridColor: '#a855f7',
      hudGlow: true,
      hudScanlines: false,
      hudChamfer: false,
      compactHud: false,
    },
  },
]);

const THEME_STORAGE_KEY = 'space-sim:theme:v5';
let activeThemeSettings: ThemeSettings = { ...DEFAULT_THEME_SETTINGS };
const listeners = new Set<(settings: ThemeSettings) => void>();

export function getActiveTheme(): ThemeSettings {
  return { ...activeThemeSettings };
}

export function loadThemeSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
      activeThemeSettings = { ...DEFAULT_THEME_SETTINGS, ...parsed };
      return getActiveTheme();
    }
  } catch {
    // Fall back to defaults if storage fails
  }
  activeThemeSettings = { ...DEFAULT_THEME_SETTINGS };
  return getActiveTheme();
}

export function saveThemeSettings(settings: Partial<ThemeSettings>): ThemeSettings {
  activeThemeSettings = { ...activeThemeSettings, ...settings };
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(activeThemeSettings));
  } catch {
    // storage not available
  }
  applyHudThemeToDom(activeThemeSettings);
  for (const fn of listeners) {
    try { fn(activeThemeSettings); } catch { /* ignore */ }
  }
  return getActiveTheme();
}

export function onThemeChange(listener: (settings: ThemeSettings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Converts hex color strings (#RGB or #RRGGBB) to 0..255 RGB integers. */
export function hexToRgb(hex?: string): { r: number; g: number; b: number } {
  if (!hex) return { r: 56, g: 189, b: 248 };
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return { r: 56, g: 189, b: 248 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/** Converts hex color strings to normalized 0.0..1.0 float RGB values for WebGL shaders. */
export function hexToRgb01(hex?: string): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  return { r: r / 255, g: g / 255, b: b / 255 };
}

/** Applies the palette at the document root and synchronizes mounted UI surfaces. */
export function applyHudThemeToDom(settings: ThemeSettings, root?: HTMLElement): void {
  const doc = typeof document === 'undefined' ? undefined : document;
  const scope = root ?? doc?.documentElement;
  if (!scope) return;

  const windowStyle = settings.windowStyle || (settings.counterTheme !== 'custom' ? settings.counterTheme : 'classic');
  const apply = (element: HTMLElement): void => {
    element.setAttribute('data-hud-theme', settings.counterTheme);
    element.setAttribute('data-window-style', windowStyle);
    for (const [property, color] of [
      ['--ui-hud-custom-color', settings.hudColor],
      ['--ui-win-custom-accent', settings.windowColor],
      ['--ui-grid-color', settings.gridColor],
    ] as const) {
      if (color) element.style.setProperty(property, color);
      else element.style.removeProperty(property);
    }
    element.classList.toggle('hud-glow', settings.hudGlow);
    element.classList.toggle('hud-scanlines', settings.hudScanlines);
    element.classList.toggle('hud-chamfer', settings.hudChamfer);
    element.classList.toggle('compact-hud', settings.compactHud);
  };

  apply(scope);
  scope.querySelectorAll<HTMLElement>([
    '#flight-console', '#workspace-drawer', 'dialog', '.chat-overlay',
    '.modal-window', '.inspector-panel', '.flight-window', '#orbit-sandbox-workspace',
  ].join(',')).forEach(apply);
}

// -------------------------------------------------------------------------------------------------
// Realistic Procedural Celestial Astrophotography Engine (Canvas 2D)
// -------------------------------------------------------------------------------------------------

interface CelestialStar {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly baseAlpha: number;
  readonly cr: number;
  readonly cg: number;
  readonly cb: number;
  readonly twinkleRate: number;
  readonly isAnchorStar: boolean;
}

/** Pre-generates deterministic celestial stars clustered along the Milky Way galactic plane. */
function createCelestialStars(count = 420): readonly CelestialStar[] {
  const stars: CelestialStar[] = [];
  let seed = 4289137;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const spectralColors: readonly [number, number, number][] = [
    [255, 255, 255], // Class A (pure white)
    [200, 222, 255], // Class O/B (sapphire / blue-white)
    [225, 238, 255], // Class A/F (pale blue-white)
    [255, 246, 225], // Class G (solar yellow-white)
    [255, 215, 160], // Class K (warm amber)
    [255, 175, 130], // Class M (soft crimson dwarf)
  ];

  for (let i = 0; i < count; i++) {
    let x = (rand() - 0.5) * 3600;
    let y = (rand() - 0.5) * 3600;

    // 55% cluster naturally along the galactic equator Y = X * 0.45
    if (rand() < 0.55) {
      const planeY = x * 0.45;
      const offset = (rand() + rand() - 1.0) * 360;
      y = planeY + offset;
    }

    const mag = rand();
    let r = 0.55 + rand() * 0.3; // 75% tiny sharp subpixel pinpoints
    let baseAlpha = 0.25 + rand() * 0.35;
    let isAnchorStar = false;

    if (i === 42) {
      // The single brightest anchor guide star in the sky (Vega / Sirius magnitude-0)
      r = 2.0;
      baseAlpha = 0.95;
      isAnchorStar = true;
    } else if (mag > 0.95) {
      r = 1.35 + rand() * 0.35;
      baseAlpha = 0.8 + rand() * 0.15;
    } else if (mag > 0.82) {
      r = 0.95 + rand() * 0.3;
      baseAlpha = 0.55 + rand() * 0.2;
    }

    const col = spectralColors[Math.floor(rand() * spectralColors.length)]!;
    stars.push({
      x,
      y,
      r,
      baseAlpha,
      cr: col[0],
      cg: col[1],
      cb: col[2],
      twinkleRate: 1.0 + rand() * 2.5,
      isAnchorStar,
    });
  }
  return Object.freeze(stars);
}

const CELESTIAL_STARS = createCelestialStars(1100);

/** Wraps a celestial coordinate within a virtual sphere span to prevent edge clipping. */
function wrapCelestialCoord(coord: number, span = 3600): number {
  return (((coord % span) + span * 1.5) % span) - span * 0.5;
}

// -------------------------------------------------------------------------------------------------
// High-Performance Procedural Backdrop Canvas 2D Drawing Engine
// -------------------------------------------------------------------------------------------------

export function drawProceduralBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: Camera,
  theme: ThemeSettings,
  timeSec = 0,
  highQuality = true,
): void {
  ctx.save();

  // 1. Base Deep Space Canvas (dark infinite void)
  drawBaseSky(ctx, width, height, theme.backdropStyle);

  // 2. Celestial Sphere Transform:
  // Anchors celestial objects (nebulas, galaxies, starfields) to the celestial sphere.
  // Rotates around the viewport center by -camera.rotation so the cosmos turns smoothly
  // with the spacecraft / telescope orientation rather than looking like static decals.
  // Celestial objects are at astronomical infinity; they have zero translational parallax.
  ctx.save();
  ctx.translate(width * 0.5, height * 0.5);
  ctx.rotate(-camera.rotation);

  // Wall-clock real-time ensures star twinkling and nebula drift remain calm and steady even during time-warp
  const realTimeSec = (typeof performance !== 'undefined' ? performance.now() * 0.001 : timeSec) % 3600;

  // 3. Realistic Volumetric Nebulae (Only on High Graphics)
  if (highQuality && theme.nebulaVisible && theme.backdropStyle !== 'void' && theme.backdropStyle !== 'spacelab') {
    drawRealisticNebulae(ctx, width, height, theme, realTimeSec);
  }

  // 4. Photorealistic Deep Space Galaxies (Grand Spiral + Edge-on Sombrero + Deep Field)
  if (highQuality && theme.galaxiesVisible && theme.backdropStyle !== 'spacelab') {
    drawRealisticGalaxies(ctx, width, height);
  }

  // 5. Authentic Starfield & Cosmic Dust Lanes
  if (theme.starsVisible) {
    drawRealisticStarfield(ctx, width, height, theme, realTimeSec, highQuality);
  }

  ctx.restore(); // Return from celestial rotation to screen space

  // 6. Navigation Grids (Cartesian, Polar Radar Rings, Dots, or Hex)
  if (theme.gridEnabled && theme.gridStyle !== 'off') {
    drawNavigationGrid(ctx, width, height, camera, theme);
  }

  ctx.restore();
}

function drawBaseSky(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: ThemeBackdropStyle,
): void {
  let topColor = '#080f19';
  let bottomColor = '#040810';

  switch (style) {
    case 'nebula':
      topColor = '#050209';
      bottomColor = '#0a0312';
      break;
    case 'carina':
      topColor = '#070202';
      bottomColor = '#100503';
      break;
    case 'galactic':
      topColor = '#020409';
      bottomColor = '#060812';
      break;
    case 'aurora':
      topColor = '#010507';
      bottomColor = '#030c0e';
      break;
    case 'supernova':
      topColor = '#030508';
      bottomColor = '#07030c';
      break;
    case 'void':
      topColor = '#010103';
      bottomColor = '#000002';
      break;
    case 'spacelab':
    default:
      topColor = '#080f19';
      bottomColor = '#050a12';
      break;
  }

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, topColor);
  grad.addColorStop(1, bottomColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

/** Renders photorealistic astrophotography-grade galaxies with soft optical blur. */
function drawRealisticGalaxies(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const maxViewR = Math.hypot(width * 0.5, height * 0.5) + 120;

  ctx.save();

  // -----------------------------------------------------------------------------------------------
  // 1. Grand Design Spiral Galaxy (M81 / Andromeda class)
  // -----------------------------------------------------------------------------------------------
  const g1x = wrapCelestialCoord(-380, 3600);
  const g1y = wrapCelestialCoord(-160, 3600);
  if (Math.hypot(g1x, g1y) < maxViewR + 150) {
    ctx.save();
    ctx.translate(g1x, g1y);
    ctx.rotate(-0.62); // Galaxy disk position angle

    // Layer A: Outer Faint Stellar Halo
    ctx.save();
    if (ctx.scale) ctx.scale(1.0, 0.48); // Inclination 61 degrees
    const halo = ctx.createRadialGradient(0, 0, 5, 0, 0, 130);
    halo.addColorStop(0, 'rgba(255, 245, 220, 0.32)');
    halo.addColorStop(0.25, 'rgba(190, 215, 250, 0.14)');
    halo.addColorStop(0.65, 'rgba(120, 160, 225, 0.04)');
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 130, 0, Math.PI * 2);
    ctx.fill();

    // Layer B: Exponential Stellar Disk
    const disk = ctx.createRadialGradient(0, 0, 2, 0, 0, 80);
    disk.addColorStop(0, 'rgba(255, 235, 180, 0.55)');
    disk.addColorStop(0.35, 'rgba(185, 220, 255, 0.22)');
    disk.addColorStop(0.75, 'rgba(120, 175, 235, 0.06)');
    disk.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = disk;
    ctx.beginPath();
    ctx.arc(0, 0, 80, 0, Math.PI * 2);
    ctx.fill();

    // Layer C: Logarithmic Spiral Arms with Embedded Star-Forming HII Nurseries & Dark Dust Lanes
    for (let arm = 0; arm < 2; arm++) {
      const baseAngle = arm * Math.PI;

      // 1. Arm Luminous Spine
      ctx.beginPath();
      for (let step = 0; step <= 25; step++) {
        const t = step / 25;
        const theta = 0.5 + t * 1.7 * Math.PI;
        const r = 11 * Math.exp(0.26 * theta);
        const x = r * Math.cos(theta + baseAngle);
        const y = r * Math.sin(theta + baseAngle);
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(195, 225, 255, 0.22)';
      ctx.lineWidth = 7;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(220, 240, 255, 0.32)';
      ctx.lineWidth = 3.5;
      ctx.stroke();

      // 2. Interstellar Cold Dark Dust Lane (Absorption along the inner leading edge!)
      ctx.beginPath();
      for (let step = 2; step <= 22; step++) {
        const t = step / 25;
        const theta = 0.5 + t * 1.7 * Math.PI;
        const rDust = (11 * Math.exp(0.26 * theta)) * 0.86;
        const x = rDust * Math.cos(theta + baseAngle + 0.08);
        const y = rDust * Math.sin(theta + baseAngle + 0.08);
        if (step === 2) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(6, 4, 10, 0.72)';
      ctx.lineWidth = 2.4;
      ctx.stroke();

      // 3. Pink HII Star-Forming Emission Nurseries (Hydrogen-Alpha 656nm)
      for (let k = 1; k <= 7; k++) {
        const t = k / 8;
        const theta = 0.7 + t * 1.5 * Math.PI;
        const r = 11 * Math.exp(0.26 * theta) + (k % 2 === 0 ? 3 : -2);
        const x = r * Math.cos(theta + baseAngle);
        const y = r * Math.sin(theta + baseAngle);
        ctx.fillStyle = k % 2 === 0 ? 'rgba(255, 75, 140, 0.7)' : 'rgba(255, 110, 175, 0.5)';
        ctx.beginPath();
        ctx.arc(x, y, 1.4 + (k % 3) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. Young Sapphire-Blue OB Star Clusters
      for (let k = 1; k <= 9; k++) {
        const t = k / 10;
        const theta = 0.85 + t * 1.45 * Math.PI;
        const r = 11 * Math.exp(0.26 * theta) + ((k * 3) % 5) - 2;
        const x = r * Math.cos(theta + baseAngle);
        const y = r * Math.sin(theta + baseAngle);
        ctx.fillStyle = 'rgba(165, 215, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(x, y, 1.1 + (k % 2) * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }


    // Layer D: Radiant Population-II Golden Nuclear Bulge
    const core = ctx.createRadialGradient(0, 0, 1, 0, 0, 24);
    core.addColorStop(0, 'rgba(255, 255, 245, 0.98)');
    core.addColorStop(0.2, 'rgba(255, 235, 170, 0.85)');
    core.addColorStop(0.55, 'rgba(255, 185, 95, 0.38)');
    core.addColorStop(1, 'rgba(180, 110, 40, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();

    // Pinpoint brilliant nucleus
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // Exit inclination scale

    // Layer E: Satellite Dwarf Elliptical Galaxy (M32 companion)
    ctx.save();
    ctx.translate(95, -55);
    if (ctx.scale) ctx.scale(1.2, 0.8);
    const dwarfGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, 14);
    dwarfGrad.addColorStop(0, 'rgba(255, 245, 215, 0.7)');
    dwarfGrad.addColorStop(0.4, 'rgba(230, 210, 180, 0.28)');
    dwarfGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = dwarfGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore(); // Exit Galaxy 1
  }

  // -----------------------------------------------------------------------------------------------
  // 2. Majestic Edge-On Dust-Lane Galaxy (Sombrero M104 / NGC 4565 class)
  // -----------------------------------------------------------------------------------------------
  const g2x = wrapCelestialCoord(420, 3600);
  const g2y = wrapCelestialCoord(160, 3600);
  if (Math.hypot(g2x, g2y) < maxViewR + 150) {
    ctx.save();
    ctx.translate(g2x, g2y);
    ctx.rotate(0.38); // Tilted edge-on perspective

    // Spheroidal glowing halo & core
    const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 42);
    halo.addColorStop(0, 'rgba(255, 248, 220, 0.82)');
    halo.addColorStop(0.3, 'rgba(255, 215, 155, 0.48)');
    halo.addColorStop(0.7, 'rgba(180, 160, 170, 0.12)');
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, Math.PI * 2);
    ctx.fill();

    // Flattened lenticular outer disk
    ctx.save();
    if (ctx.scale) ctx.scale(1.0, 0.22);
    const disk = ctx.createRadialGradient(0, 0, 4, 0, 0, 95);
    disk.addColorStop(0, 'rgba(255, 240, 210, 0.65)');
    disk.addColorStop(0.45, 'rgba(195, 220, 250, 0.26)');
    disk.addColorStop(0.85, 'rgba(130, 175, 225, 0.06)');
    disk.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = disk;
    ctx.beginPath();
    ctx.arc(0, 0, 95, 0, Math.PI * 2);
    ctx.fill();

    // The iconic equatorial dark dust lane bisecting the galaxy
    const dustGrad = ctx.createLinearGradient(-80, 0, 80, 0);
    dustGrad.addColorStop(0, 'rgba(4, 2, 8, 0)');
    dustGrad.addColorStop(0.2, 'rgba(12, 6, 14, 0.70)');
    dustGrad.addColorStop(0.5, 'rgba(8, 4, 10, 0.85)');
    dustGrad.addColorStop(0.8, 'rgba(12, 6, 14, 0.70)');
    dustGrad.addColorStop(1, 'rgba(4, 2, 8, 0)');
    ctx.strokeStyle = dustGrad;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-75, 0);
    ctx.lineTo(75, 0);
    ctx.stroke();

    ctx.restore();

    ctx.restore(); // Exit Galaxy 2
  }

  // -----------------------------------------------------------------------------------------------
  // 3. Deep Field Distant Galaxies (Hubble Ultra Deep Field pinpoints)
  // -----------------------------------------------------------------------------------------------
  const deepFields = [
    { x: -550, y: 350, r: 2.8, tilt: 0.5, cr: 255, cg: 200, cb: 150 }, // Amber distant elliptical
    { x: 520, y: -380, r: 3.2, tilt: -0.3, cr: 170, cg: 215, cb: 255 }, // Pale blue spiral smudge
    { x: -220, y: 440, r: 2.2, tilt: 0.8, cr: 255, cg: 180, cb: 140 }, // High-redshift red dot
    { x: 580, y: 320, r: 2.6, tilt: -0.6, cr: 220, cg: 235, cb: 255 }, // Faint lenticular
  ];

  for (const df of deepFields) {
    const dfx = wrapCelestialCoord(df.x, 3600);
    const dfy = wrapCelestialCoord(df.y, 3600);
    if (Math.hypot(dfx, dfy) > maxViewR + 50) continue;

    ctx.save();
    ctx.translate(dfx, dfy);
    ctx.rotate(df.tilt);
    if (ctx.scale) ctx.scale(1.8, 0.7);

    const dfGrad = ctx.createRadialGradient(0, 0, 0.5, 0, 0, df.r);
    dfGrad.addColorStop(0, `rgba(${df.cr}, ${df.cg}, ${df.cb}, 0.65)`);
    dfGrad.addColorStop(0.5, `rgba(${df.cr}, ${df.cg}, ${df.cb}, 0.25)`);
    dfGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = dfGrad;
    ctx.beginPath();
    ctx.arc(0, 0, df.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  ctx.restore();
}

/** Renders photorealistic volumetric nebulae, ionization filaments, and molecular dust. */
function drawRealisticNebulae(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: ThemeSettings,
  timeSec: number,
): void {
  const intensity = Math.max(0.1, Math.min(2.5, theme.nebulaIntensity));
  const drift = theme.animatedNebula ? Math.sin(timeSec * 0.04) * 8 : 0;
  const maxViewR = Math.hypot(width * 0.5, height * 0.5) + 120;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  if (theme.backdropStyle === 'nebula') {
    // Orion Emission Complex: Localized astrophysical cosmic cloud complexes
    // 1. Soft glowing veils bounded to the cloud complex regions
    const veils = [
      { x: -360, y: -240, r: 480, cr: 32, cg: 10, cb: 26, a: 0.14 }, // Main cloud veil (Northwest)
      { x: 380, y: 220, r: 360, cr: 8, cg: 26, cb: 34, a: 0.12 },   // Companion cloud veil (Southeast)
    ];
    for (const v of veils) {
      const vx = wrapCelestialCoord(v.x + drift * 0.4, 3600);
      const vy = wrapCelestialCoord(v.y - drift * 0.2, 3600);
      if (Math.hypot(vx, vy) > maxViewR + v.r) continue;
      const grad = ctx.createRadialGradient(vx, vy, 10, vx, vy, v.r);
      grad.addColorStop(0, `rgba(${v.cr}, ${v.cg}, ${v.cb}, ${v.a * intensity})`);
      grad.addColorStop(0.5, `rgba(${v.cr}, ${v.cg}, ${v.cb}, ${v.a * 0.4 * intensity})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(vx, vy, v.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Dense Hydrogen-Alpha Billowing Folds (Clustered inside the clouds)
    const hNodes = [
      // Primary Cloud Complex (Northwest)
      { x: -380, y: -240, r: 280, cr: 62, cg: 16, cb: 32, a: 0.20 },
      { x: -460, y: -190, r: 220, cr: 52, cg: 14, cb: 28, a: 0.18 },
      { x: -290, y: -280, r: 210, cr: 48, cg: 12, cb: 24, a: 0.16 },
      { x: -320, y: -170, r: 230, cr: 58, cg: 15, cb: 30, a: 0.18 },
      // Secondary Companion Cloud (Southeast)
      { x: 380, y: 220, r: 220, cr: 54, cg: 14, cb: 28, a: 0.18 },
      { x: 440, y: 280, r: 180, cr: 44, cg: 11, cb: 22, a: 0.15 },
      { x: 310, y: 180, r: 190, cr: 48, cg: 12, cb: 24, a: 0.16 },
    ];
    for (const node of hNodes) {
      const nx = wrapCelestialCoord(node.x + drift, 3600);
      const ny = wrapCelestialCoord(node.y - drift * 0.5, 3600);
      if (Math.hypot(nx, ny) > maxViewR + node.r) continue;
      const rad = ctx.createRadialGradient(nx, ny, 10, nx, ny, node.r);
      rad.addColorStop(0, `rgba(${node.cr}, ${node.cg}, ${node.cb}, ${node.a * intensity})`);
      rad.addColorStop(0.45, `rgba(${node.cr}, ${node.cg}, ${node.cb}, ${node.a * 0.45 * intensity})`);
      rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(nx, ny, node.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Oxygen-III Ionized Cavities (Embedded inside the cloud cores)
    const oNodes = [
      { x: -360, y: -230, r: 180, cr: 10, cg: 42, cb: 52, a: 0.20 },
      { x: -420, y: -270, r: 150, cr: 8, cg: 36, cb: 46, a: 0.16 },
      { x: 380, y: 240, r: 150, cr: 10, cg: 38, cb: 48, a: 0.18 },
    ];
    for (const node of oNodes) {
      const ox = wrapCelestialCoord(node.x + drift * 0.8, 3600);
      const oy = wrapCelestialCoord(node.y - drift * 0.4, 3600);
      if (Math.hypot(ox, oy) > maxViewR + node.r) continue;
      const rad = ctx.createRadialGradient(ox, oy, 5, ox, oy, node.r);
      rad.addColorStop(0, `rgba(${node.cr}, ${node.cg}, ${node.cb}, ${node.a * intensity})`);
      rad.addColorStop(0.45, `rgba(${node.cr}, ${node.cg}, ${node.cb}, ${node.a * 0.38 * intensity})`);
      rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(ox, oy, node.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Dark Molecular Dust Rifts (Cold absorbing dust silhouette)
    if (theme.dustVisible) {
      ctx.globalCompositeOperation = 'source-over';
      const dNodes = [
        { x: -340, y: -210, r: 100, a: 0.65 },
        { x: -400, y: -250, r: 85, a: 0.60 },
        { x: 360, y: 210, r: 80, a: 0.58 },
      ];
      for (const dn of dNodes) {
        const dx = wrapCelestialCoord(dn.x + drift * 0.5, 3600);
        const dy = wrapCelestialCoord(dn.y, 3600);
        if (Math.hypot(dx, dy) > maxViewR + dn.r) continue;
        const dark = ctx.createRadialGradient(dx, dy, 5, dx, dy, dn.r);
        dark.addColorStop(0, `rgba(4, 3, 8, ${dn.a})`);
        dark.addColorStop(0.65, `rgba(4, 3, 8, ${dn.a * 0.35})`);
        dark.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(dx, dy, dn.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (theme.backdropStyle === 'carina') {
    // Carina Pillars of Creation: Fiery gold, amber, and crimson pillars across the sky
    const cVeils = [
      { x: 320, y: -160, r: 620, cr: 140, cg: 60, cb: 10, a: 0.28 },
      { x: -360, y: 220, r: 580, cr: 160, cg: 40, cb: 15, a: 0.26 },
      { x: -260, y: -240, r: 540, cr: 110, cg: 35, cb: 8, a: 0.22 },
      { x: 360, y: 260, r: 520, cr: 130, cg: 70, cb: 12, a: 0.24 },
    ];
    for (const v of cVeils) {
      const vx = wrapCelestialCoord(v.x + drift * 0.3, 3600);
      const vy = wrapCelestialCoord(v.y, 3600);
      if (Math.hypot(vx, vy) > maxViewR + v.r) continue;
      const grad = ctx.createRadialGradient(vx, vy, 10, vx, vy, v.r);
      grad.addColorStop(0, `rgba(${v.cr}, ${v.cg}, ${v.cb}, ${v.a * intensity})`);
      grad.addColorStop(0.5, `rgba(${v.cr}, ${v.cg}, ${v.cb}, ${v.a * 0.4 * intensity})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(vx, vy, v.r, 0, Math.PI * 2);
      ctx.fill();
    }

    const cNodes = [
      { x: 260, y: -120, r: 340, cr: 255, cg: 175, cb: 35, a: 0.36 },
      { x: 380, y: -60, r: 290, cr: 240, cg: 100, cb: 25, a: 0.32 },
      { x: 140, y: -220, r: 270, cr: 255, cg: 215, cb: 65, a: 0.34 },
      { x: -280, y: 180, r: 320, cr: 220, cg: 45, cb: 30, a: 0.30 },
      { x: -160, y: 260, r: 280, cr: 255, cg: 140, cb: 25, a: 0.32 },
      { x: -380, y: -160, r: 290, cr: 195, cg: 40, cb: 20, a: 0.28 },
    ];
    for (const node of cNodes) {
      const nx = wrapCelestialCoord(node.x + drift * 0.8, 3600);
      const ny = wrapCelestialCoord(node.y, 3600);
      if (Math.hypot(nx, ny) > maxViewR + node.r) continue;
      const rad = ctx.createRadialGradient(nx, ny, 10, nx, ny, node.r);
      rad.addColorStop(0, `rgba(${node.cr}, ${node.cg}, ${node.cb}, ${node.a * intensity})`);
      rad.addColorStop(0.4, `rgba(${node.cr}, ${node.cg}, ${node.cb}, ${node.a * 0.45 * intensity})`);
      rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(nx, ny, node.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hot protostellar cores
    const pCores = [
      { x: 250, y: -110, r: 90, cr: 255, cg: 245, cb: 210, a: 0.55 },
      { x: -170, y: 250, r: 80, cr: 255, cg: 235, cb: 190, a: 0.48 },
    ];
    for (const pc of pCores) {
      const px = wrapCelestialCoord(pc.x + drift * 0.8, 3600);
      const py = wrapCelestialCoord(pc.y, 3600);
      if (Math.hypot(px, py) > maxViewR + pc.r) continue;
      const rad = ctx.createRadialGradient(px, py, 2, px, py, pc.r);
      rad.addColorStop(0, `rgba(${pc.cr}, ${pc.cg}, ${pc.cb}, ${pc.a * intensity})`);
      rad.addColorStop(0.5, `rgba(${pc.cr}, ${pc.cg}, ${pc.cb}, ${pc.a * 0.3 * intensity})`);
      rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(px, py, pc.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (theme.dustVisible) {
      ctx.globalCompositeOperation = 'source-over';
      const darkPillars = [
        { x: 220, y: -70, r: 130, a: 0.72 },
        { x: -220, y: 190, r: 110, a: 0.68 },
      ];
      for (const dp of darkPillars) {
        const dx = wrapCelestialCoord(dp.x, 3600);
        const dy = wrapCelestialCoord(dp.y, 3600);
        if (Math.hypot(dx, dy) > maxViewR + dp.r) continue;
        const dark = ctx.createRadialGradient(dx, dy, 10, dx, dy, dp.r);
        dark.addColorStop(0, 'rgba(8, 4, 3, 0.75)');
        dark.addColorStop(0.6, 'rgba(8, 4, 3, 0.4)');
        dark.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(dx, dy, dp.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (theme.backdropStyle === 'galactic') {
    // Milky Way Galactic Core & Great Rift
    ctx.save();
    ctx.rotate(0.48); // Galactic equator tilt

    const bandSpan = maxViewR * 2 + 200;
    const band = ctx.createLinearGradient(0, -280, 0, 280);
    band.addColorStop(0, 'rgba(0, 0, 0, 0)');
    band.addColorStop(0.25, `rgba(180, 195, 230, ${0.16 * intensity})`);
    band.addColorStop(0.5, `rgba(255, 235, 210, ${0.35 * intensity})`);
    band.addColorStop(0.75, `rgba(180, 195, 230, ${0.16 * intensity})`);
    band.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(-bandSpan, -280, bandSpan * 2, 560);

    // Radiant Galactic Nucleus
    const gCore = ctx.createRadialGradient(-80, 0, 5, -80, 0, 380);
    gCore.addColorStop(0, `rgba(255, 248, 220, ${0.72 * intensity})`);
    gCore.addColorStop(0.22, `rgba(255, 215, 145, ${0.48 * intensity})`);
    gCore.addColorStop(0.6, `rgba(165, 145, 195, ${0.16 * intensity})`);
    gCore.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gCore;
    ctx.beginPath();
    ctx.arc(-80, 0, 380, 0, Math.PI * 2);
    ctx.fill();

    // The Great Rift: Cold dark dust clouds splitting the Milky Way stream
    if (theme.dustVisible) {
      ctx.globalCompositeOperation = 'source-over';
      const rift = ctx.createLinearGradient(0, -45, 0, 45);
      rift.addColorStop(0, 'rgba(4, 5, 10, 0)');
      rift.addColorStop(0.35, 'rgba(4, 5, 10, 0.72)');
      rift.addColorStop(0.65, 'rgba(4, 5, 10, 0.72)');
      rift.addColorStop(1, 'rgba(4, 5, 10, 0)');
      ctx.fillStyle = rift;
      ctx.fillRect(-bandSpan, -45, bandSpan * 2, 90);
    }

    ctx.restore();
  } else if (theme.backdropStyle === 'aurora') {
    // Solar Wind Magnetic Veil: Undulating curtains of green & violet
    const wave = Math.sin(timeSec * 0.6) * 35;
    const curtains = [
      { x: -180 + wave, y: -140, r: 420, cr1: '0, 255, 140', cr2: '0, 195, 230', cr3: '120, 45, 230', a: 0.36 },
      { x: 240 - wave, y: 120, r: 460, cr1: '0, 230, 200', cr2: '40, 160, 255', cr3: '160, 30, 220', a: 0.32 },
    ];
    for (const c of curtains) {
      const cx = wrapCelestialCoord(c.x, 3600);
      const cy = wrapCelestialCoord(c.y, 3600);
      if (Math.hypot(cx, cy) > maxViewR + c.r) continue;
      const aGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, c.r);
      aGrad.addColorStop(0, `rgba(${c.cr1}, ${c.a * intensity})`);
      aGrad.addColorStop(0.4, `rgba(${c.cr2}, ${c.a * 0.6 * intensity})`);
      aGrad.addColorStop(0.8, `rgba(${c.cr3}, ${c.a * 0.3 * intensity})`);
      aGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = aGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, c.r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (theme.backdropStyle === 'supernova') {
    // Cygnus Loop Supernova Remnant: Delicate filamentary shockwave shells
    const sx = wrapCelestialCoord(180, 3600);
    const sy = wrapCelestialCoord(-120, 3600);
    const pulse = 1.0 + Math.sin(timeSec * 0.8) * 0.04;

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(0, 240, 225, ${0.32 * intensity})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 240 * pulse, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.8;
    ctx.strokeStyle = `rgba(255, 45, 120, ${0.26 * intensity})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 350 * pulse, 0, Math.PI * 2);
    ctx.stroke();

    const pulsar = ctx.createRadialGradient(sx, sy, 1, sx, sy, 140);
    pulsar.addColorStop(0, `rgba(255, 255, 255, ${0.75 * intensity})`);
    pulsar.addColorStop(0.35, `rgba(0, 215, 255, ${0.32 * intensity})`);
    pulsar.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = pulsar;
    ctx.beginPath();
    ctx.arc(sx, sy, 140, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Renders authentic starfield with physical blackbody temperatures and optical flare on anchor star. */
function drawRealisticStarfield(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: ThemeSettings,
  timeSec: number,
  highQuality: boolean,
): void {
  const density = Math.max(0.2, Math.min(2.5, theme.starDensity));
  const starCount = Math.floor(CELESTIAL_STARS.length * density);
  const maxViewR = Math.hypot(width * 0.5, height * 0.5) + 30;

  ctx.save();

  for (let i = 0; i < starCount; i++) {
    const s = CELESTIAL_STARS[i]!;
    // Anchored to celestial sphere with zero camera translational drift
    const sx = wrapCelestialCoord(s.x, 3600);
    const sy = wrapCelestialCoord(s.y, 3600);

    // Screen circle bounds culling
    if (Math.hypot(sx, sy) > maxViewR) continue;

    let alpha = s.baseAlpha;
    if (highQuality) {
      // Natural subtle stellar scintillation on real wall-clock time
      const tw = Math.sin(timeSec * s.twinkleRate + s.x * 0.05);
      alpha = Math.max(0.12, Math.min(1.0, s.baseAlpha + tw * 0.14));
    }

    ctx.fillStyle = `rgba(${s.cr}, ${s.cg}, ${s.cb}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
    ctx.fill();

    // Delicate optical flare only on the ONE brightest anchor star (Vega/Sirius)
    if (highQuality && s.isAnchorStar && alpha > 0.8) {
      ctx.strokeStyle = `rgba(${s.cr}, ${s.cg}, ${s.cb}, ${alpha * 0.22})`;
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(sx - 12, sy);
      ctx.lineTo(sx + 12, sy);
      ctx.moveTo(sx, sy - 12);
      ctx.lineTo(sx, sy + 12);
      ctx.stroke();
    }
  }

  ctx.restore();
}

// -------------------------------------------------------------------------------------------------
// Navigation Grid Rendering (Cartesian, Polar Radar Rings, Dots, or Hex)
// -------------------------------------------------------------------------------------------------

function drawNavigationGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: Camera,
  theme: ThemeSettings,
): void {
  const opacity = Math.max(0.05, Math.min(1.0, theme.gridOpacity));
  const sp = Math.max(25, theme.gridSpacing);
  const { r: gr, g: gg, b: gb } = hexToRgb(theme.gridColor || '#38bdf8');
  const gridRgba = (a: number) => `rgba(${gr}, ${gg}, ${gb}, ${opacity * a})`;

  ctx.save();

  if (theme.gridStyle === 'cartesian') {
    const cx = Math.floor(width * 0.5) + 0.5;
    const cy = Math.floor(height * 0.5) + 0.5;

    ctx.strokeStyle = gridRgba(0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();

    const maxCols = Math.ceil((width * 0.5) / sp);
    for (let c = -maxCols; c <= maxCols; c++) {
      const x = Math.floor(width * 0.5 + c * sp) + 0.5;
      if (x >= 0 && x <= width) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
    }

    const maxRows = Math.ceil((height * 0.5) / sp);
    for (let r = -maxRows; r <= maxRows; r++) {
      const y = Math.floor(height * 0.5 + r * sp) + 0.5;
      if (y >= 0 && y <= height) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
    }
    ctx.stroke();

    // Central crosshair axes
    ctx.strokeStyle = gridRgba(0.90);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.moveTo(0, cy);
    ctx.lineTo(width, cy);
    ctx.stroke();
  } else if (theme.gridStyle === 'polar') {
    // Polar Radar Rings: Concentric circles around screen center with km markings & reticle
    const cx = width * 0.5;
    const cy = height * 0.5;
    const maxR = Math.hypot(cx, cy);

    ctx.strokeStyle = gridRgba(0.65);
    ctx.lineWidth = 1;
    ctx.fillStyle = gridRgba(0.95);
    ctx.font = '9px ui-monospace, monospace';

    // Central targeting reticle ring at 8px
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.stroke();

    // Concentric range circles
    for (let r = sp; r < maxR; r += sp * 1.5) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      if (theme.gridLabels) {
        // Approximate distance readout based on camera scale
        const distKm = (r / camera.scale) / 1000;
        const tag = distKm >= 1000 ? `${(distKm / 1000).toFixed(1)}M m` : `${distKm.toFixed(0)} km`;
        ctx.fillText(tag, cx + r + 4, cy - 3);
      }
    }

    // 8-point radial navigation spokes: start from r = 16 to avoid center clutter
    ctx.beginPath();
    for (let a = 0; a < 8; a++) {
      const angle = (a * Math.PI) / 4;
      ctx.moveTo(cx + Math.cos(angle) * 16, cy + Math.sin(angle) * 16);
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
    }
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = gridRgba(0.45);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (theme.gridStyle === 'dots') {
    // Tactical Dot Matrix: Discrete circular/cross intersection pips centered on screen
    ctx.fillStyle = gridRgba(0.95);
    const maxCols = Math.ceil((width * 0.5) / sp);
    const maxRows = Math.ceil((height * 0.5) / sp);

    for (let c = -maxCols; c <= maxCols; c++) {
      const x = width * 0.5 + c * sp;
      if (x < -2 || x > width + 2) continue;
      for (let r = -maxRows; r <= maxRows; r++) {
        const y = height * 0.5 + r * sp;
        if (y < -2 || y > height + 2) continue;
        if (c === 0 && r === 0) {
          ctx.fillRect(x - 2, y - 2, 4, 4); // Center pip
        } else {
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      }
    }
  } else if (theme.gridStyle === 'hex') {
    // Hexagonal Astrometric Grid: Honeycomb lattice centered on screen
    const cx = width * 0.5;
    const cy = height * 0.5;
    const hexRadius = sp * 0.65;
    const hexH = hexRadius * Math.sqrt(3);
    const xStep = hexRadius * 1.5;
    const yStep = hexH;
    const maxCols = Math.ceil(cx / xStep) + 1;
    const maxRows = Math.ceil(cy / yStep) + 1;

    ctx.strokeStyle = gridRgba(0.65);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = -maxCols; c <= maxCols; c++) {
      const x = cx + c * xStep;
      const isOdd = Math.abs(c % 2) === 1;
      const yOffset = isOdd ? hexH * 0.5 : 0;
      for (let r = -maxRows; r <= maxRows; r++) {
        const y = cy + yOffset + r * yStep;
        drawHexagonPath(ctx, x, y, hexRadius);
      }
    }
    ctx.stroke();

    // Subtle center origin vertex pip
    ctx.fillStyle = gridRgba(0.85);
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawHexagonPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Converts a theme style string to an integer enum for WebGL GLSL shaders. */
export function themeBackdropToShaderIndex(style: ThemeBackdropStyle): number {
  switch (style) {
    case 'spacelab': return 0;
    case 'nebula': return 1;
    case 'carina': return 2;
    case 'galactic': return 3;
    case 'aurora': return 4;
    case 'supernova': return 5;
    case 'void': return 6;
    case 'pillars': return 7;
    case 'helix': return 8;
    case 'asteroids': return 9;
    default: return 0;
  }
}

/** Converts a grid style string to an integer enum for WebGL GLSL shaders. */
export function themeGridToShaderIndex(style: ThemeGridStyle): number {
  switch (style) {
    case 'cartesian': return 0;
    case 'polar': return 1;
    case 'dots': return 2;
    case 'hex': return 3;
    case 'off': return -1;
    default: return 0;
  }
}
