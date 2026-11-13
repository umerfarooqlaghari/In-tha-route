const app = require('./app');
const { pool } = require('./config/db');
const { runMigrations } = require('./db/migrate');
const { seedAdmin } = require('./db/seedAdmin');
const realtime = require('./services/realtime.service');
const storage = require('./services/storage.service');
const ocr = require('./services/ocr.service');
const geo = require('./services/geo.service');

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
    console.log(
      process.env.GEMINI_API_KEY
        ? `Receipt scanning: Gemini (${ocr.modelChain().map((m) => m.name).join(' → ')}).`
        : 'Receipt scanning: off (set GEMINI_API_KEY).'
    );
    console.log(
      geo.isGoogleEnabled()
        ? 'Maps: Google (door-level addresses, road miles, live ETA).'
        : 'Maps: postcodes only, straight-line miles (set GOOGLE_MAPS_API_KEY for road routing).'
    );
    console.log(process.env.PUSH_DISABLED === 'true' ? 'Push notifications: off.' : 'Push notifications: on (Expo).');
    storage.checkConnection();
  });
  // Live chat and online status share the same port.
  realtime.attach(server);

  // Late or unassigned orders raise an alert.
  const dispatch = require('./services/dispatch.service');
  const orders = require('./services/order.service');
  setInterval(async () => {
    try {
      await dispatch.expireStaleOffers(); // old-style offers left from before the open pool
    } catch (err) {
      console.error('Offer sweep failed:', err.message);
    }
    try {
      await orders.sendAttentionAlerts();
    } catch (err) {
      console.error('Order alerts failed:', err.message);
    }
  }, 30_000).unref();

  // Receipt photos from scans that were never posted are removed after a day.
  const files = require('./services/file.service');
  const clearUnpostedReceipts = () =>
    files.deleteUnpostedReceipts().catch((err) => console.error('Receipt clean-up failed:', err.message));
  clearUnpostedReceipts();
  setInterval(clearUnpostedReceipts, 60 * 60 * 1000).unref();
}

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
