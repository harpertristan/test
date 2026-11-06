import test from 'node:test';import assert from 'node:assert/strict';
import {fixedRuleProposal,resolveFieldKey,suggest} from '../lib/fields.js';
test('operator fixed values apply without documents and distinguish ownership from other questions',()=>{
 for(const label of ['Ownership percentage','Percentage of ownership','Ownership %','Shareholding percentage'])assert.equal(suggest({label,type:'number'},[]).value,'100');
 assert.equal(suggest({label:'Job title',type:'text'},[]).value,'Director');
 for(const label of ['Ownership type','Source of wealth','Annual turnover','Director name'])assert.equal(fixedRuleProposal({label,type:'text'}),null);
 assert.notEqual(fixedRuleProposal({label:'Job title',type:'password'}).status,'suggested');
 assert.notEqual(fixedRuleProposal({label:'Ownership percentage',type:'text',readOnly:true}).status,'suggested');
 assert.equal(suggest({label:'Job title',type:'select-one',options:[{text:'Director',value:'director'}]},[]).optionValue,'director');
 assert.equal(suggest({label:'Job title',type:'select-one',options:[{text:'Managing Director',value:'md'}]},[]).status,'manual');
});
test('trading address components use the operating context rather than country of incorporation',()=>{
 for(const [label,key] of [['Street line 1','operating_address_line1'],['Street line 2','operating_address_line2'],['Country','operating_country'],['State','operating_region']])assert.equal(resolveFieldKey({label,addressKind:'operating'}),key);
});
test('UBO free-text questions resolve separately; wealth is never replaced with account funds or turnover',()=>{
 for(const [label,key] of [['Description of shares owned: *','shares_description'],['Describe your level of control: *','control_description'],['Acting on own behalf, or nominee: *','nominee_description'],['Primary source of wealth: *','source_of_wealth']])assert.equal(resolveFieldKey({label,type:'textarea'}),key);
 const facts=[{key:'funds_source',value:'Company sales',confirmed:1},{key:'expected_turnover',value:'EUR 50000',confirmed:1}];assert.equal(suggest({label:'Primary source of wealth',type:'textarea'},facts).status,'manual');
});
