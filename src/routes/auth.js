const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const User = require('../models/User');
const { requireAuth, getJwtSecret } = require('../middleware/auth');
const { loginLimiter, registerLimiter, googleAuthLimiter } = require('../middleware/rateLimits');
const { writeAudit } = require('../utils/audit');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

async function authenticatePassword(email, password) {
    const normalizedEmail = String(email || '').toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
    if (!user || user.isActive === false) return null;
    const validPassword = user.passwordHash
        ? await bcrypt.compare(String(password || ''), user.passwordHash)
        : false;
    return validPassword ? user : null;
}

async function sendPasswordLogin(req, res, requiredRole) {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const user = await authenticatePassword(email, password);
    if (!user || (requiredRole && user.role !== requiredRole) || (!requiredRole && user.role === 'admin')) {
        await writeAudit(req, { userId: user?._id, role: user?.role, action: 'auth.login', resourceType: user ? 'user' : undefined, resourceId: user?._id, status: 'failure' });
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = issueToken(user);
    await writeAudit(req, { userId: user._id, role: user.role, action: 'auth.login', resourceType: 'user', resourceId: user._id, status: 'success' });
    return res.json({ token, user: user.toSafeJson() });
}

router.get('/google-config', (req, res) => {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
    res.json({ enabled: Boolean(clientId), clientId: clientId || null });
});

router.post('/register', registerLimiter, async (req, res, next) => {
    try {
        const { name, email, password, passwordConfirm } = req.body || {};
        const normalizedName = String(name || '').trim();
        const normalizedEmail = String(email || '').toLowerCase().trim();

        if (!normalizedName || !normalizedEmail || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (normalizedName.length < 2 || normalizedName.length > 120) {
            return res.status(400).json({ error: 'Full name must be between 2 and 120 characters' });
        }

        if (!EMAIL_RE.test(normalizedEmail) || normalizedEmail.length > 255) {
            return res.status(400).json({ error: 'Enter a valid email address' });
        }

        if (String(password).length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        if (passwordConfirm !== undefined && String(password) !== String(passwordConfirm)) {
            return res.status(400).json({ error: 'Passwords do not match' });
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'role')) {
            return res.status(400).json({ error: 'Public registration does not accept a role' });
        }

        const existing = await User.findOne({ email: normalizedEmail });
        if (existing) {
            return res.status(409).json({ error: 'Email already exists' });
        }

        const passwordHash = await bcrypt.hash(String(password), 12);
        const user = await User.create({
            name: normalizedName,
            email: normalizedEmail,
            passwordHash,
            role: 'patient',
            authProvider: 'local',
        });

        const token = issueToken(user);
        await writeAudit(req, { userId: user._id, role: user.role, action: 'auth.register', resourceType: 'user', resourceId: user._id, status: 'success' });
        return res.status(201).json({ token, user: user.toSafeJson() });
    } catch (e) {
        if (e?.code === 11000) return res.status(409).json({ error: 'Email already exists' });
        return next(e);
    }
});

router.post('/login', loginLimiter, async (req, res, next) => {
    try {
        return await sendPasswordLogin(req, res, null);
    } catch (e) {
        return next(e);
    }
});

router.post('/admin-login', loginLimiter, async (req, res, next) => {
    try {
        return await sendPasswordLogin(req, res, 'admin');
    } catch (e) {
        return next(e);
    }
});

router.post('/google', googleAuthLimiter, async (req, res, next) => {
    try {
        const credential = String(req.body?.credential || '').trim();
        const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
        if (!clientId) return res.status(503).json({ error: 'Google login is not configured' });
        if (!credential || credential.length > 10000) return res.status(400).json({ error: 'Invalid Google credential' });

        let payload;
        try {
            const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
            payload = ticket.getPayload();
        } catch {
            await writeAudit(req, { action: 'auth.google_login', status: 'failure' });
            return res.status(401).json({ error: 'Google authentication failed' });
        }

        if (!payload?.sub || !payload?.email || payload.email_verified !== true) {
            await writeAudit(req, { action: 'auth.google_login', status: 'failure' });
            return res.status(401).json({ error: 'Google authentication failed' });
        }

        const email = String(payload.email).toLowerCase().trim();
        let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email }] }).select('+googleId');
        if (user?.isActive === false) {
            await writeAudit(req, { userId: user._id, role: user.role, action: 'auth.google_login', status: 'failure' });
            return res.status(401).json({ error: 'Google authentication failed' });
        }
        if (user?.role === 'admin') {
            await writeAudit(req, { userId: user._id, role: user.role, action: 'auth.google_login', status: 'failure' });
            return res.status(401).json({ error: 'Google authentication failed' });
        }
        if (user?.googleId && user.googleId !== payload.sub) {
            await writeAudit(req, { userId: user._id, role: user.role, action: 'auth.google_login', status: 'failure' });
            return res.status(409).json({ error: 'This email is linked to a different Google account' });
        }

        if (!user) {
            user = await User.create({
                name: String(payload.name || email.split('@')[0]).trim().slice(0, 120),
                email,
                role: 'patient',
                authProvider: 'google',
                googleId: payload.sub,
                profileImage: payload.picture ? String(payload.picture).slice(0, 2048) : null,
            });
        } else if (!user.googleId) {
            user.googleId = payload.sub;
            if (payload.picture && !user.profileImage) user.profileImage = String(payload.picture).slice(0, 2048);
            await user.save();
        }

        const token = issueToken(user);
        await writeAudit(req, { userId: user._id, role: user.role, action: 'auth.google_login', resourceType: 'user', resourceId: user._id, status: 'success' });
        return res.json({ token, user: user.toSafeJson() });
    } catch (error) {
        if (error?.code === 11000) return res.status(409).json({ error: 'Google account is already linked' });
        return next(error);
    }
});

router.get('/me', requireAuth, async (req, res) => {
    res.json({ user: req.user.toSafeJson() });
});

module.exports = router;
