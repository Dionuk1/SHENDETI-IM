/**
 * Appointment Routes - Smart Queue & Symptom Checker
 * Handles appointment scheduling with intelligent queue management
 */

const express = require('express');
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
router.post('/create', async (req, res, next) => {
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

        // Verify doctor exists
        const doctor = await Doctor.findById(finalDoctorId);
        if (!doctor) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        // Validate appointment time
        const when = new Date(scheduledAt);
        if (Number.isNaN(when.getTime()) || when <= new Date()) {
            return res.status(400).json({ error: 'Invalid or past appointment time' });
        }

        // Real-time availability check (MongoDB): prevent overlapping bookings for the same doctor.
        // Use doctor's average duration as the collision window (default 30 mins).
        const slotMinutes = Number(doctor.avgDurationMins) > 0 ? Number(doctor.avgDurationMins) : 30;
        const windowMs = Math.max(5, slotMinutes - 1) * 60 * 1000;
        const conflict = await Appointment.findOne({
            doctorId: doctor._id,
            scheduledAt: { $gte: new Date(when.getTime() - windowMs), $lte: new Date(when.getTime() + windowMs) },
            status: { $in: ['pending', 'confirmed'] },
        }).select('_id scheduledAt status');

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
            status: 'pending',
            // Store emergency flag in notes or as separate field
            notes: emergencyMode
                ? `[EMERGENCY] ${notes || 'Emergency appointment'}`
                : notes || null,
        });

        // Invalidate queue cache since we added an appointment
        invalidateQueueCache(finalDoctorId);

        const queueData = await calculateWaitTime(doctor._id);

        res.status(201).json({
            appointment: {
                id: appointment._id.toString(),
                doctorId: appointment.doctorId.toString(),
                doctor: doctor.toPublicJson(),
                service: appointment.service,
                scheduledAt: appointment.scheduledAt,
                status: appointment.status,
                queueInfo: queueData,
                emergencyMode,
            },
        });
    } catch (e) {
        next(e);
    }
});

/**
 * Cancel Appointment
 * DELETE /appointments/:id
 */
router.delete('/:id', async (req, res, next) => {
    try {
        const app = await Appointment.findOne({ _id: req.params.id, patientId: req.user._id });
        if (!app) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        const doctorId = app.doctorId;
        await Appointment.deleteOne({ _id: app._id });

        // Invalidate cache
        if (doctorId) {
            invalidateQueueCache(doctorId);
        }

        res.json({ ok: true });
    } catch (e) {
        next(e);
    }
});

module.exports = router;
