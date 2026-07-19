const path = require('path');

const express = require('express');
const helmet = require('helmet');

require('dotenv').config();

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

// ✨ Fraud Detection Middleware (Early in chain)
app.use(fraudDetectionMiddleware);

// Serve static files (public folder + SHËNDETI IM HTML)
app.use(express.static(path.join(__dirname, 'public')));

// Silence browser favicon requests (avoids noisy 404s in console)
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

app.get('/', (req, res) => {
    // Serve the existing SHËNDETI IM HTML
    res.sendFile(path.join(__dirname, 'bluecare', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
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

(async () => {
    await connectDb();
    app.listen(port, () => {
        console.log(`SHËNDETI IM server running on http://localhost:${port}`);
    });
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
