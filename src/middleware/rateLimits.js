const { rateLimit } = require('express-rate-limit');

function makeLimiter(windowMs, limit, message) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: message },
        skip: () => process.env.NODE_ENV === 'test',
    });
}

const loginLimiter = makeLimiter(15 * 60 * 1000, 10, 'Too many login attempts. Please try again later.');
const registerLimiter = makeLimiter(60 * 60 * 1000, 10, 'Too many registration attempts. Please try again later.');
const appointmentCreateLimiter = makeLimiter(10 * 60 * 1000, 20, 'Too many appointment requests. Please try again later.');

module.exports = { loginLimiter, registerLimiter, appointmentCreateLimiter };
