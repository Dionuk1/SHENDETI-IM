const jwt = require('jsonwebtoken');
const User = require('../models/User');

function getJwtSecret() {
    const s = process.env.JWT_SECRET;
    if (!s) {
        const err = new Error('Missing JWT_SECRET');
        err.statusCode = 500;
        throw err;
    }
    return s;
}

async function requireAuth(req, res, next) {
    try {
        const header = req.headers.authorization || '';
        const [type, token] = header.split(' ');

        if (type !== 'Bearer' || !token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        let payload;
        try {
            payload = jwt.verify(token, getJwtSecret());
        } catch {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await User.findById(payload.sub);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        req.user = user;
        return next();
    } catch (e) {
        return next(e);
    }
}

module.exports = {
    requireAuth,
    getJwtSecret,
};
