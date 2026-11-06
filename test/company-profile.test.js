import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {openDatabase} from '../lib/database.js';import {reanalyze} from '../lib/auto-facts.js';import {profileState,validateProfile,saveProfile,primaryFacts,effectiveReview} from '../lib/company-profile.js';import {completedProfile} from '../scripts/fixtures/profile.js';
function setup(t){const directory=mkdtempSync(join(tmpdir(),'assistant-profile-')),db=openDatabase(directory);db.prepare('INSERT INTO users VALUES(1,?,?)').run('test','unused');db.prepare('INSERT INTO companies VALUES(?,?,?)').run('company',1,'EXAMPLE GOODS LTD');t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});return db;}
function note(db,id,text){db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(id,'company',id,JSON.stringify([{page:1,text}]),'note');reanalyze(db,'company');}
function publish(db,values){const state=profileState(db,'company');return saveProfile(db,'company',{values,signature:state.sourceSignature,revision:state.updatedAt,confirmed:true});}
test('profile requires website and core fields; incomplete data cannot be saved',t=>{const db=setup(t),state=profileState(db,'company');assert.ok(state.errors.website);assert.ok(state.errors.contact_first_name);assert.equal(effectiveReview(db,'company').approved,false);assert.throws(()=>publish(db,{}),e=>e.status===422&&Boolean(e.fieldErrors.website));assert.equal(db.prepare('SELECT count(*) AS n FROM company_profiles').get().n,0);assert.throws(()=>publish(db,completedProfile({}, {website:''})),e=>e.status===422&&Boolean(e.fieldErrors.website));});
test('address and tax/VAT requirements are conditional and never fabricate identifiers',()=>{let result=validateProfile(completedProfile());assert.deepEqual(result.errors,{});assert.equal(result.values.operating_address_line1,result.values.registered_address_line1);result=validateProfile(completedProfile({}, {operating_address_mode:'different'}));assert.ok(result.errors.operating_address_line1);assert.ok(result.errors.operating_country);result=validateProfile(completedProfile({}, {vat_status:'registered',vat_number:''}));assert.ok(result.errors.vat_number);result=validateProfile(completedProfile({}, {tax_status:'not_issued',tax_note:''}));assert.ok(result.errors.tax_note);result=validateProfile(completedProfile({}, {vat_status:'not_registered',vat_number:'GB123456789',tax_status:'not_issued',tax_note:'Application pending'}));assert.equal(result.values.vat_number,'');assert.equal(result.values.tax_number,'');});
test('profile validates URL, dates and country; per-registration contacts are not master fields',()=>{const result=validateProfile(completedProfile({}, {website:'javascript:alert(1)',company_email:'bad',company_phone:'123',incorporated_on:'2025-02-31',country:'not a country'}));for(const key of ['website','incorporated_on','country'])assert.ok(result.errors[key],key);});
test('documents prefill a draft; operator sheet overrides raw facts without rewriting documents',t=>{const db=setup(t);note(db,'registry','Company name: EXAMPLE GOODS LTD\nCompany number: 12345678\nWebsite: https://example.com');const state=profileState(db,'company');assert.equal(state.values.company_number,'12345678');assert.equal(state.saved,false);const saved=publish(db,completedProfile(state.values,{company_number:'87654321'}));assert.equal(saved.approved,true);assert.ok(saved.comparisons.company_number.some(c=>c.different));const facts=db.prepare('SELECT facts.*,documents.filename FROM facts JOIN documents ON documents.id=facts.document_id WHERE facts.company_id=?').all('company');const primary=primaryFacts(db,'company',facts);assert.equal(primary.find(f=>f.key==='company_number').value,'87654321');assert.equal(facts.find(f=>f.key==='company_number').value,'12345678');assert.equal(primary.some(f=>['company_email','company_phone','phone_national'].includes(f.key)),false);assert.match(primary.find(f=>f.key==='company_number').filename,/Анкета компании/);});
test('new documents invalidate approval, preserve saved values and require renewed review',t=>{const db=setup(t);publish(db,completedProfile());const before=effectiveReview(db,'company');note(db,'new-doc','Company number: 12345678\nCompany email: extra@example.com');const state=profileState(db,'company');assert.equal(state.stale,true);assert.equal(state.approved,false);assert.equal(state.values.company_email,undefined);assert.equal(state.values.company_number,'12345678');assert.notEqual(effectiveReview(db,'company').signature,before.signature);publish(db,state.values);assert.equal(effectiveReview(db,'company').approved,true);});
test('confirmation and concurrent edit protections are enforced without accepting stale forms',t=>{const db=setup(t),initial=profileState(db,'company');assert.throws(()=>saveProfile(db,'company',{values:completedProfile(),signature:initial.sourceSignature,confirmed:false}),e=>e.status===400);publish(db,completedProfile());assert.throws(()=>saveProfile(db,'company',{values:completedProfile(),signature:initial.sourceSignature,revision:initial.updatedAt,confirmed:true}),e=>e.status===409);const state=profileState(db,'company');note(db,'changed','Additional document text');assert.throws(()=>saveProfile(db,'company',{values:completedProfile(),signature:state.sourceSignature,revision:state.updatedAt,confirmed:true}),e=>e.status===409);});

test('registry fields take draft priority and personal proof is kept apart from registered office',async t=>{
 const db=setup(t);const {positionedPdf,registryPages,personalBillPages}=await import('../scripts/fixtures/positioned-pdf.js');const {extractDocument}=await import('../lib/extraction.js');
 const registry=await extractDocument(positionedPdf(registryPages),'registry.pdf'),bill=await extractDocument(positionedPdf(personalBillPages),'bill.pdf');
 for(const [id,pages] of [['registry',registry],['bill',bill]])db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(id,'company',id+'.pdf',JSON.stringify(pages),'extracted');
 db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('notebook','company','notebook.txt',JSON.stringify([{page:1,text:'Company name: EXAMPLE GOODS LTD\nRegistered office city: SAMPLE VILLAGE'}]),'note');
 db.prepare('INSERT INTO extracted_fields VALUES(?,?,?,?,?,?,?,?,?,?)').run('old-local-city','company','city','SAMPLE VILLAGE','registry',2,'SAMPLE VILLAGE','Old address parser','auto',1);
 reanalyze(db,'company');const state=profileState(db,'company');assert.equal(state.values.company_number,'01234567');assert.equal(state.values.registered_address_line1,'EXAMPLE HOUSE 1 SAMPLE STREET');assert.equal(state.values.city,'BRISTOL');assert.equal(state.values.postal_code,'BS1 1AA');assert.equal(state.values.registered_country,'United Kingdom');assert.equal(state.values.contact_address_line1,'Sample iela 12-3');assert.equal(state.values.contact_city,'Riga');assert.equal(state.values.contact_country,'Latvia');assert.equal(state.directorCheck.firstName,'Alice');assert.equal(state.sources.registered_address_line1.page,2);assert.equal(state.sources.contact_address_line1.documentId,'bill');assert.equal(db.prepare('SELECT id FROM extracted_fields WHERE id=?').get('old-local-city'),undefined);assert.ok(state.comparisons.city.some(c=>c.value==='SAMPLE VILLAGE'));
});
test('email and phone are not master-sheet fields, even when a legacy stored sheet contains them',t=>{const db=setup(t),values=completedProfile();const state=publish(db,values);assert.equal(state.schema.some(field=>['company_email','company_phone'].includes(field.key)),false);assert.equal(state.values.company_email,undefined);assert.equal(state.values.company_phone,undefined);});
test('profile automatically selects the document majority and preserves alternatives and operator changes',t=>{
 const db=setup(t);
 note(db,'a','Business description: Retail goods\nAccount purpose:\nReceive retail payments');
 note(db,'b','Business description: Retail goods\nSource: another independent document');
 note(db,'c','Business description: Wholesale goods');
 let state=profileState(db,'company');assert.equal(state.values.business_description,'Retail goods');assert.equal(state.recommendations.business_description.votes,2);assert.equal(state.comparisons.business_description.length,3);assert.equal(state.values.account_purpose,'Receive retail payments');
 publish(db,completedProfile(state.values,{business_description:'Operator description'}));state=profileState(db,'company');assert.equal(state.values.business_description,'Operator description');assert.equal(state.recommendations.business_description.value,'Retail goods');
});
test('a single review-only cited description is selected without a button click',t=>{
 const db=setup(t);note(db,'source','Retail sale of example goods');
 db.prepare('INSERT INTO extracted_fields VALUES(?,?,?,?,?,?,?,?,?,?)').run('description','company','business_description','Retail sale of example goods','source',1,'Retail sale of example goods','Semantic source requires operator review','review',0);
 const state=profileState(db,'company');assert.equal(state.values.business_description,'Retail sale of example goods');assert.equal(state.comparisons.business_description.length,1);assert.equal(state.approved,false);assert.match(state.recommendations.business_description.reason,/Единственный/);
});
test('old malformed saved address is repaired as a whole from registry and requires renewed approval',async t=>{
 const db=setup(t);const {registryPages}=await import('../scripts/fixtures/positioned-pdf.js');const {positionedPdf}=await import('../scripts/fixtures/positioned-pdf.js');const {extractDocument}=await import('../lib/extraction.js');
 const pages=await extractDocument(positionedPdf(registryPages),'registry.pdf');db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('registry','company','registry.pdf',JSON.stringify(pages),'ready');reanalyze(db,'company');
 const saved=publish(db,completedProfile(profileState(db,'company').values));
 const bad={...saved.values,registered_address_line1:'Vendor Road',registered_address_line2:'6th Floor, 2 Example Street',city:'BS1 1AA (Provider).'};
 assert.ok(validateProfile(bad).errors.city);
 db.prepare('UPDATE company_profiles SET values_json=? WHERE company_id=?').run(JSON.stringify(bad),'company');
 const repaired=profileState(db,'company');assert.equal(repaired.approved,false);assert.equal(repaired.values.city,'BRISTOL');assert.equal(repaired.values.registered_address_line1,'EXAMPLE HOUSE 1 SAMPLE STREET');assert.equal(repaired.values.registered_address_line2,'SAMPLE VILLAGE');assert.ok(repaired.repairs.city);assert.equal(repaired.values.postal_code,'BS1 1AA');
 assert.equal(publish(db,repaired.values).approved,true);
});
test('an explicit separate operating address keeps its own mode and is not copied from registered office',t=>{
 const db=setup(t);note(db,'addresses','Company name: EXAMPLE GOODS LTD\nRegistered address: 8 Example Road, Bristol, England, BS1 1AA\nOperating address\n77 Sample Avenue, Oxford, England, OX1 1AA');
 const state=profileState(db,'company');assert.equal(state.values.operating_address_mode,'different');assert.equal(state.values.operating_address_line1,'77 Sample Avenue');assert.equal(state.values.operating_city,'Oxford');assert.equal(state.values.city,'Bristol');
});
test('card alias and legacy mismatch flags do not block legal company fields after reanalysis',t=>{
 const db=setup(t);db.prepare("UPDATE companies SET name='Магазин №1' WHERE id='company'").run();note(db,'main','EXAMPLE GOODS LTD\nCompany number 12345678\nRegistered office address\n8 Example Road, Bristol, England, BS1 1AA\nIncorporated on 03.10.2025\nhttps://example.com');
 db.prepare("UPDATE extracted_fields SET note='Название в документе отличается от выбранной компании. Проверьте принадлежность документа.',automatic=0,status='review'").run();db.prepare('DELETE FROM facts').run();reanalyze(db,'company');const state=profileState(db,'company');for(const key of ['company_name','company_number','incorporated_on','website','registered_address_line1','city','postal_code'])assert.ok(state.values[key],key);assert.equal(state.values.company_name,'EXAMPLE GOODS LTD');assert.equal(state.values.city,'Bristol');
});
test('selected Director role can use one document identity without claiming registry role verification',t=>{
 const db=setup(t);note(db,'identity','PASSPORT\nGiven names: ANNA MARIA\nSurname: EXAMPLE\nApplicant role: Director');const state=profileState(db,'company');assert.equal(state.values.applicant_role,'director');assert.equal(state.values.contact_first_name,'ANNA MARIA');assert.equal(state.values.contact_last_name,'EXAMPLE');assert.ok(state.roleVerification);
});
test('different company names with the same official registration number are not blocked as unrelated entities',t=>{
 const db=setup(t);publish(db,completedProfile({}, {company_name:'OLD EXAMPLE GOODS LTD'}));note(db,'current','CERTIFICATE OF INCORPORATION\nCompany Name: EXAMPLE GOODS LTD\nCompany number: 12345678\nIncorporated on 03.10.2025');const rows=db.prepare("SELECT note FROM extracted_fields WHERE document_id='current'").all();assert.ok(rows.length);assert.equal(rows.some(row=>row.note.startsWith('Название в документе отличается')),false);
});

test('passport birth date appears in master sheet and supports director role and external DD/MM/YYYY input',async t=>{
 const {suggest}=await import('../lib/fields.js');const db=setup(t);
 note(db,'passport','PASSPORT\nSurname: EXAMPLE\nGiven names: Alice\nDate of birth: 15/07/1990');
 const draft=profileState(db,'company');assert.equal(draft.values.contact_birth_date,'1990-07-15');assert.equal(draft.schema.find(f=>f.key==='contact_birth_date').english,'Date of birth');
 publish(db,completedProfile(draft.values,{applicant_role:'director'}));
 const facts=primaryFacts(db,'company',[]);assert.equal(facts.find(f=>f.key==='director_birth_date').value,'1990-07-15');
 assert.equal(suggest({label:'Date of birth',type:'text',placeholder:'DD/MM/YYYY'},facts,{personRole:'director'}).value,'15/07/1990');
 assert.ok(validateProfile(completedProfile({}, {contact_birth_date:'1990-02-31'})).errors.contact_birth_date);
});

test('passport birth date follows the selected representative rather than an unrelated passport majority',t=>{
 const db=setup(t);note(db,'passport-a','PASSPORT\nSurname: EXAMPLE\nGiven names: Alice\nDate of birth: 15/07/1990');
 note(db,'passport-b','PASSPORT\nSurname: OTHER\nGiven names: Bob\nDate of birth: 20/08/1980');
 publish(db,completedProfile({}, {contact_first_name:'Alice',contact_last_name:'EXAMPLE'}));
 const state=profileState(db,'company');assert.equal(state.values.contact_birth_date,'1990-07-15');
});

test('operating address can explicitly use the director home without changing registered office',()=>{
 const values=completedProfile({}, {applicant_role:'director',operating_address_mode:'director_home',contact_address_line1:'Sample iela 12-3',contact_city:'Riga',contact_postal_code:'LV-1009',contact_country:'Latvia'});
 const result=validateProfile(values);assert.deepEqual(result.errors,{});assert.equal(result.values.operating_city,'Riga');assert.equal(result.values.operating_country,'Latvia');assert.equal(result.values.city,'Example City');assert.equal(result.values.registered_country,'United Kingdom');
 assert.ok(validateProfile({...values,contact_city:''}).errors.contact_city);assert.ok(validateProfile({...values,applicant_role:'contact'}).errors.operating_address_mode);
});

test('UBO narrative answers are stored in the master sheet and proposed only from their own sources',async t=>{
 const {suggest}=await import('../lib/fields.js');const db=setup(t);
 note(db,'ubo','Description of shares owned: 100% of the ordinary shares held directly.\nLevel of control: Voting rights stated in the shareholder register.\nActing on own behalf or nominee: Acting on my own behalf.\nPrimary source of wealth: Employment income supported by payslips.');
 const state=profileState(db,'company');assert.equal(state.values.source_of_wealth,'Employment income supported by payslips.');publish(db,completedProfile(state.values));
 const result=suggest({label:'Primary source of wealth',type:'textarea'},primaryFacts(db,'company',[]));assert.equal(result.value,'Employment income supported by payslips.');assert.equal(result.status,'suggested');
});

test('saved passport fields reach passport, NIC/Passport No, nationality dropdown and dates for director role',async t=>{
 const {suggest}=await import('../lib/fields.js');const db=setup(t);
 note(db,'passport','PASSPORT\nSurname: EXAMPLE\nGiven names: Alice\nPassport No: AB0012345\nPersonal number: 150790-12345\nDate of issue: 12.11.2022\nDate of expiry: 12.11.2032\nNationality: Latvian\nIssuing country: Latvia');
 const state=profileState(db,'company');assert.equal(state.values.contact_passport_number,'AB0012345');assert.equal(state.values.contact_document_type,'passport');
 publish(db,completedProfile(state.values,{applicant_role:'director'}));const facts=primaryFacts(db,'company',[]);
 assert.equal(suggest({label:'NIC/Passport No',type:'text'},facts,{personRole:'director'}).value,'AB0012345');
 assert.equal(suggest({label:'Passport number',type:'text'},facts,{personRole:'director'}).value,'AB0012345');
 assert.equal(suggest({label:'Personal identification number',type:'text'},facts,{personRole:'director'}).value,'150790-12345');
 assert.equal(suggest({label:'Passport expiry date',type:'text',placeholder:'DD-MM-YYYY'},facts,{personRole:'director'}).value,'12-11-2032');
 assert.equal(suggest({label:'Nationality',type:'select-one',options:[{text:'Latvian',value:'LVA'},{text:'British',value:'GBR'}]},facts,{personRole:'director'}).optionValue,'LVA');
});
test('passport details from another named person cannot fill the selected representative',t=>{
 const db=setup(t);note(db,'alice','PASSPORT\nSurname: EXAMPLE\nGiven names: Alice\nPassport No: AB0012345\nDate of expiry: 12.11.2032');note(db,'bob','PASSPORT\nSurname: OTHER\nGiven names: Bob\nPassport No: BB0099999\nDate of expiry: 12.11.2033');
 publish(db,completedProfile({}, {contact_first_name:'Alice',contact_last_name:'EXAMPLE'}));const state=profileState(db,'company');assert.equal(state.values.contact_passport_number,'AB0012345');assert.equal(state.values.contact_passport_expiry,'2032-11-12');
});

test('NIC/Passport No selects the explicit document type and does not substitute personal code',async t=>{
 const {suggest,sensitive}=await import('../lib/fields.js');const db=setup(t);
 publish(db,completedProfile({}, {contact_document_type:'id_card',contact_id_number:'ID00012345',contact_personal_id:'150790-12345'}));
 let facts=primaryFacts(db,'company',[]);assert.equal(suggest({label:'NIC/Passport No',type:'text'},facts).value,'ID00012345');assert.equal(suggest({label:'Passport number',type:'text'},facts).status,'manual');assert.equal(sensitive('National ID card number'),false);assert.equal(sensitive('Credit card number'),true);
 const result=validateProfile(completedProfile({}, {contact_document_type:'',contact_id_number:'ID00012345',contact_passport_number:'AB0012345'}));assert.ok(result.errors.contact_document_type);
});

test('expiry is selected from the chosen passport number rather than a different passport of the same person',t=>{
 const db=setup(t);note(db,'passport-a','PASSPORT\nSurname: EXAMPLE\nGiven names: Alice\nPassport No: AB0012345\nDate of expiry: 12.11.2032');note(db,'passport-b','PASSPORT\nSurname: EXAMPLE\nGiven names: Alice\nPassport No: BB0099999\nDate of expiry: 12.11.2033');
 publish(db,completedProfile({}, {contact_passport_number:'AB0012345'}));assert.equal(profileState(db,'company').values.contact_passport_expiry,'2032-11-12');
});
