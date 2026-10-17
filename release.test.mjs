import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const revision = 'a'.repeat(40);
test('approval candidate rejects malformed SHA, injected output and foreign repository', () => {
  const directory = mkdtempSync(join(tmpdir(), 'candidate-test-'));
  try {
    const output = join(directory, 'output');
    const summary = join(directory, 'summary');
    const valid = {
      repository: 'aladinez/impresa-facture',
      revision,
      stagingRun:
        'https://github.com/aladinez/impresa-facture/actions/runs/123',
    };
    for (const candidate of [
      valid,
      { ...valid, revision: revision + '\nrevision=other' },
      { ...valid, repository: 'untrusted/app' },
      { ...valid, stagingRun: 'https://example.com' },
    ]) {
      writeFileSync(
        join(directory, 'candidate.json'),
        JSON.stringify(candidate),
      );
      writeFileSync(output, '');
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./prepare-candidate.mjs', import.meta.url))],
        {
          cwd: directory,
          env: {
            ...process.env,
            GITHUB_OUTPUT: output,
            GITHUB_STEP_SUMMARY: summary,
          },
          encoding: 'utf8',
        },
      );
      assert.equal(result.status === 0, candidate === valid, result.stderr);
      assert.equal(
        readFileSync(output, 'utf8'),
        candidate === valid ? `revision=${revision}\n` : '',
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
for (const [actual, status, succeeds, target = 'staging'] of [
  [revision, 'SUCCESS', true],
  [revision, 'SUCCESS', true, 'production'],
  ['b'.repeat(40), 'SUCCESS', false],
  [revision, 'BUILDING', false],
]) {
  test(`recheck ${target} ${actual.slice(0, 7)} ${status}: ${succeeds ? 'accept' : 'block'}`, () => {
    const mock = `globalThis.fetch = async (url, options) => {
      if (url.includes('graphql')) {
        if (JSON.parse(options.body).query.includes('mutation')) throw Error('Verification must never mutate Railway');
        return { status: 200, json: async () => ({ data: { environment: { name: '${target}', serviceInstances: { edges: ['88bcf134-979d-415b-9dc9-52690d90cf73','e098d368-8a9f-4091-bcf5-05d9f76415a7'].map(serviceId => ({ node: { serviceId, latestDeployment: {id: serviceId, status: '${status}', meta: { commitHash: '${actual}' }} }})) } } } }) };
      }
      return { status:200, headers: new Headers({'cache-control':'no-store', 'access-control-allow-origin':'${target === 'production' ? 'https://facture.impresa.ma' : 'https://appweb-staging.up.railway.app'}', 'x-robots-tag':'noindex'}), json: async () => ({ environment:'${target}',apiBaseUrl:'${target === 'production' ? 'https://appapi-production-91fb.up.railway.app' : 'https://appapi-staging-0776.up.railway.app'}' }) };
    };`;
    const result = spawnSync(
      process.execPath,
      [
        `--import=data:text/javascript,${encodeURIComponent(mock)}`,
        fileURLToPath(new URL('./railway-release.mjs', import.meta.url)),
        'verify',
        target,
        revision,
      ],
      {
        env: {
          ...process.env,
          CI: 'true',
          RAILWAY_TOKEN: 'test-only',
          GITHUB_STEP_SUMMARY: '',
        },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status === 0, succeeds, result.stderr);
  });
}
