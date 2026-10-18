import type { Disposable } from './modules';
import type { RenderThemeOptions } from './presentation';
import type { ServiceKey } from './modules-v2';

/** Device-local input. elapsed is wall seconds, never a simulation step. */
export interface InputFrame {
  readonly elapsed: number;
  readonly pilot: number;
  readonly flightAllowed: boolean;
  readonly shortcutsAllowed: boolean;
}
export interface ActionSink { set(action: string, value: number): void }
export interface ActionDefinitionV2 {
  readonly id: string;
  readonly label: string;
  readonly category: 'flight' | 'warp' | 'view' | 'system';
  readonly mode: 'held' | 'axis' | 'press';
  readonly defaultKeys: readonly string[];
}
export interface InputSource extends Disposable {
  readonly name: string;
  /** At most 256 writes. Output is committed only after a successful synchronous sample. */
  sample(frame: InputFrame, into: ActionSink): void;
  release(pilot?: number): void;
}
export interface PilotRegistry {
  readonly count: number;
  playerId(pilot: number): string | undefined;
  assign(pilot: number, device: string): void;
  release(pilot?: number): void;
}
/** Text and backpressure contract shared by browser and headless adapters. */
export interface TextConnection {
  readonly label: string;
  readonly bufferedAmount: number;
  send(text: string): void;
  close(reason?: string): void;
  onmessage: ((text: string) => void) | null;
  onclose: ((reason: string) => void) | null;
}
export interface TransportProvider {
  readonly name: string;
  readonly schemes: readonly string[];
  connect(address: string, signal: AbortSignal): Promise<TextConnection>;
  listen?(address: string, accept: (peer: TextConnection) => void, signal: AbortSignal): Promise<Disposable>;
}
export interface ServerAdvert {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly players: number;
  readonly maxPlayers: number;
  readonly protocol: string;
}
export interface DiscoveryProvider {
  readonly name: string;
  scan(emit: (advert: ServerAdvert) => void, signal: AbortSignal): Promise<void>;
}
export interface InviteProvider {
  create(signal: AbortSignal): Promise<{
    readonly offer: string;
    accept(reply: string): Promise<TextConnection>;
    dispose(): void;
  }>;
  answer(offer: string, signal: AbortSignal): Promise<{
    readonly reply: string;
    readonly connection: TextConnection;
  }>;
}
export type UiControl =
  | { readonly kind: 'text'; readonly id: string; readonly text: string }
  | { readonly kind: 'button' | 'toggle'; readonly id: string; readonly label: string; readonly action: string }
  | { readonly kind: 'slider'; readonly id: string; readonly label: string; readonly action: string;
      readonly minimum: number; readonly maximum: number; readonly step: number }
  | { readonly kind: 'canvas'; readonly id: string; readonly label: string };
export interface WindowDefinition {
  readonly name: string;
  readonly title: string;
  readonly controls: readonly UiControl[];
}
/** The browser adapter supplies raw DOM separately; this contract stays headless-safe. */
export interface UiShell {
  open(windowId: string): void;
  close(windowId: string): void;
  set(id: string, value: string | number | boolean): void;
  onAction(id: string, callback: (value: string | number | boolean) => void): Disposable;
}
export interface TrustedDomShell {
  mountTrusted(windowId: string, mount: (root: HTMLElement) => Disposable): Disposable;
}
export interface ThemeService {
  current(): Readonly<RenderThemeOptions>;
  set(value: Readonly<RenderThemeOptions>): void;
  subscribe(change: (theme: Readonly<RenderThemeOptions>) => void): Disposable;
}
export const CORE_UI: ServiceKey<UiShell> = Object.freeze({ slot: 'core.ui', version: '1.0.0' });
export const CORE_DOM: ServiceKey<TrustedDomShell> = Object.freeze({ slot: 'core.dom', version: '1.0.0' });
export const CORE_THEME: ServiceKey<ThemeService> = Object.freeze({ slot: 'core.theme', version: '1.0.0' });
export interface GuidePage {
  readonly id: string;
  readonly audience: 'players' | 'creators';
  readonly title: string;
  readonly summary: string;
  readonly asset: string;
}
export interface MaterialDefinition {
  readonly name: string;
  readonly bodyIds: readonly string[];
  readonly fragmentAsset: string;
  readonly uniforms: Readonly<Record<string, number>>;
}
export interface PostEffectDefinition {
  readonly name: string;
  readonly fragmentAsset: string;
  readonly after: readonly string[];
  readonly scale: 0.5 | 1;
  readonly uniforms: Readonly<Record<string, number>>;
}
export interface ShaderEffects {
  configure(materials: readonly MaterialDefinition[], post: readonly PostEffectDefinition[]): void;
}
