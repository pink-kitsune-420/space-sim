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

export type ThemeBackdropStyle = 'spacelab' | 'nebula' | 'carina' | 'galactic' | 'aurora' | 'supernova' | 'void' | 'pillars' | 'helix' | 'asteroids';
export type ThemeGridStyle = 'cartesian' | 'polar' | 'dots' | 'hex' | 'off';
export type ThemeCounterStyle = 'spacelab' | 'cyber' | 'apollo' | 'tactical' | 'aurora' | 'solar' | 'custom';
export type ThemeWindowStyle = 'classic' | 'cyber' | 'apollo' | 'tactical' | 'aurora' | 'solar' | 'void' | 'crimson';

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
export type RenderSection = 'background' | 'planet' | 'path' | 'ship' | 'overlay';
/** Optional profiler hook, called after each section has been drawn. */
export interface RenderTimer { lap(section: RenderSection): void }

export type ShaderPass = 'scene' | 'vector' | 'text';
export interface ShaderSources { readonly vertex: string; readonly fragment: string }
/** `space-sim-shaders/1` data. Packs restyle built-in drawing roles, never module overlays. */
export interface ShaderPack {
  readonly format: 'space-sim-shaders/1';
  readonly name: string;
  readonly passes: Readonly<Record<ShaderPass, ShaderSources>>;
}
export interface ShaderControl {
  readonly pack: ShaderPack;
  /** Validates and compiles atomically; on failure it throws and the previous pack keeps drawing. */
  set(pack: ShaderPack): void;
}
/** Optional features of a renderer instance. Applications discover them here, never by class. */
export interface RendererFeatures {
  readonly shaders?: ShaderControl;
  readonly effects?: import('./platform').ShaderEffects;
  /** Finish deferred raster work so profiler sections are attributed precisely. */
  readonly flush?: () => void;
}
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
export type OverlayPrimitive =
  /** `fill` paints the closed outline instead of stroking it; the shape must be convex. */
  | { readonly kind: 'line'; readonly space: OverlaySpace; readonly points: readonly Vec[]; readonly color: string;
      readonly width?: number; readonly closed?: boolean; readonly fill?: boolean }
  /** Radius is metres in world space and CSS pixels in screen space. */
  | { readonly kind: 'circle'; readonly space: OverlaySpace; readonly center: Vec; readonly radius: number;
      readonly color: string; readonly width?: number; readonly fill?: boolean }
  | { readonly kind: 'text'; readonly space: OverlaySpace; readonly at: Vec; readonly text: string; readonly color: string;
      readonly align?: 'left' | 'center' | 'right' };

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
export interface ManeuverPreview {
  readonly time: number;
  readonly position: Vec;
  readonly deltaVelocity: Vec;
  readonly burnSeconds: number;
  readonly valid: boolean;
  readonly path: readonly GhostSample[];
}
export interface PresentationView extends PresentationSnapshot {
  /** The camera this frame is drawn with. */
  readonly camera: Camera;
}
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
export interface PanelRow { readonly label: string; readonly value: string; readonly unit?: string }
export interface PanelHook {
  readonly name: string;
  readonly title: string;
  /** At most four times per second. At most 16 rows; label/unit ≤ 32 and value ≤ 64 characters. */
  update(view: PresentationView): readonly PanelRow[];
}
export interface CameraTarget {
  /** System coordinates (metres). */
  readonly center: Vec;
  /** Target rotation in radians; omitted keeps the pilot's North up/Horizon up choice.
   * The host blends rotation changes and keeps the pilot's zoom. */
  readonly rotation?: number;
}
export interface CameraHook {
  readonly name: string;
  /** Camera button text while selected, such as "Lead camera". */
  readonly label: string;
  /** Once per frame while selected. */
  frame(input: CameraInput): CameraTarget;
}
export interface PresentationContribution<T> {
  readonly moduleId: string;
  readonly version: string;
  /** `<module id>/<hook name>`. */
  readonly id: string;
  readonly hook: T;
}
export type LayerExtension = PresentationContribution<LayerHook>;
export type PanelExtension = PresentationContribution<PanelHook>;
export type CameraExtension = PresentationContribution<CameraHook>;
export interface PresentationFault {
  readonly moduleId: string;
  /** Contribution ID, such as `builtin.flight-vectors/velocity`. */
  readonly hook: string;
  readonly kind: 'layer' | 'panel' | 'camera';
  readonly message: string;
}
