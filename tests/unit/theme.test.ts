import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import {
  DEFAULT_THEME_SETTINGS,
  THEME_PRESETS,
  getActiveTheme,
  loadThemeSettings,
  saveThemeSettings,
  onThemeChange,
  applyHudThemeToDom,
  hexToRgb,
  hexToRgb01,
  drawProceduralBackdrop,
  themeBackdropToShaderIndex,
  themeGridToShaderIndex,
  type ThemeBackdropStyle,
  type ThemeGridStyle,
} from '../../packages/render-2d/src/theme';

describe('theme system', () => {
  beforeEach(() => {
    // Reset localStorage mock
    const storage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value; },
      removeItem: (key: string) => { delete storage[key]; },
      clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
    });
  });

  afterEach(() => {
    saveThemeSettings(DEFAULT_THEME_SETTINGS);
  });

  describe('defaults and presets', () => {
    it('provides sensible default theme settings', () => {
      expect(DEFAULT_THEME_SETTINGS.backdropStyle).toBe('galactic');
      expect(DEFAULT_THEME_SETTINGS.nebulaVisible).toBe(true);
      expect(DEFAULT_THEME_SETTINGS.starsVisible).toBe(true);
      expect(DEFAULT_THEME_SETTINGS.gridEnabled).toBe(false);
      expect(DEFAULT_THEME_SETTINGS.gridStyle).toBe('off');
      expect(DEFAULT_THEME_SETTINGS.counterTheme).toBe('spacelab');
      expect(DEFAULT_THEME_SETTINGS.hudGlow).toBe(false);
      expect(DEFAULT_THEME_SETTINGS.hudScanlines).toBe(false);
      expect(DEFAULT_THEME_SETTINGS.hudChamfer).toBe(false);
      expect(DEFAULT_THEME_SETTINGS.highQuality).toBe(true);
      expect(DEFAULT_THEME_SETTINGS.shaderSeed).toBe(0);
      expect(DEFAULT_THEME_SETTINGS.gridColor).toBe('#38bdf8');
      expect(DEFAULT_THEME_SETTINGS.hudColor).toBe('#38bdf8');
      expect(DEFAULT_THEME_SETTINGS.windowStyle).toBe('classic');
      expect(DEFAULT_THEME_SETTINGS.windowColor).toBe('#38bdf8');
    });

    it('contains all curated theme presets with valid configurations', () => {
      expect(THEME_PRESETS.length).toBe(9);
      const ids = THEME_PRESETS.map(p => p.id);
      expect(ids).toContain('galactic-spacelab');
      expect(ids).toContain('orion-cyber');
      expect(ids).toContain('carina-solar');
      expect(ids).toContain('galactic-tactical');
      expect(ids).toContain('aurora-glass');
      expect(ids).toContain('supernova-radar');
      expect(ids).toContain('obsidian-apollo');
      expect(ids).toContain('classic-spacelab');
      expect(ids).toContain('custom-chroma');

      for (const preset of THEME_PRESETS) {
        expect(preset.name).toBeTruthy();
        expect(preset.description).toBeTruthy();
        expect(preset.previewColor).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(preset.settings.backdropStyle).toBeDefined();
        expect(preset.settings.counterTheme).toBeDefined();
        expect(preset.settings.gridColor).toBeDefined();
        expect(preset.settings.hudColor).toBeDefined();
        expect(preset.settings.windowStyle).toBeDefined();
      }
    });
  });

  describe('settings persistence and reactivity', () => {
    it('loads defaults when storage is empty', () => {
      const settings = loadThemeSettings();
      expect(settings.backdropStyle).toBe(DEFAULT_THEME_SETTINGS.backdropStyle);
      expect(settings.gridEnabled).toBe(DEFAULT_THEME_SETTINGS.gridEnabled);
    });

    it('saves and reloads custom theme settings', () => {
      const updated = saveThemeSettings({
        backdropStyle: 'galactic',
        gridStyle: 'polar',
        gridEnabled: false,
        counterTheme: 'tactical',
        highQuality: false,
      });

      expect(updated.backdropStyle).toBe('galactic');
      expect(updated.gridStyle).toBe('polar');
      expect(updated.gridEnabled).toBe(false);
      expect(updated.counterTheme).toBe('tactical');
      expect(updated.highQuality).toBe(false);

      const reloaded = loadThemeSettings();
      expect(reloaded.backdropStyle).toBe('galactic');
      expect(reloaded.gridStyle).toBe('polar');
      expect(reloaded.gridEnabled).toBe(false);
      expect(getActiveTheme().counterTheme).toBe('tactical');
    });

    it('sets, randomizes and resets procedural shader seed', () => {
      expect(getActiveTheme().shaderSeed).toBe(0);

      // Set custom seed
      const custom = saveThemeSettings({ shaderSeed: 48291 });
      expect(custom.shaderSeed).toBe(48291);
      expect(loadThemeSettings().shaderSeed).toBe(48291);

      // Reset seed back to universe default (0)
      const reset = saveThemeSettings({ shaderSeed: 0 });
      expect(reset.shaderSeed).toBe(0);
      expect(loadThemeSettings().shaderSeed).toBe(0);
    });

    it('notifies subscribers on theme change and unsubscribes properly', () => {
      const listener = vi.fn();
      const unsubscribe = onThemeChange(listener);

      saveThemeSettings({ gridOpacity: 0.8 });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ gridOpacity: 0.8 }));

      unsubscribe();
      saveThemeSettings({ gridOpacity: 0.3 });
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('shader index mappings', () => {
    it('correctly maps backdrop styles to shader integer indices', () => {
      const expectedMappings: Record<ThemeBackdropStyle, number> = {
        'spacelab': 0,
        'nebula': 1,
        'carina': 2,
        'galactic': 3,
        'aurora': 4,
        'supernova': 5,
        'void': 6,
        'pillars': 7,
        'helix': 8,
        'asteroids': 9,
      };

      for (const [style, index] of Object.entries(expectedMappings)) {
        expect(themeBackdropToShaderIndex(style as ThemeBackdropStyle)).toBe(index);
      }
      expect(themeBackdropToShaderIndex('unknown' as ThemeBackdropStyle)).toBe(0);
    });

    it('correctly maps grid styles to shader integer indices', () => {
      const expectedMappings: Record<ThemeGridStyle, number> = {
        'cartesian': 0,
        'polar': 1,
        'dots': 2,
        'hex': 3,
        'off': -1,
      };

      for (const [style, index] of Object.entries(expectedMappings)) {
        expect(themeGridToShaderIndex(style as ThemeGridStyle)).toBe(index);
      }
      expect(themeGridToShaderIndex('unknown' as ThemeGridStyle)).toBe(0);
    });
    it('correctly parses hex color strings to RGB and normalized float values', () => {
      expect(hexToRgb('#38bdf8')).toEqual({ r: 56, g: 189, b: 248 });
      expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
      const f = hexToRgb01('#00f0ff');
      expect(f.r).toBeCloseTo(0.0);
      expect(f.g).toBeCloseTo(0.941, 2);
      expect(f.b).toBeCloseTo(1.0);
    });
  });

  describe('DOM HUD Theme Applicator', () => {
    function createMockElement(): HTMLElement {
      const attrs: Record<string, string> = {};
      const classSet = new Set<string>();
      const styleMap: Record<string, string> = {};
      return {
        setAttribute: vi.fn((k: string, v: string) => { attrs[k] = v; }),
        getAttribute: vi.fn((k: string) => attrs[k] ?? null),
        style: {
          setProperty: vi.fn((prop: string, val: string) => { styleMap[prop] = val; }),
          getPropertyValue: vi.fn((prop: string) => styleMap[prop] ?? ''),
          removeProperty: vi.fn((prop: string) => { delete styleMap[prop]; }),
        },
        classList: {
          add: vi.fn((c: string) => classSet.add(c)),
          remove: vi.fn((c: string) => classSet.delete(c)),
          toggle: vi.fn((c: string, force?: boolean) => {
            const has = force !== undefined ? force : !classSet.has(c);
            if (has) classSet.add(c); else classSet.delete(c);
            return has;
          }),
          contains: vi.fn((c: string) => classSet.has(c)),
        },
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
      } as unknown as HTMLElement;
    }

    it('applies classes and data attributes to target DOM element', () => {
      const el = createMockElement();
      applyHudThemeToDom({
        ...DEFAULT_THEME_SETTINGS,
        counterTheme: 'cyber',
        windowStyle: 'cyber',
        hudColor: '#00f0ff',
        hudGlow: true,
        hudScanlines: true,
        hudChamfer: true,
        compactHud: true,
      }, el);

      expect(el.setAttribute).toHaveBeenCalledWith('data-hud-theme', 'cyber');
      expect(el.setAttribute).toHaveBeenCalledWith('data-window-style', 'cyber');
      expect(el.style.setProperty).toHaveBeenCalledWith('--ui-hud-custom-color', '#00f0ff');
      expect(el.classList.contains('hud-glow')).toBe(true);
      expect(el.classList.contains('hud-scanlines')).toBe(true);
      expect(el.classList.contains('hud-chamfer')).toBe(true);
      expect(el.classList.contains('compact-hud')).toBe(true);
    });

    it('synchronizes every mounted surface and clears stale colors and effects', () => {
      const root = createMockElement();
      const surface = createMockElement();
      vi.mocked(root.querySelectorAll).mockReturnValue([surface] as unknown as NodeListOf<HTMLElement>);
      applyHudThemeToDom({ ...DEFAULT_THEME_SETTINGS, windowColor: '#ef4444', hudGlow: true, hudScanlines: true }, root);
      expect(surface.style.getPropertyValue('--ui-win-custom-accent')).toBe('#ef4444');
      expect(surface.classList.contains('hud-scanlines')).toBe(true);
      applyHudThemeToDom({ ...DEFAULT_THEME_SETTINGS, windowStyle: 'solar', windowColor: undefined, hudColor: undefined, gridColor: undefined }, root);
      for (const element of [root, surface]) {
        expect(element.getAttribute('data-window-style')).toBe('solar');
        expect(element.style.getPropertyValue('--ui-win-custom-accent')).toBe('');
        expect(element.style.getPropertyValue('--ui-hud-custom-color')).toBe('');
        expect(element.style.getPropertyValue('--ui-grid-color')).toBe('');
        expect(element.classList.contains('hud-glow')).toBe(false);
        expect(element.classList.contains('hud-scanlines')).toBe(false);
      }
    });

    it('applies custom chroma theme with custom color', () => {
      const el = createMockElement();
      applyHudThemeToDom({
        ...DEFAULT_THEME_SETTINGS,
        counterTheme: 'custom',
        hudColor: '#ff007f',
        windowStyle: 'classic',
        windowColor: '#ff007f',
      }, el);

      expect(el.setAttribute).toHaveBeenCalledWith('data-hud-theme', 'custom');
      expect(el.setAttribute).toHaveBeenCalledWith('data-window-style', 'classic');
      expect(el.style.setProperty).toHaveBeenCalledWith('--ui-hud-custom-color', '#ff007f');
    });

    it('removes classes when toggled off', () => {
      const el = createMockElement();
      el.classList.add('hud-glow');
      el.classList.add('hud-scanlines');

      applyHudThemeToDom({
        ...DEFAULT_THEME_SETTINGS,
        counterTheme: 'apollo',
        hudGlow: false,
        hudScanlines: false,
        hudChamfer: false,
        compactHud: false,
      }, el);

      expect(el.setAttribute).toHaveBeenCalledWith('data-hud-theme', 'apollo');
      expect(el.classList.contains('hud-glow')).toBe(false);
      expect(el.classList.contains('hud-scanlines')).toBe(false);
      expect(el.classList.contains('hud-chamfer')).toBe(false);
      expect(el.classList.contains('compact-hud')).toBe(false);
    });
  });

  describe('Canvas 2D Procedural Backdrop Renderer', () => {
    function createMock2dContext(): CanvasRenderingContext2D {
      return {
        save: vi.fn(),
        restore: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        arc: vi.fn(),
        scale: vi.fn(),
        rotate: vi.fn(),
        translate: vi.fn(),
        closePath: vi.fn(),
        strokeRect: vi.fn(),
        fillText: vi.fn(),
        createLinearGradient: vi.fn(() => ({
          addColorStop: vi.fn(),
        })),
        createRadialGradient: vi.fn(() => ({
          addColorStop: vi.fn(),
        })),
        setLineDash: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    }

    it('draws increasing star densities without exhausting the deterministic pool', () => {
      const camera = { center: { x: 0, y: 0 }, scale: 1, rotation: 0 };
      let previous = 0;
      for (const starDensity of [0.2, 0.5, 1, 2, 2.5]) {
        const ctx = createMock2dContext();
        drawProceduralBackdrop(ctx, 3600, 3600, camera, {
          ...DEFAULT_THEME_SETTINGS, backdropStyle: 'void', nebulaVisible: false,
          galaxiesVisible: false, starDensity,
        }, 0, false);
        const count = vi.mocked(ctx.arc).mock.calls.length;
        expect(count).toBeGreaterThan(previous);
        previous = count;
      }
      const ctx = createMock2dContext();
      drawProceduralBackdrop(ctx, 3600, 3600, camera, {
        ...DEFAULT_THEME_SETTINGS, backdropStyle: 'void', nebulaVisible: false,
        galaxiesVisible: false, starsVisible: false, starDensity: 2,
      }, 0, false);
      expect(ctx.arc).not.toHaveBeenCalled();
    });

    it('renders all backdrop and grid combinations without error', () => {
      const ctx = createMock2dContext();
      const camera = { center: { x: 500, y: 300 }, scale: 0.05, rotation: 0.1 };

      const backdrops: ThemeBackdropStyle[] = ['spacelab', 'nebula', 'carina', 'galactic', 'aurora', 'supernova', 'void'];
      const grids: ThemeGridStyle[] = ['cartesian', 'polar', 'dots', 'hex', 'off'];

      for (const backdropStyle of backdrops) {
        for (const gridStyle of grids) {
          expect(() => {
            drawProceduralBackdrop(
              ctx,
              1280,
              720,
              camera,
              {
                ...DEFAULT_THEME_SETTINGS,
                backdropStyle,
                gridStyle,
                gridEnabled: true,
                highQuality: true,
              },
              10.5,
              true,
            );
          }).not.toThrow();
        }
      }
    });

    it('respects low graphics mode without throwing', () => {
      const ctx = createMock2dContext();
      const camera = { center: { x: 0, y: 0 }, scale: 1.0, rotation: 0 };

      expect(() => {
        drawProceduralBackdrop(
          ctx,
          800,
          600,
          camera,
          {
            ...DEFAULT_THEME_SETTINGS,
            backdropStyle: 'carina',
            highQuality: false,
          },
          0,
          false,
        );
      }).not.toThrow();
    });

    it('maps all grid styles correctly to GLSL shader mode indices', () => {
      expect(themeGridToShaderIndex('cartesian')).toBe(0);
      expect(themeGridToShaderIndex('polar')).toBe(1);
      expect(themeGridToShaderIndex('dots')).toBe(2);
      expect(themeGridToShaderIndex('hex')).toBe(3);
      expect(themeGridToShaderIndex('off')).toBe(-1);
    });

    it('renders centered cartesian grid crosshairs and lines', () => {
      const ctx = createMock2dContext();
      const camera = { center: { x: 0, y: 0 }, scale: 1.0, rotation: 0 };
      drawProceduralBackdrop(ctx, 800, 600, camera, {
        ...DEFAULT_THEME_SETTINGS,
        gridStyle: 'cartesian',
        gridEnabled: true,
      }, 0, true);
      expect(ctx.stroke).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.lineTo).toHaveBeenCalled();
    });

    it('renders centered polar radar range rings and spokes', () => {
      const ctx = createMock2dContext();
      const camera = { center: { x: 0, y: 0 }, scale: 1.0, rotation: 0 };
      drawProceduralBackdrop(ctx, 800, 600, camera, {
        ...DEFAULT_THEME_SETTINGS,
        gridStyle: 'polar',
        gridEnabled: true,
        gridLabels: true,
      }, 0, true);
      expect(ctx.arc).toHaveBeenCalled();
      expect(ctx.setLineDash).toHaveBeenCalledWith([2, 4]);
      expect(ctx.fillText).toHaveBeenCalled();
    });

    it('renders tactical dot matrix pips', () => {
      const ctx = createMock2dContext();
      const camera = { center: { x: 0, y: 0 }, scale: 1.0, rotation: 0 };
      drawProceduralBackdrop(ctx, 800, 600, camera, {
        ...DEFAULT_THEME_SETTINGS,
        gridStyle: 'dots',
        gridEnabled: true,
      }, 0, true);
      expect(ctx.fillRect).toHaveBeenCalled();
    });

    it('renders hexagonal astrometric honeycomb lattice centered on screen', () => {
      const ctx = createMock2dContext();
      const camera = { center: { x: 0, y: 0 }, scale: 1.0, rotation: 0 };
      drawProceduralBackdrop(ctx, 800, 600, camera, {
        ...DEFAULT_THEME_SETTINGS,
        gridStyle: 'hex',
        gridEnabled: true,
      }, 0, true);
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
    });
  });
});

