const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');

/**
 * Private object storage on Amazon S3 (or any S3-compatible service via S3_ENDPOINT,
 * e.g. Cloudflare R2). Turned on by setting S3_BUCKET.
 *
 * Credentials come from the standard AWS variables (AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY) or the host's IAM role — never from code.
 */
const BUCKET = process.env.S3_BUCKET || '';
const REGION = process.env.AWS_REGION || process.env.S3_REGION || 'eu-west-2';
const ENDPOINT = process.env.S3_ENDPOINT || undefined;
const KEY_PREFIX = (process.env.S3_KEY_PREFIX || '').replace(/^\/+|\/+$/g, '');

let client = null;
function s3() {
  if (!client) {
    client = new S3Client({
      region: REGION,
      endpoint: ENDPOINT,
      // Custom endpoints (R2, MinIO, tests) expect bucket-in-path URLs.
      forcePathStyle: Boolean(ENDPOINT),
    });
  }
  return client;
}

const isEnabled = () => Boolean(BUCKET);
const fullKey = (key) => (KEY_PREFIX ? `${KEY_PREFIX}/${key}` : key);

async function put(key, body, contentType) {
  await s3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: fullKey(key),
      Body: body,
      ContentType: contentType,
      // Encrypted at rest; the bucket itself must also block all public access.
      ServerSideEncryption: ENDPOINT ? undefined : 'AES256',
    })
  );
}

/** The object's bytes, or null when it does not exist. */
async function get(key) {
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: fullKey(key) }));
    return Buffer.from(await out.Body.transformToByteArray());
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

async function remove(key) {
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fullKey(key) }));
}

/** Logs at startup whether the bucket can be reached, so a bad setup shows in the logs. */
async function checkConnection(log = console.log) {
  if (!isEnabled()) {
    log('File storage: database (set S3_BUCKET to store uploads in S3).');
    return;
  }
  try {
    await s3().send(new HeadBucketCommand({ Bucket: BUCKET }));
    log(`File storage: S3 bucket "${BUCKET}" (${REGION}).`);
  } catch (err) {
    console.error(`File storage: S3 bucket "${BUCKET}" is not reachable (${err.name}: ${err.message}). Uploads will fail.`);
  }
}

module.exports = { isEnabled, put, get, remove, checkConnection };
