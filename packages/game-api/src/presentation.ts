import type { Controls, GhostEnd, GhostSample, State, Vec } from './state';
import type { SurfaceProfile } from './surface';
import type { Elements } from './orbit';
import type { BodyAppearance, VehicleDefaults } from './universe';
import type { WorldRuleState } from './rules';

/** Presentation contracts. Browser/offline scope: nothing here enters the authoritative
 * lock, simulation fingerprint, saves or snapshots, and no hook receives the World. */

/** System world coordinates (metres, +Y up) to CSS pixels: `scale` pixels per metre,
 * `rotation` radians counter-clockwise applied to the world before projection. */
export interface Camera { readonly center: Vec; readonly rotation: number; readonly scale: number }
/** Celestial body descriptor for a rendered frame in system world coordinates (`position` and `radius` in `m`, `rotation` in `rad`), plus optional terrain and shader appearance. */
export interface RenderBody {
  readonly id: string;
  readonly name: string;
  readonly position: Vec;
  readonly radius: number;
  /** Shared authoritative terrain geometry. */
  readonly surface?: SurfaceProfile;
  readonly color?: string;
  readonly accentColor?: string;
  readonly atmosphereColor?: string;
  readonly horizonColor?: string;
  readonly skyColor?: string;
  readonly surfaceFeatures?: 'globe-lines' | 'craters' | 'smooth' | 'star';
  readonly parentPosition?: Vec;
  readonly orbitRadius?: number;
  /** Drawn angle of the body-fixed frame (terrain, markings) in radians; absent or 0 when it does not spin. */
  readonly rotation?: number;
  /** Unit vector from the body toward its star, in system coordinates. Absent: drawn unlit. */
  readonly sunDirection?: Vec;
  /** Procedural surface look; absent draws a plain disc (low graphics quality). */
  readonly appearance?: BodyAppearance & { readonly colors: readonly string[] };
}
/** Another vessel in the same world: one of this player's fleet, or someone else's. */
export interface RenderShip {
  readonly vehicleId?: string;
  readonly id: string;
  /** System world coordinates. */
  readonly position: Vec;
  readonly heading: number;
  readonly status: State['status'];
  readonly engine: boolean;
  readonly throttle: number;
  readonly label: string;
  /** Owned by another player. */
  readonly foreign?: boolean;
  /** Drawn as a small unlabeled rock instead of a vessel (asteroids and debris). */
  readonly rock?: boolean;
}
/** Complete scene description passed to `Renderer.draw` once per animation frame: interpolated `state`, `path` samples, `camera`, `bodies`, `ships`, `overlays`, and `theme`. */
export interface RenderFrame {
  readonly vehicleId?: string;
  /** Presentation snapshot; may be interpolated between fixed physics steps. */
  readonly state: State;
  /** Ghost samples with exact velocities. Closed loops are drawn whole; open paths start at the ship. */
  readonly path: readonly GhostSample[];
  readonly pathClosed: boolean;
  readonly camera: Camera;
  readonly engine: boolean;
  /** Celestial bodies in the active system (planets and moons). */
  readonly bodies?: readonly RenderBody[];
  /** Ship position in system world coordinates (defaults to state.position). */
  readonly shipWorldPosition?: Vec;
  /** Reference origin of ghost path (e.g. active body position). */
  readonly pathOrigin?: Vec;
  /** World position of launch pad if any. */
  readonly padPosition?: Vec;
  /** Outward normal at the pad, for its tangent marker. */
  readonly padNormal?: Vec;
  /** Label beside the piloted ship (default VESSEL 01). */
  readonly shipLabel?: string;
  /** Viewer-only annotations; omitted preserves the default visible labels and scale bar. */
  readonly showScale?: boolean;
  readonly showShip?: boolean;
  readonly showPad?: boolean;
  /** Optional explicit viewer animation epoch, seconds. Never advances a simulation. */
  readonly presentationTime?: number;
  readonly showShipLabels?: boolean;
  /** Celestial body names; defaults to visible. Independent of ship labels. */
  readonly showBodyLabels?: boolean;
  /** Planet/moon orbit guides; defaults to visible. Does not hide ship trajectories or affect motion. */
  readonly showBodyOrbits?: boolean;
  /** Other vessels, drawn beneath the piloted ship. */
  readonly ships?: readonly RenderShip[];
  /** Validated presentation layers above the scene, in the overlay section: shapes in order,
   * then text in order so labels stay readable. */
  readonly overlays?: readonly OverlayPrimitive[];
  /** Visual theme settings for universe backdrop, skybox, grids, and timers/counters. */
  readonly theme?: RenderThemeOptions;
}

/** Named deep-space backdrop preset for scene rendering. */
export type ThemeBackdropStyle = 'spacelab' | 'nebula' | 'carina' | 'galactic' | 'aurora' | 'supernova' | 'void' | 'pillars' | 'helix' | 'asteroids';
/** Coordinate reference grid style drawn behind the scene (`'off'` disables grid rendering). */
export type ThemeGridStyle = 'cartesian' | 'polar' | 'dots' | 'hex' | 'off';
/** Numeric readout and telemetry counter typography/color preset. */
export type ThemeCounterStyle = 'spacelab' | 'cyber' | 'apollo' | 'tactical' | 'aurora' | 'solar' | 'custom';
/** Floating window frame and surface styling preset. */
export type ThemeWindowStyle = 'classic' | 'cyber' | 'apollo' | 'tactical' | 'aurora' | 'solar' | 'void' | 'crimson';

/** Presentation-only visual theme options controlling backdrop, stars, coordinate grids, window chrome, HUD effects, and shader seeds. */
export interface RenderThemeOptions {
  readonly backdropStyle?: ThemeBackdropStyle;
  readonly nebulaVisible?: boolean;
  readonly nebulaIntensity?: number;
  readonly starsVisible?: boolean;
  readonly starDensity?: number;
  readonly dustVisible?: boolean;
  readonly galaxiesVisible?: boolean;
  readonly animatedNebula?: boolean;
  readonly ringsVisible?: boolean;
  readonly asteroidBeltVisible?: boolean;
  readonly gridEnabled?: boolean;
  readonly gridStyle?: ThemeGridStyle;
  readonly gridSpacing?: number;
  readonly gridOpacity?: number;
  readonly gridLabels?: boolean;
  readonly gridColor?: string;
  readonly windowStyle?: ThemeWindowStyle;
  readonly windowColor?: string;
  /** Window background alpha, 0.4–1; text and controls remain fully visible. */
  readonly windowOpacity?: number;
  readonly counterTheme?: ThemeCounterStyle;
  readonly hudColor?: string;
  readonly hudScanlines?: boolean;
  readonly hudGlow?: boolean;
  readonly hudChamfer?: boolean;
  readonly compactHud?: boolean;
  readonly highQuality?: boolean;
  readonly worldSeed?: number;
  readonly shaderSeed?: number;
}
/** Ordered drawing pass section reported to a `RenderTimer` during `Renderer.draw`. */
export type RenderSection = 'background' | 'planet' | 'path' | 'ship' | 'overlay';
/** Optional profiler hook, called after each section has been drawn. */
export interface RenderTimer { lap(section: RenderSection): void }

/** Built-in WebGL shader program pass identifier (`'scene'`, `'vector'`, or `'text'`). */
export type ShaderPass = 'scene' | 'vector' | 'text';
/** Vertex and fragment GLSL shader source strings for a single `ShaderPass`. */
export interface ShaderSources { readonly vertex: string; readonly fragment: string }
/** `space-sim-shaders/1` data. Packs restyle built-in drawing roles, never module overlays. */
export interface ShaderPack {
  readonly format: 'space-sim-shaders/1';
  readonly name: string;
  readonly passes: Readonly<Record<ShaderPass, ShaderSources>>;
}
/** Live shader pack controller exposed on `RendererFeatures.shaders` for atomic runtime shader replacement. */
export interface ShaderControl {
  readonly pack: ShaderPack;
  /** Validates and compiles atomically; on failure it throws and the previous pack keeps drawing. */
  set(pack: ShaderPack): void;
}
/** Optional features of a renderer instance. Applications discover them here, never by class. */
export interface RendererFeatures {
  readonly shaders?: ShaderControl;
  readonly effects?: import('./platform').ShaderEffects;
  /** Custom tile palette registration for instanced tile-chunk primitives. */
  readonly tilePalettes?: {
    register(paletteId: string, colors: readonly string[]): void;
  };
  /** Finish deferred raster work so profiler sections are attributed precisely. */
  readonly flush?: () => void;
}
/** Viewport scene renderer instance bound to a single `HTMLCanvasElement`; frees all GPU/canvas resources in `dispose()`. */
export interface Renderer {
  readonly features?: RendererFeatures;
  draw(frame: RenderFrame, timer?: RenderTimer): void;
  dispose?(): void;
}
/** Declared before construction and matched by every renderer the provider creates. */
export interface RendererCapabilities {
  /** Accepts ShaderPack data and exposes `features.shaders`. */
  readonly shaders: boolean;
  /** Draws `RenderFrame.overlays`. */
  readonly overlays: boolean;
  readonly effects?: boolean;
}
/** The `renderer` slot of a presentation profile. A stateless factory: each renderer owns
 * everything it allocates (contexts, programs, buffers, textures) and frees it in dispose(),
 * so a renderer may outlive the candidate whose provider created it. */
export interface RendererProvider {
  readonly id: string;
  readonly version: string;
  /** Short UI label, such as "WebGL" or "2D". */
  readonly label: string;
  readonly capabilities: RendererCapabilities;
  create(canvas: HTMLCanvasElement, options?: { readonly shaders?: ShaderPack }): Renderer;
}

/** Device-local flight cues; none of these commands changes simulation state. */
export type AudioCue = 'confirm' | 'pause' | 'resume' | 'warp' | 'land' | 'crash' | 'splash';
/** Browser-owned output. Creation is silent; resume() is called after a user gesture.
 * Levels are normalized to 0–1. The host suspends hidden tabs and disposes replaced outputs. */
export interface AudioOutput {
  resume(): Promise<void>;
  suspend(): void;
  setVolume(level: number): void;
  setThrust(level: number): void;
  play(cue: AudioCue): void;
  dispose(): void;
}
/** Optional `audio` presentation slot. A stateless factory, independent of renderer lifetime. */
export interface AudioProvider {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  create(): AudioOutput;
}

/** `world`: system coordinates in metres (+Y up), projected by the frame's camera.
 * `screen`: CSS pixels from the viewport's top-left corner (+Y down). Colors are
 * `#RRGGBB` or `#RRGGBBAA`; widths are CSS pixels in both spaces. */
export type OverlaySpace = 'world' | 'screen';
/** Declarative 2D vector overlay primitive (`'line'`, `'circle'`, `'text'`, or `'tile-chunk'`) drawn in `'world'` metres or `'screen'` CSS pixels. */
export type OverlayPrimitive =
  /** `fill` paints the closed outline instead of stroking it; the shape must be convex. */
  | { readonly kind: 'line'; readonly space: OverlaySpace; readonly points: readonly Vec[]; readonly color: string;
      readonly width?: number; readonly closed?: boolean; readonly fill?: boolean }
  /** Radius is metres in world space and CSS pixels in screen space. */
  | { readonly kind: 'circle'; readonly space: OverlaySpace; readonly center: Vec; readonly radius: number;
      readonly color: string; readonly width?: number; readonly fill?: boolean }
  | { readonly kind: 'text'; readonly space: OverlaySpace; readonly at: Vec; readonly text: string; readonly color: string;
      readonly align?: 'left' | 'center' | 'right' }
  /** Instanced 32x32 tile chunk drawn in world-space metres in 1 GPU draw call. */
  | {
      readonly kind: 'tile-chunk';
      readonly space: 'world';
      readonly origin: Vec;
      readonly tileMetres: number;
      readonly size: 32;
      readonly tiles: Uint16Array;
      readonly light?: Uint8Array;
      readonly paletteId?: string;
      readonly color?: string;
    };

/** Default 27 first-party Space Sim tile material colors. */
export const DEFAULT_TILE_PALETTE_HEX: readonly string[] = Object.freeze([
  '#00000000', // 0: Air (transparent)
  '#6e737b',   // 1: Stone
  '#9a8f82',   // 2: Regolith
  '#484c54',   // 3: Basalt
  '#a8d8f0',   // 4: Ice
  '#3c3642',   // 5: DeepIgneous
  '#2f262e',   // 6: MantleRock
  '#ff5511',   // 7: CoreMagma
  '#b87352',   // 8: IronOre
  '#d9823b',   // 9: CopperOre
  '#c4d4e0',   // 10: TitaniumOre
  '#9be0b8',   // 11: LithiumOre
  '#52e062',   // 12: UraniumOre
  '#26292e',   // 13: CarbonOre
  '#e6ded5',   // 14: SiliconOre
  '#ccd4dd',   // 15: HullBlock
  '#38b6ff',   // 16: CockpitBlock
  '#ff9933',   // 17: ThrusterBlock
  '#8899aa',   // 18: TrussBlock
  '#2b65ec',   // 19: SolarArrayBlock
  '#00e5ff',   // 20: DockingPortBlock
  '#ff4500',   // 21: FuelDepotBlock
  '#00ff88',   // 22: LifeSupportBlock
  '#e67e22',   // 23: RefineryBlock
  '#f1c40f',   // 24: LadderBlock
  '#a0e6ff',   // 25: GlassDomeBlock
  '#1abc9c',   // 26: AirLockBlock
]);

/** Detached presentation snapshot of the piloted vessel, combining body-relative `state` (`m`, `m/s`, `rad`) and system-coordinate `position` (`m`). */
export interface PresentationShip {
  readonly id: string;
  readonly name: string;
  readonly bodyId: string;
  /** Interpolated presentation state relative to `bodyId` (metres, m/s, radians). */
  readonly state: State;
  readonly controls: Controls;
  /** Position in system coordinates (metres), as drawn. */
  readonly position: Vec;
  readonly fault?: string;
}
/** Detached presentation snapshot of the active celestial body in system coordinates (`radius` and `position` in `m`, `mu` in `m³/s²`, optional `spin` in `rad/s`). */
export interface PresentationBody {
  readonly id: string;
  readonly name: string;
  /** Reference radius (metres) and gravitational parameter (m³/s²). */
  readonly radius: number;
  readonly mu: number;
  /** Centre in system coordinates at the view time. */
  readonly position: Vec;
  /** Signed spin rate in rad/s (counter-clockwise positive); absent when the body does not rotate. */
  readonly spin?: number;
}
/** A detached, frozen snapshot of what the pilot sees. Built at most once per frame. */
export interface PresentationSnapshot {
  /** Interpolated presentation time (seconds) and the last committed simulation tick. */
  readonly time: number;
  readonly tick: number;
  readonly paused: boolean;
  /** Wall seconds since the previous frame. Presentation only; never feeds the simulation. */
  readonly elapsed: number;
  readonly viewport: { readonly width: number; readonly height: number; readonly pixelRatio: number };
  readonly body: PresentationBody;
  readonly ship?: PresentationShip;
  readonly vehicle: Readonly<VehicleDefaults>;
  /** The active motion model provides analytic orbital diagnostics. */
  readonly analyticOrbits: boolean;
  /** Analytic elements of a flying ship's orbit, when `analyticOrbits`. */
  readonly orbit: Elements | null;
  /** Height above local ground or sea in metres (negative underwater). */
  readonly groundClearance: number | null;
  readonly prediction: { readonly status: GhostEnd | 'tracing' | 'none'; readonly samples: number; readonly last?: GhostSample };
  /** Optional local flight plan. Body-relative SI coordinates; a preview never changes live motion. */
  readonly maneuver?: ManeuverPreview;
  /** Shared-world rule namespaces at the last committed tick. */
  readonly moduleState: Readonly<Record<string, WorldRuleState>>;
}
/** Read-only body-relative SI preview of the active maneuver node and planned trajectory (`time` and `burnSeconds` in `s`, `position` in `m`, `deltaVelocity` in `m/s`). */
export interface ManeuverPreview {
  /** Completed nodes remain in the editor journal but no longer draw burn targets. */
  readonly completed?: boolean;
  readonly nodes?: readonly { readonly id: string; readonly time: number; readonly position: Vec; readonly label: string; readonly selected: boolean; readonly completed?: boolean; readonly valid: boolean; readonly deltaVelocity?: Vec; readonly throttleBurnSeconds?: number | null }[];
  readonly time: number;
  readonly position: Vec;
  readonly deltaVelocity: Vec;
  readonly burnSeconds: number;
  /** Estimate at the current throttle setting, even with engines off. Null means no thrust. */
  readonly throttleBurnSeconds?: number | null;
  readonly throttle?: number;
  readonly remainingDeltaV?: number;
  readonly valid: boolean;
  readonly path: readonly GhostSample[];
}
/** Frozen per-frame presentation snapshot extended with the active viewport `Camera`, passed to `LayerHook` and `PanelHook`. */
export interface PresentationView extends PresentationSnapshot {
  /** The camera this frame is drawn with. */
  readonly camera: Camera;
}
/** Frozen per-frame presentation snapshot extended with the pilot's zoom `scale` (CSS pixels per metre), passed to `CameraHook.frame`. */
export interface CameraInput extends PresentationSnapshot {
  /** The pilot's zoom in CSS pixels per metre. */
  readonly scale: number;
}

/** Hooks below are synchronous presentation code. Each receives a frozen snapshot and
 * returns data the host validates. A thrown error or invalid result disables only that
 * contribution (reported with module ID and hook); the simulation never observes it. */
export interface LayerHook {
  /** Local name; the contribution ID is `<module id>/<name>`. */
  readonly name: string;
  readonly label: string;
  /** Once per drawn frame. At most 256 primitives and 4,096 points per call. */
  draw(view: PresentationView): readonly OverlayPrimitive[];
}
/** Single telemetry row (`label`, `value`, and optional `unit`) returned by a `PanelHook`. */
export interface PanelRow { readonly label: string; readonly value: string; readonly unit?: string }
/** Synchronous presentation telemetry panel hook returning up to 16 `PanelRow` entries from a frozen `PresentationView`. */
export interface PanelHook {
  readonly name: string;
  readonly title: string;
  /** At most four times per second. At most 16 rows; label/unit ≤ 32 and value ≤ 64 characters. */
  update(view: PresentationView): readonly PanelRow[];
}
/** Camera center (system coordinates in metres) and optional counter-clockwise rotation (radians) returned by a `CameraHook`. */
export interface CameraTarget {
  /** System coordinates (metres). */
  readonly center: Vec;
  /** Target rotation in radians; omitted keeps the pilot's North up/Horizon up choice.
   * The host blends rotation changes and keeps the pilot's zoom. */
  readonly rotation?: number;
}
/** Synchronous presentation camera mode hook computing a `CameraTarget` once per rendered frame from a frozen `CameraInput`. */
export interface CameraHook {
  readonly name: string;
  /** Camera button text while selected, such as "Lead camera". */
  readonly label: string;
  /** Once per frame while selected. */
  frame(input: CameraInput): CameraTarget;
}
/** Resolved presentation hook contribution (`<moduleId>/<hook.name>`) bound to its owning module identity and version. */
export interface PresentationContribution<T> {
  readonly moduleId: string;
  readonly version: string;
  /** `<module id>/<hook name>`. */
  readonly id: string;
  readonly hook: T;
}
/** Resolved overlay `LayerHook` presentation contribution. */
export type LayerExtension = PresentationContribution<LayerHook>;
/** Resolved telemetry `PanelHook` presentation contribution. */
export type PanelExtension = PresentationContribution<PanelHook>;
/** Resolved `CameraHook` presentation contribution. */
export type CameraExtension = PresentationContribution<CameraHook>;
/** Diagnostic fault record emitted when a presentation `layer`, `panel`, or `camera` hook throws or returns invalid data. */
export interface PresentationFault {
  readonly moduleId: string;
  /** Contribution ID, such as `builtin.flight-vectors/velocity`. */
  readonly hook: string;
  readonly kind: 'layer' | 'panel' | 'camera';
  readonly message: string;
}
