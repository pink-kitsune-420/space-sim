import { ACTION_DEFINITIONS, formatKeyCode, loadKeybindings, type ActionCategory, type ActionId, type KeyBindings } from './input-config';
import { MANUAL, type ManualAudience, type ManualPage } from './manual-content';
import type { Disposable } from '../../../packages/game-api/src/index';
import type { ModuleCandidateV2 } from '../../../packages/game-runtime/src/modules-v2';

interface ImportedPage extends ManualPage { readonly audience: ManualAudience; readonly render: () => HTMLElement }
const importedPages = new Map<symbol, readonly ImportedPage[]>();
function pages(audience: ManualAudience): readonly ManualPage[] {
  return [...MANUAL[audience].pages, ...[...importedPages.values()].flat().filter(page => page.audience === audience)];
}
/** Structured imported pages share the existing Players/Creators navigation. */
export function registerModuleGuides(candidate: ModuleCandidateV2): Disposable {
  const token = Symbol(), imported = candidate.contributions('guide').map(entry => {
    const document = JSON.parse(candidate.guideDocuments.get(entry.id)!) as { blocks: { type: string; text: string }[] };
    const page: ImportedPage = { ...entry.value, id: entry.id, html: '', render: () => {
      const root = window.document.createElement('div'), title = window.document.createElement('h2'); title.textContent = page.title; root.append(title);
      for (const block of document.blocks) {
        const node = window.document.createElement(block.type === 'heading' ? 'h3' : block.type === 'code' ? 'pre' : 'p');
        node.textContent = block.text; root.append(node);
      }
      return root;
    } }; return page;
  });
  importedPages.set(token, imported); document.dispatchEvent(new Event('module-guides-change'));
  return { dispose: () => { importedPages.delete(token); document.dispatchEvent(new Event('module-guides-change')); } };
}

const STORAGE_KEY = 'space-sim:manual:1';
const CATEGORY_TITLES: Readonly<Record<ActionCategory, string>> = { flight: 'Flight', warp: 'Time warp', view: 'Camera & view', system: 'System' };
const AUDIENCES = Object.keys(MANUAL) as ManualAudience[];

interface ManualState { audience: ManualAudience; page: Record<ManualAudience, string> }

/** Renders the Players / Creators manual into `#game-manual`, which the workspace hosts as the Manual window. */
export function initManual(): void {
  const root = document.getElementById('game-manual');
  if (!root) return;
  const state = loadState();
  root.innerHTML = `
    <div class="manual-tabs" role="tablist" aria-label="Manual audience">
      ${AUDIENCES.map(id => `<button type="button" role="tab" id="manual-tab-${id}" data-audience="${id}" aria-controls="manual-page">${MANUAL[id].label}</button>`).join('')}
    </div>
    <p class="manual-intro" id="manual-intro"></p>
    <input type="search" id="manual-search" class="manual-search" placeholder="Search the manual" aria-label="Search the manual" autocomplete="off" spellcheck="false" />
    <div class="manual-layout">
      <nav class="manual-topics" aria-label="Manual topics"><ul id="manual-topics"></ul></nav>
      <article id="manual-page" class="manual-page" role="tabpanel" tabindex="-1" aria-live="polite"></article>
    </div>`;
  const intro = root.querySelector<HTMLElement>('#manual-intro')!;
  const search = root.querySelector<HTMLInputElement>('#manual-search')!;
  const topics = root.querySelector<HTMLUListElement>('#manual-topics')!;
  const article = root.querySelector<HTMLElement>('#manual-page')!;
  // Plain text per page, for search; built once because page HTML is static.
  const searchText = new Map<ManualPage, string>();
  const indexPages = (): void => {
    searchText.clear();
    for (const id of AUDIENCES) for (const page of pages(id)) searchText.set(page, `${page.title} ${page.summary} ${page.html.replace(/<[^>]+>|\{\{[^}]+\}\}/g, ' ')}`.toLowerCase());
  }; indexPages();

  const currentPage = (): ManualPage => {
    const available = pages(state.audience);
    return available.find(page => page.id === state.page[state.audience]) ?? available[0]!;
  };

  const renderTopics = (): void => {
    const query = search.value.trim().toLowerCase();
    const available = pages(state.audience).filter(page => !query || searchText.get(page)!.includes(query));
    const active = currentPage();
    topics.replaceChildren(...available.map(page => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.page = page.id;
      button.className = 'manual-topic';
      button.innerHTML = `<b></b><span></span>`;
      button.querySelector('b')!.textContent = page.title;
      button.querySelector('span')!.textContent = page.summary;
      if (page === active) button.setAttribute('aria-current', 'page');
      item.append(button);
      return item;
    }));
    if (!available.length) {
      const empty = document.createElement('li');
      empty.className = 'manual-empty';
      empty.textContent = 'No pages match.';
      topics.append(empty);
    }
  };

  const renderPage = (): void => {
    const page = currentPage();
    const bindings = loadKeybindings();
    if ('render' in page && typeof page.render === 'function') { article.replaceChildren(page.render()); return; }
    article.innerHTML = `<h2>${page.title}</h2>${expandKeys(page.html, bindings)}`;
    for (const slot of article.querySelectorAll<HTMLElement>('[data-manual-controls]')) slot.replaceWith(controlsTable(bindings));
    for (const link of article.querySelectorAll<HTMLAnchorElement>('a[data-page]')) link.href = `#manual-${link.dataset.page}`;
  };

  const render = (): void => {
    for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-audience]')) tab.setAttribute('aria-selected', String(tab.dataset.audience === state.audience));
    article.setAttribute('aria-labelledby', `manual-tab-${state.audience}`);
    intro.textContent = MANUAL[state.audience].intro;
    renderTopics();
    renderPage();
  };

  const show = (pageId: string): void => {
    state.page[state.audience] = pageId;
    saveState(state);
    renderTopics();
    renderPage();
    // The hosting window's body scrolls, not the article.
    root.closest<HTMLElement>('.flight-window-body')?.scrollTo({ top: 0 });
    article.focus({ preventScroll: true });
  };

  root.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest<HTMLButtonElement>('[data-audience]');
    if (tab) {
      state.audience = tab.dataset.audience as ManualAudience;
      saveState(state);
      render();
      return;
    }
    const link = target?.closest<HTMLElement>('[data-page]');
    if (link) {
      event.preventDefault();
      show(link.dataset.page!);
    }
  });
  root.querySelector('.manual-tabs')!.addEventListener('keydown', event => {
    const key = (event as KeyboardEvent).key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    event.preventDefault();
    const index = AUDIENCES.indexOf(state.audience);
    state.audience = AUDIENCES[(index + (key === 'ArrowRight' ? 1 : AUDIENCES.length - 1)) % AUDIENCES.length]!;
    saveState(state);
    render();
    root.querySelector<HTMLButtonElement>(`#manual-tab-${state.audience}`)!.focus();
  });
  search.addEventListener('input', renderTopics);
  // Keys may have been remapped since the page was last drawn.
  document.addEventListener('window-change', event => {
    if ((event as CustomEvent<{ id: string }>).detail?.id === 'manual' && root.offsetParent !== null) renderPage();
  });
  render();
  document.addEventListener('module-guides-change', () => { indexPages(); render(); });
}

function expandKeys(html: string, bindings: KeyBindings): string {
  return html.replace(/\{\{key:(\w+)\}\}/g, (_, id: string) => {
    const code = bindings[id as ActionId]?.[0];
    return code ? `<kbd>${escape(formatKeyCode(code))}</kbd>` : '<kbd class="unbound" title="Not bound: set a key in Settings">—</kbd>';
  });
}

function controlsTable(bindings: KeyBindings): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'manual-controls';
  for (const category of Object.keys(CATEGORY_TITLES) as ActionCategory[]) {
    const actions = ACTION_DEFINITIONS.filter(action => action.category === category);
    if (!actions.length) continue;
    const table = document.createElement('table');
    table.innerHTML = `<caption>${CATEGORY_TITLES[category]}</caption><tbody>${actions.map(action => {
      const keys = bindings[action.id] ?? [];
      const cells = keys.length ? keys.map(code => `<kbd>${escape(formatKeyCode(code))}</kbd>`).join(' ') : '<span class="unbound">not bound</span>';
      return `<tr title="${escape(action.description)}"><th scope="row">${escape(action.name)}</th><td>${cells}</td></tr>`;
    }).join('')}</tbody>`;
    wrap.append(table);
  }
  return wrap;
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
}

function loadState(): ManualState {
  const state: ManualState = { audience: 'players', page: { players: MANUAL.players.pages[0]!.id, creators: MANUAL.creators.pages[0]!.id } };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ManualState> | null;
    if (stored && AUDIENCES.includes(stored.audience as ManualAudience)) state.audience = stored.audience!;
    for (const id of AUDIENCES) {
      const page = stored?.page?.[id];
      if (typeof page === 'string' && MANUAL[id].pages.some(entry => entry.id === page)) state.page[id] = page;
    }
  } catch { /* A remembered page is optional. */ }
  return state;
}

function saveState(state: ManualState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Lasts for this session. */ }
}
