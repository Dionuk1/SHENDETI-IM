import test from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../src/main.js';

function queryContains(queries, value) {
  return JSON.stringify(queries).includes(value);
}

test('patient dashboard returns only authenticated owner counts without private rows', async () => {
  const calls = [];
  const tables = {
    async listRows({ tableId, queries }) {
      calls.push({ tableId, queries });
      assert.equal(queryContains(queries, 'patient-auth-1'), true);
      if (tableId === 'appointments') return { total: 0, rows: [] };
      if (tableId === 'prescriptions') return { total: 2, rows: [{ encryptedBody: 'must-not-return' }] };
      if (tableId === 'medical_records') return { total: 3, rows: [{ encryptedNotes: 'must-not-return' }] };
      throw new Error(`Unexpected table ${tableId}`);
    }
  };
  const result = await route(tables, {}, { userId: 'patient-auth-1', role: 'patient' }, { operation: 'getPatientDashboard' }, () => {});
  assert.deepEqual(result, { schedule: { appointments: [] }, counts: { prescriptions: 2, medicalHistory: 3 } });
  assert.equal(JSON.stringify(result).includes('must-not-return'), false);
  assert.deepEqual(calls.map((call) => call.tableId).sort(), ['appointments', 'medical_records', 'prescriptions']);
});

test('patient dashboard rejects frontend identity spoofing and non-patient roles', async () => {
  const tables = { listRows: async () => ({ total: 0, rows: [] }) };
  await assert.rejects(
    () => route(tables, {}, { userId: 'patient-auth-1', role: 'patient' }, { operation: 'getPatientDashboard', patientId: 'patient-auth-2' }, () => {}),
    /Unexpected request field/
  );
  await assert.rejects(
    () => route(tables, {}, { userId: 'doctor-auth-1', role: 'doctor' }, { operation: 'getPatientDashboard' }, () => {}),
    /not allowed for your role/
  );
});
