const test = require('node:test');
const assert = require('node:assert/strict');
const packageMetadata = require('../package.json');
const packageLock = require('../package-lock.json');
const gameVersion = require('../version');
const releases = require('../releases');

test('game version has one semver source shared by package, lockfile, server, and releases', () => {
  assert.match(packageMetadata.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(packageLock.version, packageMetadata.version);
  assert.equal(packageLock.packages[''].version, packageMetadata.version);
  assert.equal(gameVersion.version, packageMetadata.version);
  assert.equal(releases[0].version, packageMetadata.version);
  assert.ok(Number.isSafeInteger(gameVersion.protocol) && gameVersion.protocol > 0);
  assert.equal(gameVersion.channel, packageMetadata.version.includes('-') ? 'beta' : 'stable');
});

test('release history is complete, unique, and newest-first', () => {
  assert.ok(releases.length > 0);
  assert.equal(new Set(releases.map(release => release.version)).size, releases.length);
  for (const release of releases) {
    assert.match(release.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(release.title.trim());
    assert.ok(release.summary.trim());
    assert.ok(Array.isArray(release.changes) && release.changes.length > 0);
    assert.ok(release.changes.every(change => typeof change === 'string' && change.trim()));
  }
  for (let index = 1; index < releases.length; index += 1) {
    assert.ok(
      releases[index - 1].date >= releases[index].date,
      `${releases[index - 1].version} must not be older than ${releases[index].version}`
    );
  }
});
