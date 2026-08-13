import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encryptMedical } from '../src/medical.js';
import { buildPatientHistory } from '../src/history.js';

const KEY = '33'.repeat(32);
process.env.MEDICAL_AES_KEY = KEY;

function appointment(id, scheduledAt, extra = {}) {
  return {
    $id: id,
    patientAuthUserId: 'patient-test',
    doctorProfileId: 'doctor-profile-test',
    service: 'Synthetic consultation',
    scheduledAt,
    durationMinutes: 30,
    status: 'completed',
    ...extra
  };
}

function build(appointments, prescriptions = [], doctorFilter = 'doctor-profile-test') {
  const doctors = new Map([['doctor-profile-test', {
    $id: 'doctor-profile-test', authUserId: 'doctor-auth-test', name: 'Synthetic Doctor', specialization: 'general'
  }]]);
  return buildPatientHistory(appointments, prescriptions, doctors, 'patient-test', doctorFilter);
}

test('completed visit maps its true date and structured encrypted clinical fields', async () => {
  const notesEncrypted = encryptMedical({ symptoms: 'Synthetic symptom', diagnosis: 'Synthetic diagnosis', department: 'general', urgency: 'high' }, KEY);
  const history = build([appointment('visit-one', '2026-07-01T08:00:00.000Z', { notesEncrypted })]);
  assert.equal(history.length, 1);
  assert.equal(history[0].visitDate, '2026-07-01T08:00:00.000Z');
  assert.equal(history[0].symptoms, 'Synthetic symptom');
  assert.equal(history[0].diagnosis, 'Synthetic diagnosis');
  assert.equal(history[0].department, 'general');
  assert.equal(history[0].urgency, 'high');
  assert.equal(history[0].clinicalDetailsRecorded, true);
});

test('linked prescription supplies diagnosis only for the exact patient, appointment, and doctor', async () => {
  const prescriptions = [
    { $id: 'rx-valid', patientAuthUserId: 'patient-test', doctorAuthUserId: 'doctor-auth-test', appointmentId: 'visit-one', title: 'Synthetic', status: 'active', encryptedBody: encryptMedical({ diagnosis: 'Linked diagnosis' }, KEY), $createdAt: '2026-07-01T09:00:00.000Z' },
    { $id: 'rx-wrong-doctor', patientAuthUserId: 'patient-test', doctorAuthUserId: 'another-doctor', appointmentId: 'visit-one', title: 'Synthetic', status: 'active', encryptedBody: encryptMedical({ diagnosis: 'Must not be exposed' }, KEY), $createdAt: '2026-07-01T09:01:00.000Z' }
  ];
  const history = build([appointment('visit-one', '2026-07-01T08:00:00.000Z')], prescriptions);
  assert.equal(history[0].diagnosis, 'Linked diagnosis');
  assert.deepEqual(history[0].prescriptions.map((item) => item.id), ['rx-valid']);
});

test('completed visit without clinical data remains visible with explicit empty details', async () => {
  const history = build([appointment('visit-empty', '2026-06-01T08:00:00.000Z')]);
  assert.equal(history.length, 1);
  assert.deepEqual(
    { symptoms: history[0].symptoms, diagnosis: history[0].diagnosis, department: history[0].department, urgency: history[0].urgency },
    { symptoms: null, diagnosis: null, department: null, urgency: null }
  );
  assert.equal(history[0].clinicalDetailsRecorded, false);
});

test('multiple completed visits are returned newest first and non-completed rows are excluded', async () => {
  const history = build([
    appointment('older', '2026-05-01T08:00:00.000Z'),
    appointment('pending', '2026-08-01T08:00:00.000Z', { status: 'pending' }),
    appointment('newer', '2026-07-01T08:00:00.000Z')
  ]);
  assert.deepEqual(history.map((item) => item.id), ['newer', 'older']);
});

test('patient with no completed visits returns an empty history', async () => {
  const history = build([appointment('pending', '2026-08-01T08:00:00.000Z', { status: 'pending' })]);
  assert.deepEqual(history, []);
});

test('doctor filter never returns another doctor\'s completed visit', () => {
  assert.deepEqual(build([appointment('visit-one', '2026-07-01T08:00:00.000Z')], [], 'another-doctor-profile'), []);
});

test('assigned-patient route requires the exact doctor and patient relationship and denies no match', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const routeCase = source.slice(source.indexOf("case 'getAssignedPatientHistory'"), source.indexOf("case 'updateAppointmentStatus'"));
  assert.match(routeCase, /Query\.equal\('doctorProfileId', \[auth\.doctor\.\$id\]\)/);
  assert.match(routeCase, /Query\.equal\('patientAuthUserId', \[patientId\]\)/);
  assert.match(routeCase, /if \(!relationship\.length\)[\s\S]*ClinicalError\('not_found'/);
  assert.match(routeCase, /patientHistory\(tables, patientId, auth\.doctor\.\$id\)/);
});

test('history mapping does not log decrypted clinical values', () => {
  const source = readFileSync(new URL('../src/history.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.|\blog\s*\(|\baudit\s*\(/);
});
