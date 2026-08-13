import { Client, Users, TablesDB, Storage, Query, ID, Permission, Role } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import {
  ACTIVE_STATUSES, APP_TIMEZONE, ClinicalError, assertKeys, assertPlainObject, assertRole, boundedInteger, boundedString,
  deriveRole, deterministicActiveSlotKey, localDateForInstant, overlaps, ownsAppointment, ownsNotification, parseServices, publicDoctorSummary, sanitizeAuditMetadata,
  scheduleWindow, serviceDuration, transitionAllowed, validDate, validId, validateScheduleUpdate,
  zonedDateTimeToUtc
} from './clinical.js';
import { ENCRYPTION_VERSION, checksum, decryptMedical, encryptMedical, medicalKey, validatePdf, validatePrescriptionContent } from './medical.js';
import { buildPatientHistory } from './history.js';

const ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = '6a66216909c3398b7265';
const DATABASE_ID = 'shendeti';
const BUCKET_ID = 'medical-pdfs';
const TABLE = Object.freeze({ profiles: 'profiles', doctors: 'doctor_profiles', appointments: 'appointments', prescriptions: 'prescriptions', records: 'medical_records', notifications: 'notifications', messages: 'messages', audit: 'audit_logs' });
const PATIENT_OPS = new Set(['getPatientDashboard', 'listMyAppointments', 'createAppointment', 'cancelMyAppointment', 'listMyPrescriptions', 'getMyPrescription', 'listMyMedicalHistory', 'listMyMedicalRecords', 'uploadMyMedicalRecord', 'downloadMyMedicalRecord']);
const DOCTOR_OPS = new Set(['listDoctorAppointments', 'updateAppointmentStatus', 'cancelDoctorAppointment', 'getDoctorSchedule', 'updateDoctorSchedule', 'listDoctorPatients', 'listDoctorPrescriptions', 'getDoctorPrescription', 'createPrescription', 'updateDoctorPrescription', 'deleteDoctorPrescription', 'getAssignedPatientHistory']);
const SHARED_OPS = new Set(['listDoctors', 'getDoctorAvailability', 'getAvailableSlots', 'getQueueStatus', 'listMyNotifications', 'markNotificationRead', 'markAllNotificationsRead', 'listMyConversations', 'listConversationMessages', 'sendMessage', 'markConversationRead']);
const PUBLIC_OPS = new Set(['listPublicDoctors']);
const ALLOWED_OPS = new Set([...PATIENT_OPS, ...DOCTOR_OPS, ...SHARED_OPS, ...PUBLIC_OPS, 'bootstrap-patient']);
const MEDICAL_OPS = new Set(['listMyPrescriptions', 'getMyPrescription', 'listMyMedicalHistory', 'listMyMedicalRecords', 'uploadMyMedicalRecord', 'downloadMyMedicalRecord',
  'listDoctorPrescriptions', 'getDoctorPrescription', 'createPrescription', 'updateDoctorPrescription', 'deleteDoctorPrescription', 'getAssignedPatientHistory']);

function output(res, status, payload) { return res.json(payload, status); }
function qLimit(value) { return Query.limit(Math.min(100, Math.max(1, Number(value) || 50))); }

async function rows(tables, tableId, queries = []) {
  const result = await tables.listRows({ databaseId: DATABASE_ID, tableId, queries });
  return result.rows || [];
}

async function ownedRowCount(tables, tableId, userId) {
  const result = await tables.listRows({
    databaseId: DATABASE_ID,
    tableId,
    queries: [Query.equal('patientAuthUserId', [userId]), Query.limit(1)]
  });
  return Math.max(0, Number(result.total) || 0);
}

async function exactlyOneByAuth(tables, tableId, userId, message) {
  const found = await rows(tables, tableId, [Query.equal('authUserId', [userId]), Query.limit(2)]);
  if (found.length !== 1) throw new ClinicalError('forbidden', message, 403);
  return found[0];
}

async function authenticate(users, tables, userId) {
  if (!userId) throw new ClinicalError('unauthenticated', 'Authentication required.', 401);
  let account;
  try {
    account = await users.get({ userId });
  } catch (error) {
    if (Number(error?.code) === 404) {
      throw new ClinicalError('unauthenticated', 'Authentication required.', 401);
    }
    throw error;
  }
  const role = deriveRole(account.labels);
  if (role === 'admin') throw new ClinicalError('forbidden', 'Administrators have no clinical access in Phase 6B.', 403);
  const profile = await exactlyOneByAuth(tables, TABLE.profiles, userId, 'An active private profile is required.');
  if (account.status === false || profile.isActive !== true) throw new ClinicalError('forbidden', 'The account is inactive.', 403);
  let doctor = null;
  if (role === 'doctor') {
    doctor = await exactlyOneByAuth(tables, TABLE.doctors, userId, 'An active doctor profile is required.');
    if (doctor.isActive !== true) throw new ClinicalError('forbidden', 'The doctor profile is inactive.', 403);
  }
  return { userId, role, profile, doctor };
}

async function doctorById(tables, doctorId) {
  let doctor;
  try { doctor = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: validId(doctorId, 'doctor id') }); }
  catch (error) { if (Number(error?.code) === 404) throw new ClinicalError('not_found', 'Doctor not found.', 404); throw error; }
  if (doctor.isActive !== true) throw new ClinicalError('not_found', 'Doctor not found.', 404);
  return doctor;
}

function safeDoctor(doctor) {
  return {
    id: doctor.$id, name: doctor.name, specialization: doctor.specialization, department: doctor.department || null,
    experience: doctor.experienceYears ?? 0, services: parseServices(doctor.servicesJson).filter((item) => item.available),
    availability: { weekdayStart: doctor.weekdayStart, weekdayEnd: doctor.weekdayEnd, saturdayStart: doctor.saturdayStart,
      saturdayEnd: doctor.saturdayEnd, sundayOff: doctor.sundayOff, maxPatientsPerDay: doctor.maxPatientsPerDay },
    avgRating: doctor.avgRating ?? null, bio: doctor.bio || null
  };
}

async function appointmentsForDoctorDay(tables, doctorId, date) {
  const start = zonedDateTimeToUtc(date, '00:00');
  const next = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  const found = await rows(tables, TABLE.appointments, [
    Query.equal('doctorProfileId', [doctorId]), Query.greaterThanEqual('scheduledAt', start.toISOString()),
    Query.lessThan('scheduledAt', next.toISOString()), Query.limit(100)
  ]);
  return found.filter((item) => localDateForInstant(item.scheduledAt) === date);
}

async function listDoctors(tables, input) {
  assertKeys(input, ['operation', 'specialization', 'limit']);
  const limit = input.limit === undefined ? 50 : boundedInteger(input.limit, 'limit', 1, 50);
  const specialization = input.specialization === undefined ? '' : boundedString(input.specialization, 'specialization', { min: 1, max: 32 });
  const found = await rows(tables, TABLE.doctors, [qLimit(100)]);
  return { doctors: found.filter((item) => item.isActive === true && (!specialization || item.specialization === specialization)).slice(0, limit).map(safeDoctor) };
}

async function listPublicDoctors(tables, input) {
  assertKeys(input, ['operation', 'limit']);
  const limit = input.limit === undefined ? 50 : boundedInteger(input.limit, 'limit', 1, 50);
  const found = await rows(tables, TABLE.doctors, [qLimit(100)]);
  return { doctors: found.filter((item) => item.isActive === true).slice(0, limit).map(publicDoctorSummary) };
}

async function availableSlots(tables, input) {
  assertKeys(input, ['operation', 'doctorId', 'date', 'service'], ['doctorId', 'date', 'service']);
  const date = validDate(input.date);
  const doctor = await doctorById(tables, input.doctorId);
  const service = serviceDuration(doctor, input.service);
  const today = localDateForInstant(new Date());
  if (date < today) throw new ClinicalError('invalid_input', 'Past dates cannot be booked.');
  const window = scheduleWindow(doctor, date);
  if (!window) return { date, timezone: APP_TIMEZONE, durationMinutes: service.durationMinutes, slots: [] };
  const startMinute = Number(window.start.slice(0, 2)) * 60 + Number(window.start.slice(3));
  const endMinute = Number(window.end.slice(0, 2)) * 60 + Number(window.end.slice(3));
  const existing = await appointmentsForDoctorDay(tables, doctor.$id, date);
  const active = existing.filter((item) => ACTIVE_STATUSES.includes(item.status));
  const max = Number(doctor.maxPatientsPerDay) || 20;
  const capacityReached = active.length >= max;
  const slots = [];
  for (let minute = startMinute; minute + service.durationMinutes <= endMinute; minute += service.durationMinutes) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const instant = zonedDateTimeToUtc(date, time);
    const conflict = active.some((item) => overlaps(instant, service.durationMinutes, item.scheduledAt, item.durationMinutes || 30));
    const available = !capacityReached && !conflict && instant > new Date();
    slots.push({ time, scheduledAt: instant.toISOString(), available, state: available ? 'available' : 'occupied' });
  }
  return { date, timezone: APP_TIMEZONE, durationMinutes: service.durationMinutes, slots };
}

function safeAppointment(item, doctor) {
  return { id: item.$id, doctor: doctor ? { id: doctor.$id, name: doctor.name, specialization: doctor.specialization } : undefined,
    doctorId: item.doctorProfileId, service: item.service, scheduledAt: item.scheduledAt, durationMinutes: item.durationMinutes,
    status: item.status, prescriptionEligible: ['confirmed', 'completed'].includes(item.status), cancelledAt: item.cancelledAt || null, cancellationReason: item.cancellationReason || null };
}

async function listPatientAppointments(tables, auth) {
  const found = await rows(tables, TABLE.appointments, [Query.equal('patientAuthUserId', [auth.userId]), Query.orderDesc('scheduledAt'), Query.limit(100)]);
  const doctors = new Map();
  for (const id of [...new Set(found.map((item) => item.doctorProfileId))]) {
    try { doctors.set(id, await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: id })); } catch {}
  }
  return found.map((item) => safeAppointment(item, doctors.get(item.doctorProfileId)));
}

async function notification(tables, userId, type, message, resourceId, resourceType = 'appointment') {
  return tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.notifications, rowId: ID.unique(), data: {
    userAuthUserId: userId, message: String(message).slice(0, 240), type, resourceType, resourceId, read: false
  }, permissions: [] });
}

async function audit(tables, auth, action, resourceId, status = 'success', metadata, log, resourceType = 'appointment') {
  try {
    await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.audit, rowId: ID.unique(), data: {
      userAuthUserId: auth?.userId || null, role: auth?.role || null, action, resourceType: resourceId ? resourceType : null,
      resourceId: resourceId || null, status, metadataSanitized: sanitizeAuditMetadata(metadata), timestampLegacy: new Date().toISOString()
    }, permissions: [] });
    return true;
  } catch { log('Audit write warning.'); return false; }
}

async function ensureNoConflict(tables, doctor, patientId, scheduledAt, durationMinutes) {
  const date = localDateForInstant(scheduledAt);
  const existing = await appointmentsForDoctorDay(tables, doctor.$id, date);
  const active = existing.filter((item) => ACTIVE_STATUSES.includes(item.status));
  if (active.length >= (Number(doctor.maxPatientsPerDay) || 20)) throw new ClinicalError('conflict', 'The doctor has reached daily capacity.', 409);
  const slotKey = deterministicActiveSlotKey(doctor.$id, scheduledAt);
  if (active.some((item) => item.activeSlotKey === slotKey || overlaps(scheduledAt, durationMinutes, item.scheduledAt, item.durationMinutes || 30))) {
    throw new ClinicalError('conflict', 'This appointment time is no longer available.', 409);
  }
  const patient = await rows(tables, TABLE.appointments, [Query.equal('patientAuthUserId', [patientId]), Query.orderDesc('scheduledAt'), Query.limit(100)]);
  if (patient.some((item) => ACTIVE_STATUSES.includes(item.status) && overlaps(scheduledAt, durationMinutes, item.scheduledAt, item.durationMinutes || 30))) {
    throw new ClinicalError('conflict', 'You already have an overlapping appointment.', 409);
  }
  return slotKey;
}

async function createAppointment(tables, auth, input, log) {
  assertKeys(input, ['operation', 'doctorId', 'service', 'scheduledAt'], ['doctorId', 'service', 'scheduledAt']);
  const doctor = await doctorById(tables, input.doctorId);
  const service = serviceDuration(doctor, input.service);
  const when = new Date(boundedString(input.scheduledAt, 'appointment datetime', { min: 20, max: 40 }));
  if (Number.isNaN(when.getTime()) || when <= new Date()) throw new ClinicalError('invalid_input', 'Invalid or past appointment time.');
  const date = localDateForInstant(when);
  const window = scheduleWindow(doctor, date);
  if (!window) throw new ClinicalError('conflict', 'The doctor is unavailable on this date.', 409);
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(when);
  const localMinute = Number(local.slice(0, 2)) * 60 + Number(local.slice(3));
  const start = Number(window.start.slice(0, 2)) * 60 + Number(window.start.slice(3));
  const end = Number(window.end.slice(0, 2)) * 60 + Number(window.end.slice(3));
  if (localMinute < start || localMinute + service.durationMinutes > end) throw new ClinicalError('conflict', 'The selected time is outside doctor availability.', 409);
  let slotKey = await ensureNoConflict(tables, doctor, auth.userId, when, service.durationMinutes);
  slotKey = await ensureNoConflict(tables, doctor, auth.userId, when, service.durationMinutes);
  const created = await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.appointments, rowId: ID.unique(), data: {
    patientAuthUserId: auth.userId, doctorProfileId: doctor.$id, service: service.name, scheduledAt: when.toISOString(),
    durationMinutes: service.durationMinutes, status: 'pending', activeSlotKey: slotKey
  }, permissions: [] });
  await Promise.allSettled([
    notification(tables, auth.userId, 'appointment_created', 'Termini u krijua me sukses.', created.$id),
    notification(tables, doctor.authUserId, 'appointment_created', 'Keni një termin të ri.', created.$id),
    audit(tables, auth, 'appointment.create', created.$id, 'success', { appointmentStatus: 'pending' }, log)
  ]);
  return safeAppointment(created, doctor);
}

async function cancelAppointment(tables, auth, input, asDoctor, log) {
  assertKeys(input, ['operation', 'appointmentId', 'reason'], ['appointmentId']);
  const id = validId(input.appointmentId, 'appointment id');
  const reason = input.reason === undefined ? null : boundedString(input.reason, 'cancellation reason', { max: 300 }) || null;
  let item;
  try { item = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.appointments, rowId: id }); }
  catch (error) { if (Number(error?.code) === 404) throw new ClinicalError('not_found', 'Appointment not found.', 404); throw error; }
  if (!ownsAppointment(item, auth, asDoctor)) {
    await audit(tables, auth, 'appointment.cancel.denied', id, 'failure', null, log);
    throw new ClinicalError('not_found', 'Appointment not found.', 404);
  }
  if (!ACTIVE_STATUSES.includes(item.status)) throw new ClinicalError('invalid_transition', 'This appointment cannot be cancelled.', 409);
  const updated = await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.appointments, rowId: id, data: {
    status: 'cancelled', activeSlotKey: null, cancelledByAuthUserId: auth.userId, cancelledByRole: auth.role,
    cancelledAt: new Date().toISOString(), cancellationReason: reason
  } });
  const recipient = asDoctor ? item.patientAuthUserId : (await doctorById(tables, item.doctorProfileId)).authUserId;
  await Promise.allSettled([
    notification(tables, recipient, 'appointment_cancelled', 'Një termin është anuluar. Hapni orarin për detaje.', id),
    audit(tables, auth, asDoctor ? 'appointment.doctor_cancel' : 'appointment.patient_cancel', id, 'success', null, log)
  ]);
  return safeAppointment(updated);
}

async function listDoctorAppointments(tables, auth) {
  const found = await rows(tables, TABLE.appointments, [Query.equal('doctorProfileId', [auth.doctor.$id]), Query.orderDesc('scheduledAt'), Query.limit(100)]);
  const profiles = new Map();
  for (const userId of [...new Set(found.map((item) => item.patientAuthUserId))]) {
    const p = await rows(tables, TABLE.profiles, [Query.equal('authUserId', [userId]), Query.limit(2)]);
    if (p.length === 1) profiles.set(userId, { id: userId, name: p[0].name });
  }
  return found.map((item) => ({ ...safeAppointment(item), patient: profiles.get(item.patientAuthUserId) || { id: item.patientAuthUserId, name: 'Pacient' } }));
}

async function updateStatus(tables, auth, input, log) {
  assertKeys(input, ['operation', 'appointmentId', 'status'], ['appointmentId', 'status']);
  const id = validId(input.appointmentId, 'appointment id');
  const status = boundedString(input.status, 'appointment status', { min: 7, max: 9 });
  const item = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.appointments, rowId: id });
  if (item.doctorProfileId !== auth.doctor.$id) {
    await audit(tables, auth, 'appointment.status.denied', id, 'failure', null, log);
    throw new ClinicalError('not_found', 'Appointment not found.', 404);
  }
  if (!transitionAllowed(item.status, status) || status === 'cancelled') throw new ClinicalError('invalid_transition', 'Invalid appointment status transition.', 409);
  const updated = await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.appointments, rowId: id,
    data: { status, activeSlotKey: status === 'completed' ? null : item.activeSlotKey } });
  await Promise.allSettled([
    notification(tables, item.patientAuthUserId, 'appointment_changed', status === 'confirmed' ? 'Termini juaj u konfirmua.' : 'Termini juaj u përfundua.', id),
    audit(tables, auth, status === 'confirmed' ? 'appointment.confirm' : 'appointment.complete', id, 'success', { appointmentStatus: status }, log)
  ]);
  return safeAppointment(updated);
}

async function listNotifications(tables, auth, limit) {
  const safeLimit = limit === undefined ? 30 : boundedInteger(limit, 'limit', 1, 100);
  const found = await rows(tables, TABLE.notifications, [Query.equal('userAuthUserId', [auth.userId]), Query.orderDesc('$createdAt'), Query.limit(safeLimit)]);
  const unread = (await rows(tables, TABLE.notifications, [Query.equal('userAuthUserId', [auth.userId]), Query.equal('read', [false]), Query.limit(100)])).length;
  return { notifications: found.map((item) => ({ id: item.$id, message: item.message, type: item.type, resourceType: item.resourceType,
    resourceId: item.resourceId, read: item.read, readAt: item.readAt, createdAt: item.$createdAt })), unread };
}

function conversationKey(a, b) { return [String(a), String(b)].sort().join(':'); }
function messageTime(item) { return String(item.createdAtLegacy || item.$createdAt || ''); }
function safeMessage(item, auth) {
  return { id: item.$id, fromRole: item.senderAuthUserId === auth.userId ? auth.role : (auth.role === 'doctor' ? 'patient' : 'doctor'),
    text: item.content, at: item.createdAtLegacy || item.$createdAt, readAt: item.readAt || null };
}

async function authorizedMessagePeer(tables, auth, input) {
  if (auth.role === 'patient') {
    assertKeys(input, ['operation', 'doctorId', 'clientRequestId', 'content', 'limit'], ['doctorId']);
    const doctor = await doctorById(tables, input.doctorId);
    const relationship = await rows(tables, TABLE.appointments, [Query.equal('patientAuthUserId', [auth.userId]), Query.equal('doctorProfileId', [doctor.$id]), Query.limit(1)]);
    if (!relationship.length) throw new ClinicalError('not_found', 'Conversation not found.', 404);
    return { authUserId: doctor.authUserId, name: doctor.name, doctorId: doctor.$id };
  }
  assertKeys(input, ['operation', 'patientId', 'clientRequestId', 'content', 'limit'], ['patientId']);
  const patientId = validId(input.patientId, 'patient id');
  const relationship = await rows(tables, TABLE.appointments, [Query.equal('patientAuthUserId', [patientId]), Query.equal('doctorProfileId', [auth.doctor.$id]), Query.limit(1)]);
  if (!relationship.length) throw new ClinicalError('not_found', 'Conversation not found.', 404);
  const profile = await profileForPatient(tables, patientId);
  return { authUserId: patientId, name: profile.name };
}

async function listMyConversations(tables, auth) {
  const appointments = auth.role === 'doctor'
    ? await rows(tables, TABLE.appointments, [Query.equal('doctorProfileId', [auth.doctor.$id]), Query.limit(100)])
    : await rows(tables, TABLE.appointments, [Query.equal('patientAuthUserId', [auth.userId]), Query.limit(100)]);
  const peers = new Map();
  if (auth.role === 'doctor') {
    for (const patientId of [...new Set(appointments.map((item) => item.patientAuthUserId))]) {
      try { const p = await profileForPatient(tables, patientId); peers.set(patientId, { id: patientId, name: p.name, role: 'patient' }); } catch {}
    }
  } else {
    for (const doctorId of [...new Set(appointments.map((item) => item.doctorProfileId))]) {
      try { const d = await doctorById(tables, doctorId); peers.set(d.authUserId, { doctorId: d.$id, name: d.name, role: 'doctor' }); } catch {}
    }
  }
  const mine = (await rows(tables, TABLE.messages, [Query.or([Query.equal('senderAuthUserId', [auth.userId]), Query.equal('receiverAuthUserId', [auth.userId])]), Query.orderDesc('$createdAt'), Query.limit(100)])).sort((a, b) => messageTime(b).localeCompare(messageTime(a)));
  for (const item of mine) {
    const peerId = item.senderAuthUserId === auth.userId ? item.receiverAuthUserId : item.senderAuthUserId;
    const peer = peers.get(peerId); if (!peer) continue;
    if (!peer.lastMessageAt) peer.lastMessageAt = messageTime(item);
    if (item.receiverAuthUserId === auth.userId && !item.readAt) peer.unread = (peer.unread || 0) + 1;
  }
  return { conversations: [...peers.values()].sort((a, b) => String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || ''))) };
}

async function listConversationMessages(tables, auth, input) {
  const peer = await authorizedMessagePeer(tables, auth, input);
  const limit = input.limit === undefined ? 100 : boundedInteger(input.limit, 'limit', 1, 100);
  const found = await rows(tables, TABLE.messages, [Query.equal('conversationKey', [conversationKey(auth.userId, peer.authUserId)]), Query.orderDesc('$createdAt'), Query.limit(limit)]);
  found.sort((a, b) => messageTime(a).localeCompare(messageTime(b)));
  return { messages: found.map((item) => safeMessage(item, auth)) };
}

async function sendMessage(tables, auth, input) {
  const peer = await authorizedMessagePeer(tables, auth, input);
  const content = boundedString(input.content, 'message content', { min: 1, max: 4000 });
  const clientRequestId = boundedString(input.clientRequestId, 'client request id', { min: 8, max: 64, pattern: /^[A-Za-z0-9._-]+$/ });
  try {
    const item = await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.messages, rowId: ID.unique(), data: {
      senderAuthUserId: auth.userId, receiverAuthUserId: peer.authUserId, conversationKey: conversationKey(auth.userId, peer.authUserId),
      content, readAt: null, clientRequestId
    }, permissions: [Permission.read(Role.user(auth.userId)), Permission.read(Role.user(peer.authUserId))] });
    return { message: safeMessage(item, auth) };
  } catch (error) {
    if (Number(error?.code) === 409) throw new ClinicalError('duplicate_request', 'This message was already sent.', 409);
    throw error;
  }
}

async function markConversationRead(tables, auth, input) {
  const peer = await authorizedMessagePeer(tables, auth, input);
  const unread = await rows(tables, TABLE.messages, [Query.equal('conversationKey', [conversationKey(auth.userId, peer.authUserId)]), Query.equal('receiverAuthUserId', [auth.userId]), Query.isNull('readAt'), Query.limit(100)]);
  const readAt = new Date().toISOString();
  await Promise.all(unread.map((item) => tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.messages, rowId: item.$id, data: { readAt } })));
  return { updated: unread.length, readAt };
}

function prescriptionSummary(item) {
  return { id: item.$id, title: item.title, status: item.status, appointmentId: item.appointmentId || null,
    referenceNumber: `RX-${item.$id.slice(-8).toUpperCase()}`, issuedAt: item.$createdAt, createdAt: item.$createdAt };
}

function safePrescriptionDoctor(doctor) {
  const name = String(doctor?.name || '').trim();
  return doctor?.isActive === true && name && !name.includes('@') ? { name } : null;
}

function prescriptionContent(item) {
  try { return JSON.parse(decryptMedical(item.encryptedBody)); } catch { return null; }
}

async function profileForPatient(tables, userId) {
  const profile = await exactlyOneByAuth(tables, TABLE.profiles, validId(userId, 'patient id'), 'Patient not found.');
  if (profile.isActive !== true || profile.role !== 'patient') throw new ClinicalError('not_found', 'Patient not found.', 404);
  return profile;
}

async function prescriptionDetails(tables, auth, id, asDoctor, log) {
  let item;
  try { item = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.prescriptions, rowId: validId(id, 'prescription id') }); }
  catch (error) { if (Number(error?.code) === 404) throw new ClinicalError('not_found', 'Prescription not found.', 404); throw error; }
  const owns = asDoctor ? item.doctorAuthUserId === auth.userId : item.patientAuthUserId === auth.userId;
  if (!owns) {
    await audit(tables, auth, 'prescription.access_denied', item.$id, 'failure', null, log, 'prescription');
    throw new ClinicalError('not_found', 'Prescription not found.', 404);
  }
  let content;
  try { content = JSON.parse(decryptMedical(item.encryptedBody)); } catch (error) { if (error instanceof ClinicalError) throw error; throw new ClinicalError('encryption_error', 'Prescription could not be read.', 422); }
  const patient = await profileForPatient(tables, item.patientAuthUserId);
  let doctor = null; const doctors = await rows(tables, TABLE.doctors, [Query.equal('authUserId', [item.doctorAuthUserId]), Query.limit(2)]); if (doctors.length === 1) doctor = doctors[0];
  let appointment = null; if (item.appointmentId) { try { appointment = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.appointments, rowId: item.appointmentId }); } catch {} }
  await audit(tables, auth, 'prescription.access', item.$id, 'success', null, log, 'prescription');
  const safeDoctor = safePrescriptionDoctor(doctor);
  return { ...prescriptionSummary(item), content, patient: { name: patient.name }, doctor: safeDoctor ? { ...safeDoctor, specialization: doctor.specialization } : null,
    appointment: appointment ? { id: appointment.$id, scheduledAt: appointment.scheduledAt } : null };
}

async function createPrescription(tables, auth, input, log) {
  assertKeys(input, ['operation', 'patientId', 'appointmentId', 'diagnosis', 'medicationName', 'dosage', 'frequency', 'duration', 'instructions', 'additionalNotes'], ['patientId', 'appointmentId', 'diagnosis', 'medicationName', 'dosage', 'frequency', 'duration', 'instructions']);
  const patientId = validId(input.patientId, 'patient id'); const appointmentId = validId(input.appointmentId, 'appointment id');
  await profileForPatient(tables, patientId);
  let appointment;
  try { appointment = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.appointments, rowId: appointmentId }); }
  catch (error) { if (Number(error?.code) === 404) throw new ClinicalError('not_found', 'Appointment not found.', 404); throw error; }
  if (appointment.doctorProfileId !== auth.doctor.$id || appointment.patientAuthUserId !== patientId) throw new ClinicalError('not_found', 'Appointment not found.', 404);
  if (!['confirmed', 'completed'].includes(appointment.status)) throw new ClinicalError('invalid_state', 'Appointment is not eligible for a prescription.', 409);
  const existing = await rows(tables, TABLE.prescriptions, [Query.equal('appointmentId', [appointmentId]), Query.limit(2)]);
  if (existing.length) throw new ClinicalError('conflict', 'A prescription already exists for this appointment.', 409);
  const content = validatePrescriptionContent({ diagnosis: input.diagnosis, medicationName: input.medicationName, dosage: input.dosage,
    frequency: input.frequency, duration: input.duration, instructions: input.instructions, ...(input.additionalNotes === undefined ? {} : { additionalNotes: input.additionalNotes }) });
  const title = 'Recept digjital';
  const created = await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.prescriptions, rowId: ID.unique(), data: {
    patientAuthUserId: patientId, doctorAuthUserId: auth.userId, appointmentId, title, encryptedBody: encryptMedical(content), status: 'active', encryptionVersion: ENCRYPTION_VERSION
  }, permissions: [] });
  await Promise.allSettled([
    notification(tables, patientId, 'prescription_created', 'Një recept i ri digjital është i disponueshëm.', created.$id, 'prescription'),
    audit(tables, auth, 'prescription.create', created.$id, 'success', { appointmentStatus: appointment.status }, log, 'prescription')
  ]);
  return prescriptionSummary(created);
}

async function ownedDoctorPrescription(tables, auth, prescriptionId, log, action) {
  let item;
  try { item = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.prescriptions, rowId: validId(prescriptionId, 'prescription id') }); }
  catch (error) { if (Number(error?.code) === 404) throw new ClinicalError('not_found', 'Prescription not found.', 404); throw error; }
  if (item.doctorAuthUserId !== auth.userId) {
    await audit(tables, auth, `prescription.${action}_denied`, item.$id, 'failure', null, log, 'prescription');
    throw new ClinicalError('not_found', 'Prescription not found.', 404);
  }
  return item;
}

async function updateDoctorPrescription(tables, auth, input, log) {
  assertKeys(input, ['operation', 'prescriptionId', 'diagnosis', 'medicationName', 'dosage', 'frequency', 'duration', 'instructions', 'additionalNotes'],
    ['prescriptionId', 'diagnosis', 'medicationName', 'dosage', 'frequency', 'duration', 'instructions']);
  const item = await ownedDoctorPrescription(tables, auth, input.prescriptionId, log, 'edit');
  if (item.status === 'cancelled') throw new ClinicalError('invalid_state', 'Archived prescription cannot be edited.', 409);
  const content = validatePrescriptionContent({ diagnosis: input.diagnosis, medicationName: input.medicationName, dosage: input.dosage,
    frequency: input.frequency, duration: input.duration, instructions: input.instructions,
    ...(input.additionalNotes === undefined ? {} : { additionalNotes: input.additionalNotes }) });
  const updated = await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.prescriptions, rowId: item.$id,
    data: { encryptedBody: encryptMedical(content), encryptionVersion: ENCRYPTION_VERSION } });
  await audit(tables, auth, 'prescription.edit', item.$id, 'success', null, log, 'prescription');
  return { ...prescriptionSummary(updated), content };
}

async function deleteDoctorPrescription(tables, auth, input, log) {
  assertKeys(input, ['operation', 'prescriptionId'], ['prescriptionId']);
  const item = await ownedDoctorPrescription(tables, auth, input.prescriptionId, log, 'delete');
  if (item.status === 'cancelled') throw new ClinicalError('invalid_state', 'Prescription is already archived.', 409);
  await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.prescriptions, rowId: item.$id, data: { status: 'cancelled' } });
  await audit(tables, auth, 'prescription.archive', item.$id, 'success', null, log, 'prescription');
  return { ok: true, prescriptionId: item.$id, status: 'cancelled' };
}

export async function patientHistory(tables, patientId, doctorFilter) {
  const queries = [Query.equal('patientAuthUserId', [patientId]), Query.orderDesc('scheduledAt'), Query.limit(100)];
  const appointments = (await rows(tables, TABLE.appointments, queries)).filter((item) => item.status === 'completed' && (!doctorFilter || item.doctorProfileId === doctorFilter));
  const prescriptions = await rows(tables, TABLE.prescriptions, [Query.equal('patientAuthUserId', [patientId]), Query.orderDesc('$createdAt'), Query.limit(100)]);
  const doctors = new Map();
  for (const id of [...new Set(appointments.map((item) => item.doctorProfileId))]) { try { doctors.set(id, await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: id })); } catch {} }
  return buildPatientHistory(appointments, prescriptions, doctors, patientId, doctorFilter);
}

async function uploadRecord(storage, tables, auth, input, log) {
  assertKeys(input, ['operation', 'filename', 'mimeType', 'base64', 'notes'], ['filename', 'mimeType', 'base64']);
  const pdf = validatePdf(input); const notes = input.notes === undefined ? null : boundedString(input.notes, 'notes', { max: 5000 }) || null;
  const fileId = ID.unique();
  await storage.createFile({ bucketId: BUCKET_ID, fileId, file: InputFile.fromBuffer(pdf.bytes, 'medical.pdf'), permissions: [Permission.read(Role.user(auth.userId))] });
  let record;
  try {
    record = await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.records, rowId: ID.unique(), data: {
      patientAuthUserId: auth.userId, storageFileId: fileId, originalNameEncrypted: encryptMedical(pdf.safeName), mimeType: 'application/pdf', sizeBytes: pdf.bytes.length,
      sha256: pdf.sha256, encryptedNotes: notes ? encryptMedical(notes) : null, encryptionVersion: ENCRYPTION_VERSION
    }, permissions: [] });
  } catch (error) { await storage.deleteFile({ bucketId: BUCKET_ID, fileId }).catch(() => {}); throw error; }
  await Promise.allSettled([
    notification(tables, auth.userId, 'medical_record_created', 'Dokumenti i ri mjekësor është i disponueshëm.', record.$id, 'medical_record'),
    audit(tables, auth, 'medical_record.upload', record.$id, 'success', { sizeBytes: pdf.bytes.length }, log, 'medical_record')
  ]);
  return { id: record.$id, createdAt: record.$createdAt, sizeBytes: record.sizeBytes, mimeType: record.mimeType };
}

async function authorizeDownload(storage, tables, auth, input, log) {
  assertKeys(input, ['operation', 'recordId'], ['recordId']); let record;
  try { record = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.records, rowId: validId(input.recordId, 'record id') }); }
  catch (error) { if (Number(error?.code) === 404) throw new ClinicalError('not_found', 'Medical record not found.', 404); throw error; }
  if (record.patientAuthUserId !== auth.userId) {
    await audit(tables, auth, 'medical_record.access_denied', record.$id, 'failure', null, log, 'medical_record');
    throw new ClinicalError('not_found', 'Medical record not found.', 404);
  }
  const bytes = Buffer.from(await storage.getFileDownload({ bucketId: BUCKET_ID, fileId: record.storageFileId }));
  if (bytes.length !== record.sizeBytes || !record.sha256 || checksum(bytes) !== record.sha256) {
    await audit(tables, auth, 'medical_record.integrity_failure', record.$id, 'failure', null, log, 'medical_record');
    throw new ClinicalError('integrity_error', 'Medical file integrity validation failed.', 409);
  }
  await audit(tables, auth, 'medical_record.download', record.$id, 'success', null, log, 'medical_record');
  return { recordId: record.$id, fileId: record.storageFileId, filename: decryptMedical(record.originalNameEncrypted), mimeType: record.mimeType, sizeBytes: record.sizeBytes };
}

export async function route(tables, storage, auth, input, log) {
  const op = input.operation;
  if (PATIENT_OPS.has(op)) assertRole(auth.role, 'patient');
  if (DOCTOR_OPS.has(op)) assertRole(auth.role, 'doctor');
  switch (op) {
    case 'listDoctors': return listDoctors(tables, input);
    case 'getDoctorAvailability': { assertKeys(input, ['operation', 'doctorId'], ['doctorId']); return { doctor: safeDoctor(await doctorById(tables, input.doctorId)), timezone: APP_TIMEZONE }; }
    case 'getAvailableSlots': return availableSlots(tables, input);
    case 'getQueueStatus': {
      assertKeys(input, ['operation', 'doctorId'], ['doctorId']); const doctor = await doctorById(tables, input.doctorId);
      const today = localDateForInstant(new Date()); const active = (await appointmentsForDoctorDay(tables, doctor.$id, today)).filter((item) => ACTIVE_STATUSES.includes(item.status));
      return { doctor: { id: doctor.$id, name: doctor.name }, queue: { activeAppointments: active.length, capacity: doctor.maxPatientsPerDay, timezone: APP_TIMEZONE } };
    }
    case 'getPatientDashboard': {
      assertKeys(input, ['operation']);
      const [appointments, prescriptions, medicalHistory] = await Promise.all([
        listPatientAppointments(tables, auth),
        ownedRowCount(tables, TABLE.prescriptions, auth.userId),
        ownedRowCount(tables, TABLE.records, auth.userId)
      ]);
      return { schedule: { appointments }, counts: { prescriptions, medicalHistory } };
    }
    case 'listMyAppointments': return { appointments: await listPatientAppointments(tables, auth) };
    case 'createAppointment': return { appointment: await createAppointment(tables, auth, input, log) };
    case 'cancelMyAppointment': return { appointment: await cancelAppointment(tables, auth, input, false, log) };
    case 'listMyPrescriptions': {
      assertKeys(input, ['operation', 'limit']); const limit = input.limit === undefined ? 50 : boundedInteger(input.limit, 'limit', 1, 100);
      const found = await rows(tables, TABLE.prescriptions, [Query.equal('patientAuthUserId', [auth.userId]), Query.orderDesc('$createdAt'), Query.limit(limit)]);
      const doctorIds = [...new Set(found.map((item) => item.doctorAuthUserId).filter(Boolean))];
      const doctors = new Map();
      for (const doctorAuthUserId of doctorIds) {
        const matches = await rows(tables, TABLE.doctors, [Query.equal('authUserId', [doctorAuthUserId]), Query.limit(2)]);
        if (matches.length === 1) doctors.set(doctorAuthUserId, safePrescriptionDoctor(matches[0]));
      }
      return { prescriptions: found.map((item) => ({ ...prescriptionSummary(item), content: prescriptionContent(item), doctor: doctors.get(item.doctorAuthUserId) || null })) };
    }
    case 'getMyPrescription': assertKeys(input, ['operation', 'prescriptionId'], ['prescriptionId']); return { prescription: await prescriptionDetails(tables, auth, input.prescriptionId, false, log) };
    case 'listMyMedicalHistory': assertKeys(input, ['operation']); return { history: await patientHistory(tables, auth.userId) };
    case 'listMyMedicalRecords': {
      assertKeys(input, ['operation', 'limit']); const limit = input.limit === undefined ? 50 : boundedInteger(input.limit, 'limit', 1, 100);
      const found = await rows(tables, TABLE.records, [Query.equal('patientAuthUserId', [auth.userId]), Query.orderDesc('$createdAt'), Query.limit(limit)]);
      return { records: found.map((item) => ({ id: item.$id, mimeType: item.mimeType, sizeBytes: item.sizeBytes, createdAt: item.$createdAt, hasNotes: Boolean(item.encryptedNotes) })) };
    }
    case 'uploadMyMedicalRecord': return { record: await uploadRecord(storage, tables, auth, input, log) };
    case 'downloadMyMedicalRecord': return { download: await authorizeDownload(storage, tables, auth, input, log) };
    case 'listDoctorAppointments': return { appointments: await listDoctorAppointments(tables, auth) };
    case 'listDoctorPatients': {
      assertKeys(input, ['operation']); const apps = await listDoctorAppointments(tables, auth); const unique = new Map();
      for (const item of apps) if (item.patient?.id) unique.set(item.patient.id, item.patient); return { patients: [...unique.values()] };
    }
    case 'listDoctorPrescriptions': {
      assertKeys(input, ['operation', 'limit']); const limit = input.limit === undefined ? 50 : boundedInteger(input.limit, 'limit', 1, 100);
      const found = await rows(tables, TABLE.prescriptions, [Query.equal('doctorAuthUserId', [auth.userId]), Query.orderDesc('$createdAt'), Query.limit(limit)]);
      const prescriptions = [];
      for (const item of found) {
        const content = prescriptionContent(item);
        let patient = null; try { const profile = await profileForPatient(tables, item.patientAuthUserId); patient = { name: profile.name }; } catch {}
        prescriptions.push({ ...prescriptionSummary(item), patient, content });
      }
      return { prescriptions };
    }
    case 'getDoctorPrescription': assertKeys(input, ['operation', 'prescriptionId'], ['prescriptionId']); return { prescription: await prescriptionDetails(tables, auth, input.prescriptionId, true, log) };
    case 'createPrescription': return { prescription: await createPrescription(tables, auth, input, log) };
    case 'updateDoctorPrescription': return { prescription: await updateDoctorPrescription(tables, auth, input, log) };
    case 'deleteDoctorPrescription': return deleteDoctorPrescription(tables, auth, input, log);
    case 'getAssignedPatientHistory': {
      assertKeys(input, ['operation', 'patientId'], ['patientId']); const patientId = validId(input.patientId, 'patient id');
      const relationship = await rows(tables, TABLE.appointments, [Query.equal('doctorProfileId', [auth.doctor.$id]), Query.equal('patientAuthUserId', [patientId]), Query.limit(1)]);
      if (!relationship.length) { await audit(tables, auth, 'medical_history.access_denied', null, 'failure', null, log, 'medical_history'); throw new ClinicalError('not_found', 'Patient history not found.', 404); }
      return { history: await patientHistory(tables, patientId, auth.doctor.$id) };
    }
    case 'updateAppointmentStatus': return { appointment: await updateStatus(tables, auth, input, log) };
    case 'cancelDoctorAppointment': return { appointment: await cancelAppointment(tables, auth, input, true, log) };
    case 'getDoctorSchedule': { assertKeys(input, ['operation']); return { schedule: safeDoctor(auth.doctor).availability, timezone: APP_TIMEZONE }; }
    case 'updateDoctorSchedule': {
      const update = validateScheduleUpdate(input); const doctor = await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.doctors, rowId: auth.doctor.$id, data: update });
      await audit(tables, auth, 'doctor.schedule_update', null, 'success', { fieldsUpdated: Object.keys(update).sort().join(',') }, log);
      return { schedule: safeDoctor(doctor).availability, timezone: APP_TIMEZONE };
    }
    case 'listMyNotifications': assertKeys(input, ['operation', 'limit']); return listNotifications(tables, auth, input.limit);
    case 'markNotificationRead': {
      assertKeys(input, ['operation', 'notificationId'], ['notificationId']); const id = validId(input.notificationId, 'notification id');
      const item = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.notifications, rowId: id });
      if (!ownsNotification(item, auth.userId)) throw new ClinicalError('not_found', 'Notification not found.', 404);
      const updated = await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.notifications, rowId: id, data: { read: true, readAt: new Date().toISOString() } });
      return { notification: { id: updated.$id, read: updated.read, readAt: updated.readAt } };
    }
    case 'markAllNotificationsRead': {
      assertKeys(input, ['operation']); const unread = await rows(tables, TABLE.notifications, [Query.equal('userAuthUserId', [auth.userId]), Query.equal('read', [false]), Query.limit(100)]);
      const now = new Date().toISOString(); await Promise.all(unread.map((item) => tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.notifications, rowId: item.$id, data: { read: true, readAt: now } })));
      return { ok: true, updated: unread.length };
    }
    case 'listMyConversations': assertKeys(input, ['operation']); return listMyConversations(tables, auth);
    case 'listConversationMessages': return listConversationMessages(tables, auth, input);
    case 'sendMessage': return sendMessage(tables, auth, input);
    case 'markConversationRead': return markConversationRead(tables, auth, input);
    default: throw new ClinicalError('invalid_input', 'Unknown operation.');
  }
}

async function bootstrapPatient(users, tables, userId) {
  const authUser = await users.get({ userId });
  const labels = [...new Set((authUser.labels || []).map((label) => String(label).toLowerCase()))];
  if (labels.some((label) => label !== 'patient')) throw new ClinicalError('conflict', 'Account role conflict.', 409);
  const matches = await rows(tables, TABLE.profiles, [Query.equal('authUserId', [userId]), Query.limit(2)]);
  if (matches.length > 1 || (matches[0] && (matches[0].role !== 'patient' || matches[0].isActive !== true))) throw new ClinicalError('conflict', 'Profile conflict.', 409);
  if (!matches.length) await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.profiles, rowId: userId, data: {
    authUserId: userId, name: String(authUser.name || '').trim(), email: String(authUser.email || '').trim().toLowerCase(), role: 'patient', authProvider: 'email', isActive: true
  }, permissions: [Permission.read(Role.user(userId))] });
  if (!labels.includes('patient')) await users.updateLabels({ userId, labels: ['patient'] });
  return { ok: true };
}

export default async ({ req, res, log, error }) => {
  const userId = String(req.headers['x-appwrite-user-id'] || '').trim();
  const key = String(req.headers['x-appwrite-key'] || process.env.APPWRITE_FUNCTION_API_KEY || '').trim();
  if (!key) return output(res, 401, { ok: false, error: { category: 'unauthenticated', message: 'Authentication required.' } });
  try {
    if (req.path === '/medical-config-health') {
      medicalKey();
      return output(res, 200, { ok: true, configured: true, format: 'hex-64', decodedBytes: 32 });
    }
    const input = req.bodyJson;
    assertPlainObject(input);
    if (input.operation === undefined) throw new ClinicalError('invalid_input', 'Missing required field.');
    const operation = boundedString(input.operation, 'operation', { min: 1, max: 40 });
    if (!ALLOWED_OPS.has(operation)) throw new ClinicalError('invalid_input', 'Unknown operation.');
    if (MEDICAL_OPS.has(operation)) medicalKey();
    const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(key);
    const tables = new TablesDB(client);
    if (PUBLIC_OPS.has(operation)) return output(res, 200, { ok: true, ...(await listPublicDoctors(tables, input)) });
    if (!userId) return output(res, 401, { ok: false, error: { category: 'unauthenticated', message: 'Authentication required.' } });
    const users = new Users(client); const storage = new Storage(client);
    if (operation === 'bootstrap-patient') {
      assertKeys(input, ['operation']);
      return output(res, 200, await bootstrapPatient(users, tables, userId));
    }
    const auth = await authenticate(users, tables, userId);
    return output(res, 200, { ok: true, ...(await route(tables, storage, auth, input, log)) });
  } catch (caught) {
    const known = caught instanceof ClinicalError;
    const status = known ? caught.status : (Number(caught?.code) === 429 ? 429 : 500);
    const category = known ? caught.category : (status === 429 ? 'rate_limited' : 'internal_error');
    if (!known) error(`Clinical operation failed (${Number(caught?.code) || 500}).`);
    return output(res, status, { ok: false, error: { category, message: known ? caught.message : 'The operation could not be completed.' } });
  }
};
