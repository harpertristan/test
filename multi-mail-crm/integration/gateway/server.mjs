import http from 'node:http';
import https from 'node:https';
import { timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const locks=JSON.parse(readFileSync(new URL('../sources.lock.json',import.meta.url),'utf8'));
export const thirdTab='<a href="/mail-crm/">Почтовая CRM</a>';
const oldLinks="[['/crm','Play Scout'],['/assistant/','Помощник регистраций']]";
const newLinks="[['/crm','Play Scout'],['/assistant/','Помощник регистраций'],['/mail-crm/','Почтовая CRM']]";

export function addThirdTab(path,body){
  if(path==='/theme.js'){
    const expected=locks['play-scout'].files['public/theme.js'];
    if(createHash('sha256').update(body).digest('hex')!==expected)return {body,status:'source-mismatch'};
    const text=body.toString();return {body:Buffer.from(text.replace(oldLinks,newLinks)),status:'added'};
  }
  if(path==='/assistant/'||path==='/assistant'){
    const text=body.toString();
    const nav=text.match(/<nav class="workspace-tabs"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    if(!nav||!nav.includes('href="/crm"')||!nav.includes('href="/assistant/"'))return {body,status:'source-mismatch'};
    if(nav.includes('/mail-crm/'))return {body,status:'present'};
    return {body:Buffer.from(text.replace(nav,nav.replace('</nav>',thirdTab+'</nav>'))),status:'added'};
  }
  return {body,status:'unchanged'};
}

function same(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);}
function upstreamURL(raw,target){const incoming=new URL(raw,'http://gateway');const result=new URL(target);result.pathname=incoming.pathname;result.search=incoming.search;return result;}
function transport(url){return url.protocol==='https:'?https:http;}
function origin(value){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Upstream must be an HTTP(S) origin without credentials or path');return url;}

export function createGateway({scout=process.env.SCOUT_UPSTREAM||'http://app:3000',assistant=process.env.ASSISTANT_UPSTREAM||'http://registration-assistant:3100',mail=process.env.MAIL_CRM_UPSTREAM||'http://frontend:8080',workspaceKey=process.env.WORKSPACE_SHARED_SECRET||''}={}){
  const targets={scout:origin(scout),assistant:origin(assistant),mail:origin(mail)};
  const choose=path=>path.startsWith('/mail-crm/')||path==='/mail-crm'?'mail':path.startsWith('/assistant/')||path==='/assistant'?'assistant':'scout';
  function requestHeaders(req,target){const headers={...req.headers};if(!headers.host)headers.host=target.host;delete headers['proxy-authorization'];return headers;}
  async function helperHeaders(req,headers){
    if(/^Bearer /i.test(headers.authorization||'')){delete headers['x-workspace-key'];delete headers['x-workspace-role'];return headers;}
    if(workspaceKey.length<32)throw Object.assign(Error('Workspace key unavailable'),{status:503});
    if(same(headers['x-workspace-key'],workspaceKey)&&['admin','viewer'].includes(headers['x-workspace-role']))return headers;
    delete headers['x-workspace-key'];delete headers['x-workspace-role'];
    const result=await new Promise((resolve,reject)=>{
      const check=transport(targets.scout).request(new URL('/api/workspace-auth',targets.scout),{headers:{authorization:req.headers.authorization||'',cookie:req.headers.cookie||''}},response=>{
        response.resume();resolve({status:response.statusCode,headers:response.headers});
      });check.setTimeout(10000,()=>check.destroy());check.on('error',reject);check.end();
    });
    if(result.status!==200)throw Object.assign(Error('Existing workspace authentication required'),{status:result.status,headers:result.headers});
    const role=result.headers['x-workspace-role'];if(!['admin','viewer'].includes(role))throw Object.assign(Error('Invalid workspace role'),{status:403});
    headers['x-workspace-key']=workspaceKey;headers['x-workspace-role']=role;return headers;
  }
  const server=http.createServer(async(req,res)=>{
    const path=new URL(req.url,'http://gateway').pathname;
    if(path==='/__tools/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"status":"ok","tools":3}');return;}
    if(path==='/mail-crm'){res.writeHead(308,{Location:'/mail-crm/'});res.end();return;}
    const kind=choose(path),target=targets[kind];let headers=requestHeaders(req,target);
    const transform=req.method==='GET'&&(kind==='scout'&&path==='/theme.js'||kind==='assistant'&&path==='/assistant/');
    try{
      if(kind==='assistant')headers=await helperHeaders(req,headers);
      if(kind==='mail'){delete headers.cookie;delete headers.authorization;delete headers['x-workspace-key'];delete headers['x-workspace-role'];}
      if(transform){headers['accept-encoding']='identity';delete headers['if-none-match'];delete headers['if-modified-since'];}
      const upstream=transport(target).request(upstreamURL(req.url,target),{method:req.method,headers},reply=>{
        if(!transform||reply.statusCode!==200){res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);reply.on('error',()=>res.destroy());return;}
        const chunks=[];let size=0;
        reply.on('data',part=>{size+=part.length;if(size>2*1024*1024){reply.destroy();res.destroy();return;}chunks.push(part);});
        reply.on('error',()=>res.destroy());
        reply.on('end',()=>{const result=addThirdTab(path,Buffer.concat(chunks));const output={...reply.headers,'content-length':result.body.length,'cache-control':'no-store','x-tool-navigation':result.status};delete output.etag;delete output['content-md5'];delete output['transfer-encoding'];res.writeHead(reply.statusCode,output);res.end(result.body);});
      });
      upstream.setTimeout(35*60*1000,()=>upstream.destroy());
      upstream.on('error',()=>{if(res.headersSent){res.destroy();return;}res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Tool upstream unavailable"}');});
      req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});req.pipe(upstream);
    }catch(error){res.writeHead(error.status||503,{'Content-Type':'application/json',...(error.headers?.['www-authenticate']?{'WWW-Authenticate':error.headers['www-authenticate']}: {})});res.end('{"error":"Existing tool authentication or upstream unavailable"}');}
  });
  server.on('upgrade',(req,socket,head)=>{
    if(!req.url.startsWith('/mail-crm/ws/')){socket.destroy();return;}
    const headers=requestHeaders(req,targets.mail);delete headers.cookie;delete headers.authorization;delete headers['x-workspace-key'];delete headers['x-workspace-role'];
    const upstream=transport(targets.mail).request(upstreamURL(req.url,targets.mail),{headers});
    upstream.on('upgrade',(reply,remote,remoteHead)=>{socket.write(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\n`+Object.entries(reply.headers).flatMap(([k,v])=>(Array.isArray(v)?v:[v]).map(value=>`${k}: ${value}\r\n`)).join('')+'\r\n');if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);socket.pipe(remote).pipe(socket);socket.on('error',()=>remote.destroy());remote.on('error',()=>socket.destroy());socket.on('end',()=>remote.destroy());remote.on('end',()=>socket.end());socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy());});
    upstream.on('response',reply=>{reply.resume();socket.destroy();});upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());upstream.end();
  });
  return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const server=createGateway();server.listen(Number(process.env.PORT||3200),'0.0.0.0');for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));}
