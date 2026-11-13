const db = require('../config/db');
const AppError = require('../utils/AppError');
const { dateLabel } = require('../utils/labels');
const files = require('./file.service');

// Order matters: the app shows the documents (and their icons) in this order.
const DOC_TYPES = [
  { type: 'driving_licence', title: 'UK Driving Licence (Photocard)', subtitle: 'Full UK licence or CBT certificate' },
  { type: 'ni_number', title: 'National Insurance (NI) Number', subtitle: 'Proof of your National Insurance number' },
  { type: 'bank_account', title: 'UK Bank Account & Sort Code', subtitle: 'Bank statement or card for weekly payouts' },
  { type: 'vehicle_insurance', title: 'Hire & Reward Vehicle Insurance', subtitle: 'Food delivery insurance certificate' },
  { type: 'identity', title: 'Personal Identity Document', subtitle: 'Passport or other government photo ID' },
  {
    type: 'right_to_work',
    title: 'Right to Work in the UK',
    subtitle: 'UK or Irish passport, or a screenshot of your Home Office share code',
  },
];
const ORDER = new Map(DOC_TYPES.map((d, i) => [d.type, i]));
const META = new Map(DOC_TYPES.map((d) => [d.type, d]));

async function createSlots(driverId, client = db) {
  await client.query(
    `INSERT INTO kyc_documents (driver_id, doc_type)
     SELECT $1, t FROM unnest($2::text[]) AS t
     ON CONFLICT (driver_id, doc_type) DO NOTHING`,
    [driverId, DOC_TYPES.map((d) => d.type)]
  );
}

function toDocument(row) {
  const meta = META.get(row.doc_type);
  const updatedAt =
    row.status === 'verified'
      ? `Verified ${dateLabel(row.updated_at)}`
      : row.status === 'pending'
      ? 'Pending Admin Review'
      : row.note || 'Not uploaded yet';
  return {
    id: row.id,
    type: row.doc_type,
    title: meta.title,
    subtitle: meta.subtitle,
    value: row.status === 'missing' ? 'No photo uploaded' : 'Photo submitted',
    status: row.status,
    updatedAt,
    hasFile: Boolean(row.file_id),
  };
}

/** @returns {Map<string, object[]>} driver id -> documents in display order */
async function listForDrivers(driverIds, client = db) {
  const byDriver = new Map(driverIds.map((id) => [id, []]));
  if (driverIds.length === 0) return byDriver;
  const { rows } = await client.query('SELECT * FROM kyc_documents WHERE driver_id = ANY($1::uuid[])', [driverIds]);
  rows.sort((a, b) => ORDER.get(a.doc_type) - ORDER.get(b.doc_type));
  for (const row of rows) byDriver.get(row.driver_id).push(toDocument(row));
  return byDriver;
}

/** A driver submits (or replaces) the photo for one of their documents. */
async function upload({ driverId, userId, documentId, imageBase64, mimeType }) {
  let newFileId = null;
  let replacedFileId = null;
  try {
    await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM kyc_documents WHERE id = $1 AND driver_id = $2 FOR UPDATE',
        [documentId, driverId]
      );
      const doc = rows[0];
      if (!doc) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');

      newFileId = await files.saveImage({ imageBase64, mimeType, ownerUserId: userId }, client);
      await client.query(
        `UPDATE kyc_documents SET status = 'pending', file_id = $1, note = NULL, reviewed_by = NULL, updated_at = now()
          WHERE id = $2`,
        [newFileId, doc.id]
      );
      replacedFileId = doc.file_id;
      // A rejected application goes back into the review queue once something is re-uploaded.
      await client.query(
        `UPDATE driver_profiles SET status = 'pending_kyc', updated_at = now()
          WHERE id = $1 AND status = 'rejected'`,
        [driverId]
      );
    });
  } catch (err) {
    if (newFileId) await files.discardUnsaved(newFileId, userId, mimeType);
    throw err;
  }
  // The old photo is removed only once nothing points at it any more.
  if (replacedFileId) await files.deleteFile(replacedFileId);
}

async function lockPlatformDriver(driverId, client) {
  const { rows } = await client.query('SELECT * FROM driver_profiles WHERE id = $1 FOR UPDATE', [driverId]);
  const driver = rows[0];
  if (!driver) throw new AppError(404, 'DRIVER_NOT_FOUND', 'Driver not found.');
  if (driver.driver_type !== 'platform_contracted') {
    throw new AppError(400, 'NOT_A_PLATFORM_DRIVER', 'In-house drivers do not need approval.');
  }
  return driver;
}

/** Admin approves a platform driver: every document becomes verified. */
async function approve(driverId, adminUserId) {
  return db.withTransaction(async (client) => {
    const driver = await lockPlatformDriver(driverId, client);
    const awaitingApproval = driver.status === 'pending_kyc' || driver.status === 'rejected';
    const missing = await client.query(
      `SELECT count(*)::int AS n FROM kyc_documents WHERE driver_id = $1 AND status = 'missing'`,
      [driverId]
    );
    // A driver who is already working keeps working while a document added later is
    // still to upload; what they have uploaded since can be verified on its own.
    if (awaitingApproval && missing.rows[0].n > 0) {
      throw new AppError(400, 'DOCUMENTS_MISSING', 'This driver has not uploaded all of their documents yet.');
    }
    await client.query(
      `UPDATE kyc_documents SET status = 'verified', note = NULL, reviewed_by = $2, updated_at = now()
        WHERE driver_id = $1 AND status <> 'missing'`,
      [driverId, adminUserId]
    );
    // Approved drivers start offline and go online from the Drive screen.
    if (awaitingApproval) {
      await client.query(`UPDATE driver_profiles SET status = 'offline', updated_at = now() WHERE id = $1`, [driverId]);
    }
  });
}

/** Admin rejects a platform driver: submitted documents must be uploaded again. */
async function reject(driverId, adminUserId, reason) {
  const oldFileIds = await db.withTransaction(async (client) => {
    await lockPlatformDriver(driverId, client);
    const open = await client.query(
      `SELECT count(*)::int AS n FROM batches WHERE driver_id = $1 AND status IN ('offered', 'accepted')`,
      [driverId]
    );
    if (open.rows[0].n > 0) {
      throw new AppError(409, 'DRIVER_HAS_ACTIVE_BATCH', 'This driver has orders in progress. Try again when they finish.');
    }
    const note = reason ? `Rejected: ${reason}` : 'Rejected — please upload again';
    const old = await client.query(
      'SELECT file_id FROM kyc_documents WHERE driver_id = $1 AND file_id IS NOT NULL',
      [driverId]
    );
    await client.query(
      `UPDATE kyc_documents SET status = 'missing', note = $2, reviewed_by = $3, file_id = NULL, updated_at = now()
        WHERE driver_id = $1`,
      [driverId, note, adminUserId]
    );
    await client.query(`UPDATE driver_profiles SET status = 'rejected', updated_at = now() WHERE id = $1`, [driverId]);
    await client.query(
      'UPDATE driver_online_sessions SET ended_at = now() WHERE driver_id = $1 AND ended_at IS NULL',
      [driverId]
    );
    return old.rows.map((r) => r.file_id);
  });
  for (const id of oldFileIds) await files.deleteFile(id);
}

/** The stored photo for a document (admin review). */
async function getDocumentFile(documentId) {
  const { rows } = await db.query('SELECT file_id FROM kyc_documents WHERE id = $1', [documentId]);
  if (!rows[0] || !rows[0].file_id) return null;
  return files.getFile(rows[0].file_id);
}

module.exports = { DOC_TYPES, createSlots, listForDrivers, upload, approve, reject, getDocumentFile };
