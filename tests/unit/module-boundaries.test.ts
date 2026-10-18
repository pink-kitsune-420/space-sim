import { describe, expect, it } from 'vitest';
import { checkBoundaries, checkSource, reachable } from '../../packages/module-tools/check-boundaries.mjs';

describe('module public imports', () => {
  it('checks authored modules, the API and the implementation-free runtime', async () => {
    expect(await checkBoundaries()).toBeGreaterThan(20);
  });
  it('keeps the headless server free of renderer, browser and presentation-module code', async () => {
    const files = [...await reachable('apps/server/src/cli.ts')];
    expect(files).toEqual(expect.arrayContaining(['apps/server/src/server.ts', 'packages/modules/src/base/motion.ts', 'packages/net/src/host.ts']));
    expect(files.filter(f => /^(packages\/render-2d\/|apps\/web\/|examples\/modules\/|packages\/modules\/src\/(browser|base\/renderers|base\/toolset\/|base\/audio\/))/.test(f))).toEqual([]);
    // The browser graph does load them, so the check above is meaningful.
    const browser = [...await reachable('apps/web/src/main.ts')];
    expect(browser).toEqual(expect.arrayContaining(['packages/render-2d/src/webgl.ts', 'packages/modules/src/base/toolset/telemetry.ts', 'examples/modules/lead-camera.ts']));
  }, 20000);
  it('lets first-party toolset modules import only the public API and each other', () => {
    expect(checkSource("import type { FlightDataApi } from './flight-data';", 'packages/modules/src/base/toolset/telemetry.ts')).toEqual([]);
    expect(checkSource("import { WORLD } from '../motion';", 'packages/modules/src/base/toolset/telemetry.ts').length).toBeGreaterThan(0);
    expect(checkSource("import { World } from '../../../../sim-core/src/world';", 'packages/modules/src/base/toolset/telemetry.ts').length).toBeGreaterThan(0);
    expect(checkSource("import type { State } from '../../../../game-api/src/index';", 'packages/modules/src/base/toolset/telemetry.ts')).toEqual([]);
  });
  it('rejects private imports, reexports, type imports, require and computed imports', () => {
    for (const source of [
      "import { step } from '../../packages/sim-core/src/index';",
      "export { step } from '../../packages/sim-core/src/context';",
      "type X = import('../../apps/web/src/main').World;",
      "const x = require('../../packages/sim-core/src/context');",
      'const x = import(name);',
      "import x from 'some-private-package';",
    ]) expect(checkSource(source, 'examples/modules/check.ts').length).toBeGreaterThan(0);
    expect(checkSource("import type { State } from '../../packages/game-api/src/index';", 'examples/modules/check.ts')).toEqual([]);
    expect(checkSource("import { World } from '../../sim-core/src/world';", 'packages/game-runtime/src/new.ts').length).toBeGreaterThan(0);
    expect(checkSource("// import x from 'private';\nconst message = 'import private';", 'examples/modules/check.ts')).toEqual([]);
  });
});
