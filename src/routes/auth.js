const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const { requireAuth, getJwtSecret } = require('../middleware/auth');

const router = express.Router();

function issueToken(user) {
    const nowSec = Math.floor(Date.now() / 1000);

    return jwt.sign(
        {
            sub: user._id.toString(),
            role: user.role,
            iat: nowSec,
        },
        getJwtSecret(),
        { expiresIn: '7d' }
    );
}

router.post('/register', async (req, res, next) => {
    try {
        const { name, email, password, role } = req.body || {};

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (String(password).length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const desiredRole = String(role || 'patient').toLowerCase();
        if (!['patient', 'doctor'].includes(desiredRole)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
        if (existing) {
            return res.status(409).json({ error: 'Email already exists' });
        }

        const passwordHash = await bcrypt.hash(String(password), 12);
        const user = await User.create({
            name: String(name).trim(),
            email: String(email).toLowerCase().trim(),
            passwordHash,
            role: desiredRole,
        });

        const token = issueToken(user);
        return res.status(201).json({ token, user: user.toSafeJson() });
    } catch (e) {
        return next(e);
    }
});

router.post('/login', async (req, res, next) => {
    try {
        const { email, password, role } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const user = await User.findOne({ email: String(email).toLowerCase().trim() });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const ok = await bcrypt.compare(String(password), user.passwordHash);
        if (!ok) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (role && String(role).toLowerCase() !== String(user.role).toLowerCase()) {
            // Prevent logging in under a different role than the account.
            return res.status(403).json({ error: 'Role mismatch' });
        }

        const token = issueToken(user);
        return res.json({ token, user: user.toSafeJson() });
    } catch (e) {
        return next(e);
    }
});

router.get('/me', requireAuth, async (req, res) => {
    res.json({ user: req.user.toSafeJson() });
});

module.exports = router;
