# MongoDB Atlas setup and controlled data transfer

The first separated production deployment keeps MongoDB. It does not migrate
application data to Appwrite Databases.

## Atlas preparation

1. Create a staging Atlas project and cluster in the required region.
2. Under **Database Access**, create a dedicated application database user with
   only the privileges required for the SHËNDETI IM database.
3. Under **Network Access**, allow only the source/Render egress addresses that
   are actually required. Avoid `0.0.0.0/0` for production where a narrower
   allowlist is available.
4. Obtain the SRV connection string and set it as `MONGODB_URI` in Render.
5. Never commit the connection string or paste it into logs.

The backend refuses to start in production when `MONGODB_URI` is missing.
Local development can continue using `MONGO_URI` or the verified local default.

## Backup

Run outside the repository and use a protected path:

```powershell
mongodump --uri "<LOCAL_MONGODB_URI>" --archive="<SECURE_BACKUP_PATH>" --gzip
```

Record collection counts before backup:

```powershell
node scripts/migration/collection-counts.js --source --confirm-read
```

Do not place the archive or reports in this repository.

## Test restore

Restore first into an isolated test cluster/database:

```powershell
mongorestore --uri "<TEST_ATLAS_URI>" --archive="<SECURE_BACKUP_PATH>" --gzip --drop
```

Set `MONGODB_URI` temporarily to the test target and run:

```powershell
node scripts/migration/collection-counts.js --target --confirm-read
```

Compare counts for `users`, `doctors`, `appointments`, `prescriptions`,
`medicalrecords`, `notifications`, and `auditlogs`. Count equality is necessary
but not sufficient; run application integration tests and relationship checks.

## Production restore

1. Schedule a maintenance window and stop writes.
2. Create and verify a fresh backup.
3. Restore to the production Atlas target without printing credentials.
4. Compare counts and relationship integrity.
5. Confirm encrypted prescription and medical-note fixtures decrypt with the
   unchanged `MEDICAL_AES_KEY`.
6. Configure Render `MONGODB_URI`.
7. Test the Render service before switching frontend traffic.

## Rollback

- Keep the local MongoDB and backup unchanged.
- If validation fails, stop the Render service and leave the frontend on the
  existing deployment.
- Restore only into a new verification database; validate before changing an
  application connection string.
- MongoDB rollback does not restore Auth or medical PDFs. Treat them as separate
  recovery scopes.
