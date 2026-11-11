/**
 * Copies photos still stored in Postgres into the S3 bucket, one at a time, and clears
 * the bytes from the database. Safe to run more than once: only 'db' rows are moved.
 *
 *   npm run files:to-s3
 */
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };

async function moveFilesToS3(pool, storage, log = console.log) {
  if (!storage.isEnabled()) throw new Error('S3_BUCKET is not set; nothing to move to.');

  const { rows } = await pool.query(`SELECT id FROM files WHERE storage = 'db' ORDER BY created_at`);
  let moved = 0;
  for (const { id } of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: found } = await client.query(
        `SELECT owner_user_id, mime_type, data FROM files WHERE id = $1 AND storage = 'db' FOR UPDATE`,
        [id]
      );
      const file = found[0];
      if (!file) {
        await client.query('ROLLBACK');
        continue;
      }
      const key = `kyc/${file.owner_user_id || 'unowned'}/${id}.${EXTENSIONS[file.mime_type] || 'bin'}`;
      await storage.put(key, file.data, file.mime_type);
      await client.query(`UPDATE files SET storage = 's3', object_key = $2, data = NULL WHERE id = $1`, [id, key]);
      await client.query('COMMIT');
      moved += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Moving file ${id} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
  log(`Moved ${moved} of ${rows.length} file(s) to S3.`);
  return moved;
}

module.exports = { moveFilesToS3 };

if (require.main === module) {
  require('dotenv').config();
  const { pool } = require('../config/db');
  const storage = require('../services/storage.service');
  moveFilesToS3(pool, storage)
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err.message);
      await pool.end();
      process.exit(1);
    });
}
