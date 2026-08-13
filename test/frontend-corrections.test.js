const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainHtml = fs.readFileSync(path.join(root, 'bluecare', 'index.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'public', 'admin-login.html'), 'utf8');
const cleanupScript = fs.readFileSync(path.join(root, 'src', 'scripts', 'cleanupDevelopmentUsers.js'), 'utf8');
const resetPasswordScript = fs.readFileSync(path.join(root, 'src', 'scripts', 'resetUserPasswords.js'), 'utf8');
const adminRoute = fs.readFileSync(path.join(root, 'src', 'routes', 'admin.js'), 'utf8');
const doctorRoute = fs.readFileSync(path.join(root, 'src', 'routes', 'doctor.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('public authentication is role-free and uses one semantic email/password form', () => {
    assert.doesNotMatch(mainHtml, /class="[^"]*role-tabs/);
    assert.doesNotMatch(mainHtml, /setRole\(/);
    assert.match(mainHtml, /<form id="login-form">/);
    assert.match(mainHtml, /id="loginSubmitButton" type="submit"/);
    assert.match(mainHtml, /login-form'\)\?\.addEventListener\('submit'/);
    assert.doesNotMatch(mainHtml, /googleLoginButton|googleRegisterButton|accounts\.google\.com|\/api\/auth\/google/);
    assert.match(mainHtml, /Nuk ke llogari\?[\s\S]*?Regjistrohu/);
    assert.match(mainHtml, /Ke llogari\?[\s\S]*?Kyçu/);
});

test('patient navigation computes active state and keeps the symptom checker route', () => {
    assert.match(mainHtml, /class="nav-link \$\{subview==='symptoms'\?'active':''\}"[\s\S]*?Symptoma/);
    assert.match(mainHtml, /allowedSections[\s\S]*?patient: new Set\(\['dashboard', 'symptoms', 'schedule', 'messages', 'prescriptions', 'history'\]\)/);
    assert.match(mainHtml, /\/api\/ai\/analyze-symptoms/);
    assert.doesNotMatch(mainHtml, /\/api\/ai\/chat|chat-btn|chat-box/);
});

test('local doctor appointments show approve only for pending status', () => {
    const doctorRenderer = mainHtml.slice(mainHtml.indexOf("const approveBtn = id && String(a.status || '').toLowerCase() === 'pending'"), mainHtml.indexOf('async function loadAdminAppointments'));
    assert.match(doctorRenderer, /js-doctor-approve[\s\S]*?: '';/);
});

test('booking UI keeps the backend ISO instant and exposes count and occupied help', () => {
    assert.match(mainHtml, /id="bookScheduledAt"/);
    assert.match(mainHtml, /id="bookSlotCount"/);
    assert.match(mainHtml, /Nuk ka termine të lira për këtë datë\./);
    assert.match(mainHtml, /Ky termin është i rezervuar/);
    assert.match(mainHtml, /I zënë/);
});

test('admin authentication has a separate password-only page', () => {
    assert.match(adminHtml, /<title>SHËNDETI IM \| Administrim<\/title>/);
    assert.match(adminHtml, /fetch\('\/api\/auth\/admin-login'/);
    assert.match(adminHtml, /type="email"/);
    assert.match(adminHtml, /type="password"/);
    assert.doesNotMatch(adminHtml, /Regjistrohu|Vazhdo me Google/);
});

test('admin doctors view loads every protected API page instead of reusing the public doctor list', () => {
    assert.match(mainHtml, /fetchAndDisplayAdminDoctors\(\)/);
    assert.match(mainHtml, /\/api\/admin\/doctors\?page=\$\{page\}&limit=100/);
    assert.match(mainHtml, /id="adminDoctorsBody"/);
    assert.match(mainHtml, /Nuk ka doktorë të regjistruar\./);
    assert.match(mainHtml, /Aktivizo/);
    assert.match(mainHtml, /Çaktivizo/);
});

test('admin users view loads all pages and deduplicates only by stable User id', () => {
    assert.match(mainHtml, /\/api\/admin\/users\?page=\$\{page\}&limit=100/);
    assert.match(mainHtml, /new Map\(usersList\.map\(\(u\) => \[String\(u\.id \|\| u\._id\), u\]\)\)/);
});

test('local Super Administrator is immutable while patient and doctor edits remain available', () => {
    const modal = mainHtml.slice(mainHtml.indexOf('id="editUserModal"'), mainHtml.indexOf('id="passwordResetModal"'));
    assert.deepEqual([...modal.matchAll(/<option value="([^"]+)">/g)].map((match) => match[1]), ['patient', 'doctor']);
    assert.match(mainHtml, /const protectedAdmin = u\.role === 'admin'/);
    assert.match(mainHtml, /Super Administratori nuk modifikohet/);
    assert.match(mainHtml, /source\.role === 'admin' \|\| trustedTarget\?\.role === 'admin'/);
    assert.match(mainHtml, /target\?\.role === 'admin'/);
    assert.match(adminRoute, /existingUser\.role === 'admin'[^\n]+status\(403\)/);
    assert.match(adminRoute, /!\['patient', 'doctor'\]\.includes\(String\(role\)\)/);
    assert.equal((adminRoute.match(/user\.role === 'admin'[^\n]+status\(403\)/g) || []).length, 2);
});

test('admin users view exposes a minimal protected password reset action', () => {
    assert.match(mainHtml, /id="passwordResetModal"/);
    assert.match(mainHtml, /openPasswordResetModal\('\$\{id\}'\)[\s\S]*?Fjalëkalimi/);
    assert.match(mainHtml, /\/api\/admin\/users\/\$\{encodeURIComponent\(userId\)\}\/password/);
    assert.match(mainHtml, /body: JSON\.stringify\(\{ newPassword \}\)/);
    assert.match(mainHtml, /Fjalëkalimi u ndryshua me sukses\./);
    assert.doesNotMatch(mainHtml, /passwordHash/);
});

test('user password reset command is dry-run by default and narrowly scoped', () => {
    assert.equal(packageJson.scripts['reset:user-passwords'], 'node src/scripts/resetUserPasswords.js');
    assert.match(resetPasswordScript, /const APPLY = process\.argv\.includes\('--apply'\)/);
    assert.match(resetPasswordScript, /const TEST_EMAIL_RE = \/@shendeti-im\\\.test\$\//);
    assert.match(resetPasswordScript, /--include-admin/);
    assert.match(resetPasswordScript, /--allow-google-only/);
    assert.match(resetPasswordScript, /process\.env\.RESET_USER_PASSWORD/);
    assert.match(resetPasswordScript, /\{ timestamps: false \}/);
    assert.doesNotMatch(resetPasswordScript, /console\.log\(\s*(password|passwordHash)\b|console\.log\([^\n]*\$\{password(Hash)?\}/i);
});

test('admin password endpoint accepts only a new password and never returns its hash', () => {
    assert.match(adminRoute, /router\.patch\('\/users\/:id\/password'/);
    assert.match(adminRoute, /fields\.length !== 1 \|\| fields\[0\] !== 'newPassword'/);
    assert.match(adminRoute, /bcrypt\.hash\(newPassword, 12\)/);
    assert.match(adminRoute, /admin\.user_password_reset/);
    assert.doesNotMatch(adminRoute, /res\.json\([^\n]*passwordHash/);
});

test('doctor appointment actions reuse the existing toast and prevent duplicate requests', () => {
    assert.match(mainHtml, /showToast\('success', 'Termini u aprovua me sukses\.', \{ ttlMs: 3600 \}\)/);
    assert.match(mainHtml, /showToast\('success', 'Termini u anulua me sukses\.', \{ ttlMs: 3600 \}\)/);
    assert.match(mainHtml, /Nuk u arrit të përditësohet termini\. Provo përsëri\./);
    assert.match(mainHtml, /const doctorAppointmentActionsInFlight = new Set\(\)/);
    assert.match(mainHtml, /doctorAppointmentActionsInFlight\.has\(actionKey\)/);
    assert.match(mainHtml, /actionButton\.disabled = true/);
    assert.match(mainHtml, /if \(!succeeded && actionButton\?\.isConnected\)/);
    assert.match(mainHtml, /String\(a\.status \|\| ''\)\.toLowerCase\(\) === 'pending'/);
    assert.match(mainHtml, /data-doctor-appointment-id=/);
});

test('patient navigation replaces Analizat with real medical history', () => {
    assert.doesNotMatch(mainHtml, /refreshView\('patient', 'records'\)/);
    assert.doesNotMatch(mainHtml, />\s*Analizat\s*</);
    assert.match(mainHtml, /refreshView\('patient', 'history'\)[\s\S]*?Historia Mjekësore/);
    assert.match(mainHtml, /fetch\('\/api\/patient\/history'/);
    assert.match(mainHtml, /Vizitat e përfunduara dhe receptet e lidhura/);
});

test('prescription UI uses the existing APIs, safe states, toast, and print view', () => {
    assert.match(mainHtml, /const prescriptions = Array\.isArray\(data\.prescriptions\) \? data\.prescriptions : \[\]/);
    assert.match(mainHtml, /Nuk keni ende receta digjitale\./);
    assert.match(mainHtml, /\/api\/doctor\/prescriptions/);
    assert.match(mainHtml, /Recepti u krijua me sukses\./);
    assert.match(mainHtml, /Nuk u arrit të krijohet recepti\. Provo përsëri\./);
    assert.match(mainHtml, /prescriptionSubmissionInFlight/);
    assert.match(mainHtml, /<option value="\$\{escapeHtml\(patient\.id\)\}"/);
    assert.match(mainHtml, /<option value="\$\{escapeHtml\(appointment\.id\)\}"/);
    assert.match(mainHtml, /dedupeKey: 'prescription-submit-error'/);
    assert.match(mainHtml, /item\.dataset\.toastKey === dedupeKey/);
    assert.match(mainHtml, /appointment\.prescriptionEligible === true && appointment\.patient\?\.id/);
    assert.match(mainHtml, /Nuk ka pacientë me termin të aprovuar ose të përfunduar\./);
    assert.match(mainHtml, /toSqAppointmentStatus\(appointment\.status\)/);
    assert.match(mainHtml, /if \(matches\.length === 1\) appointmentSelect\.value/);
    assert.match(mainHtml, /completeDoctorAppointment/);
    assert.match(mainHtml, /Përfundo vizitën/);
    assert.match(mainHtml, /prescription\.unavailable/);
    assert.match(mainHtml, /Ky recept nuk mund të lexohet me çelësin aktual të enkriptimit/);
    assert.match(mainHtml, /body\.classList\.add\('print-prescription'\)/);
    assert.match(mainHtml, /SHËNDETI IM[\s\S]*?Recept Digjital/);
    assert.match(mainHtml, /Ky dokument është krijuar nga sistemi SHËNDETI IM/);
});

test('prescription validation uses the real User and Doctor profile references', () => {
    assert.match(doctorRoute, /isActive: \{ \$ne: false \}/);
    assert.match(doctorRoute, /Appointment\.findById\(appointmentId\)\.select\('_id patientId doctorId scheduledAt status'\)/);
    assert.match(doctorRoute, /String\(appointment\.patientId\) !== String\(patient\._id\)/);
    assert.match(doctorRoute, /String\(appointment\.doctorId\) !== String\(doctor\._id\)/);
    assert.match(doctorRoute, /!\['confirmed', 'completed'\]\.includes\(appointment\.status\)/);
    assert.match(doctorRoute, /Prescription validation identifiers\./);
});

test('development cleanup is dry-run by default and requires an explicit apply flag', () => {
    assert.equal(packageJson.scripts['cleanup:development-users'], 'node src/scripts/cleanupDevelopmentUsers.js');
    assert.match(cleanupScript, /const APPLY = process\.argv\.includes\('--apply'\)/);
    assert.match(cleanupScript, /Dry run complete\. No documents were modified or deleted\./);
    assert.match(cleanupScript, /BACKUP REQUIRED/);
    assert.match(cleanupScript, /Apply stopped because ambiguous duplicate conflicts require manual review/);
});
