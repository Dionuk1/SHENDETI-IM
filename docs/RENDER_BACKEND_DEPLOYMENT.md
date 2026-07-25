# Render deployment for the SHËNDETI IM API

The production backend is a Render **Web Service**. The frontend is deployed
separately from `domain-hosting/`.

## Verified settings

| Setting | Value |
| --- | --- |
| Repository | current SHËNDETI IM GitHub repository |
| Branch | an approved production branch; do not use the migration branch before review |
| Root Directory | `backend` |
| Runtime | Node |
| Node version | `22.x` from `backend/package.json` |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Auto-deploy | off until production separation is reviewed and merged |

`GET /health` returns only status, timestamp, and whether MongoDB is connected.
It never returns credentials, database names, paths, versions, or patient data.

## Create the service

1. In Render choose **New > Web Service** and connect the repository.
2. Enter the verified settings above, or create a Blueprint from the root
   `render.yaml`.
3. Add secret values in **Environment** in the Render Dashboard. Never put them
   in Git or `render.yaml`.
4. Deploy first from an approved staging branch.
5. Open **Logs** for build/runtime output and verify `/health` before testing
   application routes.

## Environment variables

Required:

- `NODE_ENV=production`
- `MONGODB_URI`
- `JWT_SECRET`
- `MEDICAL_AES_KEY` — use the current key; do not rotate during migration
- `FRONTEND_URL=https://shendeti-im.me`
- `ALLOWED_ORIGINS=https://shendeti-im.me,<exact-appwrite-preview-origin>`
- `MEDICAL_STORAGE_DRIVER=appwrite`
- `APPWRITE_ENDPOINT`
- `APPWRITE_PROJECT_ID`
- `APPWRITE_API_KEY`
- `APPWRITE_MEDICAL_BUCKET_ID`

Optional:

- `GOOGLE_CLIENT_ID` — enables the existing Google ID-token login
- `GEMINI_API_KEY`
- `GEMINI_MODEL=auto`
- `MAX_REQUESTS_PER_MINUTE`
- `MAX_FAILED_LOGINS`
- `BAN_DURATION_MINUTES`
- `ADMIN_IPS`

`PORT` is provided by Render. The API listens on `0.0.0.0` and uses
`process.env.PORT || 5500`.

## Deploys and rollback

With auto-deploy disabled, use **Manual Deploy** after each explicit approval.
Render keeps previous deploys. To roll back, select a previously successful
deploy and choose **Rollback**. A Render code rollback does not roll back
MongoDB, Appwrite Storage, DNS, or environment changes; those recovery scopes
must be handled separately.

## Custom API domain

After the service is healthy:

1. Add `api.shendeti-im.me` under the Render service's **Custom Domains**.
2. Render will display the exact DNS target.
3. In the DNS provider used for `shendeti-im.me`, create:
   - Type: `CNAME`
   - Name: `api`
   - Value: the exact Render-provided hostname
4. Do not invent the hostname or change DNS before Render displays it.
5. Wait for Render to verify the domain and issue TLS.
