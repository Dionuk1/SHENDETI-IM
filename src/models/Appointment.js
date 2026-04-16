const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema(
    {
        patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        service: { type: String, required: true, trim: true, maxlength: 120 },
        scheduledAt: { type: Date, required: true, index: true },
        status: { type: String, enum: ['pending', 'confirmed', 'cancelled', 'completed'], default: 'pending', index: true },
        notes: { type: String, default: null, maxlength: 5000 },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Appointment', appointmentSchema);
