const express = require('express');

const Appointment = require('../models/Appointment');
const Prescription = require('../models/Prescription');
const User = require('../models/User');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { encryptText, decryptText } = require('../utils/aes256');

const router = express.Router();

router.use(requireAuth, requireRole('doctor'));

router.get('/appointments', async (req, res, next) => {
    try {
        const apps = await Appointment.find({ doctorId: req.user._id })
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
            })),
        });
    } catch (e) {
        next(e);
    }
});

router.patch('/appointments/:id', async (req, res, next) => {
    try {
        const { status } = req.body || {};

        if (!status || !['pending', 'confirmed', 'cancelled', 'completed'].includes(String(status))) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const app = await Appointment.findOne({ _id: req.params.id, doctorId: req.user._id });
        if (!app) {
            return res.status(404).json({ error: 'Not found' });
        }

        app.status = String(status);
        await app.save();

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

router.get('/prescriptions', async (req, res, next) => {
    try {
        const items = await Prescription.find({ doctorId: req.user._id })
            .populate('patientId', 'name email')
            .sort({ createdAt: -1 })
            .limit(200);

        res.json({
            prescriptions: items.map((p) => ({
                id: p._id.toString(),
                title: p.title,
                patient: p.patientId
                    ? { id: p.patientId._id.toString(), name: p.patientId.name, email: p.patientId.email }
                    : null,
                createdAt: p.createdAt,
            })),
        });
    } catch (e) {
        next(e);
    }
});

router.get('/prescriptions/:id', async (req, res, next) => {
    try {
        const p = await Prescription.findOne({ _id: req.params.id, doctorId: req.user._id })
            .populate('patientId', 'name email');

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
                body: decryptText(p.bodyEncrypted),
                createdAt: p.createdAt,
            },
        });
    } catch (e) {
        next(e);
    }
});

router.post('/prescriptions', async (req, res, next) => {
    try {
        const { patientId, title, body, appointmentId } = req.body || {};

        if (!patientId || !title || !body) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const patient = await User.findOne({ _id: patientId, role: 'patient' }).select('_id');
        if (!patient) {
            return res.status(400).json({ error: 'Invalid patientId' });
        }

        const doc = await Prescription.create({
            patientId: patient._id,
            doctorId: req.user._id,
            title: String(title).trim(),
            bodyEncrypted: encryptText(String(body)),
            appointmentId: appointmentId || null,
        });

        res.status(201).json({
            prescription: {
                id: doc._id.toString(),
                title: doc.title,
                patientId: doc.patientId.toString(),
                createdAt: doc.createdAt,
            },
        });
    } catch (e) {
        next(e);
    }
});

module.exports = router;
