import {parentPort,workerData} from 'node:worker_threads';
import {extract} from './documents.js';
try {parentPort.postMessage({pages:await extract(Buffer.from(workerData.buffer),workerData.filename)});}
catch(error) {parentPort.postMessage({error:error.message});}
