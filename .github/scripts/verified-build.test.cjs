const { test } = require('node:test');
const assert = require('node:assert/strict');
const verifiedBuild = require('./verified-build.cjs');

const sha = 'a'.repeat(40);
const run = (changes = {}) => ({ id: 42, head_sha: sha, head_repository: { full_name: 'owner/game' },
  head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', html_url: 'https://example.test/run/42', ...changes });
const artifact = (changes = {}) => ({ name: 'browser-build', expired: false, workflow_run: { head_sha: sha }, ...changes });
function fixture(runs = [run()], artifacts = [artifact()]) {
  const outputs = {}, calls = [], waits = [];
  let poll = 0;
  return {
    outputs, calls, waits,
    options: { context: { repo: { owner: 'owner', repo: 'game' }, sha },
      core: { setOutput: (key, value) => { outputs[key] = value; }, info() {} },
      sleep: async ms => { waits.push(ms); }, attempts: 4,
      github: { rest: { actions: {
        listWorkflowRuns: async options => {
          assert.equal(options.head_sha, sha); assert.equal(options.workflow_id, 'checks.yml');
          return { data: { workflow_runs: typeof runs === 'function' ? runs(poll++) : runs } };
        },
        listWorkflowRunArtifacts: async options => { calls.push(options.run_id); return { data: { artifacts } }; },
      } } },
    },
  };
}

test('reuses the exact successful run and exposes its commit and run ID', async () => {
  const f = fixture();
  assert.deepEqual(await verifiedBuild(f.options), { runId: 42, sha });
  assert.deepEqual(f.outputs, { 'run-id': 42, sha }); assert.deepEqual(f.waits, []);
});
for (const [name, changes] of [
  ['a different commit', { head_sha: 'b'.repeat(40) }],
  ['a pull request', { event: 'pull_request' }],
  ['a fork', { head_repository: { full_name: 'someone/game' } }],
  ['missing provenance', { head_repository: null }],
  ['a failed run', { conclusion: 'failure' }],
  ['a cancelled run', { conclusion: 'cancelled' }],
]) test(`rejects ${name}`, async () => {
  const f = fixture([run(changes)]);
  await assert.rejects(verifiedBuild(f.options), /No successful/);
  assert.deepEqual(f.outputs, {}); assert.deepEqual(f.calls, []);
});
for (const [name, artifacts] of [
  ['an expired artifact', [artifact({ expired: true })]],
  ['a missing artifact', []],
  ['an artifact from another commit', [artifact({ workflow_run: { head_sha: 'b'.repeat(40) } })]],
]) test(`rejects ${name}`, async () => {
  const f = fixture(undefined, artifacts);
  await assert.rejects(verifiedBuild(f.options), /unexpired browser-build/);
  assert.deepEqual(f.outputs, {});
});
test('waits for a running check instead of starting another suite', async () => {
  const f = fixture(poll => [run(poll ? {} : { status: 'in_progress', conclusion: null })]);
  await verifiedBuild(f.options); assert.deepEqual(f.waits, [30_000]); assert.deepEqual(f.calls, [42]);
});
test('discovers checks when the tag arrives just after a branch push', async () => {
  const f = fixture(poll => poll ? [run()] : []);
  await verifiedBuild(f.options); assert.deepEqual(f.waits, [30_000]);
});
test('bounds waiting for checks that never finish', async () => {
  const f = fixture([run({ status: 'queued', conclusion: null })]);
  await assert.rejects(verifiedBuild(f.options), /No successful/); assert.equal(f.waits.length, 3);
});
test('Pages can require a successful main-branch run', async () => {
  const f = fixture([run({ head_branch: 'feature' })]);
  await assert.rejects(verifiedBuild({ ...f.options, branch: 'main', attempts: 1 }), /No successful/);
});
test('supports manually refreshed checks and skips a newer expired build', async () => {
  const f = fixture([run({ id: 43 }), run({ event: 'workflow_dispatch' })]);
  f.options.github.rest.actions.listWorkflowRunArtifacts = async ({ run_id }) => ({ data: {
    artifacts: run_id === 43 ? [artifact({ expired: true })] : [artifact()],
  } });
  assert.equal((await verifiedBuild(f.options)).runId, 42);
});
