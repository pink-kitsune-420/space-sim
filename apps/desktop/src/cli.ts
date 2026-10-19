import assets from 'virtual:space-sim-client';
import { launchAppBrowser } from './browser-launch';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseArgs } from 'node:util';
import { VERSION as version } from '../../../packages/game-runtime/src/build-info';
import { desktopHosting } from './hosting';

interface DesktopArgs {
  port: number;
  host: string;
  open: boolean;
  fullscreen: boolean;
  browser?: string;
  version: boolean;
  help: boolean;
}

const USAGE = `Spacelab · Space Sim (Desktop Player)

Usage: space-sim [options]

Options:
  --port <number>       Local port (default: 6465, or next available port)
  --host <address>      Local interface to bind (default: 127.0.0.1)
  --no-open             Serve the game without opening a window
  --fullscreen          Request fullscreen window in supported browsers
  --browser <binary>    Path or command for custom browser executable
  -v, --version         Show game version
  -h, --help            Show this help message
`;

function parseCli(argv: readonly string[]): DesktopArgs {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      'no-open': { type: 'boolean' },
      fullscreen: { type: 'boolean' },
      browser: { type: 'string' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  return {
    port: values.port ? Number(values.port) : 6465,
    host: values.host ?? '127.0.0.1',
    open: !(values['no-open'] ?? false),
    fullscreen: values.fullscreen ?? false,
    browser: values.browser,
    version: values.version ?? false,
    help: values.help ?? false,
  };
}



async function main(): Promise<void> {
  const args = parseCli(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (args.version) {
    console.log(`space-sim ${version}`);
    process.exit(0);
  }

  const files = new Map<string, { readonly type: string; readonly body: Buffer }>();
  for (const [path, asset] of Object.entries(assets ?? {})) {
    files.set(path, { type: asset.type, body: Buffer.from(asset.data, 'base64') });
  }

  if (!files.has('/index.html')) {
    console.error('Error: Bundled game assets missing /index.html');
    process.exit(1);
  }

  let desktopToken = '';
  const serve = (request: IncomingMessage, response: ServerResponse, lan = false): void => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }

    const file = files.get(pathname === '/' ? '/index.html' : pathname);
    const headers: Record<string, string | number> = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };

    if (!file) {
      response.writeHead(404, { ...headers, 'Content-Type': 'text/plain' }).end('Not found\n');
      return;
    }

    let body = file.body;
    if (pathname === '/' || pathname === '/index.html') {
      const address = request.socket.remoteAddress;
      const local = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
      const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(request.headers.host ?? '');
      const meta = lan ? '<meta name="space-sim-server" content="1" />'
        : local && localHost ? `<meta name="space-sim-desktop" content="${desktopToken}" />` : '';
      body = Buffer.from(body.toString('utf8').replace('</head>', `${meta}</head>`));
    }
    headers['Content-Type'] = file.type;
    headers['Content-Length'] = body.length;
    headers['Cache-Control'] = pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';

    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : body);
  };

  const server = createServer((request, response) => serve(request, response));
  const hosting = desktopHosting(server, (request, response) => serve(request, response, true));
  desktopToken = hosting.token;

  const listen = (port: number): Promise<number> => new Promise((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && port !== 0) {
        // Fallback to dynamic port allocation
        server.listen(0, args.host, () => {
          resolve((server.address() as AddressInfo).port);
        });
      } else {
        reject(err);
      }
    });

    server.listen(port, args.host, () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

  const activePort = await listen(args.port);
  const gameUrl = `http://${args.host}:${activePort}/`;

  console.log([
    '',
    `  Spacelab · Space Sim ${version}`,
    `  Game running at: ${gameUrl}`,
    '  To share your loaded world, choose Online → Host on this computer.',
    args.open ? '  Opening game window...' : '  (Browser launch skipped via --no-open)',
    '  Press Ctrl+C to stop.',
    '',
  ].join('\n'));

  const shutdown = (): void => {
    console.log('\nClosing game...');
    void hosting.stop().then(() => server.close(() => {
      process.exit(0);
    }));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (args.open) {
    if(!await launchAppBrowser(gameUrl,args.fullscreen,args.browser,shutdown))console.error(`Could not open a browser. Open ${gameUrl} manually; the game server is still running.`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
