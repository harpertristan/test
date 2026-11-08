import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {localRequest} from '../lib/ollama-provider.js';

test('Ollama supports a configured container origin and retains local port compatibility',async t=>{
 const previous=process.env.OLLAMA_BASE_URL;
 t.after(()=>{if(previous===undefined)delete process.env.OLLAMA_BASE_URL;else process.env.OLLAMA_BASE_URL=previous;});
 const paths=[],server=http.createServer((req,res)=>{paths.push(req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({models:[{name:'fixture:latest'}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const port=server.address().port;
 delete process.env.OLLAMA_BASE_URL;
 assert.equal((await localRequest('/api/tags',null,{port})).models[0].name,'fixture:latest');
 process.env.OLLAMA_BASE_URL=`http://127.0.0.1:${port}`;
 assert.equal((await localRequest('/api/tags',null)).models[0].name,'fixture:latest');
 assert.deepEqual(paths,['/api/tags','/api/tags']);
 for(const invalid of ['https://example.com','http://user:password@localhost','http://localhost/path','http://localhost/?token=x']){
  process.env.OLLAMA_BASE_URL=invalid;
  await assert.rejects(localRequest('/api/tags',null),{code:'LOCAL_CONFIG'});
 }
 assert.equal(paths.length,2);
});
