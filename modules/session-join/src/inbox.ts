import type { TextConnection } from '@space-sim/game-api';
import { MAX_TEXT } from './offer';
/** Bounded negotiation mailbox; handoff retains the first legacy greeting and ordering. */
export class Inbox {
  private readonly queued: string[] = [];
  private receiver: TextConnection['onmessage'] = null;
  private closed: string | undefined;
  private closeReceiver: TextConnection['onclose'] = null;
  private waiting?: { resolve(text: string): void; reject(error: Error): void };
  private handed = false;
  private queuedBytes = 0;
  readonly peer: TextConnection;
  constructor(raw: TextConnection, private readonly signal: AbortSignal) {
    const abort = (): void => this.fail('Game-pack negotiation cancelled');
    signal.addEventListener('abort', abort, { once: true });
    const release = (): void => signal.removeEventListener('abort', abort);
    this.peer = {
      label: raw.label, get bufferedAmount() { return raw.bufferedAmount; }, send: text => raw.send(text),
      close: reason => { release(); raw.close(reason); },
      get onmessage() { return inbox.receiver; }, set onmessage(value) { inbox.receiver = value; queueMicrotask(() => inbox.flush()); },
      get onclose() { return inbox.closeReceiver; }, set onclose(value) { inbox.closeReceiver = value; if (inbox.closed !== undefined) queueMicrotask(() => value?.(inbox.closed!)); },
    };
    const inbox = this;
    raw.onmessage = text => {
      if (this.closed !== undefined) return;
      if (this.handed && this.receiver && !this.queued.length) { this.receiver(text); return; }
      if (!this.handed && text.length > MAX_TEXT) { this.fail('Prejoin message exceeds 96 KiB'); return; }
      if (this.waiting) { const waiter = this.waiting; this.waiting = undefined; waiter.resolve(text); return; }
      if (this.queued.length >= 64 || this.queuedBytes + text.length > (this.handed ? 64 * 1024 * 1024 : 2 * MAX_TEXT)) { this.fail('Connection backlog exceeded'); return; }
      this.queued.push(text); this.queuedBytes += text.length;
    };
    raw.onclose = reason => { release(); this.closed ??= reason; this.queued.length = 0; this.queuedBytes = 0; this.waiting?.reject(new Error(reason)); this.waiting = undefined; this.closeReceiver?.(reason); };
    if (signal.aborted) abort();
  }
  private flush(): void {
    while (this.handed && this.receiver && this.queued.length && this.closed === undefined) {
      const text = this.queued.shift()!; this.queuedBytes -= text.length; this.receiver(text);
    }
  }
  next(): Promise<string> {
    this.signal.throwIfAborted();
    if (this.closed !== undefined) return Promise.reject(new Error(this.closed));
    if (this.queued.length) { const text = this.queued.shift()!; this.queuedBytes -= text.length; return Promise.resolve(text); }
    if (this.waiting) throw new Error('Concurrent prejoin read');
    return new Promise((resolve, reject) => { this.waiting = { resolve, reject }; });
  }
  handoff(first?: string): TextConnection {
    this.signal.throwIfAborted();
    if (this.closed !== undefined) throw new Error(this.closed);
    if (first !== undefined) { this.queued.unshift(first); this.queuedBytes += first.length; }
    this.handed = true; return this.peer;
  }
  fail(reason: string): void {
    if (this.closed !== undefined) return;
    this.closed = reason; this.queued.length = 0; this.queuedBytes = 0;
    this.waiting?.reject(new Error(reason)); this.waiting = undefined; this.peer.close(reason);
  }
}
