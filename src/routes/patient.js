const path = require('path');

const express = require('express');
const multer = require('multer');

const Appointment = require('../models/Appointment');
const MedicalRecord = require('../models/MedicalRecord');
const Prescription = require('../models/Prescription');
const User = require('../models/User');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { encryptText, decryptText } = require('../utils/aes256');

const router = express.Router();

router.use(requireAuth, requireRole('patient'));

/**
 * Patient Dashboard - Complete Health Overview
 * GET /patient/dashboard
 * Returns: appointments (schedule), prescriptions, medical records (analysis)
 */
router.get('/dashboard', async (req, res, next) => {
    try {
        // Fetch all patient data in parallel
        const [appointments, prescriptions, records] = await Promise.all([
            Appointment.find({ patientId: req.user._id })
                .populate('doctorId', 'name specialization')
                .sort({ scheduledAt: -1 })
                .limit(10),

            Prescription.find({ patientId: req.user._id })
                .populate('doctorId', 'name')
                .sort({ createdAt: -1 })
                .limit(10),

            MedicalRecord.find({ patientId: req.user._id })
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
            analysis: {
                title: 'Analizat e Mia (My Analysis/Records)',
                records: records.map((r) => ({
                    id: r._id.toString(),
                    originalName: r.originalName,
                    mimeType: r.mimeType,
                    size: r.size,
                    createdAt: r.createdAt,
                    hasNotes: Boolean(r.notesEncrypted),
                })),
                total: (await MedicalRecord.countDocuments({ patientId: req.user._id })).toString(),
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
            })),
        });
    } catch (e) {
        next(e);
    }
});

router.post('/appointments', async (req, res, next) => {
    try {
        const { doctorId, service, scheduledAt, notes } = req.body || {};

        if (!doctorId || !service || !scheduledAt) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const doctor = await User.findOne({ _id: doctorId, role: 'doctor' }).select('_id');
        if (!doctor) {
            return res.status(400).json({ error: 'Invalid doctorId' });
        }

        const when = new Date(scheduledAt);
        if (Number.isNaN(when.getTime())) {
            return res.status(400).json({ error: 'Invalid scheduledAt' });
        }

        const app = await Appointment.create({
            patientId: req.user._id,
            doctorId: doctor._id,
            service: String(service).trim(),
            scheduledAt: when,
            status: 'pending',
            notes: notes ? String(notes).trim() : null,
        });

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
        next(e);
    }
});

router.get('/prescriptions', async (req, res, next) => {
    try {
        const items = await Prescription.find({ patientId: req.user._id })
            .populate('doctorId', 'name')
            .sort({ createdAt: -1 })
            .limit(200);

        res.json({
            prescriptions: items.map((p) => ({
                id: p._id.toString(),
                title: p.title,
                doctor: p.doctorId ? { id: p.doctorId._id.toString(), name: p.doctorId.name } : null,
                createdAt: p.createdAt,
            })),
        });
    } catch (e) {
        next(e);
    }
});

router.get('/prescriptions/:id', async (req, res, next) => {
    try {
        const p = await Prescription.findOne({ _id: req.params.id, patientId: req.user._id })
            .populate('doctorId', 'name');

        if (!p) {
            return res.status(404).json({ error: 'Not found' });
        }

        res.json({
            prescription: {
                id: p._id.toString(),
                title: p.title,
                doctor: p.doctorId ? { id: p.doctorId._id.toString(), name: p.doctorId.name } : null,
                body: decryptText(p.bodyEncrypted),
                createdAt: p.createdAt,
            },
        });
    } catch (e) {
        next(e);
    }
});

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, path.join(process.cwd(), 'uploads', 'medical-records')),
        filename: (req, file, cb) => {
            const safe = `${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`;
            cb(null, safe);
        },
    }),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            return cb(new Error('Only PDF files are allowed'));
        }
        return cb(null, true);
    },
});

router.get('/records', async (req, res, next) => {
    try {
        const records = await MedicalRecord.find({ patientId: req.user._id })
            .sort({ createdAt: -1 })
            .limit(200);

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

        const doc = await MedicalRecord.create({
            patientId: req.user._id,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
            filePath: req.file.path,
            notesEncrypted: notes ? encryptText(String(notes)) : null,
        });

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

        // Only allow downloading files we stored.
        const abs = path.resolve(rec.filePath);
        const uploadsRoot = path.resolve(path.join(process.cwd(), 'uploads', 'medical-records'));
        if (!abs.startsWith(uploadsRoot + path.sep)) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        return res.download(abs, rec.originalName);
    } catch (e) {
        return next(e);
    }
});

module.exports = router;
