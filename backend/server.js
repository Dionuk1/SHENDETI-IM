const path = require('path');

const express = require('express');
const helmet = require('helmet');
const mongoose = require('mongoose');

require('dotenv').config({
    path: process.env.NODE_ENV === 'production'
        ? path.join(__dirname, '.env')
        : [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')],
});

function requireEnv(name) {
    if (!process.env[name]) {
        throw new Error(`Missing required env var: ${name} (see .env.example)`);
    }
}

requireEnv('JWT_SECRET');
requireEnv('MEDICAL_AES_KEY');

const { validateAesConfiguration } = require('./src/utils/aes256');
try {
    validateAesConfiguration();
} catch (error) {
    console.error(`Configuration error: ${error.message}`);
    process.exit(1);
}

const { connectDb } = require('./src/config/db');

const authRoutes = require('./src/routes/auth');
const publicRoutes = require('./src/routes/public');
const appointmentRoutes = require('./src/routes/appointment');
const patientRoutes = require('./src/routes/patient');
const patientsRoutes = require('./src/routes/patients');
const doctorRoutes = require('./src/routes/doctor');
const doctorsSelfRoutes = require('./src/routes/doctorsSelf');
const doctorsAdminRoutes = require('./src/routes/doctors');
const adminRoutes = require('./src/routes/admin');
const notificationRoutes = require('./src/routes/notifications');

// ✨ AI FEATURES
const aiRoutes = require('./src/routes/ai');
const { fraudDetectionMiddleware } = require('./src/middleware/fraudDetection');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

function normalizedOrigins() {
    const configured = String(process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter(Boolean);
    const defaults = process.env.NODE_ENV === 'production'
        ? ['https://shendeti-im.me']
        : [
            'http://localhost:5500',
            'http://127.0.0.1:5500',
            'http://localhost:8080',
            'http://127.0.0.1:8080',
        ];
    const frontendUrl = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');

    return new Set([...defaults, ...configured, ...(frontendUrl ? [frontendUrl] : [])]);
}

const allowedOrigins = normalizedOrigins();

app.use((req, res, next) => {
    const origin = String(req.headers.origin || '').replace(/\/+$/, '');

    if (origin && !allowedOrigins.has(origin)) {
        return res.status(403).json({ error: 'Origin not allowed' });
    }

    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
    }

    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
});

// ✨ Fraud Detection Middleware (Early in chain)
app.use(fraudDetectionMiddleware);

app.get('/health', (req, res) => {
    const databaseConnected = mongoose.connection.readyState === 1;
    res.status(databaseConnected ? 200 : 503).json({
        status: databaseConnected ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        database: databaseConnected ? 'connected' : 'unavailable',
    });
});

app.use('/api', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/doctors', doctorsSelfRoutes);
app.use('/api/admin/doctors', doctorsAdminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/ai', aiRoutes); // ✨ AI Routes

app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
    // Avoid leaking internals.
    const isUploadError = err?.name === 'MulterError';
    const status = Number(err.statusCode || err.status || (isUploadError ? 400 : 500));

    if (status >= 500) {
        console.error(err);
    }

    res.status(status).json({
        error: status >= 500 ? 'Server error' : (err.message || 'Request failed'),
    });
});

const port = Number(process.env.PORT || 5500);
const host = '0.0.0.0';

(async () => {
    await connectDb();
    app.listen(port, host, () => {
        console.log(`SHËNDETI IM API listening on port ${port}`);
    });
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
