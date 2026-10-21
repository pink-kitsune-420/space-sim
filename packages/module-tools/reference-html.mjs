import { readFileSync } from 'node:fs';
const SCRIPT = readFileSync(new URL('./reference-search.js', import.meta.url), 'utf8');
// Presentation of the existing F29 catalog, never a second declaration extractor.
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fragment = id => '#' + encodeURIComponent(id);
const pageId = page => 'page:' + page.id;
const symbolName = item => item.namespace ? item.namespace + '.' + item.name : item.name;
const symbolId = item => 'symbol:' + item.stem + ':' + symbolName(item);

/** Render one self-contained, inert-data HTML view of the already generated public catalog.
 * Game Manual destinations outside this catalog remain labelled text, never broken links. */
export function renderHtml(bundle, documented, declarations) {
  const pages = [...bundle.pages, ...documented.map(module => ({ ...module.usage, id: module.manifest.id + '/usage' }))];
  const destinations = new Map(pages.map(page => [page.id, pageId(page)]));
  const symbols = new Map([...declarations.values()].map(item => [symbolName(item), symbolId(item)]));
  const link = (id, title) => '<a href="' + fragment(id) + '">' + escape(title) + '</a>';
  const reference = raw => {
    const name = raw.trim().replace(/^\{@link\s+([^}]+)\}$/, '$1');
    return symbols.has(name) ? link(symbols.get(name), name) : escape(raw);
  };
  const prose = raw => {
    const pieces = raw.split(/\s+(?=@(?:param|returns?|throws|deprecated|see)\b)/);
    // A comment may consist entirely of a tag.
    if (pieces[0].startsWith('@')) pieces.unshift('');
    const body = pieces.shift();
    return (body ? '<p>' + escape(body) + '</p>' : '') + pieces.map(piece => {
      const match = /^@(param|returns?|throws|deprecated|see)\s*([\s\S]*)$/.exec(piece);
      if (!match) return '<p>' + escape(piece) + '</p>';
      const [, tag, value] = match;
      if (tag === 'deprecated') return '<p class="deprecated"><strong>Deprecated:</strong> ' + escape(value) + '</p>';
      if (tag === 'see') return '<p><strong>See:</strong> ' + reference(value) + '</p>';
      return '<dl class="jsdoc"><dt>' + (tag === 'param' ? 'Parameter' : tag === 'throws' ? 'Throws' : 'Returns') + '</dt><dd>' + escape(value) + '</dd></dl>';
    }).join('');
  };
  const block = item => {
    if (item.type === 'heading') return '<h3>' + escape(item.text) + '</h3>';
    if (item.type === 'code') return '<pre><code>' + escape(item.text) + '</code></pre>';
    if (item.type === 'list') {
      const tag = item.ordered ? 'ol' : 'ul';
      return '<' + tag + '>' + item.items.map(text => '<li>' + escape(text) + '</li>').join('') + '</' + tag + '>';
    }
    if (item.type === 'link') return '<p>' + (destinations.has(item.page) ? link(destinations.get(item.page), item.text)
      : '<span class="manual-link">' + escape(item.text) + ' (in-game Manual: <code>' + escape(item.page) + '</code>)</span>') + '</p>';
    return prose(item.text);
  };
  const section = page => {
    let opened = false;
    const body = page.blocks.map(item => {
      if (page.id.startsWith('api-reference/game-api/') && item.type === 'heading' && symbols.has(item.text)) {
        const close = opened ? '</article>' : ''; opened = true;
        const id = symbols.get(item.text);
        return close + '<article data-entry><h3 id="' + escape(id) + '" tabindex="-1">' + escape(item.text)
          + ' <a class="permalink" href="' + fragment(id) + '" aria-label="Link to ' + escape(item.text) + '">§</a></h3>';
      }
      return block(item);
    }).join('\n') + (opened ? '</article>' : '');
    return '<section data-topic id="' + escape(pageId(page)) + '" tabindex="-1"><h2>' + escape(page.title)
      + ' <a class="permalink" href="' + fragment(pageId(page)) + '" aria-label="Link to ' + escape(page.title) + '">§</a></h2><p class="summary">'
      + escape(page.summary) + '</p>' + body + '</section>';
  };
  const group = (title, selected) => '<details open data-nav-group><summary>' + title + '</summary><ul>'
    + selected.map(page => '<li data-nav="' + escape(pageId(page)) + '">' + link(pageId(page), page.title) + '</li>').join('') + '</ul></details>';
  const navigation = group('Overview', pages.filter(page => page.id === 'api-reference'))
    + group('Modules', pages.filter(page => page.id.startsWith('api-reference/module/')))
    + group('Game API', pages.filter(page => page.id.startsWith('api-reference/game-api/')))
    + group('Creator guides', pages.filter(page => !page.id.startsWith('api-reference')));
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="color-scheme" content="dark light"><title>Spacelab module API reference</title><style>' + CSS + '</style></head><body>'
    + '<a class="skip" href="#reference-content">Skip to reference</a><header><h1>Spacelab module API reference</h1><p>'
    + escape(bundle.provenance) + '</p><p>Generated from public contracts, module manifests and Creator guides. Regenerate with <code>npm run module:reference</code>.</p></header>'
    + '<div class="layout"><aside><label for="reference-search">Search declarations and guides</label><div class="search"><input id="reference-search" type="search" disabled autocomplete="off" spellcheck="false">'
    + '<button id="reference-clear" type="button" hidden>Clear search</button></div><p id="reference-status" role="status" aria-live="polite">All topics shown.</p>'
    + '<noscript><p>All reference content is available below. Use your browser’s Find command to search without JavaScript.</p></noscript>'
    + '<nav aria-label="API reference topics">' + navigation + '</nav></aside><main id="reference-content" tabindex="-1">'
    + pages.map(section).join('\n') + '</main></div><script>' + SCRIPT + '</script></body></html>\n';
}

// Runs only in the standalone document. Source documentation is never inserted into script.

const CSS = `
:root{color-scheme:dark;background:#0b111b;color:#d8e2ee;font:16px/1.6 system-ui,sans-serif}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0}a{color:#8ec9ff;text-underline-offset:.2em}
a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #ffdf8c;outline-offset:3px}
header{padding:24px 32px;border-bottom:1px solid #354458}header h1{font-size:1.6rem;margin:0}header p{font-size:.85rem;overflow-wrap:anywhere;margin:.5em 0}
.layout{display:grid;grid-template-columns:290px minmax(0,1fr);max-width:1600px;margin:auto;gap:32px;padding:24px 32px}
aside{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;padding:8px}aside label{font-weight:600}
.search{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}input{min-width:0;width:100%;background:#111e2e;color:inherit;border:1px solid #70869e;border-radius:4px;padding:10px;font:inherit}
button{font:inherit;padding:4px 10px;background:#17283b;color:inherit;border:1px solid #70869e;border-radius:4px;cursor:pointer}
#reference-status{font-size:.85rem;min-height:2em}nav ul{list-style:none;margin:8px 0;padding:0}nav li{margin:6px 0}
nav a{display:block;overflow-wrap:anywhere;font-size:.9rem}nav summary{cursor:pointer;font-weight:600}nav details{margin-bottom:16px}
main{min-width:0}section{padding:8px 0 32px;border-bottom:1px solid #354458;margin-bottom:24px;scroll-margin-top:16px}
article{border-top:1px solid #26384c;margin-top:24px;padding-top:8px;scroll-margin-top:16px}
h2{font-size:1.4rem;margin:.4em 0}h3{font-size:1.1rem;overflow-wrap:anywhere;scroll-margin-top:16px}
p,li,dd{overflow-wrap:anywhere}.summary,.manual-link{color:#a9bbcc}.permalink{font-size:.85em;text-decoration:none;margin-left:.5em}
pre{background:#111e2e;border:1px solid #354458;border-radius:4px;padding:16px;overflow:auto;max-width:100%;font-size:.85rem;line-height:1.6}
code{font-family:ui-monospace,monospace}p code{overflow-wrap:anywhere}dl{margin:12px 0}dt{font-weight:600}dd{margin-left:20px}
.deprecated{border-left:3px solid #ffce73;padding:8px 12px}.skip{position:absolute;top:-100px;left:8px;background:#111e2e;padding:10px}.skip:focus{top:8px}
:target{outline:2px solid #8ec9ff;outline-offset:4px}
@media(max-width:800px){header{padding:20px}.layout{display:block;padding:16px}aside{position:static;max-height:45vh;margin-bottom:24px;border-bottom:1px solid #354458}h1{font-size:1.3rem}pre{padding:10px}}
@media print{aside,.skip,.permalink{display:none}.layout{display:block}header,section{break-inside:avoid}}
`;
