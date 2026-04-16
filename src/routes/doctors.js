/**
 * Doctor Management Routes
 * Admin operations for managing doctor accounts and profiles
 */

const express = require('express');
const bcrypt = require('bcryptjs');

const Doctor = require('../models/Doctor');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

/**
 * List All Doctors
 * GET /admin/doctors
 * Query: ?specialization=cardiology&isActive=true&page=1
 */
router.get('/', async (req, res, next) => {
    try {
        const { specialization, isActive, page = 1, limit = 20 } = req.query;
        const query = {};

        if (specialization) {
            query.specialization = String(specialization);
        }

        if (isActive !== undefined) {
            query.isActive = String(isActive) === 'true';
        }

        const skip = (Number(page) - 1) * Number(limit);

        const [doctors, total] = await Promise.all([
            Doctor.find(query)
                .select('-passwordHash')
                .skip(skip)
                .limit(Number(limit))
                .sort({ createdAt: -1 }),
            Doctor.countDocuments(query),
        ]);

        res.json({
            doctors: doctors.map((d) => d.toSafeJson()),
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                pages: Math.ceil(total / Number(limit)),
            },
        });
    } catch (e) {
        next(e);
    }
});

/**
 * Get Doctor Details
 * GET /admin/doctors/:id
 */
router.get('/:id', async (req, res, next) => {
    try {
        const doctor = await Doctor.findById(req.params.id);
        if (!doctor) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        res.json({ doctor: doctor.toSafeJson() });
    } catch (e) {
        next(e);
    }
});

/**
 * Create Doctor Account
 * POST /admin/doctors
 * Body: {
 *   name: "Dr. Agon Berisha",
 *   email: "agon@healthflow.test",
 *   password: "securePassword123",
 *   specialization: "cardiology",
 *   department: "Cardiology Department",
 *   experience: 10,
 *   licenseNumber: "LIC123456",
 *   services: [{ name: "ECG", durationMinutes: 30 }, { name: "Tele-visit", durationMinutes: 20 }],
 *   bio: "Expert cardiologist..."
 * }
 */
router.post('/', async (req, res, next) => {
    try {
        const {
            name,
            email,
            password,
            specialization,
            department,
            experience = 0,
            licenseNumber,
            services = [],
            bio,
            maxPatientsPerDay = 20,
        } = req.body || {};

        if (!name || !email || !password || !specialization || !department) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (String(password).length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const validSpecializations = [
            'cardiology',
            'neurology',
            'orthopedics',
            'general',
            'pediatrics',
            'psychiatry',
            'dermatology',
            'emergency',
        ];
        if (!validSpecializations.includes(String(specialization))) {
            return res.status(400).json({ error: 'Invalid specialization' });
        }

        const existing = await Doctor.findOne({ email: String(email).toLowerCase().trim() });
        if (existing) {
            return res.status(409).json({ error: 'Doctor email already exists' });
        }

        const passwordHash = await bcrypt.hash(String(password), 12);
        const doctor = await Doctor.create({
            name: String(name).trim(),
            email: String(email).toLowerCase().trim(),
            passwordHash,
            specialization,
            department: String(department).trim(),
            experience: Number(experience),
            licenseNumber: licenseNumber ? String(licenseNumber).trim() : undefined,
            services: Array.isArray(services) ? services : [],
            bio: bio ? String(bio).trim() : undefined,
            maxPatientsPerDay: Number(maxPatientsPerDay),
        });

        res.status(201).json({ doctor: doctor.toSafeJson() });
    } catch (e) {
        next(e);
    }
});

/**
 * Update Doctor Profile
 * PATCH /admin/doctors/:id
 * Body: { name?, specialization?, department?, experience?, services?, isActive?, bio?, maxPatientsPerDay? }
 */
router.patch('/:id', async (req, res, next) => {
    try {
        const { name, specialization, department, experience, services, isActive, bio, maxPatientsPerDay } =
            req.body || {};

        const update = {};
        if (name) update.name = String(name).trim();
        if (specialization) update.specialization = String(specialization);
        if (department) update.department = String(department).trim();
        if (experience !== undefined) update.experience = Number(experience);
        if (services !== undefined) update.services = Array.isArray(services) ? services : [];
        if (isActive !== undefined) update.isActive = Boolean(isActive);
        if (bio !== undefined) update.bio = bio ? String(bio).trim() : undefined;
        if (maxPatientsPerDay !== undefined) update.maxPatientsPerDay = Number(maxPatientsPerDay);

        const doctor = await Doctor.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!doctor) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        res.json({ doctor: doctor.toSafeJson() });
    } catch (e) {
        next(e);
    }
});

/**
 * Update Doctor Availability
 * PATCH /admin/doctors/:id/availability
 * Body: { mondayFriday: { start: "08:00", end: "17:00" }, saturday: { start: "09:00", end: "13:00" }, sundayOff: true }
 */
router.patch('/:id/availability', async (req, res, next) => {
    try {
        const { mondayFriday, saturday, sundayOff } = req.body || {};

        const update = { availability: {} };

        if (mondayFriday) {
            update.availability.mondayFriday = mondayFriday;
        }
        if (saturday) {
            update.availability.saturday = saturday;
        }
        if (sundayOff !== undefined) {
            update.availability.sundayOff = Boolean(sundayOff);
        }

        const doctor = await Doctor.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!doctor) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        res.json({ doctor: doctor.toSafeJson() });
    } catch (e) {
        next(e);
    }
});

/**
 * Delete Doctor (Soft delete via isActive = false)
 * DELETE /admin/doctors/:id
 */
router.delete('/:id', async (req, res, next) => {
    try {
        const doctor = await Doctor.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
        if (!doctor) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        res.json({ ok: true });
    } catch (e) {
        next(e);
    }
});

module.exports = router;
