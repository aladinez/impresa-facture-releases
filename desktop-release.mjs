import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const repository = 'aladinez/impresa-facture';
const releases = 'aladinez/impresa-facture-releases';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const gh = (args) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
export async function startDesktop(
  revision,
  promotion,
  { command = gh, retry = Number(process.env.GITHUB_RUN_ATTEMPT) > 1 } = {},
) {
  assert.match(revision ?? '', /^[a-f0-9]{40}$/);
  assert.match(promotion ?? '', /^\d+$/);
  const title = `Desktop production ${revision} / approval ${promotion}`;
  if (retry) {
    const previous = JSON.parse(
      command([
        'api',
        `repos/${repository}/actions/workflows/desktop.yml/runs?branch=${encodeURIComponent(`deploy/${revision}`)}&event=workflow_dispatch&per_page=100`,
      ]),
    ).workflow_runs?.find(
      (run) => run.display_title === title && run.head_sha === revision,
    );
    if (previous) {
      if (previous.conclusion && previous.conclusion !== 'success') {
        assert.equal(
          previous.conclusion,
          'failure',
          'Review the cancelled desktop run before retrying',
        );
        command([
          'run',
          'rerun',
          String(previous.id),
          '--repo',
          repository,
          '--failed',
        ]);
      }
      return String(previous.id);
    }
  }
  // The versioned REST endpoint returns the run ID. Avoid CLI workflow-name resolution,
  // asynchronous run discovery, and changing production web before a dispatch succeeds.
  const dispatched = JSON.parse(
    command([
      'api',
      '--method',
      'POST',
      `repos/${repository}/actions/workflows/desktop.yml/dispatches`,
      '-H',
      'X-GitHub-Api-Version: 2026-03-10',
      '-f',
      `ref=deploy/${revision}`,
      '-f',
      'inputs[channel]=production',
      '-f',
      `inputs[revision]=${revision}`,
      '-F',
      'inputs[publish]=true',
      '-f',
      `inputs[promotion_run]=${promotion}`,
    ]),
  );
  assert.match(
    String(dispatched.workflow_run_id ?? ''),
    /^\d+$/,
    'GitHub did not return the dispatched desktop run ID',
  );
  return String(dispatched.workflow_run_id);
}
export async function waitDesktop(
  runId,
  revision,
  { command = gh, fetchFeed = fetch, sleep = pause, attempts = 260 } = {},
) {
  assert.match(runId ?? '', /^\d+$/);
  assert.match(revision ?? '', /^[a-f0-9]{40}$/);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const run = JSON.parse(
      command([
        'run',
        'view',
        runId,
        '--repo',
        repository,
        '--json',
        'status,conclusion,headSha',
      ]),
    );
    assert.equal(
      run.headSha,
      revision,
      'Desktop run belongs to a different commit',
    );
    if (run.status === 'completed') {
      assert.equal(
        run.conclusion,
        'success',
        `Desktop publication failed: https://github.com/${repository}/actions/runs/${runId}`,
      );
      const response = await fetchFeed(
        `https://github.com/${releases}/releases/download/production/latest.json`,
        { cache: 'no-store', signal: globalThis.AbortSignal.timeout(15000) },
      );
      assert.equal(response.status, 200);
      const feed = await response.json();
      // Mutable GitHub download redirects may briefly serve the previous manifest.
      if (
        feed.source_revision === revision &&
        feed.build_run_id === runId &&
        feed.channel === 'production'
      )
        return feed;
    }
    await sleep(15000);
  }
  throw new Error(
    `Timed out waiting for production desktop/feed: https://github.com/${repository}/actions/runs/${runId}`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [mode, revision, id] = process.argv.slice(2);
  if (mode === 'start') {
    const run = await startDesktop(revision, id);
    appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n[Production desktop build](https://github.com/${repository}/actions/runs/${run})\n`,
    );
  } else {
    assert.equal(mode, 'wait');
    const feed = await waitDesktop(id, revision);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n## Production web and desktop are ready\n\nDesktop version: **${feed.version}**\n\n[Download installers](https://github.com/${releases}/releases/tag/desktop-production-v${feed.version})\n`,
    );
  }
}
