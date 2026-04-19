/**
 * Smart Queue Prediction Service
 * Predicts wait time for a doctor on a given date based on appointments.
 */

const Appointment = require('../models/Appointment');
const Doctor = require('../models/Doctor');

function findOptimalSlots(appointments, avgDuration) {
    // Placeholder heuristic; keep stable output for API consumers.
    return ['09:00', '13:00', '16:00'];
}

function generateQueueRecommendation(totalWait, appointmentCount) {
    if (totalWait > 120) return 'Schedule for another time - queue is very busy';
    if (totalWait > 60) return 'Moderate wait - consider afternoon appointments';
    return 'Good time to schedule - minimal wait expected';
}

async function predictQueueWaitTime({ doctorId, date }) {
    // Fetch doctor and their appointments for the given date
    const doctor = await Doctor.findById(doctorId).select('name specialization avgDurationMins');
    if (!doctor) {
        const err = new Error('Doctor not found');
        err.status = 404;
        throw err;
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const appointments = await Appointment.find({
        doctorId: doctorId,
        scheduledAt: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: ['pending', 'confirmed'] },
    });

    const avgDuration = doctor.avgDurationMins || 30;
    const totalWaitMinutes = appointments.length * avgDuration;

    return {
        doctorId: doctorId,
        doctorName: doctor.name,
        date: date,
        activeAppointments: appointments.length,
        estimatedWaitMinutes: totalWaitMinutes,
        confidenceLevel: Math.min(95, 70 + appointments.length * 5),
        busyLevel: totalWaitMinutes > 120 ? 'high' : totalWaitMinutes > 60 ? 'medium' : 'low',
        optimalSlots: findOptimalSlots(appointments, avgDuration),
        recommendation: generateQueueRecommendation(totalWaitMinutes, appointments.length),
    };
}

module.exports = {
    predictQueueWaitTime,
};
