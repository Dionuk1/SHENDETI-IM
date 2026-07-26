const express = require('express');

const Doctor = require('../models/Doctor');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

router.use(requireAuth, requireRole('doctor'));

function parseTimeToMinutes(t) {
    const s = String(t || '').trim();
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}

async function findDoctorByAuthUser(req) {
    const email = String(req.user?.email || '').toLowerCase().trim();
    if (!email) return null;

    // Doctor availability is stored in the Doctor collection (not User).
    return Doctor.findOne({ email }).select('availability email').lean();
}

router.get('/schedule', async (req, res, next) => {
    try {
        const doctor = await findDoctorByAuthUser(req);
        if (!doctor?._id) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        return res.json({ availability: doctor.availability || null });
    } catch (e) {
        return next(e);
    }
});

/**
 * Update Doctor Schedule (self-service)
 * PATCH /api/doctors/schedule
 * Body: { day: "mondayFriday"|"saturday"|"sunday", start?: "HH:MM", end?: "HH:MM", open?: boolean }
 */
router.patch('/schedule', async (req, res, next) => {
    try {
        const { day, start, end, open } = req.body || {};
        const d = String(day || '').trim();

        if (!['mondayFriday', 'saturday', 'sunday'].includes(d)) {
            return res.status(400).json({ error: 'Invalid day' });
        }

        const email = String(req.user?.email || '').toLowerCase().trim();
        const doctor = await Doctor.findOne({ email });
        if (!doctor) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        if (!doctor.availability) {
            doctor.availability = {
                mondayFriday: { start: '08:00', end: '16:00' },
                saturday: { start: '09:00', end: '12:00' },
                sundayOff: true,
            };
        }

        if (d === 'sunday') {
            if (open === undefined) {
                return res.status(400).json({ error: 'Missing open toggle' });
            }
            doctor.availability.sundayOff = !Boolean(open);
            await doctor.save();
            return res.json({ availability: doctor.availability });
        }

        const startMin = parseTimeToMinutes(start);
        const endMin = parseTimeToMinutes(end);

        if (startMin === null || endMin === null) {
            return res.status(400).json({ error: 'Invalid time format' });
        }

        if (endMin < startMin) {
            return res.status(400).json({ error: 'End time cannot be earlier than start time' });
        }

        doctor.availability[d] = {
            start: String(start),
            end: String(end),
        };

        await doctor.save();
        return res.json({ availability: doctor.availability });
    } catch (e) {
        return next(e);
    }
});

module.exports = router;
