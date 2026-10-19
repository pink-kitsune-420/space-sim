/** Find a tested, unexpired build of this exact commit from this repository's CI.
 * A release may arrive while the branch checks are running; wait for that run,
 * never start a second test suite or accept a pull request's build. */
module.exports = async function verifiedBuild({ github, context, core, sha = context.sha, branch,
  attempts = 60, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const { owner, repo } = context.repo;
  const repository = `${owner}/${repo}`.toLowerCase();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { data } = await github.rest.actions.listWorkflowRuns({ owner, repo,
      workflow_id: 'checks.yml', head_sha: sha, per_page: 100 });
    const trusted = data.workflow_runs.filter(run => run.head_sha === sha
      && run.head_repository?.full_name?.toLowerCase() === repository
      && ['push', 'workflow_dispatch'].includes(run.event)
      && (branch === undefined || run.head_branch === branch));
    for (const run of trusted.filter(run => run.status === 'completed' && run.conclusion === 'success')
      .sort((a, b) => b.id - a.id)) {
      const { data: inventory } = await github.rest.actions.listWorkflowRunArtifacts({ owner, repo,
        run_id: run.id, per_page: 100 });
      const artifact = inventory.artifacts.find(artifact => artifact.name === 'browser-build' && !artifact.expired
        && (!artifact.workflow_run || artifact.workflow_run.head_sha === sha));
      if (!artifact) continue;
      core.setOutput('run-id', run.id);
      core.setOutput('sha', sha);
      core.info(`Reusing tested build from ${run.html_url}`);
      return { runId: run.id, sha };
    }
    const pending = trusted.some(run => run.status !== 'completed');
    // Allow a short discovery window when a branch push and tag arrive together.
    if (attempt === attempts - 1 || (!pending && (trusted.length > 0 || attempt >= 2))) {
      throw new Error(`No successful Build and flight checks run with an unexpired browser-build artifact for ${sha}. `
        + 'Run or rerun checks.yml on this commit before packaging or deploying.');
    }
    core.info(`Waiting for Build and flight checks on ${sha}…`);
    await sleep(30_000);
  }
};
