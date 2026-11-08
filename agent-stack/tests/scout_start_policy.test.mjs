import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeScoutStart, validateStartRequest, scoutPayload} from '../scout_start_policy.mjs';
const issue='22222222-2222-4222-8222-222222222222';
const task={id:issue,identifier:'WOR-7',status:'in_progress'};
const scope={version:1,grants:{[issue]:{
  issueIdentifier:'WOR-7',workspaceWide:true,
  operations:['scout_start','scout_findings'],
  scoutSourceIds:['web:one','web:two']
}}};
test('one scoped task chooses only preapproved web source IDs',()=>{
 const grant=authorizeScoutStart(scope,task);
 assert.deepEqual(scoutPayload(grant),{ids:['web:one','web:two'],analyse:false,allowPaid:false,requestId:issue});
 assert.deepEqual(Object.keys(validateStartRequest({capability:'synthetic'})),Object.keys('synthetic'));
});
test('allows catalogue-backed nonpaid financial source when no web sources exist',()=>{
  const specialized={version:1,grants:{[issue]:{
    ...scope.grants[issue],scoutSourceIds:['social:ecb']
  }}};
  assert.deepEqual(scoutPayload(authorizeScoutStart(specialized,task)),{
    ids:['social:ecb'],analyse:false,allowPaid:false,requestId:issue
  });
});
test('no caller-provided URL, source IDs, paid flag or task selector',()=>{
 for(const extra of [{ids:['web:bad']},{allowPaid:true},{url:'http://a'},{taskId:issue},{requestId:'another'}])
   assert.throws(()=>validateStartRequest({capability:'synthetic',...extra}));
});
test('no permission without active task, matching issue or explicit source scope',()=>{
 for(const t of [{...task,status:'in_review'},{...task,id:'33333333-3333-4333-8333-333333333333'},{...task,identifier:'WOR-8'}])
   assert.throws(()=>authorizeScoutStart(scope,t));
 for(const g of [
   {...scope.grants[issue],operations:[]},
   {...scope.grants[issue],workspaceWide:false},
   {...scope.grants[issue],scoutSourceIds:[]},
   {...scope.grants[issue],scoutSourceIds:['web:one','web:one']},
   {...scope.grants[issue],scoutSourceIds:['http://x']},
 ])assert.throws(()=>authorizeScoutStart({version:1,grants:{[issue]:g}},task));
});
