import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPortableModule, packageContracts } from '../packages/module-tools/package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
/** Real editable packages with exact embedded digests; no network dependency. */
export async function buildOrbitalAcademy(output = resolve(root, 'dist/orbital-academy.spacegame')) {
  const kit = await packageContracts(), files = new Map(), references = [];
  for (const name of ['tutorial-runner', 'orbital-lessons', 'academy-ui']) {
    const built = await buildPortableModule(resolve(root, 'modules', name, 'module.json'), undefined, { typecheck: true });
    const bytes = await kit.encodeModuleFiles(built.files);
    const ref = { id: built.descriptor.manifest.id, version: built.descriptor.manifest.version, digest: built.integrity.digest };
    references.push(ref); files.set(`modules/${ref.id}.spacemod`, bytes);
  }
  const base = JSON.parse(await readFile(resolve(root, 'games/orbit-academy/game.json'), 'utf8'));
  const profile = { format: 'space-sim-profile/2', id: 'spacelab.orbital-academy', modules: references.map(({ id, version }) => ({ id, version })),
    providers: { 'learning.runner': 'spacelab.tutorial-runner', 'learning.orbital-course': 'spacelab.orbital-lessons', 'learning.academy': 'spacelab.academy-ui' }, capabilities: {}, settings: {} };
  const plan = { profile, packages: references, requiredSlots: ['learning.academy'] };
  const runtime = kit.attachRuntimeFiles(kit.validateRuntimeSelection({ format: 'spacelab-runtime-selection/2', plans: { browser: plan, offline: plan } }), files);
  const game = { ...base, runtime }, bytes = await kit.writeZip(await kit.createGameFiles(game));
  await kit.decodeGamePackage(bytes, kit.validatePackage);
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, bytes);
  return { output, bytes: bytes.length, lessons: 24, modules: references };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await buildOrbitalAcademy(process.argv[2] ? resolve(process.argv[2]) : undefined), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
