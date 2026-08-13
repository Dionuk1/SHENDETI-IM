import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AdminError, OPERATIONS, authorizeAdmin, exactRole, pageInput, plain, route } from '../src/admin.js';

const adminAccount = { $id: 'admin1', name: 'Admin', email: 'admin@example.test', labels: ['admin'], status: true, $createdAt: '2026-01-01T00:00:00.000Z' };
const adminProfile = { $id: 'profile1', authUserId: 'admin1', role: 'admin', isActive: true, name: 'Admin' };

function users(overrides = {}) {
  return {
    async get({ userId }) {
      if (overrides.get) return overrides.get(userId);
      if (userId !== 'admin1') throw Object.assign(new Error('missing'), { code: 404 });
      return adminAccount;
    },
    async list(args) { return overrides.list ? overrides.list(args) : { users: [adminAccount], total: 1 }; },
    async create(args) { if (overrides.create) return overrides.create(args); return { $id: 'created-user', ...args }; },
    async updateLabels(args) { if (overrides.updateLabels) return overrides.updateLabels(args); return args; },
    async updateName(args) { if (overrides.updateName) return overrides.updateName(args); return args; },
    async updatePassword(args) { if (overrides.updatePassword) return overrides.updatePassword(args); return args; },
    async deleteSessions(args) { if (overrides.deleteSessions) return overrides.deleteSessions(args); return {}; },
    async delete(args) { if (overrides.delete) return overrides.delete(args); return {}; }
  };
}

function tables(rows = {}) {
  const calls = [];
  return {
    calls,
    async listRows({ tableId }) { return { rows: rows[tableId] || [], total: (rows[tableId] || []).length }; },
    async getRow({ tableId, rowId }) {
      const row = (rows[tableId] || []).find((item) => item.$id === rowId);
      if (!row) throw Object.assign(new Error('missing'), { code: 404 });
      return row;
    },
    async updateRow(args) { calls.push(['update', args.tableId, args.rowId, args.data]); return args.data; },
    async createRow(args) { if (rows.failCreate === args.tableId) throw new Error('synthetic failure'); const created = { $id:args.rowId, ...args.data, $permissions:args.permissions || [] }; if (!Array.isArray(rows[args.tableId])) rows[args.tableId] = []; rows[args.tableId].push(created); calls.push(['create', args.tableId, args.data, args.rowId, args.permissions || []]); return created; },
    async deleteRow(args) { calls.push(['delete', args.tableId, args.rowId]); if (Array.isArray(rows[args.tableId])) rows[args.tableId] = rows[args.tableId].filter((item) => item.$id !== args.rowId); return {}; }
  };
}

function storage(files = []) {
  return { async listFiles() { return { files, total: files.length }; } };
}

test('operation allowlist includes narrow user deletion and appointment transitions but excludes arbitrary access', () => {
  assert.equal(OPERATIONS.has('createUser'), true);
  assert.equal(OPERATIONS.has('updateUser'), true);
  assert.equal(OPERATIONS.has('updateUserPassword'), true);
  assert.equal(OPERATIONS.has('changeUserRole'), true);
  assert.equal(OPERATIONS.has('approveAppointment'), true);
  assert.equal(OPERATIONS.has('cancelAppointment'), true);
  assert.equal(OPERATIONS.has('deleteAppointment'), false);
  assert.equal(OPERATIONS.has('deleteUser'), true);
  assert.equal(OPERATIONS.has('resetPassword'), false);
  assert.equal(OPERATIONS.has('queryTable'), false);
});

test('the existing admin can atomically change patient and doctor roles with profile consistency and audit', async () => {
  let labels = ['patient'];
  const accountUsers = users({
    get: (userId) => userId === 'patient1' ? { $id:userId, email:'patient@example.test', labels } : adminAccount,
    updateLabels: ({ labels: next }) => { labels = next; }
  });
  const records = { profiles:[{ $id:'p1', authUserId:'patient1', name:'Synthetic Patient', email:'patient@example.test', role:'patient', isActive:true }], doctor_profiles:[], audit_logs:[] };
  const db = tables(records);
  const originalUpdate = db.updateRow;
  db.updateRow = async (args) => { const row = records[args.tableId].find((item) => item.$id === args.rowId); Object.assign(row, args.data); return originalUpdate(args); };
  const admin = { userId:'admin1', role:'admin' };
  const promoted = await route(accountUsers, db, admin, { operation:'changeUserRole', userId:'patient1', newRole:'doctor', confirmed:true, specialization:'general', experienceYears:4 });
  assert.equal(promoted.user.role, 'doctor'); assert.deepEqual(labels, ['doctor']); assert.equal(records.profiles[0].role, 'doctor'); assert.equal(records.doctor_profiles[0].isActive, true);
  const demoted = await route(accountUsers, db, admin, { operation:'changeUserRole', userId:'patient1', newRole:'patient', confirmed:true });
  assert.equal(demoted.user.role, 'patient'); assert.equal(records.doctor_profiles[0].isActive, false); assert.equal(records.audit_logs.length, 2);
  assert.equal(db.calls.some((call) => call[0] === 'delete'), false);
  for (const role of ['patient', 'doctor', null]) await assert.rejects(route(accountUsers, db, { userId:`${role || 'anonymous'}1`, role }, { operation:'changeUserRole', userId:'patient1', newRole:'doctor', confirmed:true, specialization:'general', experienceYears:4 }), (error) => error.status === 403);
  await assert.rejects(route(accountUsers, db, admin, { operation:'changeUserRole', userId:'admin1', newRole:'patient', confirmed:true }), (error) => error.status === 403);
});

test('admin is the only administrative label and role changes require complete doctor data', async () => {
  const source = readFileSync(new URL('../src/admin.js', import.meta.url), 'utf8');
  assert.equal(source.toLowerCase().includes('super' + 'admin'), false);
  assert.deepEqual(exactRole(['admin']), 'admin');
  assert.throws(() => exactRole(['admin', 'patient']), (error) => error.status === 403);
  const accountUsers = users({ get:() => ({ $id:'patient1', email:'patient@example.test', labels:['patient'] }) });
  const db = tables({ profiles:[{ $id:'p1', authUserId:'patient1', name:'Patient', email:'patient@example.test', role:'patient', isActive:true }], doctor_profiles:[] });
  await assert.rejects(route(accountUsers, db, { userId:'admin1', role:'admin' }, { operation:'changeUserRole', userId:'patient1', newRole:'doctor', confirmed:true }), (error) => error.category === 'invalid_input');
  assert.equal(db.calls.some((call) => ['update','create','delete'].includes(call[0])), false);
});

test('confirmed patient delete removes one profile then Auth and verifies no orphan', async () => {
  let deleted = false; const deletes = [];
  const accountUsers = users({
    get: (userId) => { if (userId === 'patient1' && !deleted) return { $id:userId, labels:['patient'], status:true }; throw Object.assign(new Error('missing'), { code:404 }); },
    delete: ({ userId }) => { deleted = true; deletes.push(userId); return {}; }
  });
  const db = tables({ profiles:[{ $id:'patient-profile', authUserId:'patient1', role:'patient', isActive:true }], doctor_profiles:[], appointments:[], prescriptions:[], medical_records:[], notifications:[], audit_logs:[] });
  const result = await route(accountUsers, db, { userId:'admin1', role:'admin' }, { operation:'deleteUser', userId:'patient1', confirmed:true }, storage());
  assert.deepEqual(result, { deleted:true, role:'patient' });
  assert.deepEqual(db.calls.filter((call) => call[0] === 'delete'), [['delete','profiles','patient-profile']]);
  assert.deepEqual(deletes, ['patient1']);
});

test('confirmed doctor delete removes doctor profile before profile and Auth', async () => {
  let deleted = false; const deletes = [];
  const accountUsers = users({
    get: (userId) => { if (userId === 'doctor1' && !deleted) return { $id:userId, labels:['doctor'], status:true }; throw Object.assign(new Error('missing'), { code:404 }); },
    delete: ({ userId }) => { deleted = true; deletes.push(userId); return {}; }
  });
  const db = tables({ profiles:[{ $id:'doctor-profile', authUserId:'doctor1', role:'doctor', isActive:true }], doctor_profiles:[{ $id:'doctor-row', authUserId:'doctor1', isActive:true }], appointments:[], prescriptions:[], medical_records:[], notifications:[], audit_logs:[] });
  await route(accountUsers, db, { userId:'admin1', role:'admin' }, { operation:'deleteUser', userId:'doctor1', confirmed:true }, storage());
  assert.deepEqual(db.calls.filter((call) => call[0] === 'delete'), [['delete','doctor_profiles','doctor-row'],['delete','profiles','doctor-profile']]);
  assert.deepEqual(deletes, ['doctor1']);
});

test('user delete rejects self, admin, broken linkage, protected data, missing confirmation and retry', async () => {
  const auth = { userId:'admin1', role:'admin' };
  await assert.rejects(route(users(), tables(), auth, { operation:'deleteUser', userId:'admin1', confirmed:true }, storage()), (error) => error.status === 403);
  await assert.rejects(route(users({ get:() => adminAccount }), tables({ profiles:[adminProfile] }), auth, { operation:'deleteUser', userId:'admin2', confirmed:true }, storage()), (error) => error.status === 403);
  await assert.rejects(route(users({ get:() => ({ $id:'patient1', labels:['patient'] }) }), tables({ profiles:[] }), auth, { operation:'deleteUser', userId:'patient1', confirmed:true }, storage()), (error) => error.category === 'linkage_error');
  await assert.rejects(route(users({ get:() => ({ $id:'patient1', labels:['patient'] }) }), tables({ profiles:[{ $id:'p1', authUserId:'patient1', role:'patient' }], doctor_profiles:[], appointments:[{ $id:'a1', patientAuthUserId:'patient1' }], prescriptions:[], medical_records:[], notifications:[], audit_logs:[] }), auth, { operation:'deleteUser', userId:'patient1', confirmed:true }, storage()), (error) => error.category === 'protected_references');
  await assert.rejects(route(users({ get:() => ({ $id:'patient1', labels:['patient'] }) }), tables(), auth, { operation:'deleteUser', userId:'patient1', confirmed:false }, storage()), (error) => error.category === 'confirmation_required');
  await assert.rejects(route(users({ get:() => { throw Object.assign(new Error('missing'), { code:404 }); } }), tables(), auth, { operation:'deleteUser', userId:'patient1', confirmed:true }, storage()), (error) => error.category === 'not_found');
});

test('user delete blocks imported identities and owned medical files without cascading', async () => {
  const auth = { userId:'admin1', role:'admin' }; const accountUsers = users({ get:() => ({ $id:'patient1', labels:['patient'] }) });
  const importedDb = tables({ profiles:[{ $id:'p1', authUserId:'patient1', role:'patient', legacyMongoId:'legacy' }], doctor_profiles:[], appointments:[], prescriptions:[], medical_records:[], notifications:[], audit_logs:[] });
  await assert.rejects(route(accountUsers, importedDb, auth, { operation:'deleteUser', userId:'patient1', confirmed:true }, storage()), (error) => error.category === 'protected_references');
  const fileDb = tables({ profiles:[{ $id:'p1', authUserId:'patient1', role:'patient' }], doctor_profiles:[], appointments:[], prescriptions:[], medical_records:[], notifications:[], audit_logs:[] });
  await assert.rejects(route(accountUsers, fileDb, auth, { operation:'deleteUser', userId:'patient1', confirmed:true }, storage([{ $id:'file1', $permissions:['read("user:patient1")'] }])), (error) => error.category === 'protected_references');
  assert.equal(fileDb.calls.some((call) => call[0] === 'delete'), false);
});

test('admin appointment approval and cancellation enforce transitions without deleting records', async () => {
  const pending = { $id:'appointment-1', status:'pending', patientAuthUserId:'patient1', doctorProfileId:'doctor-1' };
  const confirmed = { ...pending, $id:'appointment-2', status:'confirmed' };
  const db = tables({ appointments:[pending, confirmed], audit_logs:[] });
  const auth = { userId:'admin1', role:'admin' };
  assert.deepEqual(await route(users(), db, auth, { operation:'approveAppointment', appointmentId:'appointment-1' }), { appointment:{ id:'appointment-1', status:'confirmed' } });
  const cancelled = await route(users(), db, auth, { operation:'cancelAppointment', appointmentId:'appointment-2', reason:'Synthetic reason' });
  assert.equal(cancelled.appointment.status, 'cancelled');
  assert.deepEqual(db.calls.find((call) => call[0] === 'update' && call[2] === 'appointment-1')[3], { status:'confirmed' });
  const cancelUpdate = db.calls.find((call) => call[0] === 'update' && call[2] === 'appointment-2')[3];
  assert.equal(cancelUpdate.status, 'cancelled'); assert.equal(cancelUpdate.activeSlotKey, null); assert.equal(cancelUpdate.cancelledByRole, 'admin');
  assert.equal(db.calls.some((call) => call[0] === 'delete' && call[1] === 'appointments'), false);
});

test('admin appointment actions reject invalid ids, missing rows and final-state transitions', async () => {
  const auth = { userId:'admin1', role:'admin' };
  await assert.rejects(route(users(), tables(), auth, { operation:'approveAppointment', appointmentId:'bad id' }), (error) => error.status === 400);
  await assert.rejects(route(users(), tables({ appointments:[] }), auth, { operation:'approveAppointment', appointmentId:'missing' }), (error) => error.status === 404);
  for (const status of ['confirmed','cancelled','completed']) {
    const db = tables({ appointments:[{ $id:`row-${status}`, status }] });
    await assert.rejects(route(users(), db, auth, { operation:'approveAppointment', appointmentId:`row-${status}` }), (error) => error.status === 409);
  }
  for (const status of ['cancelled','completed']) {
    const db = tables({ appointments:[{ $id:`row-${status}`, status }] });
    await assert.rejects(route(users(), db, auth, { operation:'cancelAppointment', appointmentId:`row-${status}` }), (error) => error.status === 409);
  }
});

test('create patient assigns one label, creates one profile and never returns the password', async () => {
  const calls = []; const accountUsers = users({ list: () => ({ users: [], total: 0 }), create: (args) => { calls.push(['create', args]); return { $id: 'new-patient' }; }, updateLabels: (args) => calls.push(['labels', args]) });
  const db = tables({ profiles: [] });
  const result = await route(accountUsers, db, { userId: 'admin1', role: 'admin' }, { operation: 'createUser', name: 'Synthetic Patient', email: 'TEST@EXAMPLE.COM', password: 'Strong!Pass123', role: 'patient' });
  assert.deepEqual(calls[1], ['labels', { userId: 'new-patient', labels: ['patient'] }]);
  assert.equal(db.calls.filter((call) => call[0] === 'create' && call[1] === 'profiles').length, 1);
  const profileCreate = db.calls.find((call) => call[0] === 'create' && call[1] === 'profiles');
  assert.equal(profileCreate[3], 'new-patient');
  assert.equal(profileCreate[4].some((permission) => permission.includes('read') && permission.includes('new-patient')), true);
  assert.equal(profileCreate[4].some((permission) => permission.includes('update')), false);
  assert.equal(JSON.stringify(result).includes('Strong!Pass123'), false);
  assert.equal(result.user.email, 'test@example.com');
});

test('create doctor validates role and fields and rolls back all resources on doctor row failure', async () => {
  const deleted = []; const accountUsers = users({ list: () => ({ users: [], total: 0 }), create: () => ({ $id: 'new-doctor' }), delete: ({ userId }) => deleted.push(userId) });
  const db = tables({ profiles: [], failCreate: 'doctor_profiles' });
  await assert.rejects(route(accountUsers, db, { userId: 'admin1', role: 'admin' }, { operation: 'createUser', name: 'Synthetic Doctor', email: 'doctor@example.test', password: 'Strong!Pass123', role: 'doctor', specialization: 'general', experienceYears: 5 }));
  assert.deepEqual(deleted, ['new-doctor']);
  assert.equal(db.calls.some((call) => call[0] === 'delete' && call[1] === 'profiles'), true);
  await assert.rejects(route(accountUsers, db, { userId: 'admin1' }, { operation: 'createUser', name: 'Bad', email: 'bad@example.test', password: 'Strong!Pass123', role: 'admin' }), AdminError);
});

test('DEV admin create-user accepts simple passwords for normal patient and doctor targets', async () => {
  for (const fixture of [
    { name:'Normal Patient', email:'patient@example.com', password:'pacient1234', role:'patient' },
    { name:'Normal Doctor', email:'doctor1@example.com', password:'doktor1234', role:'doctor', specialization:'general', experienceYears:4 },
    { name:'Normal Doctor', email:'doctor2@example.com', password:'doktor12345', role:'doctor', specialization:'general', experienceYears:4 }
  ]) {
    let receivedLength = 0;
    const accountUsers = users({ list: () => ({ users:[], total:0 }), create: (args) => { receivedLength = args.password.length; return { $id:'created-user' }; } });
    const result = await route(accountUsers, tables({ profiles:[], doctor_profiles:[] }), { userId:'admin1', role:'admin' }, { operation:'createUser', ...fixture });
    assert.equal(result.user.role, fixture.role); assert.equal(receivedLength, fixture.password.length); assert.equal(JSON.stringify(result).includes(fixture.password), false);
  }
  for (const password of ['short12','onlyletters','123456789']) {
    await assert.rejects(route(users({ list:() => ({ users:[], total:0 }) }), tables(), { userId:'admin1', role:'admin' }, { operation:'createUser', name:'Normal Patient', email:'patient@example.com', password, role:'patient' }), AdminError);
  }
});

test('doctor create returns success only after one readable profile and one readable doctor linkage exist', async () => {
  const accountUsers = users({ list:() => ({ users:[], total:0 }), create:() => ({ $id:'doctor-created' }) });
  const db = tables({ profiles:[], doctor_profiles:[] });
  await route(accountUsers, db, { userId:'admin1', role:'admin' }, { operation:'createUser', name:'Doctor Fixture', email:'fixture@example.test', password:'doktor1234', role:'doctor', specialization:'general', experienceYears:3 });
  assert.equal(db.calls.filter((call) => call[0] === 'create' && call[1] === 'profiles').length, 1);
  assert.equal(db.calls.filter((call) => call[0] === 'create' && call[1] === 'doctor_profiles').length, 1);
  for (const call of db.calls.filter((item) => item[0] === 'create' && ['profiles','doctor_profiles'].includes(item[1]))) {
    assert.equal(call[4].some((permission) => permission.includes('read') && permission.includes('doctor-created')), true);
    assert.equal(call[4].some((permission) => permission.includes('update')), false);
  }
});

test('duplicate email, weak password, invalid email, role spoofing and unexpected fields are rejected', async () => {
  const auth = { userId: 'admin1' };
  await assert.rejects(route(users({ list: () => ({ users: [adminAccount], total: 1 }) }), tables(), auth, { operation: 'createUser', name: 'Test', email: 'used@example.test', password: 'Strong!Pass123', role: 'patient' }), (error) => error.status === 409);
  for (const input of [
    { name: 'Test', email: 'bad', password: 'Strong!Pass123', role: 'patient' },
    { name: 'Test', email: 'new@example.test', password: 'weakpass', role: 'patient' },
    { name: 'Test', email: 'new@example.test', password: 'Strong!Pass123', role: 'admin' },
    { name: 'Test', email: 'new@example.test', password: 'Strong!Pass123', role: 'patient', authUserId: 'spoof' }
  ]) await assert.rejects(route(users({ list: () => ({ users: [], total: 0 }) }), tables(), auth, { operation: 'createUser', ...input }), AdminError);
});

test('safe edit keeps role and email immutable and rejects admin targets', async () => {
  const patient = { $id: 'patient-profile', authUserId: 'patient1', role: 'patient', isActive: true, name: 'Old', email: 'patient@example.test' };
  const accountUsers = users({ get: (id) => id === 'patient1' ? { $id: id, labels: ['patient'], status: true, name: 'Old', email: 'patient@example.test' } : adminAccount });
  const db = tables({ profiles: [patient] });
  const result = await route(accountUsers, db, { userId: 'admin1' }, { operation: 'updateUser', userId: 'patient1', name: 'New Name' });
  assert.equal(result.user.name, 'New Name'); assert.equal(result.user.role, 'patient'); assert.equal(result.user.email, 'patient@example.test');
  await assert.rejects(route(accountUsers, db, { userId: 'admin1' }, { operation: 'updateUser', userId: 'patient1', role: 'doctor' }), AdminError);
  await assert.rejects(route(users(), tables({ profiles: [adminProfile] }), { userId: 'admin1' }, { operation: 'updateUser', userId: 'admin1', name: 'Changed' }), (error) => error.status === 403);
});

test('password update accepts only patient/doctor, enforces strength, invalidates target sessions and sanitizes output', async () => {
  const calls = []; const patient = { $id:'patient-profile', authUserId:'patient1', role:'patient', isActive:true, name:'Patient' };
  const accountUsers = users({ get: (id) => id === 'patient1' ? { $id:id, labels:['patient'], status:true } : adminAccount,
    updatePassword: (args) => calls.push(['password', args.userId]), deleteSessions: (args) => calls.push(['sessions', args.userId]) });
  const db = tables({ profiles:[patient] });
  const result = await route(accountUsers, db, { userId:'admin1', role:'admin' }, { operation:'updateUserPassword', userId:'patient1', newPassword:'Strong!Pass1', confirmPassword:'Strong!Pass1' });
  assert.deepEqual(calls, [['password','patient1'], ['sessions','patient1']]);
  assert.deepEqual(result, { passwordUpdated:true, sessionsInvalidated:true, mode:'dev_admin' });
  assert.equal(JSON.stringify(result).includes('Strong!Pass1'), false);
  for (const input of [
    { userId:'patient1', newPassword:'weakpass', confirmPassword:'weakpass' },
    { userId:'patient1', newPassword:'Strong!Pass1', confirmPassword:'Different!1' },
    { userId:'patient1', newPassword:' Strong!Pass1', confirmPassword:' Strong!Pass1' },
    { userId:'patient1', newPassword:'Strong!Pass1', confirmPassword:'Strong!Pass1', role:'admin' }
  ]) await assert.rejects(route(accountUsers, db, { userId:'admin1' }, { operation:'updateUserPassword', ...input }), AdminError);
});

test('DEV admin password operation accepts simple passwords for normal patient and doctor targets only', async () => {
  const changed = []; const patient = { $id:'patient-p', authUserId:'patient1', role:'patient', isActive:true, name:'Normal Patient', legacyMongoId:'0123456789abcdef01234567' };
  const doctor = { $id:'doctor-p', authUserId:'doctor1', role:'doctor', isActive:true, name:'Normal Doctor', legacyMongoId:'1123456789abcdef01234567' };
  const doctorRow = { $id:'doctor-row', authUserId:'doctor1' };
  const accountUsers = users({
    get: (id) => ({
      patient1: { $id:id, labels:['patient'], email:'patient@example.com', name:'Normal Patient' },
      doctor1: { $id:id, labels:['doctor'], email:'doctor@example.com', name:'Normal Doctor' },
      admin2: { $id:id, labels:['admin'], email:'admin2@example.com', name:'Admin' }
    })[id],
    updatePassword: ({ userId }) => changed.push(['password', userId]), deleteSessions: ({ userId }) => changed.push(['sessions', userId])
  });
  for (const [userId, newPassword] of [['patient1','pacient1234'], ['doctor1','doktor1234'], ['doctor1','doktor12345']]) {
    const profile = userId === 'patient1' ? patient : doctor;
    const db = tables({ profiles:[profile], doctor_profiles:userId === 'doctor1' ? [doctorRow] : [] });
    const result = await route(accountUsers, db, { userId:'admin1', role:'admin' }, { operation:'updateUserPassword', userId, newPassword, confirmPassword:newPassword });
    assert.equal(result.mode, 'dev_admin');
  }
  assert.deepEqual(changed, [['password','patient1'],['sessions','patient1'],['password','doctor1'],['sessions','doctor1'],['password','doctor1'],['sessions','doctor1']]);
  for (const input of [
    { userId:'patient1', newPassword:'short12', confirmPassword:'short12' },
    { userId:'patient1', newPassword:'onlyletters', confirmPassword:'onlyletters' },
    { userId:'patient1', newPassword:'123456789', confirmPassword:'123456789' },
    { userId:'admin2', newPassword:'admin1234', confirmPassword:'admin1234' }
  ]) {
    const profile = input.userId === 'patient1' ? patient : { ...adminProfile, authUserId:'admin2' };
    await assert.rejects(route(accountUsers, tables({ profiles:[profile] }), { userId:'admin1', role:'admin' }, { operation:'updateUserPassword', ...input }), AdminError);
  }
});

test('password update rejects admin/self targets before mutation', async () => {
  let changed = false; const accountUsers = users({ updatePassword: () => { changed = true; } });
  await assert.rejects(route(accountUsers, tables({ profiles:[adminProfile] }), { userId:'admin1' }, { operation:'updateUserPassword', userId:'admin1', newPassword:'Strong!Pass1', confirmPassword:'Strong!Pass1' }), (error) => error.status === 403);
  assert.equal(changed, false);
});

test('strict role authorization allows one admin and rejects all other label states', async () => {
  const db = tables({ profiles: [adminProfile] });
  assert.equal((await authorizeAdmin(users(), db, 'admin1')).role, 'admin');
  for (const labels of [[], ['patient'], ['doctor'], ['admin', 'patient'], ['admin', 'admin']]) {
    await assert.rejects(authorizeAdmin(users({ get: () => ({ ...adminAccount, labels }) }), db, 'admin1'), AdminError);
  }
  await assert.rejects(authorizeAdmin(users(), db, ''), (error) => error.status === 401);
});

test('request helpers reject arrays, prototype pollution, oversized pagination and unknown fields', async () => {
  assert.throws(() => plain([]), AdminError);
  assert.throws(() => plain(Object.create(null)), AdminError);
  assert.throws(() => pageInput({ limit: 51 }), AdminError);
  await assert.rejects(route(users(), tables(), { userId: 'admin1' }, { operation: 'health', role: 'admin' }), AdminError);
});

test('safe user list is paginated and exposes no session, hash or secret fields', async () => {
  const db = tables({ profiles: [adminProfile] });
  const result = await route(users(), db, { userId: 'admin1' }, { operation: 'listUsers', page: 1, limit: 10 });
  assert.equal(result.pagination.total, 1);
  assert.deepEqual(Object.keys(result.users[0]).sort(), ['accountActive','createdAt','email','id','isActive','name','profileActive','profileLinked','role'].sort());
  assert.equal(JSON.stringify(result).match(/password|hash|session|token|secret/i), null);
});

test('profile status mutation changes only isActive and creates sanitized audit event', async () => {
  const patient = { $id: 'patient-profile', authUserId: 'patient1', role: 'patient', isActive: true, name: 'Synthetic' };
  const db = tables({ profiles: [patient] });
  const accountUsers = users({ get: (id) => ({ ...adminAccount, $id: id, labels: id === 'patient1' ? ['patient'] : ['admin'] }) });
  await route(accountUsers, db, { userId: 'admin1', role: 'admin' }, { operation: 'setProfileActive', userId: 'patient1', isActive: false });
  assert.deepEqual(db.calls[0], ['update', 'profiles', 'patient-profile', { isActive: false }]);
  const audit = db.calls.find((call) => call[0] === 'create');
  assert.equal(audit[1], 'audit_logs');
  assert.equal(audit[2].resourceId, 'patient-profile');
  assert.equal(JSON.stringify(audit).match(/Synthetic|example\.test|token|password/i), null);
});

test('doctor output is operational-only and mutation preserves linkage', async () => {
  const doctor = { $id: 'doctor-row', authUserId: 'doctor1', name: 'Synthetic Doctor', specialization: 'Kardiologji', department: 'Kardiologji', experienceYears: 4, isActive: true, weekdayStart: '08:00', weekdayEnd: '16:00' };
  const profile = { $id: 'doctor-profile', authUserId: 'doctor1', role: 'doctor', isActive: true };
  const db = tables({ doctor_profiles: [doctor], profiles: [profile] });
  const accountUsers = users({ get: (id) => ({ ...adminAccount, $id: id, labels: id === 'doctor1' ? ['doctor'] : ['admin'] }) });
  const listed = await route(accountUsers, db, { userId: 'admin1' }, { operation: 'listDoctors', page: 1, limit: 10 });
  assert.equal(listed.doctors[0].linkage.valid, true);
  assert.equal(JSON.stringify(listed).match(/license|email|authUserId|service|bio/i), null);
  await route(accountUsers, db, { userId: 'admin1', role: 'admin' }, { operation: 'setDoctorActive', doctorId: 'doctor-row', isActive: false });
  assert.equal(db.calls.filter((call) => call[0] === 'update').length, 2);
});

test('appointments, notifications, clinical metadata and audit output omit protected content', async () => {
  const db = tables({
    profiles: [{ $id: 'p1', authUserId: 'patient1', name: 'Patient', role: 'patient', isActive: true }],
    doctor_profiles: [{ $id: 'd1', name: 'Doctor' }],
    appointments: [{ $id: 'a1', patientAuthUserId: 'patient1', doctorProfileId: 'd1', service: 'Konsultim', scheduledAt: '2026-08-01T09:00:00.000Z', durationMinutes: 30, status: 'confirmed', notesEncrypted: 'ciphertext', cancellationReason: 'private' }],
    prescriptions: [{ $id: 'rx', encryptedBody: 'ciphertext' }],
    medical_records: [{ $id: 'mr', notesEncrypted: 'ciphertext', storageFileId: 'file' }],
    notifications: [{ $id: 'n1', userAuthUserId: 'patient1', type: 'appointment', resourceType: 'appointment', message: 'private text', read: false, $createdAt: '2026-01-01T00:00:00.000Z' }],
    audit_logs: [{ $id: 'l1', userAuthUserId: 'patient1', role: 'admin', action: 'safe.action', resourceType: 'profile', resourceId: 'secret-id', status: 'success', metadataSanitized: 'ciphertext', timestampLegacy: '2026-01-01T00:00:00.000Z' }]
  });
  const auth = { userId: 'admin1' };
  const outputs = [
    await route(users(), db, auth, { operation: 'listAppointments' }),
    await route(users(), db, auth, { operation: 'getClinicalMetadataCounts' }),
    await route(users(), db, auth, { operation: 'listNotifications' }),
    await route(users(), db, auth, { operation: 'listAuditLogs' })
  ];
  const serialized = JSON.stringify(outputs);
  assert.equal(outputs[0].appointments[0].id, 'a1');
  for (const forbidden of ['ciphertext', 'private text', 'secret-id', 'storageFileId', 'notesEncrypted', 'patientAuthUserId']) assert.equal(serialized.includes(forbidden), false);
});

test('analytics contains aggregate counts only', async () => {
  const db = tables({ profiles: [adminProfile], doctor_profiles: [], appointments: [], prescriptions: [], medical_records: [], notifications: [], audit_logs: [] });
  const result = await route(users(), db, { userId: 'admin1' }, { operation: 'getAnalytics' });
  assert.equal(result.analytics.users.byRole.admin, 1);
  assert.equal(JSON.stringify(result).includes('admin@example.test'), false);
});
