// Europe/Pristina is not an IANA zone in the Node runtime. Europe/Belgrade
// provides the same civil UTC offset and DST rules used by Kosovo.
export const APP_TIMEZONE = 'Europe/Belgrade';
export const ACTIVE_STATUSES = Object.freeze(['pending', 'confirmed']);
export const TERMINAL_STATUSES = Object.freeze(['cancelled', 'completed']);
export const ROLE_LABELS = Object.freeze(['patient', 'doctor', 'admin']);
export const TRANSITIONS = Object.freeze({
  pending: Object.freeze(['confirmed', 'cancelled']),
  confirmed: Object.freeze(['completed', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

export class ClinicalError extends Error {
  constructor(category, message, status = 400) {
    super(message);
    this.name = 'ClinicalError';
    this.category = category;
    this.status = status;
  }
}

export function assertPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ClinicalError('invalid_input', 'Invalid request body.');
  }
  for (const key of Object.keys(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new ClinicalError('invalid_input', 'Invalid request body.');
  }
  return value;
}

export function assertKeys(value, allowed, required = []) {
  assertPlainObject(value);
  const allow = new Set(allowed);
  if (Object.keys(value).some((key) => !allow.has(key))) throw new ClinicalError('invalid_input', 'Unexpected request field.');
  if (required.some((key) => value[key] === undefined || value[key] === null || value[key] === '')) {
    throw new ClinicalError('invalid_input', 'Missing required field.');
  }
}

export function boundedString(value, name, { min = 0, max = 120, pattern } = {}) {
  const result = String(value ?? '').trim();
  if (result.length < min || result.length > max || (pattern && !pattern.test(result))) {
    throw new ClinicalError('invalid_input', `Invalid ${name}.`);
  }
  return result;
}

export function boundedInteger(value, name, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new ClinicalError('invalid_input', `Invalid ${name}.`);
  return number;
}

export function validId(value, name = 'id') {
  return boundedString(value, name, { min: 1, max: 36, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/ });
}

export function validDate(value) {
  return boundedString(value, 'date', { min: 10, max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ });
}

export function validTime(value, name = 'time') {
  const result = boundedString(value, name, { min: 5, max: 5, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ });
  return result;
}

export function minutes(value) {
  const [hour, minute] = validTime(value).split(':').map(Number);
  return hour * 60 + minute;
}

export function deriveRole(labels) {
  const normalized = [...new Set((labels || []).map((label) => String(label).trim().toLowerCase()))];
  const roles = normalized.filter((label) => ROLE_LABELS.includes(label));
  if (roles.length !== 1) throw new ClinicalError('forbidden', 'Account role is not authorized.', 403);
  if (normalized.some((label) => ROLE_LABELS.includes(label) && label !== roles[0])) {
    throw new ClinicalError('forbidden', 'Account role is not authorized.', 403);
  }
  return roles[0];
}

export function assertRole(actual, expected) {
  if (actual !== expected) throw new ClinicalError('forbidden', 'This operation is not allowed for your role.', 403);
}

export function transitionAllowed(from, to) {
  return Boolean(TRANSITIONS[String(from)]?.includes(String(to)));
}

export function ownsNotification(item, userId) {
  return Boolean(item && String(item.userAuthUserId) === String(userId));
}

export function ownsAppointment(item, auth, asDoctor = false) {
  if (!item || !auth) return false;
  return asDoctor ? String(item.doctorProfileId) === String(auth.doctor?.$id) : String(item.patientAuthUserId) === String(auth.userId);
}

export function deterministicActiveSlotKey(doctorProfileId, scheduledAt) {
  const doctorId = validId(doctorProfileId, 'doctor profile id');
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) throw new ClinicalError('invalid_input', 'Invalid appointment datetime.');
  return `${doctorId}:${date.toISOString()}`;
}

export function parseServices(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item) => {
    if (!item || typeof item !== 'object') return null;
    const name = String(item.name || '').trim().slice(0, 120);
    const durationMinutes = Math.max(5, Math.min(480, Number(item.durationMinutes) || 30));
    return name ? { name, durationMinutes, available: item.available !== false } : null;
  }).filter(Boolean);
}

export function publicDoctorSummary(doctor) {
  return {
    id: validId(doctor?.$id, 'doctor id'),
    name: boundedString(doctor?.name, 'doctor name', { min: 1, max: 120 }),
    specialization: boundedString(doctor?.specialization, 'specialization', { min: 1, max: 32 }),
    experience: Math.max(0, Math.min(100, Number(doctor?.experienceYears) || 0)),
    rating: Number.isFinite(Number(doctor?.avgRating)) ? Math.max(0, Math.min(5, Number(doctor.avgRating))) : null,
    services: parseServices(doctor?.servicesJson).filter((item) => item.available).map(({ name, durationMinutes }) => ({ name, durationMinutes }))
  };
}

export function serviceDuration(doctor, service) {
  const name = boundedString(service, 'service', { min: 1, max: 120 });
  const services = parseServices(doctor.servicesJson);
  if (!services.length) return { name, durationMinutes: 30 };
  const match = services.find((item) => item.available && item.name.toLowerCase() === name.toLowerCase());
  if (!match) throw new ClinicalError('invalid_input', 'Selected service is not available.');
  return { name: match.name, durationMinutes: match.durationMinutes };
}

function zonedParts(date, timeZone = APP_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function zonedDateTimeToUtc(dateValue, timeValue, timeZone = APP_TIMEZONE) {
  const date = validDate(dateValue);
  const time = validTime(timeValue);
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const part = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(Number(part.year), Number(part.month) - 1, Number(part.day), Number(part.hour), Number(part.minute));
    guess += Date.UTC(year, month - 1, day, hour, minute) - represented;
  }
  const verify = zonedParts(new Date(guess), timeZone);
  if (`${verify.year}-${verify.month}-${verify.day}` !== date || `${verify.hour}:${verify.minute}` !== time) {
    throw new ClinicalError('invalid_input', 'The selected local time does not exist.');
  }
  return new Date(guess);
}

export function localDateForInstant(date, timeZone = APP_TIMEZONE) {
  const parts = zonedParts(new Date(date), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function weekdayForLocalDate(dateValue) {
  const midday = zonedDateTimeToUtc(validDate(dateValue), '12:00');
  return zonedParts(midday).weekday;
}

export function scheduleWindow(doctor, dateValue) {
  const weekday = weekdayForLocalDate(dateValue);
  if (weekday === 'Sun') {
    if (doctor.sundayOff !== false) return null;
    if (!doctor.weekdayStart || !doctor.weekdayEnd) return null;
    return { start: validTime(doctor.weekdayStart), end: validTime(doctor.weekdayEnd) };
  }
  if (weekday === 'Sat') {
    if (!doctor.saturdayStart || !doctor.saturdayEnd) return null;
    return { start: validTime(doctor.saturdayStart), end: validTime(doctor.saturdayEnd) };
  }
  if (!doctor.weekdayStart || !doctor.weekdayEnd) return null;
  return { start: validTime(doctor.weekdayStart), end: validTime(doctor.weekdayEnd) };
}

export function overlaps(aStart, aDuration, bStart, bDuration) {
  const a = new Date(aStart).getTime();
  const b = new Date(bStart).getTime();
  return a < b + Number(bDuration) * 60000 && a + Number(aDuration) * 60000 > b;
}

export function sanitizeAuditMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const blocked = /password|token|secret|key|prescription|medical|notes|content|body|cookie|authorization/i;
  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (blocked.test(key)) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) safe[key] = typeof value === 'string' ? value.slice(0, 120) : value;
  }
  return Object.keys(safe).length ? JSON.stringify(safe) : null;
}

export function validateScheduleUpdate(input) {
  assertKeys(input, ['operation', 'weekdayStart', 'weekdayEnd', 'saturdayStart', 'saturdayEnd', 'sundayOff', 'maxPatientsPerDay'], []);
  const update = {};
  for (const pair of [['weekdayStart', 'weekdayEnd'], ['saturdayStart', 'saturdayEnd']]) {
    const [startKey, endKey] = pair;
    const hasStart = input[startKey] !== undefined;
    const hasEnd = input[endKey] !== undefined;
    if (hasStart !== hasEnd) throw new ClinicalError('invalid_input', `${startKey} and ${endKey} must be updated together.`);
    if (hasStart) {
      update[startKey] = validTime(input[startKey], startKey);
      update[endKey] = validTime(input[endKey], endKey);
      if (minutes(update[startKey]) >= minutes(update[endKey])) throw new ClinicalError('invalid_input', 'Schedule end must be after start.');
    }
  }
  if (input.sundayOff !== undefined) {
    if (typeof input.sundayOff !== 'boolean') throw new ClinicalError('invalid_input', 'Invalid Sunday setting.');
    update.sundayOff = input.sundayOff;
  }
  if (input.maxPatientsPerDay !== undefined) update.maxPatientsPerDay = boundedInteger(input.maxPatientsPerDay, 'daily patient limit', 1, 100);
  if (!Object.keys(update).length) throw new ClinicalError('invalid_input', 'No schedule fields supplied.');
  return update;
}
