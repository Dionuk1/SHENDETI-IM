const crypto = require('crypto');
const path = require('path');

const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');

const Appointment = require('../models/Appointment');
const MedicalRecord = require('../models/MedicalRecord');
const Prescription = require('../models/Prescription');
const User = require('../models/User');
const Doctor = require('../models/Doctor');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { encryptText } = require('../utils/aes256');
const { decryptPrescriptionContent, prescriptionReference } = require('../utils/prescriptions');
const { appointmentDuration, isWithinDoctorAvailability, findDoctorUser } = require('../utils/appointments');
const { createNotification } = require('../utils/notifications');
const { writeAudit } = require('../utils/audit');
const { appointmentCreateLimiter } = require('../middleware/rateLimits');
const { deleteMedicalPdf, readMedicalPdf, storeMedicalPdf } = require('../services/medicalStorage');

const router = express.Router();

router.use(requireAuth, requireRole('patient'));

/**
 * Patient Dashboard - Complete Health Overview
 * GET /patient/dashboard
 * Returns: appointments, prescriptions, and completed-history count
 */
router.get('/dashboard', async (req, res, next) => {
    try {
        // Fetch all patient data in parallel
        const [appointments, prescriptions] = await Promise.all([
            Appointment.find({ patientId: req.user._id })
                .populate('doctorId', 'name specialization')
                .sort({ scheduledAt: -1 })
                .limit(10),

            Prescription.find({ patientId: req.user._id })
                .populate('doctorId', 'name')
                .sort({ createdAt: -1 })
                .limit(10),

        ]);

        const dashboard = {
            patient: req.user.toSafeJson(),
            schedule: {
                title: 'Orari Im (My Schedule)',
                appointments: appointments.map((a) => ({
                    id: a._id.toString(),
                    doctor: a.doctorId
                        ? {
                              id: a.doctorId._id.toString(),
                              name: a.doctorId.name,
                              specialization: a.doctorId.specialization,
                          }
                        : null,
                    service: a.service,
                    scheduledAt: a.scheduledAt,
                    status: a.status,
                    notes: a.notes,
                    durationMinutes: a.durationMinutes,
                    cancelledAt: a.cancelledAt,
                    cancellationReason: a.cancellationReason,
                })),
                total: (await Appointment.countDocuments({ patientId: req.user._id })).toString(),
            },
            prescriptions: {
                title: 'Receptet (My Prescriptions)',
                prescriptions: prescriptions.map((p) => ({
                    id: p._id.toString(),
                    title: p.title,
                    doctor: p.doctorId ? { id: p.doctorId._id.toString(), name: p.doctorId.name } : null,
                    createdAt: p.createdAt,
                    hasEncryptedBody: Boolean(p.bodyEncrypted),
                })),
                total: (await Prescription.countDocuments({ patientId: req.user._id })).toString(),
            },
            history: {
                title: 'Historia Mjekësore',
                total: (await Appointment.countDocuments({ patientId: req.user._id, status: 'completed' })).toString(),
            },
        };

        res.json(dashboard);
    } catch (e) {
        next(e);
    }
});

router.get('/appointments', async (req, res, next) => {
    try {
        const apps = await Appointment.find({ patientId: req.user._id })
            .populate('doctorId', 'name')
            .sort({ scheduledAt: -1 })
            .limit(200);

        res.json({
            appointments: apps.map((a) => ({
                id: a._id.toString(),
                doctor: a.doctorId ? { id: a.doctorId._id.toString(), name: a.doctorId.name } : null,
                service: a.service,
                scheduledAt: a.scheduledAt,
                status: a.status,
                notes: a.notes,
                durationMinutes: a.durationMinutes,
                cancelledAt: a.cancelledAt,
                cancellationReason: a.cancellationReason,
            })),
        });
    } catch (e) {
        next(e);
    }
});

router.post('/appointments', appointmentCreateLimiter, async (req, res, next) => {
    try {
        const { doctorId, service, scheduledAt, notes } = req.body || {};

        if (!doctorId || !service || !scheduledAt) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const doctor = await Doctor.findOne({ _id: doctorId, isActive: true });
        if (!doctor) {
            return res.status(400).json({ error: 'Invalid doctorId' });
        }

        const when = new Date(scheduledAt);
        if (Number.isNaN(when.getTime()) || when <= new Date()) {
            return res.status(400).json({ error: 'Invalid or past scheduledAt' });
        }

        const durationMinutes = appointmentDuration(doctor, service);
        if (!isWithinDoctorAvailability(doctor, when, durationMinutes)) {
            return res.status(409).json({ error: 'Selected time is outside the doctor availability' });
        }
        const end = new Date(when.getTime() + durationMinutes * 60000);
        const candidates = await Appointment.find({
            doctorId: doctor._id,
            status: { $in: ['pending', 'confirmed', 'completed'] },
            scheduledAt: { $gte: new Date(when.getTime() - 480 * 60000), $lt: end },
        }).select('scheduledAt durationMinutes');
        const conflict = candidates.some((item) => {
            const itemStart = new Date(item.scheduledAt);
            const itemEnd = new Date(itemStart.getTime() + Number(item.durationMinutes || 30) * 60000);
            return when < itemEnd && end > itemStart;
        });
        if (conflict) return res.status(409).json({ error: 'Doctor is not available at the selected time' });

        const app = await Appointment.create({
            patientId: req.user._id,
            doctorId: doctor._id,
            service: String(service).trim(),
            scheduledAt: when,
            durationMinutes,
            status: 'pending',
            notes: notes ? String(notes).trim() : null,
        });

        const doctorUser = await findDoctorUser(doctor);
        await Promise.all([
            createNotification({ userId: req.user._id, type: 'appointment_created', message: 'Termini u krijua me sukses.', resourceType: 'appointment', resourceId: app._id }),
            doctorUser ? createNotification({ userId: doctorUser._id, type: 'appointment_created', message: 'Keni një termin të ri.', resourceType: 'appointment', resourceId: app._id }) : null,
            writeAudit(req, { action: 'appointment.create', resourceType: 'appointment', resourceId: app._id, status: 'success' }),
        ]);

        res.status(201).json({
            appointment: {
                id: app._id.toString(),
                doctorId: app.doctorId.toString(),
                service: app.service,
                scheduledAt: app.scheduledAt,
                status: app.status,
            },
        });
    } catch (e) {
        if (e?.code === 11000) return res.status(409).json({ error: 'This time slot was just booked. Please choose another slot.' });
        next(e);
    }
});

router.get('/prescriptions', async (req, res, next) => {
    try {
        const items = await Prescription.find({ patientId: req.user._id })
            .populate('doctorId', 'name email')
            .populate('appointmentId', 'scheduledAt')
            .sort({ createdAt: -1 })
            .limit(200);

        res.json({
            prescriptions: items.map((p) => ({
                id: p._id.toString(),
                title: p.title,
                doctor: p.doctorId ? { id: p.doctorId._id.toString(), name: p.doctorId.name } : null,
                createdAt: p.createdAt,
                issuedAt: p.createdAt,
                appointmentDate: p.appointmentId?.scheduledAt || null,
                status: p.status || 'active',
                referenceNumber: prescriptionReference(p),
            })),
        });
    } catch (e) {
        next(e);
    }
});

router.get('/prescriptions/:id', async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid prescription id' });
        const p = await Prescription.findOne({ _id: req.params.id, patientId: req.user._id })
            .populate('doctorId', 'name email')
            .populate('appointmentId', 'scheduledAt status');

        if (!p) {
            return res.status(404).json({ error: 'Not found' });
        }

        await writeAudit(req, { action: 'prescription.view', resourceType: 'prescription', resourceId: p._id, status: 'success' });

        const doctorProfile = p.doctorId?.email
            ? await Doctor.findOne({ email: String(p.doctorId.email).toLowerCase().trim() }).select('specialization').lean()
            : null;

        let content = null;
        let unavailable = false;
        try {
            content = decryptPrescriptionContent(p.bodyEncrypted);
        } catch (error) {
            unavailable = true;
            if (process.env.NODE_ENV === 'development') {
                console.warn('Prescription decryption unavailable.', { type: String(error?.name || 'Error'), prescriptionId: p._id.toString() });
            }
        }

        res.json({
            prescription: {
                id: p._id.toString(),
                referenceNumber: prescriptionReference(p),
                title: p.title,
                patient: { name: req.user.name },
                doctor: p.doctorId ? { name: p.doctorId.name, specialization: doctorProfile?.specialization || null } : null,
                content,
                unavailable,
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

router.get('/history', async (req, res, next) => {
    try {
        const appointments = await Appointment.find({ patientId: req.user._id, status: 'completed' })
            .populate('doctorId', 'name specialization')
            .sort({ scheduledAt: -1 })
            .limit(200)
            .lean();
        const appointmentIds = appointments.map((item) => item._id);
        const prescriptions = appointmentIds.length
            ? await Prescription.find({ patientId: req.user._id, appointmentId: { $in: appointmentIds }, status: { $ne: 'cancelled' } })
                .sort({ createdAt: -1 })
                .limit(200)
                .lean()
            : [];
        const prescriptionsByAppointment = new Map();
        for (const prescription of prescriptions) {
            const key = String(prescription.appointmentId || '');
            if (!prescriptionsByAppointment.has(key)) prescriptionsByAppointment.set(key, []);
            let content = null;
            let unavailable = false;
            try { content = decryptPrescriptionContent(prescription.bodyEncrypted); } catch (error) {
                content = null;
                unavailable = true;
                if (process.env.NODE_ENV === 'development') {
                    console.warn('History prescription decryption unavailable.', { type: String(error?.name || 'Error'), prescriptionId: prescription._id.toString() });
                }
            }
            prescriptionsByAppointment.get(key).push({
                id: prescription._id.toString(),
                referenceNumber: prescriptionReference(prescription),
                title: prescription.title,
                diagnosis: content?.diagnosis || (content?.legacy ? prescription.title : null),
                prescribedTreatment: content?.medicationName || null,
                unavailable,
                status: prescription.status || 'active',
            });
        }

        res.json({
            history: appointments.map((appointment) => ({
                id: appointment._id.toString(),
                scheduledAt: appointment.scheduledAt,
                doctor: appointment.doctorId ? { name: appointment.doctorId.name, specialization: appointment.doctorId.specialization } : null,
                service: appointment.service,
                reportedSymptoms: appointment.notes || null,
                status: appointment.status,
                prescriptions: prescriptionsByAppointment.get(appointment._id.toString()) || [],
            })),
        });
    } catch (e) {
        next(e);
    }
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            const error = new Error('Only PDF files are allowed');
            error.statusCode = 400;
            return cb(error);
        }
        return cb(null, true);
    },
});

router.get('/records', async (req, res, next) => {
    try {
        const records = await MedicalRecord.find({ patientId: req.user._id })
            .sort({ createdAt: -1 })
            .limit(200);

        await writeAudit(req, { action: 'medical_record.list', resourceType: 'medical_record', status: 'success' });
        res.json({
            records: records.map((r) => ({
                id: r._id.toString(),
                originalName: r.originalName,
                mimeType: r.mimeType,
                size: r.size,
                createdAt: r.createdAt,
                hasNotes: Boolean(r.notesEncrypted),
            })),
        });
    } catch (e) {
        next(e);
    }
});

router.post('/records/upload', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Missing file' });
        }

        const { notes } = req.body || {};
        if (req.file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
            return res.status(400).json({ error: 'The uploaded file is not a valid PDF' });
        }

        if (notes && String(notes).length > 5000) {
            return res.status(400).json({ error: 'Notes are too long' });
        }

        const originalName = path.basename(req.file.originalname).slice(0, 255);
        const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        const storedReference = await storeMedicalPdf({
            buffer: req.file.buffer,
            originalName,
        });
        let doc;
        try {
            doc = await MedicalRecord.create({
                patientId: req.user._id,
                originalName,
                mimeType: req.file.mimetype,
                size: req.file.size,
                filePath: storedReference,
                sha256,
                notesEncrypted: notes ? encryptText(String(notes)) : null,
            });
        } catch (error) {
            await deleteMedicalPdf(storedReference).catch(() => {});
            throw error;
        }

        await Promise.all([
            createNotification({ userId: req.user._id, type: 'medical_record_created', message: 'Dokumenti i ri mjekësor është i disponueshëm.', resourceType: 'medical_record', resourceId: doc._id }),
            writeAudit(req, { action: 'medical_record.upload', resourceType: 'medical_record', resourceId: doc._id, status: 'success' }),
        ]);

        res.status(201).json({
            record: {
                id: doc._id.toString(),
                originalName: doc.originalName,
                createdAt: doc.createdAt,
            },
        });
    } catch (e) {
        next(e);
    }
});

router.get('/records/:id/download', async (req, res, next) => {
    try {
        const rec = await MedicalRecord.findOne({ _id: req.params.id, patientId: req.user._id });
        if (!rec) {
            return res.status(404).json({ error: 'Not found' });
        }

        await writeAudit(req, { action: 'medical_record.download', resourceType: 'medical_record', resourceId: rec._id, status: 'success' });

        const file = await readMedicalPdf(rec.filePath);
        if (rec.sha256) {
            const actualSha256 = crypto.createHash('sha256').update(file).digest('hex');
            if (actualSha256 !== rec.sha256) {
                const error = new Error('Medical file integrity check failed');
                error.statusCode = 500;
                throw error;
            }
        }
        res.setHeader('Content-Type', rec.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(rec.originalName)}`);
        res.setHeader('Content-Length', String(file.length));
        return res.send(file);
    } catch (e) {
        return next(e);
    }
});

module.exports = router;
