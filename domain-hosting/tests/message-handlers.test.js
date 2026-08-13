const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractAsyncFunction(name) {
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

function extractFunction(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function keyboardHarness(sendImpl) {
  const calls = [];
  const context = vm.createContext({
    doctorSendManualMessage: (button) => { calls.push(['doctor', button]); return sendImpl?.(button); },
    patientSendManualMessage: (button) => { calls.push(['patient', button]); return sendImpl?.(button); },
    String,
  });
  vm.runInContext(extractFunction('handleMessageComposerKeydown'), context);
  return { context, calls };
}

function keyEvent(value, overrides = {}) {
  const button = overrides.button || { disabled:false };
  const event = {
    key:'Enter', shiftKey:false, isComposing:false, keyCode:13,
    currentTarget:{ value, nextElementSibling:button },
    prevented:false,
    preventDefault() { this.prevented = true; },
    ...overrides,
  };
  return { event, button };
}

function harness(sendImpl = async () => true) {
  const calls = { payloads: [], refreshes: [], toasts: [] };
  const input = { value: '' };
  const context = vm.createContext({
    window: { doctorSelectedPatient: 'Arta Pacienti', patientSelectedDoctor: 'Dr. Mira' },
    getCurrentUserSafe: () => ({ id: 'doctor-1', _id: 'doctor-1', name: 'Dr. Mira', role: 'doctor' }),
    resolvePatientIdForDoctor: () => 'patient-1',
    resolveDoctorIdForPatient: () => 'doctor-1',
    document: { getElementById: () => input },
    sendDirectMessage: async (payload) => { calls.payloads.push(payload); return sendImpl(payload); },
    refreshView: (...args) => calls.refreshes.push(args),
    showToast: (...args) => calls.toasts.push(args),
    String,
  });
  vm.runInContext([
    extractAsyncFunction('sendDirectMessageFromUi'),
    extractAsyncFunction('doctorQuickReply'),
    extractAsyncFunction('doctorSendManualMessage'),
    extractAsyncFunction('patientQuickReply'),
    extractAsyncFunction('patientSendManualMessage'),
  ].join('\n'), context);
  return { context, calls, input };
}

function sendHarness(callImpl) {
  const calls = { requests: [], refreshes: [], indicators: [] };
  const user = { id:'patient-1', _id:'patient-1', name:'Arta', role:'patient' };
  const context = vm.createContext({
    window: { ShendetiClinical: { call: async (...args) => { calls.requests.push(args); return callImpl(...args); } } },
    getCurrentUserSafe: () => user,
    getCurrentUserId: () => user.id,
    refreshDirectMessages: async (...args) => calls.refreshes.push(args),
    setMessageSendingIndicator: (...args) => calls.indicators.push(args),
    directMessageSendInFlight: new Set(),
    crypto: { randomUUID: () => 'request-0001' },
    Response,
    String,
    Date,
    Math,
  });
  vm.runInContext(extractAsyncFunction('sendDirectMessage'), context);
  return { context, calls };
}

test('doctor quick reply sends immediately to the selected patient and restores its button', async () => {
  const { context, calls } = harness();
  const button = { disabled: false, textContent: '✅ Po, nesër', isConnected: true };
  const text = 'Po, mundeni nesër. Ju lutem zgjidhni një orar që ju përshtatet.';
  assert.equal(await context.doctorQuickReply(text, button), true);
  assert.equal(calls.payloads[0].patientId, 'patient-1');
  assert.equal(calls.payloads[0].text, text);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '✅ Po, nesër');
  assert.deepEqual(calls.refreshes[0], ['doctor', 'messages']);
});

test('manual doctor message is cleared only after a successful send', async () => {
  const success = harness();
  success.input.value = '  Përgjigje e shkruar  ';
  assert.equal(await success.context.doctorSendManualMessage(), true);
  assert.equal(success.calls.payloads[0].text, 'Përgjigje e shkruar');
  assert.equal(success.input.value, '');

  const failure = harness(async () => { throw new Error('network'); });
  failure.input.value = 'Mos e humb këtë tekst';
  assert.equal(await failure.context.doctorSendManualMessage(), false);
  assert.equal(failure.input.value, 'Mos e humb këtë tekst');
  assert.equal(failure.calls.toasts[0][0], 'error');
  assert.equal(failure.calls.refreshes.length, 0);
});

test('patient manual and quick reply handlers use the authenticated workflow', async () => {
  const { context, calls, input } = harness();
  input.value = 'Mesazh pacienti';
  assert.equal(await context.patientSendManualMessage(), true);
  assert.equal(calls.payloads[0].doctorId, 'doctor-1');
  assert.equal(calls.payloads[0].fromRole, 'patient');
  assert.equal(await context.patientQuickReply('Në rregull, faleminderit.'), true);
  assert.equal(calls.payloads[1].text, 'Në rregull, faleminderit.');
});

test('message UI exposes the three required doctor templates as immediate button actions', () => {
  assert.match(source, /doctorQuickReply\('Po, mundeni nesër\.[^']+', this\)/);
  assert.match(source, /doctorQuickReply\('Ju lutem nëse keni dhimbje të forta[^']+', this\)/);
  assert.match(source, /doctorQuickReply\('Ju lutem më dërgoni më shumë detaje:[^']+', this\)/);
});

test('message UI uses authoritative conversation peers and renders untrusted content through escaping', () => {
  assert.match(source, /directConversations = conversations/);
  assert.match(source, /getDirectConversationPeer\('doctor', patientName\)/);
  assert.match(source, /getDirectConversationPeer\('patient', doctorName\)/);
  assert.match(source, /escapeHtml\(message\?\.text \|\| ''\)/);
  assert.doesNotMatch(source, /message\?\.text\s*\|\|\s*''\}\s*<\/p>/);
});

test('message UI exposes loading, retry, unread, and mobile-safe input states', () => {
  assert.match(source, /Duke ngarkuar mesazhet/);
  assert.match(source, /retryDirectMessages\('patient'\)/);
  assert.match(source, /markDirectConversationRead\('doctor', peer\)/);
  assert.match(source, /textarea\.input \{ resize:vertical; max-width:100%; \}/);
});

test('message sender consumes the clinical client Response contract and deduplicates concurrent clicks', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { context, calls } = sendHarness(async () => pending);
  const first = context.sendDirectMessage({ doctorId:'doctor-row', text:'Përshëndetje' });
  const duplicate = await context.sendDirectMessage({ doctorId:'doctor-row', text:'Përshëndetje' });
  assert.equal(duplicate, false);
  assert.equal(calls.requests.length, 1);
  release(new Response(JSON.stringify({ ok:true }), { status:200 }));
  assert.equal(await first, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.requests[0])), ['sendMessage', { doctorId:'doctor-row', content:'Përshëndetje', clientRequestId:'request-0001' }]);
  assert.deepEqual(calls.refreshes[0], ['patient', false]);
  assert.deepEqual(calls.indicators, [['patient', true], ['patient', false]]);
});

test('message sender reports authorization failure without exposing server details', async () => {
  const { context, calls } = sendHarness(async () => new Response(JSON.stringify({ error:'private server detail' }), { status:403 }));
  await assert.rejects(context.sendDirectMessage({ doctorId:'doctor-row', text:'Test' }), /Nuk keni autorizim për këtë bisedë/);
  assert.deepEqual(calls.indicators, [['patient', true], ['patient', false]]);
});

test('three-dot indicator is local sending activity, mobile-safe, and respects reduced motion', () => {
  assert.match(source, /Duke dërguar<\/span><span class="message-sending-dots"/);
  assert.match(source, /\.message-sending-slot \{ min-height:30px;/);
  assert.match(source, /@keyframes message-dot-pulse/);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(source, /Doktori po shkruan|Pacienti po shkruan|is typing/i);
});

test('message composers use the canonical manual send for Enter and preserve Shift+Enter/IME', async () => {
  const { context, calls } = keyboardHarness();
  const patient = keyEvent('  Përshëndetje  ');
  await context.handleMessageComposerKeydown(patient.event, 'patient');
  assert.equal(patient.event.prevented, true);
  assert.deepEqual(calls, [['patient', patient.button]]);

  for (const overrides of [{ shiftKey:true }, { isComposing:true }, { keyCode:229 }]) {
    const candidate = keyEvent('Rreshti i dytë', overrides);
    assert.equal(context.handleMessageComposerKeydown(candidate.event, 'doctor'), false);
    assert.equal(candidate.event.prevented, false);
  }
  for (const value of ['', '   \n  ']) {
    const candidate = keyEvent(value);
    assert.equal(context.handleMessageComposerKeydown(candidate.event, 'doctor'), false);
    assert.equal(candidate.event.prevented, false);
  }
  assert.equal(calls.length, 1);
  assert.match(source, /id="patientReplyText"[^>]+onkeydown="handleMessageComposerKeydown\(event, 'patient'\)"/);
  assert.match(source, /id="doctorReplyText"[^>]+onkeydown="handleMessageComposerKeydown\(event, 'doctor'\)"/);
});

test('repeated Enter and button plus Enter race do not start another send', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { context, calls } = keyboardHarness((button) => {
    button.disabled = true;
    return pending.finally(() => { button.disabled = false; });
  });
  const first = keyEvent('Vetëm një herë');
  const firstSend = context.handleMessageComposerKeydown(first.event, 'patient');
  const repeated = keyEvent('Vetëm një herë', { button:first.button });
  assert.equal(context.handleMessageComposerKeydown(repeated.event, 'patient'), false);
  assert.equal(calls.length, 1);
  assert.equal(repeated.event.prevented, true);
  release(true);
  await firstSend;
  assert.equal(first.button.disabled, false);
});
