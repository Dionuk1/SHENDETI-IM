require('dotenv').config();

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const { connectDb } = require('../config/db');
const User = require('../models/User');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

(async () => {
    const email = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
    const password = String(process.env.ADMIN_PASSWORD || '');
    if (!EMAIL_RE.test(email)) throw new Error('Set a valid ADMIN_EMAIL in .env.');
    if (password.length < 12) throw new Error('Set a private ADMIN_PASSWORD with at least 12 characters in .env.');

    await connectDb();

    const existingAdmin = await User.findOne({ role: 'admin' }).select('email');
    if (existingAdmin) {
        const emailConflict = await User.exists({ email, _id: { $ne: existingAdmin._id } });
        if (emailConflict) throw new Error('ADMIN_EMAIL is already used by another account.');

        const passwordHash = await bcrypt.hash(password, 12);
        await User.updateOne(
            { _id: existingAdmin._id },
            { $set: { email, passwordHash } },
            { timestamps: false }
        );
        console.log('Admin account updated successfully.');
        return;
    }

    const target = await User.exists({ email });
    if (target) throw new Error('ADMIN_EMAIL already belongs to a non-admin account.');

    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({ name: 'Administrator', email, passwordHash, role: 'admin', authProvider: 'local' });
    console.log('Admin account created successfully.');
})()
    .catch((error) => {
        console.error(`Admin bootstrap stopped: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
