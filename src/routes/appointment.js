/**
 * Appointment Routes - Smart Queue & Symptom Checker
 * Handles appointment scheduling with intelligent queue management
 */

const express = require('express');
const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const Doctor = require('../models/Doctor');
const User = require('../models/User');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const {
    calculateWaitTime,
    findAvailableDoctors,
    getSmartQueueRecommendation,
    invalidateQueueCache,
} = require('../utils/queueManager');
const { checkSymptoms } = require('../utils/symptomChecker');
const { classifyClinicSymptomsWithGemini, isGeminiAvailable } = require('../services/geminiAI');
const { appointmentCreateLimiter } = require('../middleware/rateLimits');
const { appointmentDuration, isWithinDoctorAvailability, cancelAppointment, findDoctorUser } = require('../utils/appointments');
const { createNotification } = require('../utils/notifications');
const { writeAudit } = require('../utils/audit');

const router = express.Router();

// ============================================
// Public Routes (No Authentication)
// ============================================

/**
 * Symptom Checker: Suggest department based on symptoms
 * POST /appointments/check-symptoms
 * Body: { symptoms: "chest pain and shortness of breath" }
 */
router.post('/check-symptoms', (req, res) => {
    (async () => {
        try {
            const { symptoms } = req.body || {};

            if (!symptoms) {
                return res.status(400).json({ error: 'Please describe your symptoms' });
            }

            const base = checkSymptoms(symptoms);

            // Optional clinic-specific AI triage (Gemini). Always fall back safely.
            let usingGeminiAPI = false;
            let merged = { ...base };

            if (isGeminiAvailable && isGeminiAvailable()) {
                const ai = await classifyClinicSymptomsWithGemini(symptoms);
                if (ai && ai.suggestedDepartment) {
                    usingGeminiAPI = true;
                    const dept = String(ai.suggestedDepartment || '').trim();
                    const specByDept = {
                        Kardiologji: 'cardiology',
                        Pediatri: 'pediatrics',
                        Dermatologji: 'dermatology',
                        Pulmonologji: 'pulmonology',
                        Gjinekologji: 'gynecology',
                    };

                    merged = {
                        ...merged,
                        valid: true,
                        suggestedDepartment: dept,
                        suggestedSpecialization: specByDept[dept] || merged.suggestedSpecialization,
                        urgencyLevel: ai.urgencyLevel || merged.urgencyLevel,
                        confidence:
                            typeof ai.confidence === 'number'
                                ? ai.confidence
                                : merged.confidence,
                        recommendedAction: ai.recommendedAction || merged.recommendedAction,
                    };
                }
            }

            res.json({
                ...merged,
                usingGeminiAPI,
            });
        } catch (e) {
            res.status(500).json({ error: 'Failed to check symptoms' });
        }
    })();
});

/**
 * Get Available Doctors by Specialization
 * GET /appointments/doctors/cardiology
 * Query: ?urgency=high&format=full
 */
router.get('/doctors/:specialization', async (req, res, next) => {
    try {
        const { specialization } = req.params;
        const { urgency, format } = req.query;

        const stripDiacritics = (s) =>
            String(s || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');

        const normalize = (s) => stripDiacritics(String(s || '')).toLowerCase().trim();

        const clinicSpecMap = {
            // Albanian labels (and common variants) -> specialization keys
            kardiologji: 'cardiology',
            kardiologjia: 'cardiology',
            cardiology: 'cardiology',
            pediatri: 'pediatrics',
            pediatria: 'pediatrics',
            pediatrics: 'pediatrics',
            dermatologji: 'dermatology',
            dermatologjia: 'dermatology',
            dermatology: 'dermatology',
            pulmonologji: 'pulmonology',
            pulmonologjia: 'pulmonology',
            pulmonology: 'pulmonology',
            gjinekologji: 'gynecology',
            gjinekologjia: 'gynecology',
            gynecology: 'gynecology',

            // Keep legacy keys working
            neurology: 'neurology',
            orthopedics: 'orthopedics',
            general: 'general',
            psychiatry: 'psychiatry',
            emergency: 'emergency',
        };

        const specNorm = normalize(specialization);
        const resolvedSpecialization = clinicSpecMap[specNorm] || null;

        const validSpecializations = [
            'cardiology',
            'neurology',
            'orthopedics',
            'general',
            'pediatrics',
            'psychiatry',
            'dermatology',
            'emergency',
            // Clinic expansions (string field; enum may not include them yet)
            'pulmonology',
            'gynecology',
        ];

        if (!resolvedSpecialization || !validSpecializations.includes(resolvedSpecialization)) {
            return res.status(400).json({ error: 'Invalid specialization' });
        }

        let doctors = await Doctor.find({ specialization: resolvedSpecialization, isActive: true })
            .select(format === 'full' ? '' : '_id name specialization avgRating experience services')
            .limit(20);

        // Fallback: if clinic department has no matching doctors in DB, return general doctors
        if (
            (!doctors || doctors.length === 0) &&
            (resolvedSpecialization === 'pulmonology' || resolvedSpecialization === 'gynecology')
        ) {
            doctors = await Doctor.find({ specialization: 'general', isActive: true })
                .select(format === 'full' ? '' : '_id name specialization avgRating experience services')
                .limit(20);
        }

        if (format === 'full') {
            const docsWithQueues = await Promise.all(
                doctors.map(async (doc) => {
                    const queueData = await calculateWaitTime(doc._id);
                    return {
                        ...doc.toPublicJson(),
                        queueData,
                    };
                })
            );
            return res.json({ doctors: docsWithQueues });
        }

        res.json({ doctors: doctors.map((d) => d.toPublicJson()) });
    } catch (e) {
        next(e);
    }
});

/**
 * Get Queue Status for Doctor
 * GET /appointments/queue-status/:doctorId
 */
router.get('/queue-status/:doctorId', async (req, res, next) => {
    try {
        const { doctorId } = req.params;

        const doctor = await Doctor.findById(doctorId).select('name specialization');
        if (!doctor) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        const queueData = await calculateWaitTime(doctorId);

        res.json({
            doctor: { id: doctor._id.toString(), name: doctor.name },
            queue: queueData,
        });
    } catch (e) {
        next(e);
    }
});

/**
 * Get Smart Queue Recommendation
 * POST /appointments/recommend
 * Body: { specialization: "cardiology", urgencyLevel: "high", emergencyMode: false }
 */
router.post('/recommend', async (req, res, next) => {
    try {
        const { specialization, urgencyLevel = 'low', emergencyMode = false } = req.body || {};

        if (!specialization) {
            return res.status(400).json({ error: 'Specialization is required' });
        }

        const recommendation = await getSmartQueueRecommendation(
            specialization,
            urgencyLevel,
            emergencyMode
        );

        res.json(recommendation);
    } catch (e) {
        next(e);
    }
});

router.get('/slots/:doctorId', async (req, res, next) => {
    try {
        const doctorId = String(req.params.doctorId || '');
        const date = String(req.query.date || '').trim();
        const service = String(req.query.service || 'Konsultim').trim();
        if (!mongoose.isValidObjectId(doctorId)) return res.status(400).json({ error: 'Invalid doctor id' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Date must use YYYY-MM-DD format' });

        const doctor = await Doctor.findOne({ _id: doctorId, isActive: true });
        if (!doctor) return res.status(404).json({ error: 'Doctor not found' });

        const dayStart = new Date(`${date}T00:00:00`);
        const dayEnd = new Date(`${date}T23:59:59.999`);
        if (Number.isNaN(dayStart.getTime())) return res.status(400).json({ error: 'Invalid date' });
        if (dayEnd <= new Date()) return res.status(400).json({ error: 'Past dates cannot be booked' });

        const weekday = dayStart.getDay();
        const availability = doctor.availability || {};
        const hours = weekday === 0
            ? (availability.sundayOff !== false ? null : availability.mondayFriday)
            : weekday === 6 ? availability.saturday : availability.mondayFriday;
        if (!hours?.start || !hours?.end) return res.json({ date, durationMinutes: appointmentDuration(doctor, service), slots: [] });

        const durationMinutes = appointmentDuration(doctor, service);
        const toMinutes = (value) => {
            const match = /^(\d{2}):(\d{2})$/.exec(String(value));
            return match ? Number(match[1]) * 60 + Number(match[2]) : null;
        };
        const startMinutes = toMinutes(hours.start);
        const endMinutes = toMinutes(hours.end);
        if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
            return res.json({ date, durationMinutes, slots: [] });
        }

        const occupied = await Appointment.find({
            doctorId: doctor._id,
            status: { $in: ['pending', 'confirmed', 'completed'] },
            scheduledAt: { $gte: dayStart, $lte: dayEnd },
        }).select('scheduledAt durationMinutes status').lean();
        const now = new Date();
        const slots = [];
        for (let minute = startMinutes; minute + durationMinutes <= endMinutes; minute += durationMinutes) {
            const hh = String(Math.floor(minute / 60)).padStart(2, '0');
            const mm = String(minute % 60).padStart(2, '0');
            const start = new Date(`${date}T${hh}:${mm}:00`);
            const end = new Date(start.getTime() + durationMinutes * 60000);
            const conflict = occupied.find((item) => {
                const itemStart = new Date(item.scheduledAt);
                const itemEnd = new Date(itemStart.getTime() + Number(item.durationMinutes || 30) * 60000);
                return start < itemEnd && end > itemStart;
            });
            const past = start <= now;
            slots.push({ time: `${hh}:${mm}`, scheduledAt: start.toISOString(), available: !conflict && !past, state: conflict || past ? 'occupied' : 'available' });
        }
        res.json({ date, durationMinutes, slots });
    } catch (error) {
        next(error);
    }
});

// ============================================
// Patient Routes (Authenticated)
// ============================================

router.use(requireAuth, requireRole('patient'));

/**
 * Get Patient's Appointments with Queue Info
 * GET /appointments/my-appointments
 */
router.get('/my-appointments', async (req, res, next) => {
    try {
        const apps = await Appointment.find({ patientId: req.user._id })
            .populate('doctorId', 'name specialization')
            .sort({ scheduledAt: -1 })
            .limit(200);

        const appsWithQueue = await Promise.all(
            apps.map(async (app) => {
                if (app.doctorId) {
                    const queueData = await calculateWaitTime(app.doctorId._id);
                    return {
                        id: app._id.toString(),
                        doctor: {
                            id: app.doctorId._id.toString(),
                            name: app.doctorId.name,
                            specialization: app.doctorId.specialization,
                        },
                        service: app.service,
                        scheduledAt: app.scheduledAt,
                        status: app.status,
                        notes: app.notes,
                        durationMinutes: app.durationMinutes,
                        cancelledAt: app.cancelledAt,
                        cancellationReason: app.cancellationReason,
                        queue: queueData,
                    };
                }
                return {
                    id: app._id.toString(),
                    scheduledAt: app.scheduledAt,
                    status: app.status,
                };
            })
        );

        res.json({ appointments: appsWithQueue });
    } catch (e) {
        next(e);
    }
});

/**
 * Create Appointment with Smart Queue
 * POST /appointments/create
 * Body: {
 *   doctorId?: "...",
 *   specialization?: "cardiology",
 *   service: "ECG",
 *   scheduledAt: "2026-05-10T10:30:00Z",
 *   symptoms?: "chest pain",
 *   urgencyLevel?: "high",
 *   emergencyMode?: false,
 *   notes?: "..."
 * }
 */
router.post('/create', appointmentCreateLimiter, async (req, res, next) => {
    try {
        const {
            doctorId,
            specialization,
            service,
            scheduledAt,
            symptoms,
            urgencyLevel = 'low',
            emergencyMode = false,
            notes,
        } = req.body || {};

        // Either doctorId or specialization must be provided
        if (!doctorId && !specialization && !symptoms) {
            return res.status(400).json({
                error: 'Provide doctorId, specialization, or describe your symptoms',
            });
        }

        if (!service || !scheduledAt) {
            return res.status(400).json({ error: 'Service and scheduledAt are required' });
        }
        if (String(service).trim().length > 120 || (notes && String(notes).length > 5000)) {
            return res.status(400).json({ error: 'Appointment details are too long' });
        }
        if (!['low', 'medium', 'high'].includes(String(urgencyLevel).toLowerCase())) {
            return res.status(400).json({ error: 'Invalid urgency level' });
        }

        let finalDoctorId = doctorId;
        let usedSpecialization = specialization;

        // If symptoms provided, check them first
        if (symptoms) {
            const symptomCheck = checkSymptoms(symptoms);
            if (!symptomCheck.valid) {
                return res.status(400).json({
                    error: symptomCheck.error,
                    suggestions: symptomCheck.suggestions,
                });
            }
            usedSpecialization = symptomCheck.suggestedSpecialization;
        }

        // If no doctorId, use smart recommendation
        if (!finalDoctorId && usedSpecialization) {
            const recommendation = await getSmartQueueRecommendation(
                usedSpecialization,
                symptoms ? urgencyLevel : 'low',
                emergencyMode
            );

            if (!recommendation.available) {
                return res.status(503).json({ error: recommendation.message });
            }

            finalDoctorId = recommendation.doctor.id;
        }

        if (!mongoose.isValidObjectId(finalDoctorId)) {
            return res.status(400).json({ error: 'Invalid doctor id' });
        }

        // Verify doctor exists
        const doctor = await Doctor.findById(finalDoctorId);
        if (!doctor || doctor.isActive === false) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        // Validate appointment time
        const when = new Date(scheduledAt);
        if (Number.isNaN(when.getTime()) || when <= new Date()) {
            return res.status(400).json({ error: 'Invalid or past appointment time' });
        }

        // Real-time availability check (MongoDB): prevent overlapping bookings for the same doctor.
        // Use doctor's average duration as the collision window (default 30 mins).
        const slotMinutes = appointmentDuration(doctor, service);
        if (!isWithinDoctorAvailability(doctor, when, slotMinutes)) {
            return res.status(409).json({ error: 'Selected time is outside the doctor availability' });
        }
        const end = new Date(when.getTime() + slotMinutes * 60000);
        const possibleConflicts = await Appointment.find({
            doctorId: doctor._id,
            scheduledAt: { $gte: new Date(when.getTime() - 480 * 60000), $lt: end },
            status: { $in: ['pending', 'confirmed', 'completed'] },
        }).select('_id scheduledAt status durationMinutes');
        const conflict = possibleConflicts.find((item) => {
            const itemStart = new Date(item.scheduledAt);
            const itemEnd = new Date(itemStart.getTime() + Number(item.durationMinutes || 30) * 60000);
            return when < itemEnd && end > itemStart;
        });

        if (conflict) {
            return res.status(409).json({
                error: 'Doctor is not available at the selected time. Please choose another slot.',
            });
        }

        // Create appointment
        const appointment = await Appointment.create({
            patientId: req.user._id,
            doctorId: doctor._id,
            service: String(service).trim(),
            scheduledAt: when,
            durationMinutes: slotMinutes,
            status: 'pending',
            // Store emergency flag in notes or as separate field
            notes: emergencyMode
                ? `[EMERGENCY] ${notes || 'Emergency appointment'}`
                : notes || null,
        });

        // Invalidate queue cache since we added an appointment
        invalidateQueueCache(finalDoctorId);

        const doctorUser = await findDoctorUser(doctor);
        await Promise.all([
            createNotification({ userId: req.user._id, type: 'appointment_created', message: 'Termini u krijua me sukses.', resourceType: 'appointment', resourceId: appointment._id }),
            doctorUser ? createNotification({ userId: doctorUser._id, type: 'appointment_created', message: 'Keni një termin të ri.', resourceType: 'appointment', resourceId: appointment._id }) : null,
            writeAudit(req, { action: 'appointment.create', resourceType: 'appointment', resourceId: appointment._id, status: 'success' }),
        ]);

        const queueData = await calculateWaitTime(doctor._id);

        res.status(201).json({
            appointment: {
                id: appointment._id.toString(),
                doctorId: appointment.doctorId.toString(),
                doctor: doctor.toPublicJson(),
                service: appointment.service,
                scheduledAt: appointment.scheduledAt,
                status: appointment.status,
                durationMinutes: appointment.durationMinutes,
                queueInfo: queueData,
                emergencyMode,
            },
        });
    } catch (e) {
        if (e?.code === 11000) return res.status(409).json({ error: 'This time slot was just booked. Please choose another slot.' });
        next(e);
    }
});

/**
 * Cancel Appointment
 * DELETE /appointments/:id
 */
router.delete('/:id', async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid appointment id' });
        const app = await Appointment.findOne({ _id: req.params.id, patientId: req.user._id });
        if (!app) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        const cancelled = await cancelAppointment({ req, appointment: app, reason: req.body?.reason });
        res.json({ ok: true, appointment: { id: cancelled._id.toString(), status: cancelled.status, cancelledAt: cancelled.cancelledAt } });
    } catch (e) {
        next(e);
    }
});

module.exports = router;
