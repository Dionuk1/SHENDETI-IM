# Appwrite permissions model

All Phase 3 tables and the medical bucket are deny-by-default. Empty table-level and bucket-level permission lists are intentional.

- Clinical tables have no public permissions and no broad patient/doctor table access.
- `clinical-api` will later perform sensitive clinical writes and cross-user reads after resource-specific checks.
- `admin-api` will later perform account and operational administration without automatic medical-content access.
- `ai-triage` will keep Gemini and future AI processing server-side.
- Function execution permissions are empty in Phase 3; authenticated Console/CLI administration is used for controlled validation.
- Functions have no generated API scopes or secret variables in Phase 3.
- Notification rows may later receive owner-specific row permissions. The table does not receive broad read access.
- The full `doctor_profiles` table is private because it contains email/license/operational fields. Public doctor data requires a reviewed safe projection or Function. No extra public table is created in Phase 3.
- Audit logs are server-only for create and read.
- Medical files are private, file security is enabled, and future access is Function-mediated.
- An admin label does not imply permission to read clinical content.
- Functions must still validate patient ownership, assigned-doctor relationships, appointment state, and requested action.
