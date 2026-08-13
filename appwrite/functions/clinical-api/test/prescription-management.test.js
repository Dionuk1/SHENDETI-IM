import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptMedical, decryptMedical } from '../src/medical.js';
import { route } from '../src/main.js';

process.env.MEDICAL_AES_KEY = '55'.repeat(32);

function fixture() {
  const rows = new Map([['rx-one', { $id:'rx-one', $createdAt:'2026-08-05T13:00:00.000Z', patientAuthUserId:'patient-one', doctorAuthUserId:'doctor-one', appointmentId:'appointment-one', title:'Recept digjital', status:'active', encryptionVersion:1, encryptedBody:encryptMedical({ diagnosis:'D', medicationName:'M', dosage:'1', frequency:'daily', duration:'7 days', instructions:'after meal', additionalNotes:'' }) }]]);
  const calls=[]; const tables={
    async listRows({tableId}){if(tableId==='prescriptions')return{rows:[...rows.values()],total:rows.size};if(tableId==='profiles')return{rows:[{$id:'patient-profile',authUserId:'patient-one',role:'patient',isActive:true,name:'Patient One'}],total:1};return{rows:[],total:0};},
    async getRow({rowId}){if(!rows.has(rowId)){const error=new Error('missing');error.code=404;throw error;}return rows.get(rowId);},
    async updateRow({rowId,data}){calls.push(['update',rowId,Object.keys(data)]);const updated={...rows.get(rowId),...data};rows.set(rowId,updated);return updated;},
    async deleteRow({rowId}){calls.push(['delete',rowId]);rows.delete(rowId);},
    async createRow({tableId,data}){if(tableId==='audit_logs')calls.push(['audit',data.action,data.resourceId]);return{$id:'audit'};}
  };return{tables,rows,calls};
}
const doctor={userId:'doctor-one',role:'doctor',doctor:{$id:'doctor-profile',isActive:true}};
const content={diagnosis:'Updated',medicationName:'Medicine',dosage:'2',frequency:'twice daily',duration:'5 days',instructions:'with water',additionalNotes:'safe'};

test('doctor lists, edits, and archives only owned prescriptions with safe audit metadata',async()=>{const state=fixture();const listed=await route(state.tables,{},doctor,{operation:'listDoctorPrescriptions'},()=>{});assert.equal(listed.prescriptions[0].patient.name,'Patient One');assert.equal(listed.prescriptions[0].content.medicationName,'M');const updated=await route(state.tables,{},doctor,{operation:'updateDoctorPrescription',prescriptionId:'rx-one',...content},()=>{});assert.equal(updated.prescription.content.medicationName,'Medicine');assert.equal(JSON.parse(decryptMedical(state.rows.get('rx-one').encryptedBody)).dosage,'2');const deleted=await route(state.tables,{},doctor,{operation:'deleteDoctorPrescription',prescriptionId:'rx-one'},()=>{});assert.deepEqual(deleted,{ok:true,prescriptionId:'rx-one',status:'cancelled'});assert.equal(state.rows.get('rx-one').status,'cancelled');assert.deepEqual(state.calls.filter((call)=>call[0]==='audit').map((call)=>call[1]),['prescription.edit','prescription.archive']);});
test('patient, unrelated doctor, spoofed identity, and invalid payload are rejected',async()=>{const state=fixture();await assert.rejects(()=>route(state.tables,{}, {userId:'patient-one',role:'patient'}, {operation:'updateDoctorPrescription',prescriptionId:'rx-one',...content}),/not allowed/i);await assert.rejects(()=>route(state.tables,{}, {...doctor,userId:'doctor-two'}, {operation:'deleteDoctorPrescription',prescriptionId:'rx-one'},()=>{}),/not found/i);await assert.rejects(()=>route(state.tables,{},doctor,{operation:'updateDoctorPrescription',prescriptionId:'rx-one',doctorAuthUserId:'doctor-one',...content},()=>{}),/Unexpected request field/i);await assert.rejects(()=>route(state.tables,{},doctor,{operation:'updateDoctorPrescription',prescriptionId:'rx-one',...content,dosage:''},()=>{}));});

test('patient prescription list resolves only the linked active doctor display name',async()=>{
  const encryptedBody=encryptMedical(content);const calls=[];
  const tables={async listRows({tableId,queries}){calls.push([tableId,JSON.stringify(queries)]);if(tableId==='prescriptions')return JSON.stringify(queries).includes('patient-one')?{rows:[{$id:'rx-one',$createdAt:'2026-07-29T13:00:00.000Z',patientAuthUserId:'patient-one',doctorAuthUserId:'doctor-one',title:'Recept digjital',status:'active',encryptedBody}],total:1}:{rows:[],total:0};if(tableId==='doctor_profiles')return{rows:[{$id:'doctor-profile',authUserId:'doctor-one',name:'Blerim Musliu',email:'private@example.test',phone:'private',isActive:true}],total:1};return{rows:[],total:0};}};
  const result=await route(tables,{}, {userId:'patient-one',role:'patient'}, {operation:'listMyPrescriptions'},()=>{});
  assert.equal(result.prescriptions[0].doctor.name,'Blerim Musliu');assert.equal(result.prescriptions[0].content.medicationName,'Medicine');assert.deepEqual(Object.keys(result.prescriptions[0].doctor),['name']);assert.doesNotMatch(JSON.stringify(result),/private@example|phone|doctor-one/);assert.ok(calls.find(([table,query])=>table==='prescriptions'&&query.includes('patient-one')));
  const other=await route(tables,{}, {userId:'patient-two',role:'patient'}, {operation:'listMyPrescriptions'},()=>{});assert.deepEqual(other.prescriptions,[]);
});

test('missing or inactive doctor linkage returns a controlled null doctor',async()=>{const encryptedBody=encryptMedical(content);const tables={async listRows({tableId}){if(tableId==='prescriptions')return{rows:[{$id:'rx-two',$createdAt:'2026-07-29T13:00:00.000Z',patientAuthUserId:'patient-one',doctorAuthUserId:'missing-doctor',title:'Recept digjital',status:'active',encryptedBody}]};if(tableId==='doctor_profiles')return{rows:[]};return{rows:[]};}};const result=await route(tables,{}, {userId:'patient-one',role:'patient'}, {operation:'listMyPrescriptions'},()=>{});assert.equal(result.prescriptions[0].doctor,null);});
