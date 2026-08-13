const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

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

function presentationHarness() {
  const context = vm.createContext({ Date, Intl, String, Array, Number });
  vm.runInContext([
    extractFunction('messageLocalDateKey'),
    extractFunction('formatMessageTime'),
    extractFunction('formatMessageDateLabel'),
  ].join('\n'), context);
  return context;
}

test('message dates use Sot, Dje, and the existing D/M/YYYY convention', () => {
  const context = presentationHarness();
  const now = new Date(2026, 7, 13, 20, 34);
  assert.equal(context.formatMessageDateLabel(new Date(2026, 7, 13, 8, 20), now), 'Sot');
  assert.equal(context.formatMessageDateLabel(new Date(2026, 7, 12, 23, 59), now), 'Dje');
  assert.equal(context.formatMessageDateLabel(new Date(2026, 7, 10, 16, 31), now), '10/8/2026');
});

test('message date grouping remains correct across month, year, and local-midnight boundaries', () => {
  const context = presentationHarness();
  assert.equal(context.formatMessageDateLabel(new Date(2026, 6, 31, 23, 59), new Date(2026, 7, 1, 0, 1)), 'Dje');
  assert.equal(context.formatMessageDateLabel(new Date(2025, 11, 31, 23, 59), new Date(2026, 0, 1, 0, 1)), 'Dje');
  assert.equal(context.formatMessageDateLabel(new Date(2025, 10, 30, 12, 0), new Date(2026, 0, 1, 12, 0)), '30/11/2025');
});

test('message grouping uses local calendar parts instead of UTC date slicing', () => {
  const context = presentationHarness();
  const localInstant = new Date(2026, 2, 29, 0, 15);
  assert.equal(context.messageLocalDateKey(localInstant), `${localInstant.getFullYear()}-${String(localInstant.getMonth() + 1).padStart(2, '0')}-${String(localInstant.getDate()).padStart(2, '0')}`);
  assert.doesNotMatch(extractFunction('messageLocalDateKey'), /toISOString|UTC/);
});

test('refreshing presentation produces identical labels and message time stays time-only', () => {
  const context = presentationHarness();
  const now = new Date(2026, 7, 13, 22, 0);
  const message = new Date(2026, 7, 13, 20, 34);
  assert.equal(context.formatMessageDateLabel(message, now), context.formatMessageDateLabel(message, now));
  assert.match(context.formatMessageTime(message), /^\d{1,2}:\d{2}\s(?:AM|PM)$/);
  assert.doesNotMatch(context.formatMessageTime(message), /\//);
});

test('date separators are emitted only when the local calendar date changes', () => {
  assert.match(source, /dateKey && dateKey !== previousDateKey/);
  assert.match(source, /previousDateKey = dateKey/);
  assert.match(source, /renderConversationMessages\(convo, 'patient'\)/);
  assert.match(source, /renderConversationMessages\(convo, 'doctor'\)/);
});
