const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const localMain = fs.readFileSync(path.join(root, 'bluecare', 'index.html'), 'utf8');
const localAdmin = fs.readFileSync(path.join(root, 'public', 'admin-login.html'), 'utf8');
const localAuthRoute = fs.readFileSync(path.join(root, 'src', 'routes', 'auth.js'), 'utf8');
const hostedMain = fs.readFileSync(path.join(root, 'domain-hosting', 'index.html'), 'utf8');
const hostedAdmin = fs.readFileSync(path.join(root, 'domain-hosting', 'admin', 'index.html'), 'utf8');
const hostedAuth = fs.readFileSync(path.join(root, 'domain-hosting', 'js', 'appwrite-auth.js'), 'utf8');
const guidance = 'Llogarite e administratorit duhet te kycen vetem ne panelin /admin.';

test('local public login blocks authenticated admins with the approved guidance', () => {
  assert.match(localAuthRoute, /!requiredRole && user\.role === 'admin'/);
  assert.ok(localAuthRoute.includes(guidance));
  assert.match(localAuthRoute, /res\.status\(403\)/);
  assert.ok(localMain.includes(guidance));
  assert.match(localMain, /\['patient', 'doctor'\]\.includes\(userRole\)/);
});

test('hosted public login and restore use the main role context', () => {
  assert.match(hostedMain, /ShendetiAuth\.login\(email, pass, 'main'\)/);
  assert.match(hostedMain, /ShendetiAuth\.restore\(adminEntryRequested \? 'admin' : 'main'\)/);
  assert.ok(hostedMain.includes(guidance));
  assert.match(hostedAuth, /accessContext === 'main'/);
  assert.match(hostedAuth, /await deleteRemoteSession\(\)/);
});

test('admin entry points validate existing sessions with trusted server context', () => {
  assert.match(hostedAdmin, /ShendetiAuth\.restore\('admin'\)/);
  assert.match(hostedAdmin, /ShendetiAuth\.login\([\s\S]*?'admin'/);
  assert.match(localAdmin, /fetch\('\/api\/auth\/me'/);
  assert.match(localAdmin, /fetch\('\/api\/auth\/admin-login'/);
  assert.match(localAdmin, /data\.user\.role === 'admin'/);
});

test('dashboard rendering does not trust URL or persisted role alone', () => {
  assert.match(localMain, /trustedLocalRole === normalizedType/);
  assert.match(localMain, /adminDashboardEntryAuthorized === true/);
  assert.match(localMain, /const authenticatedRole = String\(trustedLocalRole \|\| ''\)/);
  assert.match(hostedMain, /window\.ShendetiAuth\?\.state\?\.role/);
  assert.match(hostedMain, /adminDashboardEntryAuthorized === true/);
  assert.doesNotMatch(hostedMain, /sessionStorage\.getItem\([^)]*role/i);
});
