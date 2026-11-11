# Setup: Gemini (receipt scanning) and Amazon S3 (KYC photos)

Both are switched on only by environment variables on the backend (Render → service → Environment).
Nothing goes into the mobile app. After saving the variables Render redeploys, and the start-up log says:

```
Receipt scanning: Gemini (gemini-3-flash-preview → gemini-3.5-flash → gemini-flash-lite-latest → gemini-3.1-flash-lite).
File storage: S3 bucket "intharoute-kyc-prod" (eu-west-2).
```

---

## 1. Gemini API key (Google AI Studio)

1. Open https://aistudio.google.com/apikey and sign in with the account that will own billing (ideally the client's / In tha Kitchen Ltd Google account).
2. **Create API key** → choose or create a Google Cloud project (e.g. `in-tha-route`).
3. **Turn on billing for that project** (AI Studio → Billing / "Set up billing").
   - Free-tier keys have low rate limits, and Google may use free-tier prompts to improve its products.
     Receipts contain customer names, phone numbers and addresses, so production must be on the paid tier.
4. Optional but recommended: in Google Cloud Console → APIs & Services → Credentials → the key →
   **API restrictions: Generative Language API only**.
5. In Render add:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | the key |

Do **not** set `GEMINI_MODEL` / `GEMINI_MODELS` unless you want to change the tested chain below.
If Render still has `GEMINI_MODEL=gemini-2.5-flash`, delete it (that model shuts down on 1 Dec 2026 and
answers 404 to new keys).

### How a scan stays fast (model chain)
Benchmarked on the client's 9 sample receipts (Nov 2026). All 9 were read correctly in **2.0–3.8 s**.

| Order | Model | Thinking | Typical time | Why |
|---|---|---|---|---|
| 1 | `gemini-3-flash-preview` | minimal | ~2.2 s | fastest accurate |
| 2 | `gemini-3.5-flash` | minimal | ~2.7 s | accurate, steady |
| 3 | `gemini-flash-lite-latest` | low | ~2.4 s (spiky) | cheap, different capacity pool |
| 4 | `gemini-3.1-flash-lite` | minimal | ~3 s (spiky) | last resort |

`gemini-3.8-flash` was left out: during the test it answered 503 "high demand" or timed out after 40 s.

- Model 1 starts at once. If it **fails** (503 busy, 429 quota, 404 retired, bad JSON) model 2 starts immediately.
- If it is just **slow**, model 2 starts after 3.5 s anyway and both race; the first good answer wins and the
  other request is cancelled.
- A bad API key stops at once (no point trying other models). A photo that is not a receipt is refused —
  the model must say `isReceipt`, so it can no longer invent a "John Doe" order from a blank photo.
- The whole scan gives up after 25 s with a clear message.

Cost is small: normally one request per receipt (a fraction of a penny); a second request only when the
first model is slow or failing.

> The free tier ran out of quota (429) during benchmarking with ~60 scans. **Billing must be on** for real use.

---

## 2. Amazon S3 bucket for KYC photos

Driving licences, NI numbers and bank details are sensitive personal data (UK GDPR), so the bucket is private,
encrypted and in London.

### 2.1 Create the bucket
AWS Console → S3 → **Create bucket**
- Name: `intharoute-kyc-prod` (must be globally unique; add a suffix if taken)
- Region: **Europe (London) eu-west-2**
- Object Ownership: **ACLs disabled**
- **Block all public access: ON** (all four boxes)
- Bucket Versioning: Enable (lets you recover an accidentally deleted photo)
- Default encryption: **SSE-S3**
- Create.

Optional: Management → Lifecycle rule → "Permanently delete noncurrent versions after 30 days", so replaced
photos do not stay forever.

### 2.2 Create a user that can only touch this bucket
IAM → Policies → **Create policy** → JSON (replace the bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "KycObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::intharoute-kyc-prod/*"
    },
    {
      "Sid": "KycBucketCheck",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::intharoute-kyc-prod"
    }
  ]
}
```

Name it `intharoute-backend-s3`. Then IAM → Users → **Create user** `intharoute-backend` (no console access)
→ attach that policy → open the user → Security credentials → **Create access key** → "Application running
outside AWS" → copy the key ID and secret (the secret is shown once).

### 2.3 Render environment

| Variable | Value |
|---|---|
| `S3_BUCKET` | `intharoute-kyc-prod` |
| `AWS_REGION` | `eu-west-2` |
| `AWS_ACCESS_KEY_ID` | from 2.2 |
| `AWS_SECRET_ACCESS_KEY` | from 2.2 |
| `S3_KEY_PREFIX` | optional, e.g. `production` (lets staging share the bucket under `staging`) |

Leave `S3_ENDPOINT` empty for Amazon S3 (it is only for S3-compatible services such as Cloudflare R2).

### 2.4 Move photos already in the database
Photos uploaded before S3 was set keep working from Postgres. To move them into the bucket and shrink the
database, run once with the production variables (Render Shell, or locally with the same env):

```
npm run files:to-s3
```

It is safe to run again; it only moves rows still stored in the database.

---

## 3. Amazon SES (emails: password reset, driver approved / rejected)

The backend does not send email yet; this prepares the account so the code can be added next.

1. AWS Console → top-right region **Europe (London) eu-west-2** → search **Amazon SES**.
2. **Configuration → Identities → Create identity → Domain** → `inthakitchen.com`
   - Tick **Easy DKIM** (RSA 2048) and "Publish DNS records to Route 53" only if the domain's DNS is in Route 53.
   - Custom MAIL FROM domain: `mail.inthakitchen.com` (improves deliverability).
3. SES shows **3 CNAME records (DKIM)** + MX/TXT for MAIL FROM. Add them where the domain's DNS lives
   (GoDaddy / Namecheap / Cloudflare / 123-reg…). Verification takes minutes to a few hours.
4. Add a DMARC TXT record if the domain has none: name `_dmarc`, value `v=DMARC1; p=none; rua=mailto:dmarc@inthakitchen.com`.
5. **Request production access** (Account dashboard → "Request production access"). New accounts are in the
   *sandbox* and can only email verified addresses. Use case to write: *transactional emails only — password
   resets and account status for restaurant staff and delivery drivers who signed up in our app; no marketing;
   bounces and complaints handled via SES notifications.* Approval usually takes ~24 h.
6. Give the backend user permission to send — add to the `intharoute-backend-s3` policy (or a new one):

```json
{
  "Sid": "SendEmail",
  "Effect": "Allow",
  "Action": ["ses:SendEmail", "ses:SendRawEmail"],
  "Resource": "*",
  "Condition": { "StringEquals": { "ses:FromAddress": "no-reply@inthakitchen.com" } }
}
```

Render variables (used once the email code is added): `SES_REGION=eu-west-2`, `EMAIL_FROM=no-reply@inthakitchen.com`.
The same `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are used.

---

## How it works (for developers)
- `backend/src/services/storage.service.js` — S3 client (put / get / delete), turned on by `S3_BUCKET`.
- `backend/src/services/file.service.js` — saves to S3 when enabled, otherwise to Postgres; reads either.
- Objects are stored as `kyc/<userId>/<fileId>.<ext>`, encrypted (SSE-S3), never public. The admin app still
  loads photos through the authenticated `GET /api/admin/kyc-documents/:id/file`, which streams from S3.
- Old photos are deleted from S3 after the database change commits (re-upload, driver rejected).
- Migration `005_file_storage.sql` adds `files.storage` and `files.object_key`.
- Tests: `backend/tests/files.test.js` runs the real AWS SDK against an in-memory fake S3.
