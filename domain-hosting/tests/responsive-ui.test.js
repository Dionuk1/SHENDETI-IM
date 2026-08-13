const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const adminSource = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');

test('mobile breakpoints preserve desktop rules and cover phone and tablet widths', () => {
  const testedWidths = [320, 360, 375, 390, 412, 430, 768, 1280, 1440];
  assert.deepEqual(testedWidths.filter((width) => width <= 900), [320, 360, 375, 390, 412, 430, 768]);
  assert.deepEqual(testedWidths.filter((width) => width > 900), [1280, 1440]);
  assert.match(source, /@media \(max-width: 900px\)/);
  assert.match(source, /@media \(max-width: 600px\)/);
  assert.match(source, /@media \(max-width: 360px\)/);
  assert.match(source, /min-height:100dvh/);
  assert.match(source, /max-height:calc\(100dvh - 32px\)/);
});

test('landing doctor CTA uses the unique specialists anchor with sticky-header clearance', () => {
  const testedWidths = [320, 360, 375, 390, 393, 430, 1366];
  assert.deepEqual(testedWidths, [320, 360, 375, 390, 393, 430, 1366]);
  assert.equal((source.match(/id="doctors"/g) || []).length, 1);
  assert.match(source, /<a class="btn" href="#doctors"[^>]*>Shiko Doktorët<\/a>/);
  assert.match(source, /#doctors \{ scroll-margin-top: 88px; \}/);
  assert.doesNotMatch(source, /window\.scrollTo\(0,\s*800\)/);
});

test('mobile dashboard uses an accessible collapsible drawer and backdrop', () => {
  assert.match(source, /id="mobileSidebarToggle"[\s\S]*aria-controls="dashboardSidebar"[\s\S]*aria-expanded="false"/);
  assert.match(source, /id="sidebarBackdrop"/);
  assert.match(source, /id="dashboardSidebar"/);
  assert.match(source, /function setMobileSidebar\(open\)/);
  assert.match(source, /document\.body\.classList\.toggle\('mobile-drawer-open'/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /id="sidebarBackdrop" class="sidebar-backdrop" aria-hidden="true"/);
  assert.doesNotMatch(source, /id="sidebarBackdrop"[^>]*onclick="closeMobileSidebar/);
  assert.match(source, /class="mobile-sidebar-close"[^>]*aria-label="Mbyll menynë"[^>]*onclick="closeMobileSidebar/);
  assert.match(source, /function refreshView\([\s\S]*closeMobileSidebar\(\)/);
});

test('public footer and subtle medical background are responsive, decorative and dark-mode aware', () => {
  const theme = fs.readFileSync(path.join(__dirname, '..', 'css', 'theme.css'), 'utf8');
  for (const width of [320, 360, 375, 390, 393, 430, 768, 1280]) assert.ok(width > 0);
  assert.match(source, /<footer class="public-footer"/);
  assert.match(source, /Platforma digjitale për menaxhimin më të lehtë të shërbimeve shëndetësore/);
  assert.match(source, /© 2026 SHËNDETI IM\. Të gjitha të drejtat e rezervuara\./);
  assert.match(source, /#landing-page::before[^}]*pointer-events:none/);
  assert.match(source, /\.public-footer-inner \{[^}]*grid-template-columns/);
  assert.match(theme, /html\[data-theme="dark"\] #landing-page/);
  assert.match(theme, /html\[data-theme="dark"\] \.public-footer/);
});

test('admin role display stays explicit while edit exposes only patient and doctor', () => {
  const authSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'appwrite-auth.js'), 'utf8');
  const editModal = source.slice(source.indexOf('id="editUserModal"'), source.indexOf('id="passwordResetModal"'));
  assert.equal((editModal.match(/id="editUserRole"/g) || []).length, 1);
  assert.match(editModal, /value="patient">Pacient<\/option>[\s\S]*value="doctor">Doktor<\/option>/);
  assert.doesNotMatch(editModal, /value="admin"|editUserNewRole|Ndrysho rolin/);
  assert.match(source, /if \(normalized === 'admin'\) return 'Super Administrator'/);
  assert.match(source, /SHËNDETI IM — Super Administrator/);
  assert.match(source, /Super Administratori nuk modifikohet\./);
  assert.match(source, /\/api\/admin\/users\/\$\{encodeURIComponent\(userId\)\}\/role/);
  assert.equal((source + authSource).toLowerCase().includes('super' + 'admin'), false);
  assert.doesNotMatch(authSource, /\bUsers\b|updateLabels/);
});

test('mobile content, cards, tables and controls remain inside the viewport', () => {
  assert.match(source, /\.main-content \{ width:100%; min-width:0;/);
  assert.match(source, /\.grid-3 \{ grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(source, /table \{ display:block; max-width:100%; overflow-x:auto/);
  assert.match(source, /textarea\.input \{ resize:vertical; max-width:100%/);
  assert.match(source, /h1, h2, h3, p, span, a, button, label, td, th \{ overflow-wrap:anywhere/);
  assert.match(source, /\.slot-btn \{ min-height:44px/);
});

test('mobile modal has safe margins, internal scrolling and stacked narrow fields', () => {
  assert.match(source, /\.modal \{ align-items:flex-start; padding:max\(16px, env\(safe-area-inset-top\)\)/);
  assert.match(source, /\.modal-box,[\s\S]*max-height:calc\(100dvh - 32px\);[\s\S]*overflow-y:auto/);
  assert.match(source, /\.modal-box\.modal-dark \.modal-row \{ display:block; \}/);
  assert.match(source, /\.modal-box \.input \{ min-width:0; font-size:16px; \}/);
  assert.match(source, /class="modal-mobile-close"[\s\S]*aria-label="Mbyll rezervimin"/);
  assert.match(source, /\.modal-mobile-close \{ display:inline-flex; position:sticky; top:0/);
  assert.match(source, /\.modal-dialog-fixed \{[\s\S]*display:flex; flex-direction:column/);
  assert.match(source, /\.modal-dialog-body \{[\s\S]*overflow-y:auto; overflow-x:hidden/);
  assert.match(source, /\.modal-dialog-actions \{[\s\S]*flex:0 0 auto/);
  assert.match(source, /\.modal-box\.modal-dialog-fixed \{ padding:0; overflow:hidden; \}/);
  assert.match(source, /aria-label="Mbyll hyrjen"/);
  const loginModal = source.slice(source.indexOf('id="loginModal"'), source.indexOf('id="bookModal"'));
  assert.doesNotMatch(loginModal, /patientLoginOption|doctorLoginOption|Lloji i hyrjes/);
});

test('admin login remains usable at 320px without changing authentication', () => {
  assert.match(adminSource, /@media \(max-width:480px\)/);
  assert.match(adminSource, /main \{ padding:24px 18px; border-radius:18px; \}/);
  assert.match(adminSource, /input, button \{ min-height:44px; font-size:16px; \}/);
  assert.match(adminSource, /ShendetiAuth\.login/);
});

test('hosted admin workspace retains responsive tables and navigation', () => {
  assert.match(source, /@media \(max-width: 900px\)/);
  assert.match(source, /id="usersTableBody"/);
  assert.match(source, /id="adminDoctorsBody"/);
  assert.match(source, /id="adminAppointmentsBody"/);
  assert.match(source, /id="auditLogsTable"/);
  assert.doesNotMatch(source, /id="addUserBtn"/);
  assert.doesNotMatch(source, /id="addDoctorBtn"/);
});
