const express = require('express');
const mongoose = require('mongoose');

const Appointment = require('../models/Appointment');
const Prescription = require('../models/Prescription');
const Doctor = require('../models/Doctor');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

router.use(requireAuth, requireRole('doctor'));

function parseUrgencyFromNotes(notes) {
    const s = String(notes || '').trim();
    if (!s) return 'low';
    if (s.toUpperCase().includes('[EMERGENCY]')) return 'high';
    return 'low';
}

router.get('/:id/history', async (req, res, next) => {
    try {
        const patientId = String(req.params.id || '').trim();
        if (!mongoose.isValidObjectId(patientId)) {
            return res.status(400).json({ error: 'Invalid patient id' });
        }

        // Appointments are stored with doctorId pointing to the Doctor collection.
        const doctor = await Doctor.findOne({ email: String(req.user.email || '').toLowerCase().trim() })
            .select('_id specialization name')
            .lean();

        if (!doctor?._id) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        const apps = await Appointment.find({ doctorId: doctor._id, patientId })
            .select('_id service scheduledAt status notes')
            .sort({ scheduledAt: -1 })
            .limit(200)
            .lean();

        // Optional: enrich with prescriptions for the same doctor-patient, if linked.
        const prescriptions = await Prescription.find({ patientId, doctorId: req.user._id })
            .select('_id title appointmentId createdAt')
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();

        const byAppointmentId = new Map();
        for (const p of prescriptions) {
            if (!p?.appointmentId) continue;
            const key = p.appointmentId.toString();
            if (!byAppointmentId.has(key)) byAppointmentId.set(key, []);
            byAppointmentId.get(key).push({
                id: p._id.toString(),
                title: p.title,
                createdAt: p.createdAt,
            });
        }

        const history = apps.map((a) => {
            const appId = a._id.toString();
            const linkedRx = byAppointmentId.get(appId) || [];
            const firstRxTitle = linkedRx.length ? String(linkedRx[0]?.title || '').trim() : '';

            const symptoms = String(a.notes || '').trim() || String(a.service || '').trim() || null;
            const urgency = parseUrgencyFromNotes(a.notes);

            return {
                id: appId,
                date: a.scheduledAt,
                symptoms,
                department: doctor.specialization || null,
                diagnosis: firstRxTitle || null,
                urgency,
                status: a.status,
            };
        });

        return res.json({ history });
    } catch (e) {
        return next(e);
    }
});

module.exports = router;
