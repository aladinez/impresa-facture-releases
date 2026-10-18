import assert from 'node:assert/strict';
const repository = 'aladinez/impresa-facture-releases';
export const desktopPlatforms = {
  'aarch64-apple-darwin': 'darwin-aarch64',
  'x86_64-apple-darwin': 'darwin-x86_64',
  'x86_64-pc-windows-msvc': 'windows-x86_64',
};
function validate(channel, version) {
  assert.ok(['staging', 'production'].includes(channel));
  assert.match(version, /^\d+\.\d+\.\d+$/);
}
export function installerName(channel, version, platform) {
  validate(channel, version);
  const suffix = {
    'darwin-aarch64': 'macOS-Apple-Silicon.dmg',
    'darwin-x86_64': 'macOS-Intel.dmg',
    'windows-x86_64': 'Windows-x64-Setup.exe',
  }[platform];
  assert.ok(suffix);
  return `Impresa-Facture${channel === 'staging' ? '-Staging' : ''}-${version}-${suffix}`;
}
export function updaterName(channel, version, platform) {
  validate(channel, version);
  assert.ok(['darwin-aarch64', 'darwin-x86_64'].includes(platform));
  return `update-${channel}-v${version}-${platform}.app.tar.gz`;
}
export function manifestName(channel, version) {
  validate(channel, version);
  return `manifest-${channel}-v${version}.json`;
}
export function assetUrl(tag, name) {
  return `https://github.com/${repository}/releases/download/${tag}/${name}`;
}
export function validatePublishedAssets(
  manifest,
  expected,
  installers,
  updateAssets = [],
) {
  const { version, revision, runId, channel } = expected;
  validate(channel, version);
  assert.equal(manifest.version, version);
  assert.equal(manifest.source_revision, revision);
  assert.equal(manifest.build_run_id, runId);
  assert.equal(manifest.channel, channel);
  assert.deepEqual(
    Object.keys(manifest.platforms).sort(),
    Object.values(desktopPlatforms).sort(),
  );
  const prefix = assetUrl(`desktop-${channel}-v${version}`, '');
  for (const [platform, record] of Object.entries(manifest.platforms)) {
    assert.ok(
      typeof record.signature === 'string' && record.signature.length > 40,
    );
    if (manifest.artifact_layout === 'channel-updaters-v1') {
      const windows = platform === 'windows-x86_64';
      const name = windows
        ? installerName(channel, version, platform)
        : updaterName(channel, version, platform);
      assert.equal(
        record.url,
        assetUrl(windows ? `desktop-${channel}-v${version}` : channel, name),
      );
      assert.ok(
        (windows ? installers : updateAssets).some(
          (entry) => entry.name === name,
        ),
        'Missing published platform asset',
      );
    } else {
      assert.equal(
        manifest.artifact_layout,
        undefined,
        'Unknown artifact layout',
      );
      assert.ok(record.url.startsWith(prefix));
      const name = record.url.slice(prefix.length);
      assert.ok(
        !name.includes('/') && installers.some((entry) => entry.name === name),
        'Missing published platform asset',
      );
    }
  }
  if (manifest.artifact_layout === 'channel-updaters-v1') {
    assert.deepEqual(
      installers.map((entry) => entry.name).sort(),
      Object.values(desktopPlatforms)
        .map((platform) => installerName(channel, version, platform))
        .sort(),
      'Installer releases contain only three installers',
    );
  }
}
