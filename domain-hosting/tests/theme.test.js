const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const themeSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'theme.js'), 'utf8');
const themeCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'theme.css'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');

function themeHarness({ systemDark = false, initial = {} } = {}) {
  const values = new Map(Object.entries(initial));
  const buttons = Array.from({ length: 2 }, () => ({
    dataset: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  }));
  const documentListeners = {};
  const windowListeners = {};
  const mediaListeners = {};
  let matchMediaCalls = 0;
  const document = {
    documentElement: { dataset: {}, style: {} },
    querySelectorAll(selector) { return selector === '[data-theme-toggle]' ? buttons : []; },
    addEventListener(name, handler) { documentListeners[name] = handler; }
  };
  const window = {
    document,
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    },
    matchMedia() {
      matchMediaCalls += 1;
      return { matches: systemDark, addEventListener(name, handler) { mediaListeners[name] = handler; } };
    },
    addEventListener(name, handler) { windowListeners[name] = handler; }
  };
  vm.runInNewContext(themeSource, { window, document, Set, Object, String });
  documentListeners.DOMContentLoaded?.();
  return { window, document, buttons, values, windowListeners, mediaListeners, matchMediaCalls };
}

test('first visit always initializes and stores light before paint regardless of system preference', () => {
  const dark = themeHarness({ systemDark: true });
  assert.equal(dark.window.ShendetiTheme.get(), 'light');
  assert.deepEqual(Object.fromEntries(dark.values), { 'shendeti-theme': 'light' });
  assert.equal(dark.matchMediaCalls, 0);
  assert.equal(dark.buttons[0].attributes['aria-label'], 'Aktivizo modalitetin e erret');
  assert.equal(themeHarness({ systemDark: false }).window.ShendetiTheme.get(), 'light');
});

test('theme toggle switches both directions and stores only an allowlisted value', () => {
  const harness = themeHarness();
  assert.equal(harness.window.ShendetiTheme.toggle(), 'dark');
  assert.deepEqual(Object.fromEntries(harness.values), { 'shendeti-theme': 'dark' });
  assert.equal(harness.window.ShendetiTheme.toggle(), 'light');
  assert.deepEqual(Object.fromEntries(harness.values), { 'shendeti-theme': 'light' });
});

test('selected theme persists across refresh and navigation', () => {
  const first = themeHarness();
  first.window.ShendetiTheme.set('dark');
  const refreshed = themeHarness({ initial: Object.fromEntries(first.values) });
  assert.equal(refreshed.window.ShendetiTheme.get(), 'dark');
  assert.match(appHtml, /href="\/"/);
  assert.match(adminHtml, /href="\/"/);
  assert.match(appHtml, /<script src="\/js\/theme\.js"><\/script>[\s\S]*<link rel="stylesheet" href="\/css\/theme\.css">/);
  assert.match(adminHtml, /<script src="\/js\/theme\.js"><\/script>[\s\S]*<link rel="stylesheet" href="\/css\/theme\.css">/);
});

test('missing, invalid and programmatic invalid themes self-heal to light only', () => {
  const harness = themeHarness({ systemDark: true, initial: { 'shendeti-theme': 'invalid', unrelated: 'preserved' } });
  assert.equal(harness.window.ShendetiTheme.get(), 'light');
  assert.equal(harness.values.get('shendeti-theme'), 'light');
  assert.equal(harness.values.get('unrelated'), 'preserved');
  assert.equal(harness.window.ShendetiTheme.set('invalid'), 'light');
  assert.equal(harness.values.get('shendeti-theme'), 'light');
  assert.equal(harness.matchMediaCalls, 0);
});

test('storage synchronization preserves valid choices and maps corrupt values to light', () => {
  const harness = themeHarness({ initial: { 'shendeti-theme': 'dark' } });
  assert.equal(harness.window.ShendetiTheme.get(), 'dark');
  harness.windowListeners.storage({ key: 'shendeti-theme', newValue: 'light' });
  assert.equal(harness.window.ShendetiTheme.get(), 'light');
  harness.windowListeners.storage({ key: 'shendeti-theme', newValue: 'corrupt' });
  assert.equal(harness.window.ShendetiTheme.get(), 'light');
  assert.equal(harness.values.get('shendeti-theme'), 'light');
});

test('logout and login flows do not read, clear, or replace theme selection', () => {
  const logout = appHtml.slice(appHtml.indexOf('async function logout()'), appHtml.indexOf('function getCurrentUserId'));
  const login = appHtml.slice(appHtml.indexOf('async function auth()'), appHtml.indexOf('function switchAuthTab'));
  assert.doesNotMatch(`${logout}\n${login}`, /ShendetiTheme|shendeti-theme|localStorage/);
});

test('theme storage module contains no auth, identity, booking, or clinical payload fields', () => {
  assert.match(themeSource, /const STORAGE_KEY = 'shendeti-theme'/);
  assert.match(themeSource, /new Set\(\['light', 'dark'\]\)/);
  assert.doesNotMatch(themeSource, /password|token|session|patient|doctor|profile|clinical|appointment|booking/i);
});

test('public, patient, doctor, admin, modal, table, form, status and file surfaces share global dark tokens', () => {
  assert.match(themeCss, /html\[data-theme="dark"\]/);
  assert.match(themeCss, /\.hero/);
  assert.match(themeCss, /\.app-shell/);
  assert.match(themeCss, /\.sidebar/);
  assert.match(themeCss, /\.modal-box/);
  assert.match(themeCss, /th, td/);
  assert.match(themeCss, /input, select, textarea/);
  assert.match(themeCss, /status-success/);
  assert.match(themeCss, /medicalRecordsList/);
  assert.equal((appHtml.match(/data-theme-toggle/g) || []).length, 2);
  assert.equal((adminHtml.match(/data-theme-toggle/g) || []).length, 1);
});

test('theme toggle is keyboard-accessible, labeled, responsive, and reduced-motion safe', () => {
  assert.match(appHtml, /<button class="theme-toggle" type="button"/);
  assert.match(appHtml, /aria-label="Aktivizo modalitetin e erret"/);
  assert.match(appHtml, /fa-sun/);
  assert.match(appHtml, /fa-moon/);
  assert.match(themeCss, /\.theme-toggle:focus-visible/);
  assert.match(themeCss, /@media \(max-width: 600px\)/);
  assert.match(themeCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test('public header replaces only the Emergency control and preserves doctor-theme-login order', () => {
  const header = appHtml.slice(appHtml.indexOf('<nav id="nav"'), appHtml.indexOf('</nav>'));
  assert.doesNotMatch(header, /emergency-toggle|toggle-switch|>Emergency</);
  const doctors = header.indexOf('href="#doctors"');
  const theme = header.indexOf('data-theme-toggle');
  const login = header.indexOf("toggleModal('loginModal')");
  assert.ok(doctors >= 0 && doctors < theme && theme < login);
  assert.match(appHtml, /function toggleEmergencyMode\(\)/);
});
