import { serverUrl } from '../../../packages/net/src/websocket';

/** Keep offers in fragments so ordinary HTTP requests do not send invitation secrets. */
export function inviteLink(page: string, code: string): string | undefined {
  const url = new URL(page);
  if (!/^https?:$/.test(url.protocol)) return undefined;
  url.username = ''; url.password = '';
  url.hash = new URLSearchParams({ invite: code }).toString();
  return url.href;
}

/** Dedicated servers serve the client too; the same link opens and joins that world. */
export function serverLink(address: string, secure = false): string {
  const url = new URL(serverUrl(address, secure));
  if (url.username || url.password) throw new Error('Use the password field, not a password in the address.');
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = url.pathname.replace(/\/ws$/, '/');
  url.search = '';
  url.hash = 'join=1';
  return url.href;
}

/** The server marker identifies this page as the client for its serving endpoint.
 * Preserve a reverse proxy's directory prefix; root servers keep their familiar address. */
export function serverAddressForPage(page: string): string {
  const base = new URL('./', page);
  return base.pathname === '/' ? base.origin : new URL('ws', base).href;
}

/** Accept either a pasted raw offer or a shared game link. No navigation is performed. */
export function inviteFromText(text: string): string {
  const value = text.trim();
  try {
    const url = new URL(value);
    if (/^https?:$/.test(url.protocol)) return new URLSearchParams(url.hash.slice(1)).get('invite') ?? value;
  } catch { /* raw code */ }
  return value;
}

export function connectionRequest(hash: string): { invite?: string; join: boolean } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return { invite: params.get('invite') ?? undefined, join: params.get('join') === '1' };
}
