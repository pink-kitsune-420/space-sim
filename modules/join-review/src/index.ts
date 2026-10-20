import { JOIN_REVIEW, type Disposable, type JoinOffer, type JoinReviewService, type ModuleInitializationV2 } from '@space-sim/game-api';
const STYLE = '.join-pack-review{width:min(720px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;background:var(--ui-win-bg,#101d29);color:var(--ui-win-text,#dce9eb);border:1px solid var(--ui-win-border,#456);border-radius:10px;padding:18px}.join-pack-review table{width:100%;border-collapse:collapse}.join-pack-review th,.join-pack-review td{padding:8px;text-align:left;border-bottom:1px solid var(--ui-win-border,#456);vertical-align:top}.join-pack-review code{overflow-wrap:anywhere;font-size:11px}.join-pack-review footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.join-pack-review::backdrop{background:#0009}';
/** Construct a join review UI service displaying package consent dialogs. */
export function createJoinReview(): JoinReviewService & Disposable {
  const pending = new Set<() => void>(); let disposed = false;
  return {
    review(offer: JoinOffer, address: string, signal: AbortSignal) {
      if (disposed) return Promise.reject(new Error('Join review service is disposed'));
      signal.throwIfAborted();
      return new Promise<boolean>(resolve => {
        const previous = document.activeElement as HTMLElement | null, dialog = document.createElement('dialog');
        dialog.className = 'join-pack-review'; dialog.setAttribute('aria-labelledby', 'join-pack-title');
        const style = document.createElement('style'); style.textContent = STYLE; dialog.append(style);
        const title = document.createElement('h2'); title.id = 'join-pack-title'; title.textContent = `Join ${offer.name}`; dialog.append(title);
        const location = document.createElement('p'); location.textContent = address; dialog.append(location);
        const summary = document.createElement('p'); summary.textContent = `This server requires the following game packages. Total transfer: ${(offer.packBytes / 1024).toFixed(1)} KiB. These modules are enabled only for this server session.`; dialog.append(summary);
        if (offer.packages.some(item => item.containsCode)) {
          const warning = document.createElement('p'); warning.textContent = 'Trusted code can read game data and input and send network requests. Install code only from a source you trust. Approval applies to the exact packages shown below.'; dialog.append(warning);
        }
        const table = document.createElement('table'), heading = document.createElement('tr');
        for (const text of ['Package', 'Type and source', 'License']) { const cell = document.createElement('th'); cell.textContent = text; heading.append(cell); }
        table.append(heading);
        for (const item of offer.packages) {
          const row = document.createElement('tr'), name = document.createElement('td'), type = document.createElement('td'), license = document.createElement('td');
          name.append(`${item.id}@${item.version}`);
          const details = document.createElement('details'), label = document.createElement('summary'), hash = document.createElement('code');
          label.textContent = 'Exact package identity'; hash.textContent = `SHA-256 ${item.digest}`; details.append(label, hash); name.append(details);
          type.textContent = `${item.containsCode ? 'Code' : 'Data'} · ${item.tier} · ${item.required ? 'Required' : 'Optional'} · ${item.sourceIncluded ? 'Editable source included' : 'Legacy source unavailable'}`;
          license.textContent = item.license; row.append(name, type, license); table.append(row);
        }
        dialog.append(table);
        const protocol = document.createElement('p'); protocol.textContent = `Session: ${offer.protocol} · ${offer.entitySchema} · ${offer.model}`; dialog.append(protocol);
        const actions = document.createElement('footer'), cancel = document.createElement('button'), install = document.createElement('button');
        cancel.type = install.type = 'button'; cancel.textContent = 'Cancel'; cancel.autofocus = true; install.textContent = 'Install and join'; actions.append(cancel, install); dialog.append(actions);
        let finished = false;
        const finish = (accepted: boolean): void => {
          if (finished) return; finished = true; pending.delete(abort); signal.removeEventListener('abort', abort);
          dialog.close(); dialog.remove(); if (previous?.isConnected) previous.focus(); resolve(accepted);
        };
        const abort = (): void => finish(false); pending.add(abort); signal.addEventListener('abort', abort, { once: true });
        cancel.onclick = abort; install.onclick = () => finish(true); dialog.oncancel = event => { event.preventDefault(); abort(); };
        document.body.append(dialog); dialog.showModal(); cancel.focus();
      });
    },
    dispose() { if (disposed) return; disposed = true; for (const cancel of pending) cancel(); pending.clear(); },
  };
}
/** Initialize the server pack review UI module, providing ui.join-review@1.0.0. */
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Server pack review', summary: 'Exact package review and explicit consent with Cancel focused by default.', asset: 'docs/creators/usage.json' });
  context.provide(JOIN_REVIEW, context.own(createJoinReview()));
}
