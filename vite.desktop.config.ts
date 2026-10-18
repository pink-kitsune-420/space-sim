import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.spacegame': 'application/gzip',
  '.spaceuniverse': 'application/gzip',
};

/** Embed the finished web build (dist/) into the desktop single executable runner. */
function clientAssets(): Plugin {
  const id = 'virtual:space-sim-client';
  return {
    name: 'space-sim-client-assets',
    resolveId: source => (source === id ? `\0${id}` : undefined),
    load(source) {
      if (source !== `\0${id}`) return undefined;
      const root = 'dist';
      const assets: Record<string, { type: string; data: string }> = {};
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) {
            walk(path);
            continue;
          }
          const type = TYPES[extname(name)];
          if (type) assets[`/${relative(root, path).split(sep).join('/')}`] = { type, data: readFileSync(path).toString('base64') };
        }
      };
      if (existsSync(join(root, 'index.html'))) walk(root);
      else this.warn('dist/index.html is missing: run the web build first.');
      return `export default ${JSON.stringify(assets)};`;
    },
  };
}

export default defineConfig({
  define: { __SPACE_SIM_ALLOW_RUNTIME_CODE__: JSON.stringify(process.env.SPACE_SIM_ALLOW_RUNTIME_CODE !== 'false') },
  publicDir: false,
  plugins: [clientAssets()],
  build: {
    ssr: 'apps/desktop/src/cli.ts',
    outDir: 'dist-desktop',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    copyPublicDir: false,
    rolldownOptions: { output: { format: 'cjs', entryFileNames: 'space-sim-desktop.cjs' } },
  },
  ssr: { noExternal: true, target: 'node' },
});
