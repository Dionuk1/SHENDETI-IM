require('dotenv').config();

const mongoose = require('mongoose');

const { connectDb } = require('../config/db');
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const Appointment = require('../models/Appointment');
const Prescription = require('../models/Prescription');
const MedicalRecord = require('../models/MedicalRecord');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');

const APPLY = process.argv.includes('--apply');
const DEVELOPMENT_DOMAIN_RE = /^([^@]+)@(healthflow\.test|shendeti\.test|shendeti-im\.test)$/i;
const OLD_DEVELOPMENT_DOMAIN_RE = /^([^@]+)@(healthflow\.test|shendeti\.test)$/i;

function normalizedEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function developmentTarget(value) {
    const email = normalizedEmail(value);
    const match = DEVELOPMENT_DOMAIN_RE.exec(email);
    return match ? `${match[1]}@shendeti-im.test` : null;
}

function normalizedName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sumCounts(counts) {
    return Object.values(counts).reduce((total, count) => total + Number(count || 0), 0);
}

async function userReferenceCounts(userId) {
    const id = String(userId);
    const [appointments, cancellations, prescriptionsAsPatient, prescriptionsAsDoctor, medicalRecords, notifications, auditLogs, auditResources, notificationResources] = await Promise.all([
        Appointment.countDocuments({ patientId: userId }),
        Appointment.countDocuments({ 'cancelledBy.userId': userId }),
        Prescription.countDocuments({ patientId: userId }),
        Prescription.countDocuments({ doctorId: userId }),
        MedicalRecord.countDocuments({ patientId: userId }),
        Notification.countDocuments({ userId }),
        AuditLog.countDocuments({ userId }),
        AuditLog.countDocuments({ resourceType: 'user', resourceId: id }),
        Notification.countDocuments({ resourceType: 'user', resourceId: id }),
    ]);
    return { appointments, cancellations, prescriptionsAsPatient, prescriptionsAsDoctor, medicalRecords, notifications, auditLogs, auditResources, notificationResources };
}

async function doctorReferenceCounts(doctorId) {
    return { appointments: await Appointment.countDocuments({ doctorId }) };
}

function userScore(member, targetEmail) {
    return sumCounts(member.references) * 1000
        + (member.hasGoogleId ? 100 : 0)
        + (member.hasPasswordHash ? 50 : 0)
        + (member.email === targetEmail ? 25 : 0)
        + (member.isActive !== false ? 10 : 0)
        + new Date(member.createdAt || 0).getTime() / 1e13;
}

function doctorScore(member, targetEmail) {
    return sumCounts(member.references) * 1000
        + member.serviceCount * 10
        + (member.bio ? 5 : 0)
        + (member.licenseNumber ? 5 : 0)
        + (member.isActive !== false ? 10 : 0)
        + (member.email === targetEmail ? 5 : 0);
}

function hasOverlappingActiveAppointments(members, appointments) {
    const memberIds = new Set(members.map((member) => member.id));
    const active = appointments
        .filter((appointment) => memberIds.has(String(appointment.doctorId)) && ['pending', 'confirmed'].includes(appointment.status))
        .map((appointment) => ({
            doctorId: String(appointment.doctorId),
            start: new Date(appointment.scheduledAt),
            end: new Date(new Date(appointment.scheduledAt).getTime() + Number(appointment.durationMinutes || 30) * 60000),
        }));
    for (let i = 0; i < active.length; i += 1) {
        for (let j = i + 1; j < active.length; j += 1) {
            if (active[i].doctorId !== active[j].doctorId && active[i].start < active[j].end && active[i].end > active[j].start) return true;
        }
    }
    return false;
}

async function inspectDatabase() {
    const [users, doctors, appointments] = await Promise.all([
        User.find({}).select('+passwordHash +googleId').lean(),
        Doctor.find({}).select('+passwordHash').lean(),
        Appointment.find({}).select('doctorId scheduledAt durationMinutes status').lean(),
    ]);
    const externalEmails = new Map(users.filter((user) => !developmentTarget(user.email)).map((user) => [String(user._id), user.email]));

    const userGroups = new Map();
    for (const user of users) {
        const targetEmail = developmentTarget(user.email);
        if (!targetEmail) continue;
        if (!userGroups.has(targetEmail)) userGroups.set(targetEmail, []);
        const references = await userReferenceCounts(user._id);
        userGroups.get(targetEmail).push({
            document: user,
            id: String(user._id),
            email: normalizedEmail(user.email),
            targetEmail,
            name: user.name,
            role: user.role,
            authProvider: user.authProvider,
            isActive: user.isActive,
            hasPasswordHash: Boolean(user.passwordHash),
            hasGoogleId: Boolean(user.googleId),
            googleId: user.googleId,
            createdAt: user.createdAt,
            references,
        });
    }

    const doctorGroups = new Map();
    for (const doctor of doctors) {
        const targetEmail = developmentTarget(doctor.email);
        if (!targetEmail) continue;
        if (!doctorGroups.has(targetEmail)) doctorGroups.set(targetEmail, []);
        const references = await doctorReferenceCounts(doctor._id);
        doctorGroups.get(targetEmail).push({
            document: doctor,
            id: String(doctor._id),
            email: normalizedEmail(doctor.email),
            targetEmail,
            name: doctor.name,
            specialization: doctor.specialization,
            isActive: doctor.isActive,
            serviceCount: Array.isArray(doctor.services) ? doctor.services.length : 0,
            bio: doctor.bio,
            licenseNumber: doctor.licenseNumber,
            createdAt: doctor.createdAt,
            references,
        });
    }

    const doctorPlans = [];
    for (const [targetEmail, members] of doctorGroups) {
        const exactIdentity = new Set(members.map((member) => `${normalizedName(member.name)}|${member.specialization}`)).size === 1;
        const scheduleConflict = hasOverlappingActiveAppointments(members, appointments);
        const confirmed = members.length === 1 || (exactIdentity && !scheduleConflict);
        const survivor = [...members].sort((a, b) => doctorScore(b, targetEmail) - doctorScore(a, targetEmail))[0];
        doctorPlans.push({ type: members.length > 1 ? 'merge' : 'normalize', targetEmail, members, survivor, confirmed, reasons: [!exactIdentity ? 'doctor identity/specialization differs' : null, scheduleConflict ? 'active appointment schedules overlap' : null].filter(Boolean) });
    }
    const doctorPlansByTarget = new Map(doctorPlans.map((plan) => [plan.targetEmail, plan]));

    const userPlans = [];
    for (const [targetEmail, members] of userGroups) {
        const sameRole = new Set(members.map((member) => member.role)).size === 1;
        const sameName = new Set(members.map((member) => normalizedName(member.name))).size === 1;
        const googleIds = new Set(members.map((member) => member.googleId).filter(Boolean).map(String));
        const doctorPlan = members[0]?.role === 'doctor' ? doctorPlansByTarget.get(targetEmail) : null;
        const doctorLinkSafe = members[0]?.role !== 'doctor' || Boolean(doctorPlan?.confirmed);
        const confirmed = members.length === 1 || (sameRole && sameName && googleIds.size <= 1 && doctorLinkSafe);
        const survivor = [...members].sort((a, b) => userScore(b, targetEmail) - userScore(a, targetEmail))[0];
        userPlans.push({ type: members.length > 1 ? 'merge' : 'normalize', targetEmail, members, survivor, confirmed, reasons: [!sameRole ? 'roles differ' : null, !sameName ? 'exact names differ' : null, googleIds.size > 1 ? 'Google IDs conflict' : null, !doctorLinkSafe ? 'doctor profile relationship is ambiguous' : null].filter(Boolean) });
    }

    const rawUserDoctorEmails = new Set(users.filter((user) => user.role === 'doctor').map((user) => normalizedEmail(user.email)));
    const rawDoctorEmails = new Set(doctors.map((doctor) => normalizedEmail(doctor.email)));
    const doctorUserWithoutProfile = [...rawUserDoctorEmails].filter((email) => !rawDoctorEmails.has(email));
    const doctorProfileWithoutUser = [...rawDoctorEmails].filter((email) => !rawUserDoctorEmails.has(email));
    const developmentAdmins = users.filter((user) => user.role === 'admin' && developmentTarget(user.email));
    const adminTargets = new Set(developmentAdmins.map((user) => developmentTarget(user.email)));
    const adminUnsafe = developmentAdmins.length > 0 && (adminTargets.size !== 1 || !adminTargets.has('admin@shendeti-im.test'));

    const ambiguous = [
        ...userPlans.filter((plan) => !plan.confirmed).map((plan) => ({ kind: 'user', targetEmail: plan.targetEmail, reasons: plan.reasons })),
        ...doctorPlans.filter((plan) => !plan.confirmed).map((plan) => ({ kind: 'doctor', targetEmail: plan.targetEmail, reasons: plan.reasons })),
    ];
    if (adminUnsafe) ambiguous.push({ kind: 'admin', targetEmail: 'admin@shendeti-im.test', reasons: ['development admin identities do not safely converge'] });

    return { users, doctors, externalEmails, userPlans, doctorPlans, ambiguous, doctorUserWithoutProfile, doctorProfileWithoutUser };
}

function safeMember(member) {
    return { id: member.id, email: member.email, role: member.role, name: member.name, references: member.references };
}

function printReport(inspection) {
    const confirmedUserDuplicates = inspection.userPlans.filter((plan) => plan.confirmed).reduce((total, plan) => total + Math.max(0, plan.members.length - 1), 0);
    const confirmedDoctorDuplicates = inspection.doctorPlans.filter((plan) => plan.confirmed).reduce((total, plan) => total + Math.max(0, plan.members.length - 1), 0);
    const emailsToNormalize = inspection.userPlans.flatMap((plan) => plan.members.filter((member) => member.email !== plan.targetEmail).map((member) => ({ id: member.id, from: member.email, to: plan.targetEmail })));
    const doctorEmailsToNormalize = inspection.doctorPlans.flatMap((plan) => plan.members.filter((member) => member.email !== plan.targetEmail).map((member) => ({ id: member.id, from: member.email, to: plan.targetEmail })));

    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);
    console.log(`Users inspected: ${inspection.users.length}`);
    console.log(`Doctor profiles inspected: ${inspection.doctors.length}`);
    console.log(`Development User emails to normalize: ${emailsToNormalize.length}`);
    for (const change of emailsToNormalize) console.log(`  USER ${change.id}: ${change.from} -> ${change.to}`);
    console.log(`Development Doctor profile emails to normalize: ${doctorEmailsToNormalize.length}`);
    for (const change of doctorEmailsToNormalize) console.log(`  DOCTOR ${change.id}: ${change.from} -> ${change.to}`);

    console.log(`Confirmed safe User duplicates: ${confirmedUserDuplicates}`);
    for (const plan of inspection.userPlans.filter((item) => item.members.length > 1)) {
        console.log(`  ${plan.confirmed ? 'CONFIRMED' : 'AMBIGUOUS'} USER ${plan.targetEmail}; survivor=${plan.survivor.id}`);
        for (const member of plan.members) console.log(`    ${JSON.stringify(safeMember(member))}`);
        if (plan.reasons.length) console.log(`    reasons=${plan.reasons.join('; ')}`);
    }

    console.log(`Confirmed safe Doctor profile duplicates: ${confirmedDoctorDuplicates}`);
    for (const plan of inspection.doctorPlans.filter((item) => item.members.length > 1)) {
        console.log(`  ${plan.confirmed ? 'CONFIRMED' : 'AMBIGUOUS'} DOCTOR ${plan.targetEmail}; survivor=${plan.survivor.id}`);
        for (const member of plan.members) console.log(`    ${JSON.stringify({ id: member.id, email: member.email, name: member.name, specialization: member.specialization, references: member.references })}`);
        if (plan.reasons.length) console.log(`    reasons=${plan.reasons.join('; ')}`);
    }

    console.log(`Ambiguous records requiring manual review: ${inspection.ambiguous.length}`);
    for (const item of inspection.ambiguous) console.log(`  ${item.kind} ${item.targetEmail}: ${item.reasons.join('; ')}`);
    console.log(`Doctor User accounts without matching raw-email profile: ${inspection.doctorUserWithoutProfile.length}`);
    for (const email of inspection.doctorUserWithoutProfile) console.log(`  USER-ONLY ${email}`);
    console.log(`Doctor profiles without matching raw-email User: ${inspection.doctorProfileWithoutUser.length}`);
    for (const email of inspection.doctorProfileWithoutUser) console.log(`  PROFILE-ONLY ${email}`);
    console.log(`Records that would be deleted: Users=${confirmedUserDuplicates}, Doctor profiles=${confirmedDoctorDuplicates}`);
}

async function migrateUserReferences(fromId, toId) {
    const from = String(fromId);
    const operations = await Promise.all([
        Appointment.updateMany({ patientId: fromId }, { $set: { patientId: toId } }),
        Appointment.updateMany({ 'cancelledBy.userId': fromId }, { $set: { 'cancelledBy.userId': toId } }),
        Prescription.updateMany({ patientId: fromId }, { $set: { patientId: toId } }),
        Prescription.updateMany({ doctorId: fromId }, { $set: { doctorId: toId } }),
        MedicalRecord.updateMany({ patientId: fromId }, { $set: { patientId: toId } }),
        Notification.updateMany({ userId: fromId }, { $set: { userId: toId } }),
        AuditLog.updateMany({ userId: fromId }, { $set: { userId: toId } }),
        AuditLog.updateMany({ resourceType: 'user', resourceId: from }, { $set: { resourceId: String(toId) } }),
        Notification.updateMany({ resourceType: 'user', resourceId: from }, { $set: { resourceId: String(toId) } }),
    ]);
    return operations.reduce((total, result) => total + Number(result.modifiedCount || 0), 0);
}

function missingDoctorFields(survivor, duplicates) {
    const update = {};
    const candidates = duplicates.map((member) => member.document);
    if ((!survivor.services || survivor.services.length === 0)) {
        const source = candidates.find((doctor) => Array.isArray(doctor.services) && doctor.services.length);
        if (source) update.services = source.services;
    }
    for (const field of ['bio', 'licenseNumber', 'department', 'availability']) {
        if (survivor[field] !== undefined && survivor[field] !== null && survivor[field] !== '') continue;
        const source = candidates.find((doctor) => doctor[field] !== undefined && doctor[field] !== null && doctor[field] !== '');
        if (source) update[field] = source[field];
    }
    return update;
}

async function applyDoctorPlan(plan, stats) {
    const survivorId = new mongoose.Types.ObjectId(plan.survivor.id);
    const duplicateMembers = plan.members.filter((member) => member.id !== plan.survivor.id);
    const survivor = await Doctor.findById(survivorId).select('+passwordHash').lean();
    const compatibleFields = missingDoctorFields(survivor, duplicateMembers);

    for (const duplicate of duplicateMembers) {
        const duplicateId = new mongoose.Types.ObjectId(duplicate.id);
        const appointments = await Appointment.find({ doctorId: duplicateId }).select('_id scheduledAt status').lean();
        for (const appointment of appointments) {
            const update = { $set: { doctorId: survivorId } };
            if (['pending', 'confirmed'].includes(appointment.status)) update.$set.activeSlotKey = `${survivorId}:${new Date(appointment.scheduledAt).toISOString()}`;
            else update.$unset = { activeSlotKey: 1 };
            await Appointment.updateOne({ _id: appointment._id }, update);
            stats.referencesMigrated += 1;
        }
        if (await Appointment.exists({ doctorId: duplicateId })) throw new Error(`Doctor reference verification failed for ${duplicate.id}`);
        await Doctor.deleteOne({ _id: duplicateId });
        stats.doctorsRemoved += 1;
        console.log(`  removed duplicate Doctor ${duplicate.id} (${duplicate.email})`);
    }

    await Doctor.updateOne({ _id: survivorId }, { $set: { ...compatibleFields, email: plan.targetEmail } });
    if (plan.survivor.email !== plan.targetEmail) stats.emailsNormalized += 1;
    console.log(`  Doctor survivor ${plan.survivor.id} -> ${plan.targetEmail}`);
}

async function applyUserPlan(plan, stats) {
    const survivorId = new mongoose.Types.ObjectId(plan.survivor.id);
    const duplicateMembers = plan.members.filter((member) => member.id !== plan.survivor.id);
    const survivor = await User.findById(survivorId).select('+passwordHash +googleId').lean();
    const update = { email: plan.targetEmail };

    if (!survivor.passwordHash) {
        const source = duplicateMembers.find((member) => member.document.passwordHash);
        if (source) update.passwordHash = source.document.passwordHash;
    }
    if (!survivor.googleId) {
        const source = duplicateMembers.find((member) => member.document.googleId);
        if (source) update.googleId = source.document.googleId;
    }
    if (!survivor.profileImage) {
        const source = duplicateMembers.find((member) => member.document.profileImage);
        if (source) update.profileImage = source.document.profileImage;
    }

    for (const duplicate of duplicateMembers) {
        const duplicateId = new mongoose.Types.ObjectId(duplicate.id);
        stats.referencesMigrated += await migrateUserReferences(duplicateId, survivorId);
        const remaining = await userReferenceCounts(duplicateId);
        if (sumCounts(remaining) !== 0) throw new Error(`User reference verification failed for ${duplicate.id}`);
        await User.deleteOne({ _id: duplicateId });
        stats.usersRemoved += 1;
        console.log(`  removed duplicate User ${duplicate.id} (${duplicate.email}, ${duplicate.role})`);
    }

    await User.updateOne({ _id: survivorId }, { $set: update });
    if (plan.survivor.email !== plan.targetEmail) stats.emailsNormalized += 1;
    console.log(`  User survivor ${plan.survivor.id} -> ${plan.targetEmail} (${plan.survivor.role})`);
}

async function verifyAfterApply(inspection) {
    const [users, doctors, appointments, prescriptions, medicalRecords, notifications, auditLogs] = await Promise.all([
        User.find({}).select('email role').lean(), Doctor.find({}).select('email').lean(), Appointment.find({}).select('patientId doctorId cancelledBy').lean(),
        Prescription.find({}).select('patientId doctorId').lean(), MedicalRecord.find({}).select('patientId').lean(), Notification.find({}).select('userId').lean(), AuditLog.find({}).select('userId').lean(),
    ]);
    const userIds = new Set(users.map((item) => String(item._id)));
    const doctorIds = new Set(doctors.map((item) => String(item._id)));
    const oldUserEmails = users.filter((user) => OLD_DEVELOPMENT_DOMAIN_RE.test(normalizedEmail(user.email)));
    const oldDoctorEmails = doctors.filter((doctor) => OLD_DEVELOPMENT_DOMAIN_RE.test(normalizedEmail(doctor.email)));
    const emailCounts = new Map();
    for (const user of users) emailCounts.set(normalizedEmail(user.email), (emailCounts.get(normalizedEmail(user.email)) || 0) + 1);
    const duplicateEmails = [...emailCounts].filter(([, count]) => count > 1);
    const externalChanged = users.filter((user) => inspection.externalEmails.has(String(user._id)) && inspection.externalEmails.get(String(user._id)) !== user.email);
    const orphanCounts = {
        appointmentPatients: appointments.filter((item) => !userIds.has(String(item.patientId))).length,
        appointmentDoctors: appointments.filter((item) => !doctorIds.has(String(item.doctorId))).length,
        appointmentCancellers: appointments.filter((item) => item.cancelledBy?.userId && !userIds.has(String(item.cancelledBy.userId))).length,
        prescriptionPatients: prescriptions.filter((item) => !userIds.has(String(item.patientId))).length,
        prescriptionDoctors: prescriptions.filter((item) => !userIds.has(String(item.doctorId))).length,
        medicalRecordPatients: medicalRecords.filter((item) => !userIds.has(String(item.patientId))).length,
        notificationUsers: notifications.filter((item) => !userIds.has(String(item.userId))).length,
        auditUsers: auditLogs.filter((item) => item.userId && !userIds.has(String(item.userId))).length,
    };
    const developmentAdmins = users.filter((user) => user.role === 'admin' && developmentTarget(user.email));
    if (oldUserEmails.length || oldDoctorEmails.length || duplicateEmails.length || externalChanged.length || developmentAdmins.length !== 1 || developmentAdmins[0].email !== 'admin@shendeti-im.test' || sumCounts(orphanCounts) !== 0) {
        throw new Error(`Post-migration verification failed: ${JSON.stringify({ oldUserEmails: oldUserEmails.length, oldDoctorEmails: oldDoctorEmails.length, duplicateEmails: duplicateEmails.length, externalChanged: externalChanged.length, developmentAdmins: developmentAdmins.length, orphanCounts })}`);
    }
    return { users: users.length, doctors: doctors.length, orphanCounts };
}

(async () => {
    if (APPLY && process.env.NODE_ENV === 'production') throw new Error('Refusing development cleanup while NODE_ENV=production.');
    await connectDb();
    const inspection = await inspectDatabase();
    printReport(inspection);

    if (!APPLY) {
        console.log('Dry run complete. No documents were modified or deleted.');
        return;
    }

    console.warn('BACKUP REQUIRED: create and verify a MongoDB backup before applying this migration.');
    if (inspection.ambiguous.length) throw new Error('Apply stopped because ambiguous duplicate conflicts require manual review.');

    const stats = { emailsNormalized: 0, usersRemoved: 0, doctorsRemoved: 0, referencesMigrated: 0 };
    for (const plan of inspection.doctorPlans) await applyDoctorPlan(plan, stats);
    for (const plan of inspection.userPlans) await applyUserPlan(plan, stats);
    const verified = await verifyAfterApply(inspection);

    console.log(`Apply complete: emailsNormalized=${stats.emailsNormalized}, usersRemoved=${stats.usersRemoved}, doctorsRemoved=${stats.doctorsRemoved}, referencesMigrated=${stats.referencesMigrated}`);
    console.log(`Counts after cleanup: Users=${verified.users}, Doctor profiles=${verified.doctors}`);
})()
    .catch((error) => {
        console.error(`Development cleanup stopped safely: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
