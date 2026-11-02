import assert from 'node:assert/strict';

// A positive allowlist: anything shared, dependencies, CI, release control or
// infrastructure takes the complete application/desktop path.
export function adminOnlyPaths(paths) {
  return (
    paths.length > 0 &&
    paths.some(
      (path) =>
        path.startsWith('apps/admin/') ||
        path === 'infra/docker/admin.Dockerfile' ||
        path === 'infra/scripts/serve-admin.mjs',
    ) &&
    paths.every(
      (path) =>
        /^apps\/admin\/(src\/|next\.config\.ts$|postcss\.config\.mjs$)/.test(
          path,
        ) ||
        [
          'infra/docker/admin.Dockerfile',
          'infra/scripts/serve-admin.mjs',
        ].includes(path) ||
        /^(docs\/.*\.md|README\.md|ARCHITECTURE\.md)$/.test(path),
    )
  );
}
export function validateAdminCandidate(candidate) {
  assert.equal(candidate.scope, 'admin');
  assert.equal(candidate.repository, 'aladinez/impresa-facture');
  assert.match(candidate.revision ?? '', /^[a-f0-9]{40}$/);
  assert.match(candidate.baselineRevision ?? '', /^[a-f0-9]{40}$/);
  assert.notEqual(candidate.revision, candidate.baselineRevision);
  assert.match(
    candidate.stagingRun ?? '',
    /^https:\/\/github\.com\/aladinez\/impresa-facture\/actions\/runs\/\d+$/,
  );
  assert.equal(candidate.desktopVersion, undefined);
  assert.equal(candidate.desktopArchiveSha256, undefined);
}
