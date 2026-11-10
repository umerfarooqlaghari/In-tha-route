const db = require('../config/db');
const AppError = require('../utils/AppError');

/**
 * Uploaded images. Kept in the database for now; swap this module for S3 (or
 * similar) when object storage is configured — nothing else touches the bytes.
 */
const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

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

async function saveImage({ imageBase64, mimeType, ownerUserId }, client = db) {
  const { data } = decodeImage(imageBase64, mimeType);
  const { rows } = await client.query(
    `INSERT INTO files (owner_user_id, mime_type, size_bytes, data)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [ownerUserId, mimeType, data.length, data]
  );
  return rows[0].id;
}

async function getFile(id, client = db) {
  const { rows } = await client.query('SELECT mime_type, data FROM files WHERE id = $1', [id]);
  return rows[0] || null;
}

const deleteFile = (id, client = db) => client.query('DELETE FROM files WHERE id = $1', [id]);

module.exports = { decodeImage, saveImage, getFile, deleteFile };
