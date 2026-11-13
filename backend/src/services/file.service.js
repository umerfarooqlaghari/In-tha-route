const crypto = require('crypto');
const db = require('../config/db');
const AppError = require('../utils/AppError');
const storage = require('./storage.service');

/**
 * Uploaded images (KYC document photos and scanned receipts).
 * With S3 configured (S3_BUCKET) the bytes go to the bucket and the `files` row keeps
 * only the object key; without it they are stored in the database as before.
 * Rows stored either way keep working, so switching on S3 needs no data move.
 */
const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

function decodeImage(imageBase64, mimeType) {
  if (!ALLOWED.includes(mimeType)) {
    throw new AppError(400, 'UNSUPPORTED_IMAGE', 'Please upload a JPEG or PNG photo.');
  }
  const clean = String(imageBase64).replace(/^data:[^;]+;base64,/, '');
  const data = Buffer.from(clean, 'base64');
  if (data.length === 0) throw new AppError(400, 'EMPTY_IMAGE', 'The photo was empty. Please try again.');
  if (data.length > MAX_BYTES) throw new AppError(413, 'IMAGE_TOO_LARGE', 'That photo is too large. Please use one under 6 MB.');
  return { data, base64: clean };
}

const objectKey = (folder, ownerUserId, id, mimeType) =>
  `${folder}/${ownerUserId || 'unowned'}/${id}.${EXTENSIONS[mimeType] || 'bin'}`;

/**
 * Saves a photo and returns its file id.
 * If the surrounding transaction rolls back after this, the S3 object stays behind;
 * callers can remove it with `discardUnsaved`.
 */
async function saveImage({ imageBase64, mimeType, ownerUserId, folder = 'kyc' }, client = db) {
  const { data } = decodeImage(imageBase64, mimeType);
  const id = crypto.randomUUID();

  if (!storage.isEnabled()) {
    await client.query(
      `INSERT INTO files (id, owner_user_id, mime_type, size_bytes, storage, data, folder)
       VALUES ($1, $2, $3, $4, 'db', $5, $6)`,
      [id, ownerUserId, mimeType, data.length, data, folder]
    );
    return id;
  }

  const key = objectKey(folder, ownerUserId, id, mimeType);
  await storage.put(key, data, mimeType);
  try {
    await client.query(
      `INSERT INTO files (id, owner_user_id, mime_type, size_bytes, storage, object_key, folder)
       VALUES ($1, $2, $3, $4, 's3', $5, $6)`,
      [id, ownerUserId, mimeType, data.length, key, folder]
    );
  } catch (err) {
    await storage.remove(key).catch(() => {});
    throw err;
  }
  return id;
}

/** The photo's type and bytes, or null. */
async function getFile(id, client = db) {
  const { rows } = await client.query('SELECT mime_type, storage, object_key, data FROM files WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return null;
  if (row.storage !== 's3') return { mime_type: row.mime_type, data: row.data };

  const data = await storage.get(row.object_key);
  if (!data) return null;
  return { mime_type: row.mime_type, data };
}

/**
 * Deletes a file row and its S3 object.
 * Call it after the transaction that stopped referencing the file has committed,
 * so a rollback can never point at an object that is already gone.
 */
async function deleteFile(id, client = db) {
  const { rows } = await client.query('DELETE FROM files WHERE id = $1 RETURNING storage, object_key', [id]);
  const row = rows[0];
  if (row && row.storage === 's3') {
    await storage.remove(row.object_key).catch((err) => {
      console.error(`Could not delete S3 object ${row.object_key}: ${err.message}`);
    });
  }
}

/** Removes a file saved by a transaction that then rolled back (no row exists any more). */
async function discardUnsaved(id, ownerUserId, mimeType, folder = 'kyc') {
  if (!storage.isEnabled()) return;
  await storage.remove(objectKey(folder, ownerUserId, id, mimeType)).catch(() => {});
}

// A scanned receipt that was never posted as an order is kept this long, then removed.
const UNPOSTED_RECEIPT_HOURS = 24;

/** Removes receipt photos from scans that never became an order. Returns how many went. */
async function deleteUnpostedReceipts(olderThanHours = UNPOSTED_RECEIPT_HOURS) {
  const { rows } = await db.query(
    `DELETE FROM files f
      WHERE f.folder = 'receipts'
        AND f.created_at < now() - make_interval(hours => $1)
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.receipt_file_id = f.id)
      RETURNING f.storage, f.object_key`,
    [olderThanHours]
  );
  for (const row of rows) {
    if (row.storage !== 's3') continue;
    await storage.remove(row.object_key).catch((err) => {
      console.error(`Could not delete S3 object ${row.object_key}: ${err.message}`);
    });
  }
  return rows.length;
}

module.exports = {
  decodeImage,
  saveImage,
  getFile,
  deleteFile,
  discardUnsaved,
  deleteUnpostedReceipts,
  MAX_BYTES,
  UNPOSTED_RECEIPT_HOURS,
};
