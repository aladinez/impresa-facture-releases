import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const environments = {
  staging: {
    id: 'caa3fdb2-dc6e-4d9f-b829-62f6ef7bb245',
    web: 'https://appweb-staging.up.railway.app',
    api: 'https://appapi-staging-0776.up.railway.app',
  },
  production: {
    id: 'a8c4fcba-969f-41bd-b3e1-c82a29097e88',
    web: 'https://facture.impresa.ma',
    api: 'https://appapi-production-91fb.up.railway.app',
  },
};
const services = [
  '88bcf134-979d-415b-9dc9-52690d90cf73',
  'e098d368-8a9f-4091-bcf5-05d9f76415a7',
];
const [operation, target, revision] = process.argv.slice(2);
assert.ok(['verify', 'deploy'].includes(operation));
assert.ok(Object.hasOwn(environments, target));
assert.match(revision ?? '', /^[a-f0-9]{40}$/);
assert.ok(
  process.env.RAILWAY_TOKEN || !process.env.CI,
  'Environment-scoped RAILWAY_TOKEN required in CI',
);
const environment = environments[target];
async function api(query, variables) {
  if (!process.env.RAILWAY_TOKEN) {
    const result = JSON.parse(
      execFileSync(
        'pnpm',
        [
          'exec',
          'railway',
          'api',
          query,
          '--variables',
          JSON.stringify(variables),
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
      ),
    );
    assert.ok(!result.errors, 'Railway API rejected the operation');
    return result.data;
  }
  const response = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Project-Access-Token': process.env.RAILWAY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, 'Railway API request failed');
  const result = await response.json();
  assert.ok(
    !result.errors,
    'Railway rejected the release operation (credentials/scope/schema)',
  );
  return result.data;
}
async function state() {
  return (
    await api(
      'query($id:String!){environment(id:$id){name serviceInstances{edges{node{serviceId latestDeployment{id status meta}}}}}}',
      { id: environment.id },
    )
  ).environment;
}
async function smoke() {
  for (const url of [
    environment.web + '/health/live',
    environment.api + '/health/ready',
  ]) {
    assert.equal(
      (await fetch(url, { signal: globalThis.AbortSignal.timeout(15_000) }))
        .status,
      200,
      `Health failed: ${url}`,
    );
  }
  const response = await fetch(environment.web + '/config.json');
  const config = await response.json();
  assert.equal(config.environment, target);
  assert.equal(config.apiBaseUrl, environment.api);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  const cors = await fetch(environment.api + '/health/ready', {
    headers: { Origin: environment.web },
  });
  assert.equal(
    cors.headers.get('access-control-allow-origin'),
    environment.web,
  );
  if (target === 'staging') {
    const home = await fetch(environment.web);
    assert.match(home.headers.get('x-robots-tag') ?? '', /noindex/);
  }
}
let requestedDeployments;
if (operation === 'deploy') {
  // A direct, revision-only patch never consumes unrelated staged dashboard changes.
  const patch = {
    services: Object.fromEntries(
      services.map((id) => [
        id,
        { source: { branch: `deploy/${revision}`, commitSha: revision } },
      ]),
    ),
  };
  patch.services[services[0]].variables = {
    CORS_ORIGINS: {
      value: `${environment.web},tauri://localhost,http://tauri.localhost`,
    },
  };
  await api(
    'mutation($id:String!,$patch:EnvironmentConfig!,$message:String!){environmentPatchCommit(environmentId:$id,patch:$patch,commitMessage:$message,skipDeploys:true)}',
    { id: environment.id, patch, message: `CI release ${revision}` },
  );
  let applied = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const snapshot = await api(
      'query($id:String!){environment(id:$id){config(decryptVariables:false)}}',
      { id: environment.id },
    );
    if (
      services.every(
        (id) =>
          snapshot.environment.config.services[id].source.branch ===
            `deploy/${revision}` &&
          snapshot.environment.config.services[id].source.commitSha ===
            revision,
      )
    ) {
      applied = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.ok(applied, 'Release configuration did not converge');
  requestedDeployments = [];
  for (const service of services) {
    const result = await api(
      'mutation($id:String!,$service:String!,$sha:String!){serviceInstanceDeployV2(environmentId:$id,serviceId:$service,commitSha:$sha)}',
      { id: environment.id, service, sha: revision },
    );
    requestedDeployments.push(result.serviceInstanceDeployV2);
  }
}
let verified;
for (let attempt = 0; attempt < (operation === 'deploy' ? 90 : 1); attempt++) {
  const current = await state();
  assert.equal(current.name, target);
  const apps = services.map(
    (id) =>
      current.serviceInstances.edges.find(({ node }) => node.serviceId === id)
        ?.node.latestDeployment,
  );
  if (
    apps.every(
      (app) =>
        app?.status === 'SUCCESS' &&
        app.meta?.commitHash === revision &&
        (!requestedDeployments || requestedDeployments.includes(app.id)),
    )
  ) {
    await smoke();
    verified = apps;
    break;
  }
  if (
    apps.some(
      (app) =>
        app?.meta?.commitHash === revision &&
        ['FAILED', 'CRASHED', 'REMOVED'].includes(app.status),
    )
  )
    throw new Error(
      'Release failed. Inspect Railway logs; no database rollback was attempted.',
    );
  if (operation === 'verify')
    throw new Error(
      `Expected ${target} application commit ${revision}; found ${apps.map((app) => `${app?.meta?.commitHash ?? 'unknown'} (${app?.status ?? 'missing'})`).join(', ')}. Use the application revision, not the releases repository revision.`,
    );
  console.log(
    `${target}: waiting for ${revision.slice(0, 7)} (${apps.map((app) => app?.status ?? 'pending').join(', ')})`,
  );
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
assert.ok(verified, 'Timed out waiting for the selected revision');
const evidence = {
  environment: target,
  revision,
  deployments: verified.map((app) => ({
    id: app.id,
    imageDigest: app.meta?.imageDigest,
  })),
  verifiedAt: new Date().toISOString(),
};
console.log(JSON.stringify(evidence));
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `\nVerified ${target} commit \`${revision}\` at ${environment.web}.\n\nHobby policy: rebuilt from the same commit; images may differ.\n`,
  );
