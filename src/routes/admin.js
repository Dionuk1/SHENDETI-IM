const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Doctor = require('../models/Doctor');
const AuditLog = require('../models/AuditLog');
const Prescription = require('../models/Prescription');
const MedicalRecord = require('../models/MedicalRecord');
const Notification = require('../models/Notification');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { cancelAppointment } = require('../utils/appointments');
const { createNotification } = require('../utils/notifications');
const { writeAudit } = require('../utils/audit');

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
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const [patients, doctors, appointments, appointmentsToday, byStatus, byDepartment] = await Promise.all([
            User.countDocuments({ role: 'patient' }),
            Doctor.countDocuments({}),
            Appointment.countDocuments({}),
            Appointment.countDocuments({ scheduledAt: { $gte: today, $lt: tomorrow } }),
            Appointment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
            Appointment.aggregate([
                { $lookup: { from: Doctor.collection.name, localField: 'doctorId', foreignField: '_id', as: 'doctor' } },
                { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: false } },
                { $group: { _id: { $ifNull: ['$doctor.department', '$doctor.specialization'] }, count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
        ]);

        const statusCounts = Object.fromEntries(byStatus.map((item) => [item._id, item.count]));

        res.json({
            users: patients,
            patients,
            doctors,
            appointments,
            appointmentsToday,
            pendingAppointments: statusCounts.pending || 0,
            completedAppointments: statusCounts.completed || 0,
            cancelledAppointments: statusCounts.cancelled || 0,
            appointmentsByDepartment: byDepartment.map((item) => ({ department: item._id || 'Unassigned', count: item.count })),
            timestamp: new Date().toISOString(),
        });
    } catch (e) {
        next(e);
    }
});

router.get('/audit-logs', async (req, res, next) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
        const query = {};
        if (req.query.action) query.action = String(req.query.action).slice(0, 100);
        if (req.query.role && ['patient', 'doctor', 'admin', 'anonymous'].includes(String(req.query.role))) query.role = String(req.query.role);
        if (req.query.status && ['success', 'failure'].includes(String(req.query.status))) query.status = String(req.query.status);
        const timestamp = {};
        if (req.query.from) {
            const from = new Date(String(req.query.from));
            if (!Number.isNaN(from.getTime())) timestamp.$gte = from;
        }
        if (req.query.to) {
            const to = new Date(String(req.query.to));
            if (!Number.isNaN(to.getTime())) timestamp.$lte = to;
        }
        if (Object.keys(timestamp).length) query.timestamp = timestamp;

        const [logs, total] = await Promise.all([
            AuditLog.find(query).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            AuditLog.countDocuments(query),
        ]);
        res.json({ logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) {
        next(error);
    }
});

router.get('/users', async (req, res, next) => {
    try {
        const role = req.query.role ? String(req.query.role) : null;
        const q = role ? { role } : {};
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 100));

        const [users, total] = await Promise.all([
            User.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
            User.countDocuments(q),
        ]);

        res.json({ users: users.map((u) => u.toSafeJson()), pagination: { page, limit, total, pages: Math.ceil(total / limit), totalPages: Math.ceil(total / limit) } });
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

        await writeAudit(req, { action: 'admin.user_create', resourceType: 'user', resourceId: user._id, status: 'success', metadata: { role: user.role } });

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

        await writeAudit(req, { action: 'admin.user_update', resourceType: 'user', resourceId: user._id, status: 'success', metadata: { role: user.role } });

        res.json({ user: user.toSafeJson() });
    } catch (e) {
        next(e);
    }
});

router.patch('/users/:id/password', async (req, res, next) => {
    try {
        const id = String(req.params.id);
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        const fields = Object.keys(req.body || {});
        if (fields.length !== 1 || fields[0] !== 'newPassword') {
            return res.status(400).json({ error: 'Only newPassword is accepted' });
        }

        const newPassword = String(req.body.newPassword || '');
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const user = await User.findById(id).select('_id role');
        if (!user) return res.status(404).json({ error: 'Not found' });

        const passwordHash = await bcrypt.hash(newPassword, 12);
        await User.updateOne(
            { _id: user._id },
            { $set: { passwordHash } },
            { timestamps: false }
        );

        await writeAudit(req, {
            action: 'admin.user_password_reset',
            resourceType: 'user',
            resourceId: user._id,
            status: 'success',
            metadata: { targetRole: user.role },
        });

        res.json({ ok: true, message: 'Fjalëkalimi u ndryshua me sukses.' });
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

        const user = await User.findById(id).select('email');
        if (!user) return res.status(404).json({ error: 'Not found' });
        if (String(req.user._id) === id) return res.status(409).json({ error: 'You cannot delete your own active admin account.' });

        const [appointments, cancellations, prescriptionsAsPatient, prescriptionsAsDoctor, medicalRecords, notifications, auditLogs, doctorProfiles] = await Promise.all([
            Appointment.countDocuments({ patientId: user._id }),
            Appointment.countDocuments({ 'cancelledBy.userId': user._id }),
            Prescription.countDocuments({ patientId: user._id }),
            Prescription.countDocuments({ doctorId: user._id }),
            MedicalRecord.countDocuments({ patientId: user._id }),
            Notification.countDocuments({ userId: user._id }),
            AuditLog.countDocuments({ userId: user._id }),
            Doctor.countDocuments({ email: user.email }),
        ]);
        const relatedRecords = { appointments, cancellations, prescriptionsAsPatient, prescriptionsAsDoctor, medicalRecords, notifications, auditLogs, doctorProfiles };
        if (Object.values(relatedRecords).some((count) => count > 0)) {
            return res.status(409).json({ error: 'User cannot be deleted while related records exist. Deactivate the account or use the reviewed development cleanup migration.', relatedRecords });
        }

        await User.deleteOne({ _id: user._id });
        await writeAudit(req, { action: 'admin.user_delete', resourceType: 'user', resourceId: id, status: 'success' });
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
                // Provide both doctorId (preferred) and doctor (legacy) to keep the frontend flexible.
                doctorId: a.doctorId ? { id: a.doctorId._id.toString(), name: a.doctorId.name } : null,
                doctor: a.doctorId ? { id: a.doctorId._id.toString(), name: a.doctorId.name } : null,
                service: a.service,
                scheduledAt: a.scheduledAt,
                status: a.status,
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

        if (String(status) === 'cancelled') {
            await cancelAppointment({ req, appointment: app, reason: req.body?.reason });
        } else {
            if (app.status === 'cancelled') return res.status(409).json({ error: 'Cancelled appointments cannot be changed' });
            app.status = String(status);
            await app.save();
            await Promise.all([
                createNotification({ userId: app.patientId, type: 'appointment_changed', message: 'Statusi i terminit tuaj u përditësua.', resourceType: 'appointment', resourceId: app._id }),
                writeAudit(req, { action: 'appointment.status_change', resourceType: 'appointment', resourceId: app._id, status: 'success', metadata: { appointmentStatus: app.status } }),
            ]);
        }

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

        const app = await Appointment.findById(id);
        if (!app) return res.status(404).json({ error: 'Appointment not found' });
        await cancelAppointment({ req, appointment: app, reason: req.body?.reason });
        res.json({ ok: true, appointment: { id: app._id.toString(), status: app.status, cancelledAt: app.cancelledAt } });
    } catch (e) {
        next(e);
    }
});

module.exports = router;
