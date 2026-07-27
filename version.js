const packageMetadata = require('./package.json');

const GAME_VERSION = Object.freeze({
  name: packageMetadata.name,
  version: packageMetadata.version,
  protocol: 1,
  channel: packageMetadata.version.includes('-') ? 'beta' : 'stable'
});

module.exports = GAME_VERSION;
