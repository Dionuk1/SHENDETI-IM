import crypto from 'node:crypto';
import { ClinicalError, assertPlainObject, boundedString } from './clinical.js';

export const ENCRYPTION_VERSION = 1;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export function medicalKey(value = process.env.MEDICAL_AES_KEY) {
  const text = String(value || '');
  if (!/^[a-fA-F0-9]{64}$/.test(text)) throw new ClinicalError('encryption_error', 'Medical encryption is unavailable.', 503);
  const key = Buffer.from(text, 'hex');
  if (key.length !== 32) throw new ClinicalError('encryption_error', 'Medical encryption is unavailable.', 503);
  return key;
}

export function encryptMedical(value, keyValue) {
  const plaintext = typeof value === 'string' ? value : JSON.stringify(value);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', medicalKey(keyValue), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
}

export function decryptMedical(serialized, keyValue) {
  let payload;
  try { payload = JSON.parse(String(serialized)); } catch { throw new ClinicalError('encryption_error', 'Encrypted medical data is invalid.', 422); }
  assertPlainObject(payload);
  const keys = Object.keys(payload).sort().join(',');
  if (keys !== 'algorithm,authTag,ciphertext,iv,version' || payload.version !== 1 || payload.algorithm !== 'aes-256-gcm') {
    throw new ClinicalError('encryption_error', 'Encrypted medical data is invalid.', 422);
  }
  if (![payload.iv, payload.authTag, payload.ciphertext].every((item) => typeof item === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(item))) {
    throw new ClinicalError('encryption_error', 'Encrypted medical data is invalid.', 422);
  }
  const iv = Buffer.from(payload.iv, 'base64'); const tag = Buffer.from(payload.authTag, 'base64'); const body = Buffer.from(payload.ciphertext, 'base64');
  if (iv.length !== 12 || tag.length !== 16 || body.length < 1) throw new ClinicalError('encryption_error', 'Encrypted medical data is invalid.', 422);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', medicalKey(keyValue), iv); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch { throw new ClinicalError('encryption_error', 'Encrypted medical data could not be read.', 422); }
}

export function validatePrescriptionContent(input) {
  assertPlainObject(input);
  const allowed = ['diagnosis', 'medicationName', 'dosage', 'frequency', 'duration', 'instructions', 'additionalNotes'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new ClinicalError('invalid_input', 'Unexpected prescription field.');
  const required = allowed.slice(0, 6); const result = {};
  for (const key of allowed) {
    if (required.includes(key) || input[key] !== undefined) result[key] = boundedString(input[key], key, { min: required.includes(key) ? 1 : 0, max: key === 'additionalNotes' || key === 'instructions' ? 2000 : 500 });
  }
  return result;
}

export function sanitizeFilename(value) {
  const base = boundedString(value, 'filename', { min: 1, max: 255 }).replace(/\\/g, '/').split('/').pop();
  return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
}

export function validatePdf({ base64, mimeType, filename }) {
  if (mimeType !== 'application/pdf') throw new ClinicalError('unsupported_file', 'Only PDF files are supported.', 415);
  const safeName = sanitizeFilename(filename);
  if (!/\.pdf$/i.test(safeName)) throw new ClinicalError('unsupported_file', 'Only PDF files are supported.', 415);
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new ClinicalError('unsupported_file', 'Invalid PDF data.', 415);
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw new ClinicalError('unsupported_file', 'The PDF is empty.', 415);
  if (bytes.length > MAX_PDF_BYTES) throw new ClinicalError('file_too_large', 'The PDF exceeds 10 MiB.', 413);
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new ClinicalError('unsupported_file', 'Invalid PDF signature.', 415);
  return { bytes, safeName, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

export function checksum(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

export function cleanupAllowed(id) { return /^phase6c-test-[a-z0-9-]{1,20}$/.test(String(id)); }
