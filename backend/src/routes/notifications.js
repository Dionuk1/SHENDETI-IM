const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
    try {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
        const [notifications, unread] = await Promise.all([
            Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(limit).lean(),
            Notification.countDocuments({ userId: req.user._id, read: false }),
        ]);
        res.json({ notifications, unread });
    } catch (error) {
        next(error);
    }
});

router.patch('/:id/read', async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid notification id' });
        const item = await Notification.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { read: true, readAt: new Date() },
            { returnDocument: 'after' }
        );
        if (!item) return res.status(404).json({ error: 'Notification not found' });
        res.json({ notification: item });
    } catch (error) {
        next(error);
    }
});

router.patch('/read-all', async (req, res, next) => {
    try {
        await Notification.updateMany({ userId: req.user._id, read: false }, { read: true, readAt: new Date() });
        res.json({ ok: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
