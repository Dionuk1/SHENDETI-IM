const AuditLog = require('../models/AuditLog');

const BLOCKED_METADATA_KEYS = /password|token|secret|key|prescription|medical|notes|content|body/i;

function safeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
    const safe = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (BLOCKED_METADATA_KEYS.test(key)) continue;
        if (['string', 'number', 'boolean'].includes(typeof value)) {
            safe[key] = typeof value === 'string' ? value.slice(0, 200) : value;
        }
    }
    return Object.keys(safe).length ? safe : undefined;
}

async function writeAudit(req, event) {
    try {
        await AuditLog.create({
            userId: event.userId || req?.user?._id || null,
            role: event.role || req?.user?.role || 'anonymous',
            action: event.action,
            resourceType: event.resourceType || null,
            resourceId: event.resourceId ? String(event.resourceId) : null,
            status: event.status || 'success',
            ipAddress: String(req?.ip || req?.socket?.remoteAddress || '').slice(0, 100) || null,
            metadata: safeMetadata(event.metadata),
        });
    } catch (error) {
        console.error('Audit log write failed:', error.message);
    }
}

module.exports = { writeAudit };
