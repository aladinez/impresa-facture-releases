import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { validateAdminCandidate } from './release-scope.mjs';

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
const customerServices = [
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
const candidate = existsSync('candidate.json')
  ? JSON.parse(readFileSync('candidate.json', 'utf8'))
  : null;
assert.ok(
  !candidate || !process.env.RELEASE_SCOPE,
  'Candidate and explicit release scope must not be mixed',
);
if (candidate?.scope === 'admin') {
  validateAdminCandidate(candidate);
  assert.equal(candidate.revision, revision);
}
const scope = candidate?.scope ?? process.env.RELEASE_SCOPE ?? 'full';
assert.ok(['full', 'admin'].includes(scope));
const baseline = candidate?.baselineRevision ?? process.env.RELEASE_BASELINE;
if (scope === 'admin') assert.match(baseline ?? '', /^[a-f0-9]{40}$/);
let services;
let adminOrigin;
function checkResult(result, query) {
  if (!result.errors?.length) return;
  // Report only known categories. Provider messages can contain variables or
  // credentials; never dump the response, query variables or arbitrary text.
  const categories = result.errors.map(({ message = '', extensions }) => {
    const code = extensions?.code;
    if (
      /unauthori[sz]ed|forbidden|permission|access denied|invalid token/i.test(
        message,
      )
    )
      return 'authorization';
    if (
      /deploys have been paused temporarily|builds.*temporarily paused/i.test(
        message,
      )
    )
      return 'Railway deployments temporarily paused; retry after provider recovery';
    if (/rate limit|too many requests/i.test(message)) return 'rate limit';
    if (
      /build.*limit|deployment.*limit|usage.*limit|billing|credits/i.test(
        message,
      )
    )
      return 'plan or usage limit';
    if (/commit|branch|repository|github/i.test(message))
      return 'source access or revision';
    if (
      /cannot query field|unknown argument|syntax error|validation/i.test(
        message,
      )
    )
      return 'API schema or validation';
    if (/not found|does not exist/i.test(message)) return 'resource not found';
    if (/timeout|timed out|temporar|internal server/i.test(message))
      return 'provider availability';
    return [
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'BAD_USER_INPUT',
      'INTERNAL_SERVER_ERROR',
    ].includes(code)
      ? code
      : 'unclassified provider rejection (details withheld)';
  });
  if (
    categories.some((category) =>
      category.startsWith('Railway deployments temporarily paused'),
    ) &&
    process.env.GITHUB_STEP_SUMMARY
  )
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      '\nRailway has temporarily paused deployment creation. Existing services stay on their current deployments. Check [Railway status](https://status.railway.com/) and retry the latest staging candidate after provider recovery; do not rotate credentials or bypass production approval.\n',
    );
  const action = query.match(/\{\s*(\w+)/)?.[1] ?? 'unknown';
  throw new Error(
    `Railway ${target} ${action} rejected: ${[...new Set(categories)].join(', ')}. Inspect Railway activity before retrying; no automatic rollback or mutation retry was attempted.`,
  );
}
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
    checkResult(result, query);
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
  checkResult(result, query);
  return result.data;
}
async function state() {
  return (
    await api(
      'query($id:String!){environment(id:$id){name serviceInstances{edges{node{serviceId serviceName latestDeployment{id status meta}}}}}}',
      { id: environment.id },
    )
  ).environment;
}
async function smoke() {
  if (adminOrigin) {
    for (const path of ['/health/live', '/health/ready', '/']) {
      const response = await fetch(adminOrigin + path, {
        signal: globalThis.AbortSignal.timeout(15000),
      });
      assert.equal(response.status, 200, 'Admin health/page unavailable');
      assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    }
    const session = await fetch(adminOrigin + '/api/me', {
      signal: globalThis.AbortSignal.timeout(15000),
    });
    assert.equal(session.status, 401, 'Admin operator boundary unavailable');
  }
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
// Discover the separately authorized service; do not invent service IDs/hostnames.
const initial = await state();
assert.equal(initial.name, target);
const instances = initial.serviceInstances.edges.map(({ node }) => node);
const admins = instances.filter((node) => node.serviceName === '@app/admin');
assert.ok(admins.length <= 1, 'Ambiguous admin service');
const admin = admins[0];
if (scope === 'admin')
  assert.ok(
    admin,
    'Provision/configure the admin service separately before releasing it',
  );
if (admin) {
  assert.match(admin.serviceId, /^[a-f0-9-]{36}$/);
  const domains = await api(
    'query($project:String!,$environment:String!,$service:String!){domains(projectId:$project,environmentId:$environment,serviceId:$service){serviceDomains{domain}}}',
    {
      project: 'b007a1a0-4ac8-4847-b211-cbf4f4a73c24',
      environment: environment.id,
      service: admin.serviceId,
    },
  );
  const domain = domains.domains.serviceDomains[0]?.domain;
  assert.match(domain ?? '', /^[a-z0-9-]+\.up\.railway\.app$/);
  adminOrigin = `https://${domain}`;
}
function checkBaseline(current) {
  if (scope !== 'admin') return;
  for (const id of customerServices) {
    const deployed = current.serviceInstances.edges.find(
      ({ node }) => node.serviceId === id,
    )?.node.latestDeployment;
    assert.ok(
      deployed?.status === 'SUCCESS' && deployed.meta?.commitHash === baseline,
      'Customer services changed or are not at the published baseline; use the complete release path',
    );
  }
}
checkBaseline(initial);
services =
  scope === 'admin'
    ? [admin.serviceId]
    : [...customerServices, ...(admin ? [admin.serviceId] : [])];
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
  if (scope === 'full')
    patch.services[customerServices[0]].variables = {
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
    console.log(`${target}: requesting ${service} at ${revision}`);
    const result = await api(
      'mutation($id:String!,$service:String!,$sha:String!){serviceInstanceDeployV2(environmentId:$id,serviceId:$service,commitSha:$sha)}',
      { id: environment.id, service, sha: revision },
    );
    assert.equal(
      typeof result.serviceInstanceDeployV2,
      'string',
      'Railway did not return a deployment ID',
    );
    assert.ok(
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        result.serviceInstanceDeployV2,
      ),
      'Railway returned an invalid deployment ID',
    );
    requestedDeployments.push(result.serviceInstanceDeployV2);
    console.log(
      `${target}: requested ${service} deployment ${result.serviceInstanceDeployV2}`,
    );
  }
}
let verified;
for (let attempt = 0; attempt < (operation === 'deploy' ? 90 : 1); attempt++) {
  const current = await state();
  assert.equal(current.name, target);
  checkBaseline(current);
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
  scope,
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
