const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness({ labels = ['patient'], profileCount = 1, doctorCount = 1, accountError = null, accountGate = null, accountCreateError = null, loginError = null, bootstrapGate = null, doctors = [], simulateSessionLifecycle = false, bootstrapSucceeds = true } = {}) {
  const calls = [];
  let currentAccountError = accountError;
  let sessionActive = false;
  const accountData = { $id: 'synthetic-user', name: 'Synthetic User', email: 'synthetic@example.test', labels, status: true };
  class Client { setEndpoint() { return this; } setProject() { return this; } }
  class Account {
    async get() { calls.push(['account-get']); if (accountGate) await accountGate; if (currentAccountError) throw currentAccountError; if (simulateSessionLifecycle && !sessionActive) throw Object.assign(new Error('Unauthorized'), { code: 401, type: 'user_unauthorized' }); return accountData; }
    async createEmailPasswordSession(input) { calls.push(['login', input.email]); if (simulateSessionLifecycle && sessionActive) throw Object.assign(new Error('Creation of a session is prohibited when a session is active.'), { code: 401, type: 'user_session_already_exists' }); if (loginError) throw loginError; sessionActive = true; }
    async deleteSession() { calls.push(['logout']); sessionActive = false; }
    async create(input) { calls.push(['create-account', input.email]); if (simulateSessionLifecycle && sessionActive) throw Object.assign(new Error('Creation of a session is prohibited when a session is active.'), { code: 401, type: 'user_session_already_exists' }); if (accountCreateError) throw accountCreateError; }
  }
  class TablesDB {
    async listRows({ tableId }) {
      const count = tableId === 'profiles' ? profileCount : doctorCount;
      return { rows: Array.from({ length: count }, () => ({ authUserId: accountData.$id, name: accountData.name, role: labels[0], isActive: true, specialization: 'test' })) };
    }
  }
  class Functions {
    async createExecution(input) {
      const body = JSON.parse(input.body || '{}');
      if (body.operation === 'bootstrap-patient') calls.push(['bootstrap']);
      else calls.push(['execution', input.functionId, body.operation]);
      if (body.operation === 'bootstrap-patient' && bootstrapGate) await bootstrapGate;
      return { status: body.operation === 'bootstrap-patient' && !bootstrapSucceeds ? 'failed' : 'completed', responseStatusCode: 200, responseBody: ['listDoctors', 'listPublicDoctors'].includes(body.operation) ? JSON.stringify({ doctors }) : (bootstrapSucceeds ? '{"ok":true}' : '{}') };
    }
  }
  class Storage { async getFileDownload() { return new Uint8Array(); } }
  const window = {
    SHENDETI_IM_CONFIG: {
      APPWRITE_ENDPOINT: 'https://example.test/v1', APPWRITE_PROJECT_ID: 'dev', APPWRITE_DATABASE_ID: 'shendeti',
      APPWRITE_PROFILES_TABLE_ID: 'profiles', APPWRITE_DOCTOR_PROFILES_TABLE_ID: 'doctor_profiles', APPWRITE_REGISTRATION_FUNCTION_ID: 'clinical-api', APPWRITE_AI_TRIAGE_FUNCTION_ID: 'ai-triage'
    },
    Appwrite: { Client, Account, TablesDB, Functions, Storage, Query: { equal: () => 'equal', limit: () => 'limit' }, ID: { unique: () => 'unique' } },
    dispatchEvent(event) { calls.push(['auth-event', event.detail?.status, event.detail?.reason]); }
  };
  const context = vm.createContext({ window, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } });
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'appwrite-auth.js'), 'utf8');
  vm.runInContext(source, context);
  return {
    auth: window.ShendetiAuth,
    calls,
    setAccountError(error) { currentAccountError = error; },
    setLabels(nextLabels) { accountData.labels = [...nextLabels]; },
    setSessionActive(active) { sessionActive = active === true; }
  };
}

test('patient login resolves one label and one private profile', async () => {
  const { auth } = harness();
  const user = await auth.login('synthetic@example.test', 'synthetic-password');
  assert.equal(user.role, 'patient');
  assert.equal(auth.state.status, 'authenticated');
});

test('public login allows a trusted doctor role', async () => {
  const { auth } = harness({ labels: ['doctor'], doctorCount: 1 });
  const user = await auth.login('synthetic@example.test', 'synthetic-password', 'main');
  assert.equal(user.role, 'doctor');
  assert.equal(auth.state.status, 'authenticated');
});

test('public login blocks an authenticated admin and deletes the new session', async () => {
  const { auth, calls } = harness({ labels: ['admin'] });
  await assert.rejects(
    () => auth.login('synthetic@example.test', 'synthetic-password', 'main'),
    /Llogarite e administratorit duhet te kycen vetem ne panelin \/admin\./
  );
  assert.equal(auth.state.status, 'anonymous');
  assert.equal(auth.state.reason, 'admin-main-blocked');
  assert.ok(calls.some(([name]) => name === 'logout'));
});

test('admin login allows only the trusted admin context', async () => {
  const { auth } = harness({ labels: ['admin'] });
  const user = await auth.login('synthetic@example.test', 'synthetic-password', 'admin');
  assert.equal(user.role, 'admin');
});

test('patient and doctor accounts are rejected by the admin login context', async () => {
  for (const role of ['patient', 'doctor']) {
    const { auth, calls } = harness({ labels: [role] });
    await assert.rejects(
      () => auth.login('synthetic@example.test', 'synthetic-password', 'admin'),
      /nuk lejohet ne kete hyrje/
    );
    assert.equal(auth.state.reason, 'route-role-blocked');
    assert.ok(calls.some(([name]) => name === 'logout'));
  }
});

test('session restoration enforces route context and clears incompatible sessions', async () => {
  const adminHarness = harness({ labels: ['admin'] });
  assert.equal(await adminHarness.auth.restore('main'), null);
  assert.equal(adminHarness.auth.state.reason, 'admin-main-blocked');
  assert.ok(adminHarness.calls.some(([name]) => name === 'logout'));

  const patientHarness = harness({ labels: ['patient'] });
  assert.equal(await patientHarness.auth.restore('admin'), null);
  assert.equal(patientHarness.auth.state.reason, 'route-role-blocked');
  assert.ok(patientHarness.calls.some(([name]) => name === 'logout'));
});

test('conflicting role labels deny access and clear the session', async () => {
  const { auth, calls } = harness({ labels: ['patient', 'admin'] });
  await assert.rejects(() => auth.login('synthetic@example.test', 'synthetic-password'), /rol të vetëm/);
  assert.ok(calls.some(([name]) => name === 'logout'));
});

test('missing supported role labels deny public login and clear the session', async () => {
  const { auth, calls } = harness({ labels: [] });
  await assert.rejects(() => auth.login('synthetic@example.test', 'synthetic-password', 'main'), /rol të vetëm/);
  assert.equal(auth.state.status, 'anonymous');
  assert.ok(calls.some(([name]) => name === 'logout'));
});

test('doctor requires exactly one doctor profile', async () => {
  const { auth } = harness({ labels: ['doctor'], doctorCount: 0 });
  await assert.rejects(() => auth.login('synthetic@example.test', 'synthetic-password'), /Profili i doktorit/);
});

test('registration invokes the authenticated patient bootstrap', async () => {
  const { auth, calls } = harness({ simulateSessionLifecycle: true });
  await auth.restore('main');
  const user = await auth.registerPatient('Synthetic User', 'synthetic@example.test', 'synthetic-password');
  assert.equal(user.role, 'patient');
  assert.equal(auth.state.status, 'authenticated');
  assert.equal(auth.state.role, 'patient');
  assert.equal(calls.filter(([name]) => name === 'create-account').length, 1);
  assert.equal(calls.filter(([name]) => name === 'login').length, 1);
  assert.ok(calls.some(([name]) => name === 'bootstrap'));
});

test('failed registration deletes its new session and leaves future login usable', async () => {
  const { auth, calls } = harness({ simulateSessionLifecycle: true, bootstrapSucceeds: false });
  await auth.restore('main');
  await assert.rejects(
    () => auth.registerPatient('Synthetic User', 'new@example.test', 'synthetic-password'),
    /Profili i pacientit nuk u inicializua/
  );
  assert.equal(auth.state.status, 'anonymous');
  assert.equal(auth.state.reason, 'registration-failed');
  assert.equal(calls.filter(([name]) => name === 'logout').length, 1);
  assert.equal((await auth.login('existing@example.test', 'synthetic-password', 'main')).role, 'patient');
});

test('login clears one stranded Appwrite session and retries once', async () => {
  const { auth, calls, setSessionActive } = harness({ simulateSessionLifecycle: true });
  await auth.restore('main');
  setSessionActive(true);
  const user = await auth.login('synthetic@example.test', 'synthetic-password', 'main');
  assert.equal(user.role, 'patient');
  assert.equal(calls.filter(([name]) => name === 'login').length, 2);
  assert.equal(calls.filter(([name]) => name === 'logout').length, 1);
});

test('only invalid-credential 401 errors use the bad-credentials message', () => {
  const { auth } = harness();
  assert.equal(auth.safeError({ code: 401, type: 'user_invalid_credentials' }), 'Emaili ose fjalëkalimi është i pasaktë.');
  assert.equal(auth.safeError({ code: 401, type: 'user_session_already_exists' }), 'Sesioni ekzistues nuk mund të pastrohej. Provo përsëri.');
  assert.equal(auth.safeError({ code: 401, type: 'user_email_not_verified', message: 'Email verification is required.' }, 'Email verification is required.'), 'Email verification is required.');
});

test('invalid credentials fail once without stale-session cleanup or retry', async () => {
  const invalidCredentials = Object.assign(new Error('Invalid credentials. Please check the email and password.'), { code: 401, type: 'user_invalid_credentials' });
  const { auth, calls } = harness({ simulateSessionLifecycle: true, loginError: invalidCredentials });
  await auth.restore('main');
  await assert.rejects(() => auth.login('synthetic@example.test', 'wrong-password', 'main'), /Emaili ose fjalëkalimi është i pasaktë/);
  assert.equal(calls.filter(([name]) => name === 'login').length, 1);
  assert.equal(calls.filter(([name]) => name === 'logout').length, 0);
});

test('registered patient can logout and login again with a clean session', async () => {
  const { auth, calls } = harness({ simulateSessionLifecycle: true });
  await auth.restore('main');
  assert.equal((await auth.registerPatient('Synthetic User', 'new@example.test', 'synthetic-password')).role, 'patient');
  await auth.logout();
  assert.equal(auth.state.status, 'anonymous');
  assert.equal((await auth.login('new@example.test', 'synthetic-password', 'main')).role, 'patient');
  assert.equal(auth.state.status, 'authenticated');
  assert.equal(calls.filter(([name]) => name === 'login').length, 2);
  assert.equal(calls.filter(([name]) => name === 'logout').length, 1);
});

test('multiple isolated registration logout and login cycles do not leak state', async () => {
  for (let index = 0; index < 5; index += 1) {
    const { auth, calls } = harness({ simulateSessionLifecycle: true });
    await auth.restore('main');
    const email = `patient-${index}@example.test`;
    assert.equal((await auth.registerPatient(`Patient ${index}`, email, 'synthetic-password')).role, 'patient');
    await auth.logout();
    assert.equal((await auth.login(email, 'synthetic-password', 'main')).role, 'patient');
    assert.equal(calls.filter(([name]) => name === 'create-account').length, 1);
    assert.equal(calls.filter(([name]) => name === 'bootstrap').length, 1);
    assert.equal(calls.filter(([name]) => name === 'login').length, 2);
  }
});

test('repeated failed registration rolls back each session before future login', async () => {
  const { auth, calls } = harness({ simulateSessionLifecycle: true, bootstrapSucceeds: false });
  await auth.restore('main');
  for (let index = 0; index < 3; index += 1) {
    await assert.rejects(() => auth.registerPatient(`Patient ${index}`, `failed-${index}@example.test`, 'synthetic-password'), /Profili i pacientit nuk u inicializua/);
    assert.equal(auth.state.status, 'anonymous');
  }
  assert.equal(calls.filter(([name]) => name === 'logout').length, 3);
  assert.equal((await auth.login('existing@example.test', 'synthetic-password', 'main')).role, 'patient');
});

test('duplicate registration calls share one account session and bootstrap operation', async () => {
  let releaseBootstrap;
  const bootstrapGate = new Promise((resolve) => { releaseBootstrap = resolve; });
  const { auth, calls } = harness({ simulateSessionLifecycle: true, bootstrapGate });
  await auth.restore('main');
  const first = auth.registerPatient('Synthetic User', 'new@example.test', 'synthetic-password');
  const second = auth.registerPatient('Synthetic User', 'new@example.test', 'synthetic-password');
  assert.equal(first, second);
  await Promise.resolve();
  await Promise.resolve();
  await assert.rejects(() => auth.login('existing@example.test', 'synthetic-password', 'main'), /Regjistrimi është në proces/);
  releaseBootstrap();
  assert.equal((await first).role, 'patient');
  assert.equal(calls.filter(([name]) => name === 'create-account').length, 1);
  assert.equal(calls.filter(([name]) => name === 'login').length, 1);
  assert.equal(calls.filter(([name]) => name === 'bootstrap').length, 1);
});

test('duplicate-email registration creates no session and leaves login usable', async () => {
  const duplicate = Object.assign(new Error('A user with the same email already exists.'), { code: 409, type: 'user_email_already_exists' });
  const { auth, calls } = harness({ simulateSessionLifecycle: true, accountCreateError: duplicate });
  await auth.restore('main');
  await assert.rejects(() => auth.registerPatient('Duplicate User', 'existing@example.test', 'synthetic-password'), /Regjistrimi nuk mund të përfundojë/);
  assert.equal(auth.state.status, 'anonymous');
  assert.equal(calls.filter(([name]) => name === 'login').length, 0);
  assert.equal(calls.filter(([name]) => name === 'logout').length, 0);
  assert.equal((await auth.login('existing@example.test', 'synthetic-password', 'main')).role, 'patient');
});

test('registration attempt while authenticated preserves the current session', async () => {
  const { auth, calls } = harness({ simulateSessionLifecycle: true });
  await auth.restore('main');
  assert.equal((await auth.login('existing@example.test', 'synthetic-password', 'main')).role, 'patient');
  await assert.rejects(() => auth.registerPatient('Another Patient', 'another@example.test', 'synthetic-password'), /Dilni nga llogaria aktive/);
  assert.equal(auth.state.status, 'authenticated');
  assert.equal(auth.state.role, 'patient');
  assert.equal(calls.filter(([name]) => name === 'create-account').length, 0);
  assert.equal(calls.filter(([name]) => name === 'logout').length, 0);
});

test('patient doctor and admin logins remain valid after failed registration activity', async () => {
  for (const [role, context] of [['patient', 'main'], ['doctor', 'main'], ['admin', 'admin']]) {
    const { auth } = harness({ labels: [role], doctorCount: 1, simulateSessionLifecycle: true, bootstrapSucceeds: false });
    await auth.restore(context);
    await assert.rejects(() => auth.registerPatient('Failed Registration', 'failed@example.test', 'synthetic-password'), /Profili i pacientit nuk u inicializua/);
    assert.equal((await auth.login(`${role}@example.test`, 'synthetic-password', context)).role, role);
  }
});

test('registration recovers from an already-active session only for the matching Appwrite error', async () => {
  const { auth, calls, setSessionActive } = harness({ simulateSessionLifecycle: true });
  await auth.restore('main');
  setSessionActive(true);
  assert.equal((await auth.registerPatient('Synthetic User', 'new@example.test', 'synthetic-password')).role, 'patient');
  assert.equal(calls.filter(([name]) => name === 'create-account').length, 2);
  assert.equal(calls.filter(([name]) => name === 'logout').length, 1);
  assert.equal(calls.filter(([name]) => name === 'login').length, 1);
});

test('logged-in patient receives doctor recommendations after session restoration', async () => {
  const doctors = [{ id: 'doctor-1', name: 'Synthetic Doctor' }];
  const { auth, calls } = harness({ doctors });
  const result = await auth.executeClinical('listDoctors', { specialization: 'Pulmonologji' });
  assert.equal(JSON.stringify(result.data.doctors), JSON.stringify(doctors));
  assert.equal(auth.state.status, 'authenticated');
  assert.equal(calls.filter(([name]) => name === 'login').length, 0);
});

test('logged-in patient receives an authorized clean empty doctor result', async () => {
  const { auth } = harness({ doctors: [] });
  const result = await auth.executeClinical('listDoctors', { specialization: 'Pulmonologji' });
  assert.equal(JSON.stringify(result.data.doctors), '[]');
  assert.equal(result.status, 200);
});

test('public specialist lookup does not restore or require an Appwrite account session', async () => {
  const unauthorized = Object.assign(new Error('Unauthorized'), { code: 401 });
  const doctors = [{ id: 'doctor-1', name: 'Synthetic Doctor', specialization: 'general', experience: 2, rating: 4, services: [] }];
  const { auth, calls } = harness({ accountError: unauthorized, doctors });
  const result = await auth.executePublicClinical('listPublicDoctors');
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result.data.doctors), JSON.stringify(doctors));
  assert.equal(calls.filter(([name]) => name === 'account-get').length, 0);
  assert.equal(calls.filter(([name]) => name === 'logout').length, 0);
});

test('unauthenticated user is rejected without creating a session', async () => {
  const unauthorized = Object.assign(new Error('Unauthorized'), { code: 401 });
  const { auth, calls } = harness({ accountError: unauthorized });
  await auth.restore();
  await assert.rejects(() => auth.executeClinical('listDoctors'), /kyçeni fillimisht/);
  assert.equal(calls.filter(([name]) => name === 'login').length, 0);
  assert.equal(calls.filter(([name]) => name === 'execution').length, 0);
});

test('expired session during restoration is handled cleanly', async () => {
  const unauthorized = Object.assign(new Error('Unauthorized'), { code: 401 });
  const { auth } = harness({ accountError: unauthorized });
  await assert.rejects(() => auth.executeClinical('listDoctors'), /Sesioni ka skaduar/);
  assert.equal(auth.state.status, 'anonymous');
});

test('account.get 401 clears stale authenticated state and publishes an expired event', async () => {
  const unauthorized = Object.assign(new Error('Unauthorized'), { code: 401 });
  const { auth, calls, setAccountError } = harness();
  await auth.restore();
  assert.equal(auth.state.status, 'authenticated');
  setAccountError(unauthorized);
  await assert.rejects(() => auth.executeClinical('listDoctors'), /Sesioni ka skaduar/);
  assert.equal(auth.state.status, 'anonymous');
  assert.ok(calls.some(([name, status, reason]) => name === 'auth-event' && status === 'anonymous' && reason === 'expired'));
  assert.equal(calls.filter(([name]) => name === 'execution').length, 0);
  assert.equal(calls.filter(([name]) => name === 'logout').length, 0);
});

test('repeated logout after an expired session does not delete current session', async () => {
  const unauthorized = Object.assign(new Error('Unauthorized'), { code: 401 });
  const { auth, calls } = harness({ accountError: unauthorized });
  await auth.restore();
  await auth.logout();
  await auth.logout();
  assert.equal(calls.filter(([name]) => name === 'logout').length, 0);
});

test('doctor lookup waits for the one in-flight session refresh', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { auth, calls } = harness({ accountGate: gate });
  const restoration = auth.restore();
  const lookup = auth.executeClinical('listDoctors');
  await Promise.resolve();
  assert.equal(calls.filter(([name]) => name === 'account-get').length, 1);
  release();
  await Promise.all([restoration, lookup]);
  assert.equal(calls.filter(([name]) => name === 'account-get').length, 1);
  assert.equal(calls.filter(([name]) => name === 'login').length, 0);
});

test('explicit login waits out stale anonymous restoration and owns the final authenticated state', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { auth, calls } = harness({ accountGate: gate });
  const restoration = auth.restore('main');
  const login = auth.login('synthetic@example.test', 'synthetic-password', 'main');
  await Promise.resolve();
  assert.equal(calls.filter(([name]) => name === 'login').length, 0);
  release();
  await Promise.all([restoration, login]);
  assert.equal(auth.state.status, 'authenticated');
  assert.equal(auth.state.role, 'patient');
  assert.equal(calls.filter(([name]) => name === 'login').length, 1);
});

test('logout and patient-doctor account switches converge without stale role state', async () => {
  const { auth, setLabels } = harness({ labels: ['patient'] });
  assert.equal((await auth.login('patient@example.test', 'password', 'main')).role, 'patient');
  await auth.logout();
  assert.equal(auth.state.status, 'anonymous');
  setLabels(['doctor']);
  assert.equal((await auth.login('doctor@example.test', 'password', 'main')).role, 'doctor');
  await auth.logout();
  setLabels(['patient']);
  assert.equal((await auth.login('patient@example.test', 'password', 'main')).role, 'patient');
  assert.equal(auth.state.status, 'authenticated');
});
