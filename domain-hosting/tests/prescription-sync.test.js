const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const hosted = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const local = fs.readFileSync(path.join(__dirname,'..','..','bluecare','index.html'),'utf8');

function harness(source) {
  const start=source.indexOf('let patientPrescriptionRequestId');const end=source.indexOf('function ensurePrescriptionDetailsModal',start);
  const formatterStart=source.indexOf('function formatTrustedDoctorDisplayName');const formatterEnd=source.indexOf('\n        }',formatterStart)+10;
  let user={id:'patient-one',role:'patient'};const host={innerHTML:'',isConnected:true};const requests=[];const listeners={};
  class Channel{addEventListener(type,fn){this.fn=fn;}postMessage(data){this.last=data;}}
  const context={BroadcastChannel:Channel,Event:class{constructor(type){this.type=type;}},window:{addEventListener(type,fn){listeners[type]=fn;},dispatchEvent(event){listeners[event.type]?.(event);}},document:{getElementById(id){return id==='prescriptionsList'?host:null;}},getCurrentUserSafe(){return user;},localStorage:{getItem(key){return key==='user'?JSON.stringify({_id:user.id,role:user.role}):null;}},fetch(){return new Promise((resolve)=>requests.push(resolve));},escapeHtml:String,formatAppDate(){return'29/7/2026';},prescriptionStatusLabel(){return'Aktiv';},Response,console};
  vm.createContext(context);vm.runInContext(`${source.slice(formatterStart,formatterEnd)}\n${source.slice(start,end)}`,context);return{context,host,requests,setUser(next){user=next;}};
}
function response(name,medicine='Medicine'){return{ok:true,async json(){return{prescriptions:[{id:'rx',title:'Recept digjital',referenceNumber:'RX-1',issuedAt:'2026-07-29T13:00:00Z',status:'active',doctor:name?{name}:null,content:{medicationName:medicine}}]};}};}

test('stale patient response cannot overwrite a newer account prescription list',async()=>{const h=harness(hosted);const first=h.context.loadPrescriptions();h.setUser({id:'patient-two',role:'patient'});const second=h.context.loadPrescriptions();h.requests[1](response('Doctor Two','New Medicine'));await second;h.requests[0](response('Doctor One','Stale Medicine'));await first;assert.match(h.host.innerHTML,/Doctor Two/);assert.match(h.host.innerHTML,/New Medicine/);assert.doesNotMatch(h.host.innerHTML,/Stale Medicine|Doctor One/);});
test('logout clearing invalidates requests and removes prior patient content',async()=>{const h=harness(hosted);const pending=h.context.loadPrescriptions();h.context.clearPatientPrescriptionState();h.setUser({id:'',role:''});h.requests[0](response('Old Doctor'));await pending;assert.equal(h.host.innerHTML,'');});
test('successful edit refresh signal performs a focused patient refetch',async()=>{const h=harness(hosted);const initial=h.context.loadPrescriptions();h.requests[0](response('Blerim Musliu','Old Medicine'));await initial;assert.match(h.host.innerHTML,/Old Medicine/);h.context.notifyPrescriptionUpdated();assert.equal(h.requests.length,2);h.requests[1](response('Blerim Musliu','Updated Medicine'));await new Promise((resolve)=>setImmediate(resolve));assert.match(h.host.innerHTML,/Updated Medicine/);assert.doesNotMatch(h.host.innerHTML,/Old Medicine/);});
test('trusted name and controlled missing-link fallback match each frontend rule',()=>{assert.match(local,/prescription\.doctor\?\.name \? `Dr\. \$\{escapeHtml\(prescription\.doctor\.name\)\}` : 'Doktori nuk është i disponueshëm'/);assert.match(hosted,/escapeHtml\(formatTrustedDoctorDisplayName\(prescription\.doctor\?\.name\)\)/);for(const source of [local,hosted]){assert.doesNotMatch(source,/Dr\. \$\{escapeHtml\(prescription\.doctor\?\.name \|\| '—'\)\}/);assert.match(source,/formatAppDate\(prescription\.issuedAt \|\| prescription\.createdAt\)/);assert.match(source,/notifyPrescriptionUpdated\(\)/);assert.match(source,/doctorPrescriptionMutationInFlight/);}});
test('patient response is owner scoped and local doctor name comes from populated linkage',()=>{const patientRoute=fs.readFileSync(path.join(__dirname,'..','..','src','routes','patient.js'),'utf8');assert.match(patientRoute,/Prescription\.find\(\{ patientId: req\.user\._id \}\)/);assert.match(patientRoute,/populate\('doctorId', 'name email'\)/);assert.match(patientRoute,/doctorName && !doctorName\.includes\('@'\) \? \{ name: doctorName \} : null/);assert.doesNotMatch(patientRoute,/req\.body.*doctorName/);});
