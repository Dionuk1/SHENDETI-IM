const path = require('path');

const express = require('express');

require('dotenv').config();

function requireEnv(name) {
    if (!process.env[name]) {
        throw new Error(`Missing required env var: ${name} (see .env.example)`);
    }
}

requireEnv('JWT_SECRET');
requireEnv('MEDICAL_AES_KEY');

const { connectDb } = require('./src/config/db');

const authRoutes = require('./src/routes/auth');
const publicRoutes = require('./src/routes/public');
const appointmentRoutes = require('./src/routes/appointment');
const patientRoutes = require('./src/routes/patient');
const doctorRoutes = require('./src/routes/doctor');
const doctorsAdminRoutes = require('./src/routes/doctors');
const adminRoutes = require('./src/routes/admin');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Serve static files (public folder + HealthFlow OS HTML)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    // Serve the existing HealthFlow OS HTML
    res.sendFile(path.join(__dirname, 'bluecare', 'index.html'));
});

app.use('/api', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/admin/doctors', doctorsAdminRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
    // Avoid leaking internals.
    const status = Number(err.statusCode || err.status || 500);

    if (status >= 500) {
        console.error(err);
    }

    res.status(status).json({
        error: status === 500 ? 'Server error' : (err.message || 'Request failed'),
    });
});

const port = Number(process.env.PORT || 5500);

(async () => {
    await connectDb();
    app.listen(port, () => {
        console.log(`HealthFlow OS server running on http://localhost:${port}`);
    });
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
