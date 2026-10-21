import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const digest = (data: Uint8Array) => 'sha256:' + createHash('sha256').update(data).digest('hex');
const context = { repo: { owner: 'example', repo: 'space-sim' }, ref: 'refs/tags/v1.2.3', sha: 'a'.repeat(40) };

async function fixture(state: 'absent' | 'draft' | 'published' = 'draft') {
  const directory = await mkdtemp(join(tmpdir(), 'space-sim-release-')); directories.push(directory);
  const files = new Map([['LICENSE', Buffer.from('first-party license')], ['game.zip', Buffer.from('verified distribution')]]);
  for (const [name, data] of files) await writeFile(join(directory, name), data);
  const releases: any[] = state === 'absent' ? [] : [{ id: 17, tag_name: 'v1.2.3', draft: state === 'draft',
    name: 'Authored draft name', body: 'Keep these authored release notes', prerelease: true,
    upload_url: 'https://uploads.github.com/repos/example/space-sim/releases/17/assets{?name,label}' }];
  const assets = new Map<number, any[]>(); let nextId = 100;
  const asset = (name: string, data = files.get(name)!) => ({ id: nextId++, name, state: 'uploaded', size: data.length, digest: digest(data), bytes: data });
  if (state === 'published') assets.set(17, [...files].map(([name, data]) => asset(name, data)));
  const repos = {
    listReleases: vi.fn(async ({ page, per_page }: any) => ({ data: releases.slice((page - 1) * per_page, page * per_page) })),
    createRelease: vi.fn(async (request: any) => {
      const release = { ...request, id: 18, upload_url: 'https://uploads.github.com/repos/example/space-sim/releases/18/assets{?name,label}' };
      releases.push(release); return { data: release };
    }),
    listReleaseAssets: vi.fn(async ({ release_id, page, per_page }: any) => ({ data: (assets.get(release_id) ?? []).slice((page - 1) * per_page, page * per_page) })),
    getRelease: vi.fn(async ({ release_id }: any) => ({ data: releases.find(release => release.id === release_id) })),
    updateRelease: vi.fn(async ({ release_id, ...changes }: any) => {
      const release = releases.find(release => release.id === release_id); Object.assign(release, changes); return { data: release };
    }),
    deleteReleaseAsset: vi.fn(async ({ asset_id }: any) => {
      for (const [id, values] of assets) assets.set(id, values.filter(value => value.id !== asset_id)); return { status: 204 };
    }),
    getReleaseAsset: vi.fn(async ({ asset_id }: any) => ({ data: [...assets.values()].flat().find(value => value.id === asset_id).bytes })),
  };
  const request = vi.fn(async (route: string, options: any) => {
    const url = new URL(route.replace(/^POST /, '')); const releaseId = Number(url.pathname.split('/').at(-2));
    const name = url.searchParams.get('name')!;
    expect(options.data).toEqual(files.get(name));
    const uploaded = asset(name, options.data); assets.set(releaseId, [...assets.get(releaseId) ?? [], uploaded]);
    return { data: uploaded };
  });
  const core = { info: vi.fn(), setOutput: vi.fn() };
  const run = (overrides: Record<string, unknown> = {}) => require('../../.github/scripts/finalize-release.cjs')({ github: { rest: { repos }, request }, context,
    core, directory, tag: 'v1.2.3', name: '1.2.3', ...overrides });
  return { directory, files, releases, assets, asset, repos, request, core, run };
}

it('uses explicit reconciliation after the existing distribution and transferred-download verification gates', async () => {
  const workflow = await readFile('.github/workflows/package.yml', 'utf8');
  const release = workflow.slice(workflow.lastIndexOf('\n  release:\n'));
  expect(release).toContain('needs: distribution');
  expect(release).toContain("if: startsWith(github.ref, 'refs/tags/v')");
  const verify = release.indexOf('verify_release_distribution.py');
  const finalize = release.indexOf("require('./.github/scripts/finalize-release.cjs')");
  expect(verify).toBeGreaterThan(0); expect(finalize).toBeGreaterThan(verify);
  expect(release).not.toContain('softprops/action-gh-release');
});

it('creates an absent release as a draft, uploads verified bytes, and publishes that same ID once', async () => {
  const f = await fixture('absent'); await f.run(); await f.run();
  expect(f.repos.createRelease).toHaveBeenCalledTimes(1);
  expect(f.repos.createRelease.mock.calls[0]![0]).toMatchObject({ draft: true, target_commitish: context.sha, tag_name: 'v1.2.3' });
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.repos.updateRelease).toHaveBeenCalledTimes(1);
  expect(f.releases).toHaveLength(1); expect(f.releases[0]).toMatchObject({ id: 18, draft: false });
});

it('reuses a pre-created draft and matching uploads without creating a duplicate or replacing its notes', async () => {
  const f = await fixture(); f.assets.set(17, [f.asset('LICENSE')]);
  await f.run(); await f.run();
  expect(f.repos.createRelease).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.repos.deleteReleaseAsset).not.toHaveBeenCalled(); expect(f.repos.updateRelease).toHaveBeenCalledTimes(1);
  expect(f.releases[0]).toMatchObject({ id: 17, draft: false, name: 'Authored draft name', body: 'Keep these authored release notes' });
});

it('leaves an existing matching publication read-only', async () => {
  const f = await fixture('published'); await f.run();
  expect(f.repos.createRelease).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  expect(f.repos.updateRelease).not.toHaveBeenCalled(); expect(f.repos.deleteReleaseAsset).not.toHaveBeenCalled();
});

it('does not publish after a partial upload failure and resumes the same draft on retry', async () => {
  const f = await fixture(); const upload = f.request.getMockImplementation()!;
  f.request.mockImplementationOnce(upload).mockRejectedValueOnce(Object.assign(new Error('upload interrupted'), { status: 502 }));
  await expect(f.run()).rejects.toThrow('upload interrupted');
  expect(f.releases[0].draft).toBe(true); expect(f.repos.updateRelease).not.toHaveBeenCalled();
  await f.run(); expect(f.repos.createRelease).not.toHaveBeenCalled(); expect(f.repos.updateRelease).toHaveBeenCalledTimes(1);
  expect(f.assets.get(17)).toHaveLength(2);
});

it('finds an existing draft beyond the first page', async () => {
  const f = await fixture(); f.releases.unshift(...Array.from({ length: 100 }, (_, i) => ({ id: i + 1000, tag_name: `other-${i}` })));
  await f.run(); expect(f.repos.listReleases.mock.calls.some(([request]) => request.page === 2)).toBe(true);
  expect(f.repos.createRelease).not.toHaveBeenCalled(); expect(f.releases.find(release => release.id === 17).draft).toBe(false);
});

it('rejects duplicate releases and unverified extra assets without mutation', async () => {
  const f = await fixture(); f.releases.push({ ...f.releases[0], id: 99 });
  await expect(f.run()).rejects.toThrow(/multiple|ambiguous/i);
  expect(f.request).not.toHaveBeenCalled(); expect(f.repos.updateRelease).not.toHaveBeenCalled();
  f.releases.pop(); f.assets.set(17, [f.asset('unverified.txt', Buffer.from('not verified'))]);
  await expect(f.run()).rejects.toThrow(/unexpected|unverified/i);
  expect(f.repos.deleteReleaseAsset).not.toHaveBeenCalled(); expect(f.repos.updateRelease).not.toHaveBeenCalled();
});

it('rejects mismatching published bytes without replacing any public asset', async () => {
  const f = await fixture('published'); f.assets.get(17)![0].digest = 'sha256:' + '0'.repeat(64);
  await expect(f.run()).rejects.toThrow(/match|differ/i);
  expect(f.request).not.toHaveBeenCalled(); expect(f.repos.deleteReleaseAsset).not.toHaveBeenCalled(); expect(f.repos.updateRelease).not.toHaveBeenCalled();
});

it('verifies old uploaded assets by binary content when a remote digest is unavailable', async () => {
  const f = await fixture('published'); for (const asset of f.assets.get(17)!) delete asset.digest;
  await f.run(); expect(f.repos.getReleaseAsset).toHaveBeenCalledTimes(2);
  expect(f.repos.updateRelease).not.toHaveBeenCalled();
});

it('cleans only a proven empty starter asset on the same draft before retrying its upload', async () => {
  const f = await fixture(); f.assets.set(17, [{ ...f.asset('game.zip'), state: 'starter', size: 0 }]);
  await f.run(); expect(f.repos.deleteReleaseAsset).toHaveBeenCalledTimes(1);
  expect(f.releases[0].draft).toBe(false); expect(f.repos.createRelease).not.toHaveBeenCalled();
});

it('reuses a draft created concurrently when creation reports a tag conflict', async () => {
  const f = await fixture('absent');
  f.repos.createRelease.mockImplementationOnce(async request => {
    f.releases.push({ ...request, id: 17, upload_url: 'https://uploads.github.com/repos/example/space-sim/releases/17/assets{?name,label}' });
    throw Object.assign(new Error('tag already exists'), { status: 422 });
  });
  await expect(f.run()).resolves.toMatchObject({ releaseId: 17, alreadyPublished: false });
  expect(f.repos.createRelease).toHaveBeenCalledTimes(1); expect(f.releases).toHaveLength(1);
});

it('checks assets beyond the first page before publishing and never deletes unverified extras', async () => {
  const f = await fixture(); const existing = [];
  for (let i = 0; i < 100; i++) {
    const name = `prior-${i}.zip`, data = Buffer.from(String(i));
    f.files.set(name, data); await writeFile(join(f.directory, name), data); existing.push(f.asset(name, data));
  }
  f.assets.set(17, [...existing, f.asset('unverified.txt', Buffer.from('extra attachment'))]);
  await expect(f.run()).rejects.toThrow('Unexpected unverified');
  expect(f.repos.listReleaseAssets.mock.calls.some(([request]) => request.page === 2)).toBe(true);
  expect(f.request).not.toHaveBeenCalled(); expect(f.repos.updateRelease).not.toHaveBeenCalled(); expect(f.repos.deleteReleaseAsset).not.toHaveBeenCalled();
});

it('rejects incomplete publications, non-tag invocations and symlinked files before any mutation', async () => {
  const f = await fixture('published'); f.assets.get(17)!.pop();
  await expect(f.run()).rejects.toThrow('Published release is missing');
  await expect(f.run({ context: { ...context, ref: 'refs/heads/main' } })).rejects.toThrow('exact tagged');
  await symlink(join(f.directory, 'LICENSE'), join(f.directory, 'linked.txt'));
  await expect(f.run()).rejects.toThrow('Invalid release file');
  expect(f.repos.createRelease).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled(); expect(f.repos.updateRelease).not.toHaveBeenCalled();
});

it('does not upload or publish local bytes that change after inventory verification', async () => {
  const f = await fixture();
  f.repos.listReleases.mockImplementationOnce(async () => {
    await writeFile(join(f.directory, 'LICENSE'), 'changed bytes'); return { data: f.releases };
  });
  await expect(f.run()).rejects.toThrow('Verified local release file changed');
  expect(f.request).not.toHaveBeenCalled(); expect(f.repos.updateRelease).not.toHaveBeenCalled(); expect(f.releases[0].draft).toBe(true);
});

it('hashes old asset response streams as exact bytes without MIME-based text decoding', async () => {
  const f = await fixture('published'); for (const asset of f.assets.get(17)!) delete asset.digest;
  f.repos.getReleaseAsset.mockImplementation(async ({ asset_id, request }: any) => {
    expect(request.parseSuccessResponseBody).toBe(false);
    const bytes = f.assets.get(17)!.find(asset => asset.id === asset_id).bytes;
    return { data: new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 3)); controller.enqueue(bytes.subarray(3)); controller.close();
    } }) };
  });
  await f.run(); expect(f.repos.updateRelease).not.toHaveBeenCalled();
});
