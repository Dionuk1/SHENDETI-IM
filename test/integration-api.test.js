const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

require('dotenv').config();

const User = require('../src/models/User');
const Doctor = require('../src/models/Doctor');
const Appointment = require('../src/models/Appointment');
const Prescription = require('../src/models/Prescription');
const Notification = require('../src/models/Notification');
const AuditLog = require('../src/models/AuditLog');
const { connectDb } = require('../src/config/db');
const { decryptPrescriptionContent, encryptPrescriptionContent } = require('../src/utils/prescriptions');

const shouldRun = process.env.RUN_INTEGRATION === '1';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:5510';

async function request(path, { method = 'GET', token, body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
}

function nextWeekdayDate() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function runPasswordResetCommand(args, resetPassword) {
    return spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'scripts', 'resetUserPasswords.js'), ...args], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, RESET_USER_PASSWORD: resetPassword || '' },
        encoding: 'utf8',
        timeout: 30000,
    });
}

test('real authentication, scheduling, cancellation, notifications, audit logs, and analytics', { skip: !shouldRun }, async () => {
    await connectDb();
    const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const password = crypto.randomBytes(18).toString('base64url');
    const patientEmail = `integration-patient-${suffix}@example.test`;
    const secondPatientEmail = `integration-patient2-${suffix}@example.test`;
    const doctorEmail = `integration-doctor-${suffix}@example.test`;
    const otherDoctorEmail = `integration-doctor2-${suffix}@example.test`;
    const adminEmail = `integration-admin-${suffix}@example.test`;
    const userIds = [];
    const doctorIds = [];

    try {
        let result = await request('/api/auth/register', { method: 'POST', body: { name: 'Integration Patient', email: patientEmail, password, passwordConfirm: password } });
        assert.equal(result.response.status, 201);
        assert.ok(result.data.token);
        assert.equal(result.data.user.role, 'patient');
        assert.equal(result.data.user.passwordHash, undefined);
        const patientToken = result.data.token;
        userIds.push(result.data.user.id);

        result = await request('/api/auth/register', { method: 'POST', body: { name: 'Blocked Doctor', email: `blocked-${suffix}@example.test`, password, passwordConfirm: password, role: 'doctor' } });
        assert.equal(result.response.status, 400);
        result = await request('/api/auth/register', { method: 'POST', body: { name: 'Blocked Admin', email: `blocked-admin-${suffix}@example.test`, password, passwordConfirm: password, role: 'admin' } });
        assert.equal(result.response.status, 400);
        result = await request('/api/auth/register', { method: 'POST', body: { name: 'Duplicate Patient', email: patientEmail, password, passwordConfirm: password } });
        assert.equal(result.response.status, 409);
        result = await request('/api/auth/login', { method: 'POST', body: { email: patientEmail, password: `${password}wrong` } });
        assert.equal(result.response.status, 401);

        const storedPatient = await User.findOne({ email: patientEmail }).select('+passwordHash');
        assert.notEqual(storedPatient.passwordHash, password);
        assert.equal(await bcrypt.compare(password, storedPatient.passwordHash), true);

        result = await request('/api/auth/register', { method: 'POST', body: { name: 'Second Patient', email: secondPatientEmail, password, passwordConfirm: password } });
        assert.equal(result.response.status, 201);
        const secondPatientToken = result.data.token;
        const secondPatientId = result.data.user.id;
        userIds.push(result.data.user.id);

        const passwordHash = await bcrypt.hash(password, 12);
        const [doctorUser, otherDoctorUser, adminUser] = await User.create([
            { name: 'Integration Doctor', email: doctorEmail, passwordHash, role: 'doctor' },
            { name: 'Integration Other Doctor', email: otherDoctorEmail, passwordHash, role: 'doctor' },
            { name: 'Integration Admin', email: adminEmail, passwordHash, role: 'admin' },
        ]);
        userIds.push(doctorUser._id, otherDoctorUser._id, adminUser._id);

        const scriptUserEmail = `integration-reset-${suffix}@shendeti-im.test`;
        const googleOnlyEmail = `integration-google-${suffix}@shendeti-im.test`;
        const scriptAdminEmail = `integration-admin-reset-${suffix}@shendeti-im.test`;
        const [scriptUser, googleOnlyUser, scriptAdmin] = await User.create([
            { name: 'Password Script User', email: scriptUserEmail, passwordHash, role: 'patient', profileImage: 'https://example.test/profile.png' },
            { name: 'Google-only Script User', email: googleOnlyEmail, role: 'patient', authProvider: 'google', googleId: `integration-google-${suffix}` },
            { name: 'Password Script Admin', email: scriptAdminEmail, passwordHash, role: 'admin' },
        ]);
        userIds.push(scriptUser._id, googleOnlyUser._id, scriptAdmin._id);
        const fixtureTime = Date.now();
        await Promise.all([
            User.updateOne({ _id: scriptUser._id }, { $set: { createdAt: new Date(fixtureTime + 1000) } }, { timestamps: false }),
            User.updateOne({ _id: googleOnlyUser._id }, { $set: { createdAt: new Date(fixtureTime + 2000) } }, { timestamps: false }),
            User.updateOne({ _id: scriptAdmin._id }, { $set: { createdAt: new Date(fixtureTime + 3000) } }, { timestamps: false }),
        ]);

        const scriptPassword = crypto.randomBytes(20).toString('base64url');
        const scriptDryRun = runPasswordResetCommand([`--email=${scriptUserEmail}`], scriptPassword);
        assert.equal(scriptDryRun.status, 0);
        assert.match(scriptDryRun.stdout, /DRY RUN \(no writes\)/);
        assert.equal(await bcrypt.compare(password, (await User.findById(scriptUser._id).select('+passwordHash')).passwordHash), true);

        const scriptApply = runPasswordResetCommand([`--email=${scriptUserEmail}`, '--apply'], scriptPassword);
        assert.equal(scriptApply.status, 0);
        const scriptUserAfter = await User.findById(scriptUser._id).select('+passwordHash');
        assert.equal(await bcrypt.compare(password, scriptUserAfter.passwordHash), false);
        assert.equal(await bcrypt.compare(scriptPassword, scriptUserAfter.passwordHash), true);
        assert.equal(scriptUserAfter.name, scriptUser.name);
        assert.equal(scriptUserAfter.role, scriptUser.role);
        assert.equal(scriptUserAfter.profileImage, scriptUser.profileImage);
        assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: scriptUserEmail, password } })).response.status, 401);
        assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: scriptUserEmail, password: scriptPassword } })).response.status, 200);

        const googleOnlyDryRun = runPasswordResetCommand([`--email=${googleOnlyEmail}`], scriptPassword);
        assert.equal(googleOnlyDryRun.status, 0);
        assert.match(googleOnlyDryRun.stdout, /Google-only account skipped/);
        assert.equal((await User.findById(googleOnlyUser._id).select('+passwordHash')).passwordHash, null);

        const bulkDryRun = runPasswordResetCommand(['--all-test-users'], scriptPassword);
        assert.equal(bulkDryRun.status, 0);
        assert.match(bulkDryRun.stdout, new RegExp(`SKIP ${scriptAdminEmail}`));
        assert.doesNotMatch(bulkDryRun.stdout, new RegExp(patientEmail));

        const bulkWithAdminDryRun = runPasswordResetCommand(['--all-test-users', '--include-admin'], scriptPassword);
        assert.equal(bulkWithAdminDryRun.status, 0);
        assert.match(bulkWithAdminDryRun.stdout, new RegExp(`WOULD RESET ${scriptAdminEmail}`));
        const [doctor, otherDoctor] = await Doctor.create([
            { name: 'Integration Doctor', email: doctorEmail, passwordHash, specialization: 'general', department: 'Integration', services: [{ name: 'Consultation', durationMinutes: 30 }] },
            { name: 'Integration Other Doctor', email: otherDoctorEmail, passwordHash, specialization: 'general', department: 'Integration', services: [{ name: 'Consultation', durationMinutes: 30 }] },
        ]);
        doctorIds.push(doctor._id, otherDoctor._id);

        const patientRoleFromDatabase = await request('/api/auth/login', { method: 'POST', body: { email: patientEmail, password, role: 'doctor' } });
        assert.equal(patientRoleFromDatabase.response.status, 200);
        assert.equal(patientRoleFromDatabase.data.user.role, 'patient');
        const doctorLogin = await request('/api/auth/login', { method: 'POST', body: { email: doctorEmail, password } });
        const otherDoctorLogin = await request('/api/auth/login', { method: 'POST', body: { email: otherDoctorEmail, password } });
        const publicAdminLogin = await request('/api/auth/login', { method: 'POST', body: { email: adminEmail, password } });
        const adminLogin = await request('/api/auth/admin-login', { method: 'POST', body: { email: adminEmail, password } });
        assert.equal(doctorLogin.response.status, 200);
        assert.equal(otherDoctorLogin.response.status, 200);
        assert.equal(publicAdminLogin.response.status, 401);
        assert.equal(adminLogin.response.status, 200);
        assert.equal(adminLogin.data.user.role, 'admin');

        const allAdminUsers = [];
        let userPage = 1;
        let userPages = 1;
        while (userPage <= userPages) {
            const pageResult = await request(`/api/admin/users?page=${userPage}&limit=5`, { token: adminLogin.data.token });
            assert.equal(pageResult.response.status, 200);
            assert.ok(pageResult.data.users.every((item) => item.passwordHash === undefined));
            allAdminUsers.push(...pageResult.data.users);
            userPages = pageResult.data.pagination.totalPages;
            userPage += 1;
        }
        assert.equal(new Set(allAdminUsers.map((item) => item.id)).size, allAdminUsers.length);
        assert.equal((await request('/api/admin/users', { token: patientToken })).response.status, 403);
        assert.equal((await request('/api/admin/users', { token: doctorLogin.data.token })).response.status, 403);

        const newPatientPassword = crypto.randomBytes(20).toString('base64url');
        const patientSnapshot = {
            name: storedPatient.name,
            email: storedPatient.email,
            role: storedPatient.role,
            authProvider: storedPatient.authProvider,
            isActive: storedPatient.isActive,
        };
        assert.equal((await request(`/api/admin/users/${storedPatient._id}/password`, { method: 'PATCH', token: patientToken, body: { newPassword: newPatientPassword } })).response.status, 403);
        assert.equal((await request(`/api/admin/users/${storedPatient._id}/password`, { method: 'PATCH', token: doctorLogin.data.token, body: { newPassword: newPatientPassword } })).response.status, 403);
        assert.equal((await request(`/api/admin/users/${storedPatient._id}/password`, { method: 'PATCH', token: adminLogin.data.token, body: { newPassword: newPatientPassword, role: 'admin' } })).response.status, 400);
        const passwordReset = await request(`/api/admin/users/${storedPatient._id}/password`, { method: 'PATCH', token: adminLogin.data.token, body: { newPassword: newPatientPassword } });
        assert.equal(passwordReset.response.status, 200);
        assert.equal(passwordReset.data.message, 'Fjalëkalimi u ndryshua me sukses.');
        assert.equal(passwordReset.data.passwordHash, undefined);

        const resetPatient = await User.findById(storedPatient._id).select('+passwordHash');
        assert.deepEqual({
            name: resetPatient.name,
            email: resetPatient.email,
            role: resetPatient.role,
            authProvider: resetPatient.authProvider,
            isActive: resetPatient.isActive,
        }, patientSnapshot);
        assert.equal(await bcrypt.compare(password, resetPatient.passwordHash), false);
        assert.equal(await bcrypt.compare(newPatientPassword, resetPatient.passwordHash), true);
        assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: patientEmail, password } })).response.status, 401);
        assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: patientEmail, password: newPatientPassword } })).response.status, 200);

        const managedDoctorEmail = `integration-managed-doctor-${suffix}@example.test`;
        const managedDoctor = await request('/api/admin/doctors', {
            method: 'POST',
            token: adminLogin.data.token,
            body: { name: 'Managed Integration Doctor', email: managedDoctorEmail, password, specialization: 'general', department: 'Integration' },
        });
        assert.equal(managedDoctor.response.status, 201);
        doctorIds.push(managedDoctor.data.doctor.id);
        const managedDoctorUser = await User.findOne({ email: managedDoctorEmail });
        assert.ok(managedDoctorUser);
        userIds.push(managedDoctorUser._id);
        assert.equal((await request(`/api/admin/doctors/${managedDoctor.data.doctor.id}`, { method: 'DELETE', token: adminLogin.data.token })).response.status, 200);
        assert.equal((await User.findById(managedDoctorUser._id)).isActive, false);

        const userOnlyDoctor = await User.create({ name: 'User Only Doctor', email: `integration-user-only-${suffix}@example.test`, passwordHash, role: 'doctor' });
        const profileOnlyDoctor = await Doctor.create({ name: 'Profile Only Doctor', email: `integration-profile-only-${suffix}@example.test`, passwordHash, specialization: 'general', department: 'Integration' });
        userIds.push(userOnlyDoctor._id);
        doctorIds.push(profileOnlyDoctor._id);

        const allAdminDoctors = [];
        let doctorPage = 1;
        let doctorPages = 1;
        while (doctorPage <= doctorPages) {
            const pageResult = await request(`/api/admin/doctors?page=${doctorPage}&limit=5`, { token: adminLogin.data.token });
            assert.equal(pageResult.response.status, 200);
            assert.ok(pageResult.data.doctors.every((item) => item.passwordHash === undefined));
            allAdminDoctors.push(...pageResult.data.doctors);
            doctorPages = pageResult.data.pagination.totalPages;
            doctorPage += 1;
        }
        assert.equal(new Set(allAdminDoctors.map((item) => item.email)).size, allAdminDoctors.length);
        assert.equal(allAdminDoctors.find((item) => item.email === managedDoctorEmail).isActive, false);
        assert.equal(allAdminDoctors.find((item) => item.email === userOnlyDoctor.email).profileComplete, false);
        assert.equal(allAdminDoctors.find((item) => item.email === profileOnlyDoctor.email).accountExists, false);
        assert.equal((await request('/api/admin/doctors', { token: patientToken })).response.status, 403);
        assert.equal((await request('/api/admin/doctors', { token: doctorLogin.data.token })).response.status, 403);

        const date = nextWeekdayDate();
        const slotsResult = await request(`/api/appointments/slots/${doctor._id}?date=${date}&service=Consultation`);
        assert.equal(slotsResult.response.status, 200);
        const available = slotsResult.data.slots.filter((slot) => slot.available);
        assert.ok(available.length >= 3);

        const createBody = { doctorId: doctor._id.toString(), service: 'Consultation', scheduledAt: available[0].scheduledAt };
        const created = await request('/api/appointments/create', { method: 'POST', token: patientToken, body: createBody });
        assert.equal(created.response.status, 201);
        const firstId = created.data.appointment.id;
        const doctorApproval = await request(`/api/doctor/appointments/${firstId}`, { method: 'PATCH', token: doctorLogin.data.token, body: { status: 'confirmed' } });
        assert.equal(doctorApproval.response.status, 200);
        assert.equal(doctorApproval.data.appointment.status, 'confirmed');
        const doctorAppointmentList = await request('/api/doctor/appointments', { token: doctorLogin.data.token });
        const authorizedAppointment = doctorAppointmentList.data.appointments.find((item) => item.id === firstId);
        assert.equal(authorizedAppointment.prescriptionEligible, true);
        assert.equal(authorizedAppointment.patient.passwordHash, undefined);
        assert.equal((await request('/api/doctor/appointments', { token: otherDoctorLogin.data.token })).data.appointments.some((item) => item.id === firstId), false);
        assert.equal((await request(`/api/doctor/appointments/${firstId}`, { method: 'PATCH', token: doctorLogin.data.token, body: { status: 'confirmed' } })).response.status, 409);
        const unsafeDelete = await request(`/api/admin/users/${storedPatient._id}`, { method: 'DELETE', token: adminLogin.data.token });
        assert.equal(unsafeDelete.response.status, 409);
        assert.ok(unsafeDelete.data.relatedRecords.appointments > 0);
        assert.ok(await User.exists({ _id: storedPatient._id }));

        const doubleBooked = await request('/api/appointments/create', { method: 'POST', token: secondPatientToken, body: createBody });
        assert.equal(doubleBooked.response.status, 409);
        assert.equal((await request(`/api/appointments/${firstId}`, { method: 'DELETE', token: secondPatientToken, body: { reason: '' } })).response.status, 404);
        assert.equal((await request(`/api/doctor/appointments/${firstId}`, { method: 'DELETE', token: otherDoctorLogin.data.token, body: { reason: '' } })).response.status, 404);
        assert.equal((await request(`/api/doctor/appointments/${firstId}`, { method: 'DELETE', token: doctorLogin.data.token, body: { reason: 'Schedule changed' } })).response.status, 200);
        const cancelledDoctorAppointment = (await request('/api/doctor/appointments', { token: doctorLogin.data.token })).data.appointments.find((item) => item.id === firstId);
        assert.equal(cancelledDoctorAppointment.prescriptionEligible, false);
        assert.equal((await request(`/api/appointments/${firstId}`, { method: 'DELETE', token: patientToken, body: { reason: '' } })).response.status, 409);
        assert.equal((await request(`/api/doctor/appointments/${firstId}`, { method: 'PATCH', token: doctorLogin.data.token, body: { status: 'confirmed' } })).response.status, 409);

        const released = await request(`/api/appointments/slots/${doctor._id}?date=${date}&service=Consultation`);
        assert.equal(released.data.slots.find((slot) => slot.time === available[0].time).available, true);
        const rebookedReleasedSlot = await request('/api/appointments/create', { method: 'POST', token: patientToken, body: createBody });
        assert.equal(rebookedReleasedSlot.response.status, 201);
        assert.equal((await request(`/api/admin/appointments/${rebookedReleasedSlot.data.appointment.id}`, { method: 'DELETE', token: adminLogin.data.token, body: { reason: 'Fixture cleanup through API' } })).response.status, 200);

        const completed = await request('/api/appointments/create', { method: 'POST', token: patientToken, body: { ...createBody, scheduledAt: available[1].scheduledAt } });
        assert.equal(completed.response.status, 201);
        assert.equal((await request(`/api/doctor/appointments/${completed.data.appointment.id}`, { method: 'PATCH', token: doctorLogin.data.token, body: { status: 'completed' } })).response.status, 409);
        assert.equal((await request(`/api/doctor/appointments/${completed.data.appointment.id}`, { method: 'PATCH', token: doctorLogin.data.token, body: { status: 'confirmed' } })).response.status, 200);

        const prescriptionBody = {
            patientId: storedPatient._id.toString(),
            appointmentId: completed.data.appointment.id,
            diagnosis: 'Integration diagnosis',
            medicationName: 'Integration medication',
            dosage: 'Integration dosage',
            frequency: 'Integration frequency',
            duration: 'Integration duration',
            instructions: 'Integration instructions',
            additionalNotes: 'Integration additional notes',
        };
        assert.equal((await request('/api/doctor/prescriptions', { method: 'POST', token: patientToken, body: prescriptionBody })).response.status, 403);
        assert.equal((await request('/api/doctor/prescriptions', { method: 'POST', token: adminLogin.data.token, body: prescriptionBody })).response.status, 403);
        const wrongDoctorPrescription = await request('/api/doctor/prescriptions', { method: 'POST', token: otherDoctorLogin.data.token, body: prescriptionBody });
        assert.equal(wrongDoctorPrescription.response.status, 403);
        assert.equal(wrongDoctorPrescription.data.error, 'Termini nuk i përket doktorit të kyçur.');
        const missingAppointmentPrescription = await request('/api/doctor/prescriptions', { method: 'POST', token: doctorLogin.data.token, body: { ...prescriptionBody, appointmentId: '' } });
        assert.equal(missingAppointmentPrescription.response.status, 400);
        assert.equal(missingAppointmentPrescription.data.error, 'Termini i zgjedhur nuk ekziston.');
        const wrongPatientPrescription = await request('/api/doctor/prescriptions', { method: 'POST', token: doctorLogin.data.token, body: { ...prescriptionBody, patientId: secondPatientId } });
        assert.equal(wrongPatientPrescription.response.status, 403);
        assert.equal(wrongPatientPrescription.data.error, 'Termini nuk i përket këtij pacienti.');
        const cancelledPrescription = await request('/api/doctor/prescriptions', { method: 'POST', token: doctorLogin.data.token, body: { ...prescriptionBody, appointmentId: firstId } });
        assert.equal(cancelledPrescription.response.status, 409);
        assert.equal(cancelledPrescription.data.error, 'Statusi i terminit nuk lejon krijimin e receptit.');

        await User.updateOne({ _id: storedPatient._id }, { $unset: { isActive: 1 } }, { timestamps: false });
        const createdPrescription = await request('/api/doctor/prescriptions', { method: 'POST', token: doctorLogin.data.token, body: prescriptionBody });
        assert.equal(createdPrescription.response.status, 201);
        assert.equal(createdPrescription.data.prescription.status, 'active');
        assert.match(createdPrescription.data.prescription.referenceNumber, /^RX-/);
        assert.equal((await request('/api/doctor/prescriptions', { method: 'POST', token: doctorLogin.data.token, body: prescriptionBody })).response.status, 409);

        const storedPrescription = await Prescription.findById(createdPrescription.data.prescription.id).lean();
        assert.ok(storedPrescription.bodyEncrypted?.ciphertext);
        assert.equal(storedPrescription.title, 'Recept digjital');
        assert.doesNotMatch(storedPrescription.bodyEncrypted.ciphertext, /Integration medication/);
        assert.equal(decryptPrescriptionContent(storedPrescription.bodyEncrypted).medicationName, prescriptionBody.medicationName);
        assert.equal(storedPrescription.patientId.toString(), storedPatient._id.toString());
        assert.equal(storedPrescription.doctorId.toString(), doctorUser._id.toString());
        assert.equal(storedPrescription.appointmentId.toString(), completed.data.appointment.id);

        const patientPrescriptionList = await request('/api/patient/prescriptions', { token: patientToken });
        assert.equal(patientPrescriptionList.response.status, 200);
        assert.equal(patientPrescriptionList.data.prescriptions[0].id, storedPrescription._id.toString());
        assert.ok(patientPrescriptionList.data.prescriptions.some((item) => item.id === storedPrescription._id.toString()));
        const patientPrescriptionDetail = await request(`/api/patient/prescriptions/${storedPrescription._id}`, { token: patientToken });
        assert.equal(patientPrescriptionDetail.response.status, 200);
        assert.equal(patientPrescriptionDetail.data.prescription.content.medicationName, prescriptionBody.medicationName);
        assert.equal(patientPrescriptionDetail.data.prescription.patient.name, storedPatient.name);
        assert.equal((await request(`/api/patient/prescriptions/${storedPrescription._id}`, { token: secondPatientToken })).response.status, 404);
        assert.equal((await request(`/api/doctor/prescriptions/${storedPrescription._id}`, { token: doctorLogin.data.token })).response.status, 200);
        assert.equal((await request(`/api/doctor/prescriptions/${storedPrescription._id}`, { token: otherDoctorLogin.data.token })).response.status, 404);

        const approvedHistory = await request('/api/patient/history', { token: patientToken });
        assert.equal(approvedHistory.response.status, 200);
        assert.equal(approvedHistory.data.history.some((item) => item.id === completed.data.appointment.id), false);
        assert.equal((await request(`/api/doctor/appointments/${completed.data.appointment.id}`, { method: 'PATCH', token: doctorLogin.data.token, body: { status: 'completed' } })).response.status, 200);
        assert.equal((await request(`/api/appointments/${completed.data.appointment.id}`, { method: 'DELETE', token: patientToken, body: { reason: '' } })).response.status, 409);
        assert.equal((await request(`/api/doctor/appointments/${completed.data.appointment.id}`, { method: 'PATCH', token: doctorLogin.data.token, body: { status: 'confirmed' } })).response.status, 409);

        const patientHistory = await request('/api/patient/history', { token: patientToken });
        assert.equal(patientHistory.response.status, 200);
        const completedHistory = patientHistory.data.history.find((item) => item.id === completed.data.appointment.id);
        assert.ok(completedHistory);
        assert.equal(completedHistory.status, 'completed');
        assert.ok(completedHistory.prescriptions.some((item) => item.id === storedPrescription._id.toString()));

        const currentAesKey = process.env.MEDICAL_AES_KEY;
        let oldEncryptedBody;
        try {
            process.env.MEDICAL_AES_KEY = crypto.randomBytes(32).toString('hex');
            oldEncryptedBody = encryptPrescriptionContent({ diagnosis: 'Unavailable legacy value', legacy: false });
        } finally {
            process.env.MEDICAL_AES_KEY = currentAesKey;
        }
        const oldPrescription = await Prescription.create({
            patientId: storedPatient._id,
            doctorId: doctorUser._id,
            appointmentId: completed.data.appointment.id,
            title: 'Legacy encrypted prescription',
            bodyEncrypted: oldEncryptedBody,
            status: 'active',
        });
        const unavailableDetail = await request(`/api/patient/prescriptions/${oldPrescription._id}`, { token: patientToken });
        assert.equal(unavailableDetail.response.status, 200);
        assert.equal(unavailableDetail.data.prescription.unavailable, true);
        const historyWithUnavailable = await request('/api/patient/history', { token: patientToken });
        const unavailableHistoryPrescription = historyWithUnavailable.data.history
            .find((item) => item.id === completed.data.appointment.id).prescriptions
            .find((item) => item.id === oldPrescription._id.toString());
        assert.equal(unavailableHistoryPrescription.unavailable, true);

        const prescriptionNotifications = await Notification.find({ userId: storedPatient._id, type: 'prescription_created', resourceId: storedPrescription._id.toString() }).lean();
        assert.equal(prescriptionNotifications.length, 1);
        assert.equal(prescriptionNotifications[0].read, false);
        assert.match(prescriptionNotifications[0].message, /^Keni një recept të ri nga Dr\./);
        assert.doesNotMatch(prescriptionNotifications[0].message, /Integration medication|Integration diagnosis/);
        const readPrescriptionNotification = await request(`/api/notifications/${prescriptionNotifications[0]._id}/read`, { method: 'PATCH', token: patientToken });
        assert.equal(readPrescriptionNotification.response.status, 200);
        assert.equal(readPrescriptionNotification.data.notification.read, true);
        assert.ok(await Prescription.exists({ _id: storedPrescription._id }));

        const ownCancellation = await request('/api/appointments/create', { method: 'POST', token: patientToken, body: { ...createBody, scheduledAt: available[2].scheduledAt } });
        assert.equal(ownCancellation.response.status, 201);
        assert.equal((await request(`/api/appointments/${ownCancellation.data.appointment.id}`, { method: 'DELETE', token: patientToken, body: { reason: 'No longer needed' } })).response.status, 200);

        const otherSlots = await request(`/api/appointments/slots/${otherDoctor._id}?date=${date}&service=Consultation`);
        const adminCancellation = await request('/api/appointments/create', { method: 'POST', token: patientToken, body: { doctorId: otherDoctor._id.toString(), service: 'Consultation', scheduledAt: otherSlots.data.slots.find((slot) => slot.available).scheduledAt } });
        assert.equal(adminCancellation.response.status, 201);
        assert.equal((await request(`/api/admin/appointments/${adminCancellation.data.appointment.id}`, { method: 'DELETE', token: adminLogin.data.token, body: { reason: 'Administrative change' } })).response.status, 200);

        const past = new Date(Date.now() - 3600000).toISOString();
        assert.equal((await request('/api/appointments/create', { method: 'POST', token: patientToken, body: { ...createBody, scheduledAt: past } })).response.status, 400);

        const notifications = await request('/api/notifications', { token: patientToken });
        assert.equal(notifications.response.status, 200);
        assert.ok(notifications.data.notifications.length > 0);
        const stats = await request('/api/admin/stats', { token: adminLogin.data.token });
        assert.equal(stats.response.status, 200);
        assert.equal(typeof stats.data.cancelledAppointments, 'number');
        const audit = await request('/api/admin/audit-logs?action=appointment.cancel', { token: adminLogin.data.token });
        assert.equal(audit.response.status, 200);
        assert.ok(audit.data.logs.length > 0);

        const googleFailure = await request('/api/auth/google', { method: 'POST', body: { credential: 'invalid-token' } });
        assert.ok([401, 503].includes(googleFailure.response.status));
    } finally {
        const ids = userIds.map((id) => new mongoose.Types.ObjectId(String(id)));
        await Appointment.deleteMany({ patientId: { $in: ids } });
        await Notification.deleteMany({ userId: { $in: ids } });
        await Prescription.deleteMany({ patientId: { $in: ids } });
        await AuditLog.deleteMany({ userId: { $in: ids } });
        await Doctor.deleteMany({ _id: { $in: doctorIds } });
        await User.deleteMany({ _id: { $in: ids } });
        await mongoose.disconnect();
    }
});
