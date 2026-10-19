import assets from 'virtual:space-sim-client';
import { spawn } from 'node:child_process';
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

function launchAppBrowser(
  url: string,
  fullscreen: boolean,
  customBrowser?: string,
  onClose?: () => void,
): void {
  if (customBrowser) {
    const args = [url];
    try {
      const child = spawn(customBrowser, args, { detached: true, stdio: 'ignore' });
      if (onClose) child.on('close', onClose);
      child.unref();
      return;
    } catch {
      // fallback
    }
  }

  // Attempt to launch in application/standalone mode (frameless window without browser chrome)
  const appArg = `--app=${url}`;
  const winSizeArg = '--window-size=1280,800';
  const fsArg = fullscreen ? '--start-fullscreen' : '';

  if (process.platform === 'win32') {
    // Try Edge or Chrome in app mode on Windows
    const candidates = [
      ['msedge', [appArg, winSizeArg, ...(fsArg ? [fsArg] : [])]],
      ['chrome', [appArg, winSizeArg, ...(fsArg ? [fsArg] : [])]],
      ['cmd', ['/c', 'start', '""', url]],
    ] as const;

    for (const [cmd, args] of candidates) {
      try {
        const child = spawn(cmd, args as unknown as string[], { detached: true, stdio: 'ignore' });
        child.on('error', () => {});
        if (onClose) child.on('close', onClose);
        child.unref();
        return;
      } catch {
        continue;
      }
    }
    return;
  }

  if (process.platform === 'darwin') {
    // macOS
    const candidates = [
      ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [appArg, winSizeArg, ...(fsArg ? [fsArg] : [])]],
      ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', [appArg, winSizeArg, ...(fsArg ? [fsArg] : [])]],
      ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', [appArg, winSizeArg, ...(fsArg ? [fsArg] : [])]],
      ['open', [url]],
    ] as const;

    for (const [cmd, args] of candidates) {
      try {
        const child = spawn(cmd, args as unknown as string[], { detached: true, stdio: 'ignore' });
        child.on('error', () => {});
        if (onClose) child.on('close', onClose);
        child.unref();
        return;
      } catch {
        continue;
      }
    }
    return;
  }

  // Linux / BSD
  const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

  // If a graphical display session is active, try a native GTK WebKit2 window (pure native OS window without browser UI)
  if (hasDisplay) {
    try {
      const pyScript = [
        'import sys, gi',
        'gi.require_version("Gtk", "3.0")',
        'gi.require_version("WebKit2", "4.1")',
        'from gi.repository import Gtk, WebKit2',
        'win = Gtk.Window(title="Spacelab")',
        'win.set_default_size(1280, 800)',
        'win.set_position(Gtk.WindowPosition.CENTER)',
        fullscreen ? 'win.fullscreen()' : '',
        'win.connect("destroy", Gtk.main_quit)',
        'wv = WebKit2.WebView()',
        'wv.connect("notify::title", lambda view, _: win.set_title(view.get_title() or "Spacelab"))',
        's = wv.get_settings()',
        's.set_enable_webgl(True)',
        's.set_enable_accelerated_2d_canvas(True)',
        'wv.load_uri(sys.argv[1])',
        'win.add(wv)',
        'win.show_all()',
        'Gtk.main()',
      ].filter(Boolean).join('; ');

      const pyChild = spawn('python3', ['-c', pyScript, url], {
        detached: false,
        stdio: 'ignore',
        env: process.env,
      });

      let spawned = true;
      pyChild.on('error', () => { spawned = false; });
      if (onClose) {
        pyChild.on('close', onClose);
      }
      if (spawned && pyChild.pid) {
        return;
      }
    } catch {
      // Fall through to browser candidates
    }
  }

  // Try browsers with dedicated application window mode
  const linuxCandidates = [
    ['google-chrome', [appArg, winSizeArg, ...(fsArg ? [fsArg] : [])]],
    ['google-chrome-stable', [appArg, winSizeArg, ...(fsArg ? [fsArg] : [])]],
    ['chromium', [appArg, winSizeArg, ...(fsArg ? [fsArg] : [])]],
    ['chromium-browser', [appArg, winSizeArg, ...(fsArg ? [fsArg] : [])]],
    ['brave-browser', [appArg, winSizeArg, ...(fsArg ? [fsArg] : [])]],
    ['microsoft-edge', [appArg, winSizeArg, ...(fsArg ? [fsArg] : [])]],
    ['firefox', ['--new-window', url]],
    ['xdg-open', [url]],
  ] as const;

  for (const [cmd, args] of linuxCandidates) {
    try {
      const child = spawn(cmd, args as unknown as string[], { detached: true, stdio: 'ignore' });
      let failed = false;
      child.on('error', () => { failed = true; });
      if (onClose) child.on('close', onClose);
      child.unref();
      if (!failed) return;
    } catch {
      continue;
    }
  }
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
    launchAppBrowser(gameUrl, args.fullscreen, args.browser, shutdown);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
