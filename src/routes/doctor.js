const express = require('express');
const mongoose = require('mongoose');

const Appointment = require('../models/Appointment');
const Prescription = require('../models/Prescription');
const User = require('../models/User');
const Doctor = require('../models/Doctor');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { decryptPrescriptionContent, encryptPrescriptionContent, prescriptionContentFromInput, prescriptionReference } = require('../utils/prescriptions');
const { cancelAppointment } = require('../utils/appointments');
const { writeAudit } = require('../utils/audit');
const { createNotification } = require('../utils/notifications');

const router = express.Router();

function safePrescriptionError(error) {
    const field = error?.name === 'ValidationError' ? Object.keys(error.errors || {})[0] || null : null;
    const kind = field ? String(error.errors[field]?.kind || 'validation') : null;
    return {
        type: String(error?.name || 'Error'),
        field,
        statusCode: Number(error?.statusCode || error?.status || 500),
        validationMessage: field ? `Field ${field} failed ${kind} validation.` : 'Prescription creation failed.',
    };
}

async function requireActiveDoctorProfile(req) {
    const doctor = await Doctor.findOne({
        email: String(req.user.email || '').toLowerCase().trim(),
        isActive: true,
    }).select('_id name');
    if (!doctor) {
        const error = new Error('Active doctor profile required');
        error.statusCode = 403;
        throw error;
    }
    return doctor;
}

function editablePrescriptionContent(input) {
    const content = prescriptionContentFromInput(input || {});
    if (content.legacy || !content.diagnosis || !content.medicationName || !content.dosage
        || !content.frequency || !content.duration || !content.instructions) {
        return null;
    }
    return content;
}

router.use(requireAuth, requireRole('doctor'));

router.get('/appointments', async (req, res, next) => {
    try {
        // Appointments are stored with doctorId pointing to the Doctor collection.
        const doctor = await Doctor.findOne({ email: String(req.user.email || '').toLowerCase().trim() })
            .select('_id')
            .lean();

        if (!doctor?._id) {
            return res.json({ appointments: [] });
        }

        const apps = await Appointment.find({ doctorId: doctor._id })
            .populate('patientId', 'name email')
            .sort({ scheduledAt: 1 })
            .limit(200);

        res.json({
            appointments: apps.map((a) => ({
                id: a._id.toString(),
                patient: a.patientId
                    ? { id: a.patientId._id.toString(), name: a.patientId.name, email: a.patientId.email }
                    : null,
                service: a.service,
                scheduledAt: a.scheduledAt,
                status: a.status,
                prescriptionEligible: ['confirmed', 'completed'].includes(a.status),
                durationMinutes: a.durationMinutes,
                cancelledAt: a.cancelledAt,
                cancellationReason: a.cancellationReason,
            })),
        });
    } catch (e) {
        next(e);
    }
});

router.patch('/appointments/:id', async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid appointment id' });
        const { status } = req.body || {};

        if (!status || !['pending', 'confirmed', 'cancelled', 'completed'].includes(String(status))) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const doctor = await Doctor.findOne({ email: String(req.user.email || '').toLowerCase().trim() })
            .select('_id')
            .lean();

        if (!doctor?._id) {
            return res.status(404).json({ error: 'Not found' });
        }

        const app = await Appointment.findOne({ _id: req.params.id, doctorId: doctor._id });
        if (!app) {
            return res.status(404).json({ error: 'Not found' });
        }

        if (['cancelled', 'completed'].includes(app.status)) {
            return res.status(409).json({ error: 'Appointment can no longer be updated' });
        }
        if (String(status) === 'confirmed' && app.status !== 'pending') {
            return res.status(409).json({ error: 'Appointment is already confirmed' });
        }
        if (String(status) === 'completed' && app.status !== 'confirmed') {
            return res.status(409).json({ error: 'Only confirmed appointments can be completed' });
        }

        if (String(status) === 'cancelled') {
            await cancelAppointment({ req, appointment: app, reason: req.body?.reason });
        } else {
            if (app.status === 'cancelled') return res.status(409).json({ error: 'Cancelled appointments cannot be changed' });
            app.status = String(status);
            await app.save();
            await createNotification({ userId: app.patientId, type: 'appointment_changed', message: 'Statusi i terminit tuaj u përditësua.', resourceType: 'appointment', resourceId: app._id });
        }

        res.json({
            appointment: {
                id: app._id.toString(),
                status: app.status,
            },
        });
    } catch (e) {
        next(e);
    }
});

router.delete('/appointments/:id', async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid appointment id' });
        const doctor = await Doctor.findOne({ email: String(req.user.email || '').toLowerCase().trim() }).select('_id');
        if (!doctor) return res.status(404).json({ error: 'Appointment not found' });
        const app = await Appointment.findOne({ _id: req.params.id, doctorId: doctor._id });
        if (!app) return res.status(404).json({ error: 'Appointment not found' });
        await cancelAppointment({ req, appointment: app, reason: req.body?.reason });
        res.json({ ok: true, appointment: { id: app._id.toString(), status: app.status, cancelledAt: app.cancelledAt } });
    } catch (error) {
        next(error);
    }
});

router.get('/prescriptions', async (req, res, next) => {
    try {
        await requireActiveDoctorProfile(req);
        const items = await Prescription.find({ doctorId: req.user._id })
            .populate('patientId', 'name email')
            .sort({ createdAt: -1 })
            .limit(200);

        res.json({
            prescriptions: items.map((p) => {
                const content = decryptPrescriptionContent(p.bodyEncrypted);
                return {
                    id: p._id.toString(), title: p.title,
                    patient: p.patientId ? { id: p.patientId._id.toString(), name: p.patientId.name } : null,
                    content, createdAt: p.createdAt, issuedAt: p.createdAt,
                    status: p.status || 'active', referenceNumber: prescriptionReference(p),
                };
            }),
        });
    } catch (e) {
        next(e);
    }
});

router.get('/prescriptions/:id', async (req, res, next) => {
    try {
        await requireActiveDoctorProfile(req);
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid prescription id' });
        const p = await Prescription.findOne({ _id: req.params.id, doctorId: req.user._id })
            .populate('patientId', 'name email')
            .populate('appointmentId', 'scheduledAt status');

        if (!p) {
            return res.status(404).json({ error: 'Not found' });
        }

        res.json({
            prescription: {
                id: p._id.toString(),
                title: p.title,
                patient: p.patientId
                    ? { id: p.patientId._id.toString(), name: p.patientId.name, email: p.patientId.email }
                    : null,
                referenceNumber: prescriptionReference(p),
                content: decryptPrescriptionContent(p.bodyEncrypted),
                appointment: p.appointmentId ? { scheduledAt: p.appointmentId.scheduledAt, status: p.appointmentId.status } : null,
                createdAt: p.createdAt,
                issuedAt: p.createdAt,
                status: p.status || 'active',
            },
        });
    } catch (e) {
        next(e);
    }
});

router.patch('/prescriptions/:id', async (req, res, next) => {
    try {
        await requireActiveDoctorProfile(req);
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid prescription id' });
        const allowed = ['diagnosis', 'medicationName', 'dosage', 'frequency', 'duration', 'instructions', 'additionalNotes'];
        if (Object.keys(req.body || {}).some((key) => !allowed.includes(key))) return res.status(400).json({ error: 'Invalid prescription fields' });
        const content = editablePrescriptionContent(req.body);
        if (!content) return res.status(400).json({ error: 'Missing required prescription fields' });
        const existing = await Prescription.findOne({ _id: req.params.id, doctorId: req.user._id }).select('status');
        if (!existing) return res.status(404).json({ error: 'Prescription not found' });
        if (existing.status === 'cancelled') return res.status(409).json({ error: 'Archived prescription cannot be edited' });
        const prescription = await Prescription.findOneAndUpdate(
            { _id: req.params.id, doctorId: req.user._id },
            { $set: { bodyEncrypted: encryptPrescriptionContent(content) } },
            { new: true, runValidators: true }
        );
        if (!prescription) return res.status(404).json({ error: 'Prescription not found' });
        await writeAudit(req, { action: 'prescription.edit', resourceType: 'prescription', resourceId: prescription._id, status: 'success' });
        res.json({ prescription: { id: prescription._id.toString(), content, status: prescription.status, updatedAt: prescription.updatedAt } });
    } catch (error) { next(error); }
});

router.delete('/prescriptions/:id', async (req, res, next) => {
    try {
        await requireActiveDoctorProfile(req);
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid prescription id' });
        const existing = await Prescription.findOne({ _id: req.params.id, doctorId: req.user._id }).select('status');
        if (!existing) return res.status(404).json({ error: 'Prescription not found' });
        if (existing.status === 'cancelled') return res.status(409).json({ error: 'Prescription is already archived' });
        const prescription = await Prescription.findOneAndUpdate(
            { _id: req.params.id, doctorId: req.user._id },
            { $set: { status: 'cancelled' } },
            { new: true, runValidators: true }
        );
        if (!prescription) return res.status(404).json({ error: 'Prescription not found' });
        await writeAudit(req, { action: 'prescription.archive', resourceType: 'prescription', resourceId: prescription._id, status: 'success' });
        res.json({ ok: true, prescriptionId: prescription._id.toString(), status: prescription.status });
    } catch (error) { next(error); }
});

router.post('/prescriptions', async (req, res, next) => {
    try {
        const { patientId, appointmentId } = req.body || {};
        const patientIdValid = mongoose.isValidObjectId(patientId);
        const appointmentIdValid = mongoose.isValidObjectId(appointmentId);

        if (!patientIdValid) return res.status(400).json({ error: 'Pacienti i zgjedhur nuk ekziston.' });
        if (!appointmentIdValid) return res.status(400).json({ error: 'Termini i zgjedhur nuk ekziston.' });

        const [patient, doctor] = await Promise.all([
            User.findOne({ _id: patientId, role: 'patient', isActive: { $ne: false } }).select('_id name'),
            Doctor.findOne({ email: String(req.user.email || '').toLowerCase().trim(), isActive: true }).select('_id name'),
        ]);
        if (process.env.NODE_ENV === 'development') {
            console.info('Prescription validation identifiers.', {
                patientId: String(patientId),
                appointmentId: String(appointmentId),
                authenticatedDoctorUserId: String(req.user._id),
                resolvedDoctorProfileId: doctor?._id ? String(doctor._id) : null,
                patientIdValid,
                appointmentIdValid,
                authenticatedDoctorUserIdValid: mongoose.isValidObjectId(req.user._id),
                resolvedDoctorProfileIdValid: mongoose.isValidObjectId(doctor?._id),
            });
        }
        if (!patient) return res.status(400).json({ error: 'Pacienti i zgjedhur nuk ekziston.' });
        if (!doctor) return res.status(403).json({ error: 'Termini nuk i përket doktorit të kyçur.' });

        const appointment = await Appointment.findById(appointmentId).select('_id patientId doctorId scheduledAt status');
        if (!appointment) return res.status(404).json({ error: 'Termini i zgjedhur nuk ekziston.' });
        if (String(appointment.patientId) !== String(patient._id)) {
            return res.status(403).json({ error: 'Termini nuk i përket këtij pacienti.' });
        }
        if (String(appointment.doctorId) !== String(doctor._id)) {
            return res.status(403).json({ error: 'Termini nuk i përket doktorit të kyçur.' });
        }
        if (!['confirmed', 'completed'].includes(appointment.status)) {
            return res.status(409).json({ error: 'Statusi i terminit nuk lejon krijimin e receptit.' });
        }

        const existingPrescription = await Prescription.exists({
            patientId: patient._id,
            doctorId: req.user._id,
            appointmentId: appointment._id,
            status: { $ne: 'cancelled' },
        });
        if (existingPrescription) return res.status(409).json({ error: 'A prescription already exists for this appointment' });

        const content = prescriptionContentFromInput(req.body || {});
        if (!content.legacy && (!content.diagnosis || !content.medicationName || !content.dosage || !content.frequency || !content.duration || !content.instructions)) {
            return res.status(400).json({ error: 'Missing required prescription fields' });
        }
        if (content.legacy && !content.additionalNotes) return res.status(400).json({ error: 'Missing required prescription fields' });
        const title = content.legacy
            ? String(req.body?.title || 'Recept digjital').trim().slice(0, 200)
            : 'Recept digjital';

        const doc = await Prescription.create({
            patientId: patient._id,
            doctorId: req.user._id,
            title,
            bodyEncrypted: encryptPrescriptionContent(content),
            appointmentId: appointment._id,
            status: 'active',
        });

        const doctorName = String(req.user.name || doctor.name || 'Doktor').replace(/^dr\.?\s+/i, '').trim();
        try {
            await createNotification({ userId: patient._id, type: 'prescription_created', message: `Keni një recept të ri nga Dr. ${doctorName}.`, resourceType: 'prescription', resourceId: doc._id });
        } catch (notificationError) {
            if (process.env.NODE_ENV === 'development') {
                console.warn('Prescription notification failed safely.', {
                    type: String(notificationError?.name || 'Error'),
                    statusCode: Number(notificationError?.statusCode || 500),
                });
            }
        }
        await writeAudit(req, { action: 'prescription.create', resourceType: 'prescription', resourceId: doc._id, status: 'success' });

        res.status(201).json({
            prescription: {
                id: doc._id.toString(),
                title: doc.title,
                patientId: doc.patientId.toString(),
                createdAt: doc.createdAt,
                issuedAt: doc.createdAt,
                status: doc.status,
                referenceNumber: prescriptionReference(doc),
            },
        });
    } catch (error) {
        const details = safePrescriptionError(error);
        if (process.env.NODE_ENV === 'development') console.error('Prescription creation failed safely.', details);
        if (error?.name === 'ValidationError') return res.status(400).json({ error: 'Të dhënat e recetës nuk janë të vlefshme.' });
        return res.status(500).json({ error: 'Nuk u arrit të ruhet recepti. Kontrolloni konfigurimin e serverit.' });
    }
});

module.exports = router;
