import { CHAT_CONSOLES, type ChatConsole, type ChatConsoleOptions, type Disposable, type ModuleInitializationV2 } from '@space-sim/game-api';
import { CHAT_STYLE } from './style';
import { CHAT_TEMPLATE } from './template';
import { initChatWindow } from './layout';

export function createChatConsole(options: ChatConsoleOptions): ChatConsole {
  const historyLines=options.historyLines??60;
  if(!Number.isInteger(historyLines)||historyLines<1||historyLines>1000)throw new Error('Chat history must retain 1–1000 lines');
  const controller = new AbortController(), document = options.root.ownerDocument, window = document.defaultView!;
  let disposed = false; const hadClass = options.root.classList.contains('chat-overlay');
  options.root.classList.add('chat-overlay'); options.root.innerHTML = CHAT_TEMPLATE;
  const style = document.createElement('style'); style.textContent = CHAT_STYLE; options.root.append(style);
  const chatOverlay = options.root;
  const chatMessages = options.root.querySelector<HTMLElement>('#chat-messages');
  const chatForm = options.root.querySelector<HTMLFormElement>('#chat-form');
  const chatInput = options.root.querySelector<HTMLInputElement>('#chat-input');
  const chatToggleBtn = options.toggle;
  const chatMinimizeBtn = options.root.querySelector<HTMLElement>('#chat-minimize');
  const chatMinPill = options.root.querySelector<HTMLElement>('#chat-min-pill');
  const chatUnreadDot = options.root.querySelector<HTMLElement>('#chat-unread-dot');

  let chatMinimized = false;
  try {
    chatMinimized = localStorage.getItem('space-sim:chat:minimized') === 'true';
  } catch {}

  function setChatMinimized(minimized: boolean, focusInput = false): void {
    if (!minimized && focusInput && options.visible?.() === false) options.setVisible?.(true);
    chatMinimized = minimized;
    try {
      localStorage.setItem('space-sim:chat:minimized', String(minimized));
    } catch {}
    chatOverlay?.classList.toggle('minimized', minimized);
    if (chatMinPill) chatMinPill.hidden = !minimized;
    chatToggleBtn?.setAttribute('aria-pressed', String(!minimized));
    chatToggleBtn?.classList.toggle('active', !minimized);
    if (!minimized) {
      if (chatUnreadDot) chatUnreadDot.hidden = true;
      if (focusInput) chatInput?.focus();
    }
  }

  // Initial state
  setChatMinimized(chatMinimized);
  const layout = initChatWindow(options.viewport, options.root, options.windows);

  function logChatMessage(kind: 'system' | 'error' | 'success' | 'chat', text: string, sender?: string): void {
    if (disposed || !chatMessages) return;
    const msg = document.createElement('div');
    msg.className = `chat-msg ${kind}`;
    if (sender) {
      const s = document.createElement('span');
      s.className = 'sender';
      s.textContent = `${sender}:`;
      msg.appendChild(s);
    } else if (kind === 'system') {
      const t = document.createElement('span');
      t.className = 'chat-tag';
      t.textContent = 'SYSTEM';
      msg.appendChild(t);
    } else if (kind === 'error') {
      const t = document.createElement('span');
      t.className = 'chat-tag';
      t.textContent = 'ERROR';
      msg.appendChild(t);
    } else if (kind === 'success') {
      const t = document.createElement('span');
      t.className = 'chat-tag';
      t.textContent = 'OK';
      msg.appendChild(t);
    }
    const content = document.createTextNode(` ${text}`);
    msg.appendChild(content);
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    while (chatMessages.children.length > historyLines) {
      chatMessages.firstElementChild?.remove();
    }
    if (chatMinimized && chatUnreadDot) {
      chatUnreadDot.hidden = false;
    }
  }

  chatForm?.addEventListener('submit', event => {
    event.preventDefault();
    if (!chatInput) return;
    const text = chatInput.value;
    chatInput.value = '';
    options.submit(text);
  }, { signal: controller.signal });

  chatMinimizeBtn?.addEventListener('click', () => setChatMinimized(true), { signal: controller.signal });
  chatMinPill?.addEventListener('click', () => setChatMinimized(false, true), { signal: controller.signal });

  chatToggleBtn?.addEventListener('click', () => {
    if (options.visible?.() === false) {
      options.setVisible?.(true); setChatMinimized(false, true); return;
    }
    if (chatMinimized) {
      setChatMinimized(false, true);
    } else if (document.activeElement === chatInput) {
      setChatMinimized(true);
    } else {
      chatInput?.focus();
    }
  }, { signal: controller.signal });

  window.addEventListener('keydown', event => {
    if (event.code === 'Enter') {
      if (document.activeElement === chatInput) {
        // Handled by form submit
      } else if (!document.activeElement?.closest('input, select, button, summary, a, textarea, [contenteditable]')) {
        event.preventDefault();
        setChatMinimized(false, true);
      }
    } else if (event.code === 'Slash') {
      if (document.activeElement !== chatInput && !document.activeElement?.closest('input, select, button, summary, a, textarea, [contenteditable]')) {
        event.preventDefault();
        options.setVisible?.(true);
        setChatMinimized(false);
        if (chatInput) {
          chatInput.focus();
          chatInput.value = '/';
        }
      }
    } else if (event.code === 'Escape') {
      if (document.activeElement === chatInput) {
        chatInput?.blur();
        setChatMinimized(true);
        event.preventDefault();
      }
    }
  }, { signal: controller.signal });

  if (options.initialMessage) { chatMessages!.textContent = ''; logChatMessage('system', options.initialMessage); }
  return { log: logChatMessage,
    show(line, playerId) { logChatMessage('chat', line.text, line.from === undefined ? line.name : line.from === playerId ? `${line.name} (you)` : line.name); },
    clear() { if (chatMessages) chatMessages.textContent = ''; }, minimize: setChatMinimized,
    dispose() {
      if (disposed) return; disposed = true; const errors: unknown[] = [];
      const close = (action: () => void): void => { try { action(); } catch (error) { errors.push(error); } };
      close(() => controller.abort()); close(() => layout.dispose()); close(() => style.remove());
      close(() => options.root.replaceChildren());
      close(() => { if (!hadClass) options.root.classList.remove('chat-overlay'); });
      if (errors.length) throw new AggregateError(errors, 'Chat console cleanup failed');
    }
  };
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Chat console', summary: 'Optional session chat and command UI with owned DOM lifecycle.', asset: 'docs/creators/usage.json' });
  const consoles = new Set<ChatConsole>(); let disposed = false;
  context.provide(CHAT_CONSOLES, { create(options) {
    if (disposed) throw new Error('Chat console provider is disposed');
    const console = createChatConsole({historyLines:context.settings.historyLines,...options}), dispose = console.dispose.bind(console);
    console.dispose = () => { consoles.delete(console); dispose(); }; consoles.add(console); return console;
  } });
  context.own({ dispose() { if (disposed) return; disposed = true; const errors: unknown[] = [];
    for (const console of consoles) { try { console.dispose(); } catch (error) { errors.push(error); } }
    consoles.clear(); if (errors.length) throw new AggregateError(errors, 'Chat provider cleanup failed'); } } satisfies Disposable);
}
