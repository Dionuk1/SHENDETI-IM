const Notification = require('../models/Notification');

async function createNotification({ userId, message, type, resourceType, resourceId }) {
    if (!userId || !message || !type) return null;
    return Notification.create({
        userId,
        message: String(message).trim().slice(0, 240),
        type,
        resourceType: resourceType || null,
        resourceId: resourceId ? String(resourceId) : null,
    });
}

module.exports = { createNotification };
