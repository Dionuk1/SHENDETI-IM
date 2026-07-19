const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const Appointment = require('../src/models/Appointment');
const User = require('../src/models/User');
const Prescription = require('../src/models/Prescription');
const { appointmentDuration } = require('../src/utils/appointments');
const { decryptText, encryptText, validateAesConfiguration } = require('../src/utils/aes256');

test('AES configuration accepts a 64-character hex key and rejects invalid keys', () => {
    const original = process.env.MEDICAL_AES_KEY;
    try {
        process.env.MEDICAL_AES_KEY = crypto.randomBytes(32).toString('hex');
        assert.equal(validateAesConfiguration(), true);
        const encrypted = encryptText('new test value');
        assert.equal(decryptText(encrypted), 'new test value');

        process.env.MEDICAL_AES_KEY = 'invalid';
        assert.throws(() => validateAesConfiguration(), /must be 32 bytes/);
    } finally {
        if (original === undefined) delete process.env.MEDICAL_AES_KEY;
        else process.env.MEDICAL_AES_KEY = original;
    }
});

test('appointment schema keeps cancellation metadata and an atomic active slot key', () => {
    const paths = Appointment.schema.paths;
    assert.ok(paths['cancelledBy.userId']);
    assert.ok(paths['cancelledBy.role']);
    assert.ok(paths.cancelledAt);
    assert.ok(paths.cancellationReason);
    assert.ok(paths.activeSlotKey);

    const appointment = new Appointment({
        patientId: '507f191e810c19729de860ea',
        doctorId: '507f191e810c19729de860eb',
        service: 'Konsultim',
        scheduledAt: new Date('2030-01-01T10:00:00.000Z'),
        status: 'pending',
    });
    return appointment.validate().then(() => {
        assert.match(appointment.activeSlotKey, /2030-01-01T10:00:00\.000Z$/);
        appointment.status = 'cancelled';
        return appointment.validate();
    }).then(() => assert.equal(appointment.activeSlotKey, undefined));
});

test('Google users can omit a password while local password hashes stay hidden by default', () => {
    assert.equal(User.schema.path('passwordHash').options.select, false);
    const googleUser = new User({
        name: 'Google Patient',
        email: 'patient@example.test',
        role: 'patient',
        authProvider: 'google',
        googleId: 'verified-google-subject',
    });
    assert.equal(googleUser.passwordHash, null);
    assert.equal(googleUser.toSafeJson().googleId, undefined);
});

test('appointment duration reuses the selected doctor service duration', () => {
    const doctor = { services: [{ name: 'ECG', durationMinutes: 20, available: true }] };
    assert.equal(appointmentDuration(doctor, 'ECG'), 20);
    assert.equal(appointmentDuration(doctor, 'Unknown'), 30);
});

test('prescription schema reuses encrypted content and has a minimal compatible status', () => {
    assert.ok(Prescription.schema.path('bodyEncrypted'));
    assert.ok(Prescription.schema.path('patientId'));
    assert.ok(Prescription.schema.path('doctorId'));
    assert.ok(Prescription.schema.path('appointmentId'));
    assert.deepEqual(Prescription.schema.path('status').enumValues, ['active', 'completed', 'cancelled']);
    assert.equal(Prescription.schema.path('status').defaultValue, 'active');
});
