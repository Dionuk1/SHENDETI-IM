import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupAllowed, decryptMedical, encryptMedical, medicalKey, validatePdf, validatePrescriptionContent } from '../src/medical.js';

const KEY = '11'.repeat(32);

test('medical key is exactly 64 hexadecimal characters and 32 bytes', () => {
  assert.equal(medicalKey(KEY).length, 32);
  assert.throws(() => medicalKey('11'.repeat(31)));
  assert.throws(() => medicalKey('z'.repeat(64)));
});
test('AES-256-GCM round trip is versioned and authenticated', () => {
  const encrypted = encryptMedical({ diagnosis: 'synthetic' }, KEY);
  assert.deepEqual(JSON.parse(decryptMedical(encrypted, KEY)), { diagnosis: 'synthetic' });
  const malformed = JSON.parse(encrypted); malformed.authTag = Buffer.alloc(16).toString('base64');
  assert.throws(() => decryptMedical(JSON.stringify(malformed), KEY));
});
test('prescription validation rejects arbitrary fields', () => {
  const valid = { diagnosis: 'd', medicationName: 'm', dosage: '1', frequency: '1', duration: '1', instructions: 'i' };
  assert.equal(validatePrescriptionContent(valid).diagnosis, 'd');
  assert.throws(() => validatePrescriptionContent({ ...valid, doctorAuthUserId: 'spoof' }));
});
test('PDF validation enforces MIME, extension, signature, non-empty and size', () => {
  const pdf = Buffer.from('%PDF-1.4\n%%EOF').toString('base64');
  assert.equal(validatePdf({ base64: pdf, mimeType: 'application/pdf', filename: 'demo.pdf' }).bytes.length, 14);
  assert.throws(() => validatePdf({ base64: pdf, mimeType: 'text/plain', filename: 'demo.pdf' }));
  assert.throws(() => validatePdf({ base64: Buffer.from('fake').toString('base64'), mimeType: 'application/pdf', filename: 'demo.pdf' }));
});
test('cleanup allowlist accepts only deterministic synthetic IDs', () => {
  assert.equal(cleanupAllowed('phase6c-test-file-1'), true);
  assert.equal(cleanupAllowed('owner-file'), false);
});
