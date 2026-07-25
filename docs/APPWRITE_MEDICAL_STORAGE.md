# Appwrite Storage for private medical PDFs

The separated backend includes a storage adapter controlled by
`MEDICAL_STORAGE_DRIVER`.

- Development default: `local`
- Production default: `appwrite`

The original local application and files remain unchanged.

## Appwrite bucket

Create the bucket manually in a staging Appwrite project before enabling the
adapter:

- Bucket ID: enter as `APPWRITE_MEDICAL_BUCKET_ID`
- Public permissions: none
- Maximum file size: 10 MiB
- Allowed extension: `pdf`
- Encryption: enabled
- File security: enabled

The server API key requires only the Storage scopes needed to create, read, and
delete files in this bucket. Never expose it to the browser.

## Adapter behavior

- Multer keeps at most one validated 10 MiB upload in memory.
- The route checks MIME type and the `%PDF-` signature.
- Production uploads use Appwrite Storage's server REST API.
- MongoDB continues storing metadata and an opaque
  `appwrite://<bucket>/<file-id>` reference in the existing `filePath` field.
- New uploads store a SHA-256 checksum in the production backend's compatible
  metadata model; downloads verify it before sending the PDF.
- Downloads pass through the authenticated Express patient route; files are not
  public.
- If MongoDB metadata creation fails, the adapter removes the just-uploaded
  Appwrite file.
- Existing local references remain readable in development and rollback mode.

## Required environment names

- `MEDICAL_STORAGE_DRIVER=appwrite`
- `APPWRITE_ENDPOINT`
- `APPWRITE_PROJECT_ID`
- `APPWRITE_API_KEY`
- `APPWRITE_MEDICAL_BUCKET_ID`

No Appwrite resource or real medical file is created by this repository change.
Before production use, test upload, download, checksum equality, unauthorized
access, cleanup on failure, and key-scope restrictions in staging.
