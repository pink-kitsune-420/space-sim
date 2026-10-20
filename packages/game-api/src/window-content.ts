import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { UiControl } from './platform';

/**
 * Inert structured text block for portable window documents and guides.
 * Links navigate the host's document catalog, never external URLs.
 */
export type DocumentBlock =
  | { readonly type: 'paragraph' | 'heading' | 'code'; readonly text: string }
  | { readonly type: 'list'; readonly items: readonly string[]; readonly ordered?: boolean }
  | { readonly type: 'link'; readonly text: string; readonly page: string };

/**
 * Validated immutable structured document composed of up to 256 document blocks.
 */
export interface WindowDocument {
  readonly blocks: readonly DocumentBlock[];
}

/**
 * Bounded JSON-compatible value used as candidate data for registered window previews.
 * Subject to recursive depth (max 16) and total element (max 4096) boundaries.
 */
export type PreviewData = null | boolean | number | string | readonly PreviewData[] | { readonly [key: string]: PreviewData };

/**
 * Named, exact-version identifier descriptor for a registered preview component.
 */
export interface PreviewType {
  readonly name: string;
  readonly version: string;
}

/**
 * Tagged union of content sections mountable inside window bodies or dialog layouts.
 * Supports portable documents, interactive inspector forms, scrollable lists/logs, and custom previews.
 */
export type WindowContentDefinition =
  | { readonly kind: 'document' | 'instruction'; readonly id: string; readonly document: WindowDocument }
  | { readonly kind: 'inspector' | 'form'; readonly id: string; readonly controls: readonly UiControl[] }
  | { readonly kind: 'list' | 'log'; readonly id: string; readonly items: readonly string[] }
  | { readonly kind: 'preview'; readonly id: string; readonly type: PreviewType; readonly data: PreviewData };

/**
 * Host callbacks provided when mounting window content structures.
 * Routes declared UI actions, document page navigation, and control attachments.
 */
export interface WindowContentOptions {
  /** Host validates declared actions and authority; a preview never receives a mutable world. */
  action?(id: string, value: string | number | boolean): void;
  navigate?(page: string): void;
  control?(id: string, node: HTMLElement): void;
}

/**
 * Disposable preview instance mounted inside a window content container.
 * Controls its own canvas or DOM tree and receives dimension updates in CSS pixels.
 */
export interface WindowPreview extends Disposable {
  /** Resize viewport to width and height in CSS pixels. The provider owns its independent camera. */
  resize(width: number, height: number): void;
}

/**
 * Extension descriptor for registering a custom versioned preview component (`ui.window-content@1.0.0`).
 * Enforces data validation prior to resource allocation; never receives simulation state or world authority.
 */
export interface WindowPreviewType {
  readonly type: PreviewType;
  /** Validate/capture data before creating resources. No authority is passed to a preview. */
  validate(data: PreviewData): PreviewData;
  mount(root: HTMLElement, data: PreviewData, options: WindowContentOptions): WindowPreview;
}

/**
 * Service for registering preview types and mounting structured content sections (`ui.window-content@1.0.0`).
 * Disposing the service unregisters active preview types and cleans up mounted sections.
 */
export interface WindowContentService extends Disposable {
  /** Owner-published named, exact-version extension; add-ons declare this service need. */
  register(preview: WindowPreviewType): Disposable;
  mount(root: HTMLElement, content: WindowContentDefinition, options?: WindowContentOptions): Disposable;
  document(root: HTMLElement, document: WindowDocument, options?: WindowContentOptions): Disposable;
}

/** Service key for the window content mounting and preview registry service (`ui.window-content@1.0.0`). */
export const WINDOW_CONTENT: ServiceKey<WindowContentService> = Object.freeze({ slot: 'ui.window-content', version: '1.0.0' });

/**
 * Headless parser and validator for portable guide and manual documents.
 * Validates block structure, restricts character limits (<= 64 KiB total), and returns a deeply frozen document.
 * Throws when block count exceeds 256, when text length exceeds 64 KiB, or when unsupported block fields exist.
 */
export function captureDocument(value: unknown): WindowDocument {
  const raw = value as WindowDocument | null;
  if (!raw || !Array.isArray(raw.blocks) || raw.blocks.length > 256) throw new Error('At most 256 document blocks');
  let characters = 0;
  const text = (value: unknown): string => {
    if (typeof value !== 'string' || (characters += value.length) > 65536) throw new Error('Document text exceeds 64 KiB');
    return value;
  };
  const blocks = raw.blocks.map((block): DocumentBlock => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) throw new Error('Unsupported guide block');
    const fields = block.type === 'list' ? ['type', 'items', 'ordered'] : block.type === 'link' ? ['type', 'text', 'page'] : ['type', 'text'];
    if (Object.keys(block).some(key => !fields.includes(key))) throw new Error('Unsupported guide block field');
    switch (block.type) {
      case 'paragraph': case 'heading': case 'code': return Object.freeze({ type: block.type, text: text(block.text) });
      case 'list':
        if (!Array.isArray(block.items) || block.items.length > 256 || (block.ordered !== undefined && typeof block.ordered !== 'boolean')) throw new Error('Invalid document list');
        return Object.freeze({ type: block.type, items: Object.freeze(block.items.map(text)), ordered: block.ordered === true });
      case 'link':
        if (typeof block.page !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9./-]{0,255}$/.test(block.page)) throw new Error('Invalid document page');
        return Object.freeze({ type: block.type, text: text(block.text), page: block.page });
      default: throw new Error('Unsupported guide block');
    }
  });
  return Object.freeze({ blocks: Object.freeze(blocks) });
}

/**
 * Extracts searchable raw plain text from a structured window document.
 * Concatenates all paragraph, heading, code, and list item text separated by spaces.
 */
export function documentText(document: WindowDocument): string {
  return document.blocks.map(block => block.type === 'list' ? block.items.join(' ') : block.text).join(' ');
}

/**
 * Validates and deep-freezes candidate data for a window preview component.
 * Recursively inspects data structure ensuring depth <= 16, total elements <= 4096, and encoded UTF-8 text <= 64 KiB.
 * Throws when data exceeds structural or byte-size boundaries.
 */
export function capturePreviewData(value: PreviewData): PreviewData {
  let count = 0, bytes = 0;
  const text = (value: string): string => {
    bytes += new TextEncoder().encode(value).byteLength;
    if (bytes > 65536) throw new Error('Preview text exceeds 64 KiB');
    return value;
  };
  const copy = (value: PreviewData, depth: number): PreviewData => {
    if (++count > 4096 || depth > 16) throw new Error('Preview data exceeds bounds');
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return Object.freeze(value.map(item => copy(item, depth+1)));
    if (value && typeof value === 'object') {
      const result: Record<string,PreviewData> = Object.create(null);
      for (const [key,item] of Object.entries(value)) { if (key.length > 256) throw new Error('Preview key exceeds bounds'); result[text(key)] = copy(item, depth+1); }
      return Object.freeze(result);
    }
    throw new Error('Invalid preview data');
  };
  return copy(value,0);
}

