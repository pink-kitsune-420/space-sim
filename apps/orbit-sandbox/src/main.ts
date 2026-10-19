import { createActionDock, type DockAction } from '../../../modules/ui-shell/src/index';
import { createWindows } from '../../../modules/ui-windows/src/index';
import type { WindowSystem } from './spacelab/game-api';
import { advanceSandboxFrame, sustainableWarp, SANDBOX_MAX_WARP } from './simulation-clock';
import { nextWarpFactor, WARP_FACTORS } from './spacelab/sim-core';
import { decodeUniverse } from './spacelab/game-library';
import type { Vec } from './spacelab/sim-core';
import { createDefaultSolarSystem, instantiateBody, PRESET_TEMPLATES, createRingBelt } from './presets';
import { computeCircularVelocity, distance, findDominantBody, predictGhostTrajectory, stepSimulation, DEFAULT_FULL_BODY_OPTIONS } from './physics';
import { createRenderer, renderScene, screenToWorld, dragCamera } from './renderer';
import type { CelestialBody, FullBodyOptions, SimulationMode, SlingshotCandidate } from './types';
import { exportUniverseFiles, downloadFile, stageUniverseForSpaceSim, compressUniverse } from './universe-exporter';
import { TEST_SCENARIOS } from './scenarios';
import { validateUniverse, type UniverseDefinition } from './spacelab/sim-core';
import { getActiveTheme, saveThemeSettings, THEME_PRESETS, onThemeChange, applyHudThemeToDom, loadThemeSettings } from './spacelab/render-2d';

export interface OrbitSandboxOptions {
  windows?: WindowSystem;
  inputEnabled?: () => boolean;
  onOpenMenu?: () => void;
  onOpenManual?: () => void;
  onLaunchInSpaceSim?: (universe: UniverseDefinition) => void;
}

export interface OrbitSandboxInstance {
  start(): void;
  stop(): void;
  reset(): void;
  resize(): void;
  isOpen(): boolean;
}

export function initOrbitSandbox(options?: OrbitSandboxOptions): OrbitSandboxInstance {
  const canvas = document.getElementById('orbit-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    return {
      start() {},
      stop() {},
      reset() {},
      resize() {},
      isOpen() { return false; },
    };
  }

  const renderer = createRenderer(canvas);

  let bodies: CelestialBody[] = createDefaultSolarSystem();
  let simulationMode: SimulationMode = 'full-body';
  const fullBodyOptions: FullBodyOptions = { ...DEFAULT_FULL_BODY_OPTIONS };

  let isPaused = false;
  let warpMultiplier = 1.0;
  let isCircularSnapActive = false;
  let activeCandidatePresetId = 'oceanic';
  let activeCandidate: SlingshotCandidate | null = null;
  let simulationTimeSec = 0;
  let isStarted = false;
  let animFrameId: number | null = null;

  // Drag / Input Tracking
  let isDraggingCamera = false;
  let lastPointerScreen: Vec = { x: 0, y: 0 };
  let isSlingshotDragging = false;

  // Inspector Elements
  const inspectorPanel = document.getElementById('planet-inspector') as HTMLElement;
  const inpBodyName = document.getElementById('inp-body-name') as HTMLInputElement;
  const selPreset = document.getElementById('sel-preset') as HTMLSelectElement;
  const rngRadius = document.getElementById('rng-radius') as HTMLInputElement;
  const valRadius = document.getElementById('val-radius') as HTMLElement;
  const rngMu = document.getElementById('rng-mu') as HTMLInputElement;
  const valMu = document.getElementById('val-mu') as HTMLElement;
  const rngRotation = document.getElementById('rng-rotation') as HTMLInputElement;
  const valRotation = document.getElementById('val-rotation') as HTMLElement;
  const rowOceanLevel = document.getElementById('row-ocean-level') as HTMLElement;
  const rngOcean = document.getElementById('rng-ocean') as HTMLInputElement;
  const valOcean = document.getElementById('val-ocean') as HTMLElement;
  const inpAtmoColor = document.getElementById('inp-atmo-color') as HTMLInputElement;
  const chkHasRings = document.getElementById('chk-has-rings') as HTMLInputElement;
  const ringControls = document.getElementById('ring-controls') as HTMLElement;
  const rngRingInner = document.getElementById('rng-ring-inner') as HTMLInputElement;
  const valRingInner = document.getElementById('val-ring-inner') as HTMLElement;
  const rngRingOuter = document.getElementById('rng-ring-outer') as HTMLInputElement;
  const valRingOuter = document.getElementById('val-ring-outer') as HTMLElement;
  const chkShowOrbitLine = document.getElementById('chk-show-orbit-line') as HTMLInputElement;
  const btnFocusBody = document.getElementById('btn-focus-body') as HTMLButtonElement;
  const btnDeleteBody = document.getElementById('btn-delete-body') as HTMLButtonElement;
  const btnCloseInspector = document.getElementById('btn-close-inspector') as HTMLButtonElement;
  const sandboxRoot = canvas.parentElement!;
  const windows = options?.windows ?? createWindows();
  const inspectorWindow = windows.create({
    id: 'sandbox-inspector', title: 'Planet inspector', icon: 'tools', container: sandboxRoot,
    className: 'sandbox-inspector-window',
    place: (container, panel) => ({ x: container.clientWidth - panel.offsetWidth - (container.clientWidth > 650 ? 90 : 16), y: (document.querySelector('.sandbox-header')?.clientHeight ?? 56) + (container.clientWidth > 650 ? 12 : 58) }),
    decorate: panel => applyHudThemeToDom(getActiveTheme(), panel),
    onCloseButton: () => closeInspector(),
  });
  inspectorWindow.body.append(inspectorPanel);
  const inspectorPreviewDot = document.getElementById('inspector-preview-dot') as HTMLElement;
  const btnToggleOrbits = document.getElementById('btn-toggle-orbits') as HTMLButtonElement;
  const btnSandboxMenu = document.getElementById('btn-sandbox-menu') as HTMLButtonElement | null;

  // HUD Elements
  const slingshotHud = document.getElementById('slingshot-hud') as HTMLElement;
  const hudVel = document.getElementById('hud-vel') as HTMLElement;
  const hudCirc = document.getElementById('hud-circ') as HTMLElement;
  const hudAp = document.getElementById('hud-ap') as HTMLElement;
  const hudPe = document.getElementById('hud-pe') as HTMLElement;
  const hudPeriod = document.getElementById('hud-period') as HTMLElement;
  const hudSnapBadge = document.getElementById('hud-snap-badge') as HTMLElement;

  // Modals
  const modalFullBody = document.getElementById('modal-fullbody') as HTMLElement;
  const modalExport = document.getElementById('modal-export') as HTMLElement;
  const toastContainer = document.getElementById('toast-container') as HTMLElement;

  // --- Window Resizing ---
  function resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas!.width = Math.round(width * dpr);
    canvas!.height = Math.round(height * dpr);
    canvas!.style.width = `${width}px`;
    canvas!.style.height = `${height}px`;
    const glCanvas = document.getElementById('orbit-gl-canvas') as HTMLCanvasElement | null;
    if (glCanvas) {
      glCanvas.width = Math.round(width * dpr);
      glCanvas.height = Math.round(height * dpr);
      glCanvas.style.width = `${width}px`;
      glCanvas.style.height = `${height}px`;
    }
    renderer.ctx.setTransform(1, 0, 0, 1, 0, 0);
    renderer.ctx.scale(dpr, dpr);
  }
  window.addEventListener('resize', () => {
    if (isStarted) resizeCanvas();
  });

  // --- Toast System ---
  function showToast(text: string): void {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = text;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  // --- Palette Setup ---
  const paletteContainer = document.getElementById('palette-items') as HTMLElement;
  function setupPalette(): void {
    if (!paletteContainer) return;
    paletteContainer.innerHTML = '';
    for (const template of PRESET_TEMPLATES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.setAttribute('aria-pressed', String(template.id === activeCandidatePresetId));
      card.className = `palette-card ${template.id === activeCandidatePresetId ? 'active' : ''}`;
      card.dataset.id = template.id;

      const dot = document.createElement('span');
      dot.className = 'palette-icon-dot';
      dot.style.backgroundColor = template.color;
      dot.style.color = template.color;

      const name = document.createElement('span');
      name.className = 'palette-card-name';
      name.textContent = template.name;

      card.appendChild(dot);
      card.appendChild(name);

      card.addEventListener('click', () => {
        paletteContainer.querySelectorAll('.palette-card').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
        card.setAttribute('aria-pressed', 'true');
        card.classList.add('active');
        activeCandidatePresetId = template.id;
      });

      paletteContainer.appendChild(card);
    }
  }
  setupPalette();

  // --- Inspector Logic ---
  function getSelectedBody(): CelestialBody | null {
    return bodies.find(b => b.id === renderer.selectedBodyId) ?? null;
  }

  function openInspector(body: CelestialBody): void {
    renderer.selectedBodyId = body.id;
    inspectorPanel.classList.remove('hidden');
    inspectorWindow.open();

    inpBodyName.value = body.name;
    selPreset.value = body.appearance.style === 'banded' ? 'gas-giant' : body.appearance.style;
    inspectorPreviewDot.style.backgroundColor = body.color;

    rngRadius.value = String(body.radius);
    valRadius.textContent = `${Math.round(body.radius)} m`;

    rngMu.value = String(body.mu);
    valMu.textContent = body.mu.toExponential(2);

    rngRotation.value = String(body.rotation.period);
    valRotation.textContent = `${Math.round(body.rotation.period)} s`;

    if (body.appearance.style === 'oceanic') {
      rowOceanLevel.classList.remove('hidden');
      rngOcean.value = String(body.appearance.water ?? 0.7);
      valOcean.textContent = `${Math.round((body.appearance.water ?? 0.7) * 100)}%`;
    } else {
      rowOceanLevel.classList.add('hidden');
    }

    // Atmosphere color hex
    const hexMatch = body.atmosphereColor.slice(0, 7);
    inpAtmoColor.value = hexMatch.length === 7 ? hexMatch : '#4aa3df';

    // Rings
    if (body.rings) {
      chkHasRings.checked = true;
      ringControls.classList.remove('hidden');
      rngRingInner.value = String(body.rings.innerRadius);
      valRingInner.textContent = `${Math.round(body.rings.innerRadius)} m`;
      rngRingOuter.value = String(body.rings.outerRadius);
      valRingOuter.textContent = `${Math.round(body.rings.outerRadius)} m`;
    } else {
      chkHasRings.checked = false;
      ringControls.classList.add('hidden');
    }

    chkShowOrbitLine.checked = body.showOrbitLine !== false;
  }

  function closeInspector(): void {
    renderer.selectedBodyId = null;
    inspectorPanel.classList.add('hidden');
    inspectorWindow.close();
  }

  // Inspector Event Listeners
  inpBodyName.addEventListener('input', () => {
    const b = getSelectedBody();
    if (b) b.name = inpBodyName.value;
  });

  selPreset.addEventListener('change', () => {
    const b = getSelectedBody();
    if (!b) return;
    const template = PRESET_TEMPLATES.find(p => p.id === selPreset.value);
    if (!template) return;

    b.appearance = { ...template.appearance };
    b.color = template.color;
    b.accentColor = template.accentColor;
    b.atmosphereColor = template.atmosphereColor;
    b.surfaceFeatures = template.surfaceFeatures;
    inspectorPreviewDot.style.backgroundColor = b.color;
    openInspector(b);
  });

  rngRadius.addEventListener('input', () => {
    const b = getSelectedBody();
    if (!b) return;
    b.radius = Number(rngRadius.value);
    valRadius.textContent = `${Math.round(b.radius)} m`;
  });

  rngMu.addEventListener('input', () => {
    const b = getSelectedBody();
    if (!b) return;
    b.mu = Number(rngMu.value);
    b.mass = b.mu / 6.67430e-11;
    valMu.textContent = b.mu.toExponential(2);
  });

  rngRotation.addEventListener('input', () => {
    const b = getSelectedBody();
    if (!b) return;
    b.rotation.period = Number(rngRotation.value);
    valRotation.textContent = `${Math.round(b.rotation.period)} s`;
  });

  rngOcean.addEventListener('input', () => {
    const b = getSelectedBody();
    if (!b) return;
    const level = Number(rngOcean.value);
    b.appearance = { ...b.appearance, water: level };
    valOcean.textContent = `${Math.round(level * 100)}%`;
  });

  inpAtmoColor.addEventListener('input', () => {
    const b = getSelectedBody();
    if (!b) return;
    b.atmosphereColor = `${inpAtmoColor.value}60`;
  });

  chkHasRings.addEventListener('change', () => {
    const b = getSelectedBody();
    if (!b) return;
    if (chkHasRings.checked) {
      b.rings = createRingBelt(Math.round(b.radius * 1.5), Math.round(b.radius * 2.5), b.mu);
      ringControls.classList.remove('hidden');
      rngRingInner.value = String(b.rings.innerRadius);
      rngRingOuter.value = String(b.rings.outerRadius);
      valRingInner.textContent = `${Math.round(b.rings.innerRadius)} m`;
      valRingOuter.textContent = `${Math.round(b.rings.outerRadius)} m`;
    } else {
      b.rings = undefined;
      ringControls.classList.add('hidden');
    }
  });

  rngRingInner.addEventListener('input', () => {
    const b = getSelectedBody();
    if (!b?.rings) return;
    b.rings.innerRadius = Number(rngRingInner.value);
    b.rings = createRingBelt(b.rings.innerRadius, b.rings.outerRadius, b.mu);
    valRingInner.textContent = `${Math.round(b.rings.innerRadius)} m`;
  });

  rngRingOuter.addEventListener('input', () => {
    const b = getSelectedBody();
    if (!b?.rings) return;
    b.rings.outerRadius = Number(rngRingOuter.value);
    b.rings = createRingBelt(b.rings.innerRadius, b.rings.outerRadius, b.mu);
    valRingOuter.textContent = `${Math.round(b.rings.outerRadius)} m`;
  });

  chkShowOrbitLine.addEventListener('change', () => {
    const b = getSelectedBody();
    if (b) b.showOrbitLine = chkShowOrbitLine.checked;
  });

  btnFocusBody.addEventListener('click', () => {
    const b = getSelectedBody();
    if (!b) return;
    renderer.camera.center = { x: b.position.x, y: b.position.y };
  });

  btnDeleteBody.addEventListener('click', () => {
    const b = getSelectedBody();
    if (!b) return;
    bodies = bodies.filter(item => item.id !== b.id);
    closeInspector();
    showToast(`Deleted ${b.name}`);
  });

  btnCloseInspector.addEventListener('click', closeInspector);

  // --- Slingshot & Pointer Interactions ---
  function updateCandidateDrag(pointerWorld: Vec): void {
    if (!activeCandidate) return;

    // Velocity points from drag target to origin (pullback sling)
    const dragDx = activeCandidate.origin.x - pointerWorld.x;
    const dragDy = activeCandidate.origin.y - pointerWorld.y;

    // Slingshot pull scale: meters displacement -> m/s launch velocity
    const velocityScale = 0.5;
    let rawVel = { x: dragDx * velocityScale, y: dragDy * velocityScale };

    const parent = findDominantBody(activeCandidate.origin, bodies);
    activeCandidate.parentBody = parent;

    if (parent) {
      const circVel = computeCircularVelocity(activeCandidate.origin, parent, rawVel);
      activeCandidate.circularSpeed = Math.hypot(circVel.x - parent.velocity.x, circVel.y - parent.velocity.y);

      if (activeCandidate.isSnappingCircular) {
        rawVel = circVel;
      }
    }

    activeCandidate.velocity = rawVel;
    activeCandidate.currentSpeed = Math.hypot(rawVel.x, rawVel.y);

    // Compute ghost trajectory
    const prediction = predictGhostTrajectory(
      activeCandidate.origin,
      activeCandidate.velocity,
      bodies,
      simulationMode,
      500,
      fullBodyOptions,
    );

    activeCandidate.ghostPath = prediction.ghostPath;
    activeCandidate.apoapsisRadius = prediction.apoapsisRadius;
    activeCandidate.periapsisRadius = prediction.periapsisRadius;
    activeCandidate.orbitalPeriod = prediction.orbitalPeriod;

    // Update HUD
    slingshotHud.classList.remove('hidden');
    hudVel.textContent = `${activeCandidate.currentSpeed.toFixed(1)} m/s`;
    hudCirc.textContent = parent ? `${activeCandidate.circularSpeed.toFixed(1)} m/s` : '—';
    hudAp.textContent = prediction.apoapsisRadius ? `${(prediction.apoapsisRadius / 1000).toFixed(1)} km` : 'Escape';
    hudPe.textContent = prediction.periapsisRadius ? `${(prediction.periapsisRadius / 1000).toFixed(1)} km` : '—';
    hudPeriod.textContent = prediction.orbitalPeriod ? `${prediction.orbitalPeriod.toFixed(0)} s` : 'Hyperbolic';

    if (activeCandidate.isSnappingCircular) {
      hudSnapBadge.classList.remove('hidden');
    } else {
      hudSnapBadge.classList.add('hidden');
    }
  }

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!isStarted) return;
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const clickScreen = { x: e.clientX, y: e.clientY };
    const clickWorld = screenToWorld(clickScreen, renderer.camera, width, height);

    // Right-click or middle-click: Pan camera
    if (e.button === 2 || e.button === 1) {
      isDraggingCamera = true;
      lastPointerScreen = clickScreen;
      e.preventDefault();
      return;
    }

    // Left-click: Check if clicking an existing celestial body
    let clickedBody: CelestialBody | null = null;
    for (const b of bodies) {
      const d = distance(clickWorld, b.position);
      // Click tolerance: body radius or minimum 14 screen pixels
      const hitRadius = Math.max(b.radius, 14 / renderer.camera.scale);
      if (d <= hitRadius) {
        clickedBody = b;
        break;
      }
    }

    if (clickedBody) {
      openInspector(clickedBody);
      return;
    }

    // Clicked empty space: Start Slingshot launch drag!
    isSlingshotDragging = true;

    activeCandidate = {
      origin: { x: clickWorld.x, y: clickWorld.y },
      currentDrag: { x: clickWorld.x, y: clickWorld.y },
      velocity: { x: 0, y: 0 },
      presetId: activeCandidatePresetId,
      isSnappingCircular: isCircularSnapActive || e.shiftKey,
      parentBody: null,
      ghostPath: [],
      circularSpeed: 0,
      currentSpeed: 0,
      apoapsisRadius: null,
      periapsisRadius: null,
      orbitalPeriod: null,
    };

    updateCandidateDrag(clickWorld);
  });

  window.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isStarted) return;
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const screenPos = { x: e.clientX, y: e.clientY };

    if (isDraggingCamera) {
      const delta = {
        x: screenPos.x - lastPointerScreen.x,
        y: screenPos.y - lastPointerScreen.y,
      };
      renderer.camera = dragCamera(renderer.camera, delta);
      lastPointerScreen = screenPos;
      return;
    }

    if (isSlingshotDragging && activeCandidate) {
      const pointerWorld = screenToWorld(screenPos, renderer.camera, width, height);
      activeCandidate.isSnappingCircular = isCircularSnapActive || e.shiftKey;
      updateCandidateDrag(pointerWorld);
      return;
    }

    // Hover detection
    const worldPos = screenToWorld(screenPos, renderer.camera, width, height);
    let hovered: CelestialBody | null = null;
    for (const b of bodies) {
      const d = distance(worldPos, b.position);
      const hitRadius = Math.max(b.radius, 14 / renderer.camera.scale);
      if (d <= hitRadius) {
        hovered = b;
        break;
      }
    }
    renderer.hoveredBodyId = hovered?.id ?? null;
  });

  window.addEventListener('pointerup', () => {
    if (!isStarted) return;
    if (isDraggingCamera) {
      isDraggingCamera = false;
    }

    if (isSlingshotDragging && activeCandidate) {
      isSlingshotDragging = false;
      slingshotHud.classList.add('hidden');

      // If candidate has launch velocity, spawn into orbit!
      if (activeCandidate.currentSpeed > 0.5) {
        const newBody = instantiateBody(
          activeCandidate.presetId,
          activeCandidate.origin,
          activeCandidate.velocity,
        );
        if (activeCandidate.parentBody) {
          newBody.parentId = activeCandidate.parentBody.id;
        }
        bodies.push(newBody);
        showToast(`Spawned ${newBody.name} into orbit!`);
      }
      activeCandidate = null;
    }
  });

  // Mouse Wheel Zoom centered on cursor
  canvas.addEventListener('wheel', (e: WheelEvent) => {
    if (!isStarted) return;
    e.preventDefault();
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const pointerScreen = { x: e.clientX, y: e.clientY };
    const worldBefore = screenToWorld(pointerScreen, renderer.camera, width, height);

    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(0.00005, Math.min(2.0, renderer.camera.scale * zoomFactor));

    renderer.camera.scale = newScale;

    // Re-adjust camera center so world coordinate under cursor stays invariant
    const worldAfter = screenToWorld(pointerScreen, renderer.camera, width, height);
    renderer.camera.center.x += (worldBefore.x - worldAfter.x);
    renderer.camera.center.y += (worldBefore.y - worldAfter.y);
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e: MouseEvent) => e.preventDefault());

  // --- Keyboard Shortcuts ---
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!isStarted || document.getElementById('orbit-sandbox-workspace')?.hidden || options?.inputEnabled?.() === false) return;
    if ((e.target as HTMLElement)?.closest('input, select, textarea, summary, a, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    // Space/Enter keep native button activation; warp keys work after toolbar clicks.
    if ((e.target as HTMLElement)?.closest('button') && (e.code === 'Space' || e.code === 'Enter')) return;

    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!modalFullBody.classList.contains('hidden')) {
        modalFullBody.classList.add('hidden');
        e.preventDefault();
        return;
      }
      if (!modalExport.classList.contains('hidden')) {
        modalExport.classList.add('hidden');
        e.preventDefault();
        return;
      }
      if (!modalTesting.classList.contains('hidden')) {
        modalTesting.classList.add('hidden');
        e.preventDefault();
        return;
      }
      if (!inspectorPanel.classList.contains('hidden')) {
        closeInspector();
        e.preventDefault();
        return;
      }
      // If nothing is open in Orbit Sandbox, open Load Game menu
      options?.onOpenMenu?.();
      e.preventDefault();
      return;
    }

    if (e.code === 'Space' || e.code === 'KeyP') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.code === 'BracketRight' || e.code === 'Period') {
      e.preventDefault(); changeWarp(1);
    } else if (e.code === 'BracketLeft' || e.code === 'Comma') {
      e.preventDefault(); changeWarp(-1);
    } else if (e.code === 'Slash') {
      e.preventDefault(); setWarp(1);
    } else if (e.code === 'KeyR') {
      e.preventDefault(); resetWorld();
    } else if (e.code === 'KeyC') {
      toggleCircularize();
    } else if (e.code === 'KeyO') {
      toggleOrbitLines();
    } else if (e.code === 'KeyG') {
      const current = getActiveTheme();
      const nextGrid = !current.gridEnabled;
      saveThemeSettings({ gridEnabled: nextGrid });
      showToast(nextGrid ? 'Navigation Grid: ON' : 'Navigation Grid: OFF');
    } else if (e.code === 'KeyT') {
      modalTesting.classList.toggle('hidden');
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
      const b = getSelectedBody();
      if (b) {
        bodies = bodies.filter(item => item.id !== b.id);
        closeInspector();
        showToast(`Deleted ${b.name}`);
      }
    } else if (e.key === 'Shift') {
      if (activeCandidate) {
        activeCandidate.isSnappingCircular = true;
      }
    }
  }, { capture: true });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    if (!isStarted || document.getElementById('orbit-sandbox-workspace')?.hidden) return;
    if (e.key === 'Shift') {
      if (activeCandidate && !isCircularSnapActive) {
        activeCandidate.isSnappingCircular = false;
      }
    }
  });

  // --- Header Controls ---
  const btnPlayPause = document.getElementById('btn-play-pause') as HTMLButtonElement;
  const playIcon = document.getElementById('play-icon') as HTMLElement;
  function togglePlayPause(): void {
    isPaused = !isPaused;
    if (playIcon) playIcon.textContent = isPaused ? 'Resume' : 'Pause';
    btnPlayPause?.setAttribute('aria-pressed', String(isPaused));
    showToast(isPaused ? 'Simulation Paused' : 'Simulation Running');
  }
  btnPlayPause?.addEventListener('click', togglePlayPause);

  // Flight warp controls; the clock adds bounded numerical steps as warp increases.
  const warpDisplay = document.getElementById('sandbox-warp-factor') as HTMLSelectElement;
  for (const factor of [.2, ...WARP_FACTORS]) {
    const option = document.createElement('option'); option.value = String(factor); option.textContent = `${factor}×`; warpDisplay.append(option);
  }
  warpDisplay.addEventListener('change', () => { setWarp(Number(warpDisplay.value)); canvas.focus({ preventScroll: true }); });
  const warpDown = document.getElementById('sandbox-warp-down') as HTMLButtonElement;
  const warpUp = document.getElementById('sandbox-warp-up') as HTMLButtonElement;
  const warpStatus = document.getElementById('sandbox-warp-status')!;
  const disableLimiter = document.getElementById('sandbox-disable-limiter') as HTMLInputElement;
  // Firefox may restore form values on reload; the debug bypass is never a saved preference.
  disableLimiter.checked = false;
  let overloadSeconds = 0, integratedSeconds = 0, sampledWallSeconds = 0;
  let warningUntil = 0;
  function setWarp(value: number): void {
    overloadSeconds = integratedSeconds = sampledWallSeconds = 0;
    warningUntil = 0;
    warpStatus.hidden = !disableLimiter.checked;
    warpStatus.textContent = disableLimiter.checked ? 'CPU limiter off (debug)' : '';
    warpMultiplier = Math.max(.2, Math.min(SANDBOX_MAX_WARP, value));
    warpDisplay.value = String(warpMultiplier);
    warpDown.disabled = warpMultiplier <= .2;
    warpUp.disabled = warpMultiplier >= SANDBOX_MAX_WARP;
  }
  function changeWarp(direction: -1 | 1): void {
    setWarp(direction < 0 && warpMultiplier <= 1 ? .2 : nextWarpFactor(warpMultiplier, direction, SANDBOX_MAX_WARP));
  }
  warpDown?.addEventListener('click', () => changeWarp(-1));
  warpUp?.addEventListener('click', () => changeWarp(1));
  document.getElementById('sandbox-warp-reset')?.addEventListener('click', () => setWarp(1));
  setWarp(1);
  disableLimiter.addEventListener('change', () => {
    overloadSeconds = integratedSeconds = sampledWallSeconds = 0;
    warpStatus.hidden = !disableLimiter.checked;
    warpStatus.textContent = disableLimiter.checked ? 'CPU limiter off (debug)' : '';
  });
  const labelsButton = document.getElementById('sandbox-labels');
  try { renderer.showBodyLabels = localStorage.getItem('spacelab:sandbox-labels') !== 'false'; } catch { /* Optional viewer preference. */ }
  const updateLabels = () => {
    labelsButton?.setAttribute('aria-pressed', String(renderer.showBodyLabels));
    labelsButton?.classList.toggle('active', renderer.showBodyLabels);
  };
  labelsButton?.addEventListener('click', () => {
    renderer.showBodyLabels = !renderer.showBodyLabels; updateLabels();
    try { localStorage.setItem('spacelab:sandbox-labels', String(renderer.showBodyLabels)); } catch { /* Optional viewer preference. */ }
  });
  updateLabels();

  // Physics Mode Switchers
  const btnKepler = document.getElementById('mode-kepler') as HTMLButtonElement;
  const btnNBody = document.getElementById('mode-nbody') as HTMLButtonElement;
  const btnFullBody = document.getElementById('mode-fullbody') as HTMLButtonElement;

  function setPhysicsMode(mode: SimulationMode, announce = true): void {
    simulationMode = mode;
    [btnKepler, btnNBody, btnFullBody].forEach(b => b?.classList.remove('active'));
    if (mode === 'kepler') btnKepler?.classList.add('active');
    if (mode === 'nbody') btnNBody?.classList.add('active');
    if (mode === 'full-body') btnFullBody?.classList.add('active');
    if (announce) showToast(`Physics Mode: ${mode.toUpperCase()}`);
  }
  btnKepler?.addEventListener('click', () => setPhysicsMode('kepler'));
  btnNBody?.addEventListener('click', () => setPhysicsMode('nbody'));
  btnFullBody?.addEventListener('click', () => setPhysicsMode('full-body'));

  // Circularize Toggle Button
  const btnCircularizeToggle = document.getElementById('btn-circularize-toggle') as HTMLButtonElement;
  function toggleCircularize(): void {
    isCircularSnapActive = !isCircularSnapActive;
    btnCircularizeToggle?.classList.toggle('active', isCircularSnapActive);
    showToast(isCircularSnapActive ? 'Circularize Snap: ON' : 'Circularize Snap: OFF');
  }
  btnCircularizeToggle?.addEventListener('click', toggleCircularize);

  // Orbit guides are a local display preference, independent of the simulation.
  try { renderer.showOrbitLines = localStorage.getItem('spacelab:sandbox-orbits') !== 'false'; } catch { /* Optional viewer preference. */ }
  function updateOrbitLines(): void {
    btnToggleOrbits?.classList.toggle('active', renderer.showOrbitLines);
    btnToggleOrbits?.setAttribute('aria-pressed', String(renderer.showOrbitLines));
  }
  updateOrbitLines();
  function toggleOrbitLines(): void {
    renderer.showOrbitLines = !renderer.showOrbitLines;
    updateOrbitLines();
    try { localStorage.setItem('spacelab:sandbox-orbits', String(renderer.showOrbitLines)); } catch { /* Optional viewer preference. */ }
    showToast(renderer.showOrbitLines ? 'Planet Orbit Lines: ON' : 'Planet Orbit Lines: OFF');
  }
  btnToggleOrbits?.addEventListener('click', toggleOrbitLines);

  // Grid Toggle Button
  const btnToggleGrid = (document.getElementById('btn-sandbox-grid') || document.getElementById('btn-toggle-grid')) as HTMLButtonElement | null;
  function updateGridButtonState(enabled: boolean): void {
    if (btnToggleGrid) {
      btnToggleGrid.classList.toggle('active', enabled);
      btnToggleGrid.setAttribute('aria-pressed', String(enabled));
    }
  }
  onThemeChange(theme => {
    updateGridButtonState(theme.gridEnabled);
  });
  updateGridButtonState(getActiveTheme().gridEnabled);

  btnToggleGrid?.addEventListener('click', () => {
    const current = getActiveTheme();
    const next = !current.gridEnabled;
    saveThemeSettings({ gridEnabled: next });
    showToast(next ? 'Navigation Grid: ON' : 'Navigation Grid: OFF');
  });

  // Theme Customizer / Presets Button
  const btnThemeOpen = (document.getElementById('btn-sandbox-theme') || document.getElementById('btn-theme-open')) as HTMLButtonElement | null;
  btnThemeOpen?.addEventListener('click', () => {
    const hostThemeToggle = document.getElementById('theme-toggle');
    if (hostThemeToggle) {
      hostThemeToggle.click();
    } else {
      const current = getActiveTheme();
      const currentIdx = THEME_PRESETS.findIndex(p => Object.entries(p.settings).every(([key, value]) => current[key as keyof typeof current] === value));
      const nextPreset = THEME_PRESETS[(currentIdx + 1) % THEME_PRESETS.length] ?? THEME_PRESETS[0];
      if (nextPreset) {
        saveThemeSettings(nextPreset.settings);
        showToast(`Theme: ${nextPreset.name}`);
      }
    }
  });

  // One fresh-world path for the toolbar, keyboard and library's Play action.
  function resetWorld(): void {
    bodies = createDefaultSolarSystem();
    simulationTimeSec = 0; isPaused = false;
    activeCandidate = null; isSlingshotDragging = isDraggingCamera = false;
    isCircularSnapActive = false; activeCandidatePresetId = 'oceanic';
    renderer.hoveredBodyId = null; closeInspector();
    renderer.camera.center = { x: 12000, y: 0 }; renderer.camera.scale = .0075; renderer.camera.rotation = 0;
    Object.assign(fullBodyOptions, DEFAULT_FULL_BODY_OPTIONS); setPhysicsMode('full-body', false);
    disableLimiter.checked = false; setWarp(1);
    playIcon.textContent = 'Pause'; btnPlayPause.setAttribute('aria-pressed', 'false');
    btnCircularizeToggle?.classList.remove('active');
    setupPalette(); slingshotHud.classList.add('hidden');
    for (const modal of [modalFullBody, modalExport, modalTesting]) modal.classList.add('hidden');
    lastFrameTime = performance.now();
  }
  document.getElementById('btn-reset')?.addEventListener('click', () => { resetWorld(); showToast('Solar system reset to default Primus'); });

  document.getElementById('btn-clear')?.addEventListener('click', () => {
    bodies = [];
    closeInspector();
    showToast('All bodies cleared');
  });

  // Load Game / Menu button in Header
  btnSandboxMenu?.addEventListener('click', () => {
    options?.onOpenMenu?.();
  });

  // --- Full Body Settings Modal ---
  const btnFullBodySettings = document.getElementById('btn-fullbody-settings') as HTMLButtonElement;
  const btnCloseFullBody = document.getElementById('btn-close-fullbody') as HTMLButtonElement;
  const btnSaveFullBody = document.getElementById('btn-save-fullbody') as HTMLButtonElement;
  const chkFbJ2 = document.getElementById('chk-fb-j2') as HTMLInputElement;
  const chkFbTidal = document.getElementById('chk-fb-tidal') as HTMLInputElement;
  const radCollisions = document.querySelectorAll('input[name="rad-collision"]') as NodeListOf<HTMLInputElement>;
  const rowRestitution = document.getElementById('row-restitution') as HTMLElement;
  const rngRestitution = document.getElementById('rng-restitution') as HTMLInputElement;
  const valRestitution = document.getElementById('val-restitution') as HTMLElement;

  btnFullBodySettings?.addEventListener('click', () => {
    chkFbJ2.checked = fullBodyOptions.enableJ2Oblateness;
    chkFbTidal.checked = fullBodyOptions.enableTidalTorque;
    radCollisions.forEach(r => {
      r.checked = r.value === fullBodyOptions.collisionMode;
    });
    if (fullBodyOptions.collisionMode === 'bounce') {
      rowRestitution.classList.remove('hidden');
      rngRestitution.value = String(fullBodyOptions.restitution);
      valRestitution.textContent = fullBodyOptions.restitution.toFixed(2);
    } else {
      rowRestitution.classList.add('hidden');
    }
    modalFullBody.classList.remove('hidden');
  });

  btnCloseFullBody?.addEventListener('click', () => modalFullBody.classList.add('hidden'));

  radCollisions.forEach(rad => {
    rad.addEventListener('change', () => {
      if (rad.value === 'bounce') {
        rowRestitution.classList.remove('hidden');
      } else {
        rowRestitution.classList.add('hidden');
      }
    });
  });

  rngRestitution?.addEventListener('input', () => {
    valRestitution.textContent = Number(rngRestitution.value).toFixed(2);
  });

  btnSaveFullBody?.addEventListener('click', () => {
    fullBodyOptions.enableJ2Oblateness = chkFbJ2.checked;
    fullBodyOptions.enableTidalTorque = chkFbTidal.checked;
    radCollisions.forEach(r => {
      if (r.checked) fullBodyOptions.collisionMode = r.value as 'merge' | 'bounce';
    });
    fullBodyOptions.restitution = Number(rngRestitution.value);

    modalFullBody.classList.add('hidden');
    showToast('Full Body physics settings updated');
  });

  // --- Universe Export Modal ---
  const btnExportOpen = document.getElementById('btn-export-open') as HTMLButtonElement;
  const btnCloseExport = document.getElementById('btn-close-export') as HTMLButtonElement;
  const inpUniverseName = document.getElementById('inp-universe-name') as HTMLInputElement;
  const inpUniverseId = document.getElementById('inp-universe-id') as HTMLInputElement;
  const exportSummary = document.getElementById('export-summary') as HTMLElement;
  const btnLaunchFlight = document.getElementById('btn-launch-flight') as HTMLButtonElement;
  const btnDownloadSpaceUniverse = document.getElementById('btn-download-spaceuniverse') as HTMLButtonElement;
  const btnDownloadJson = document.getElementById('btn-download-json') as HTMLButtonElement;
  const btnCopyJson = document.getElementById('btn-copy-json') as HTMLButtonElement;

  btnExportOpen?.addEventListener('click', async () => {
    if (bodies.length === 0) {
      showToast('Add at least one celestial body before exporting!');
      return;
    }

    modalExport.classList.remove('hidden');
    try {
      const { universe } = await exportUniverseFiles(bodies, inpUniverseId.value, inpUniverseName.value);
      exportSummary.textContent = `Valid Universe ✓ · ${universe.systems[0]!.bodies.length} Bodies · Central: ${universe.systems[0]!.centralBodyId}`;
    } catch (err) {
      exportSummary.textContent = `Validation Warning: ${(err as Error).message}`;
    }
  });

  btnCloseExport?.addEventListener('click', () => modalExport.classList.add('hidden'));

  btnDownloadJson?.addEventListener('click', async () => {
    try {
      const { jsonString, universe } = await exportUniverseFiles(bodies, inpUniverseId.value, inpUniverseName.value);
      downloadFile(`${universe.id}.json`, jsonString, 'application/json');
      showToast(`Downloaded ${universe.id}.json`);
    } catch (err) {
      alert(`Export error: ${(err as Error).message}`);
    }
  });

  btnDownloadSpaceUniverse?.addEventListener('click', async () => {
    try {
      const { compressedBytes, universe } = await exportUniverseFiles(bodies, inpUniverseId.value, inpUniverseName.value);
      downloadFile(`${universe.id}.spacedata`, compressedBytes as unknown as BlobPart, 'application/octet-stream');
      showToast(`Downloaded ${universe.id}.spaceuniverse`);
    } catch (err) {
      alert(`Export error: ${(err as Error).message}`);
    }
  });

  btnCopyJson?.addEventListener('click', async () => {
    try {
      const { jsonString } = await exportUniverseFiles(bodies, inpUniverseId.value, inpUniverseName.value);
      await navigator.clipboard.writeText(jsonString);
      showToast('Universe JSON copied to clipboard!');
    } catch (err) {
      alert(`Copy error: ${(err as Error).message}`);
    }
  });

  btnLaunchFlight?.addEventListener('click', async () => {
    try {
      const { universe } = await exportUniverseFiles(bodies, inpUniverseId.value, inpUniverseName.value);
      modalExport.classList.add('hidden');
      if (options?.onLaunchInSpaceSim) {
        options.onLaunchInSpaceSim(universe);
      } else {
        const { deepLinkUrl } = stageUniverseForSpaceSim(universe);
        showToast('Universe staged into Space Sim storage!');
        window.open(deepLinkUrl, '_blank');
      }
    } catch (err) {
      alert(`Launch error: ${(err as Error).message}`);
    }
  });

  // --- Testing Lab & In-Browser Diagnostics ---
  const btnTestingOpen = document.getElementById('btn-testing-open') as HTMLButtonElement;
  const btnCloseTesting = document.getElementById('btn-close-testing') as HTMLButtonElement;
  const modalTesting = document.getElementById('modal-testing') as HTMLElement;
  const scenarioList = document.getElementById('scenario-list') as HTMLElement;
  const btnRunDiagnostics = document.getElementById('btn-run-diagnostics') as HTMLButtonElement;
  const diagnosticResults = document.getElementById('diagnostic-results') as HTMLElement;

  function setupScenarioList(): void {
    if (!scenarioList) return;
    scenarioList.innerHTML = '';
    for (const scenario of TEST_SCENARIOS) {
      const card = document.createElement('div');
      card.className = 'scenario-card';

      const title = document.createElement('h4');
      title.textContent = scenario.name;

      const desc = document.createElement('p');
      desc.textContent = scenario.description;

      const meta = document.createElement('div');
      meta.className = 'scenario-meta';
      meta.textContent = `Mode: ${scenario.mode.toUpperCase()}`;

      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(meta);

      card.addEventListener('click', () => {
        bodies = scenario.build();
        closeInspector();
        renderer.camera.center = { ...scenario.camera.center };
        renderer.camera.scale = scenario.camera.scale;
        setPhysicsMode(scenario.mode);
        if (scenario.fullBodyOptions) {
          Object.assign(fullBodyOptions, scenario.fullBodyOptions);
        }
        modalTesting.classList.add('hidden');
        showToast(`Loaded scenario: ${scenario.name}`);
      });

      scenarioList.appendChild(card);
    }
  }
  setupScenarioList();

  btnTestingOpen?.addEventListener('click', () => {
    modalTesting.classList.remove('hidden');
  });

  btnCloseTesting?.addEventListener('click', () => modalTesting.classList.add('hidden'));

  async function runBrowserDiagnostics(): Promise<void> {
    diagnosticResults.innerHTML = '';

    function addResult(name: string, pass: boolean, note: string, ms: number): void {
      const row = document.createElement('div');
      row.className = `diag-item ${pass ? 'pass' : 'fail'}`;

      const icon = document.createElement('span');
      icon.className = 'diag-icon';
      icon.textContent = pass ? '✓' : '✗';

      const content = document.createElement('div');
      content.className = 'diag-content';

      const title = document.createElement('div');
      title.className = 'diag-title';
      title.textContent = name;

      const detail = document.createElement('div');
      detail.className = 'diag-note';
      detail.textContent = note;

      content.appendChild(title);
      content.appendChild(detail);

      const time = document.createElement('span');
      time.className = 'diag-time';
      time.textContent = `${ms.toFixed(1)}ms`;

      row.appendChild(icon);
      row.appendChild(content);
      row.appendChild(time);

      diagnosticResults.appendChild(row);
    }

    // 1. Symplectic Energy Drift Test
    const t0 = performance.now();
    const testBodies = createDefaultSolarSystem();
    const primary = testBodies[0]!;
    const satellite = testBodies[1]!;
    const r0 = distance(primary.position, satellite.position);
    const v0 = Math.hypot(satellite.velocity.x, satellite.velocity.y);
    const initialEnergy = 0.5 * satellite.mass * v0 * v0 - (primary.mu * satellite.mass) / r0;

    for (let i = 0; i < 150; i++) {
      stepSimulation(testBodies, 'nbody', 0.05, 1);
    }

    const rFinal = distance(primary.position, satellite.position);
    const vFinal = Math.hypot(satellite.velocity.x, satellite.velocity.y);
    const finalEnergy = 0.5 * satellite.mass * vFinal * vFinal - (primary.mu * satellite.mass) / rFinal;
    const drift = Math.abs((finalEnergy - initialEnergy) / initialEnergy) * 100;

    addResult(
      'Symplectic Velocity Verlet Energy Conservation',
      drift < 0.5,
      `Energy drift: ${drift.toFixed(3)}% over 150 Verlet steps (limit: < 0.5%)`,
      performance.now() - t0,
    );

    // 2. Circular Velocity Formula Check
    const t1 = performance.now();
    const star = instantiateBody('star', { x: 0, y: 0 }, { x: 0, y: 0 }, { mu: 16000000 });
    const circVel = computeCircularVelocity({ x: 4000, y: 0 }, star, { x: 0, y: 10 });
    const expectedSpeed = Math.sqrt(16000000 / 4000); // 63.245 m/s
    const actualSpeed = Math.hypot(circVel.x, circVel.y);
    const speedDiff = Math.abs(actualSpeed - expectedSpeed);
    addResult(
      'Kepler Circular Velocity Solver',
      speedDiff < 0.001,
      `Speed: ${actualSpeed.toFixed(3)} m/s (ideal: ${expectedSpeed.toFixed(3)} m/s)`,
      performance.now() - t1,
    );

    // 3. J2 Quadrupole Oblateness Perturbation Test
    const t2 = performance.now();
    const oblateStar = instantiateBody('star', { x: 0, y: 0 }, { x: 0, y: 0 }, {
      mu: 100000000,
      radius: 1000,
      rotation: { period: 40, direction: -1 },
    });
    const ghostStandard = predictGhostTrajectory({ x: 2500, y: 0 }, { x: 0, y: 150 }, [oblateStar], 'nbody', 50);
    const ghostFullBody = predictGhostTrajectory({ x: 2500, y: 0 }, { x: 0, y: 150 }, [oblateStar], 'full-body', 50, {
      ...DEFAULT_FULL_BODY_OPTIONS,
      enableJ2Oblateness: true,
    });
    const diffJ2 = Math.abs((ghostFullBody.ghostPath[20]?.position.x ?? 0) - (ghostStandard.ghostPath[20]?.position.x ?? 0));
    addResult(
      'J2 Oblateness Harmonic Perturbation',
      diffJ2 > 0.01,
      `Non-Keplerian trajectory deflection detected: ${diffJ2.toFixed(2)} m offset`,
      performance.now() - t2,
    );

    // 4. Universe Definition Schema Compliance Test
    const t3 = performance.now();
    let schemaPass = false;
    let schemaMsg = '';
    try {
      const { universe } = await exportUniverseFiles(bodies, 'browser-test-universe', 'Browser Test Universe');
      validateUniverse(universe);
      schemaPass = true;
      schemaMsg = `Verified against universe.schema.json: ${universe.systems[0]!.bodies.length} bodies passed`;
    } catch (err) {
      schemaMsg = (err as Error).message;
    }
    addResult('Universe Schema Validation', schemaPass, schemaMsg, performance.now() - t3);

    // 5. Reusable universe definition package check
    const t4 = performance.now();
    let dataPass = false;
    let dataMsg = '';
    try {
      const { universe } = await exportUniverseFiles(bodies, 'data-test', 'Data Test');
      const bytes = await compressUniverse(universe);
      const hasHeader = bytes[0] === 0x50 && bytes[1] === 0x4b;
      const restored = await decodeUniverse(bytes);
      dataPass = hasHeader && restored.id === universe.id && restored.systems[0]!.bodies.length === universe.systems[0]!.bodies.length;
      dataMsg = `Universe data package verified. Size: ${(bytes.length / 1024).toFixed(1)} KiB`;
    } catch (err) {
      dataMsg = (err as Error).message;
    }
    addResult('Reusable universe definitions (.spacedata)', dataPass, dataMsg, performance.now() - t4);
  }

  btnRunDiagnostics?.addEventListener('click', runBrowserDiagnostics);

  // Reuse the same vector dock chrome as the flight workspace, with Sandbox actions.
  const tools: DockAction[] = [
    { id: 'physics', label: 'Physics', icon: 'setup', hint: 'Full Body settings', controls: 'modal-fullbody', button: btnFullBodySettings },
    { id: 'appearance', label: 'Appearance', icon: 'settings', hint: 'Theme and graphics', button: btnThemeOpen ?? undefined },
    { id: 'testing', label: 'Testing', icon: 'tools', hint: 'Scenarios, diagnostics and CPU limiter', controls: 'modal-testing', button: document.getElementById('btn-testing-open') as HTMLButtonElement },
    { id: 'export', label: 'Export', icon: 'trajectory', hint: 'Export the current universe', controls: 'modal-export', button: document.getElementById('btn-export-open') as HTMLButtonElement },
  ];
  const general: DockAction[] = [];
  if (btnSandboxMenu) general.push({ id: 'library', label: 'Load Game', icon: 'library', hint: 'Games and plugins', controls: 'library-window', button: btnSandboxMenu });
  if (options?.onOpenManual) general.push({ id: 'manual', label: 'Manual', icon: 'manual', hint: 'Players and Creators help', controls: 'manual-window', activate: options.onOpenManual });
  const dock = createActionDock({ container: sandboxRoot, groups: [tools, ...(general.length ? [general] : [])], icon: windows.icon, label: 'Orbit Sandbox tools' });
  dock.element.classList.add('sandbox-dock');
  const header = sandboxRoot.querySelector<HTMLElement>('.sandbox-header')!;
  const updateHeaderHeight = () => sandboxRoot.style.setProperty('--sandbox-header-height', `${header.offsetHeight}px`);
  new ResizeObserver(updateHeaderHeight).observe(header); updateHeaderHeight();

  // --- Main Simulation & Animation Loop ---
  let lastFrameTime = performance.now();

  function animationLoop(timestamp: number): void {
    if (!isStarted) return;
    animFrameId = requestAnimationFrame(animationLoop);

    const deltaMs = Math.max(0, Math.min(100, timestamp - lastFrameTime));
    lastFrameTime = timestamp;

    if (!isPaused) {
      const wallSeconds = deltaMs / 1000;
      const advanced = advanceSandboxFrame(bodies, simulationMode, wallSeconds, warpMultiplier, fullBodyOptions, disableLimiter.checked);
      simulationTimeSec += advanced.simulatedSeconds;
      if (!disableLimiter.checked && !document.hidden) {
        sampledWallSeconds += wallSeconds; integratedSeconds += advanced.simulatedSeconds;
        overloadSeconds = advanced.limited ? overloadSeconds + wallSeconds : Math.max(0, overloadSeconds - wallSeconds);
        if (advanced.limited && timestamp >= warningUntil) {
          warpStatus.hidden = false; warpStatus.textContent = 'CPU cannot keep up · reducing warp';
        }
        if (sampledWallSeconds >= .5) {
          if (overloadSeconds >= .15) {
            const previous = warpMultiplier;
            setWarp(sustainableWarp(previous, integratedSeconds, sampledWallSeconds));
            warpStatus.textContent = `CPU limited · warp reduced to ${warpMultiplier}×`;
            warpStatus.hidden = false; warningUntil = timestamp + 5000;
          } else if (timestamp >= warningUntil) warpStatus.hidden = true;
          overloadSeconds = integratedSeconds = sampledWallSeconds = 0;
        }
      }
    }

    renderScene(renderer, bodies, activeCandidate, simulationTimeSec);
  }

  return {
    start() {
      if (isStarted) return;
      isStarted = true;
      resizeCanvas();
      lastFrameTime = performance.now();
      animFrameId = requestAnimationFrame(animationLoop);
    },
    stop() {
      isStarted = false;
      closeInspector();
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    },
    reset: resetWorld,
    resize() {
      resizeCanvas();
    },
    isOpen() {
      return isStarted && !document.getElementById('orbit-sandbox-workspace')?.hidden;
    },
  };
}

// Auto-run if opened directly in standalone apps/orbit-sandbox/index.html
if (typeof window !== 'undefined' && document.getElementById('orbit-canvas') && !document.getElementById('flight-view')) {
  applyHudThemeToDom(loadThemeSettings());
  const standaloneSandbox = initOrbitSandbox();
  standaloneSandbox.start();
}
