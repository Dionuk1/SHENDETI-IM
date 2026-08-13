const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function htmlFunction(name) {
  const start = source.indexOf(`function ${name}`);
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

function metricElement() {
  return { textContent: '', title: '', removeAttribute(name) { if (name === 'title') this.title = ''; } };
}

function dashboardHarness(fetchImpl, initialUser = { id: 'patient-1', role: 'patient', name: 'Dion Test' }) {
  const elements = { patientPrescriptionCount: metricElement(), patientMedicalHistoryCount: metricElement() };
  let user = initialUser;
  let authenticated = true;
  let fetchCount = 0;
  const context = vm.createContext({
    document: { getElementById: (id) => elements[id] || null },
    getCurrentUserSafe: () => user,
    hasClinicalSession: () => authenticated,
    fetch: async (...args) => { fetchCount += 1; return fetchImpl(...args); },
    Promise, Number, String,
  });
  vm.runInContext(`let patientDashboardMetricsRequestId = 0; let patientDashboardMetricsPromise = null;\n${htmlFunction('patientGreetingName')}\n${htmlFunction('resetPatientDashboardMetrics')}\n${htmlFunction('loadPatientDashboardMetrics')}`, context);
  return { context, elements, get fetchCount() { return fetchCount; }, setUser(next) { user = next; }, setAuthenticated(next) { authenticated = next; } };
}

test('patient greeting uses the authenticated first name and safe fallback', () => {
  const harness = dashboardHarness(async () => { throw new Error('unused'); });
  assert.equal(harness.context.patientGreetingName({ name: '  Dion   Test  ' }), 'Dion');
  assert.equal(harness.context.patientGreetingName({ name: '' }), 'Pacient');
  assert.equal(harness.context.patientGreetingName({ name: 'dion@example.test' }), 'Pacient');
  assert.equal(harness.context.patientGreetingName({}), 'Pacient');
  const dashboard = source.slice(source.indexOf("if(!subview || subview === 'dashboard')"), source.indexOf("else if(subview === 'symptoms')"));
  assert.match(dashboard, /Mirë se erdhe, <b>\$\{escapeHtml\(myName\)\}<\/b> 👋/);
  assert.doesNotMatch(dashboard, /Mirësere|Dion/);
});

test('patient counts render zero and prevent duplicate in-flight requests', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const harness = dashboardHarness(async () => { await pending; return { ok: true, json: async () => ({ counts: { prescriptions: 0, medicalHistory: 0 } }) }; });
  const first = harness.context.loadPatientDashboardMetrics();
  const duplicate = harness.context.loadPatientDashboardMetrics();
  assert.equal(harness.fetchCount, 1);
  assert.equal(harness.elements.patientPrescriptionCount.textContent, '…');
  release();
  await Promise.all([first, duplicate]);
  assert.equal(harness.elements.patientPrescriptionCount.textContent, '0');
  assert.equal(harness.elements.patientMedicalHistoryCount.textContent, '0');
});

test('patient counts use controlled error state and ignore stale responses after logout', async () => {
  const failed = dashboardHarness(async () => ({ ok: false, json: async () => ({ error: { message: 'private raw error' } }) }));
  await failed.context.loadPatientDashboardMetrics();
  assert.equal(failed.elements.patientPrescriptionCount.textContent, 'Gabim');
  assert.equal(failed.elements.patientPrescriptionCount.textContent.includes('private'), false);

  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const stale = dashboardHarness(async () => { await pending; return { ok: true, json: async () => ({ counts: { prescriptions: 9, medicalHistory: 8 } }) }; });
  const request = stale.context.loadPatientDashboardMetrics();
  stale.setAuthenticated(false);
  stale.setUser({});
  stale.context.resetPatientDashboardMetrics();
  release();
  await request;
  assert.equal(stale.elements.patientPrescriptionCount.textContent, '…');
  assert.equal(stale.elements.patientMedicalHistoryCount.textContent, '…');
});

test('dashboard count route and relevant medical-record mutation use focused refetch', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'js', 'clinical-client.js'), 'utf8');
  assert.match(client, /path === '\/api\/patient\/dashboard'\) return call\('getPatientDashboard'\)/);
  const upload = source.slice(source.indexOf('async function uploadMedicalPdf'), source.indexOf('async function downloadMedicalPdf'));
  assert.match(upload, /await loadMedicalRecords\(\); await loadPatientDashboardMetrics\(\)/);
});
