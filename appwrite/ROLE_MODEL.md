# Appwrite role model

The future trusted labels are `patient`, `doctor`, and `admin`. No real or demo user is created in Phase 3, so no label is assigned yet.

- Labels are trusted, server-managed authorization data.
- A role copied into a frontend profile is display data and is not authoritative.
- The default public registration role will be patient and must be assigned by secure server logic.
- The doctor label requires a matching `doctor_profiles` row whose `authUserId` identifies the same Appwrite Auth user.
- The admin label may be assigned only through secure administration with an audit record.
- No client can assign, remove, or update its own labels.
- Every role change must be authenticated, authorized, validated, and audited.
- Administrator status does not automatically grant access to prescriptions, medical files, encrypted clinical fields, or other medical content.
- Functions must enforce resource-specific authorization in addition to checking labels.
