const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 4190;

module.exports = async function globalSetup() {
  const databasePath = path.join(os.tmpdir(), `neon-rumble-e2e-${process.pid}.sqlite`);
  const server = spawn(process.execPath, ['server.js', String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NEON_DB_PATH: databasePath,
      NEON_SECRET: 'e2e-only-secret',
      NEON_COUNTDOWN_TICKS: '12',
      NEON_RECONNECT_MS: '3000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let startupOutput = '', startupError = '';
  server.stdout.on('data', chunk => { startupOutput += String(chunk); });
  server.stderr.on('data', chunk => { startupError += String(chunk); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`E2E server did not start: ${startupError || startupOutput}`)), 8_000);
    const onData = chunk => {
      if (!String(chunk).includes('running on')) return;
      clearTimeout(timeout);
      server.stdout.off('data', onData);
      resolve();
    };
    server.stdout.on('data', onData);
    server.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`E2E server exited during startup (${code}): ${startupError || startupOutput}`));
    });
  });

  return async () => {
    if (server.exitCode == null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill();
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2_000))]);
    }
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  };
};
