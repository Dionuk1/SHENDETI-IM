import { ID, Permission, Query, Role } from 'node-appwrite';

export const DATABASE_ID = 'shendeti';
export const MEDICAL_BUCKET_ID = 'medical-pdfs';
export const TABLE = Object.freeze({
  profiles: 'profiles', doctors: 'doctor_profiles', appointments: 'appointments', prescriptions: 'prescriptions',
  records: 'medical_records', notifications: 'notifications', audit: 'audit_logs'
});
export const OPERATIONS = new Set([
  'health', 'listUsers', 'getUserSummary', 'createUser', 'updateUser', 'changeUserRole', 'updateUserPassword', 'deleteUser', 'setProfileActive', 'listDoctors', 'getDoctorDetails', 'setDoctorActive',
  'listAppointments', 'approveAppointment', 'cancelAppointment', 'getClinicalMetadataCounts', 'listNotifications', 'listAuditLogs', 'getAnalytics'
]);
export const MUTATIONS = new Set(['createUser', 'updateUser', 'changeUserRole', 'updateUserPassword', 'deleteUser', 'setProfileActive', 'setDoctorActive', 'approveAppointment', 'cancelAppointment']);
const ROLES = new Set(['patient', 'doctor', 'admin']);
const STATUSES = new Set(['pending', 'confirmed', 'completed', 'cancelled']);

export class AdminError extends Error {
  constructor(category, message, status = 400) { super(message); this.name = 'AdminError'; this.category = category; this.status = status; }
}

export function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new AdminError('invalid_input', 'Invalid request body.');
  }
  if (Object.keys(value).some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))) {
    throw new AdminError('invalid_input', 'Invalid request body.');
  }
  return value;
}

export function keys(value, allowed, required = []) {
  plain(value); const permitted = new Set(allowed);
  if (Object.keys(value).some((key) => !permitted.has(key))) throw new AdminError('invalid_input', 'Unexpected request field.');
  if (required.some((key) => value[key] === undefined || value[key] === null || value[key] === '')) throw new AdminError('invalid_input', 'Missing required field.');
}

export function text(value, name, max = 120, min = 0) {
  const result = String(value ?? '').trim();
  if (result.length < min || result.length > max) throw new AdminError('invalid_input', `Invalid ${name}.`);
  return result;
}

export function id(value, name = 'id') {
  const result = text(value, name, 36, 1);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(result)) throw new AdminError('invalid_input', `Invalid ${name}.`);
  return result;
}

function email(value) {
  const normalized = text(value, 'email', 255, 3).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new AdminError('invalid_input', 'Invalid email.');
  return normalized;
}

function password(value) {
  const raw = String(value ?? '');
  if (raw.length < 12 || raw.length > 128 || !/[a-z]/.test(raw) || !/[A-Z]/.test(raw) || !/[0-9]/.test(raw) || !/[^A-Za-z0-9]/.test(raw) || /\s/.test(raw)) {
    throw new AdminError('invalid_input', 'Password does not meet security requirements.');
  }
  return raw;
}

function replacementPassword(value) {
  const raw = String(value ?? '');
  if (raw.length < 10 || raw.length > 128 || raw !== raw.trim() || !/[a-z]/.test(raw) || !/[A-Z]/.test(raw) || !/[0-9]/.test(raw) || !/[^A-Za-z0-9]/.test(raw)) {
    throw new AdminError('invalid_input', 'Password does not meet security requirements.');
  }
  return raw;
}

function devAdminPassword(value, account, profile) {
  const raw = String(value ?? '');
  const normalized = raw.toLowerCase();
  const blocked = new Set(['password', '12345678', 'qwerty123']);
  if (raw.length < 8 || raw.length > 128 || raw !== raw.trim() || !/[A-Za-z]/.test(raw) || !/[0-9]/.test(raw) || blocked.has(normalized)
      || normalized === String(account?.email || '').trim().toLowerCase() || normalized === String(profile?.name || account?.name || '').trim().toLowerCase()) {
    throw new AdminError('invalid_input', 'Password does not meet DEV test requirements.');
  }
  return raw;
}

function integer(value, name, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new AdminError('invalid_input', `Invalid ${name}.`);
  return number;
}

function time(value, name) {
  const result = text(value, name, 5, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new AdminError('invalid_input', `Invalid ${name}.`);
  return result;
}

export function pageInput(input) {
  const page = input.page === undefined ? 1 : Number(input.page);
  const limit = input.limit === undefined ? 25 : Number(input.limit);
  if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new AdminError('invalid_input', 'Invalid pagination.');
  }
  return { page, limit, offset: (page - 1) * limit };
}

export function exactRole(labels) {
  const normalized = (labels || []).map((label) => String(label).trim().toLowerCase());
  const roles = normalized.filter((label) => ROLES.has(label));
  if (roles.length !== 1) throw new AdminError('forbidden', 'Account role is not authorized.', 403);
  return roles[0];
}

async function list(tables, tableId, queries = []) {
  const result = await tables.listRows({ databaseId: DATABASE_ID, tableId, queries });
  return { rows: result.rows || [], total: Number(result.total) || 0 };
}

async function oneByAuth(tables, tableId, userId, message = 'Profile linkage is invalid.') {
  const found = await list(tables, tableId, [Query.equal('authUserId', [userId]), Query.limit(2)]);
  if (found.rows.length !== 1) throw new AdminError('linkage_error', message, 409);
  return found.rows[0];
}

export async function authorizeAdmin(users, tables, userId) {
  if (!userId) throw new AdminError('unauthenticated', 'Authentication required.', 401);
  let account;
  try { account = await users.get({ userId }); }
  catch (error) { if ([401, 404].includes(Number(error?.code))) throw new AdminError('unauthenticated', 'Authentication required.', 401); throw error; }
  if (exactRole(account.labels) !== 'admin') throw new AdminError('forbidden', 'Administrator access required.', 403);
  const profile = await oneByAuth(tables, TABLE.profiles, userId, 'An active administrator profile is required.');
  if (account.status === false || profile.isActive !== true || profile.role !== 'admin') throw new AdminError('forbidden', 'Administrator access required.', 403);
  return { userId, role: 'admin', profile };
}

function pagination(page, limit, total) { return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }; }
function safeRole(labels) { try { return exactRole(labels); } catch { return 'conflict'; } }
function safeAccount(account, profile) {
  const role = safeRole(account.labels);
  return {
    id: account.$id, name: String(profile?.name || account.name || '').slice(0, 120), email: String(account.email || '').slice(0, 255),
    role, isActive: account.status !== false && profile?.isActive === true,
    accountActive: account.status !== false, profileActive: profile?.isActive === true, profileLinked: Boolean(profile), createdAt: account.$createdAt || null
  };
}
function availability(doctor) {
  return { weekday: doctor.weekdayStart && doctor.weekdayEnd ? `${doctor.weekdayStart}–${doctor.weekdayEnd}` : null,
    saturday: doctor.saturdayStart && doctor.saturdayEnd ? `${doctor.saturdayStart}–${doctor.saturdayEnd}` : null,
    sundayOff: doctor.sundayOff !== false, maxPatientsPerDay: Number(doctor.maxPatientsPerDay) || 0 };
}

async function profileOptional(tables, userId) {
  const found = await list(tables, TABLE.profiles, [Query.equal('authUserId', [userId]), Query.limit(2)]);
  return found.rows.length === 1 ? found.rows[0] : null;
}

async function listUsers(users, tables, input) {
  keys(input, ['operation', 'page', 'limit', 'search', 'role', 'isActive']);
  const { page, limit, offset } = pageInput(input); const queries = [Query.limit(limit), Query.offset(offset), Query.orderDesc('$createdAt')];
  if (input.role !== undefined) { const role = text(input.role, 'role', 16, 1); if (!ROLES.has(role)) throw new AdminError('invalid_input', 'Invalid role filter.'); queries.push(Query.equal('labels', [role])); }
  if (input.isActive !== undefined) { if (typeof input.isActive !== 'boolean') throw new AdminError('invalid_input', 'Invalid status filter.'); queries.push(Query.equal('status', [input.isActive])); }
  const search = input.search === undefined ? undefined : text(input.search, 'search', 80, 1);
  const result = await users.list({ queries, search });
  const output = [];
  for (const account of result.users || []) output.push(safeAccount(account, await profileOptional(tables, account.$id)));
  return { users: output, pagination: pagination(page, limit, Number(result.total) || 0) };
}

async function getUserSummary(users, tables, input) {
  keys(input, ['operation', 'userId'], ['userId']); const userId = id(input.userId, 'user id');
  let account; try { account = await users.get({ userId }); } catch (error) { if (Number(error?.code) === 404) throw new AdminError('not_found', 'User not found.', 404); throw error; }
  const profile = await profileOptional(tables, userId); const result = safeAccount(account, profile);
  if (result.role === 'doctor') {
    const found = await list(tables, TABLE.doctors, [Query.equal('authUserId', [userId]), Query.limit(2)]);
    if (found.rows.length === 1) result.doctor = safeDoctor(found.rows[0], await doctorLinkage(users, tables, found.rows[0]));
  }
  return { user: result };
}

async function audit(tables, auth, action, resourceType, resourceId, status, metadata = null) {
  const safe = {};
  for (const [key, value] of Object.entries(metadata || {})) if (/^(fromStatus|toStatus|errorCategory)$/.test(key) && ['string', 'boolean'].includes(typeof value)) safe[key] = String(value).slice(0, 40);
  await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.audit, rowId: ID.unique(), data: {
    userAuthUserId: auth.userId, role: 'admin', action, resourceType, resourceId: resourceId || null, status,
    metadataSanitized: Object.keys(safe).length ? JSON.stringify(safe) : null, timestampLegacy: new Date().toISOString()
  }, permissions: [] });
}

async function changeUserRole(users, tables, auth, input) {
  keys(input, ['operation', 'userId', 'newRole', 'confirmed', 'specialization', 'department', 'experienceYears'], ['userId', 'newRole', 'confirmed']);
  if (auth.role !== 'admin') throw new AdminError('forbidden', 'Administrator access required.', 403);
  const userId = id(input.userId, 'user id');
  if (userId === auth.userId) throw new AdminError('forbidden', 'You cannot change your own role.', 403);
  if (input.confirmed !== true) throw new AdminError('confirmation_required', 'Explicit role-change confirmation is required.', 409);
  const newRole = text(input.newRole, 'new role', 16, 1);
  if (!['patient', 'doctor'].includes(newRole)) throw new AdminError('invalid_input', 'Unsupported role transition.');
  const account = await users.get({ userId });
  const oldRole = exactRole(account.labels);
  const profile = await oneByAuth(tables, TABLE.profiles, userId);
  if (!['patient', 'doctor'].includes(oldRole) || profile.role !== oldRole) throw new AdminError('linkage_error', 'Profile linkage is invalid.', 409);
  if (oldRole === newRole) throw new AdminError('invalid_transition', 'The account already has this role.', 409);
  const existingDoctor = await doctorByAuth(tables, userId, false);
  const oldDoctorState = existingDoctor ? { specialization:existingDoctor.specialization, department:existingDoctor.department, experienceYears:existingDoctor.experienceYears, isActive:existingDoctor.isActive } : null;
  let doctorCreated = null; let doctorChanged = false; let profileChanged = false; let labelsChanged = false;
  try {
    if (newRole === 'doctor') {
      const specialization = text(input.specialization, 'specialization', 32, 1);
      const experienceYears = integer(input.experienceYears, 'experience', 0, 100);
      if (existingDoctor) {
        await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: existingDoctor.$id, data: { specialization, department: input.department === undefined ? existingDoctor.department : text(input.department, 'department', 120, 1), experienceYears, isActive: true } });
        doctorChanged = true;
      } else {
        doctorCreated = await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: ID.unique(), data: {
          authUserId: userId, name: profile.name, email: profile.email, specialization,
          department: input.department === undefined ? null : text(input.department, 'department', 120, 1), experienceYears,
          isActive: true, weekdayStart: '08:00', weekdayEnd: '16:00', saturdayStart: '09:00', saturdayEnd: '13:00', sundayOff: true, maxPatientsPerDay: 20
        }, permissions: [Permission.read(Role.user(userId))] });
      }
    } else {
      if (!existingDoctor) throw new AdminError('linkage_error', 'Doctor profile linkage is invalid.', 409);
      await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: existingDoctor.$id, data: { isActive: false } }); doctorChanged = true;
    }
    await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.profiles, rowId: profile.$id, data: { role: newRole } }); profileChanged = true;
    await users.updateLabels({ userId, labels: [newRole] }); labelsChanged = true;
    const linked = await oneByAuth(tables, TABLE.profiles, userId);
    const verified = await users.get({ userId });
    if (linked.role !== newRole || exactRole(verified.labels) !== newRole) throw new AdminError('linkage_error', 'Role linkage verification failed.', 409);
    if (newRole === 'doctor') await doctorByAuth(tables, userId, true);
  } catch (error) {
    if (labelsChanged) try { await users.updateLabels({ userId, labels: account.labels }); } catch {}
    if (profileChanged) try { await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.profiles, rowId: profile.$id, data: { role: oldRole } }); } catch {}
    if (doctorCreated) try { await tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: doctorCreated.$id }); } catch {}
    else if (doctorChanged && existingDoctor) try { await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: existingDoctor.$id, data: oldDoctorState }); } catch {}
    throw error;
  }
  await audit(tables, auth, 'admin.role_change', 'profile', userId, 'success', { fromStatus: oldRole, toStatus: newRole });
  return { user: { id: userId, name: profile.name, email: account.email, role: newRole, isActive: profile.isActive === true } };
}

async function rollbackCreatedUser(users, tables, created) {
  if (created.doctorId) try { await tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: created.doctorId }); } catch {}
  if (created.profileId) try { await tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLE.profiles, rowId: created.profileId }); } catch {}
  if (created.userId) try { await users.delete({ userId: created.userId }); } catch {}
}

async function createUser(users, tables, auth, input) {
  keys(input, ['operation', 'name', 'email', 'password', 'role', 'specialization', 'department', 'experienceYears'], ['name', 'email', 'password', 'role']);
  const name = text(input.name, 'name', 120, 2); const normalizedEmail = email(input.email);
  const role = text(input.role, 'role', 16, 1); if (!['patient', 'doctor'].includes(role)) throw new AdminError('invalid_input', 'Invalid role.');
  const secret = devAdminPassword(input.password, { email: normalizedEmail, name }, { name });
  const existing = await users.list({ queries: [Query.equal('email', [normalizedEmail]), Query.limit(1)] });
  if ((existing.users || []).length) throw new AdminError('duplicate_email', 'Email is already registered.', 409);
  let doctorData = null;
  if (role === 'doctor') {
    keys(input, ['operation', 'name', 'email', 'password', 'role', 'specialization', 'department', 'experienceYears'], ['name', 'email', 'password', 'role', 'specialization', 'experienceYears']);
    doctorData = { specialization: text(input.specialization, 'specialization', 32, 1), department: input.department === undefined ? null : text(input.department, 'department', 120, 1),
      experienceYears: integer(input.experienceYears, 'experience', 0, 100) };
  } else if (input.specialization !== undefined || input.department !== undefined || input.experienceYears !== undefined) throw new AdminError('invalid_input', 'Doctor fields are not allowed for a patient.');
  const created = {};
  try {
    const account = await users.create({ userId: ID.unique(), email: normalizedEmail, password: secret, name }); created.userId = account.$id;
    await users.updateLabels({ userId: account.$id, labels: [role] });
    const profileId = account.$id; const profile = await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.profiles, rowId: profileId, data: {
      authUserId: account.$id, name, email: normalizedEmail, role, authProvider: 'email', isActive: true
    }, permissions: [Permission.read(Role.user(account.$id))] }); created.profileId = profileId;
    let doctor = null;
    if (role === 'doctor') {
      const doctorId = ID.unique(); doctor = await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: doctorId, data: {
        authUserId: account.$id, name, email: normalizedEmail, specialization: doctorData.specialization, department: doctorData.department,
        experienceYears: doctorData.experienceYears, isActive: true, weekdayStart: '08:00', weekdayEnd: '16:00', saturdayStart: '09:00', saturdayEnd: '13:00', sundayOff: true, maxPatientsPerDay: 20
      }, permissions: [Permission.read(Role.user(account.$id))] }); created.doctorId = doctorId;
    }
    const linkedProfile = await oneByAuth(tables, TABLE.profiles, account.$id);
    if (linkedProfile.$id !== profileId || linkedProfile.authUserId !== account.$id || linkedProfile.role !== role || linkedProfile.isActive !== true || profile.authUserId !== account.$id) throw new AdminError('linkage_error', 'Created profile linkage is invalid.', 409);
    if (role === 'doctor') {
      const linkedDoctor = await doctorByAuth(tables, account.$id, true);
      if (linkedDoctor.$id !== created.doctorId || linkedDoctor.authUserId !== account.$id || linkedDoctor.isActive !== true || doctor.authUserId !== account.$id) throw new AdminError('linkage_error', 'Created doctor linkage is invalid.', 409);
    }
    await audit(tables, auth, 'admin.user_create', role === 'doctor' ? 'doctor' : 'profile', null, 'success', { toStatus: true });
    return { user: { id: account.$id, name, email: normalizedEmail, role, isActive: true } };
  } catch (error) {
    await rollbackCreatedUser(users, tables, created);
    if (Number(error?.code) === 409) throw new AdminError('duplicate_email', 'Email is already registered.', 409);
    throw error;
  }
}

async function doctorByAuth(tables, userId, required = false) {
  const found = await list(tables, TABLE.doctors, [Query.equal('authUserId', [userId]), Query.limit(2)]);
  if (found.rows.length === 1) return found.rows[0];
  if (required) throw new AdminError('linkage_error', 'Doctor profile linkage is invalid.', 409);
  return null;
}

async function updateUser(users, tables, auth, input) {
  keys(input, ['operation', 'userId', 'name', 'isActive', 'specialization', 'department', 'experienceYears', 'weekdayStart', 'weekdayEnd', 'saturdayStart', 'saturdayEnd', 'sundayOff', 'maxPatientsPerDay'], ['userId']);
  const userId = id(input.userId, 'user id'); if (userId === auth.userId && input.isActive === false) throw new AdminError('conflict', 'You cannot deactivate your own administrator profile.', 409);
  const account = await users.get({ userId }); const role = exactRole(account.labels); const profile = await oneByAuth(tables, TABLE.profiles, userId);
  if (role === 'admin' || profile.role === 'admin') throw new AdminError('forbidden', 'Administrator targets cannot be modified.', 403);
  if (!['patient', 'doctor'].includes(role) || profile.role !== role) throw new AdminError('linkage_error', 'Profile linkage is invalid.', 409);
  const hasName = input.name !== undefined; const hasStatus = input.isActive !== undefined;
  if (hasStatus && typeof input.isActive !== 'boolean') throw new AdminError('invalid_input', 'Invalid active status.');
  const name = hasName ? text(input.name, 'name', 120, 2) : profile.name;
  const doctorFields = ['specialization','department','experienceYears','weekdayStart','weekdayEnd','saturdayStart','saturdayEnd','sundayOff','maxPatientsPerDay'];
  if (role !== 'doctor' && doctorFields.some((key) => input[key] !== undefined)) throw new AdminError('invalid_input', 'Doctor fields are not allowed for a patient.');
  if (!hasName && !hasStatus && !doctorFields.some((key) => input[key] !== undefined)) throw new AdminError('invalid_input', 'No editable field was provided.');
  const doctor = role === 'doctor' ? await doctorByAuth(tables, userId, true) : null;
  const profileData = {}; if (hasName) profileData.name = name; if (hasStatus) profileData.isActive = input.isActive;
  const doctorData = {};
  if (doctor) {
    if (hasName) doctorData.name = name; if (hasStatus) doctorData.isActive = input.isActive;
    if (input.specialization !== undefined) doctorData.specialization = text(input.specialization, 'specialization', 32, 1);
    if (input.department !== undefined) doctorData.department = input.department === null ? null : text(input.department, 'department', 120, 1);
    if (input.experienceYears !== undefined) doctorData.experienceYears = integer(input.experienceYears, 'experience', 0, 100);
    for (const key of ['weekdayStart','weekdayEnd','saturdayStart','saturdayEnd']) if (input[key] !== undefined) doctorData[key] = input[key] === null ? null : time(input[key], key);
    if (input.sundayOff !== undefined) { if (typeof input.sundayOff !== 'boolean') throw new AdminError('invalid_input', 'Invalid sunday status.'); doctorData.sundayOff = input.sundayOff; }
    if (input.maxPatientsPerDay !== undefined) doctorData.maxPatientsPerDay = integer(input.maxPatientsPerDay, 'daily patient limit', 1, 1000);
  }
  const oldName = account.name; const oldProfile = { name: profile.name, isActive: profile.isActive }; const oldDoctor = doctor ? Object.fromEntries(Object.keys(doctorData).map((key) => [key, doctor[key]])) : null;
  let authUpdated = false; let profileUpdated = false;
  try {
    if (hasName && name !== account.name) { await users.updateName({ userId, name }); authUpdated = true; }
    if (Object.keys(profileData).length) { await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.profiles, rowId: profile.$id, data: profileData }); profileUpdated = true; }
    if (doctor && Object.keys(doctorData).length) await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: doctor.$id, data: doctorData });
  } catch (error) {
    if (doctor && oldDoctor) try { await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: doctor.$id, data: oldDoctor }); } catch {}
    if (profileUpdated) try { await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.profiles, rowId: profile.$id, data: oldProfile }); } catch {}
    if (authUpdated) try { await users.updateName({ userId, name: oldName }); } catch {}
    throw error;
  }
  await audit(tables, auth, 'admin.user_update', role === 'doctor' ? 'doctor' : 'profile', null, 'success', { fromStatus: profile.isActive === true, toStatus: hasStatus ? input.isActive : profile.isActive === true });
  return { user: { id: userId, name, email: account.email, role, isActive: hasStatus ? input.isActive : profile.isActive === true } };
}

async function updateUserPassword(users, tables, auth, input) {
  keys(input, ['operation', 'userId', 'newPassword', 'confirmPassword'], ['userId', 'newPassword', 'confirmPassword']);
  const userId = id(input.userId, 'user id');
  if (userId === auth.userId) throw new AdminError('forbidden', 'Administrator targets cannot be modified.', 403);
  const account = await users.get({ userId }); const role = exactRole(account.labels);
  if (!['patient', 'doctor'].includes(role)) throw new AdminError('forbidden', 'Only patient or doctor passwords can be changed.', 403);
  const profile = await oneByAuth(tables, TABLE.profiles, userId);
  if (profile.role !== role) throw new AdminError('linkage_error', 'Profile linkage is invalid.', 409);
  if (role === 'doctor') await doctorByAuth(tables, userId, true);
  const nextPassword = devAdminPassword(input.newPassword, account, profile);
  if (nextPassword !== String(input.confirmPassword ?? '')) throw new AdminError('invalid_input', 'Password confirmation does not match.');
  await users.updatePassword({ userId, password: nextPassword });
  await users.deleteSessions({ userId });
  await audit(tables, auth, 'admin.user_password_update', 'profile', null, 'success', { toStatus: 'sessions_invalidated' });
  return { passwordUpdated: true, sessionsInvalidated: true, mode: 'dev_admin' };
}

async function countRows(tables, tableId, queries) {
  const found = await list(tables, tableId, [...queries, Query.limit(1)]);
  return found.total;
}

async function countOwnedFiles(storage, userId) {
  if (!storage) throw new AdminError('internal_error', 'Protected file verification is unavailable.', 500);
  let count = 0;
  for (let offset = 0; offset < 1000; offset += 100) {
    const found = await storage.listFiles({ bucketId: MEDICAL_BUCKET_ID, queries: [Query.limit(100), Query.offset(offset)] });
    const files = found.files || [];
    count += files.filter((file) => (file.$permissions || []).some((permission) => String(permission).includes(`user:${userId}`))).length;
    if (offset + files.length >= Number(found.total || 0) || files.length < 100) break;
  }
  return count;
}

async function protectedUserReferences(tables, storage, userId, role, doctor) {
  const appointmentQueries = role === 'doctor'
    ? [Query.equal('doctorProfileId', [doctor.$id])]
    : [Query.equal('patientAuthUserId', [userId])];
  const [appointments, prescriptions, records, notifications, audits, files] = await Promise.all([
    countRows(tables, TABLE.appointments, appointmentQueries),
    countRows(tables, TABLE.prescriptions, [Query.equal(role === 'doctor' ? 'doctorAuthUserId' : 'patientAuthUserId', [userId])]),
    role === 'patient' ? countRows(tables, TABLE.records, [Query.equal('patientAuthUserId', [userId])]) : 0,
    countRows(tables, TABLE.notifications, [Query.equal('userAuthUserId', [userId])]),
    countRows(tables, TABLE.audit, [Query.equal('userAuthUserId', [userId])]),
    countOwnedFiles(storage, userId)
  ]);
  return { appointments, prescriptions, records, notifications, audits, files,
    total: appointments + prescriptions + records + notifications + audits + files };
}

async function deleteUser(users, tables, storage, auth, input) {
  keys(input, ['operation', 'userId', 'confirmed'], ['userId', 'confirmed']);
  if (input.confirmed !== true) throw new AdminError('confirmation_required', 'Explicit confirmation is required.', 400);
  const userId = id(input.userId, 'user id');
  if (userId === auth.userId) throw new AdminError('forbidden', 'Administrator targets cannot be deleted.', 403);
  let account;
  try { account = await users.get({ userId }); }
  catch (error) { if (Number(error?.code) === 404) throw new AdminError('not_found', 'User not found.', 404); throw error; }
  const role = exactRole(account.labels);
  if (!['patient', 'doctor'].includes(role)) throw new AdminError('forbidden', 'Administrator targets cannot be deleted.', 403);
  const profile = await oneByAuth(tables, TABLE.profiles, userId);
  if (profile.authUserId !== userId || profile.role !== role) throw new AdminError('linkage_error', 'Profile linkage is invalid.', 409);
  const doctorRows = await list(tables, TABLE.doctors, [Query.equal('authUserId', [userId]), Query.limit(2)]);
  if ((role === 'patient' && doctorRows.rows.length !== 0) || (role === 'doctor' && doctorRows.rows.length !== 1)) {
    throw new AdminError('linkage_error', 'Profile linkage is invalid.', 409);
  }
  const doctor = role === 'doctor' ? doctorRows.rows[0] : null;
  if (doctor && doctor.authUserId !== userId) throw new AdminError('linkage_error', 'Profile linkage is invalid.', 409);
  const references = await protectedUserReferences(tables, storage, userId, role, doctor);
  const imported = Boolean(profile.legacyMongoId || doctor?.legacyMongoId);
  if (imported || references.total > 0) {
    throw new AdminError('protected_references', 'Ky user ka te dhena te lidhura dhe nuk mund te fshihet. Perdor Caktivizo.', 409);
  }
  if (doctor) await tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: doctor.$id });
  await tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLE.profiles, rowId: profile.$id });
  await users.delete({ userId });
  const [remainingProfiles, remainingDoctors] = await Promise.all([
    list(tables, TABLE.profiles, [Query.equal('authUserId', [userId]), Query.limit(1)]),
    list(tables, TABLE.doctors, [Query.equal('authUserId', [userId]), Query.limit(1)])
  ]);
  let authRemains = false;
  try { await users.get({ userId }); authRemains = true; } catch (error) { if (Number(error?.code) !== 404) throw error; }
  if (authRemains || remainingProfiles.total !== 0 || remainingDoctors.total !== 0) throw new AdminError('cleanup_error', 'User deletion could not be verified.', 500);
  await audit(tables, auth, 'admin.user_delete', role === 'doctor' ? 'doctor' : 'profile', null, 'success');
  return { deleted: true, role };
}

async function setProfileActive(users, tables, auth, input) {
  keys(input, ['operation', 'userId', 'isActive'], ['userId', 'isActive']); const userId = id(input.userId, 'user id');
  if (typeof input.isActive !== 'boolean') throw new AdminError('invalid_input', 'Invalid active status.');
  if (userId === auth.userId && input.isActive === false) throw new AdminError('conflict', 'You cannot deactivate your own administrator profile.', 409);
  const account = await users.get({ userId }); const profile = await oneByAuth(tables, TABLE.profiles, userId); const role = exactRole(account.labels);
  if (role === 'admin' || profile.role === 'admin') throw new AdminError('forbidden', 'Administrator targets cannot be modified.', 403);
  if (profile.role !== role) throw new AdminError('linkage_error', 'Profile linkage is invalid.', 409);
  const doctor = role === 'doctor' ? await doctorByAuth(tables, userId, true) : null;
  const from = profile.isActive === true; await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.profiles, rowId: profile.$id, data: { isActive: input.isActive } });
  try { if (doctor) await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: doctor.$id, data: { isActive: input.isActive } }); }
  catch (error) { try { await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.profiles, rowId: profile.$id, data: { isActive: from } }); } catch {} throw error; }
  await audit(tables, auth, 'admin.profile_status', 'profile', profile.$id, 'success', { fromStatus: from, toStatus: input.isActive });
  return { user: { id: userId, isActive: input.isActive } };
}

async function doctorLinkage(users, tables, doctor) {
  let authExists = false; let authActive = false; let role = 'missing';
  try { const account = await users.get({ userId: doctor.authUserId }); authExists = true; authActive = account.status !== false; role = safeRole(account.labels); } catch {}
  const profile = await profileOptional(tables, doctor.authUserId);
  return { authExists, authActive, profileLinked: Boolean(profile), profileActive: profile?.isActive === true, role, valid: authExists && authActive && Boolean(profile) && profile.role === 'doctor' && role === 'doctor' };
}
function safeDoctor(doctor, linkage) {
  return { id: doctor.$id, name: String(doctor.name || '').slice(0, 120), specialization: doctor.specialization, department: doctor.department || null,
    experienceYears: Number(doctor.experienceYears) || 0, isActive: doctor.isActive === true, availability: availability(doctor), linkage,
    createdAt: doctor.$createdAt || null };
}

async function listDoctors(users, tables, input) {
  keys(input, ['operation', 'page', 'limit', 'specialization', 'isActive']); const { page, limit, offset } = pageInput(input);
  const queries = [Query.limit(limit), Query.offset(offset), Query.orderDesc('$createdAt')];
  if (input.specialization !== undefined) queries.push(Query.equal('specialization', [text(input.specialization, 'specialization', 32, 1)]));
  if (input.isActive !== undefined) { if (typeof input.isActive !== 'boolean') throw new AdminError('invalid_input', 'Invalid status filter.'); queries.push(Query.equal('isActive', [input.isActive])); }
  const found = await list(tables, TABLE.doctors, queries); const doctors = [];
  for (const doctor of found.rows) doctors.push(safeDoctor(doctor, await doctorLinkage(users, tables, doctor)));
  return { doctors, pagination: pagination(page, limit, found.total) };
}

async function getDoctorDetails(users, tables, input) {
  keys(input, ['operation', 'doctorId'], ['doctorId']); const doctorId = id(input.doctorId, 'doctor id');
  let doctor; try { doctor = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: doctorId }); } catch (error) { if (Number(error?.code) === 404) throw new AdminError('not_found', 'Doctor not found.', 404); throw error; }
  return { doctor: safeDoctor(doctor, await doctorLinkage(users, tables, doctor)) };
}

async function setDoctorActive(users, tables, auth, input) {
  keys(input, ['operation', 'doctorId', 'isActive'], ['doctorId', 'isActive']); const doctorId = id(input.doctorId, 'doctor id');
  if (typeof input.isActive !== 'boolean') throw new AdminError('invalid_input', 'Invalid active status.');
  const doctor = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: doctorId });
  const linkage = await doctorLinkage(users, tables, doctor); if (!linkage.authExists || !linkage.profileLinked || linkage.role !== 'doctor') throw new AdminError('linkage_error', 'Doctor Auth/profile linkage is invalid.', 409);
  const profile = await oneByAuth(tables, TABLE.profiles, doctor.authUserId); const from = doctor.isActive === true;
  await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: doctorId, data: { isActive: input.isActive } });
  await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.profiles, rowId: profile.$id, data: { isActive: input.isActive } });
  await audit(tables, auth, 'admin.doctor_status', 'doctor', doctorId, 'success', { fromStatus: from, toStatus: input.isActive });
  return { doctor: { id: doctorId, isActive: input.isActive } };
}

function validIso(value, name) { const result = text(value, name, 40, 20); if (Number.isNaN(new Date(result).getTime())) throw new AdminError('invalid_input', `Invalid ${name}.`); return new Date(result).toISOString(); }
async function listAppointments(users, tables, input) {
  keys(input, ['operation', 'page', 'limit', 'status', 'from', 'to', 'doctorId', 'patientId']); const { page, limit, offset } = pageInput(input);
  const queries = [Query.limit(limit), Query.offset(offset), Query.orderDesc('scheduledAt')];
  if (input.status !== undefined) { const status = text(input.status, 'status', 16, 1); if (!STATUSES.has(status)) throw new AdminError('invalid_input', 'Invalid status filter.'); queries.push(Query.equal('status', [status])); }
  if (input.from !== undefined) queries.push(Query.greaterThanEqual('scheduledAt', validIso(input.from, 'from date')));
  if (input.to !== undefined) queries.push(Query.lessThanEqual('scheduledAt', validIso(input.to, 'to date')));
  if (input.doctorId !== undefined) queries.push(Query.equal('doctorProfileId', [id(input.doctorId, 'doctor id')]));
  if (input.patientId !== undefined) queries.push(Query.equal('patientAuthUserId', [id(input.patientId, 'patient id')]));
  const found = await list(tables, TABLE.appointments, queries); const output = [];
  for (const item of found.rows) {
    let patientName = 'Pacient'; let doctorName = 'Doktor';
    const patient = await profileOptional(tables, item.patientAuthUserId); if (patient?.name) patientName = patient.name;
    try { const doctor = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: item.doctorProfileId }); doctorName = doctor.name || doctorName; } catch {}
    output.push({ id: item.$id, patient: { name: patientName }, doctor: { name: doctorName }, service: item.service, scheduledAt: item.scheduledAt,
      durationMinutes: Number(item.durationMinutes) || 0, status: item.status, cancelledAt: item.cancelledAt || null });
  }
  return { appointments: output, pagination: pagination(page, limit, found.total) };
}

async function appointmentById(tables, appointmentId) {
  const appointmentIdSafe = id(appointmentId, 'appointment id');
  try { return await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.appointments, rowId: appointmentIdSafe }); }
  catch (error) { if (Number(error?.code) === 404) throw new AdminError('not_found', 'Appointment not found.', 404); throw error; }
}

async function approveAppointment(tables, auth, input) {
  keys(input, ['operation', 'appointmentId'], ['appointmentId']);
  const appointment = await appointmentById(tables, input.appointmentId);
  if (appointment.status !== 'pending') throw new AdminError('invalid_transition', 'Only pending appointments can be approved.', 409);
  await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.appointments, rowId: appointment.$id, data: { status: 'confirmed' } });
  await audit(tables, auth, 'admin.appointment_approved', 'appointment', appointment.$id, 'success', { fromStatus: 'pending', toStatus: 'confirmed' });
  return { appointment: { id: appointment.$id, status: 'confirmed' } };
}

async function cancelAppointment(tables, auth, input) {
  keys(input, ['operation', 'appointmentId', 'reason'], ['appointmentId']);
  const appointment = await appointmentById(tables, input.appointmentId);
  if (!['pending', 'confirmed'].includes(appointment.status)) throw new AdminError('invalid_transition', 'This appointment cannot be cancelled.', 409);
  const reason = input.reason === undefined ? null : text(input.reason, 'cancellation reason', 300);
  const cancelledAt = new Date().toISOString();
  await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.appointments, rowId: appointment.$id, data: {
    status: 'cancelled', cancelledByAuthUserId: auth.userId, cancelledByRole: 'admin', cancelledAt,
    cancellationReason: reason, activeSlotKey: null
  } });
  await audit(tables, auth, 'admin.appointment_cancelled', 'appointment', appointment.$id, 'success', { fromStatus: appointment.status, toStatus: 'cancelled' });
  return { appointment: { id: appointment.$id, status: 'cancelled', cancelledAt } };
}

async function totals(tables) {
  const entries = await Promise.all(Object.entries(TABLE).map(async ([key, tableId]) => [key, (await list(tables, tableId, [Query.limit(1)])).total]));
  return Object.fromEntries(entries);
}
async function clinicalCounts(tables, input) { keys(input, ['operation']); const count = await totals(tables); return { counts: { prescriptions: count.prescriptions, medicalRecords: count.records } }; }

async function listNotifications(tables, input) {
  keys(input, ['operation', 'page', 'limit', 'type', 'read']); const { page, limit, offset } = pageInput(input); const queries = [Query.limit(limit), Query.offset(offset), Query.orderDesc('$createdAt')];
  if (input.type !== undefined) queries.push(Query.equal('type', [text(input.type, 'notification type', 40, 1)]));
  if (input.read !== undefined) { if (typeof input.read !== 'boolean') throw new AdminError('invalid_input', 'Invalid read filter.'); queries.push(Query.equal('read', [input.read])); }
  const found = await list(tables, TABLE.notifications, queries);
  return { notifications: found.rows.map((item) => ({ type: item.type, resourceType: item.resourceType || null, read: item.read === true, createdAt: item.$createdAt })), pagination: pagination(page, limit, found.total) };
}

async function listAudit(tables, input) {
  keys(input, ['operation', 'page', 'limit', 'action', 'role', 'status', 'from', 'to']); const { page, limit, offset } = pageInput(input); const queries = [Query.limit(limit), Query.offset(offset), Query.orderDesc('timestampLegacy')];
  if (input.action !== undefined) queries.push(Query.equal('action', [text(input.action, 'action', 100, 1)]));
  if (input.role !== undefined) { const role = text(input.role, 'role', 16, 1); if (!ROLES.has(role) && role !== 'anonymous') throw new AdminError('invalid_input', 'Invalid role filter.'); queries.push(Query.equal('role', [role])); }
  if (input.status !== undefined) { const status = text(input.status, 'status', 16, 1); if (!['success', 'failure'].includes(status)) throw new AdminError('invalid_input', 'Invalid status filter.'); queries.push(Query.equal('status', [status])); }
  if (input.from !== undefined) queries.push(Query.greaterThanEqual('timestampLegacy', validIso(input.from, 'from date')));
  if (input.to !== undefined) queries.push(Query.lessThanEqual('timestampLegacy', validIso(input.to, 'to date')));
  const found = await list(tables, TABLE.audit, queries);
  return { logs: found.rows.map((item) => ({ timestamp: item.timestampLegacy || item.$createdAt, role: item.role || null, action: item.action, targetCategory: item.resourceType || null, status: item.status })), pagination: pagination(page, limit, found.total) };
}

async function allRows(tables, tableId) { const output = []; for (let offset = 0; offset < 1000; offset += 100) { const found = await list(tables, tableId, [Query.limit(100), Query.offset(offset)]); output.push(...found.rows); if (output.length >= found.total || found.rows.length < 100) break; } return output; }
function group(items, field) { const result = {}; for (const item of items) { const key = String(item[field] ?? 'unknown'); result[key] = (result[key] || 0) + 1; } return result; }
async function analytics(tables, input) {
  keys(input, ['operation', 'from', 'to']); const [profiles, doctors, appointments, count] = await Promise.all([allRows(tables, TABLE.profiles), allRows(tables, TABLE.doctors), allRows(tables, TABLE.appointments), totals(tables)]);
  let filtered = appointments;
  if (input.from !== undefined) { const from = new Date(validIso(input.from, 'from date')); filtered = filtered.filter((item) => new Date(item.scheduledAt) >= from); }
  if (input.to !== undefined) { const to = new Date(validIso(input.to, 'to date')); filtered = filtered.filter((item) => new Date(item.scheduledAt) <= to); }
  return { analytics: { users: { total: profiles.length, byRole: group(profiles, 'role'), byStatus: { active: profiles.filter((x) => x.isActive === true).length, inactive: profiles.filter((x) => x.isActive !== true).length } },
    doctors: { total: doctors.length, byStatus: { active: doctors.filter((x) => x.isActive === true).length, inactive: doctors.filter((x) => x.isActive !== true).length }, bySpecialization: group(doctors, 'specialization') },
    appointments: { total: filtered.length, byStatus: group(filtered, 'status') }, prescriptions: count.prescriptions, medicalRecords: count.records, notifications: count.notifications, auditEvents: count.audit } };
}

export async function route(users, tables, auth, input, storage = null) {
  switch (input.operation) {
    case 'health': keys(input, ['operation']); return { service: 'admin-api', database: 'appwrite-development' };
    case 'listUsers': return listUsers(users, tables, input); case 'getUserSummary': return getUserSummary(users, tables, input); case 'createUser': return createUser(users, tables, auth, input); case 'updateUser': return updateUser(users, tables, auth, input); case 'changeUserRole': return changeUserRole(users, tables, auth, input); case 'updateUserPassword': return updateUserPassword(users, tables, auth, input); case 'deleteUser': return deleteUser(users, tables, storage, auth, input); case 'setProfileActive': return setProfileActive(users, tables, auth, input);
    case 'listDoctors': return listDoctors(users, tables, input); case 'getDoctorDetails': return getDoctorDetails(users, tables, input); case 'setDoctorActive': return setDoctorActive(users, tables, auth, input);
    case 'listAppointments': return listAppointments(users, tables, input); case 'approveAppointment': return approveAppointment(tables, auth, input); case 'cancelAppointment': return cancelAppointment(tables, auth, input); case 'getClinicalMetadataCounts': return clinicalCounts(tables, input);
    case 'listNotifications': return listNotifications(tables, input); case 'listAuditLogs': return listAudit(tables, input); case 'getAnalytics': return analytics(tables, input);
    default: throw new AdminError('invalid_input', 'Unknown operation.');
  }
}

export async function auditFailure(tables, auth, operation, input, category) {
  if (!MUTATIONS.has(operation)) return;
  const resourceType = operation === 'setDoctorActive' || input?.role === 'doctor' ? 'doctor' : 'profile';
  const resourceId = String(input?.doctorId || input?.userId || '').slice(0, 36) || null;
  try { await audit(tables, auth, `admin.${resourceType}_status`, resourceType, resourceId, 'failure', { errorCategory: category }); } catch {}
}
