# SHENDETI IM Appwrite development infrastructure

## Target

- Project: `SHENDETI-IM-DEV`
- Project ID: `6a66216909c3398b7265`
- Organization ID: `69ba051fc0077da6cc5e`
- Region: Frankfurt (`fra`)
- Endpoint: `https://fra.cloud.appwrite.io/v1`
- Environment: development only

Never point this configuration at a production project. Before every push, verify `projectName`, `projectId`, and `endpoint` in `appwrite.config.json`, then confirm the remote project name with a read-only CLI request.

## Resource inventory

- TablesDB database: `shendeti`
- Tables: `profiles`, `doctor_profiles`, `appointments`, `prescriptions`, `medical_records`, `notifications`, `audit_logs`
- Storage bucket: `medical-pdfs`
- Functions: `clinical-api`, `admin-api`, `ai-triage`
- Static Site: `shendeti-im-dev-site`, sourced from `domain-hosting/`

The Functions contain health responses only. They have no Appwrite scopes, variables, database access, Auth operations, Gemini integration, MongoDB integration, or clinical behavior.

## Configuration structure

CLI 23.1.0 supports multi-file configuration. The root `appwrite.config.json` contains project identifiers and `includes`. Resource arrays are under `appwrite/resources/`; Function code is under `appwrite/functions/`. Paths are relative to the include files.

Safe tracked files contain identifiers, schemas, permissions, and non-sensitive source code. CLI session state, `.env` files other than `.env.example`, API keys, tokens, MongoDB URIs, Gemini/JWT/AES secrets, passwords, exports, medical data, and deployment artifacts must remain ignored and untracked.

## Validation and controlled recreation

Read-only validation uses CLI list/get commands for the selected development project. `appwrite pull` can compare remote resources, but it may rewrite configuration; review and back up the local IaC before pulling. A dry infrastructure review consists of comparing the tracked resource arrays with sanitized remote list/get output and running `git diff --check`; do not push merely to test a diff.

To recreate in another development project, create and confirm a separate non-production project, update only its non-secret identifiers, validate the endpoint/region, then push tables, buckets, Functions, and Sites in that order. Every push is a remote write and requires the approved phase scope.

## Current limitations

- No users, labels, rows, or files are created or migrated.
- Nullable unique indexes for `doctor_profiles.licenseNumber` and `appointments.activeSlotKey` are deferred pending an owner-approved compatibility decision.
- The full doctor table is not public; a future projection or Function is required.
- The Site remains dependent on the existing Render REST backend and JWT authentication.
- No custom domain, DNS, VCS connection, automatic deployment, messaging, or Realtime is configured.
- MongoDB remains authoritative and Render remains operational.
- Existing frontend and backend source behavior is unchanged.
