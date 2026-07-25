const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        message: { type: String, required: true, trim: true, maxlength: 240 },
        type: {
            type: String,
            enum: ['appointment_created', 'appointment_cancelled', 'appointment_changed', 'prescription_created', 'medical_record_created'],
            required: true,
            index: true,
        },
        resourceType: { type: String, default: null, maxlength: 80 },
        resourceId: { type: String, default: null, maxlength: 120 },
        read: { type: Boolean, default: false, index: true },
        readAt: { type: Date, default: null },
    },
    { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
