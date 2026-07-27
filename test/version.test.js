const test = require('node:test');
const assert = require('node:assert/strict');
const packageMetadata = require('../package.json');
const packageLock = require('../package-lock.json');
const gameVersion = require('../version');

test('game version has one semver source shared by package, lockfile, and server metadata', () => {
  assert.match(packageMetadata.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(packageLock.version, packageMetadata.version);
  assert.equal(packageLock.packages[''].version, packageMetadata.version);
  assert.equal(gameVersion.version, packageMetadata.version);
  assert.ok(Number.isSafeInteger(gameVersion.protocol) && gameVersion.protocol > 0);
  assert.equal(gameVersion.channel, packageMetadata.version.includes('-') ? 'beta' : 'stable');
});
