/**
 * Doctor Management Routes
 * Admin operations for managing doctor accounts and profiles
 */

const express = require('express');
const bcrypt = require('bcryptjs');

const Doctor = require('../models/Doctor');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { writeAudit } = require('../utils/audit');

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
        const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
        const limitNumber = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 20));

        const [doctorProfiles, doctorUsers] = await Promise.all([
            Doctor.find({}).select('-passwordHash').lean(),
            User.find({ role: 'doctor' }).select('_id name email isActive createdAt').lean(),
        ]);
        const usersByEmail = new Map(doctorUsers.map((user) => [String(user.email).toLowerCase(), user]));
        const linkedEmails = new Set();
        const merged = doctorProfiles.map((profile) => {
            const normalizedEmail = String(profile.email).toLowerCase();
            const user = usersByEmail.get(normalizedEmail);
            linkedEmails.add(normalizedEmail);
            return {
                id: profile._id.toString(),
                name: profile.name,
                email: profile.email,
                specialization: profile.specialization,
                department: profile.department,
                experience: profile.experience,
                services: profile.services,
                licenseNumber: profile.licenseNumber,
                isActive: profile.isActive,
                availability: profile.availability,
                maxPatientsPerDay: profile.maxPatientsPerDay,
                avgRating: profile.avgRating,
                totalPatients: profile.totalPatients,
                createdAt: profile.createdAt,
                profileComplete: true,
                accountExists: Boolean(user),
                accountIsActive: user ? user.isActive : null,
            };
        });

        for (const user of doctorUsers) {
            const normalizedEmail = String(user.email).toLowerCase();
            if (linkedEmails.has(normalizedEmail)) continue;
            merged.push({
                id: null,
                userId: user._id.toString(),
                name: user.name,
                email: user.email,
                specialization: null,
                department: null,
                isActive: user.isActive,
                createdAt: user.createdAt,
                profileComplete: false,
                accountExists: true,
                accountIsActive: user.isActive,
            });
        }

        const filtered = merged
            .filter((doctor) => !specialization || doctor.specialization === String(specialization))
            .filter((doctor) => isActive === undefined || doctor.isActive === (String(isActive) === 'true'))
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        const total = filtered.length;
        const totalPages = Math.ceil(total / limitNumber);
        const doctors = filtered.slice((pageNumber - 1) * limitNumber, pageNumber * limitNumber);

        res.json({
            doctors,
            pagination: {
                page: pageNumber,
                limit: limitNumber,
                total,
                pages: totalPages,
                totalPages,
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
 *   email: "agon@shendeti-im.test",
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

        const normalizedEmail = String(email).toLowerCase().trim();
        const existing = await Promise.all([Doctor.findOne({ email: normalizedEmail }), User.findOne({ email: normalizedEmail })]);
        if (existing.some(Boolean)) {
            return res.status(409).json({ error: 'Doctor email already exists' });
        }

        const passwordHash = await bcrypt.hash(String(password), 12);
        const doctor = await Doctor.create({
            name: String(name).trim(),
            email: normalizedEmail,
            passwordHash,
            specialization,
            department: String(department).trim(),
            experience: Number(experience),
            licenseNumber: licenseNumber ? String(licenseNumber).trim() : undefined,
            services: Array.isArray(services) ? services : [],
            bio: bio ? String(bio).trim() : undefined,
            maxPatientsPerDay: Number(maxPatientsPerDay),
        });

        try {
            await User.create({
                name: String(name).trim(),
                email: normalizedEmail,
                passwordHash,
                role: 'doctor',
                authProvider: 'local',
            });
        } catch (error) {
            await Doctor.deleteOne({ _id: doctor._id });
            throw error;
        }

        await writeAudit(req, { action: 'admin.doctor_create', resourceType: 'doctor', resourceId: doctor._id, status: 'success' });

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

        const userUpdate = {};
        if (name) userUpdate.name = doctor.name;
        if (isActive !== undefined) userUpdate.isActive = doctor.isActive;
        if (Object.keys(userUpdate).length) await User.updateOne({ email: doctor.email, role: 'doctor' }, userUpdate);
        await writeAudit(req, { action: 'admin.doctor_update', resourceType: 'doctor', resourceId: doctor._id, status: 'success' });

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

        await writeAudit(req, { action: 'admin.doctor_availability', resourceType: 'doctor', resourceId: doctor._id, status: 'success' });

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
        const doctor = await Doctor.findByIdAndUpdate(req.params.id, { isActive: false }, { returnDocument: 'after' });
        if (!doctor) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        await User.updateOne({ email: doctor.email, role: 'doctor' }, { isActive: false });
        await writeAudit(req, { action: 'admin.doctor_deactivate', resourceType: 'doctor', resourceId: doctor._id, status: 'success' });

        res.json({ ok: true });
    } catch (e) {
        next(e);
    }
});

module.exports = router;
