const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema(
    {
        patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
        service: { type: String, required: true, trim: true, maxlength: 120 },
        scheduledAt: { type: Date, required: true, index: true },
        durationMinutes: { type: Number, default: 30, min: 5, max: 480 },
        status: { type: String, enum: ['pending', 'confirmed', 'cancelled', 'completed'], default: 'pending', index: true },
        notes: { type: String, default: null, maxlength: 5000 },
        cancelledBy: {
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
            role: { type: String, enum: ['patient', 'doctor', 'admin'], default: null },
        },
        cancelledAt: { type: Date, default: null },
        cancellationReason: { type: String, default: null, trim: true, maxlength: 300 },
        activeSlotKey: { type: String, default: undefined, unique: true, sparse: true, select: false },
    },
    { timestamps: true }
);

appointmentSchema.pre('validate', function setActiveSlotKey() {
    if (this.doctorId && this.scheduledAt && ['pending', 'confirmed'].includes(this.status)) {
        this.activeSlotKey = `${this.doctorId.toString()}:${new Date(this.scheduledAt).toISOString()}`;
    } else {
        this.activeSlotKey = undefined;
    }
});

module.exports = mongoose.model('Appointment', appointmentSchema);
