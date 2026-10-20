import type { ThemeCustomizer, ThemeCustomizerOptions, ThemeSettings, ThemeBackdropStyle, ThemeCounterStyle, ThemeGridStyle, ThemeWindowStyle } from '@space-sim/game-api';
const WINDOW_STYLE_COLORS: Record<ThemeWindowStyle, string> = {
  classic: '#38bdf8', cyber: '#00f0ff', apollo: '#ffb300', tactical: '#ff6600',
  aurora: '#00ffaa', solar: '#ffd700', void: '#94a3b8', crimson: '#ef4444',
};

const COLOR_PALETTE = [
  { label: 'Cyan', color: '#00f0ff' },
  { label: 'Phosphor Amber', color: '#ffb300' },
  { label: 'Solar Gold', color: '#ffd700' },
  { label: 'Hazard Orange', color: '#ff6600' },
  { label: 'Aurora Emerald', color: '#00ffaa' },
  { label: 'Laser Lime', color: '#00ff66' },
  { label: 'Hot Magenta', color: '#ff007f' },
  { label: 'Chroma Purple', color: '#a855f7' },
  { label: 'Combat Crimson', color: '#ef4444' },
  { label: 'Pure White', color: '#ffffff' },
  { label: 'Classic Slate', color: '#38bdf8' },
  { label: 'Spacelab Steel', color: '#6d8893' },
];

export function createThemeCustomizer(options: ThemeCustomizerOptions, css = ''): ThemeCustomizer {
  options.theme.current();
  const document = options.root.ownerDocument, window = document.defaultView;
  if (!window) throw new Error('Theme controls need a browser document');
  const lifetime = new AbortController(), timers = new Set<number>(); let disposed = false;
  const setTimeout = (callback: () => void, ms: number): number => {
    if (disposed) return 0;
    const id = window!.setTimeout(() => { timers.delete(id); if (!disposed) callback(); }, ms); timers.add(id); return id;
  };
  const localStorage = options.storage;
  const DEFAULT_THEME_SETTINGS = options.theme.defaults, THEME_PRESETS = options.theme.presets;
  const getActiveTheme = () => ({ ...options.theme.current() });
  const loadThemeSettings = () => ({ ...options.theme.load() });
  const saveThemeSettings = (value: Partial<ThemeSettings>) => { options.theme.set(value); return getActiveTheme(); };
  const onThemeChange = (listener: (value: ThemeSettings) => void) => options.theme.subscribe(() => listener(getActiveTheme()));
  const created: HTMLElement[] = [];
  if (css) { const style = document.createElement('style'); style.textContent = css; document.head.append(style); created.push(style); }

  let settings = loadThemeSettings();
  options.theme.refresh();

  // 1. Create or bind Dialog DOM
  let dialog = options.root.querySelector('#theme-dialog') as HTMLDialogElement | null;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'theme-dialog';
    dialog.className = 'theme-dialog';
    dialog.setAttribute('aria-labelledby', 'theme-dialog-title');
    options.root.appendChild(dialog); created.push(dialog);
  }

  const priorNodes = [...dialog.childNodes];
  renderDialogContent(dialog, settings, onSettingChanged);
  options.theme.refresh();

  // 2. Toolbar integration in .view-toolbar
  const toolbar = options.root.querySelector('.view-toolbar > div') ?? options.root.querySelector('.view-toolbar');
  let themeButton = options.root.querySelector('#theme-toggle') as HTMLButtonElement | null;
  let gridButton = options.root.querySelector('#grid-toggle') as HTMLButtonElement | null;

  if (toolbar) {
    if (!themeButton) {
      themeButton = document.createElement('button'); created.push(themeButton);
      themeButton.id = 'theme-toggle';
      themeButton.type = 'button';
      themeButton.title = 'Customize Skybox, Procedural Nebulas, Grids & Timers';
      themeButton.setAttribute('aria-haspopup', 'dialog');
      themeButton.innerHTML = 'Theme 🎨';
      toolbar.insertBefore(themeButton, toolbar.firstChild);
    }

    if (!gridButton) {
      gridButton = document.createElement('button'); created.push(gridButton);
      gridButton.id = 'grid-toggle';
      gridButton.type = 'button';
      gridButton.title = 'Toggle navigation grid on/off (G)';
      gridButton.setAttribute('aria-pressed', String(settings.gridEnabled));
      gridButton.textContent = `Grid: ${settings.gridEnabled ? 'On' : 'Off'}`;
      toolbar.insertBefore(gridButton, themeButton.nextSibling);
    }
  }

  // 3. Orbit Sandbox Theme Button Hookup
  const sandboxThemeBtn = options.root.querySelector('#btn-sandbox-theme') ?? options.root.querySelector('#btn-theme-open');
  sandboxThemeBtn?.addEventListener('click', () => open(), { signal: lifetime.signal });

  function syncToolbarButtons(): void {
    if (gridButton) {
      gridButton.setAttribute('aria-pressed', String(settings.gridEnabled));
      gridButton.textContent = `Grid: ${settings.gridEnabled ? 'On' : 'Off'}`;
      gridButton.classList.toggle('active', settings.gridEnabled);
    }
  }
  syncToolbarButtons();

  function onSettingChanged(partial: Partial<ThemeSettings>): void {
    if (disposed) return;
    settings = saveThemeSettings(partial);
    syncToolbarButtons();
    updateLivePreview(dialog!, settings);
  }

  // React to theme changes from anywhere
  const subscription = onThemeChange((newSettings) => {
    settings = newSettings;
    syncToolbarButtons();
    updateControlsUI(dialog!, settings);
    updateLivePreview(dialog!, settings);
  });

  function open(): void {
    if (!dialog || disposed) return;
    updateControlsUI(dialog, settings);
    updateLivePreview(dialog, settings);
    if (typeof dialog.showModal === 'function') {
      try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
    } else {
      dialog.setAttribute('open', '');
    }
    dialog.classList.add('visible');
  }

  function close(): void {
    if (!dialog || disposed) return;
    if (typeof dialog.close === 'function') {
      try { dialog.close(); } catch { dialog.removeAttribute('open'); }
    } else {
      dialog.removeAttribute('open');
    }
    dialog.classList.remove('visible');
  }

  function toggle(): void {
    if (dialog?.open || dialog?.classList.contains('visible')) close();
    else open();
  }

  function toggleGrid(): boolean {
    const next = !settings.gridEnabled;
    const updates: Partial<ThemeSettings> = { gridEnabled: next };
    if (next && (settings.gridStyle === 'off' || !settings.gridStyle)) {
      updates.gridStyle = 'cartesian';
    }
    onSettingChanged(updates);
    return next;
  }

  themeButton?.addEventListener('click', open, { signal: lifetime.signal });
  gridButton?.addEventListener('click', () => toggleGrid(), { signal: lifetime.signal });

  // Global hotkeys: 'G' for grid toggle
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (options.active && !options.active()) return;
    const target = e.target as HTMLElement | null;
    const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (isInput) return;

    if (e.key === 'g' || e.key === 'G') {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleGrid();
      }
    }
  }, { signal: lifetime.signal });

  return {
    open,
    close,
    toggle,
    toggleGrid,
    getSettings: () => ({ ...settings }),
    dispose() {
      if (disposed) return; const errors: unknown[] = [];
      const release = (action: () => void): void => { try { action(); } catch (error) { errors.push(error); } };
      release(close); disposed = true; release(() => lifetime.abort()); release(() => subscription.dispose());
      for (const id of timers) release(() => window!.clearTimeout(id)); timers.clear();
      release(() => { if (dialog && !created.includes(dialog)) dialog.replaceChildren(...priorNodes); });
      for (const element of created) release(() => element.remove());
      created.length = 0;
      if (errors.length) throw new AggregateError(errors, 'Theme controls cleanup failed');
    },
  };

function renderDialogContent(
  dialog: HTMLDialogElement,
  settings: ThemeSettings,
  onChange: (partial: Partial<ThemeSettings>) => void,
): void {
  dialog.innerHTML = `
    <div class="theme-modal-window">
      <div class="theme-modal-header">
        <div class="theme-modal-title-wrap">
          <span class="theme-modal-icon">🎨</span>
          <div>
            <h2 id="theme-dialog-title">Theme & Skybox Customizer</h2>
            <p class="theme-modal-subtitle">Procedural Code-Drawn Backdrops, Grids & Telemetry HUDs</p>
          </div>
        </div>
        <button id="theme-close" type="button" class="theme-close-btn" aria-label="Close theme customizer">✕</button>
      </div>

      <!-- Tabs Navigation -->
      <div class="theme-tabs" role="tablist">
        <button type="button" role="tab" class="theme-tab-btn active" data-tab="tab-skybox">🌌 Skybox & Nebulas</button>
        <button type="button" role="tab" class="theme-tab-btn" data-tab="tab-grids">📐 Navigation Grids</button>
        <button type="button" role="tab" class="theme-tab-btn" data-tab="tab-hud">⏱ HUD Timers & Counters</button>
        <button type="button" role="tab" class="theme-tab-btn" data-tab="tab-manage">⚙ Presets & Export</button>
      </div>

      <div class="theme-tab-body">
        <!-- TAB 1: SKYBOX & NEBULAS -->
        <div id="tab-skybox" class="theme-tab-content active" role="tabpanel">
          <div class="theme-section">
            <h3 class="theme-section-title">Universe Backdrop Style</h3>
            <p class="theme-desc">Select a mathematically generated universe skybox backdrop, drawn 100% by code with zero image textures:</p>
            <div class="theme-grid-selector" id="backdrop-style-selector"></div>
          </div>

          <div class="theme-section">
            <h3 class="theme-section-title">Celestial Beauties & Skybox Toggles</h3>
            <div class="theme-toggle-grid">
              <label class="theme-checkbox-card">
                <input type="checkbox" id="chk-nebula-visible" />
                <div class="theme-checkbox-text">
                  <strong>Procedural Nebula Clouds</strong>
                  <span>Multi-layered cosmic gas and ionization filaments</span>
                </div>
              </label>

              <label class="theme-checkbox-card">
                <input type="checkbox" id="chk-stars-visible" />
                <div class="theme-checkbox-text">
                  <strong>Starfield & Twinkles</strong>
                  <span>Multi-spectral stellar field with time-harmonic pulse</span>
                </div>
              </label>

              <label class="theme-checkbox-card">
                <input type="checkbox" id="chk-dust-visible" />
                <div class="theme-checkbox-text">
                  <strong>Cosmic Dust Lanes</strong>
                  <span>Dark interstellar molecular absorption rifts</span>
                </div>
              </label>

              <label class="theme-checkbox-card">
                <input type="checkbox" id="chk-galaxies-visible" />
                <div class="theme-checkbox-text">
                  <strong>Distant Galaxies</strong>
                  <span>Faint spiral and elliptical deep-field galaxies</span>
                </div>
              </label>

              <label class="theme-checkbox-card">
                <input type="checkbox" id="chk-nebula-anim" />
                <div class="theme-checkbox-text">
                  <strong>Animated Celestial Drift</strong>
                  <span>Subtle time-based plasma and wave fluctuations</span>
                </div>
              </label>
            </div>
          </div>

          <div class="theme-section">
            <h3 class="theme-section-title">Skybox Fine Tuning</h3>
            <div class="theme-slider-row">
              <div class="slider-header">
                <label for="rng-nebula-intensity">Nebula Glow Intensity</label>
                <span id="lbl-nebula-intensity" class="slider-val">100%</span>
              </div>
              <input type="range" id="rng-nebula-intensity" min="10" max="250" step="5" value="100" />
            </div>

            <div class="theme-slider-row">
              <div class="slider-header">
                <label for="rng-star-density">Starfield Density</label>
                <span id="lbl-star-density" class="slider-val">100%</span>
              </div>
              <input type="range" id="rng-star-density" min="20" max="200" step="5" value="100" />
            </div>
          </div>

          <div class="theme-section">
            <div class="slider-header">
              <h3 class="theme-section-title">Procedural Shader Seed</h3>
              <span id="lbl-shader-seed" class="slider-val">Default (Universe)</span>
            </div>
            <p class="theme-desc">Procedural nebulae, starfields, and galaxy alignments are deterministically generated from this seed. Randomize to explore new celestial vistas, or reset back to the universe default:</p>
            <div class="theme-seed-controls">
              <div class="theme-seed-input-wrap">
                <label for="inp-shader-seed">Seed:</label>
                <input type="number" id="inp-shader-seed" min="0" max="999999" step="1" value="0" placeholder="0 (Default)" />
              </div>
              <button type="button" id="btn-randomize-seed" class="theme-btn secondary">🎲 Randomize Seed</button>
              <button type="button" id="btn-reset-seed" class="theme-btn secondary">↺ Reset Seed</button>
            </div>
          </div>
        </div>

        <!-- TAB 2: NAVIGATION GRIDS -->
        <div id="tab-grids" class="theme-tab-content" role="tabpanel" hidden>
          <div class="theme-section">
            <div class="theme-master-switch-row">
              <div>
                <h3 class="theme-section-title">Navigation Grid Overlay</h3>
                <p class="theme-desc">Toggle and customize tactical astrometric grids and coordinate references (Hotkey: <kbd>G</kbd>):</p>
              </div>
              <label class="theme-switch">
                <input type="checkbox" id="chk-grid-master" />
                <span class="theme-slider-switch"></span>
              </label>
            </div>
          </div>

          <div class="theme-section">
            <h3 class="theme-section-title">Grid Geometry & Style</h3>
            <div class="theme-grid-selector" id="grid-style-selector"></div>
          </div>

          <div class="theme-section">
            <h3 class="theme-section-title">Grid Parameters</h3>
            <div class="theme-slider-row">
              <div class="slider-header">
                <label for="rng-grid-spacing">Grid Cell / Ring Spacing</label>
                <span id="lbl-grid-spacing" class="slider-val">80 px</span>
              </div>
              <input type="range" id="rng-grid-spacing" min="30" max="240" step="5" value="80" />
            </div>

            <div class="theme-slider-row">
              <div class="slider-header">
                <label for="rng-grid-opacity">Grid Opacity / Contrast</label>
                <span id="lbl-grid-opacity" class="slider-val">45%</span>
              </div>
              <input type="range" id="rng-grid-opacity" min="10" max="100" step="5" value="45" />
            </div>

            <label class="theme-checkbox-card" style="margin-top: 10px;">
              <input type="checkbox" id="chk-grid-labels" />
              <div class="theme-checkbox-text">
                <strong>Show Distance / Range Ring Labels</strong>
                <span>Annotate range circles with nautical kilometers (e.g., 25 km, 100 km)</span>
              </div>
            </label>
          </div>

          <div class="theme-section">
            <h3 class="theme-section-title">Grid Phosphor Color</h3>
            <p class="theme-desc">Select an authentic HUD phosphor tint or pick a custom color for grid lines and intersection dots:</p>
            <div class="theme-color-swatches" id="grid-color-swatches"></div>
            <div class="theme-custom-color-row">
              <label for="inp-grid-color">Custom Color:</label>
              <input type="color" id="inp-grid-color" class="theme-color-picker" value="#38bdf8" />
              <button type="button" id="btn-reset-grid-color" class="theme-btn secondary small">↺ Follow Active Theme</button>
            </div>
          </div>
        </div>

        <!-- TAB 3: HUD TIMERS & COUNTERS -->
        <div id="tab-hud" class="theme-tab-content" role="tabpanel" hidden>
          <div class="theme-section">
            <h3 class="theme-section-title">Drawn Themes for Timers & Counters</h3>
            <p class="theme-desc">Choose a distinct high-performance drawn theme for the mission clock (T+ 00:00.00) and telemetry instrumentation:</p>
            <div class="theme-grid-selector" id="counter-theme-selector"></div>
          </div>

          <div class="theme-section">
            <h3 class="theme-section-title">HUD Phosphor & Instrumentation Color</h3>
            <p class="theme-desc">Select an authentic phosphor tint or pick any custom color across the full visual spectrum:</p>
            <div class="theme-color-swatches" id="hud-color-swatches"></div>
            <div class="theme-custom-color-row">
              <label for="inp-hud-color">Custom HUD Color:</label>
              <input type="color" id="inp-hud-color" class="theme-color-picker" value="#38bdf8" />
              <button type="button" id="btn-reset-hud-color" class="theme-btn secondary small">↺ Match Active Preset</button>
            </div>
          </div>

          <div class="theme-section">
            <h3 class="theme-section-title">Live HUD Interactive Preview</h3>
            <div id="theme-hud-preview" class="theme-hud-preview-box">
              <div class="view-time preview-time">
                T+ <output id="prev-time">02:45.80</output>
                <span>REAL TIME · 1×</span>
              </div>
              <div class="telemetry preview-telemetry">
                <div><span>ALTITUDE</span><output>512.4</output><small>m</small></div>
                <div><span>SPEED</span><output>284.0</output><small>m/s</small></div>
                <div><span>VERTICAL</span><output>+12.5</output><small>m/s</small></div>
                <div><span>HEADING</span><output>090</output><small>°</small></div>
              </div>
            </div>
          </div>

          <div class="theme-section">
            <h3 class="theme-section-title">HUD Visual Styling Options</h3>
            <div class="theme-toggle-grid">
              <label class="theme-checkbox-card">
                <input type="checkbox" id="chk-hud-glow" />
                <div class="theme-checkbox-text">
                  <strong>Phosphor Bloom & Ambient Glow</strong>
                  <span>Soft luminous emission drop-shadow around readouts</span>
                </div>
              </label>

              <label class="theme-checkbox-card">
                <input type="checkbox" id="chk-hud-scanlines" />
                <div class="theme-checkbox-text">
                  <strong>CRT / Holographic Scanlines</strong>
                  <span>Retro video raster or high-tech HUD scanlines</span>
                </div>
              </label>

              <label class="theme-checkbox-card">
                <input type="checkbox" id="chk-hud-chamfer" />
                <div class="theme-checkbox-text">
                  <strong>Chamfered Angular Bevels</strong>
                  <span>Sci-fi angled corner clips instead of soft rounded rectangles</span>
                </div>
              </label>

              <label class="theme-checkbox-card">
                <input type="checkbox" id="chk-hud-compact" />
                <div class="theme-checkbox-text">
                  <strong>Ultra-Compact HUD</strong>
                  <span>Slimmed down telemetry padding for maximum viewport visibility</span>
                </div>
              </label>
            </div>
          </div>

          <div class="theme-section">
            <h3 class="theme-section-title">Window & Interface Styling</h3>
            <p class="theme-desc">Select the window frame aesthetics for flight drawers, command consoles, and telemetry readouts:</p>
            <div class="theme-grid-selector" id="window-style-selector"></div>
            <div class="theme-custom-color-row" style="margin-top: 10px;">
              <label for="inp-window-color">Custom Window Accent:</label>
              <input type="color" id="inp-window-color" class="theme-color-picker" value="#38bdf8" />
              <button type="button" id="btn-reset-window-color" class="theme-btn secondary small">↺ Follow Active Theme</button>
            </div>
            <div class="theme-slider-row">
              <div class="slider-header"><label for="rng-window-opacity">Window background opacity</label><span id="lbl-window-opacity" class="slider-val">96%</span></div>
              <input type="range" id="rng-window-opacity" min="40" max="100" step="1" value="96" aria-describedby="window-opacity-help" />
              <p id="window-opacity-help" class="theme-desc">Increase for easier reading over bright scenes or other windows. 100% gives a solid background; text stays fully visible.</p>
            </div>
          </div>
        </div>

        <!-- TAB 4: PRESETS & MANAGE -->
        <div id="tab-manage" class="theme-tab-content" role="tabpanel" hidden>
          <div class="theme-section">
            <h3 class="theme-section-title">Pre-Engineered Themes</h3>
            <p class="theme-desc">Apply complete curated visual combinations designed for specific astronomical atmospheres:</p>
            <div class="theme-full-presets-grid" id="full-presets-grid"></div>
          </div>

          <div class="theme-section">
            <h3 class="theme-section-title">Theme Import & Export</h3>
            <div class="theme-manage-actions">
              <button id="btn-save-custom-theme" type="button" class="theme-btn primary">★ Save Current as Custom Preset</button>
              <button id="btn-export-theme" type="button" class="theme-btn secondary">📋 Copy Theme JSON to Clipboard</button>
              <button id="btn-download-theme" type="button" class="theme-btn secondary">💾 Download Theme (.json)</button>
              <button id="btn-import-theme" type="button" class="theme-btn secondary">📂 Import Theme JSON…</button>
              <input type="file" id="inp-theme-file" accept=".json,application/json" hidden />
              <button id="btn-reset-theme" type="button" class="theme-btn danger">↺ Reset to Factory Default</button>
            </div>
            <p id="theme-status-msg" class="theme-status-msg" role="status"></p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind Close Button
  dialog.querySelector('#theme-close')?.addEventListener('click', () => {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    dialog.classList.remove('visible');
  }, { signal: lifetime.signal });

  // Bind Tabs
  const tabButtons = dialog.querySelectorAll<HTMLButtonElement>('.theme-tab-btn');
  const tabPanels = dialog.querySelectorAll<HTMLElement>('.theme-tab-content');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => { p.hidden = true; p.classList.remove('active'); });
      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      const targetPanel = dialog.querySelector<HTMLElement>(`#${targetId}`);
      if (targetPanel) {
        targetPanel.hidden = false;
        targetPanel.classList.add('active');
      }
    }, { signal: lifetime.signal });
  });

  // Populate Backdrop Styles
  const backdropContainer = dialog.querySelector('#backdrop-style-selector')!;
  const backdropStyles: { id: ThemeBackdropStyle; label: string; desc: string; icon: string }[] = [
    { id: 'nebula', label: 'Orion Nebula', desc: 'Swirling magenta, deep violet & cyan ionized gas', icon: '🌌' },
    { id: 'carina', label: 'Carina Nursery', desc: 'Fiery amber, coral & crimson stellar pillars', icon: '🔥' },
    { id: 'galactic', label: 'Spacelab Default', desc: 'Sweeping Milky Way band & dark dust rifts', icon: '✨' },
    { id: 'aurora', label: 'Auroral Veil', desc: 'Undulating emerald green & violet solar winds', icon: '🟢' },
    { id: 'supernova', label: 'Supernova Remnant', desc: 'Filamentary shockwave shells & pulsar pulse', icon: '💥' },
    { id: 'void', label: 'Obsidian Deep Space', desc: 'Pristine black void with twinkling micro-galaxies', icon: '⬛' },
    { id: 'spacelab', label: 'Spacelab Classic', desc: 'Understated slate-blue aerospace dark space', icon: '🛰' },
  ];

  backdropStyles.forEach(s => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `theme-option-card ${settings.backdropStyle === s.id ? 'active' : ''}`;
    card.dataset.backdrop = s.id;
    card.innerHTML = `
      <div class="option-icon">${s.icon}</div>
      <div class="option-info">
        <strong>${s.label}</strong>
        <span>${s.desc}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      dialog.querySelectorAll('[data-backdrop]').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      onChange({ backdropStyle: s.id });
    }, { signal: lifetime.signal });
    backdropContainer.appendChild(card);
  });

  // Populate Grid Styles
  const gridContainer = dialog.querySelector('#grid-style-selector')!;
  const gridStyles: { id: ThemeGridStyle; label: string; desc: string; icon: string }[] = [
    { id: 'cartesian', label: 'Cartesian Coordinate Grid', desc: 'Classic rectangular space reference lines', icon: '⊞' },
    { id: 'polar', label: 'Polar Radar Range Rings', desc: 'Concentric distance circles with km marks & spokes', icon: '◎' },
    { id: 'dots', label: 'Tactical Dot Matrix', desc: 'Subtle high-tech intersection pips', icon: '⁖' },
    { id: 'hex', label: 'Hexagonal Astrometric', desc: 'Futuristic honeycomb navigation lattice', icon: '⬡' },
    { id: 'off', label: 'Grids Off (Clean)', desc: 'Completely unadorned pristine celestial view', icon: '✕' },
  ];

  gridStyles.forEach(s => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `theme-option-card ${settings.gridStyle === s.id ? 'active' : ''}`;
    card.dataset.grid = s.id;
    card.innerHTML = `
      <div class="option-icon">${s.icon}</div>
      <div class="option-info">
        <strong>${s.label}</strong>
        <span>${s.desc}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      dialog.querySelectorAll('[data-grid]').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      onChange({ gridStyle: s.id, gridEnabled: s.id !== 'off' });
    }, { signal: lifetime.signal });
    gridContainer.appendChild(card);
  });

  // Populate Counter Themes
  const counterContainer = dialog.querySelector('#counter-theme-selector')!;
  const counterThemes: { id: ThemeCounterStyle; label: string; desc: string; color: string }[] = [
    { id: 'spacelab', label: 'Classic Spacelab', desc: 'Understated slate-blue and teal aerospace telemetry', color: '#6d8893' },
    { id: 'cyber', label: 'Cyber Neon Cyan', desc: 'Electric cyan phosphor, neon magenta accents & chamfers', color: '#00f0ff' },
    { id: 'apollo', label: 'Retro Mission CRT', desc: 'Vintage mission control amber phosphor & CRT scanlines', color: '#ffb300' },
    { id: 'tactical', label: 'Deep Space Tactical', desc: 'Stealth gunmetal with hazard orange & yellow warnings', color: '#ff6600' },
    { id: 'aurora', label: 'Aurora Glassmorphism', desc: 'Translucent frosted glass with emerald & violet sheen', color: '#00ffaa' },
    { id: 'solar', label: 'Solar Flare Gold', desc: 'Deep obsidian and radiant golden solar observatory readouts', color: '#ffd700' },
    { id: 'custom', label: 'Custom Chroma HUD', desc: 'Bespoke full-spectrum custom colors & instrument styling', color: settings.hudColor || '#a855f7' },
  ];

  counterThemes.forEach(c => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `theme-option-card ${settings.counterTheme === c.id ? 'active' : ''}`;
    card.dataset.counter = c.id;
    card.innerHTML = `
      <div class="option-color-swatch" style="background:${c.color}; box-shadow: 0 0 10px ${c.color}80;"></div>
      <div class="option-info">
        <strong>${c.label}</strong>
        <span>${c.desc}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      dialog.querySelectorAll('[data-counter]').forEach(el => el.classList.remove('active'));
      card.classList.add('active');
      onChange({ counterTheme: c.id });
    }, { signal: lifetime.signal });
    counterContainer.appendChild(card);
  });

  // Populate Color Swatches and Window Styles
  populateGridColorSwatches(dialog, settings, onChange);
  populateHudColorSwatches(dialog, settings, onChange);
  populateWindowStyles(dialog, settings, onChange);

  // Full Preset Cards in Manage Tab
  renderFullPresets(dialog, onChange);

  // Wire Inputs & Sliders
  bindInputs(dialog, onChange);
}



function populateGridColorSwatches(
  dialog: HTMLElement,
  settings: ThemeSettings,
  onChange: (partial: Partial<ThemeSettings>) => void,
): void {
  const container = dialog.querySelector('#grid-color-swatches');
  if (!container) return;
  container.innerHTML = '';

  COLOR_PALETTE.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `theme-color-swatch-btn ${settings.gridColor?.toLowerCase() === c.color.toLowerCase() ? 'active' : ''}`;
    btn.dataset.color = c.color;
    btn.title = c.label;
    btn.innerHTML = `<span class="theme-color-swatch-dot" style="background:${c.color}; box-shadow: 0 0 8px ${c.color}80;"></span><span class="theme-color-swatch-name">${c.label}</span>`;
    btn.addEventListener('click', () => {
      dialog.querySelectorAll('#grid-color-swatches .theme-color-swatch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const inp = dialog.querySelector<HTMLInputElement>('#inp-grid-color');
      if (inp) inp.value = c.color;
      onChange({ gridColor: c.color });
    }, { signal: lifetime.signal });
    container.appendChild(btn);
  });
}

function populateHudColorSwatches(
  dialog: HTMLElement,
  settings: ThemeSettings,
  onChange: (partial: Partial<ThemeSettings>) => void,
): void {
  const container = dialog.querySelector('#hud-color-swatches');
  if (!container) return;
  container.innerHTML = '';

  COLOR_PALETTE.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `theme-color-swatch-btn ${settings.hudColor?.toLowerCase() === c.color.toLowerCase() ? 'active' : ''}`;
    btn.dataset.color = c.color;
    btn.title = c.label;
    btn.innerHTML = `<span class="theme-color-swatch-dot" style="background:${c.color}; box-shadow: 0 0 8px ${c.color}80;"></span><span class="theme-color-swatch-name">${c.label}</span>`;
    btn.addEventListener('click', () => {
      dialog.querySelectorAll('#hud-color-swatches .theme-color-swatch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const inp = dialog.querySelector<HTMLInputElement>('#inp-hud-color');
      if (inp) inp.value = c.color;
      onChange({ hudColor: c.color, counterTheme: 'custom' });
    }, { signal: lifetime.signal });
    container.appendChild(btn);
  });
}

function populateWindowStyles(
  dialog: HTMLElement,
  settings: ThemeSettings,
  onChange: (partial: Partial<ThemeSettings>) => void,
): void {
  const container = dialog.querySelector('#window-style-selector');
  if (!container) return;
  container.innerHTML = '';

  const currentWindowStyle = settings.windowStyle || (settings.counterTheme !== 'custom' ? settings.counterTheme : 'classic') || 'classic';
  const styles: { id: ThemeWindowStyle; label: string; desc: string; icon: string; color: string }[] = [
    { id: 'classic', label: 'Classic Slate', desc: 'Original Spacelab aerospace slate-blue frames', icon: '🛰', color: '#38bdf8' },
    { id: 'cyber', label: 'Cyberpunk Neon', desc: 'Electric cyan luminous chassis and glowing borders', icon: '⚡', color: '#00f0ff' },
    { id: 'apollo', label: 'Retro Mission Control', desc: 'Vintage amber phosphor console styling', icon: '📻', color: '#ffb300' },
    { id: 'tactical', label: 'Tactical Gunmetal', desc: 'Stealth gunmetal with hazard orange accents', icon: '🎯', color: '#ff6600' },
    { id: 'aurora', label: 'Aurora Glass', desc: 'Frosted emerald translucent glassmorphism', icon: '💎', color: '#00ffaa' },
    { id: 'solar', label: 'Solar Gold', desc: 'Radiant golden solar observatory chassis', icon: '☀️', color: '#ffd700' },
    { id: 'void', label: 'Deep Void', desc: 'Pitch obsidian minimalist stealth frames', icon: '⬛', color: '#94a3b8' },
    { id: 'crimson', label: 'Combat Crimson', desc: 'Emergency tactical red alert borders', icon: '🚨', color: '#ef4444' },
  ];

  styles.forEach(s => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `theme-option-card ${currentWindowStyle === s.id ? 'active' : ''}`;
    card.dataset.windowOption = s.id;
    card.innerHTML = `
      <div class="option-icon" style="color:${s.color}; font-size: 20px;">${s.icon}</div>
      <div class="option-info">
        <strong>${s.label}</strong>
        <span>${s.desc}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      dialog.querySelectorAll('#window-style-selector [data-window-option]').forEach(el => el.classList.remove('active'));
      card.classList.add('active');
      onChange({ windowStyle: s.id, windowColor: s.color });
    }, { signal: lifetime.signal });
    container.appendChild(card);
  });
}

function renderFullPresets(dialog: HTMLElement, onChange: (partial: Partial<ThemeSettings>) => void): void {
  const container = dialog.querySelector('#full-presets-grid');
  if (!container) return;
  container.innerHTML = '';

  const presets = [...THEME_PRESETS];
  try {
    const saved = localStorage?.getItem('space-sim:theme:custom-preset');
    if (saved) {
      const custom = JSON.parse(saved) as Partial<ThemeSettings>;
      presets.unshift({
        id: 'saved-custom', name: '★ Custom Theme', description: 'Your saved custom theme.',
        previewColor: custom.windowColor || custom.hudColor || '#a855f7', settings: custom,
      });
    }
  } catch { /* The built-in presets remain available if storage is unavailable. */ }

  presets.forEach(p => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'theme-preset-card';
    card.innerHTML = `
      <div class="preset-card-head">
        <span class="preset-dot lg"></span>
        <strong>${p.name}</strong>
      </div>
      <p>${p.description}</p>
    `;
    const dot = card.querySelector<HTMLElement>('.preset-dot')!;
    dot.style.backgroundColor = p.previewColor;
    dot.style.boxShadow = `0 0 12px ${p.previewColor}80`;
    card.addEventListener('click', () => {
      onChange(p.settings);
      const msg = dialog.querySelector('#theme-status-msg');
      if (msg) {
        msg.textContent = `Applied preset: ${p.name}`;
        setTimeout(() => { if (msg.textContent?.includes(p.name)) msg.textContent = ''; }, 3000);
      }
    }, { signal: lifetime.signal });
    container.appendChild(card);
  });
}

function bindInputs(dialog: HTMLElement, onChange: (partial: Partial<ThemeSettings>) => void): void {
  const el = <T extends HTMLElement>(id: string) => dialog.querySelector<T>(`#${id}`)!;

  // Skybox toggles
  el<HTMLInputElement>('chk-nebula-visible')?.addEventListener('change', e => onChange({ nebulaVisible: (e.target as HTMLInputElement).checked }), { signal: lifetime.signal });
  el<HTMLInputElement>('chk-stars-visible')?.addEventListener('change', e => onChange({ starsVisible: (e.target as HTMLInputElement).checked }), { signal: lifetime.signal });
  el<HTMLInputElement>('chk-dust-visible')?.addEventListener('change', e => onChange({ dustVisible: (e.target as HTMLInputElement).checked }), { signal: lifetime.signal });
  el<HTMLInputElement>('chk-galaxies-visible')?.addEventListener('change', e => onChange({ galaxiesVisible: (e.target as HTMLInputElement).checked }), { signal: lifetime.signal });
  el<HTMLInputElement>('chk-nebula-anim')?.addEventListener('change', e => onChange({ animatedNebula: (e.target as HTMLInputElement).checked }), { signal: lifetime.signal });

  // Skybox sliders
  const rngNebula = el<HTMLInputElement>('rng-nebula-intensity');
  const lblNebula = el<HTMLElement>('lbl-nebula-intensity');
  rngNebula?.addEventListener('input', () => {
    const val = Number(rngNebula.value);
    if (lblNebula) lblNebula.textContent = `${val}%`;
    onChange({ nebulaIntensity: val / 100 });
  }, { signal: lifetime.signal });

  const rngStars = el<HTMLInputElement>('rng-star-density');
  const lblStars = el<HTMLElement>('lbl-star-density');
  rngStars?.addEventListener('input', () => {
    const val = Number(rngStars.value);
    if (lblStars) lblStars.textContent = `${val}%`;
    onChange({ starDensity: val / 100 });
  }, { signal: lifetime.signal });

  // Procedural Shader Seed controls
  const inpSeed = el<HTMLInputElement>('inp-shader-seed');
  const lblSeed = el<HTMLElement>('lbl-shader-seed');
  const btnRandomize = el<HTMLButtonElement>('btn-randomize-seed');
  const btnResetSeed = el<HTMLButtonElement>('btn-reset-seed');

  inpSeed?.addEventListener('change', () => {
    const val = Math.max(0, Math.floor(Number(inpSeed.value) || 0));
    inpSeed.value = String(val);
    if (lblSeed) lblSeed.textContent = val !== 0 ? `Custom (${val})` : 'Default (Universe)';
    onChange({ shaderSeed: val });
  }, { signal: lifetime.signal });

  btnRandomize?.addEventListener('click', () => {
    const nextSeed = Math.floor(Math.random() * 89999) + 1000;
    if (inpSeed) inpSeed.value = String(nextSeed);
    if (lblSeed) lblSeed.textContent = `Custom (${nextSeed})`;
    onChange({ shaderSeed: nextSeed });
  }, { signal: lifetime.signal });

  btnResetSeed?.addEventListener('click', () => {
    if (inpSeed) inpSeed.value = '0';
    if (lblSeed) lblSeed.textContent = 'Default (Universe)';
    onChange({ shaderSeed: 0 });
  }, { signal: lifetime.signal });

  // Grid master switch & controls
  el<HTMLInputElement>('chk-grid-master')?.addEventListener('change', e => onChange({ gridEnabled: (e.target as HTMLInputElement).checked }), { signal: lifetime.signal });
  el<HTMLInputElement>('chk-grid-labels')?.addEventListener('change', e => onChange({ gridLabels: (e.target as HTMLInputElement).checked }), { signal: lifetime.signal });

  const rngSpacing = el<HTMLInputElement>('rng-grid-spacing');
  const lblSpacing = el<HTMLElement>('lbl-grid-spacing');
  rngSpacing?.addEventListener('input', () => {
    const val = Number(rngSpacing.value);
    if (lblSpacing) lblSpacing.textContent = `${val} px`;
    onChange({ gridSpacing: val });
  }, { signal: lifetime.signal });

  const rngOpacity = el<HTMLInputElement>('rng-grid-opacity');
  const lblOpacity = el<HTMLElement>('lbl-grid-opacity');
  rngOpacity?.addEventListener('input', () => {
    const val = Number(rngOpacity.value);
    if (lblOpacity) lblOpacity.textContent = `${val}%`;
    onChange({ gridOpacity: val / 100 });
  }, { signal: lifetime.signal });

  // Grid Color Customization
  const inpGridColor = el<HTMLInputElement>('inp-grid-color');
  inpGridColor?.addEventListener('input', () => {
    onChange({ gridColor: inpGridColor.value });
    dialog.querySelectorAll('#grid-color-swatches .theme-color-swatch-btn').forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.color?.toLowerCase() === inpGridColor.value.toLowerCase());
    });
  }, { signal: lifetime.signal });
  el<HTMLButtonElement>('btn-reset-grid-color')?.addEventListener('click', () => {
    const current = getActiveTheme();
    const activePreset = THEME_PRESETS.find(p => p.settings.counterTheme === current.counterTheme);
    const col = activePreset?.settings.gridColor || '#38bdf8';
    if (inpGridColor) inpGridColor.value = col;
    onChange({ gridColor: col });
  }, { signal: lifetime.signal });

  // HUD Phosphor & Telemetry Color Customization
  const inpHudColor = el<HTMLInputElement>('inp-hud-color');
  inpHudColor?.addEventListener('input', () => {
    onChange({ hudColor: inpHudColor.value, counterTheme: 'custom' });
    dialog.querySelectorAll('#hud-color-swatches .theme-color-swatch-btn').forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.color?.toLowerCase() === inpHudColor.value.toLowerCase());
    });
    dialog.querySelectorAll('#counter-theme-selector [data-counter]').forEach(c => {
      c.classList.toggle('active', (c as HTMLElement).dataset.counter === 'custom');
    });
  }, { signal: lifetime.signal });
  el<HTMLButtonElement>('btn-reset-hud-color')?.addEventListener('click', () => {
    const current = getActiveTheme();
    const activePreset = THEME_PRESETS.find(p => p.settings.counterTheme === current.counterTheme);
    const col = activePreset?.settings.hudColor || '#38bdf8';
    if (inpHudColor) inpHudColor.value = col;
    onChange({ hudColor: col });
  }, { signal: lifetime.signal });

  // HUD styling toggles
  el<HTMLInputElement>('chk-hud-glow')?.addEventListener('change', e => onChange({ hudGlow: (e.target as HTMLInputElement).checked }), { signal: lifetime.signal });
  el<HTMLInputElement>('chk-hud-scanlines')?.addEventListener('change', e => onChange({ hudScanlines: (e.target as HTMLInputElement).checked }), { signal: lifetime.signal });
  el<HTMLInputElement>('chk-hud-chamfer')?.addEventListener('change', e => onChange({ hudChamfer: (e.target as HTMLInputElement).checked }), { signal: lifetime.signal });
  el<HTMLInputElement>('chk-hud-compact')?.addEventListener('change', e => onChange({ compactHud: (e.target as HTMLInputElement).checked }), { signal: lifetime.signal });

  const rngWindowOpacity = el<HTMLInputElement>('rng-window-opacity');
  rngWindowOpacity?.addEventListener('input', () => onChange({windowOpacity:Number(rngWindowOpacity.value)/100}), {signal:lifetime.signal});

  // Window Color Customization
  const inpWinColor = el<HTMLInputElement>('inp-window-color');
  inpWinColor?.addEventListener('input', () => {
    onChange({ windowColor: inpWinColor.value });
  }, { signal: lifetime.signal });
  el<HTMLButtonElement>('btn-reset-window-color')?.addEventListener('click', () => {
    const current = getActiveTheme();
    const col = WINDOW_STYLE_COLORS[current.windowStyle ?? 'classic'];
    if (inpWinColor) inpWinColor.value = col;
    onChange({ windowColor: col });
  }, { signal: lifetime.signal });

  // Export / Import / Reset / Save actions
  const msg = el<HTMLElement>('theme-status-msg');
  const setStatus = (text: string) => {
    if (msg && !disposed) {
      msg.textContent = text;
      setTimeout(() => { if (msg.textContent === text) msg.textContent = ''; }, 4000);
    }
  };

  el<HTMLButtonElement>('btn-save-custom-theme')?.addEventListener('click', () => {
    try {
      localStorage?.setItem('space-sim:theme:custom-preset', JSON.stringify(getActiveTheme()));
      renderFullPresets(dialog, onChange);
      setStatus('Custom preset saved. Apply it from Presets & Export.');
    } catch {
      setStatus('Failed to save custom preset to local storage.');
    }
  }, { signal: lifetime.signal });

  el<HTMLButtonElement>('btn-export-theme')?.addEventListener('click', async () => {
    const json = JSON.stringify(getActiveTheme(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setStatus('Theme JSON copied to clipboard!');
    } catch {
      setStatus('Clipboard copy unavailable; select Download instead.');
    }
  }, { signal: lifetime.signal });

  el<HTMLButtonElement>('btn-download-theme')?.addEventListener('click', () => {
    const json = JSON.stringify(getActiveTheme(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `space-sim-theme-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Theme downloaded.');
  }, { signal: lifetime.signal });

  const fileInput = el<HTMLInputElement>('inp-theme-file');
  el<HTMLButtonElement>('btn-import-theme')?.addEventListener('click', () => fileInput?.click(), { signal: lifetime.signal });
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<ThemeSettings>;
      onChange(parsed);
      setStatus(`Imported theme from ${file.name}!`);
    } catch (err) {
      setStatus(`Failed to import theme: ${err instanceof Error ? err.message : String(err)}`);
    }
    fileInput.value = '';
  }, { signal: lifetime.signal });

  el<HTMLButtonElement>('btn-reset-theme')?.addEventListener('click', () => {
    onChange(DEFAULT_THEME_SETTINGS);
    setStatus('Restored factory default theme.');
  }, { signal: lifetime.signal });
}

function updateControlsUI(dialog: HTMLElement, s: ThemeSettings): void {
  // Highlight active backdrop card
  dialog.querySelectorAll('[data-backdrop]').forEach(c => {
    c.classList.toggle('active', (c as HTMLElement).dataset.backdrop === s.backdropStyle);
  });

  // Highlight active grid card
  dialog.querySelectorAll('[data-grid]').forEach(c => {
    c.classList.toggle('active', (c as HTMLElement).dataset.grid === s.gridStyle);
  });

  // Highlight active counter card
  dialog.querySelectorAll('#counter-theme-selector [data-counter]').forEach(c => {
    c.classList.toggle('active', (c as HTMLElement).dataset.counter === s.counterTheme);
  });

  // Color Pickers
  const inpGridColor = dialog.querySelector<HTMLInputElement>('#inp-grid-color');
  if (inpGridColor && s.gridColor) inpGridColor.value = s.gridColor;

  const inpHudColor = dialog.querySelector<HTMLInputElement>('#inp-hud-color');
  if (inpHudColor && s.hudColor) inpHudColor.value = s.hudColor;

  const inpWinColor = dialog.querySelector<HTMLInputElement>('#inp-window-color');
  if (inpWinColor && s.windowColor) inpWinColor.value = s.windowColor;

  // Highlight active color swatches
  dialog.querySelectorAll('#grid-color-swatches .theme-color-swatch-btn').forEach(b => {
    b.classList.toggle('active', (b as HTMLElement).dataset.color?.toLowerCase() === s.gridColor?.toLowerCase());
  });
  dialog.querySelectorAll('#hud-color-swatches .theme-color-swatch-btn').forEach(b => {
    b.classList.toggle('active', (b as HTMLElement).dataset.color?.toLowerCase() === s.hudColor?.toLowerCase());
  });

  // Window Style selector cards
  const winStyle = s.windowStyle || (s.counterTheme !== 'custom' ? s.counterTheme : 'classic') || 'classic';
  dialog.querySelectorAll('#window-style-selector [data-window-option]').forEach(c => {
    c.classList.toggle('active', (c as HTMLElement).dataset.windowOption === winStyle);
  });

  // Checkboxes
  const setChk = (id: string, val: boolean) => {
    const chk = dialog.querySelector<HTMLInputElement>(`#${id}`);
    if (chk) chk.checked = val;
  };
  setChk('chk-nebula-visible', s.nebulaVisible);
  setChk('chk-stars-visible', s.starsVisible);
  setChk('chk-dust-visible', s.dustVisible);
  setChk('chk-galaxies-visible', s.galaxiesVisible);
  setChk('chk-nebula-anim', s.animatedNebula);
  setChk('chk-grid-master', s.gridEnabled);
  setChk('chk-grid-labels', s.gridLabels);
  setChk('chk-hud-glow', s.hudGlow);
  setChk('chk-hud-scanlines', s.hudScanlines);
  setChk('chk-hud-chamfer', s.hudChamfer);
  setChk('chk-hud-compact', s.compactHud);

  // Sliders & Labels
  const setSlider = (rngId: string, lblId: string, val: number, unit: string) => {
    const rng = dialog.querySelector<HTMLInputElement>(`#${rngId}`);
    const lbl = dialog.querySelector<HTMLElement>(`#${lblId}`);
    if (rng) rng.value = String(val);
    if (lbl) lbl.textContent = `${val}${unit}`;
  };
  setSlider('rng-nebula-intensity', 'lbl-nebula-intensity', Math.round(s.nebulaIntensity * 100), '%');
  setSlider('rng-star-density', 'lbl-star-density', Math.round(s.starDensity * 100), '%');
  setSlider('rng-grid-spacing', 'lbl-grid-spacing', s.gridSpacing, ' px');
  setSlider('rng-grid-opacity', 'lbl-grid-opacity', Math.round(s.gridOpacity * 100), '%');
  setSlider('rng-window-opacity', 'lbl-window-opacity', Math.round(s.windowOpacity * 100), '%');

  // Shader Seed
  const inpSeed = dialog.querySelector<HTMLInputElement>('#inp-shader-seed');
  const lblSeed = dialog.querySelector<HTMLElement>('#lbl-shader-seed');
  const currentSeed = s.shaderSeed ?? 0;
  if (inpSeed) inpSeed.value = String(currentSeed);
  if (lblSeed) lblSeed.textContent = currentSeed !== 0 ? `Custom (${currentSeed})` : 'Default (Universe)';
}

function updateLivePreview(dialog: HTMLElement, s: ThemeSettings): void {
  const preview = dialog.querySelector<HTMLElement>('#theme-hud-preview');
  if (!preview) return;

  const winStyle = s.windowStyle || (s.counterTheme !== 'custom' ? s.counterTheme : 'classic') || 'classic';
  preview.setAttribute('data-hud-theme', s.counterTheme);
  preview.setAttribute('data-window-style', winStyle);
  if (s.hudColor) preview.style.setProperty('--ui-hud-custom-color', s.hudColor);
  else preview.style.removeProperty('--ui-hud-custom-color');
  if (s.windowColor) preview.style.setProperty('--ui-win-custom-accent', s.windowColor);
  else preview.style.removeProperty('--ui-win-custom-accent');
  preview.classList.toggle('hud-glow', s.hudGlow);
  preview.classList.toggle('hud-scanlines', s.hudScanlines);
  preview.classList.toggle('hud-chamfer', s.hudChamfer);
  preview.classList.toggle('compact-hud', s.compactHud);
}

}
