const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Doctor = require('../models/Doctor');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

router.get('/health', async (req, res) => {
    res.json({
        ok: true,
        db: {
            readyState: mongoose.connection.readyState,
            name: mongoose.connection.name,
            host: mongoose.connection.host,
        },
        uptimeSec: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
    });
});

router.get('/stats', async (req, res, next) => {
    try {
        const [users, doctors, appointments] = await Promise.all([
            User.countDocuments({}),
            Doctor.countDocuments({}),
            Appointment.countDocuments({}),
        ]);

        res.json({
            users,
            doctors,
            appointments,
            timestamp: new Date().toISOString(),
        });
    } catch (e) {
        next(e);
    }
});

router.get('/users', async (req, res, next) => {
    try {
        const role = req.query.role ? String(req.query.role) : null;
        const q = role ? { role } : {};

        const users = await User.find(q)
            .sort({ createdAt: -1 })
            .limit(500);

        res.json({ users: users.map((u) => u.toSafeJson()) });
    } catch (e) {
        next(e);
    }
});

router.post('/users', async (req, res, next) => {
    try {
        const { name, email, password, role } = req.body || {};

        if (!name || !email || !password || !role) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!['patient', 'doctor', 'admin'].includes(String(role))) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        if (String(password).length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
        if (existing) {
            return res.status(409).json({ error: 'Email already exists' });
        }

        const passwordHash = await bcrypt.hash(String(password), 12);
        const user = await User.create({
            name: String(name).trim(),
            email: String(email).toLowerCase().trim(),
            passwordHash,
            role: String(role),
        });

        res.status(201).json({ user: user.toSafeJson() });
    } catch (e) {
        next(e);
    }
});

router.patch('/users/:id', async (req, res, next) => {
    try {
        const { role, name } = req.body || {};
        const update = {};

        if (role) {
            if (!['patient', 'doctor', 'admin'].includes(String(role))) {
                return res.status(400).json({ error: 'Invalid role' });
            }
            update.role = String(role);
        }

        if (name) {
            update.name = String(name).trim();
        }

        const user = await User.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!user) {
            return res.status(404).json({ error: 'Not found' });
        }

        res.json({ user: user.toSafeJson() });
    } catch (e) {
        next(e);
    }
});

router.delete('/users/:id', async (req, res, next) => {
    try {
        const id = String(req.params.id);
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        await User.deleteOne({ _id: id });
        res.json({ ok: true });
    } catch (e) {
        next(e);
    }
});

router.get('/appointments', async (req, res, next) => {
    try {
        const apps = await Appointment.find({})
            .populate('patientId', 'name email')
            .populate('doctorId', 'name')
            .sort({ scheduledAt: -1 })
            .limit(500);

        res.json({
            appointments: apps.map((a) => ({
                id: a._id.toString(),
                patient: a.patientId
                    ? { id: a.patientId._id.toString(), name: a.patientId.name, email: a.patientId.email }
                    : null,
                doctor: a.doctorId ? { id: a.doctorId._id.toString(), name: a.doctorId.name } : null,
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
        const id = String(req.params.id);
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        const { status } = req.body || {};

        if (!status || !['pending', 'confirmed', 'cancelled', 'completed'].includes(String(status))) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const app = await Appointment.findById(id);
        if (!app) {
            return res.status(404).json({ error: 'Not found' });
        }

        app.status = String(status);
        await app.save();

        res.json({ ok: true });
    } catch (e) {
        next(e);
    }
});

router.delete('/appointments/:id', async (req, res, next) => {
    try {
        const id = String(req.params.id);
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        await Appointment.deleteOne({ _id: id });
        res.json({ ok: true });
    } catch (e) {
        next(e);
    }
});

module.exports = router;
