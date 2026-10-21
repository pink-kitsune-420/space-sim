// First-party offline document search. No documentation is interpolated into executable text.
(function activate() {
  const search = document.getElementById('reference-search'), clear = document.getElementById('reference-clear');
  const status = document.getElementById('reference-status');
  const navigation = new Map([...document.querySelectorAll('[data-nav]')].map(item => [item.dataset.nav, item]));
  const topics = [...document.querySelectorAll('[data-topic]')].map(element => ({
    element, title: element.querySelector('h2').textContent.toLowerCase(),
    text: element.textContent.toLowerCase(), nav: navigation.get(element.id),
    entries: [...element.querySelectorAll('[data-entry]')].map(element => ({ element, text: element.textContent.toLowerCase() })),
  }));
  let pending = 0;
  function apply() {
    pending = 0; const query = search.value.trim().toLowerCase(); let shown = 0, entries = 0;
    for (const topic of topics) {
      const title = !query || topic.title.includes(query); let matches = 0;
      for (const entry of topic.entries) {
        entry.element.hidden = !(title || entry.text.includes(query));
        if (!entry.element.hidden) matches++;
      }
      topic.element.hidden = topic.entries.length ? !matches : !(title || topic.text.includes(query));
      topic.nav.hidden = topic.element.hidden;
      if (!topic.element.hidden) { shown++; entries += topic.entries.length ? matches : 1; }
    }
    for (const group of document.querySelectorAll('[data-nav-group]')) group.hidden = [...group.querySelectorAll('li')].every(item => item.hidden);
    status.textContent = shown ? shown + ' topics · ' + entries + ' entries' : 'No matches. Clear search to show all topics.';
    clear.hidden = !search.value;
  }
  function schedule() { if (!pending) pending = requestAnimationFrame(apply); }
  function reset() { search.value = ''; if (pending) cancelAnimationFrame(pending); apply(); }
  search.disabled = false; search.addEventListener('input', schedule);
  search.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); reset(); } });
  clear.addEventListener('click', () => { reset(); search.focus(); });
  function navigate() {
    let target; try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { return; }
    if (!target) return;
    if (target.closest('[hidden]')) reset();
    target.scrollIntoView(); target.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', navigate);
  apply(); if (location.hash) navigate();
})();
