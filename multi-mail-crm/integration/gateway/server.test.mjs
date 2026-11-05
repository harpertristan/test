import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createGateway, addThirdTab, thirdTab } from './server.mjs';

const theme=readFileSync(new URL('../tools/play-scout/public/theme.js',import.meta.url));
const helper=readFileSync(new URL('../tools/registration-assistant/public/index.html',import.meta.url));
const oldLinks="[['/crm','Play Scout'],['/assistant/','Помощник регистраций']]";
const newLinks="[['/crm','Play Scout'],['/assistant/','Помощник регистраций'],['/mail-crm/','Почтовая CRM']]";
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));

test('legacy source responses differ only by one new navigation entry',()=>{
 const scout=addThirdTab('/theme.js',theme);assert.equal(scout.status,'added');assert.equal(scout.body.toString().replace(newLinks,oldLinks),theme.toString());
 const assistant=addThirdTab('/assistant/',helper);assert.equal(assistant.status,'added');assert.equal(assistant.body.toString().replace(thirdTab,''),helper.toString());
 const changed=Buffer.from(theme.toString()+'\n// unexpected version');assert.equal(addThirdTab('/theme.js',changed).status,'source-mismatch');assert.equal(addThirdTab('/theme.js',changed).body,changed);
 const api=Buffer.from('{"business":"unchanged"}');assert.equal(addThirdTab('/api/crm',api).body,api);
});

test('gateway preserves legacy APIs/auth and allows CRM without credentials',async t=>{
 const requests=[];
 const upstream=http.createServer((req,res)=>{requests.push({path:req.url,headers:req.headers});
  if(req.url==='/api/workspace-auth'){res.writeHead(200,{'X-Workspace-Role':'viewer'});res.end('{}');return;}
  if(req.url==='/theme.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(theme);return;}
  if(req.url==='/assistant/'){res.writeHead(200,{'Content-Type':'text/html'});res.end(helper);return;}
  if(req.url==='/api/protected'){res.writeHead(401,{'WWW-Authenticate':'Basic realm="existing"'});res.end('original-auth');return;}
  res.writeHead(200,{'Content-Type':'application/json','X-Original-API':'unchanged'});res.end(JSON.stringify({path:req.url}));
 });const origin=await listen(upstream);t.after(()=>close(upstream));
 const gateway=createGateway({scout:origin,assistant:origin,mail:origin,workspaceKey:'t'.repeat(40)});const base=await listen(gateway);t.after(()=>close(gateway));
 const original=await fetch(base+'/api/protected');assert.equal(original.status,401);assert.equal(await original.text(),'original-auth');assert.equal(original.headers.get('www-authenticate'),'Basic realm="existing"');
 const api=await fetch(base+'/api/crm?view=approved');assert.equal(api.headers.get('x-original-api'),'unchanged');assert.equal((await api.json()).path,'/api/crm?view=approved');assert.equal(requests.findLast(r=>r.path==='/api/crm?view=approved').headers.host,new URL(base).host);
 const shared=await fetch(base+'/assistant/',{headers:{'X-Workspace-Role':'admin','X-Workspace-Key':'spoofed'}});assert.equal(shared.status,200);assert.ok((await shared.text()).includes(thirdTab));
 const helperRequest=requests.findLast(r=>r.path==='/assistant/');assert.equal(helperRequest.headers['x-workspace-role'],'viewer');assert.equal(helperRequest.headers['x-workspace-key'],'t'.repeat(40));
 await fetch(base+'/mail-crm/api/workspace',{headers:{Authorization:'Basic do-not-forward',Cookie:'legacy_session=do-not-forward','X-Workspace-Key':'not-for-mail'}});
 const mail=requests.findLast(r=>r.path==='/mail-crm/api/workspace');assert.equal(mail.headers.authorization,undefined);assert.equal(mail.headers.cookie,undefined);assert.equal(mail.headers['x-workspace-key'],undefined);
 const script=await fetch(base+'/theme.js');assert.equal(script.headers.get('x-tool-navigation'),'added');assert.ok((await script.text()).includes('/mail-crm/'));
});

test('websocket upgrade is tunneled to CRM under its own prefix',{timeout:10000},async t=>{
 const sockets=new Set();
 const track=server=>server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 const upstream=http.createServer();track(upstream);upstream.on('upgrade',(req,socket)=>{assert.equal(req.url,'/mail-crm/ws/notifications/shared');socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nhello');});
 const origin=await listen(upstream);const gateway=createGateway({scout:origin,assistant:origin,mail:origin});track(gateway);const base=await listen(gateway);
 t.after(async()=>{for(const socket of sockets)socket.destroy();await Promise.all([close(gateway),close(upstream)]);});
 const req=http.request(base+'/mail-crm/ws/notifications/shared',{headers:{Connection:'Upgrade',Upgrade:'websocket'}});req.end();const [response,socket,head]=await once(req,'upgrade');assert.equal(response.statusCode,101);
 let received=head.toString();if(!received.includes('hello'))received+=(await once(socket,'data'))[0].toString();assert.ok(received.includes('hello'));socket.destroy();
});
