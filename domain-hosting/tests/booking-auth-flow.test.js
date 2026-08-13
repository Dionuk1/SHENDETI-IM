const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function htmlFunction(name, isAsync = false) {
  const start = source.indexOf(`${isAsync ? 'async ' : ''}function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) { if (char === quote && source[index - 1] !== '\\') quote = ''; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function classList(hidden = true) {
  const values = new Set(hidden ? ['hidden'] : []);
  return { add: (v) => values.add(v), remove: (v) => values.delete(v), contains: (v) => values.has(v) };
}

function bookingHarness() {
  const storage = new Map();
  const elements = {
    bookDoc: { value: 'doctor-1' }, bookService: { value: 'Konsultim' }, bookDate: { value: '2026-08-20' },
    bookTime: { value: '' }, bookScheduledAt: { value: '' }, bookDuration: { value: '' },
    bookSlots: { innerHTML: '' }, bookSlotCount: { textContent: '' },
    bookModal: { classList: classList(false), setAttribute() {} }, symptomBookingModal: { classList: classList(true), setAttribute() {} },
    loginModal: { classList: classList(true), setAttribute() {} }, loginEmail: { value: '', focus() { this.focused = true; } },
    loginPass: { value: '' }, loginSubmitButton: { disabled: false },
  };
  const calls = { fetch: 0, notices: [] };
  const context = vm.createContext({
    document: { getElementById: (id) => elements[id] || null },
    window: { location: { hash: '' } },
    sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: (k) => storage.get(k) || null, removeItem: (k) => storage.delete(k) },
    Date, Number, String, Math, JSON, RegExp, bookingSlotsRequestId: 0, loginIntentActive: false,
    PENDING_BOOKING_KEY: 'shendeti-im:pending-booking:v1',
    isSafeBookingDoctorId: (id) => /^[A-Za-z0-9._-]{1,80}$/.test(id), clearPendingBooking: () => storage.clear(),
    showToast: () => {}, syncModalBodyLock: () => {}, switchAuthTab: () => {},
    setInlineNoticeAfterField: (...args) => calls.notices.push(args),
    fetch: async () => { calls.fetch += 1; throw new Error('unexpected request'); },
  });
  vm.runInContext([
    htmlFunction('openModal'), htmlFunction('showLoginForm'), htmlFunction('openPatientDoctorLogin'),
    htmlFunction('preservePendingBooking'), htmlFunction('currentMainBookingState'),
    htmlFunction('requirePatientAuthenticationForBooking'), htmlFunction('renderBookingLoginRequired')
  ].join('\n'), context);
  return { context, elements, storage, calls };
}

test('booking login-required state contains no standalone Kyçu button', () => {
  const { context, elements } = bookingHarness();
  context.renderBookingLoginRequired();
  assert.match(elements.bookSlots.innerHTML, /Duhet të kyçeni fillimisht\./);
  assert.doesNotMatch(elements.bookSlots.innerHTML, /<button|openPatientDoctorLogin|requirePatientAuthenticationForBooking/);
  const modal = source.slice(source.indexOf('id="bookModal"'), source.indexOf('id="adminAddModal"'));
  assert.match(modal, /Konfirmo rezervimin/);
  assert.match(modal, />Anulo</);
});

test('unauthenticated confirmation opens the same login before validation or appointment requests', async () => {
  const { context, elements, storage, calls } = bookingHarness();
  Object.assign(context, {
    doctors: [{ id: 'doctor-1', name: 'Dr Test' }], emergencyMode: false,
    hasClinicalSession: () => false, getCurrentUserSafe: () => ({}), appointments: [],
    showToast: () => { throw new Error('validation ran before authentication'); },
    persistAppointmentsToStorage: () => {}, loadBookingSlots: async () => {}, toggleModal: () => {}, refreshView: () => {},
  });
  vm.runInContext(htmlFunction('saveBooking', true), context);
  await context.saveBooking();
  assert.equal(elements.loginModal.classList.contains('hidden'), false);
  assert.equal(calls.fetch, 0);
  assert.equal(JSON.parse(storage.get('shendeti-im:pending-booking:v1')).doctorId, 'doctor-1');
});

test('shared login markup is singular, selector-free, and uses the requested heading', () => {
  const login = source.slice(source.indexOf('id="loginModal"'), source.indexOf('id="bookModal"'));
  assert.match(login, /Kyçu në llogarinë tuaj/);
  assert.equal((login.match(/id="loginEmail"/g) || []).length, 1);
  assert.equal((login.match(/id="loginPass"/g) || []).length, 1);
  assert.equal((login.match(/id="loginSubmitButton"/g) || []).length, 1);
  assert.match(login, /Regjistrohu/);
  assert.match(login, />Anulo<\/button>/);
  assert.doesNotMatch(login, /patientLoginOption|doctorLoginOption|selectLoginRole|Lloji i hyrjes/);
});

test('internal modal clicks do not close login and repeated opens create no duplicate', () => {
  const { context, elements } = bookingHarness();
  context.openPatientDoctorLogin();
  context.openPatientDoctorLogin();
  const modal = elements.loginModal;
  const backdropHandler = (event) => { if (event.target === modal) modal.classList.add('hidden'); };
  backdropHandler({ target: {} });
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal((source.match(/id="loginModal"/g) || []).length, 1);
});

test('failed shared login leaves the intentional modal open', async () => {
  const { context, elements, calls } = bookingHarness();
  elements.loginEmail.value = 'patient@example.test';
  elements.loginPass.value = 'wrong-password';
  Object.assign(context, {
    loginSubmissionInFlight: false, registerSubmissionInFlight: false, ensureLoginPasswordHidden: () => {}, setButtonLoading: () => {},
    completeAuthentication: () => { throw new Error('must not authenticate'); }, addLog: () => {},
  });
  context.window.ShendetiAuth = { login: async () => { throw new Error('Emaili ose fjalëkalimi është i pasaktë.'); } };
  vm.runInContext(htmlFunction('auth', true), context);
  context.openPatientDoctorLogin();
  await context.auth();
  assert.equal(elements.loginModal.classList.contains('hidden'), false);
  assert.ok(calls.notices.some((entry) => String(entry[3]).includes('pasaktë')));
});

test('successful authentication releases every mobile modal and drawer interaction lock without clearing booking intent', () => {
  const classes = (...initial) => {
    const values = new Set(initial);
    return {
      add: (...items) => items.forEach((item) => values.add(item)),
      remove: (...items) => items.forEach((item) => values.delete(item)),
      contains: (item) => values.has(item),
      toggle(item, force) { if (force) values.add(item); else values.delete(item); },
    };
  };
  const attributes = new Map();
  const focused = { blurred: false, blur() { this.blurred = true; } };
  const elements = {
    loginModal: { classList: classes(), contains: (item) => item === focused, setAttribute: (key, value) => attributes.set(`login:${key}`, value) },
    'app-shell': { removeAttribute: (key) => attributes.set(`shell-removed:${key}`, true), setAttribute: (key, value) => attributes.set(`shell:${key}`, value) },
    dashboardSidebar: { classList: classes('mobile-open') },
    sidebarBackdrop: { classList: classes('visible'), setAttribute: (key, value) => attributes.set(`backdrop:${key}`, value) },
    mobileSidebarToggle: { setAttribute: (key, value) => attributes.set(`toggle:${key}`, value) },
  };
  const bodyClasses = classes('modal-open', 'mobile-drawer-open');
  const htmlClasses = classes('modal-open', 'mobile-drawer-open');
  const context = vm.createContext({
    loginIntentActive: true,
    window: { matchMedia: () => ({ matches: true }) },
    document: {
      body: { classList: bodyClasses }, documentElement: { classList: htmlClasses }, activeElement: focused,
      getElementById: (id) => elements[id] || null,
      querySelector: (selector) => selector === '.modal:not(.hidden)' && !elements.loginModal.classList.contains('hidden') ? elements.loginModal : null,
    },
  });
  vm.runInContext([htmlFunction('syncModalBodyLock'), htmlFunction('setMobileSidebar'), htmlFunction('closeMobileSidebar'), htmlFunction('finishAuthenticationTransition')].join('\n'), context);
  context.finishAuthenticationTransition();
  assert.equal(elements.loginModal.classList.contains('hidden'), true);
  assert.equal(attributes.get('login:aria-hidden'), 'true');
  assert.equal(focused.blurred, true);
  assert.equal(context.loginIntentActive, false);
  assert.equal(elements.dashboardSidebar.classList.contains('mobile-open'), false);
  assert.equal(elements.sidebarBackdrop.classList.contains('visible'), false);
  assert.equal(attributes.get('backdrop:aria-hidden'), 'true');
  assert.equal(bodyClasses.contains('modal-open'), false);
  assert.equal(bodyClasses.contains('mobile-drawer-open'), false);
  assert.equal(htmlClasses.contains('modal-open'), false);
  assert.equal(htmlClasses.contains('mobile-drawer-open'), false);
  assert.equal(attributes.get('shell-removed:inert'), true);
  assert.equal(attributes.get('shell:aria-hidden'), 'false');
});

test('dashboard remains usable when a secondary initialization path throws', () => {
  const values = new Map();
  const element = (hidden = false) => ({ classList: classList(hidden) });
  const elements = {
    'landing-page': element(false), loginModal: element(false), 'app-shell': element(true), 'sidebar-links': {},
  };
  const notices = [];
  const context = vm.createContext({
    window: { ShendetiAuth: { state: { status: 'authenticated', role: 'patient' } } }, adminDashboardEntryAuthorized: false,
    document: { getElementById: (id) => elements[id] || null, querySelector: (selector) => selector === 'nav' ? element(false) : null },
    showToast: (type, message) => notices.push([type, message]), finishAuthenticationTransition: () => values.set('cleaned', true),
    refreshView: () => { throw new Error('secondary failure'); }, updateGlobalIdentityDisplay: () => {}, loadNotificationCount: () => {},
    console: { error: () => values.set('logged', true) },
  });
  vm.runInContext(htmlFunction('renderDashboard'), context);
  assert.equal(context.renderDashboard('patient'), true);
  assert.equal(elements['app-shell'].classList.contains('hidden'), false);
  assert.equal(values.get('cleaned'), true);
  assert.equal(values.get('logged'), true);
  assert.ok(notices.some(([type]) => type === 'error'));
});

test('login submission guard and loading state clear after success and error', async () => {
  for (const outcome of ['success', 'error']) {
    const { context, elements } = bookingHarness();
    elements.loginEmail.value = 'patient@example.test'; elements.loginPass.value = 'password';
    const loading = [];
    Object.assign(context, {
      loginSubmissionInFlight: false, registerSubmissionInFlight: false, ensureLoginPasswordHidden: () => {},
      setButtonLoading: (_button, state) => loading.push(state), completeAuthentication: () => {}, addLog: () => {},
    });
    let calls = 0;
    context.window.ShendetiAuth = { login: async () => { calls += 1; if (outcome === 'error') throw new Error('failed'); return { role: 'patient' }; } };
    vm.runInContext(htmlFunction('auth', true), context);
    await Promise.all([context.auth(), context.auth()]);
    assert.equal(calls, 1);
    assert.deepEqual(loading, [true, false]);
    assert.equal(context.loginSubmissionInFlight, false);
  }
});

test('successful registration auto-authenticates once and clears its loading state', async () => {
  let releaseRegistration;
  const gate = new Promise((resolve) => { releaseRegistration = resolve; });
  const elements = {
    regName: { value: 'Synthetic Patient' }, regEmail: { value: 'new@example.test' },
    regPass: { value: 'synthetic-password' }, regPassConfirm: { value: 'synthetic-password' },
    registerSubmitButton: { disabled: false },
  };
  const calls = { register: 0, dashboards: [], loading: [], notices: [], toasts: [] };
  const context = vm.createContext({
    registerSubmissionInFlight: false, loginSubmissionInFlight: false,
    document: { getElementById: (id) => elements[id] || null },
    window: { ShendetiAuth: { registerPatient: async () => { calls.register += 1; await gate; return { id: 'new-patient', role: 'patient' }; } } },
    ensureRegisterPasswordsHidden: () => {},
    setInlineNoticeAfterField: (...args) => calls.notices.push(args),
    setButtonLoading: (_button, state) => calls.loading.push(state),
    ADMIN_MAIN_GUIDANCE: 'admin blocked', adminDashboardEntryAuthorized: false,
    renderDashboard: (role) => { calls.dashboards.push(role); return true; },
    updateGlobalIdentityDisplay: () => {}, loadNotificationCount: () => {},
    restorePendingBookingAfterAuth: () => {}, updateLandingDoctors: () => {}, setTimeout: (callback) => callback(),
    showToast: (...args) => calls.toasts.push(args),
  });
  vm.runInContext([htmlFunction('completeAuthentication'), htmlFunction('registerUser', true)].join('\n'), context);
  const first = context.registerUser();
  const repeatedClick = context.registerUser();
  await Promise.resolve();
  assert.equal(calls.register, 1);
  assert.deepEqual(calls.loading, [true]);
  releaseRegistration();
  await Promise.all([first, repeatedClick]);
  assert.deepEqual(calls.dashboards, ['patient']);
  assert.deepEqual(calls.loading, [true, false]);
  assert.equal(context.registerSubmissionInFlight, false);
  assert.equal(elements.regName.value, '');
  assert.equal(elements.regEmail.value, '');
  assert.equal(elements.regPass.value, '');
  assert.equal(elements.regPassConfirm.value, '');
});

test('failed registration releases its UI guard and allows an immediate retry', async () => {
  const elements = {
    regName: { value: 'Synthetic Patient' }, regEmail: { value: 'duplicate@example.test' },
    regPass: { value: 'synthetic-password' }, regPassConfirm: { value: 'synthetic-password' },
    registerSubmitButton: { disabled: false },
  };
  let attempts = 0;
  const loading = [];
  const notices = [];
  const context = vm.createContext({
    registerSubmissionInFlight: false, loginSubmissionInFlight: false,
    document: { getElementById: (id) => elements[id] || null },
    window: { ShendetiAuth: { registerPatient: async () => { attempts += 1; if (attempts === 1) throw new Error('Regjistrimi nuk mund të përfundojë me këto të dhëna.'); return { role: 'patient' }; } } },
    ensureRegisterPasswordsHidden: () => {}, setInlineNoticeAfterField: (...args) => notices.push(args),
    setButtonLoading: (_button, state) => loading.push(state), completeAuthentication: () => {}, showToast: () => {},
  });
  vm.runInContext(htmlFunction('registerUser', true), context);
  await context.registerUser();
  assert.equal(context.registerSubmissionInFlight, false);
  assert.ok(notices.some((entry) => String(entry[3]).includes('Regjistrimi nuk mund')));
  await context.registerUser();
  assert.equal(attempts, 2);
  assert.deepEqual(loading, [true, false, true, false]);
});

test('repeated login and registration tab switches keep one handler and isolated credentials', () => {
  const elements = {
    'login-form': { classList: classList(false) }, 'register-form': { classList: classList(true) },
    authModalTitle: { textContent: '' }, loginEmail: { value: 'login@example.test' },
    loginPass: { value: 'login-password' }, regEmail: { value: 'register@example.test' }, regPass: { value: 'register-password' },
  };
  const context = vm.createContext({
    registerSubmissionInFlight: false, loginSubmissionInFlight: false,
    document: { getElementById: (id) => elements[id] || null },
  });
  vm.runInContext(htmlFunction('switchAuthTab'), context);
  for (let index = 0; index < 5; index += 1) {
    context.switchAuthTab('register');
    assert.equal(elements['register-form'].classList.contains('hidden'), false);
    context.switchAuthTab('login');
    assert.equal(elements['login-form'].classList.contains('hidden'), false);
  }
  assert.equal(elements.loginEmail.value, 'login@example.test');
  assert.equal(elements.regEmail.value, 'register@example.test');
  assert.equal((source.match(/id="registerSubmitButton"/g) || []).length, 1);
  assert.equal((source.match(/onclick="registerUser\(\)"/g) || []).length, 1);
  assert.equal((source.match(/getElementById\('login-form'\)\?\.addEventListener\('submit'/g) || []).length, 1);
});
