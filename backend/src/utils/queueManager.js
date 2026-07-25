/**
 * Smart Queue System
 * Manages appointment queues with intelligent wait time calculation
 * and emergency mode prioritization
 */

const Appointment = require('../models/Appointment');

// In-memory cache for queue stats (in production, use Redis)
const QUEUE_CACHE = new Map();
const CACHE_TTL = 60000; // 1 minute

function getCacheKey(doctorId, department) {
    return `queue:${String(doctorId || 'dept')}:${String(department)}`;
}

async function calculateWaitTime(doctorId, department = null) {
    const cacheKey = getCacheKey(doctorId, department);
    const cached = QUEUE_CACHE.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    // Query appointments for the doctor/department
    let query = {
        status: { $in: ['pending', 'confirmed'] },
        scheduledAt: { $gte: new Date() }, // Future appointments only
    };

    if (doctorId) {
        query.doctorId = doctorId;
    } else if (department) {
        // Find doctors in department (would need doctor ref)
        query.department = department;
    }

    const activeApps = await Appointment.countDocuments(query);

    // Assume avg 30 min per appointment, with some buffer
    const avgTimePerAppointment = 30; // minutes
    const waitTimeMinutes = activeApps * avgTimePerAppointment;
    const estimatedWaitUntil = new Date(Date.now() + waitTimeMinutes * 60000);

    const result = {
        activeAppointments: activeApps,
        estimatedWaitMinutes: waitTimeMinutes,
        estimatedWaitUntil,
        busyLevel: activeApps > 15 ? 'high' : activeApps > 7 ? 'medium' : 'low',
    };

    QUEUE_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
}

async function findAvailableDoctors(specialization, urgencyLevel = 'low') {
    const Doctor = require('../models/Doctor');

    let query = { isActive: true, specialization };

    const doctors = await Doctor.find(query)
        .select('_id name experience avgRating maxPatientsPerDay')
        .limit(20);

    // Calculate queue stats for each doctor
    const doctorsWithQueues = await Promise.all(
        doctors.map(async (doc) => {
            const queueData = await calculateWaitTime(doc._id);
            return {
                id: doc._id.toString(),
                name: doc.name,
                experience: doc.experience,
                avgRating: doc.avgRating,
                maxPatientsPerDay: doc.maxPatientsPerDay,
                currentQueueSize: queueData.activeAppointments,
                estimatedWaitMinutes: queueData.estimatedWaitMinutes,
                isBusy: queueData.busyLevel === 'high',
            };
        })
    );

    // Sort by queue size (ascending) and rating (descending)
    doctorsWithQueues.sort((a, b) => {
        if (urgencyLevel === 'high') {
            // For emergency, prioritize doctors with shorter queues
            if (a.isBusy !== b.isBusy) return a.isBusy ? 1 : -1;
        }
        if (a.currentQueueSize !== b.currentQueueSize) {
            return a.currentQueueSize - b.currentQueueSize;
        }
        return b.avgRating - a.avgRating;
    });

    return doctorsWithQueues;
}

async function getSmartQueueRecommendation(specialization, urgencyLevel = 'low', emergencyMode = false) {
    const availableDoctors = await findAvailableDoctors(specialization, urgencyLevel);

    if (availableDoctors.length === 0) {
        return {
            available: false,
            message: 'No doctors available for this specialization at the moment.',
        };
    }

    let recommendedDoctor;

    if (emergencyMode) {
        // For emergency cases, get the doctor with shortest wait time
        recommendedDoctor = availableDoctors[0];
    } else if (urgencyLevel === 'high') {
        // High urgency: skip very busy doctors
        recommendedDoctor = availableDoctors.find((d) => !d.isBusy) || availableDoctors[0];
    } else {
        // Low/medium urgency: balanced by rating and queue
        recommendedDoctor = availableDoctors[0];
    }

    return {
        available: true,
        doctor: recommendedDoctor,
        allOptions: availableDoctors.slice(0, 5),
        emergencyMode,
        recommendation:
            emergencyMode && recommendedDoctor.estimatedWaitMinutes > 120
                ? `Emergency mode active: ${recommendedDoctor.name} can see you in ~${recommendedDoctor.estimatedWaitMinutes} minutes`
                : `Recommended: ${recommendedDoctor.name} (Wait time: ~${recommendedDoctor.estimatedWaitMinutes} min)`,
    };
}

function invalidateQueueCache(doctorId) {
    // Clear cache entry for this doctor
    for (const [key] of QUEUE_CACHE) {
        if (key.includes(String(doctorId))) {
            QUEUE_CACHE.delete(key);
        }
    }
}

module.exports = {
    calculateWaitTime,
    findAvailableDoctors,
    getSmartQueueRecommendation,
    invalidateQueueCache,
};
