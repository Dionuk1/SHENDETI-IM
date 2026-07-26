# SHËNDETI IM — Controlled Appwrite backend migration plan

Status: design only. No Appwrite resources or production data have been created,
changed, exported, or migrated.

## 1. Safety boundary

- The current Express, MongoDB, JWT, AES, and local-upload implementation remains
  intact as the rollback system.
- The first target must be a separate staging Appwrite project populated only
  with synthetic test data.
- MongoDB, local uploads, and `MEDICAL_AES_KEY` must not be deleted or rotated
  during migration.
- API keys, OAuth secrets, database credentials, patient data, mapping files,
  inventories, dumps, and checksums containing identifiers must remain untracked.
- Cutover is a separate, explicitly approved operation after reconciliation and
  acceptance testing.

## 2. Existing system map

### MongoDB collections

| Mongoose model | MongoDB collection | Important relationships |
| --- | --- | --- |
| `User` | `users` | Identity for patient, doctor, or admin |
| `Doctor` | `doctors` | Profile used by appointments; email correlates it to a doctor `User` |
| `Appointment` | `appointments` | `patientId -> users`, `doctorId -> doctors` |
| `Prescription` | `prescriptions` | `patientId -> users`, `doctorId -> users`, optional `appointmentId -> appointments` |
| `MedicalRecord` | `medicalrecords` | `patientId -> users`; `filePath` points to local disk |
| `Notification` | `notifications` | `userId -> users`; optional polymorphic `resourceType/resourceId` |
| `AuditLog` | `auditlogs` | optional `userId -> users`; polymorphic `resourceType/resourceId` |

There is no separate patient model. A patient is a `User` with
`role = "patient"`.

### Existing authentication and authorization

- Registration creates only patient users, hashes passwords with bcrypt cost 12,
  and returns a seven-day JWT.
- Public password login rejects admin accounts. Admin login uses a separate
  endpoint and requires the stored `admin` role.
- `requireAuth` verifies the JWT, reloads the user from MongoDB, and rejects
  inactive users.
- `requireRole` authorizes `patient`, `doctor`, and `admin`.
- The reset command and protected admin reset endpoint replace bcrypt password
  hashes. There is no public forgot-password email workflow.
- Google Identity Services sends an ID token to `/api/auth/google`. Express
  validates its audience and verified email, links by Google subject or email,
  rejects disabled/admin users, and then issues the same application JWT.

### Encryption

`MEDICAL_AES_KEY` is used with AES-256-GCM for:

- `prescriptions.bodyEncrypted.{iv,tag,ciphertext}`. The plaintext is a JSON
  object containing diagnosis, medication, dosage, frequency, duration,
  instructions, and notes.
- `medicalrecords.notesEncrypted.{iv,tag,ciphertext}`.

The PDF bytes themselves are not encrypted by the application. They are stored
under `uploads/medical-records`. Appwrite Storage encryption should be enabled,
but the existing AES key must still be retained for legacy encrypted fields.

### Medical-file flow

- `POST /api/patient/records/upload` accepts one PDF through Multer.
- Maximum size is 10 MiB; MIME type and `%PDF-` signature are checked.
- The generated local path is stored in `MedicalRecord.filePath`.
- `GET /api/patient/records/:id/download` verifies ownership and that the
  resolved path remains under the medical uploads directory.
- Existing local files must be copied, verified, and retained during migration.

### Affected API surface

Every protected route is affected because JWT identity becomes an Appwrite
session. Data-backed route groups affected are:

- `/api/auth/*`
- `/api/appointments/*`
- `/api/patient/*`
- `/api/patients/*`
- `/api/doctor/*`
- `/api/doctors/*`
- `/api/admin/*`
- `/api/notifications/*`
- `/api/ai/*` where authenticated context or MongoDB retrieval is used
- `/api/public/doctors` and `/api/doctors/list`

The frontend contains both same-origin `/api/...` calls and hardcoded
`http://localhost:5500/api/...` calls. All must eventually use one configuration
helper; no secret is required in frontend configuration.

## 3. Target Appwrite architecture

- **Auth:** Appwrite email/password sessions and Google OAuth2.
- **Databases:** one database with normalized tables below.
- **Storage:** one private `medical-pdfs` bucket.
- **Functions:** trusted commands, cross-user access, role assignment, medical
  operations, audit creation, appointment slot locking, AI calls, and migration.
- **Sites:** static frontend at `https://shendeti-im.me`.
- **Rollback:** existing Express/MongoDB application kept deployable until final
  cutover acceptance.

Direct client reads should be limited to data that a user is explicitly allowed
to see. All privileged writes and all access involving another patient's data
must pass through Functions.

## 4. Proposed Appwrite database schema

Database ID: `shendeti_im`

Use deterministic Appwrite IDs where a valid MongoDB ObjectId fits Appwrite's ID
rules. Keep `legacyMongoId` on every migrated row regardless, so reconciliation
never depends on an implementation assumption. Auth user IDs should be generated
or deterministically mapped and recorded in the private migration map.

### `profiles`

One row per Appwrite Auth user.

| Column | Type | Required |
| --- | --- | --- |
| `authUserId` | string(36) | yes, unique |
| `legacyMongoId` | string(24) | no, unique |
| `name` | string(128) | yes |
| `emailNormalized` | string(255) | yes, unique |
| `role` | enum: patient, doctor, admin | yes |
| `authProviderLegacy` | enum: local, google | no |
| `profileImage` | string(2048) | no |
| `isActive` | boolean | yes |
| `createdAtLegacy` | datetime | no |
| `updatedAtLegacy` | datetime | no |

Indexes: unique `authUserId`, unique `legacyMongoId`, unique
`emailNormalized`, key `role`, key `(role,isActive)`.

Role is server-managed. A client must never be permitted to update its own role
or active status.

### `doctor_profiles`

| Column | Type | Required |
| --- | --- | --- |
| `profileId` | relationship -> profiles, one-to-one, restrict | yes |
| `legacyDoctorId` | string(24) | no, unique |
| `specialization` | enum matching current model | yes |
| `department` | string(120) | yes |
| `experience` | integer | yes |
| `licenseNumber` | string | no, unique |
| `isActive` | boolean | yes |
| `weekdayStart`, `weekdayEnd` | string(5) | yes |
| `saturdayStart`, `saturdayEnd` | string(5) | yes |
| `sundayOff` | boolean | yes |
| `maxPatientsPerDay` | integer | yes |
| `avgRating` | float | yes |
| `totalPatients` | integer | yes |
| `bio` | string(500) | no |
| `createdAtLegacy`, `updatedAtLegacy` | datetime | no |

Indexes: unique `profileId`, unique `legacyDoctorId`, unique sparse-equivalent
`licenseNumber` enforced by the write Function, key
`(specialization,isActive)`.

### `doctor_services`

| Column | Type | Required |
| --- | --- | --- |
| `doctorProfileId` | relationship -> doctor_profiles, many-to-one, cascade | yes |
| `name` | string(120) | yes |
| `durationMinutes` | integer | yes |
| `available` | boolean | yes |
| `sortOrder` | integer | yes |

Indexes: key `(doctorProfileId,available)`. The write Function enforces unique
service name per doctor.

### `appointments`

| Column | Type | Required |
| --- | --- | --- |
| `legacyMongoId` | string(24) | no, unique |
| `patientProfileId` | relationship -> profiles, many-to-one, restrict | yes |
| `doctorProfileId` | relationship -> doctor_profiles, many-to-one, restrict | yes |
| `service` | string(120) | yes |
| `scheduledAt` | datetime | yes |
| `durationMinutes` | integer | yes |
| `status` | enum: pending, confirmed, cancelled, completed | yes |
| `notes` | string(5000) | no |
| `cancelledByProfileId` | relationship -> profiles, many-to-one, set-null | no |
| `cancelledByRole` | enum: patient, doctor, admin | no |
| `cancelledAt` | datetime | no |
| `cancellationReason` | string(300) | no |
| `activeSlotKey` | string | no |
| `createdAtLegacy`, `updatedAtLegacy` | datetime | no |

Indexes: unique `legacyMongoId`; unique active-slot behavior must be enforced by
an appointment Function because conditional/sparse uniqueness is required; key
`(patientProfileId,scheduledAt)`, `(doctorProfileId,scheduledAt)`,
`(doctorProfileId,status,scheduledAt)`, and `(status,scheduledAt)`.

### `appointment_status_events`

New append-only history required to preserve future state changes.

| Column | Type | Required |
| --- | --- | --- |
| `appointmentId` | relationship -> appointments, many-to-one, restrict | yes |
| `fromStatus` | appointment status enum | no |
| `toStatus` | appointment status enum | yes |
| `actorProfileId` | relationship -> profiles, many-to-one, set-null | no |
| `actorRole` | enum: patient, doctor, admin, system | yes |
| `reason` | string(300) | no |
| `occurredAt` | datetime | yes |
| `source` | enum: legacy_snapshot, appwrite | yes |

Indexes: key `(appointmentId,occurredAt)`. Existing MongoDB contains only the
current state and cancellation metadata, so migration can create a
`legacy_snapshot` event but must not invent unavailable history.

### `prescriptions`

| Column | Type | Required |
| --- | --- | --- |
| `legacyMongoId` | string(24) | no, unique |
| `patientProfileId` | relationship -> profiles, many-to-one, restrict | yes |
| `doctorProfileId` | relationship -> profiles, many-to-one, restrict | yes |
| `appointmentId` | relationship -> appointments, many-to-one, set-null | no |
| `title` | string(200) | yes |
| `encryptedIv` | string | yes |
| `encryptedTag` | string | yes |
| `encryptedCiphertext` | string | yes |
| `encryptionVersion` | enum: legacy_aes256_gcm_v1 | yes |
| `status` | enum: active, completed, cancelled | yes |
| `createdAtLegacy`, `updatedAtLegacy` | datetime | no |

Indexes: unique `legacyMongoId`, key `(patientProfileId,createdAtLegacy)`,
`(doctorProfileId,createdAtLegacy)`, `appointmentId`, and `status`.

### `medical_records`

| Column | Type | Required |
| --- | --- | --- |
| `legacyMongoId` | string(24) | no, unique |
| `patientProfileId` | relationship -> profiles, many-to-one, restrict | yes |
| `uploadedByProfileId` | relationship -> profiles, many-to-one, set-null | yes |
| `storageBucketId` | string | yes |
| `storageFileId` | string | yes, unique |
| `legacyRelativePath` | string | no |
| `originalName` | string(255) | yes |
| `mimeType` | string(120) | yes |
| `sizeBytes` | integer | yes |
| `sha256` | string(64) | yes |
| `notesEncryptedIv`, `notesEncryptedTag`, `notesEncryptedCiphertext` | string | no |
| `encryptionVersion` | enum: legacy_aes256_gcm_v1 | no |
| `createdAtLegacy`, `updatedAtLegacy` | datetime | no |

Indexes: unique `legacyMongoId`, unique `storageFileId`,
`(patientProfileId,createdAtLegacy)`, `uploadedByProfileId`.

`legacyRelativePath` must never expose an absolute workstation path.

### `notifications`

| Column | Type | Required |
| --- | --- | --- |
| `legacyMongoId` | string(24) | no, unique |
| `recipientProfileId` | relationship -> profiles, many-to-one, cascade | yes |
| `message` | string(240) | yes |
| `type` | current notification enum | yes |
| `resourceType`, `resourceId` | string | no |
| `read` | boolean | yes |
| `readAt` | datetime | no |
| `createdAtLegacy`, `updatedAtLegacy` | datetime | no |

Indexes: unique `legacyMongoId`,
`(recipientProfileId,read,createdAtLegacy)`, `(recipientProfileId,createdAtLegacy)`.

### `audit_logs`

Append-only.

| Column | Type | Required |
| --- | --- | --- |
| `legacyMongoId` | string(24) | no, unique |
| `actorProfileId` | relationship -> profiles, many-to-one, set-null | no |
| `role` | enum: patient, doctor, admin, anonymous, system | yes |
| `action` | string(100) | yes |
| `resourceType`, `resourceId` | string | no |
| `status` | enum: success, failure | yes |
| `ipAddress` | string(100) | no |
| `metadataJson` | string | no |
| `occurredAt` | datetime | yes |

Indexes: unique `legacyMongoId`, key `(occurredAt)`,
`(actorProfileId,occurredAt)`, `(action,occurredAt)`,
`(status,occurredAt)`. Metadata must be filtered for secrets and clinical
content before insertion.

## 5. Permission and role model

Appwrite resources have no access when permissions are empty. Keep table and
bucket defaults private and grant only explicit row/file permissions.

### Role source

- Appwrite user labels: exactly one of `role_patient`, `role_doctor`,
  `role_admin`.
- Labels are assigned only by a migration/admin Function using the Server SDK.
- The `profiles.role` row is a queryable mirror, not the authorization source.
- Every Function compares the authenticated Appwrite user ID, current label,
  active profile, and target resource ownership.

### Minimum row/file access

- Profile: user may read own safe profile; changes to role, email mirror, and
  active status are server-only.
- Doctor public directory: expose only an explicitly sanitized projection through
  a public Function. Never make the full doctor profile row public.
- Appointment: patient and assigned doctor may read; changes pass through a
  Function; admins through admin Function.
- Prescription: patient and authoring doctor may read; creation/decryption
  passes through a Function; admins receive no default clinical read permission.
- Medical record row/file: patient owner only by default. Doctor access requires
  an explicit active care relationship and a server-side decision; do not grant
  all doctors blanket access.
- Notification: recipient only.
- Audit log: no client permission. Security/admin reporting only through a
  restricted Function with redacted output.
- Status event: same read scope as its appointment; append only through Function.

## 6. Appwrite Auth migration

### Email/password

- New public registration calls Appwrite Account API, then a post-registration
  Function creates the patient profile and applies `role_patient`.
- Existing bcrypt users can be imported with Appwrite's server-side
  `createBcryptUser`; the migration never needs plaintext passwords.
- Google-only legacy users are created without a local password and complete
  Google OAuth account linking during staged activation.
- Disabled legacy users must be created blocked or omitted until reviewed.

### Sessions

- Replace JWT stored by the application with Appwrite sessions.
- The frontend keeps a single Appwrite Client/Account instance, uses
  `account.get()` for guards, and `deleteSession("current")` for logout.
- Functions use authenticated invocation context. They verify
  `x-appwrite-user-id`; when user-scoped SDK access is needed they use the
  automatically provided user JWT, not a frontend API key.
- Existing JWT endpoints remain operational during dual-run and are removed only
  after acceptance and a separately approved cutover.

### Account linking

- Normalize email to lowercase.
- Never auto-link an unverified address.
- If an existing email/password Appwrite account has the same verified Google
  address, require the user to authenticate the existing account first and then
  add/link the Google identity.
- If an email already maps to another Google identity, stop and require manual
  account recovery.
- Admin users do not use Google login unless a later security review explicitly
  enables it.

### Google OAuth2 Console steps

1. In Appwrite Console open **Auth > Settings > OAuth2 > Google**.
2. Enable Google and enter the Google Web client ID and client secret only in
   Appwrite Console.
3. Copy the exact Appwrite redirect URI displayed in that modal.
4. In Google Cloud Console open the OAuth Web client and add that exact URI to
   **Authorized redirect URIs**.
5. Add `https://shendeti-im.me` as the production web platform/domain in
   Appwrite and to the Google OAuth consent-screen authorized domains as required.
6. Use `https://shendeti-im.me/auth/callback` as the Appwrite OAuth success URL
   and `https://shendeti-im.me/login?oauth=failed` as the failure URL.
7. Add equivalent staging URLs before testing; never use production callbacks
   for staging.
8. The frontend initiates `account.createOAuth2Session` with provider Google.

The Google redirect URI is not guessed in source: Appwrite generates it and the
operator copies it verbatim from the provider settings modal.

## 7. Storage design

Bucket ID: `medical-pdfs`

- Private by default; no `Role.any()` permission.
- Maximum 10 MiB.
- Allowed extension: `pdf`.
- Enable Appwrite Storage encryption.
- File security enabled, with explicit per-file permissions.
- No public read tokens and no public preview URLs.

Upload is a Function command:

1. Verify Appwrite session, active profile, role, and target patient.
2. Enforce size, MIME type, PDF signature, and safe filename.
3. Upload to the private bucket with owner read permission.
4. Create `medical_records` metadata with SHA-256 and matching permissions.
5. Write audit and notification rows without clinical content.
6. If metadata creation fails, remove the just-uploaded file.

Download/list/delete similarly verify ownership or an explicit care relationship.
Deletion should initially be soft/administrative; migration never deletes the
legacy file.

## 8. One-time migration tool design

Proposed future files, not implemented in this design phase:

```text
scripts/appwrite-migration/
  migrate.js
  lib/appwrite.js
  lib/mongo.js
  lib/id-map.js
  lib/checksums.js
  lib/report.js
  README.md
```

Required environment names:

```text
APPWRITE_ENDPOINT
APPWRITE_PROJECT_ID
APPWRITE_API_KEY
APPWRITE_DATABASE_ID
APPWRITE_MEDICAL_BUCKET_ID
MONGODB_URI
MIGRATION_STATE_DIR
MIGRATION_MODE
```

`APPWRITE_API_KEY`, `MONGODB_URI`, and state files are never committed.

Behavior:

- Default mode is `dry-run`; real writes require both `--apply` and
  `MIGRATION_MODE=staging`.
- Refuse a production project unless a later explicit production flag and
  approval are present.
- Read MongoDB with a consistent snapshot window and deterministic ordering.
- Import auth users, then profiles/doctors, then dependent clinical data, files,
  notifications, and audit logs.
- Preserve bcrypt hashes with Appwrite's bcrypt-user import endpoint.
- Maintain a private versioned ID map outside the repository.
- Record a checkpoint after each successful item; use idempotency keys and query
  legacy IDs to skip already migrated rows.
- Log model name, opaque source ID hash, target ID, status, and error category,
  never names, emails, prescriptions, notes, filenames, or tokens.
- Hash every source PDF with SHA-256 and verify the uploaded download hash.
- Produce counts and aggregate checksums per collection/table.
- Exit non-zero on missing relationships, duplicate identities, checksum
  mismatch, inaccessible file, or permission verification failure.

## 9. Backup, restore, and rollback

### Before staging and production migration

1. Stop writes or record an exact migration watermark.
2. Create an encrypted MongoDB backup outside the repository:

   ```powershell
   mongodump --uri "<MONGODB_URI>" --archive="<SECURE_BACKUP_PATH>" --gzip
   ```

3. Verify the archive by restoring into an isolated verification database:

   ```powershell
   mongorestore --uri "<VERIFICATION_MONGODB_URI>" --archive="<SECURE_BACKUP_PATH>" --gzip --drop
   ```

4. Compare collection counts and selected aggregate checksums.
5. Create a private medical-file inventory containing relative path, size, and
   SHA-256; verify every database path has exactly one readable file.
6. Securely escrow the existing `MEDICAL_AES_KEY` separately from the backup and
   test decryption with synthetic/approved fixtures.

### Rollback

- Before cutover: no rollback action is needed because production remains on
  Express/MongoDB.
- During a dual-write phase: stop Appwrite writes, reconcile writes after the
  watermark, and route traffic back to Express/MongoDB.
- After cutover: retain MongoDB and local files read-only for the approved
  retention period. Restore from the verified archive only into a new database,
  validate it, then switch connection configuration.
- Recover Appwrite Auth, Database, and Storage as three separate scopes. A
  database backup alone does not restore identities or PDFs.

## 10. Staging acceptance tests

- Registration, email/password login, logout, expiration, and recovery.
- Google OAuth2 new account, verified-email linking, collision, and failure.
- Patient, doctor, admin, disabled-user, wrong-role, and unauthenticated paths.
- Doctor directory, availability, slot locking, booking, state changes,
  cancellation, and concurrent double-booking attempts.
- Prescription create/list/detail/decrypt and unauthorized cross-patient access.
- PDF validation, upload, list, download, checksum, delete policy, and forbidden
  access.
- Notifications and immutable/redacted audit events.
- AI endpoints with authenticated context and without exposed provider key.
- Mobile and desktop frontend, including session persistence and callback URLs.
- Count and checksum reconciliation for every source collection and file set.

No production cutover is allowed with failed authorization tests, unmatched
records/files, checksum differences, or unresolved duplicate identities.

## 11. Implementation phases and approval gates

1. **Design approval:** approve this schema, permission model, and rollback plan.
2. **Staging infrastructure:** create an empty staging Appwrite project.
3. **Adapter implementation:** add Appwrite clients/Functions behind feature
   flags; preserve MongoDB/JWT paths.
4. **Migration tool:** implement and test dry-run with synthetic fixtures.
5. **Staging migration:** migrate synthetic/test data and run acceptance tests.
6. **Rehearsal:** approved sanitized copy, timing, reconciliation, and rollback
   drill.
7. **Production migration:** separate explicit approval, backup, controlled
   cutover, and monitoring.
8. **Legacy retirement:** separate retention/security approval; never part of
   initial migration.

## 12. Principal risks

- Duplicate doctor identity because current `users` and `doctors` are separate.
- Loss of password access if bcrypt hashes are not imported correctly.
- Unsafe automatic linking of Google identities by unverified email.
- Broken clinical relationships from ID conversion.
- Loss of encrypted content if `MEDICAL_AES_KEY` is changed or missing.
- Missing PDFs or leaked files from incorrect bucket/file permissions.
- Double booking if conditional active-slot uniqueness is not enforced
  transactionally by one trusted command.
- Authorization weakening if role mirrors are trusted instead of server-managed
  labels and ownership checks.
- Incomplete rollback if Auth, rows, and files are treated as one backup scope.
