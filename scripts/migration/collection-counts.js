#!/usr/bin/env node

const mongoose = require('mongoose');

const EXPECTED_COLLECTIONS = [
    'users',
    'doctors',
    'appointments',
    'prescriptions',
    'medicalrecords',
    'notifications',
    'auditlogs',
];

function selectedUri() {
    const mode = process.argv.includes('--target') ? 'target' : 'source';
    const variable = mode === 'target' ? 'TARGET_MONGODB_URI' : 'SOURCE_MONGODB_URI';
    const uri = String(process.env[variable] || '').trim();
    if (!uri) throw new Error(`${variable} is required`);
    return { mode, uri };
}

async function main() {
    if (!process.argv.includes('--confirm-read')) {
        throw new Error('Dry-run inventory refused: pass --confirm-read to perform read-only counts');
    }
    if (process.argv.includes('--apply')) {
        throw new Error('This helper is read-only and does not support --apply');
    }

    const { mode, uri } = selectedUri();
    await mongoose.connect(uri, { autoIndex: false });
    try {
        const existing = new Set(
            (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray())
                .map((item) => item.name)
        );
        const counts = {};
        for (const name of EXPECTED_COLLECTIONS) {
            counts[name] = existing.has(name)
                ? await mongoose.connection.db.collection(name).countDocuments({})
                : null;
        }
        process.stdout.write(`${JSON.stringify({ mode, counts }, null, 2)}\n`);
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((error) => {
    process.stderr.write(`Collection count failed: ${error.message}\n`);
    process.exitCode = 1;
});
