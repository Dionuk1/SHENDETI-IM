import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ClinicalError, deriveRole, deterministicActiveSlotKey, overlaps, ownsAppointment, ownsNotification,
  publicDoctorSummary, sanitizeAuditMetadata, scheduleWindow, serviceDuration, transitionAllowed, validateScheduleUpdate,
  zonedDateTimeToUtc
} from '../src/clinical.js';

test('authorization accepts exactly one clinical role and rejects conflicts/admin clinical access is handled by router', () => {
  assert.equal(deriveRole(['patient']), 'patient');
  assert.equal(deriveRole(['doctor']), 'doctor');
  assert.throws(() => deriveRole([]), ClinicalError);
  assert.throws(() => deriveRole(['patient', 'doctor']), ClinicalError);
});

test('transition matrix permits only pending-confirmed, confirmed-completed, and active cancellation', () => {
  assert.equal(transitionAllowed('pending', 'confirmed'), true);
  assert.equal(transitionAllowed('pending', 'cancelled'), true);
  assert.equal(transitionAllowed('confirmed', 'completed'), true);
  assert.equal(transitionAllowed('confirmed', 'cancelled'), true);
  for (const next of ['pending', 'confirmed', 'cancelled', 'completed']) {
    assert.equal(transitionAllowed('cancelled', next), false);
    assert.equal(transitionAllowed('completed', next), false);
  }
  assert.equal(transitionAllowed('pending', 'completed'), false);
});

test('activeSlotKey is deterministic and UTC-normalized', () => {
  assert.equal(
    deterministicActiveSlotKey('doctor-1', '2026-08-10T08:00:00+02:00'),
    'doctor-1:2026-08-10T06:00:00.000Z'
  );
});

test('overlap detection rejects intersecting windows and permits adjacent slots', () => {
  assert.equal(overlaps('2026-08-10T08:00:00Z', 30, '2026-08-10T08:15:00Z', 30), true);
  assert.equal(overlaps('2026-08-10T08:00:00Z', 30, '2026-08-10T08:30:00Z', 30), false);
});

test('Kosovo civil time uses Europe/Belgrade IANA rules and stores summer time in UTC', () => {
  assert.equal(zonedDateTimeToUtc('2026-08-10', '10:00').toISOString(), '2026-08-10T08:00:00.000Z');
});

test('schedule validation accepts safe fields and rejects reversed or partial windows', () => {
  assert.deepEqual(validateScheduleUpdate({ operation: 'updateDoctorSchedule', weekdayStart: '08:00', weekdayEnd: '16:00', maxPatientsPerDay: 20 }), {
    weekdayStart: '08:00', weekdayEnd: '16:00', maxPatientsPerDay: 20
  });
  assert.throws(() => validateScheduleUpdate({ operation: 'updateDoctorSchedule', weekdayStart: '16:00', weekdayEnd: '08:00' }), ClinicalError);
  assert.throws(() => validateScheduleUpdate({ operation: 'updateDoctorSchedule', weekdayStart: '08:00' }), ClinicalError);
  assert.throws(() => validateScheduleUpdate({ operation: 'updateDoctorSchedule', authUserId: 'spoof' }), ClinicalError);
});

test('service validation derives duration server-side and rejects unavailable services', () => {
  const doctor = { servicesJson: JSON.stringify([{ name: 'Konsultim', durationMinutes: 30, available: true }, { name: 'Privat', durationMinutes: 20, available: false }]) };
  assert.deepEqual(serviceDuration(doctor, 'Konsultim'), { name: 'Konsultim', durationMinutes: 30 });
  assert.throws(() => serviceDuration(doctor, 'Privat'), ClinicalError);
  assert.throws(() => serviceDuration(doctor, 'Injected'), ClinicalError);
});

test('public doctor summary exposes only approved active-list fields', () => {
  const summary = publicDoctorSummary({
    $id: 'doctor-1', name: 'Synthetic Doctor', email: 'private@example.test', authUserId: 'private-auth',
    specialization: 'general', department: 'Private', experienceYears: 7, avgRating: 4.5,
    servicesJson: JSON.stringify([{ name: 'Consultation', durationMinutes: 30, available: true }, { name: 'Hidden', durationMinutes: 20, available: false }]),
    weekdayStart: '08:00', bio: 'Private'
  });
  assert.deepEqual(summary, { id: 'doctor-1', name: 'Synthetic Doctor', specialization: 'general', experience: 7, rating: 4.5, services: [{ name: 'Consultation', durationMinutes: 30 }] });
  assert.deepEqual(Object.keys(summary).sort(), ['experience', 'id', 'name', 'rating', 'services', 'specialization']);
});

test('clinical entrypoint keeps every non-public operation behind user authentication', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /const PUBLIC_OPS = new Set\(\['listPublicDoctors'\]\)/);
  assert.match(source, /if \(PUBLIC_OPS\.has\(operation\)\)[\s\S]*listPublicDoctors/);
  assert.match(source, /if \(!userId\) return output\(res, 401/);
  assert.doesNotMatch(source, /Permission\.update\(Role\.user\(userId\)\)/);
});

test('notification and appointment ownership are exact', () => {
  assert.equal(ownsNotification({ userAuthUserId: 'u1' }, 'u1'), true);
  assert.equal(ownsNotification({ userAuthUserId: 'u2' }, 'u1'), false);
  assert.equal(ownsAppointment({ patientAuthUserId: 'p1' }, { userId: 'p1' }), true);
  assert.equal(ownsAppointment({ doctorProfileId: 'd1' }, { doctor: { $id: 'd1' } }, true), true);
  assert.equal(ownsAppointment({ doctorProfileId: 'd2' }, { doctor: { $id: 'd1' } }, true), false);
});

test('audit metadata removes sensitive keys and truncates safe strings', () => {
  const result = JSON.parse(sanitizeAuditMetadata({ appointmentStatus: 'confirmed', token: 'never', notes: 'medical', count: 1 }));
  assert.deepEqual(result, { appointmentStatus: 'confirmed', count: 1 });
});

test('Sunday-off schedule has no booking window', () => {
  assert.equal(scheduleWindow({ sundayOff: true, weekdayStart: '08:00', weekdayEnd: '16:00' }, '2026-08-09'), null);
});
