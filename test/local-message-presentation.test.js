const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const localHtmlPath = path.join(__dirname, '..', 'bluecare', 'index.html');
const localHtml = fs.readFileSync(localHtmlPath, 'utf8');

function extractFunction(name) {
    const start = localHtml.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist in the LOCAL source`);
    const bodyStart = localHtml.indexOf('{', start);
    let depth = 0;
    let quote = '';
    let templateExpressionDepth = 0;
    let escaped = false;

    for (let index = bodyStart; index < localHtml.length; index += 1) {
        const char = localHtml[index];
        const next = localHtml[index + 1];

        if (escaped) {
            escaped = false;
            continue;
        }
        if (quote) {
            if (char === '\\') {
                escaped = true;
            } else if (quote === '`' && char === '$' && next === '{') {
                templateExpressionDepth += 1;
                depth += 1;
                index += 1;
            } else if (quote === '`' && char === '}' && templateExpressionDepth > 0) {
                templateExpressionDepth -= 1;
                depth -= 1;
            } else if (char === quote && templateExpressionDepth === 0) {
                quote = '';
            }
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            continue;
        }
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return localHtml.slice(start, index + 1);
        }
    }
    throw new Error(`Could not extract ${name}`);
}

function extractAsyncFunction(name) {
    return `async ${extractFunction(name)}`;
}

function createStorage(seed = {}) {
    const values = new Map(Object.entries(seed));
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        snapshot(key) { return values.get(key); },
    };
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

test('LOCAL Messages keeps existing localStorage history and chronological order after refresh', () => {
    const legacy = [
        { id: 2, at: '2026-08-12T11:00:00.000Z', doctorId: 'd1', doctorName: 'Dr. Test', patientName: 'Pacient Test', fromRole: 'doctor', text: 'E dyta' },
        { id: 1, at: '2026-08-11T10:00:00.000Z', doctorId: 'd1', doctorName: 'Dr. Test', patientName: 'Pacient Test', fromRole: 'patient', text: 'E para' },
    ];
    const localStorage = createStorage({ directMessages: JSON.stringify(legacy) });
    const context = vm.createContext({ localStorage, Date, Array, JSON, String });
    vm.runInContext(`
        let directMessages = [];
        ${extractFunction('normalizePersonName')}
        ${extractFunction('loadDirectMessagesFromStorage')}
        ${extractFunction('persistDirectMessagesToStorage')}
        ${extractFunction('sendDirectMessage')}
        ${extractFunction('getConversationMessages')}
        loadDirectMessagesFromStorage();
        sendDirectMessage({ fromRole:'patient', doctorId:'d1', doctorName:'Dr. Test', patientName:'Pacient Test', text:'E treta' });
        globalThis.beforeRefresh = getConversationMessages('d1', 'Dr. Test', 'Pacient Test').map((message) => message.text);
        directMessages = [];
        loadDirectMessagesFromStorage();
        globalThis.afterRefresh = getConversationMessages('d1', 'Dr. Test', 'Pacient Test').map((message) => message.text);
    `, context);

    assert.deepEqual(Array.from(context.beforeRefresh), ['E para', 'E dyta', 'E treta']);
    assert.deepEqual(Array.from(context.afterRefresh), ['E para', 'E dyta', 'E treta']);
    assert.equal(JSON.parse(localStorage.snapshot('directMessages')).length, 3);
});

test('LOCAL Messages renders local-day separators, 12-hour time, and escaped message text', () => {
    const context = vm.createContext({ Date, Intl, Number, Array, String });
    vm.runInContext(`
        function escapeHtml(value) {
            return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        ${extractFunction('getMessageLocalDateKey')}
        ${extractFunction('formatMessageTime')}
        ${extractFunction('formatMessageDateLabel')}
        ${extractFunction('renderConversationMessages')}
    `, context);

    const now = new Date(2026, 0, 1, 9, 0);
    assert.equal(context.formatMessageDateLabel(new Date(2026, 0, 1, 0, 1), now), 'Sot');
    assert.equal(context.formatMessageDateLabel(new Date(2026, 0, 1, 0, 30).toISOString(), now), 'Sot', 'UTC serialization must not move a local-midnight message to yesterday');
    assert.equal(context.formatMessageDateLabel(new Date(2025, 11, 31, 23, 59), now), 'Dje');
    assert.equal(context.formatMessageDateLabel(new Date(2025, 10, 30, 12, 0), now), '30/11/2025');
    assert.match(context.formatMessageTime(new Date(2026, 0, 1, 20, 34)), /^8:34 PM$/);
    assert.equal(context.formatMessageTime('not-a-date'), '');
    assert.equal(context.formatMessageTime(null), '');
    assert.equal(context.formatMessageDateLabel(null, now), '');

    const html = context.renderConversationMessages([
        { at: new Date(2025, 11, 31, 8, 15).toISOString(), fromRole: 'doctor', text: '<img src=x onerror=alert(1)>' },
        { at: new Date(2025, 11, 31, 9, 30).toISOString(), fromRole: 'patient', text: 'Përgjigje' },
        { at: new Date(2026, 0, 1, 20, 34).toISOString(), fromRole: 'doctor', text: 'Mesazh sot' },
        { at: 'legacy-invalid-date', fromRole: 'patient', text: 'Mesazh i vjetër' },
        { at: null, fromRole: 'doctor', text: 'Mesazh pa datë' },
    ], 'patient', now);

    assert.equal((html.match(/>Dje</g) || []).length, 1, 'same-day messages share one separator');
    assert.equal((html.match(/>Sot</g) || []).length, 1);
    assert.match(html, /8:34 PM/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /Mesazh i vjetër/);
    assert.match(html, /Mesazh pa datë/);
    assert.doesNotMatch(html, /1\/1\/1970/);
    assert.equal((html.match(/legacy-invalid-date/g) || []).length, 0, 'invalid legacy dates add no fabricated time');
});

test('LOCAL sending state blocks duplicate in-flight sends and clears on success or failure', async () => {
    let resolveSend;
    let sendCalls = 0;
    const indicators = [];
    const refreshes = [];
    const errors = [];
    const button = { disabled: false, isConnected: true };
    const input = { value: 'Përshëndetje' };
    const context = vm.createContext({
        Promise,
        Set,
        normalizePersonName: (value) => String(value || '').toLowerCase(),
        setMessageSendingIndicator: (role, visible) => indicators.push([role, visible]),
        sendDirectMessage: () => {
            sendCalls += 1;
            return new Promise((resolve) => { resolveSend = resolve; });
        },
        refreshView: (...args) => refreshes.push(args),
        showToast: (...args) => errors.push(args),
    });
    vm.runInContext(`const directMessageSendsInFlight = new Set(); ${extractAsyncFunction('sendDirectMessageFromUi')}`, context);

    const payload = { doctorName: 'Dr. Test', patientName: 'Pacient Test', text: 'Përshëndetje' };
    const first = context.sendDirectMessageFromUi(payload, 'patient', button, input);
    const duplicate = await context.sendDirectMessageFromUi(payload, 'patient', button, input);
    assert.equal(duplicate, false);
    assert.equal(sendCalls, 1);
    assert.equal(button.disabled, true);
    resolveSend(true);
    assert.equal(await first, true);
    assert.equal(button.disabled, false);
    assert.equal(input.value, '');
    assert.deepEqual(indicators, [['patient', true], ['patient', false]]);
    assert.deepEqual(refreshes, [['patient', 'messages']]);

    context.sendDirectMessage = () => Promise.reject(new Error('storage failure'));
    const failed = await context.sendDirectMessageFromUi(payload, 'patient', button, input);
    assert.equal(failed, false);
    assert.deepEqual(indicators.slice(-2), [['patient', true], ['patient', false]]);
    assert.equal(errors.length, 1);
});

test('LOCAL sending indicator keeps only its visual removal pending for 300 ms', () => {
    let now = 1000;
    let nextTimerId = 0;
    const scheduled = new Map();
    const indicators = {
        patient: { hidden:true },
        doctor: { hidden:true },
    };
    const context = vm.createContext({
        Date: { now: () => now },
        Number,
        Map,
        document: { getElementById: (id) => indicators[id.startsWith('patient') ? 'patient' : 'doctor'] },
        setTimeout: (callback, delay) => {
            const id = ++nextTimerId;
            scheduled.set(id, { callback, delay });
            return id;
        },
        clearTimeout: (id) => scheduled.delete(id),
    });
    vm.runInContext(`
        const LOCAL_MESSAGE_SENDING_INDICATOR_MIN_MS = 300;
        const messageSendingIndicatorVisibleUntil = { patient: 0, doctor: 0 };
        const messageSendingIndicatorHideTimers = new Map();
        ${extractFunction('messageSendingIndicatorMarkup')}
        ${extractFunction('hideMessageSendingIndicatorAfterMinimum')}
        ${extractFunction('setMessageSendingIndicator')}
    `, context);

    assert.match(context.messageSendingIndicatorMarkup('patient'), / hidden>/);
    context.setMessageSendingIndicator('patient', true);
    assert.equal(indicators.patient.hidden, false);
    assert.doesNotMatch(context.messageSendingIndicatorMarkup('patient'), / hidden>/, 'a refreshed conversation keeps the indicator visible');

    context.setMessageSendingIndicator('patient', false);
    assert.equal(indicators.patient.hidden, false, 'visual removal is the only deferred operation');
    assert.equal([...scheduled.values()][0].delay, 300);

    now = 1300;
    [...scheduled.values()][0].callback();
    assert.equal(indicators.patient.hidden, true);
    assert.match(context.messageSendingIndicatorMarkup('patient'), / hidden>/);
});

test('LOCAL persistence and conversation refresh finish before the visual timer', async () => {
    const events = [];
    let hideIndicator;
    const context = vm.createContext({
        Promise,
        Set,
        normalizePersonName: (value) => String(value || '').toLowerCase(),
        setMessageSendingIndicator: (role, visible) => {
            events.push(visible ? 'indicator-visible' : 'visual-hide-scheduled');
            if (!visible) hideIndicator = () => events.push('indicator-hidden');
        },
        sendDirectMessage: () => { events.push('localStorage-persisted'); return true; },
        refreshView: () => events.push('conversation-rendered'),
        showToast: () => events.push('error'),
    });
    vm.runInContext(`const directMessageSendsInFlight = new Set(); ${extractAsyncFunction('sendDirectMessageFromUi')}`, context);

    const result = context.sendDirectMessageFromUi({ doctorName:'Dr. Test', patientName:'Pacient Test', text:'Test' }, 'patient', null, null);
    assert.deepEqual(events, ['indicator-visible', 'localStorage-persisted'], 'persistence is synchronous and immediate');
    assert.equal(await result, true);
    assert.deepEqual(events, ['indicator-visible', 'localStorage-persisted', 'conversation-rendered', 'visual-hide-scheduled']);
    hideIndicator();
    assert.equal(events.at(-1), 'indicator-hidden');
});

test('LOCAL Messages source contains responsive/reduced-motion UI and no backend/schema changes', () => {
    assert.match(localHtml, /Duke dërguar/);
    assert.match(localHtml, /prefers-reduced-motion:\s*reduce/);
    assert.match(localHtml, /@media \(max-width: 600px\)[\s\S]*?\.message-conversation/);
    assert.match(localHtml, /localStorage\.getItem\('directMessages'\)/);
    assert.match(localHtml, /localStorage\.setItem\('directMessages'/);
    assert.doesNotMatch(localHtml, /localStorage\.removeItem\('directMessages'\)/);
    assert.doesNotMatch(localHtml, /Mbyll bisedën/i);
    assert.doesNotMatch(localHtml, /toISOString\(\)[^\n]*message-date/i);
    assert.match(localHtml, /LOCAL_MESSAGE_SENDING_INDICATOR_MIN_MS = 300/);
    assert.doesNotMatch(localHtml, /setTimeout\([^\n]*sendDirectMessage|setTimeout\([^\n]*persistDirectMessagesToStorage/);
});

test('LOCAL message composers send once on Enter and preserve Shift+Enter, empty input, and IME', async () => {
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
    assert.match(localHtml, /id="patientReplyText"[^>]+onkeydown="handleMessageComposerKeydown\(event, 'patient'\)"/);
    assert.match(localHtml, /id="doctorReplyText"[^>]+onkeydown="handleMessageComposerKeydown\(event, 'doctor'\)"/);
});

test('LOCAL repeated Enter and button plus Enter race are ignored while sending', async () => {
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
