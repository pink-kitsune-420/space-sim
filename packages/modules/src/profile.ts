import type { ModuleProfile } from '../../game-api/src/index';
import { MAX_MODULE_BYTES, parseDataModule, validateDataModule, type DataModule } from './data';
import { validateProfile } from '../../game-runtime/src/index';
import { keys, object, string } from '../../game-runtime/src/validation';

/** A portable profile contains data, never executable source or a running world. */
export interface ModuleBundle {
  readonly format: 'space-sim-module-profile/1';
  readonly profile: ModuleProfile;
  readonly modules: readonly DataModule[];
  readonly code?: readonly { readonly id: string; readonly version: string; readonly digest: string }[];
  readonly presentation?: ModuleProfile;
  readonly selection: { readonly universe: string; readonly system?: string };
}
export function parseModuleImport(text: string): DataModule | ModuleBundle {
  if (new TextEncoder().encode(text).length > MAX_MODULE_BYTES) throw new Error('Module files must be at most 4 MiB');
  const raw = object(JSON.parse(text), 'Module file');
  if (raw.format !== 'space-sim-module-profile/1') return parseDataModule(text);
  keys(raw, ['format', 'profile', 'modules', 'selection', 'code', 'presentation'], 'Module profile');
  if (!Array.isArray(raw.modules) || raw.modules.length > 256) throw new Error('Module profile: expected at most 256 data modules');
  if (raw.code !== undefined && (!Array.isArray(raw.code) || raw.code.length > 256)) throw new Error('Profile code: expected at most 256 requirements');
  const code = (raw.code as unknown[] | undefined)?.map(value => {
    const ref = object(value, 'Profile code requirement');
    keys(ref, ['id', 'version', 'digest'], 'Profile code requirement');
    const digest = string(ref.digest, 'Profile code digest');
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('Profile code digest: invalid SHA-256');
    return { id: string(ref.id, 'Profile code id'), version: string(ref.version, 'Profile code version'), digest };
  });
  const selection = object(raw.selection, 'Module profile selection');
  keys(selection, ['universe', 'system'], 'Module profile selection');
  return { format: 'space-sim-module-profile/1', ...(code ? { code } : {}),
    ...(raw.presentation === undefined ? {} : { presentation: validateProfile(raw.presentation) }), profile: validateProfile(raw.profile), modules: raw.modules.map(validateDataModule),
    selection: { universe: string(selection.universe, 'Module profile universe'),
      ...(selection.system === undefined ? {} : { system: string(selection.system, 'Module profile system') }) } };
}
