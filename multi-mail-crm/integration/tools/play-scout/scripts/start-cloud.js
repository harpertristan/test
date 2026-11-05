import {cloudAccess} from '../lib/cloud-access.js';
import {resolve} from 'node:path';
import {createApp,shutdownApp} from '../server.js';
import {openStore} from '../lib/store.js';

try { process.loadEnvFile('.env'); }
catch(error) { if(error.code!=='ENOENT')throw error; }
const access=cloudAccess();
if(process.argv.slice(2).some(arg=>arg!==''&&arg!=='--manual'))throw Error('Only --manual is supported.');
const manual=process.argv.includes('--manual');
const store=await openStore(resolve(process.env.DATA_DIR||'./data','state.json'));
const server=createApp({store,manual,autoSchedule:!manual,...access});
server.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log(`Play Scout cloud started; schedules ${manual?'paused':'enabled'}.`));
let stopping;
const stop=()=>stopping??=(async()=>{try{await shutdownApp(server);process.exit(0);}catch{console.error('Cloud shutdown failed; preserve the entire data directory.');process.exit(1);}})();
server.on('shutdown-requested',stop);
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
