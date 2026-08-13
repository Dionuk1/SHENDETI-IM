import test from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../src/main.js';

function matches(row, query) {
  const q = JSON.parse(query);
  if (q.method === 'equal') return q.values.includes(row[q.attribute]);
  if (q.method === 'isNull') return row[q.attribute] == null;
  if (q.method === 'or') return q.values.some((item) => matches(row, JSON.stringify(item)));
  return true;
}

function db(seed) {
  const data = structuredClone(seed); let sequence = 0;
  return {
    data,
    async getRow({ tableId, rowId }) { const row = (data[tableId] || []).find((item) => item.$id === rowId); if (!row) throw Object.assign(new Error('missing'), { code:404 }); return row; },
    async listRows({ tableId, queries = [] }) {
      const filters = queries.filter((q) => ['equal','isNull','or'].includes(JSON.parse(q).method));
      let rows = (data[tableId] || []).filter((row) => filters.every((q) => matches(row, q)));
      if (queries.some((q) => JSON.parse(q).method === 'orderDesc')) rows = rows.slice().reverse();
      const limitQuery = queries.map((q) => JSON.parse(q)).find((q) => q.method === 'limit');
      if (limitQuery) rows = rows.slice(0, Number(limitQuery.values?.[0]) || rows.length);
      return { rows, total: rows.length };
    },
    async createRow({ tableId, rowId, data: value, permissions }) {
      if ((data[tableId] || []).some((row) => row.senderAuthUserId === value.senderAuthUserId && row.clientRequestId === value.clientRequestId)) throw Object.assign(new Error('duplicate'), { code:409 });
      sequence += 1;
      const row = { $id:rowId || `m${sequence}`, $createdAt:`2026-08-09T10:00:0${sequence}.000Z`, ...value, $permissions:permissions }; (data[tableId] ||= []).push(row); return row;
    },
    async updateRow({ tableId, rowId, data: value }) { const row = data[tableId].find((item) => item.$id === rowId); Object.assign(row, value); return row; }
  };
}

const seed = {
  profiles:[
    { $id:'patient1', authUserId:'patient1', role:'patient', isActive:true, name:'Patient One' },
    { $id:'patient2', authUserId:'patient2', role:'patient', isActive:true, name:'Patient Two' }
  ],
  doctor_profiles:[{ $id:'doctor-row', authUserId:'doctor1', isActive:true, name:'Doctor One' }],
  appointments:[{ $id:'a1', patientAuthUserId:'patient1', doctorProfileId:'doctor-row' }], messages:[]
};

test('message persists, reloads for both participants, blocks spoofing/IDOR, deduplicates and preserves read state', async () => {
  const tables = db(seed); const patient = { userId:'patient1', role:'patient' }; const doctor = { userId:'doctor1', role:'doctor', doctor:seed.doctor_profiles[0] };
  const input = { operation:'sendMessage', doctorId:'doctor-row', content:'<script>alert(1)</script> Ë ç', clientRequestId:'request-0001' };
  const sent = await route(tables, null, patient, input);
  assert.equal(sent.message.fromRole, 'patient'); assert.equal(sent.message.text, input.content); assert.equal(tables.data.messages.length, 1);
  assert.equal('senderAuthUserId' in sent.message, false); assert.equal('receiverAuthUserId' in sent.message, false);
  assert.equal(tables.data.messages[0].senderAuthUserId, 'patient1');
  assert.equal(tables.data.messages[0].$permissions.some((permission) => permission.startsWith('update(')), false);
  const patientReload = await route(tables, null, patient, { operation:'listConversationMessages', doctorId:'doctor-row' });
  const doctorReload = await route(tables, null, doctor, { operation:'listConversationMessages', patientId:'patient1' });
  assert.equal(patientReload.messages.length, 1); assert.equal(doctorReload.messages.length, 1); assert.equal(doctorReload.messages[0].fromRole, 'patient');
  const reply = await route(tables, null, doctor, { operation:'sendMessage', patientId:'patient1', content:'Përgjigje e doktorit', clientRequestId:'request-0002' });
  assert.equal(reply.message.fromRole, 'doctor'); assert.equal(tables.data.messages.length, 2);
  const reloadedReply = await route(tables, null, patient, { operation:'listConversationMessages', doctorId:'doctor-row' });
  assert.deepEqual(reloadedReply.messages.map((message) => message.fromRole), ['patient', 'doctor']);
  await assert.rejects(route(tables, null, patient, { ...input, senderAuthUserId:'doctor1', clientRequestId:'request-0002' }), (error) => error.status === 400);
  await assert.rejects(route(tables, null, { userId:'patient2', role:'patient' }, { operation:'listConversationMessages', doctorId:'doctor-row' }), (error) => error.status === 404);
  await assert.rejects(route(tables, null, patient, input), (error) => error.status === 409);
  await assert.rejects(route(tables, null, patient, { ...input, content:'   ', clientRequestId:'request-empty' }), (error) => error.status === 400);
  await assert.rejects(route(tables, null, { userId:'doctor2', role:'doctor', doctor:{ $id:'unrelated-doctor' } }, { operation:'listConversationMessages', patientId:'patient1' }), (error) => error.status === 404);
  const marked = await route(tables, null, doctor, { operation:'markConversationRead', patientId:'patient1' });
  assert.equal(marked.updated, 1); assert.ok(tables.data.messages[0].readAt);
});

test('conversation list includes appointment-authorized peers before the first message', async () => {
  const tables = db(seed);
  const patient = await route(tables, null, { userId:'patient1', role:'patient' }, { operation:'listMyConversations' });
  const doctor = await route(tables, null, { userId:'doctor1', role:'doctor', doctor:seed.doctor_profiles[0] }, { operation:'listMyConversations' });
  assert.deepEqual(patient.conversations, [{ doctorId:'doctor-row', name:'Doctor One', role:'doctor' }]);
  assert.deepEqual(doctor.conversations, [{ id:'patient1', name:'Patient One', role:'patient' }]);
});

test('message history limit keeps the newest persisted messages and returns them chronologically', async () => {
  const seeded = structuredClone(seed);
  seeded.messages = [1, 2, 3].map((number) => ({
    $id:`m${number}`, $createdAt:`2026-08-09T10:00:0${number}.000Z`, senderAuthUserId:'patient1', receiverAuthUserId:'doctor1',
    conversationKey:'doctor1:patient1', content:`message-${number}`, readAt:null, clientRequestId:`seed-${number}`
  }));
  const result = await route(db(seeded), null, { userId:'patient1', role:'patient' }, { operation:'listConversationMessages', doctorId:'doctor-row', limit:2 });
  assert.deepEqual(result.messages.map((message) => message.text), ['message-2', 'message-3']);
});
