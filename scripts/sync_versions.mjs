import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url), check = process.argv.includes('--check');
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Expected a semantic package.json version');
const edits = [];
function update(file, transform) {
  const path = new URL(file, root), before = readFileSync(path, 'utf8'), after = transform(before);
  if (before !== after) edits.push({ file, path, after });
}
update('src-tauri/tauri.conf.json', text => {
  const config = JSON.parse(text); if (config.version === version) return text;
  config.version = version; return JSON.stringify(config, null, 2) + '\n';
});
update('src-tauri/Cargo.toml', text => {
  if (!/^version = "[^"]+"/m.test(text)) throw new Error('Missing Tauri package version');
  return text.replace(/^version = "[^"]+"/m, `version = "${version}"`);
});
update('android/app/build.gradle', text => {
  const name = /versionName "([^"]+)"/.exec(text), code = /versionCode (\d+)/.exec(text);
  if (!name || !code) throw new Error('Missing Android version fields');
  const previous = name[1].replace(/^(\d+\.\d+\.\d+)a$/, '$1-alpha');
  const next = Number(code[1]) + (previous === version ? 0 : 1);
  return text.replace(/versionName "[^"]+"/, `versionName "${version}"`).replace(/versionCode \d+/, `versionCode ${next}`);
});
if (check && edits.length) {
  console.error(`Version fields differ from package.json: ${edits.map(edit => edit.file).join(', ')}. Run node scripts/sync_versions.mjs.`);
  process.exitCode = 1;
} else if (!check) {
  for (const edit of edits) writeFileSync(edit.path, edit.after);
}
