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
    try {
        const { symptoms } = req.body || {};

        if (!symptoms) {
            return res.status(400).json({ error: 'Please describe your symptoms' });
        }

        const result = checkSymptoms(symptoms);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: 'Failed to check symptoms' });
    }
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

        if (!validSpecializations.includes(specialization)) {
            return res.status(400).json({ error: 'Invalid specialization' });
        }

        const doctors = await Doctor.find({ specialization, isActive: true })
            .select(format === 'full' ? '' : '_id name avgRating experience services')
            .limit(20);

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
