const app = require('./app');
const { pool } = require('./config/db');
const { runMigrations } = require('./db/migrate');
const { seedAdmin } = require('./db/seedAdmin');
const realtime = require('./services/realtime.service');

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

async function start() {
  // For hosts without a shell (e.g. Render's free plan): migrate, and seed the
  // admin when its credentials are configured, before accepting traffic.
  if (process.env.AUTO_MIGRATE === 'true') {
    await runMigrations(pool);
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      await seedAdmin(pool);
    }
  }

  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Environment: ${NODE_ENV}`);
    if (NODE_ENV === 'development') console.log(`Swagger docs: http://localhost:${PORT}/swagger`);
  });
  // Live chat and online status share the same port.
  realtime.attach(server);
}

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
