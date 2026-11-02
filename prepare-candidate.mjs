import { validateCandidate } from './desktop-release.mjs';
import { readFileSync, appendFileSync } from 'node:fs';
const candidate = JSON.parse(readFileSync('candidate.json', 'utf8'));
validateCandidate(candidate);
appendFileSync(process.env.GITHUB_OUTPUT, `revision=${candidate.revision}\n`);
appendFileSync(
  process.env.GITHUB_STEP_SUMMARY,
  candidate.scope === 'admin'
    ? `## Admin ready for production review\n\nAdmin commit: \`${candidate.revision}\`\n\nCustomer API/web baseline: \`${candidate.baselineRevision}\`\n\n[Staging verification run](${candidate.stagingRun})\n\nOnly the admin service changes. Customer services must still match the baseline after the existing production Environment approval.\n`
    : `## Ready for production review\n\nApplication commit: \`${candidate.revision}\`\n\nStaging desktop version: **${candidate.desktopVersion}**\n\n[Staging installers](https://github.com/aladinez/impresa-facture-releases/releases/tag/desktop-staging-v${candidate.desktopVersion})\n\n[Staging verification run](${candidate.stagingRun})\n\nReview migrations and backup readiness before approving the production environment. Staging is rechecked after approval; a changed or unhealthy revision blocks deployment.\n`,
);
