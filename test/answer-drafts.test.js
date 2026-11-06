import test from 'node:test';import assert from 'node:assert/strict';import {validatedAnswerDraft} from '../lib/form-agent.js';
const field={label:'Primary source of wealth',type:'textarea'},evidence=[{id:0,key:'source_of_wealth',value:'Employment income',source:'Master sheet',origin:'master-profile',quote:'Source of wealth: Employment income'},{id:1,key:'funds_source',value:'Company sales',source:'Note',origin:'document',quote:'Company sales'}];
test('ready answer requires approval and a real relevant citation; account funds do not establish personal wealth',()=>{
 const row={key:'source_of_wealth',draft:{text:'My wealth comes from employment income.',evidenceIds:[0]}};
 assert.equal(validatedAnswerDraft(row,field,evidence,true).text,row.draft.text);
 assert.equal(validatedAnswerDraft(row,field,evidence,false),undefined);
 assert.equal(validatedAnswerDraft({...row,draft:{...row.draft,evidenceIds:[1]}},field,evidence,true),undefined);
 assert.equal(validatedAnswerDraft({...row,draft:{...row.draft,evidenceIds:[99]}},field,evidence,true),undefined);
 assert.equal(validatedAnswerDraft(row,{...field,type:'password'},evidence,true),undefined);
 assert.equal(validatedAnswerDraft(row,{...field,maxLength:5},evidence,true),undefined);
 const conflict=[...evidence,{key:'source_of_wealth',value:'Inheritance',origin:'document'}];assert.equal(validatedAnswerDraft({...row,draft:{...row.draft,evidenceIds:[2]}},field,conflict,true),undefined);
});
