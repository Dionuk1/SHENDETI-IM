const Appointment = require('../models/Appointment');
const Doctor = require('../models/Doctor');
const User = require('../models/User');
const { invalidateQueueCache } = require('./queueManager');
const { writeAudit } = require('./audit');
const { createNotification } = require('./notifications');

function appointmentDuration(doctor, service) {
    const match = (doctor.services || []).find(
        (item) => item.available !== false && String(item.name).toLowerCase() === String(service).toLowerCase()
    );
    return Math.max(5, Math.min(480, Number(match?.durationMinutes || 30)));
}

function isWithinDoctorAvailability(doctor, when, durationMinutes) {
    const date = new Date(when);
    if (Number.isNaN(date.getTime())) return false;
    const day = date.getDay();
    const availability = doctor.availability || {};
    const hours = day === 0
        ? (availability.sundayOff !== false ? null : availability.mondayFriday)
        : day === 6 ? availability.saturday : availability.mondayFriday;
    if (!hours?.start || !hours?.end) return false;
    const parse = (value) => {
        const match = /^(\d{2}):(\d{2})$/.exec(String(value));
        return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const start = parse(hours.start);
    const end = parse(hours.end);
    const selected = date.getHours() * 60 + date.getMinutes();
    return start !== null && end !== null && selected >= start && selected + durationMinutes <= end;
}

async function findDoctorUser(doctor) {
    if (!doctor?.email) return null;
    return User.findOne({ email: String(doctor.email).toLowerCase().trim(), role: 'doctor' }).select('_id');
}

async function cancelAppointment({ req, appointment, reason }) {
    if (appointment.status === 'completed') {
        const error = new Error('Completed appointments cannot be cancelled');
        error.statusCode = 409;
        throw error;
    }
    if (appointment.status === 'cancelled') {
        const error = new Error('Appointment is already cancelled');
        error.statusCode = 409;
        throw error;
    }

    appointment.status = 'cancelled';
    appointment.cancelledBy = { userId: req.user._id, role: req.user.role };
    appointment.cancelledAt = new Date();
    appointment.cancellationReason = String(reason || '').trim().slice(0, 300) || null;
    await appointment.save();
    invalidateQueueCache(appointment.doctorId);

    const recipients = [];
    if (String(appointment.patientId) !== String(req.user._id)) recipients.push(appointment.patientId);
    const doctor = await Doctor.findById(appointment.doctorId).select('email');
    const doctorUser = await findDoctorUser(doctor);
    if (doctorUser && String(doctorUser._id) !== String(req.user._id)) recipients.push(doctorUser._id);
    await Promise.all([...new Set(recipients.map(String))].map((userId) => createNotification({
        userId,
        type: 'appointment_cancelled',
        message: 'Një termin është anuluar. Hapni orarin për detaje.',
        resourceType: 'appointment',
        resourceId: appointment._id,
    })));
    await writeAudit(req, {
        action: 'appointment.cancel',
        resourceType: 'appointment',
        resourceId: appointment._id,
        status: 'success',
    });
    return appointment;
}

module.exports = { appointmentDuration, isWithinDoctorAvailability, cancelAppointment, findDoctorUser };
