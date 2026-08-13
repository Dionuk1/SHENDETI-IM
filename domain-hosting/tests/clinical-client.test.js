const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function clientHarness() {
  const calls = [];
  const window = {
    location: { origin: 'https://dev.example.test' },
    ShendetiAuth: {
      async executePublicClinical(operation, payload) {
        calls.push({ operation, payload, public: true });
        return { status: 200, data: { ok: true, doctors: [] } };
      },
      async executeTriage(symptoms) {
        calls.push({ operation: 'analyzeSymptoms', payload: { symptoms } });
        return { status: 200, data: { source: 'rule_based', urgency: 'low', urgencyLevel: 'low', suggestedDepartment: 'Pulmonologji', confidence: 75, redFlags: [], nextSteps: ['demo'], recommendedAction: 'demo', disclaimer: 'demo', summary: 'demo' } };
      },
      async executeClinical(operation, payload) {
        calls.push({ operation, payload });
        return { status: 200, data: operation === 'getDoctorSchedule' ? { ok: true, schedule: { weekdayStart: '08:00', weekdayEnd: '16:00', sundayOff: true } } : { ok: true } };
      },
      async executeAdmin(operation, payload) {
        calls.push({ operation, payload });
        return { status: 200, data: { ok: true } };
      }
    }
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'clinical-client.js'), 'utf8');
  vm.runInNewContext(source, { window, URL, Response, JSON, Number, String, Object, Promise });
  return { client: window.ShendetiClinical, calls };
}

function htmlFunction(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function adminAppointmentHarness(fetchImpl) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const calls = { fetch: [], refresh: 0, stats: 0, toast: [] };
  const context = vm.createContext({
    confirm: () => true, prompt: () => '', hasClinicalSession: () => true,
    doctorAppointmentActionsInFlight: new Set(), appointments: [],
    fetch: async (...args) => { calls.fetch.push(args); return fetchImpl(...args); },
    fetchAndRenderAdminAppointments: async () => { calls.refresh += 1; },
    fetchAdminStats: () => { calls.stats += 1; },
    fetchAndRenderDoctorAppointments: async () => {}, fetchAndRenderPatientAppointments: async () => {},
    handleDoctorAppointmentAuthFailure: () => false, updateDoctorAppointmentRow: () => {},
    persistAppointmentsToStorage: () => {}, showToast: (...args) => calls.toast.push(args),
    encodeURIComponent, String, console: { error: () => {} }
  });
  vm.runInContext([
    htmlFunction(source, 'cancelAppointmentFromDashboard'),
    htmlFunction(source, 'adminSetAppointmentStatus'),
    htmlFunction(source, 'adminDeleteAppointmentDb')
  ].join('\n'), context);
  return { context, calls, source };
}

function adminUserEditHarness(currentRole, selectedRole) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const calls = { fetch: [], usersRefresh: 0, doctorsRefresh: 0, landingRefresh: 0, render: 0, close: 0, toast: [] };
  const elements = {
    editUserName: { value: 'Updated User' }, editUserRole: { value: selectedRole },
    editDoctorSpecialization: { value: 'Kardiologji' }, editDoctorDepartment: { value: 'Kardiologji' }, editDoctorExperience: { value: '6' },
    editWeekdayStart: { value: '08:00' }, editWeekdayEnd: { value: '16:00' }, editSaturdayStart: { value: '09:00' }, editSaturdayEnd: { value: '13:00' },
    editSundayOff: { checked: true }, editMaxPatients: { value: '20' }
  };
  const submit = { disabled: false, textContent: 'Ruaj Ndryshimet' };
  const users = [{ id:'user-1', name:'Original User', role:currentRole }];
  const context = vm.createContext({
    window: { editingUserId:'user-1', editingUserRole:currentRole }, users,
    document: { getElementById: (id) => elements[id], querySelector: () => submit },
    fetch: async (url, options) => {
      calls.fetch.push({ url, options, body: JSON.parse(options.body) });
      const role = url.endsWith('/role') ? selectedRole : currentRole;
      return { ok:true, status:200, json:async () => ({ user:{ id:'user-1', name:'Updated User', role } }) };
    },
    fetchAndDisplayUsers: async () => { calls.usersRefresh += 1; },
    fetchAndDisplayAdminDoctors: async () => { calls.doctorsRefresh += 1; },
    updateLandingDoctors: async () => { calls.landingRefresh += 1; },
    renderUsersTableFromLocal: () => { calls.render += 1; }, closeModal: () => { calls.close += 1; },
    showToast: (...args) => calls.toast.push(args), encodeURIComponent, String, Number, Object, Array, JSON, Promise
  });
  vm.runInContext(htmlFunction(source, 'saveUserEdit'), context);
  return { context, calls, elements, submit, users };
}

test('legacy slot route maps only expected values to getAvailableSlots', async () => {
  const { client, calls } = clientHarness();
  const response = await client.routeLegacy('/api/appointments/slots/doctor-1?date=2026-08-10&service=Konsultim');
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify({ operation: 'getAvailableSlots', payload: { doctorId: 'doctor-1', date: '2026-08-10', service: 'Konsultim' } }));
});

test('appointment creation strips spoofed role, patient id, status and activeSlotKey', async () => {
  const { client, calls } = clientHarness();
  await client.routeLegacy('/api/appointments/create', {
    method: 'POST', body: JSON.stringify({ doctorId: 'doctor-1', service: 'Konsultim', scheduledAt: '2026-08-10T08:00:00.000Z', role: 'admin', patientAuthUserId: 'spoof', status: 'completed', activeSlotKey: 'spoof' })
  });
  assert.equal(JSON.stringify(calls[0]), JSON.stringify({ operation: 'createAppointment', payload: { doctorId: 'doctor-1', service: 'Konsultim', scheduledAt: '2026-08-10T08:00:00.000Z' } }));
});

test('doctor schedule adapter maps only permitted schedule fields', async () => {
  const { client, calls } = clientHarness();
  await client.routeLegacy('/api/doctors/schedule', { method: 'PATCH', body: JSON.stringify({ day: 'mondayFriday', start: '08:00', end: '16:00', authUserId: 'spoof' }) });
  assert.equal(JSON.stringify(calls[0]), JSON.stringify({ operation: 'updateDoctorSchedule', payload: { weekdayStart: '08:00', weekdayEnd: '16:00' } }));
});

test('out-of-scope API routes are not mapped', async () => {
  const { client, calls } = clientHarness();
  assert.equal(await client.routeLegacy('/api/ai/analyze-symptoms', { method: 'POST', body: '{}' }), null);
  assert.equal(calls.length, 0);
});

test('admin adapter maps only explicit read and status operations', async () => {
  const { client, calls } = clientHarness();
  await client.routeLegacy('/api/admin/users?page=2&limit=20&role=doctor&isActive=true');
  await client.routeLegacy('/api/admin/doctors/doctor-1', { method: 'PATCH', body: JSON.stringify({ isActive: false, role: 'admin', secret: 'spoof' }) });
  await client.routeLegacy('/api/admin/appointments?status=confirmed&doctorId=doctor-1');
  await client.routeLegacy('/api/admin/appointments/appointment-1', { method:'PATCH', body:JSON.stringify({ status:'completed', role:'patient' }) });
  await client.routeLegacy('/api/admin/appointments/appointment-2', { method:'DELETE', body:JSON.stringify({ reason:'Synthetic', status:'completed' }) });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { operation: 'listUsers', payload: { page: 2, limit: 20, role: 'doctor', isActive: true } },
    { operation: 'setDoctorActive', payload: { doctorId: 'doctor-1', isActive: false } },
    { operation: 'listAppointments', payload: { page: 1, limit: 25, status: 'confirmed', doctorId: 'doctor-1' } },
    { operation: 'approveAppointment', payload: { appointmentId:'appointment-1' } },
    { operation: 'cancelAppointment', payload: { appointmentId:'appointment-2', reason:'Synthetic' } }
  ]);
});

test('admin appointment table restores only eligible actions with row-level loading guards', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const view = source.slice(source.indexOf("else if(subview === 'app')"), source.indexOf("else if(subview === 'docs')"));
  const renderer = source.slice(source.indexOf('async function adminSetAppointmentStatus'), source.indexOf('async function fetchAdminStats'));
  assert.match(view, /<th>Veprim<\/th>/);
  assert.match(renderer, /normalizedStatus === 'pending'[\s\S]*>Aprovo<\/button>/);
  assert.match(renderer, /\['pending', 'confirmed'\]\.includes\(normalizedStatus\)[\s\S]*>Anulo terminin<\/button>/);
  assert.match(renderer, /doctorAppointmentActionsInFlight\.has\(actionKey\)/);
  assert.match(renderer, /actionButton\.disabled = true/);
  assert.match(renderer, /if \(!succeeded && actionButton\?\.isConnected\)/);
  assert.doesNotMatch(renderer, /deleteApp\(|appointments = appointments\.filter/);
});

test('admin approve and cancel handlers execute with Appwrite session auth and send exactly one request', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const harness = adminAppointmentHarness(async () => { await pending; return { ok: true, status: 200, json: async () => ({ appointment: { status: 'confirmed' } }) }; });
  const approveButton = { textContent: 'Aprovo', disabled: false, isConnected: true };
  const first = harness.context.adminSetAppointmentStatus('appointment-1', 'confirmed', approveButton);
  const duplicate = harness.context.adminSetAppointmentStatus('appointment-1', 'confirmed', approveButton);
  assert.equal(approveButton.disabled, true);
  assert.equal(harness.calls.fetch.length, 1);
  release(); await Promise.all([first, duplicate]);
  assert.equal(harness.calls.refresh, 1);
  assert.equal(harness.calls.fetch[0][1].headers.Authorization, undefined);

  const cancelHarness = adminAppointmentHarness(async () => ({ ok: true, status: 200, json: async () => ({ appointment: { status: 'cancelled' } }) }));
  const cancelButton = { textContent: 'Anulo terminin', disabled: false, isConnected: true };
  await cancelHarness.context.adminDeleteAppointmentDb('appointment-2', cancelButton);
  assert.equal(cancelHarness.calls.fetch.length, 1);
  assert.equal(cancelHarness.calls.fetch[0][1].method, 'DELETE');
  assert.equal(cancelHarness.calls.fetch[0][1].headers.Authorization, undefined);
  assert.equal(cancelHarness.calls.refresh, 1);
  const handlers = [htmlFunction(cancelHarness.source, 'adminSetAppointmentStatus'), htmlFunction(cancelHarness.source, 'cancelAppointmentFromDashboard')].join('\n');
  assert.doesNotMatch(handlers, /\btoken\b/);
});

test('failed admin appointment actions restore controls and never expose raw JavaScript errors', async () => {
  const harness = adminAppointmentHarness(async () => ({ ok: false, status: 500, json: async () => ({ error: 'token is not defined' }) }));
  const approveButton = { textContent: 'Aprovo', disabled: false, isConnected: true };
  await harness.context.adminSetAppointmentStatus('appointment-1', 'confirmed', approveButton);
  assert.deepEqual({ text: approveButton.textContent, disabled: approveButton.disabled }, { text: 'Aprovo', disabled: false });
  const cancelButton = { textContent: 'Anulo terminin', disabled: false, isConnected: true };
  await harness.context.adminDeleteAppointmentDb('appointment-2', cancelButton);
  assert.deepEqual({ text: cancelButton.textContent, disabled: cancelButton.disabled }, { text: 'Anulo terminin', disabled: false });
  assert.equal(harness.calls.toast.some((entry) => JSON.stringify(entry).includes('token is not defined')), false);
});

test('admin adapter maps approved creation, edit, password update and confirmed deletion', async () => {
  const { client, calls } = clientHarness();
  await client.routeLegacy('/api/admin/users', { method: 'POST', body: JSON.stringify({ name:'Synthetic', email:'synthetic@example.test', password:'Strong!Pass123', role:'patient', authUserId:'spoof' }) });
  await client.routeLegacy('/api/admin/users/user-1', { method: 'PATCH', body: JSON.stringify({ name:'Updated', role:'admin', email:'spoof@example.test', authUserId:'spoof' }) });
  await client.routeLegacy('/api/admin/users/user-1/password', { method: 'PATCH', body: JSON.stringify({ newPassword:'Strong!Pass456', confirmPassword:'Strong!Pass456', role:'admin' }) });
  await client.routeLegacy('/api/admin/users/user-1', { method: 'DELETE', body: JSON.stringify({ confirmed:true, role:'admin' }) });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { operation:'createUser', payload:{ name:'Synthetic', email:'synthetic@example.test', password:'Strong!Pass123', role:'patient' } },
    { operation:'updateUser', payload:{ userId:'user-1', name:'Updated' } },
    { operation:'updateUserPassword', payload:{ userId:'user-1', newPassword:'Strong!Pass456', confirmPassword:'Strong!Pass456' } },
    { operation:'deleteUser', payload:{ userId:'user-1', confirmed:true } }
  ]);
});

test('single Save action persists patient-doctor role changes and synchronizes cached UI state', async () => {
  const promoted = adminUserEditHarness('patient', 'doctor');
  await promoted.context.saveUserEdit();
  assert.equal(promoted.calls.fetch.length, 2);
  assert.equal(promoted.calls.fetch[0].url, '/api/admin/users/user-1');
  assert.equal(promoted.calls.fetch[1].url, '/api/admin/users/user-1/role');
  assert.deepEqual(promoted.calls.fetch[1].body, { newRole:'doctor', confirmed:true, specialization:'Kardiologji', department:'Kardiologji', experienceYears:6 });
  assert.equal(promoted.users[0].role, 'doctor');
  assert.equal(promoted.context.window.editingUserRole, 'doctor');
  assert.equal(promoted.elements.editUserRole.value, 'doctor');
  assert.deepEqual([promoted.calls.render, promoted.calls.usersRefresh, promoted.calls.doctorsRefresh, promoted.calls.landingRefresh, promoted.calls.close], [1, 1, 1, 1, 1]);

  const demoted = adminUserEditHarness('doctor', 'patient');
  await demoted.context.saveUserEdit();
  assert.equal(demoted.calls.fetch.length, 2);
  assert.equal(demoted.calls.fetch[1].url, '/api/admin/users/user-1/role');
  assert.deepEqual(demoted.calls.fetch[1].body, { newRole:'patient', confirmed:true });
  assert.equal(demoted.users[0].role, 'patient');
  assert.equal(demoted.context.window.editingUserRole, 'patient');

  const unchanged = adminUserEditHarness('patient', 'patient');
  await unchanged.context.saveUserEdit();
  assert.equal(unchanged.calls.fetch.length, 1);
  assert.equal(unchanged.calls.fetch[0].url, '/api/admin/users/user-1');
  assert.equal(unchanged.users[0].role, 'patient');

  const tampered = adminUserEditHarness('patient', 'admin');
  await tampered.context.saveUserEdit();
  assert.equal(tampered.calls.fetch.length, 0);
  assert.equal(tampered.users[0].role, 'patient');
});

test('admin DEV password UX applies the simple rule to patient and doctor targets only', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const modal = source.slice(source.indexOf('id="passwordResetModal"'), source.indexOf('id="app-shell"'));
  const handler = source.slice(source.indexOf('function clearPasswordResetFields'), source.indexOf('async function saveUserEdit'));
  assert.match(modal, /Minimum 8 karaktere, se paku nje shkronje dhe nje numer/);
  assert.match(modal, /Ky rregull me i thjeshte perdoret vetem nga admini ne ambientin DEV/);
  assert.doesNotMatch(modal, /synthetic|test-user|devTestPasswordConfirmed/);
  assert.match(handler, /\['patient', 'doctor'\]\.includes\(window\.passwordResetUserRole\)/);
  assert.match(handler, /JSON\.stringify\(\{ newPassword, confirmPassword: confirmation \}\)/);
  assert.doesNotMatch(source.slice(source.indexOf('async function auth()'), source.indexOf('function switchAuthTab')), /devTestMode|devTestConfirmed/);
  assert.doesNotMatch(source.slice(source.indexOf('async function registerUser()'), source.indexOf('function addLog')), /devTestMode|devTestConfirmed/);
});

test('admin create-user keeps its visible strong guidance while silently accepting the DEV admin rule', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const opener = source.slice(source.indexOf('function openAdminAdd'), source.indexOf('function toggleAdminDoctorCreateFields'));
  const submit = source.slice(source.indexOf('async function executeAdminAdd'), source.indexOf('function escapeHtml'));
  assert.match(opener, /Fjalëkalimi i përkohshëm/);
  assert.match(opener, /placeholder="12\+ karaktere, shkronja, numër dhe simbol"/);
  assert.doesNotMatch(opener, /Minimum 8|DEV password|thjeshte|synthetic/i);
  assert.match(submit, /password\.length < 8/);
  assert.match(submit, /!\/\[A-Za-z\]\/\.test\(password\)/);
  assert.match(submit, /!\/\[0-9\]\/\.test\(password\)/);
});

test('admin user UI exposes compact confirmed deletion after password replacement', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(source, /Shto User<\/button>/);
  assert.match(source, /onclick="openEditUserModal/);
  assert.match(source, /Çaktivizo/);
  assert.match(source, /Aktivizo/);
  assert.match(source, /onclick="openPasswordResetModal/);
  assert.match(source, /Fjalekalimi u ndryshua me sukses\. Perdoruesi duhet te kyqet perseri\./);
  assert.match(source, /id="editUserRole"[^>]*onchange="syncAdminRoleChangeFields\(\)"/);
  assert.match(source, /emailInput\.readOnly = true/);
  assert.match(source, /openPasswordResetModal[^`]+Fjalëkalimi<\/button> <button class="btn btn-danger" onclick="openDeleteUserModal[^`]+Fshi<\/button>/);
  assert.match(source, /id="deleteUserModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(source, /if \(deleteUserInFlight\) return/);
  assert.match(source, /JSON\.stringify\(\{ confirmed: true \}\)/);
  assert.match(source, /Useri u fshi me sukses\./);
  assert.match(source, /Promise\.all\(\[fetchAndDisplayUsers\(\), fetchAdminStats\(\)\]\)/);
});

test('landing specialists use fresh Appwrite data and canonical booking flow', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const loaderStart = source.indexOf('async function updateLandingDoctors');
  const loader = source.slice(loaderStart, loaderStart + 7000);
  const opener = source.slice(source.indexOf('async function openLandingDoctorBooking'), source.indexOf('async function updateLandingDoctors'));
  assert.match(loader, /fetch\('\/api\/public\/doctors'/);
  assert.doesNotMatch(loader, /Duhet të kyçeni për të parë specialistët/);
  assert.doesNotMatch(loader, /const specs\s*=/);
  assert.doesNotMatch(loader, /waitTime|queueStatus/);
  assert.match(opener, /role !== 'patient'/);
  assert.match(opener, /onBookingDoctorChange\(false\)/);
  assert.match(opener, /loadBookingSlots\(\)/);
  assert.match(source, /window\.addEventListener\('focus'/);
  assert.match(source, /status === 'authenticated'[\s\S]*updateLandingDoctors\(true\)/);
});

test('public specialist route uses only the anonymous-safe clinical operation', async () => {
  const { client, calls } = clientHarness();
  const response = await client.routeLegacy('/api/public/doctors');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ operation: 'listPublicDoctors', payload: {}, public: true }]);
});

test('doctor patient history renders the normalized completed-visit contract with explicit fallbacks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const history = source.slice(source.indexOf('function openDoctorPatientHistoryModal'), source.indexOf('async function fetchAndRenderDoctorPatients'));
  assert.match(history, /h\?\.visitDate \|\| h\?\.scheduledAt \|\| h\?\.date/);
  assert.match(history, /\.sort\(\(a, b\) =>/);
  assert.match(history, /Ky pacient nuk ka ende histori mjekesore te regjistruar\./);
  assert.match(history, /Vizita është përfunduar; detajet klinike nuk janë regjistruar ende\./);
  assert.match(history, /Nuk janë regjistruar për këtë vizitë\./);
  assert.match(history, /Nuk është regjistruar për këtë vizitë\./);
  assert.doesNotMatch(history, /const when = h\?\.date/);
});

test('edit modal has one patient-doctor role control wired to Save plus complete close behavior', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const modal = source.slice(source.indexOf('id="editUserModal"'), source.indexOf('id="passwordResetModal"'));
  assert.equal((modal.match(/<select\b/g) || []).length, 1);
  assert.match(modal, /id="editUserRole"[^>]*onchange="syncAdminRoleChangeFields\(\)"/);
  assert.match(modal, /<option value="patient">Pacient<\/option>[\s\S]*<option value="doctor">Doktor<\/option>/);
  assert.doesNotMatch(modal, /value="admin"|editUserNewRole|adminRoleFields|changeUserRoleButton|Roli i ri|Ndrysho rolin|Roli aktual shfaqet|Ndryshimi kërkon/);
  assert.match(source, /id="editUserModal"[^>]*data-backdrop-close="true"/);
  assert.match(source, /class="modal-dialog-body" tabindex="0"/);
  assert.match(source, /class="modal-dialog-actions"/);
  assert.match(source, /onclick="closeModal\('editUserModal'\)"[^>]*>Anulo/);
  assert.match(source, /event\.key !== 'Escape'/);
  assert.match(source, /if \(event\.target === modal\) closeModal\(modal\.id\)/);
  assert.match(source, /document\.body\.classList\.toggle\('modal-open'/);
  assert.match(source, /const newRole = document\.getElementById\('editUserRole'\)\.value/);
  assert.match(source, /newRole !== currentRole \? \{ newRole, confirmed:true \} : null/);
  assert.match(source, /\/api\/admin\/users\/\$\{encodeURIComponent\(userId\)\}\/role/);
  assert.match(source, /users\[userIndex\][^;]+role:newRole/);
  assert.match(source, /closeModal\('editUserModal'\);[\s\S]*fetchAndDisplayUsers/);
});

test('ordinary anonymous or expired refresh never opens the login modal automatically', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const handler = source.slice(source.indexOf('function handleAuthStateChanged'), source.indexOf("window.addEventListener('shendeti:auth-changed'"));
  assert.match(handler, /if \(!loginIntentActive\) closeModal\('loginModal'\)/);
  assert.doesNotMatch(handler, /openModal\('loginModal'\)|getElementById\('loginModal'\)[\s\S]*classList\.remove\('hidden'\)/);
  const booking = source.slice(source.indexOf('function showLandingBookingLoginRequired'), source.indexOf('async function openLandingDoctorBooking'));
  assert.match(booking, /Për të rezervuar termin me këtë doktor, ju lutem kyçuni/);
  assert.match(booking, /requirePatientAuthenticationForBooking\(\{ flow: 'main', doctorId/);
});

test('post-login booking intent restores only the exact revalidated doctor through Phase 6B', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const cards = source.slice(source.indexOf('function renderLandingDoctorsGrid'), source.indexOf('function setLandingDoctorsShowAll'));
  const pending = source.slice(source.indexOf('const PENDING_BOOKING_KEY'), source.indexOf('function onBookingDoctorChange'));
  const logout = source.slice(source.indexOf('async function logout()'), source.indexOf('function getCurrentUserId'));

  assert.match(cards, /onclick="openLandingDoctorBooking\(\$\{index\}\)"/);
  assert.doesNotMatch(cards, /onclick="showLandingBookingLoginRequired\(\)"/);
  assert.match(source, /showLandingBookingLoginRequired\(doctorId\)/);
  assert.match(pending, /shendeti-im:pending-booking:v1/);
  assert.match(pending, /sessionStorage\.setItem/);
  assert.doesNotMatch(pending, /localStorage|password|token|patientId|doctorName|scheduledAt/);
  assert.match(pending, /version: 1[\s\S]*action: 'book-doctor'[\s\S]*doctorId[\s\S]*service[\s\S]*date[\s\S]*time[\s\S]*durationMinutes[\s\S]*returnDestination[\s\S]*createdAt/);
  assert.match(pending, /\^\[A-Za-z0-9\._-\]\{1,80\}\$/);
  assert.match(pending, /PENDING_BOOKING_MAX_AGE_MS = 30 \* 60 \* 1000/);
  assert.match(pending, /role[^\n]*!== 'patient'[\s\S]*clearPendingBooking/);
  assert.match(pending, /await updateLandingDoctors\(true\)/);
  assert.match(pending, /doctors\.find\([\s\S]*state\.doctorId/);
  assert.match(pending, /doc\.value = state\.doctorId[\s\S]*onBookingDoctorChange\(false\)/);
  assert.match(pending, /bookModal[^\n]*classList\.remove\('hidden'\)[\s\S]*await loadBookingSlots\(state\.time\)/);
  assert.match(pending, /pendingBookingResumePromise/);
  assert.match(logout, /clearPendingBooking\(\)/);
  assert.match(source, /id === 'loginModal'[\s\S]*clearPendingBooking\(\)/);
});

test('shared patient and doctor login stays open across anonymous session restoration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const loginModal = source.slice(source.indexOf('id="loginModal"'), source.indexOf('id="bookModal"'));
  assert.doesNotMatch(loginModal, /patientLoginOption|doctorLoginOption|selectLoginRole|Lloji i hyrjes/);
  assert.equal((loginModal.match(/id="loginEmail"/g) || []).length, 1);
  assert.equal((loginModal.match(/id="loginPass"/g) || []).length, 1);
  assert.equal((loginModal.match(/id="loginSubmitButton"/g) || []).length, 1);
  assert.match(loginModal, /id="loginSubmitButton"[^>]*type="submit"[^>]*>Kyçu<\/button>/);
  assert.match(loginModal, /Regjistrohu/);
  assert.match(loginModal, />Anulo<\/button>/);
  assert.match(source, /ShendetiAuth\.login\(email, pass, 'main'\)/);
  assert.doesNotMatch(source, /selectedLoginRole|selectLoginRole/);
  assert.match(source, /if \(id === 'loginModal'\) loginIntentActive = true/);
  assert.match(source, /if \(!loginIntentActive\) closeModal\('loginModal'\)/);
  assert.match(source, /event\.target === modal/);
});

test('booking availability is blocked until patient authentication and stale failures are ignored', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const loader = source.slice(source.indexOf('async function loadBookingSlots'), source.indexOf('function selectBookingSlot'));
  assert.match(loader, /status !== 'authenticated'[\s\S]*role !== 'patient'/);
  assert.match(loader, /renderBookingLoginRequired\(\)[\s\S]*loginRequired: true/);
  assert.match(loader, /if \(requestId !== bookingSlotsRequestId\)[\s\S]*stale: true/g);
  const loginRequired = source.slice(source.indexOf('function renderBookingLoginRequired'), source.indexOf('function openBookingModal'));
  assert.match(loginRequired, /booking-login-required[\s\S]*Duhet të kyçeni fillimisht/);
  assert.doesNotMatch(loginRequired, /<button|openPatientDoctorLogin|requirePatientAuthenticationForBooking/);
});

test('specialists have success, empty, controlled error and retry states', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const loader = source.slice(source.indexOf('async function updateLandingDoctors'), source.indexOf('// ===== EMERGENCY MODE'));
  assert.match(loader, /renderLandingDoctorsGrid\(\)/);
  assert.match(source, /Nuk ka doktorë të disponueshëm për momentin/);
  assert.match(loader, /Specialistët nuk mund të ngarkohen tani/);
  assert.match(loader, /onclick="updateLandingDoctors\(true\)"[^>]*>Provo përsëri/);
});

test('hosted Symptom Checker maps to ai-triage analyzeSymptoms without a legacy 503', async () => {
  const { client, calls } = clientHarness();
  const response = await client.routeLegacy('/api/ai-triage/analyze-symptoms', {
    method: 'POST', body: JSON.stringify({ symptoms: 'kollë e lehtë' })
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify({ operation: 'analyzeSymptoms', payload: { symptoms: 'kollë e lehtë' } }));
  assert.equal((await response.json()).source, 'rule_based');
});

test('all ai-triage departments normalize to canonical stored specialization values', () => {
  const { client } = clientHarness();
  const expected = {
    'Kardiologji': 'cardiology',
    'Pediatri': 'pediatrics',
    'Dermatologji': 'dermatology',
    'Pulmonologji': 'pulmonology',
    'Gjinekologji': 'gynecology',
    'MJEKËSI  E PËRGJITHSHME': 'general',
    'Urgjencë': 'emergency'
  };
  for (const [department, specialization] of Object.entries(expected)) {
    assert.equal(client.normalizeDoctorSpecialization(department), specialization);
  }
});

test('Symptom Checker clears stale results and uses the exact requested supporting text', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal((source.match(/Shkruaj simptomat dhe merr sugjerimin për departamentin më të përshtatshëm\./g) || []).length, 1);
  const analyze = source.slice(source.indexOf('async function analyzeSymptoms()'), source.indexOf('// ===== SYMPTOM CHECKER BOOKING'));
  assert.match(analyze, /Duke analizuar simptomat dhe specialistët/);
  assert.match(analyze, /Nuk ka doktorë të disponueshëm/);
  assert.match(analyze, /Doktorët nuk mund të ngarkohen tani/);
});

test('doctor specialization adapter handles case, accents, spaces, languages and singular/plural variants', () => {
  const { client } = clientHarness();
  for (const value of [' GENERAL ', 'General Medicine', 'family medicine', 'general practitioner', 'general practitioners', 'Mjekësi e Përgjithshme', 'MJEKESI E PERGJITHSHME']) {
    assert.equal(client.normalizeDoctorSpecialization(value), 'general');
  }
  assert.equal(client.normalizeDoctorSpecialization('Cardiologists'), 'cardiology');
  assert.equal(client.normalizeDoctorSpecialization('Gynaecology'), 'gynecology');
});

test('Symptom Checker doctor lookup sends canonical specialization to the protected clinical operation', async () => {
  const { client, calls } = clientHarness();
  await client.routeLegacy('/api/appointments/doctors/MJEK%C3%8BSI%20E%20P%C3%8BRGJITHSHME');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { operation: 'listDoctors', payload: { specialization: 'general' } });
});

test('patient prescription and history routes never accept arbitrary patient identity', async () => {
  const { client, calls } = clientHarness();
  await client.routeLegacy('/api/patient/prescriptions');
  await client.routeLegacy('/api/patient/prescriptions/rx-1');
  await client.routeLegacy('/api/patient/history?patientId=spoof');
  assert.equal(JSON.stringify(calls), JSON.stringify([
    { operation: 'listMyPrescriptions', payload: {} },
    { operation: 'getMyPrescription', payload: { prescriptionId: 'rx-1' } },
    { operation: 'listMyMedicalHistory', payload: {} }
  ]));
});

test('doctor prescription creation strips identity, encryption and status spoofing', async () => {
  const { client, calls } = clientHarness();
  const allowed = { patientId: 'patient-1', appointmentId: 'appointment-1', diagnosis: 'demo', medicationName: 'demo', dosage: '1', frequency: '1', duration: '1', instructions: 'demo', additionalNotes: '' };
  await client.routeLegacy('/api/doctor/prescriptions', { method: 'POST', body: JSON.stringify({ ...allowed, doctorAuthUserId: 'spoof', encryptedBody: 'spoof', status: 'completed' }) });
  assert.equal(JSON.stringify(calls[0]), JSON.stringify({ operation: 'createPrescription', payload: allowed }));
});

test('both visible Symptom Checker entry points own a safe result container', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const quick = source.slice(source.indexOf('async function checkSymptoms()'), source.indexOf('async function analyzeSymptoms()'));
  const detailed = source.slice(source.indexOf('async function analyzeSymptoms()'), source.indexOf('// ===== SYMPTOM CHECKER BOOKING MODAL'));
  assert.match(quick, /const resultDiv = document\.getElementById\('symptomResult'\)/);
  assert.match(detailed, /const resultDiv = document\.getElementById\('analysisResult'\)/);
  assert.match(detailed, /catch\(err\)[\s\S]*finally\s*\{/);
  assert.doesNotMatch(detailed, /finally\s*\{[\s\S]*if\s*\(resultDiv\)/);
});

test('expired auth state updates the hosted UI without invoking logout again', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const handler = source.slice(source.indexOf('function handleAuthStateChanged'), source.indexOf("window.addEventListener('shendeti:auth-changed'"));
  assert.match(handler, /status !== 'anonymous'/);
  assert.match(handler, /app-shell/);
  assert.match(handler, /landing-page/);
  assert.doesNotMatch(handler, /logout\s*\(/);
});

test('protected doctor lookup remains session protected while public summaries use the narrow public operation', () => {
  const authSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'appwrite-auth.js'), 'utf8');
  const clientSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'clinical-client.js'), 'utf8');
  const configSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
  assert.match(authSource, /await requireCurrentSession\(\)/);
  assert.match(clientSource, /return call\('listDoctors'/);
  assert.match(clientSource, /return callPublic\('listPublicDoctors'/);
  assert.match(configSource, /LEGACY_CLINICAL_API_ENABLED:\s*false/);
  assert.doesNotMatch(clientSource, /appointments\/check-symptoms/);
});

test('recommended doctor booking reuses the canonical Phase 6B modal and availability loader', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const recommendationStart = source.indexOf('recommendedDoctorBookingMetadata.set');
  const recommendation = source.slice(recommendationStart, recommendationStart + 1800);
  const opener = source.slice(source.indexOf('async function openRecommendedDoctorBooking'), source.indexOf('function ensureSymptomBookingModal'));
  assert.match(recommendation, /openRecommendedDoctorBooking\('/);
  assert.doesNotMatch(recommendation, /openSymptomBookingModal\('/);
  assert.match(opener, /doctorSelect\.value = normalizedDoctorId/);
  assert.match(opener, /onBookingDoctorChange\(false\)/);
  assert.match(opener, /await loadBookingSlots\(\)/);
  assert.match(opener, /bookModal/);
});

test('recommended doctor preserves canonical service metadata instead of hardcoding Konsultim', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const metadata = source.slice(source.indexOf('recommendedDoctorBookingMetadata.set'), source.indexOf('recommendedDoctorBookingMetadata.set') + 700);
  const directService = source.slice(source.indexOf('function onBookingDoctorChange'), source.indexOf('async function loadBookingSlots'));
  assert.match(metadata, /services: Array\.isArray\(d\.services\) \? d\.services : \[\]/);
  assert.match(directService, /doctor\?\.services/);
  assert.match(directService, /item\.name/);
});

test('direct and recommended booking use the same protected slot and create adapters', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const opener = source.slice(source.indexOf('async function openRecommendedDoctorBooking'), source.indexOf('function ensureSymptomBookingModal'));
  const loader = source.slice(source.indexOf('async function loadBookingSlots'), source.indexOf('function selectBookingSlot'));
  const saver = source.slice(source.indexOf('async function saveBooking'), source.indexOf('// ===== PREMIUM FEATURES'));
  assert.match(opener, /loadBookingSlots/);
  assert.match(loader, /\/api\/appointments\/slots\//);
  assert.match(saver, /\/api\/appointments\/create/);
  assert.doesNotMatch(opener, /Konsultim/);
});

test('hosted frontend keeps clinical data and authentication material out of browser storage', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const legacyClient = fs.readFileSync(path.join(__dirname, '..', 'js', 'hf-client.js'), 'utf8');
  const themeClient = fs.readFileSync(path.join(__dirname, '..', 'js', 'theme.js'), 'utf8');
  assert.doesNotMatch(html, /localStorage/);
  assert.doesNotMatch(html, /Authorization\s*['"]?\s*:\s*`Bearer|requestHeaders\.Authorization/);
  assert.doesNotMatch(legacyClient, /this\.token|Authorization\s*['"]?\s*:\s*`Bearer/);
  assert.match(themeClient, /const STORAGE_KEY = 'shendeti-theme'/);
  assert.doesNotMatch(themeClient, /password|token|session|patient|doctor|profile|clinical|appointment|booking/i);
  assert.match(html, /sessionStorage\.setItem\(PENDING_BOOKING_KEY/);
});
