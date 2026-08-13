require('dotenv').config();

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const { connectDb } = require('../config/db');
const User = require('../models/User');

const APPLY = process.argv.includes('--apply');
const INCLUDE_ADMIN = process.argv.includes('--include-admin');
const ALLOW_GOOGLE_ONLY = process.argv.includes('--allow-google-only');
const ALL_TEST_USERS = process.argv.includes('--all-test-users');
const TEST_EMAIL_RE = /@shendeti-im\.test$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function argumentValue(name) {
    const prefix = `${name}=`;
    const argument = process.argv.find((value) => value.startsWith(prefix));
    return argument ? argument.slice(prefix.length) : '';
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function validateArguments() {
    const email = normalizeEmail(argumentValue('--email'));
    if (Boolean(email) === Boolean(ALL_TEST_USERS)) {
        throw new Error('Use exactly one target: --email=<address> or --all-test-users.');
    }
    if (email && !EMAIL_RE.test(email)) throw new Error('Provide a valid normalized email address.');
    return email;
}

function skipReason(user) {
    if (user.role === 'admin' && !INCLUDE_ADMIN) return 'admin skipped (use --include-admin to include it)';
    if (!user.passwordHash && user.authProvider === 'google' && !ALLOW_GOOGLE_ONLY) {
        return 'Google-only account skipped (use --allow-google-only to add a local password)';
    }
    return null;
}

(async () => {
    const email = validateArguments();
    const password = String(process.env.RESET_USER_PASSWORD || '');
    if (APPLY && password.length < 8) {
        throw new Error('Set RESET_USER_PASSWORD to at least 8 characters before using --apply.');
    }

    await connectDb();

    const query = ALL_TEST_USERS ? { email: TEST_EMAIL_RE } : { email };
    const users = await User.find(query).select('+passwordHash').sort({ email: 1 });
    if (!ALL_TEST_USERS && users.length === 0) throw new Error('No user exists with that email address.');

    const targets = [];
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);
    for (const user of users) {
        const normalized = normalizeEmail(user.email);
        if (normalized !== user.email || (ALL_TEST_USERS && !TEST_EMAIL_RE.test(normalized))) {
            console.log(`SKIP ${user._id}: stored email is not safely normalized for this operation`);
            continue;
        }

        const reason = skipReason(user);
        if (reason) {
            console.log(`SKIP ${normalized}: ${reason}`);
            continue;
        }

        targets.push(user);
        console.log(`${APPLY ? 'RESET' : 'WOULD RESET'} ${normalized} (${user.role})`);
    }

    if (!APPLY) {
        console.log(`Dry run complete. ${targets.length} user(s) would be updated; no documents were modified.`);
        return;
    }

    let updated = 0;
    for (const user of targets) {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await User.updateOne(
            { _id: user._id },
            { $set: { passwordHash } },
            { timestamps: false }
        );
        updated += result.modifiedCount;
    }
    console.log(`Password reset complete. ${updated} user(s) updated successfully.`);
})()
    .catch((error) => {
        console.error(`Password reset stopped: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
