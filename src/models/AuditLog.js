const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
        role: { type: String, enum: ['patient', 'doctor', 'admin', 'anonymous'], default: 'anonymous', index: true },
        action: { type: String, required: true, trim: true, maxlength: 100, index: true },
        resourceType: { type: String, default: null, trim: true, maxlength: 80 },
        resourceId: { type: String, default: null, trim: true, maxlength: 120 },
        status: { type: String, enum: ['success', 'failure'], required: true, index: true },
        ipAddress: { type: String, default: null, maxlength: 100 },
        metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
        timestamp: { type: Date, default: Date.now, index: true },
    },
    { versionKey: false }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
