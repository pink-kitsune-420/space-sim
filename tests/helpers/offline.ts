import type { BrowserContext } from '@playwright/test';

/** Disconnect real network transports while retaining file: navigation. WebKit's offline
 * emulation rejects local documents too; explicit routing keeps the offline file check meaningful. */
export async function disableNetwork(context: BrowserContext): Promise<void> {
  await context.route(/^https?:\/\//, route => route.abort('internetdisconnected'));
  await context.routeWebSocket(/.*/, socket => socket.close());
  if (context.browser()?.browserType().name() !== 'webkit') await context.setOffline(true);
}
