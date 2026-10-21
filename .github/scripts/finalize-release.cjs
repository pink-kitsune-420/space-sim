const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { lstat, readdir, readFile } = require('node:fs/promises');
const { join } = require('node:path');

const MAX_PAGES = 100;
const MAX_ASSETS = 1000;
const options = (milliseconds = 30_000) => ({ request: { signal: AbortSignal.timeout(milliseconds) } });
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

async function inventory(directory) {
  const names = (await readdir(directory)).sort();
  if (!names.length || names.length > MAX_ASSETS) throw new Error('Expected 1–1000 verified release files');
  const files = [];
  for (const name of names) {
    if (!/^[a-z0-9][a-z0-9._-]{0,254}$/i.test(name)) throw new Error(`Unsupported release filename: ${name}`);
    const path = join(directory, name), stat = await lstat(path);
    if (!stat.isFile() || !stat.size || stat.size >= 2 ** 31) throw new Error(`Invalid release file: ${name}`);
    const digest = createHash('sha256');
    for await (const bytes of createReadStream(path)) digest.update(bytes);
    files.push({ name, path, size: stat.size, digest: 'sha256:' + digest.digest('hex') });
  }
  return files;
}

/** Read every page before treating a release or asset as absent. Fail closed at the bound. */
async function pages(method, params, visit) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await method({ ...params, per_page: 100, page, ...options() });
    if (!Array.isArray(data)) throw new Error('Unexpected GitHub inventory response');
    visit(data);
    if (data.length < 100) return;
  }
  throw new Error('GitHub inventory exceeds the release reconciliation page limit');
}

/**
 * Reconcile an already verified tagged distribution using an explicitly injected GitHub client.
 * Called only by the tag-only workflow after exact-commit build and transferred-file checks.
 * Creates drafts, never duplicate public releases; existing publications are read-only.
 * A failed upload leaves the same draft available for a subsequent workflow retry.
 */
module.exports = async function finalizeRelease({ github, context, core, directory = 'release-files',
  tag = process.env.RELEASE_TAG, name = process.env.RELEASE_NAME }) {
  if (!tag || context.ref !== `refs/tags/${tag}` || !tag.startsWith('v') || !context.sha) {
    throw new Error('Release finalization requires the exact tagged workflow context');
  }
  const files = await inventory(directory), byName = new Map(files.map(file => [file.name, file]));
  const scope = context.repo, repos = github.rest.repos;
  const findRelease = async () => {
    const matches = [];
    await pages(params => repos.listReleases(params), scope, data => {
      matches.push(...data.filter(release => release.tag_name === tag));
      if (matches.length > 1) throw new Error(`Multiple releases for ${tag}; reconcile the ambiguous draft/publication manually`);
    });
    return matches[0];
  };
  const assetsFor = async release => {
    const assets = [];
    await pages(params => repos.listReleaseAssets(params), { ...scope, release_id: release.id }, data => {
      assets.push(...data);
      if (assets.length > MAX_ASSETS) throw new Error('Release asset inventory exceeds 1000 files');
    });
    return assets;
  };
  const verifyAssets = async (release, assets) => {
    const found = new Set(), starters = [];
    for (const asset of assets) {
      const file = byName.get(asset.name);
      if (!file) throw new Error(`Unexpected unverified release asset: ${asset.name}`);
      if (found.has(asset.name)) throw new Error(`Ambiguous duplicate release asset: ${asset.name}`);
      found.add(asset.name);
      if (release.draft && asset.state === 'starter' && asset.size === 0) { starters.push(asset); continue; }
      if (asset.state !== 'uploaded' || asset.size !== file.size) throw new Error(`Release asset differs from verified file: ${file.name}`);
      let digest = asset.digest;
      if (!digest) {
        // Disable MIME-based text decoding, including for old LICENSE/Markdown assets.
        const request = options(300_000); request.request.parseSuccessResponseBody = false;
        const { data } = await repos.getReleaseAsset({ ...scope, asset_id: asset.id,
          headers: { accept: 'application/octet-stream' }, ...request });
        const chunks = data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? [data] : data;
        if (!chunks || !Array.isArray(chunks) && typeof chunks[Symbol.asyncIterator] !== 'function') {
          throw new Error(`Could not verify binary asset: ${file.name}`);
        }
        const remoteHash = createHash('sha256'); let size = 0;
        for await (const chunk of chunks) {
          if (!(chunk instanceof ArrayBuffer) && !ArrayBuffer.isView(chunk)) throw new Error(`Non-binary release asset: ${file.name}`);
          const bytes = ArrayBuffer.isView(chunk) ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength) : Buffer.from(chunk);
          size += bytes.length;
          if (size > file.size) throw new Error(`Release asset differs from verified size: ${file.name}`);
          remoteHash.update(bytes);
        }
        if (size !== file.size) throw new Error(`Release asset differs from verified size: ${file.name}`);
        digest = 'sha256:' + remoteHash.digest('hex');
      }
      if (digest !== file.digest) throw new Error(`Release asset does not match verified bytes: ${file.name}`);
    }
    return { missing: files.filter(file => !found.has(file.name)), starters };
  };
  const freshDraft = async release => {
    const { data } = await repos.getRelease({ ...scope, release_id: release.id, ...options() });
    if (!data || data.tag_name !== tag || !data.draft || data.immutable) throw new Error('Release changed during upload; rerun reconciliation');
  };

  let release = await findRelease();
  if (!release) {
    try {
      ({ data: release } = await repos.createRelease({ ...scope, tag_name: tag, target_commitish: context.sha,
        name: name || tag, draft: true, prerelease: true, ...options() }));
    } catch (error) {
      if (error.status !== 422) throw error;
      // Another authorized run may have created the draft. Never create a second one.
      release = await findRelease();
      if (!release) throw error;
    }
  }
  const releaseId = release.id;
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0 || release.tag_name !== tag) throw new Error('Unexpected release identity');
  const pending = await verifyAssets(release, await assetsFor(release));
  if (!release.draft) {
    if (pending.missing.length || pending.starters.length) throw new Error('Published release is missing verified assets; it was not modified');
    core.info(`Release ${releaseId} is already published with matching verified assets`);
    core.setOutput('release-id', releaseId);
    return { releaseId, alreadyPublished: true };
  }
  for (const asset of pending.starters) {
    await freshDraft(release);
    await repos.deleteReleaseAsset({ ...scope, asset_id: asset.id, ...options() });
    pending.missing.push(byName.get(asset.name));
  }
  for (const file of pending.missing) {
    await freshDraft(release);
    // Keep at most one upload buffer; check that verified local bytes have not changed.
    const data = await readFile(file.path);
    if (data.length !== file.size || hash(data) !== file.digest) throw new Error(`Verified local release file changed: ${file.name}`);
    const upload = new URL(release.upload_url.replace(/\{\?[^}]+\}$/, ''));
    upload.searchParams.set('name', file.name);
    await github.request(`POST ${upload.href}`, { data, headers: { 'content-type': 'application/octet-stream',
      'content-length': file.size }, ...options(300_000) });
  }
  release = await findRelease();
  if (!release || release.id !== releaseId) throw new Error('Release identity changed before finalization');
  const complete = await verifyAssets(release, await assetsFor(release));
  if (complete.missing.length || complete.starters.length) throw new Error('Release uploads are incomplete; draft was not published');
  const alreadyPublished = !release.draft;
  if (release.draft) {
    await freshDraft(release);
    await repos.updateRelease({ ...scope, release_id: releaseId, draft: false, prerelease: true, ...options() });
    core.info(`Published verified assets on release ${releaseId}`);
  }
  core.setOutput('release-id', releaseId);
  return { releaseId, alreadyPublished };
};
