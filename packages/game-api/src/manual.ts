import type {Disposable} from './modules';
import type {ServiceKey} from './modules-v2';
import type {ThemePreferences} from './theme';
import type {WindowDocument} from './window-content';
/** Audience discriminator for Manual reader tabs. */
export type ManualAudience = 'players' | 'creators';

/**
 * Portable manual topic or guide entry.
 * Can contain either a structured WindowDocument or an explicit trusted DOM mounting function.
 */
export interface ManualTopic {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** Plain additional search text for a trusted custom renderer. Structured body text is automatic. */
  readonly searchText?: string;
  readonly document?: WindowDocument;
  /** Explicit trusted host/content adapter, never constructed from imported HTML strings. */
  readonly mount?: (root: HTMLElement) => Disposable | void;
}

/**
 * Guide page bound to a specific audience ('players' or 'creators') for catalog registration.
 */
export interface ManualGuide extends ManualTopic {
  readonly audience: ManualAudience;
}

/**
 * Section definition containing an audience label, introductory text, and an array of pages.
 */
export interface ManualSection {
  readonly label: string;
  readonly intro: string;
  readonly pages: readonly ManualTopic[];
}

/**
 * Configuration options for instantiating a ManualReader (`ui.manual@1.0.0`).
 * Defines the root host element, audience books, optional viewer preferences storage,
 * ID prefix, optional configuration dialog trigger, live content revision hook, and scroll root.
 */
export interface ManualReaderOptions {
  readonly root: HTMLElement;
  readonly book: Readonly<Record<ManualAudience, ManualSection>>;
  readonly storage?: ThemePreferences;
  readonly storageKey?: string;
  readonly idPrefix?: string;
  readonly configure?: { readonly label: string; open(): void };
  /** Host-controlled live-content revision; ordinary chrome refresh preserves scroll/details. */
  readonly revision?: () => string;
  readonly scrollContainer?: HTMLElement;
}

/**
 * Active Manual reader UI instance (`ui.manual@1.0.0`).
 * Provides navigation control and DOM cleanup upon disposal.
 */
export interface ManualReader extends Disposable {
  refresh(): void;
  show(pageId: string): void;
}

/**
 * Service for registering documentation guides and creating interactive manual readers (`ui.manual@1.0.0`).
 * Disposing the service clears registered guides, listeners, active readers, and injected stylesheets.
 */
export interface ManualService extends Disposable {
  /** Candidate publication may temporarily shadow matching IDs; disposing its lease restores
   * the prior guides. Duplicate IDs inside one registration always fail. */
  register(pages: readonly ManualGuide[], options?: { readonly replace?: boolean }): Disposable;
  /** Guides remain discoverable by recovery/library UI without mounting a Manual reader. */
  guides(audience: ManualAudience): readonly ManualGuide[];
  create(options: ManualReaderOptions): ManualReader;
}

/** Service key for the Manual reader and guide catalog service (`ui.manual@1.0.0`). */
export const MANUAL_READER: ServiceKey<ManualService> = Object.freeze({ slot: 'ui.manual', version: '1.0.0' });

