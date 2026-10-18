import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Load the bundled runtime's license before creating any executable artifacts.
 * NODE_LICENSE_PATH must refer to the license from the same Node distribution.
 */
export function readNodeLicense({ execPath = process.execPath, licensePath = process.env.NODE_LICENSE_PATH } = {}) {
  const candidates = licensePath === undefined
    ? [join(dirname(execPath), '..', 'LICENSE'), join(dirname(execPath), 'LICENSE')]
    : [resolve(licensePath)];
  for (const candidate of candidates) {
    try {
      const license = readFileSync(candidate);
      if (license.toString('utf8').trim()) return license;
    } catch {
      // Try the next standard location; an explicit path never falls back.
    }
  }
  throw new Error(`Node.js ${process.version} runtime LICENSE is missing, empty or unreadable. ` +
    `Set NODE_LICENSE_PATH to the LICENSE from the same Node.js release and distribution as ${execPath}. ` +
    `Checked: ${candidates.join(', ')}`);
}
