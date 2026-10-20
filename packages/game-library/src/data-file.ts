/** Host-only reusable data files (`packages/game-library`): `.spacedata` universe, shader and content payloads. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); authors use `npm run file:pack`, `file:unpack` and `file:validate`. */
import { keys, object, string } from '../../game-runtime/src/validation';
import { validateUniverse } from '../../sim-core/src/universe';
import { validateDataModule } from '../../modules/src/data';
import { createIntegrity, inspectModuleFiles, jsonBytes, modulePayload, parsePackageJson, requiredFile, validateShaderPayload, verifyIntegrity, type ShippedPackageOptions } from './portable';
import { readJsonFile } from './compression';
import { isZip, readZip, writeZip, type PackageFiles, type ZipOptions } from './zip';

/** Payload kind of a reusable data file: `universe`, `shaders` or `content`. Host-only (`packages/game-library`). */
export type DataFileKind = 'universe' | 'shaders' | 'content';
/** Descriptor format of a plain reusable data file, which holds exactly `data.json`, one `data/<kind>.json` payload and `integrity.json`. Host-only (`packages/game-library`). */
export const DATA_FILE_FORMAT = 'spacelab-data/1';
/** Validated reusable data: kind, payload value and files. Host-only (`packages/game-library`). */
export interface InspectedDataFile { readonly kind: DataFileKind; readonly value: unknown; readonly files: PackageFiles }
function validate(kind: DataFileKind, value: unknown): unknown {
  if (kind === 'universe') return validateUniverse(value);
  if (kind === 'content') return validateDataModule(value);
  validateShaderPayload(value); return value;
}
/** Plain reusable content carries its original data, without inventing a module ID or licence. */
export async function encodeDataFile(kind: DataFileKind, value: unknown, options: ZipOptions & ShippedPackageOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const checked = validate(kind, value), path = `data/${kind}.json`;
  const files = new Map([['data.json', jsonBytes({ format: DATA_FILE_FORMAT, kind, path })], [path, jsonBytes(checked)]]);
  files.set('integrity.json', jsonBytes(createIntegrity(files)));
  return writeZip(files, options);
}
/** Verifies integrity and validates reusable data; module-style data packages are inspected as `.spacedata` packages. Extra entries fail with `Reusable data files contain only their descriptor, payload and integrity`. Host-only (`packages/game-library`). */
export function inspectDataFiles(files: PackageFiles, options: ShippedPackageOptions = {}): InspectedDataFile {
  verifyIntegrity(files);
  const d = object(parsePackageJson(requiredFile(files, 'data.json'), 'Data descriptor'), 'Data descriptor');
  if (d.format !== DATA_FILE_FORMAT) {
    const module = inspectModuleFiles(files, true, options);
    const kind: DataFileKind = module.descriptor.data.some(p => p.kind === 'universe') ? 'universe' : module.content ? 'content' : 'shaders';
    return { kind, value: kind === 'content' ? module.content : modulePayload(module, kind), files };
  }
  keys(d, ['format', 'kind', 'path'], 'Data descriptor');
  if (!['universe', 'shaders', 'content'].includes(d.kind as string) || d.path !== `data/${d.kind}.json`) throw new Error('Unsupported reusable data layout');
  if (files.size !== 3) throw new Error('Reusable data files contain only their descriptor, payload and integrity');
  const value = parsePackageJson(requiredFile(files, string(d.path, 'Data path')), 'Data payload');
  return { kind: d.kind as DataFileKind, value: validate(d.kind as DataFileKind, value), files };
}
/** Reads reusable data of `kind` from a ZIP, or from legacy JSON or gzip. Saved progress fails with `This is saved progress. Use Fleet → Load universe…`, another kind with `Expected <kind> data; this file contains <other>`. Host-only (`packages/game-library`). */
export async function decodeDataFile(bytes: Uint8Array<ArrayBuffer>, kind: DataFileKind, options: ZipOptions & ShippedPackageOptions = {}): Promise<unknown> {
  if (!isZip(bytes)) return validate(kind, await readJsonFile(bytes));
  const files = await readZip(bytes, options);
  if (files.has('save.json')) throw new Error('This is saved progress. Use Fleet → Load universe…');
  const inspected = inspectDataFiles(files, options);
  if (inspected.kind !== kind) throw new Error(`Expected ${kind} data; this file contains ${inspected.kind}`);
  return inspected.value;
}
