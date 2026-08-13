import { ClinicalError } from './clinical.js';
import { decryptMedical } from './medical.js';

function optionalHistoryText(value, max = 5000) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function appointmentClinicalDetails(item) {
  const empty = { symptoms: null, diagnosis: null, department: null, urgency: null };
  if (!item.notesEncrypted) return empty;
  const plaintext = decryptMedical(item.notesEncrypted);
  let parsed;
  try { parsed = JSON.parse(plaintext); } catch { return { ...empty, symptoms: optionalHistoryText(plaintext) }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
  const urgency = optionalHistoryText(parsed.urgency, 20)?.toLowerCase() || null;
  return {
    symptoms: optionalHistoryText(parsed.symptoms),
    diagnosis: optionalHistoryText(parsed.diagnosis),
    department: optionalHistoryText(parsed.department, 100),
    urgency: ['low', 'medium', 'high'].includes(urgency) ? urgency : null
  };
}

function prescriptionDiagnosis(item) {
  let content;
  try { content = JSON.parse(decryptMedical(item.encryptedBody)); }
  catch (error) { if (error instanceof ClinicalError) throw error; throw new ClinicalError('encryption_error', 'Prescription could not be read.', 422); }
  return optionalHistoryText(content?.diagnosis, 500);
}

function safeHistoryAppointment(item, doctor) {
  return {
    id: item.$id,
    doctor: doctor ? { id: doctor.$id, name: doctor.name, specialization: doctor.specialization } : undefined,
    doctorId: item.doctorProfileId,
    service: item.service,
    scheduledAt: item.scheduledAt,
    durationMinutes: item.durationMinutes,
    status: item.status,
    prescriptionEligible: ['confirmed', 'completed'].includes(item.status),
    cancelledAt: item.cancelledAt || null,
    cancellationReason: item.cancellationReason || null
  };
}

function prescriptionSummary(item) {
  return {
    id: item.$id,
    title: item.title,
    status: item.status,
    appointmentId: item.appointmentId || null,
    referenceNumber: `RX-${item.$id.slice(-8).toUpperCase()}`,
    issuedAt: item.$createdAt,
    createdAt: item.$createdAt
  };
}

export function buildPatientHistory(appointments, prescriptions, doctors, patientId, doctorFilter) {
  return appointments
    .filter((item) => item.status === 'completed' && (!doctorFilter || item.doctorProfileId === doctorFilter))
    .sort((left, right) => new Date(right.scheduledAt).getTime() - new Date(left.scheduledAt).getTime())
    .map((item) => {
      const doctor = doctors.get(item.doctorProfileId);
      const linked = prescriptions.filter((rx) => rx.appointmentId === item.$id && rx.patientAuthUserId === patientId
        && doctor && rx.doctorAuthUserId === doctor.authUserId);
      const details = appointmentClinicalDetails(item);
      if (!details.diagnosis) details.diagnosis = linked.map(prescriptionDiagnosis).find(Boolean) || null;
      return {
        ...safeHistoryAppointment(item, doctor),
        visitDate: item.scheduledAt,
        ...details,
        clinicalDetailsRecorded: Boolean(details.symptoms || details.diagnosis || details.department || details.urgency),
        prescriptions: linked.map(prescriptionSummary)
      };
    });
}
