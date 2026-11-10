const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default;

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

/** Starts a throwaway real PostgreSQL server and points DATABASE_URL at it. */
async function startTestDatabase() {
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-test-pg-'));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('intharoute_test');
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/intharoute_test`;

  return async () => {
    await server.stop();
    fs.rmSync(databaseDir, { recursive: true, force: true });
  };
}

module.exports = { startTestDatabase };
