import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
/** package.json is the release identity; Git describes a build, never a module API. */
export function buildDefines(development = false) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  let revision = '', dirty = false;
  try {
    revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    dirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* Source archives still retain their canonical package version. */ }
  const info = { version, revision, development: development || dirty || /-(?:dev|snapshot|canary|next)(?:[.+-]|$)/.test(version) };
  return { __SPACELAB_BUILD_INFO__: JSON.stringify(info),
    __SPACE_SIM_ALLOW_RUNTIME_CODE__: JSON.stringify(process.env.SPACE_SIM_ALLOW_RUNTIME_CODE !== 'false') };
}
