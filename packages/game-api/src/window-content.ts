import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { UiControl } from './platform';

/** Inert structured text. Links navigate the host's document collection, never URLs. */
export type DocumentBlock =
  | { readonly type: 'paragraph' | 'heading' | 'code'; readonly text: string }
  | { readonly type: 'list'; readonly items: readonly string[]; readonly ordered?: boolean }
  | { readonly type: 'link'; readonly text: string; readonly page: string };
export interface WindowDocument { readonly blocks: readonly DocumentBlock[] }
export type PreviewData = null | boolean | number | string | readonly PreviewData[] | { readonly [key: string]: PreviewData };
export interface PreviewType { readonly name: string; readonly version: string }
export type WindowContentDefinition =
  | { readonly kind: 'document' | 'instruction'; readonly id: string; readonly document: WindowDocument }
  | { readonly kind: 'inspector' | 'form'; readonly id: string; readonly controls: readonly UiControl[] }
  | { readonly kind: 'list' | 'log'; readonly id: string; readonly items: readonly string[] }
  | { readonly kind: 'preview'; readonly id: string; readonly type: PreviewType; readonly data: PreviewData };
export interface WindowContentOptions {
  /** Host validates declared actions and authority; a preview never receives a mutable world. */
  action?(id: string, value: string | number | boolean): void;
  navigate?(page: string): void;
  control?(id: string, node: HTMLElement): void;
}
export interface WindowPreview extends Disposable {
  /** Pixels in this preview's own viewport. The provider owns its independent camera. */
  resize(width: number, height: number): void;
}
export interface WindowPreviewType {
  readonly type: PreviewType;
  /** Validate/capture data before creating resources. No authority is passed to a preview. */
  validate(data: PreviewData): PreviewData;
  mount(root: HTMLElement, data: PreviewData, options: WindowContentOptions): WindowPreview;
}
export interface WindowContentService extends Disposable {
  /** Owner-published named, exact-version extension; add-ons declare this service need. */
  register(preview: WindowPreviewType): Disposable;
  mount(root: HTMLElement, content: WindowContentDefinition, options?: WindowContentOptions): Disposable;
  document(root: HTMLElement, document: WindowDocument, options?: WindowContentOptions): Disposable;
}
export const WINDOW_CONTENT: ServiceKey<WindowContentService> = Object.freeze({ slot: 'ui.window-content', version: '1.0.0' });

/** Shared headless validation used by imported guides and portable document readers. */
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
export function documentText(document: WindowDocument): string {
  return document.blocks.map(block => block.type === 'list' ? block.items.join(' ') : block.text).join(' ');
}

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
