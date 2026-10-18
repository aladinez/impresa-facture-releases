import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  desktopPlatforms,
  installerName,
  updaterName,
  manifestName,
  assetUrl,
  validatePublishedAssets,
} from './desktop-assets.mjs';

const repository = 'aladinez/impresa-facture-releases';
export function validateCandidate(candidate) {
  assert.equal(candidate.repository, 'aladinez/impresa-facture');
  assert.match(candidate.revision ?? '', /^[a-f0-9]{40}$/);
  assert.match(
    candidate.desktopVersion ?? '',
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
  );
  assert.match(candidate.desktopArchiveSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.match(
    candidate.stagingRun ?? '',
    /^https:\/\/github\.com\/aladinez\/impresa-facture\/actions\/runs\/\d+$/,
  );
}
export function productionFiles(version) {
  return [
    ...Object.values(desktopPlatforms).map((platform) =>
      installerName('production', version, platform),
    ),
    ...['darwin-aarch64', 'darwin-x86_64'].map((platform) =>
      updaterName('production', version, platform),
    ),
    'latest.json',
  ];
}
export function validateArchive(bytes, candidate, entries) {
  validateCandidate(candidate);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    candidate.desktopArchiveSha256,
    'Prepared desktop changed since approval was queued',
  );
  assert.deepEqual(
    entries.slice().sort(),
    productionFiles(candidate.desktopVersion).sort(),
    'Unexpected, duplicate or unsafe archive paths',
  );
}
const gh = (args) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
export async function releaseDesktop(
  mode,
  candidate,
  { command = gh, fetchFeed = fetch } = {},
) {
  assert.ok(['prepare', 'publish'].includes(mode));
  validateCandidate(candidate);
  const version = candidate.desktopVersion;
  const runId = candidate.stagingRun.split('/').at(-1);
  const reused =
    mode === 'publish' && process.env.PREPARED_PRODUCTION_DIRECTORY;
  const directory =
    reused || mkdtempSync(join(tmpdir(), 'production-desktop-'));
  const prepared = `prepared-production-v${version}`;
  const tag = `desktop-production-v${version}`;
  if (!reused)
    command([
      'release',
      'download',
      prepared,
      '--repo',
      repository,
      '--pattern',
      'production-desktop.tar.gz',
      '--dir',
      directory,
    ]);
  const archive = join(directory, 'production-desktop.tar.gz');
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .trim()
    .split('\n');
  validateArchive(readFileSync(archive), candidate, entries);
  // Exact flat allowlist above prevents traversal, duplicate paths and extra files.
  execFileSync('tar', ['-xzf', archive, '-C', directory]);
  const manifest = JSON.parse(
    readFileSync(join(directory, 'latest.json'), 'utf8'),
  );
  const installers = Object.values(desktopPlatforms).map((platform) =>
    installerName('production', version, platform),
  );
  const updates = ['darwin-aarch64', 'darwin-x86_64'].map((platform) =>
    updaterName('production', version, platform),
  );
  validatePublishedAssets(
    manifest,
    { version, revision: candidate.revision, runId, channel: 'production' },
    installers.map((name) => ({ name })),
    updates.map((name) => ({ name })),
  );
  const response = await fetchFeed(assetUrl('production', 'latest.json'), {
    cache: 'no-store',
    signal: globalThis.AbortSignal.timeout(15000),
  });
  assert.equal(
    response.status,
    200,
    'Cannot inspect the production update channel',
  );
  const current = await response.json();
  assert.match(current.version ?? '', /^\d+\.\d+\.\d+$/);
  const a = version.split('.').map(Number),
    b = current.version.split('.').map(Number);
  const difference = a.findIndex((value, index) => value !== b[index]);
  if (difference < 0) {
    assert.equal(
      current.source_revision,
      candidate.revision,
      'Version already belongs to another source',
    );
    assert.equal(
      current.build_run_id,
      runId,
      'Version already belongs to another build',
    );
    assert.deepEqual(
      current.platforms,
      manifest.platforms,
      'Published update differs from the approved archive',
    );
    console.log('Production desktop already published.');
    return;
  }
  assert.ok(
    a[difference] > b[difference],
    'Cannot downgrade the production update channel',
  );
  if (mode === 'prepare') {
    if (process.env.GITHUB_ENV)
      appendFileSync(
        process.env.GITHUB_ENV,
        `PREPARED_PRODUCTION_DIRECTORY=${directory}\n`,
      );
    return;
  }
  // Invoked only after the protected job's Railway deploy/verification step succeeds.
  const notes = join(directory, 'release.md');
  const links = installers
    .map((name) => `- [${name}](${assetUrl(tag, name)})`)
    .join('\n');
  writeFileSync(
    notes,
    `Production ${version}\n\n${links}\n\nDesktop source revision: ${candidate.revision}. Build run: ${runId}.\n\nSigned updates require an install/restart click. OS signing/notarization is not configured.\n`,
  );
  let existing;
  try {
    existing = JSON.parse(
      command([
        'release',
        'view',
        tag,
        '--repo',
        repository,
        '--json',
        'isDraft,body,assets',
      ]),
    );
  } catch {
    /* Creation fails closed if inspection failed for another reason. */
  }
  if (existing) {
    assert.ok(
      existing.body.includes(
        `Desktop source revision: ${candidate.revision}.`,
      ) && existing.body.includes(`Build run: ${runId}.`),
      'Existing release belongs to another build',
    );
    assert.ok(
      existing.assets.every((asset) => installers.includes(asset.name)),
      'Unexpected installer assets',
    );
    if (!existing.isDraft) {
      // Never overwrite published binaries, including retries after feed publication fails.
      for (const name of installers) {
        assert.ok(
          existing.assets.some((asset) => asset.name === name),
          'Incomplete published release',
        );
        const check = mkdtempSync(join(tmpdir(), 'verify-installer-'));
        command([
          'release',
          'download',
          tag,
          '--repo',
          repository,
          '--pattern',
          name,
          '--dir',
          check,
        ]);
        assert.ok(
          readFileSync(join(check, name)).equals(
            readFileSync(join(directory, name)),
          ),
          'Published installer differs from approved archive',
        );
      }
    }
  } else
    command([
      'release',
      'create',
      tag,
      '--repo',
      repository,
      '--title',
      `Production ${version}`,
      '--notes-file',
      notes,
      '--draft',
      '--prerelease=false',
      '--latest=false',
    ]);
  if (!existing || existing.isDraft)
    command([
      'release',
      'upload',
      tag,
      ...installers.map((name) => join(directory, name)),
      '--repo',
      repository,
      '--clobber',
    ]);
  const archived = join(directory, manifestName('production', version));
  writeFileSync(archived, JSON.stringify(manifest, null, 2) + '\n');
  command([
    'release',
    'upload',
    'production',
    ...updates.map((name) => join(directory, name)),
    archived,
    '--repo',
    repository,
    '--clobber',
  ]);
  if (!existing || existing.isDraft)
    command([
      'release',
      'edit',
      tag,
      '--repo',
      repository,
      '--draft=false',
      '--prerelease=false',
      '--latest=false',
    ]);
  command([
    'release',
    'edit',
    'production',
    '--repo',
    repository,
    '--title',
    `Production downloads — ${version}`,
    '--notes-file',
    notes,
    '--prerelease=false',
  ]);
  // Advance latest only after every installer and updater upload succeeds.
  command([
    'release',
    'upload',
    'production',
    join(directory, 'latest.json'),
    '--repo',
    repository,
    '--clobber',
  ]);
  // Verify the publicly served feed; GitHub download redirects may briefly cache the old version.
  for (let attempt = 0; attempt < 12; attempt++) {
    const published = await fetchFeed(assetUrl('production', 'latest.json'), {
      cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(15000),
    });
    if (published.ok) {
      const feed = await published.json();
      if (
        feed.channel === 'production' &&
        feed.version === version &&
        feed.source_revision === candidate.revision &&
        feed.build_run_id === runId &&
        JSON.stringify(feed.platforms) === JSON.stringify(manifest.platforms)
      ) {
        if (process.env.GITHUB_STEP_SUMMARY)
          appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `\nProduction web and desktop ready: **${version}**. [Installers](https://github.com/${repository}/releases/tag/${tag}).\n`,
          );
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  throw new Error(
    'Production feed did not converge; rerun failed jobs to verify publication',
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await releaseDesktop(
    process.argv[2],
    JSON.parse(readFileSync('candidate.json', 'utf8')),
  );
