const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const hosted=readFileSync(path.join(__dirname,'..','index.html'),'utf8');const local=readFileSync(path.join(__dirname,'..','..','bluecare','index.html'),'utf8');
function helpers(source){const start=source.indexOf('function formatAppDate(');const end=source.indexOf('function escapeHtml(',start);const context={Intl,Date,Number};vm.createContext(context);vm.runInContext(source.slice(start,end),context);return context;}
test('local and Appwrite use identical D/M/YYYY date-only formatting without UTC shifts',()=>{for(const source of [local,hosted]){const f=helpers(source);assert.equal(f.formatAppDate('2026-08-05'),'5/8/2026');assert.equal(f.formatAppDate('2026-05-08'),'8/5/2026');assert.equal(f.formatAppDate('2028-02-29'),'29/2/2028');assert.equal(f.formatAppDate('2026-12-31'),'31/12/2026');assert.equal(f.formatAppDate('2027-01-01'),'1/1/2027');}});
test('timestamps preserve application calendar day and existing 12-hour AM/PM style',()=>{const f=helpers(hosted);assert.equal(f.formatAppDateTime('2026-08-05T13:00:00.000Z'),'5/8/2026 03:00 PM');assert.equal(f.formatAppTime('2026-08-05T07:10:00.000Z'),'09:10 AM');assert.doesNotMatch(f.formatAppDateTime('2026-08-05T13:00:00.000Z'),/15:00/);});
test('all visible local and hosted date rendering uses centralized helpers while native inputs stay ISO',()=>{for(const source of [local,hosted]){assert.doesNotMatch(source,/toLocaleDateString\(|toLocaleString\(/);assert.match(source,/type="date"/);assert.match(source,/formatAppDateTime\(appointment\.scheduledAt\)/);}});
