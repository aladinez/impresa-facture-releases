import assert from 'node:assert/strict';
import { readFileSync, appendFileSync } from 'node:fs';
const candidate = JSON.parse(readFileSync('candidate.json', 'utf8'));
assert.equal(candidate.repository, 'aladinez/impresa-facture');
assert.match(candidate.revision ?? '', /^[a-f0-9]{40}$/);
assert.match(
  candidate.stagingRun ?? '',
  /^https:\/\/github\.com\/aladinez\/impresa-facture\/actions\/runs\/\d+$/,
);
assert.match(candidate.desktopVersion ?? '', /^\d+\.\d+\.\d+$/);
appendFileSync(process.env.GITHUB_OUTPUT, `revision=${candidate.revision}\n`);
appendFileSync(
  process.env.GITHUB_STEP_SUMMARY,
  `## Ready for production review\n\nApplication commit: \`${candidate.revision}\`\n\nStaging desktop version: **${candidate.desktopVersion}**\n\n[Staging installers](https://github.com/aladinez/impresa-facture-releases/releases/tag/desktop-staging-v${candidate.desktopVersion})\n\n[Staging verification run](${candidate.stagingRun})\n\nReview migrations and backup readiness before approving the production environment. Staging is rechecked after approval; a changed or unhealthy revision blocks deployment.\n`,
);
