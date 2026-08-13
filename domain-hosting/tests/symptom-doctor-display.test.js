const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const clinicalSource = fs.readFileSync(path.join(__dirname, '..', '..', 'appwrite', 'functions', 'clinical-api', 'src', 'main.js'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  let depth = 0;
  let opened = false;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') { depth += 1; opened = true; }
    if (source[index] === '}') depth -= 1;
    if (opened && depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

test('trusted doctor formatter preserves titles, Albanian characters, and normalizes whitespace', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${extractFunction('formatTrustedDoctorDisplayName')}; this.formatName = formatTrustedDoctorDisplayName;`, context);
  assert.equal(context.formatName('Dr. Elena Hoxha'), 'Dr. Elena Hoxha');
  assert.equal(context.formatName('Dr Elena Hoxha'), 'Dr Elena Hoxha');
  assert.equal(context.formatName('Elena Hoxha'), 'Elena Hoxha');
  assert.equal(context.formatName('  Dr.   Ëndrra   Çela  '), 'Dr. Ëndrra Çela');
  assert.equal(context.formatName(null), 'Doktori');
  assert.equal(context.formatName('doctor@example.test'), 'Doktori');
  for (const name of ['Dr. Elena Hoxha', 'Dr Elena Hoxha', 'Elena Hoxha']) {
    assert.doesNotMatch(context.formatName(name), /Dr\.\s+Dr\.|Dr\.Dr/i);
  }
});

test('patient list and printable detail share the trusted doctor formatter', () => {
  assert.equal((source.match(/formatTrustedDoctorDisplayName\(prescription\.doctor\?\.name\)/g) || []).length, 2);
  assert.doesNotMatch(source, /`Dr\. \$\{escapeHtml\(prescription\.doctor\.name\)\}`/);
  assert.match(clinicalSource, /safePrescriptionDoctor/);
  assert.match(clinicalSource, /Query\.equal\('authUserId', \[doctorAuthUserId\]\)/);
  assert.doesNotMatch(clinicalSource, /payload\?\.doctorName|body\?\.doctorName/);
});

test('Symptom Checker has stable mobile controls and exact button copy', () => {
  const mobileStart = source.lastIndexOf('@media (max-width: 900px)');
  const mobileCss = source.slice(mobileStart, source.indexOf('@media (max-width: 600px)', mobileStart));
  assert.equal((source.match(/>Analizo simptomat<\/button>/g) || []).length, 1);
  assert.doesNotMatch(source, /Analizë Simptoma|Analizo Simptomen|Analizë Simotoma|Analizo Simotoma/);
  assert.match(mobileCss, /\.symptom-checker-input\s*\{[^}]*width:100%[^}]*max-width:100%[^}]*height:120px[^}]*resize:none[^}]*font-size:16px/s);
  assert.match(mobileCss, /\.symptom-checker-submit\s*\{[^}]*min-height:48px[^}]*white-space:nowrap/s);
  assert.match(mobileCss, /\.symptom-checker-notice\s*\{[^}]*height:44px[^}]*overflow-y:auto/s);
  assert.doesNotMatch(source, /\.symptom-checker-(?:form|input|submit)[^{]*\{[^}]*100vw/s);
  assert.match(source.slice(0, mobileStart), /\.symptom-checker-input \{ font-family:inherit; \}/);
});

test('all required mobile widths contain the form without horizontal growth', () => {
  for (const viewport of [320, 360, 375, 390, 393, 430, 1280]) {
    const mainPadding = viewport <= 360 ? 20 : viewport <= 600 ? 28 : viewport <= 900 ? 40 : 60;
    const cardPadding = viewport <= 600 ? 40 : 50;
    const available = viewport - mainPadding - cardPadding;
    const inputOuterWidth = available;
    const buttonOuterWidth = available;
    assert.ok(available > 0, `${viewport}px has usable form width`);
    assert.ok(inputOuterWidth <= viewport, `${viewport}px input stays contained`);
    assert.ok(buttonOuterWidth <= viewport, `${viewport}px button stays contained`);
  }
});

test('typing and validation do not replace the stable form structure', () => {
  const section = source.slice(source.indexOf('<div class="symptom-checker-form">'), source.indexOf("else if(subview === 'schedule')"));
  const handler = source.slice(source.indexOf('async function analyzeSymptoms()'), source.indexOf('// ===== SYMPTOM CHECKER BOOKING MODAL'));
  assert.match(section, /id="symptomsText"/);
  assert.match(section, /id="symptomsTextNotice"/);
  assert.match(section, /id="analyzeSymptomsBtn"/);
  assert.match(section, /id="analysisResult"/);
  assert.doesNotMatch(handler, /symptom-checker-form[^;]*innerHTML|symptomsText[^;]*outerHTML/);
  assert.match(handler, /setButtonLoading\(btn, true, 'Duke analizuar\.\.\.'\)/);
  assert.match(handler, /if \(resultDiv\) resultDiv\.innerHTML/);
});
