// Hermes isolated developer workspace, with no Docker socket, network, production
// mounts, source write access, secrets, shell commands or outbound effects.
// A verified Paperclip Chat or task may freely inspect, patch and test code
// in its own copy. Publishing that copy requires a separate human decision.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {activeReadContext} from "./active_run_scope.mjs";
const TEST=process.env.HERMES_TEST_MODE==="1";
const SOCKET=TEST?process.env.HERMES_TEST_DEV_SOCKET:"/run/dev-tools/workspace.sock";
const CTRL=TEST?process.env.HERMES_TEST_CONTROL:"/run/task-control/control.sock";
const SCOPE=TEST?process.env.HERMES_TEST_SCOPE:"/run/secrets/three-tool-scope.json";
const SOURCE=TEST?process.env.HERMES_TEST_SOURCE:"/source";
const ROOT=TEST?process.env.HERMES_TEST_WORKSPACE:"/workspace";
const EXT=new Set([".mjs",".py",".yaml",".yml",".json",".sh",".md"]);
const MAX_SOURCE=400_000;
const MAX_OUTPUT=13_000;
const SAFE_REL=/^(?!\/)(?!.*(?:^|\/)\.)(?!.*(?:^|\/)\.\.\/)[A-Za-z0-9_.\/-]{1,180}$/;
const REDACT=[/sk-(?:proj-)?[A-Za-z0-9_-]{10,}/g,
 /(?:bearer\s+)[A-Za-z0-9._-]{12,}/gi,
 /(?:api[_-]?key|password|client[_-]?secret)\s*[=:]\s*["']?[^,\s"']{8,}/gi];
const clean=s=>REDACT.reduce((v,r)=>v.replace(r,"[REDACTED]"),s);
export function safePath(rel){
 if(typeof rel!=="string"||!SAFE_REL.test(rel)||rel.includes("//")||
    rel.split("/").some(x=>!x||x==="."||x===".."||x.startsWith("."))||
    !EXT.has(path.extname(rel)))throw Error("WORKSPACE_PATH_DENIED");
 return rel;
}
export function authorizeWorkspace(policy,task){
 if(!activeReadContext(task)||!policy||policy.version!==1)throw Error("WORKSPACE_TASK_DENIED");
 const explicit=policy.grants?.[task.id];
 if(explicit&&explicit.issueIdentifier!==task.identifier)throw Error("WORKSPACE_ISSUE_MISMATCH");
 const agent=policy.agentGrants?.[task.agentId];
 if(!agent||agent.agentId!==task.agentId||agent.companyId!==task.companyId||
   agent.workspaceWide!==true||!Array.isArray(agent.operations)||
   !agent.operations.includes("developer_workspace"))throw Error("WORKSPACE_NOT_GRANTED");
 return true;
}
function readJson(request,responseLimit=8192){
 return new Promise((resolve,reject)=>{
  const raw=JSON.stringify(request);
  const req=http.request({socketPath:CTRL,method:"POST",path:"/current",
    timeout:7000,headers:{"content-type":"application/json",
    "content-length":Buffer.byteLength(raw)}},res=>{
    let text="";res.on("data",part=>{text+=part;if(text.length>responseLimit)res.destroy()});
    res.on("error",reject);
    res.on("end",()=>{
      try{resolve({status:res.statusCode,data:JSON.parse(text)});}
      catch{reject(Error("CONTROL_RESPONSE_INVALID"));}
    });
  });req.on("timeout",()=>req.destroy(Error("CONTROL_TIMEOUT")));
  req.on("error",reject);req.end(raw);
 });
}
function verifyNodeTree(root){
 if(!fs.existsSync(root)){fs.mkdirSync(root,{recursive:true,mode:0o700});return;}
 if(fs.lstatSync(root).isSymbolicLink())throw Error("WORKSPACE_SYMLINK");
}
function walk(src,dst,count={files:0,bytes:0}){
 for(const d of fs.readdirSync(src,{withFileTypes:true})){
  if(d.name.startsWith(".")||["node_modules","__pycache__","private",
     "state","venv","secrets","backups"].includes(d.name))continue;
  const original=path.join(src,d.name),target=path.join(dst,d.name);
  const st=fs.lstatSync(original);
  if(st.isSymbolicLink())continue;
  if(st.isDirectory()){
    fs.mkdirSync(target,{recursive:true,mode:0o700});
    walk(original,target,count);continue;
  }
  if(!st.isFile()||!EXT.has(path.extname(d.name))||st.size>MAX_SOURCE)continue;
  count.files++;count.bytes+=st.size;
  if(count.files>900||count.bytes>12_000_000)throw Error("WORKSPACE_COPY_LIMIT");
  fs.copyFileSync(original,target);
  fs.chmodSync(target,0o600);
 }
}
function workspace(taskId){
 if(!/^[0-9a-f-]{36}$/i.test(taskId))throw Error("WORKSPACE_TASK_ID");
 verifyNodeTree(ROOT);
 const folder=path.join(ROOT,taskId);
 if(!fs.existsSync(folder)){
  fs.mkdirSync(folder,{mode:0o700});
  try{walk(SOURCE,folder);}
  catch(e){fs.rmSync(folder,{force:true,recursive:true});throw e;}
 }
 if(fs.lstatSync(folder).isSymbolicLink())throw Error("WORKSPACE_SYMLINK");
 return folder;
}
function inside(folder,rel){
 safePath(rel);
 const file=path.resolve(folder,rel);
 if(!file.startsWith(folder+path.sep))throw Error("WORKSPACE_PATH_DENIED");
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()||
    fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>MAX_SOURCE)
   throw Error("WORKSPACE_FILE_UNAVAILABLE");
 return file;
}
function patchFile(folder,rel,oldText,newText){
 if(typeof oldText!=="string"||typeof newText!=="string"||
    oldText.length<1||oldText.length>9000||newText.length>18000)
   throw Error("WORKSPACE_INVALID_PATCH");
 const file=inside(folder,rel);
 const content=fs.readFileSync(file,"utf8");
 const pos=content.indexOf(oldText);
 if(pos<0||content.indexOf(oldText,pos+1)>=0)throw Error("WORKSPACE_PATCH_NOT_UNIQUE");
 const newSource=content.replace(oldText,newText);
 if(Buffer.byteLength(newSource)>MAX_SOURCE)throw Error("WORKSPACE_FILE_TOO_LARGE");
 const tmp=file+".hermes-tmp";
 fs.writeFileSync(tmp,newSource,{flag:"wx",mode:0o600});
 fs.renameSync(tmp,file);
 return {status:"staged",file:rel,bytes:Buffer.byteLength(newSource),
  notice:"Only isolated workspace changed. Production unchanged."};
}
// Compile-only testing. Untrusted agent-written files are NEVER executed inside
// this gateway because its private control socket would be visible to the child.
function checkSyntax(folder,rel){
 const file=inside(folder,rel);
 const ext=path.extname(file);
 if(![".mjs",".py",".sh"].includes(ext))throw Error("WORKSPACE_TEST_UNSUPPORTED");
 const [command,args]=ext===".mjs"?["node",["--check",file]]:
   ext===".py"?["python3",["-m","py_compile",file]]:["bash",["-n",file]];
 return new Promise(resolve=>{
  const proc=spawn(command,args,{cwd:folder,env:{
    PATH:process.env.PATH||"/usr/local/bin:/usr/bin:/bin",
    HOME:folder,PYTHONPYCACHEPREFIX:path.join(folder,".pycache"),
    TMPDIR:"/tmp"},shell:false,stdio:["ignore","pipe","pipe"]});
  let out="",done=false;
  const append=b=>{out+=b.toString("utf8");if(out.length>MAX_OUTPUT)out=out.slice(-MAX_OUTPUT)};
  proc.stdout.on("data",append);proc.stderr.on("data",append);
  const timer=setTimeout(()=>proc.kill("SIGKILL"),20000);
  proc.on("error",e=>{if(!done){done=true;clearTimeout(timer);resolve({
    status:"error",code:"COMPILER_UNAVAILABLE",detail:String(e.code||"error")})}});
  proc.on("close",code=>{if(!done){done=true;clearTimeout(timer);resolve({
    status:code===0?"passed":"failed",exitCode:code,
    output:clean(out).slice(-MAX_OUTPUT),kind:"syntax_only"})}});
 });
}
function collectSyntaxFiles(folder){
 const files=[];
 const visit=(dir,prefix="")=>{
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
   if(files.length>=120)return;
   if(e.name.startsWith(".")||e.name==="node_modules")continue;
   const rel=prefix+e.name;
   if(e.isDirectory())visit(path.join(dir,e.name),rel+"/");
   else if(e.isFile()&&[".mjs",".py",".sh"].includes(path.extname(rel)))
     files.push(rel);
  }
 };
 visit(folder);return files;
}
async function runTest(folder,suite,rel){
 if(!["syntax","all_syntax"].includes(suite))throw Error("WORKSPACE_SUITE_DENIED");
 const names=suite==="syntax"?[safePath(rel)]:collectSyntaxFiles(folder);
 const results=[];
 for(const name of names){
  const outcome=await checkSyntax(folder,name);
  results.push({file:name,status:outcome.status,
    ...(outcome.output?{detail:outcome.output.slice(-700)}:{})});
  if(outcome.status!=="passed")break;
 }
 return {status:results.length>0&&results.every(x=>x.status==="passed")?
    "passed":"failed",kind:"syntax_only",checked:results.length,
   results:results.slice(-25),
   notice:"No untrusted code executed. Full behavior tests require separate isolated CI."};
}
function isValid(body){
 if(!body||typeof body!=="object"||Array.isArray(body)||typeof body.capability!=="string"||
   body.capability.length<1||body.capability.length>160||
   !["list","read","patch","test","reset"].includes(body.action))throw Error("WORKSPACE_INVALID_REQUEST");
 const fields={list:["action","capability"],read:["action","capability","path"],
  patch:["action","capability","new","old","path"],
  test:body.suite==="syntax"?["action","capability","path","suite"]:
       ["action","capability","suite"],
  reset:["action","capability"]};
 if(Object.keys(body).sort().join(",")!==fields[body.action].sort().join(","))
   throw Error("WORKSPACE_INVALID_REQUEST");
}
function reply(res,status,body){
 res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});
 res.end(JSON.stringify(body));
}
fs.mkdirSync(path.dirname(SOCKET),{recursive:true});
try{fs.unlinkSync(SOCKET)}catch(e){if(e.code!=="ENOENT")throw e;}
const server=http.createServer(async(req,res)=>{
 if(req.method==="GET"&&req.url==="/health")return reply(res,200,{ready:true});
 if(req.method!=="POST"||req.url!=="/work")return reply(res,404,{code:"NOT_FOUND"});
 try{
  let text="";for await(const b of req){
   text+=b;if(text.length>26000)throw Error("WORKSPACE_INVALID_REQUEST");
  }
  const body=JSON.parse(text);isValid(body);
  const verified=await readJson({capability:body.capability});
  if(verified.status!==200)return reply(res,403,{code:"WORKSPACE_TASK_DENIED"});
  const task=verified.data,scope=JSON.parse(fs.readFileSync(SCOPE,"utf8"));
  authorizeWorkspace(scope,task);
  const folder=workspace(task.id);
  if(body.action==="list"){
    const result=[];
    const scan=(dir,prefix="")=>{
     for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(result.length>=300)return;
      const rel=prefix+entry.name;
      if(entry.isDirectory())scan(path.join(dir,entry.name),rel+"/");
      else if(entry.isFile()&&EXT.has(path.extname(rel)))result.push(rel);
     }
    };scan(folder);
    return reply(res,200,{files:result,limit:300});
  }
  if(body.action==="read"){
   const rel=safePath(body.path);
   const data=fs.readFileSync(inside(folder,rel),"utf8");
   return reply(res,200,{file:rel,content:clean(data).slice(0,15000),
     truncated:data.length>15000});
  }
  if(body.action==="patch")return reply(res,200,patchFile(folder,
    body.path,body.old,body.new));
  if(body.action==="reset"){
   fs.rmSync(folder,{recursive:true,force:true});
   return reply(res,200,{status:"reset",notice:"Only isolated copy deleted"});
  }
  return reply(res,200,await runTest(folder,body.suite,body.path));
 }catch(e){
  const code=typeof e?.message==="string"&&/^WORKSPACE_[A-Z_]+$/.test(e.message)
   ?e.message:"WORKSPACE_REQUEST_FAILED";
  return reply(res,code==="WORKSPACE_INVALID_REQUEST"?400:403,{code});
 }
});
server.listen(SOCKET,()=>fs.chmodSync(SOCKET,0o660));
