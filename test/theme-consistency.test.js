const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const localHtml = fs.readFileSync(path.join(root, 'bluecare', 'index.html'), 'utf8');
const hostedHtml = fs.readFileSync(path.join(root, 'domain-hosting', 'index.html'), 'utf8');
const localAdmin = fs.readFileSync(path.join(root, 'public', 'admin-login.html'), 'utf8');
const hostedAdmin = fs.readFileSync(path.join(root, 'domain-hosting', 'admin', 'index.html'), 'utf8');
const localTheme = fs.readFileSync(path.join(root, 'public', 'js', 'theme.js'), 'utf8');
const hostedTheme = fs.readFileSync(path.join(root, 'domain-hosting', 'js', 'theme.js'), 'utf8');
const localCss = fs.readFileSync(path.join(root, 'public', 'css', 'theme.css'), 'utf8');
const hostedCss = fs.readFileSync(path.join(root, 'domain-hosting', 'css', 'theme.css'), 'utf8');

function publicHeader(html) { return html.slice(html.indexOf('<nav id="nav"'), html.indexOf('</nav>')); }

test('local and hosted headers remove Emergency and use doctor-theme-login order', () => {
  for (const html of [localHtml, hostedHtml]) {
    const header = publicHeader(html);
    assert.doesNotMatch(header, /emergency-toggle|toggle-switch|>Emergency</);
    const doctors = header.indexOf('href="#doctors"');
    const theme = header.indexOf('data-theme-toggle');
    const login = header.indexOf("toggleModal('loginModal')");
    assert.ok(doctors >= 0 && doctors < theme && theme < login);
    assert.match(header, /theme-toggle-sun[\s\S]*fa-sun/);
    assert.match(header, /theme-toggle-moon[\s\S]*fa-moon/);
    assert.match(html, /function toggleEmergencyMode\(\)/);
  }
});

test('local and hosted frontends initialize the same allowlisted persistent theme before styles', () => {
  assert.equal(localTheme.replace(/\s+/g, ''), hostedTheme.replace(/\s+/g, ''));
  for (const html of [localHtml, hostedHtml, localAdmin, hostedAdmin]) {
    const scriptPosition = html.indexOf('<script src="/js/theme.js"></script>');
    const stylePosition = html.indexOf('<link rel="stylesheet" href="/css/theme.css">');
    assert.ok(scriptPosition >= 0 && scriptPosition < stylePosition);
    assert.doesNotMatch(html, /<html[^>]+data-theme="dark"|<body[^>]+class="[^"]*\bdark\b/i);
  }
  assert.match(localTheme, /new Set\(\['light', 'dark'\]\)/);
  assert.doesNotMatch(localTheme, /prefers-color-scheme|matchMedia|systemTheme|systemPreference/);
  assert.match(localTheme, /setItem\(STORAGE_KEY, 'light'\)/);
  assert.match(localTheme, /ALLOWED_THEMES\.has\(theme\) \? theme : 'light'/);
  assert.doesNotMatch(localTheme, /password|token|session|patient|doctor|profile|clinical|appointment|booking/i);
});

test('local and hosted theme styles cover the same global surfaces and responsive toggle', () => {
  for (const css of [localCss, hostedCss]) {
    assert.match(css, /html\[data-theme="dark"\]/);
    assert.match(css, /\.hero/);
    assert.match(css, /\.app-shell/);
    assert.match(css, /\.sidebar/);
    assert.match(css, /\.modal-box/);
    assert.match(css, /th[, ]+td/);
    assert.match(css, /input[, ]*select[, ]*textarea/);
    assert.match(css, /@media \(max-width:\s*900px\)/);
    assert.match(css, /@media \(max-width:\s*600px\)/);
    assert.match(css, /prefers-reduced-motion/);
  }
});

test('local dashboard and admin login keep an accessible synchronized theme control', () => {
  assert.equal((localHtml.match(/data-theme-toggle/g) || []).length, 2);
  assert.equal((localAdmin.match(/data-theme-toggle/g) || []).length, 1);
  assert.match(localHtml, /aria-label="Aktivizo modalitetin e erret"/);
  assert.match(localAdmin, /aria-label="Aktivizo modalitetin e erret"/);
});
