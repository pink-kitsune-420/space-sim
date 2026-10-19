import { cp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildPortableModule, forkModule, packageContracts } from '../../packages/module-tools/package.mjs';

/** Real editable archives, then a real installed game; no browser-only vehicle harness. */
export async function trainerGameArchives(directory: string) {
  const kit = await packageContracts();
  const built = [];
  for (const name of ['vehicle-trainer', 'appearance-trainer']) {
    const source = join(directory, name), output = join(directory, `${name}.spacemod`);
    await cp(resolve('modules', name), source, { recursive: true });
    const checked = await buildPortableModule(join(source, 'module.json'), output, { typecheck: false });
    built.push({ bytes: new Uint8Array(await readFile(output)), ref: { id: checked.descriptor.manifest.id, version: checked.descriptor.manifest.version, digest: checked.integrity.digest } });
  }
  const fork = join(directory, 'creator-artwork');
  await forkModule(join(directory, 'appearance-trainer.spacemod'), 'creator.trainer-artwork', fork);
  const entry = join(fork, 'src/index.ts'), source = await readFile(entry, 'utf8');
  await writeFile(entry, source.replace("hull: [{ x: 11, y: 0 }, { x: -7, y: -6 }, { x: -4, y: 0 }, { x: -7, y: 6 }]",
    "hull: [{ x: 12, y: 5 }, { x: -8, y: 5 }, { x: -8, y: -5 }, { x: 12, y: -5 }]"));
  const forkOutput = join(directory, 'creator-artwork.spacemod'), checked = await buildPortableModule(join(fork, 'module.json'), forkOutput, { typecheck: false });
  built.push({ bytes: new Uint8Array(await readFile(forkOutput)), ref: { id: checked.descriptor.manifest.id, version: checked.descriptor.manifest.version, digest: checked.integrity.digest } });
  const base = JSON.parse(await readFile('games/flight-starter/game.json', 'utf8'));
  const outputs: { name: string; bytes: Buffer; artwork: boolean; fork: boolean }[] = [];
  for (const [name, members] of [['Portable trainer', [built[0]!, built[1]!]], ['Trainer without artwork', [built[0]!]], ['Creator trainer artwork', [built[0]!, built[2]!]]] as const) {
    const profile = { format: 'space-sim-profile/2', id: 'creator.trainer-game', modules: members.map(({ ref: { id, version } }) => ({ id, version })), providers: {}, capabilities: {}, settings: {} };
    const plan = { profile, packages: members.map(member => member.ref), requiredSlots: [] };
    const node = { ...plan, profile: { ...profile, modules: [profile.modules[0]!] }, packages: [members[0]!.ref] };
    const runtime = kit.attachRuntimeFiles(kit.validateRuntimeSelection({ format: 'spacelab-runtime-selection/2', plans: { browser: plan, offline: plan, node } }),
      new Map(members.map(member => [`modules/${member.ref.id}.spacemod`, member.bytes])));
    const game = { ...base, info: { id: `creator.${name.toLowerCase().replaceAll(' ', '-')}`, name, description: 'Editable trainer and optional artwork over the shared rails adapter.' }, runtime };
    const bytes = Buffer.from(await kit.encodePackage(game));
    await writeFile(join(directory, `${game.info.id}.spacegame`), bytes);
    outputs.push({ name, bytes, artwork: members.length > 1, fork: name === 'Creator trainer artwork' });
  }
  return outputs;
}
