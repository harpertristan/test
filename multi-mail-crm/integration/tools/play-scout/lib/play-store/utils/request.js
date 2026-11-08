import got from 'got';
import {CookieJar} from 'tough-cookie';
const cookieJar=new CookieJar();
const publicPlay=url=>url.protocol==='https:'&&url.hostname==='play.google.com'&&!url.port&&!url.username&&!url.password;

export default async function request(options){
 if(!publicPlay(new URL(options.url)))throw new Error('Unsupported Google Play destination');
 try{
  const response=await got({...options,cookieJar,hooks:{...options.hooks,
   beforeRedirect:[...(options.hooks?.beforeRedirect??[]),next=>{if(!publicPlay(next.url))throw new Error('Unsupported Google Play redirect');}]
  }});
  return response.body;
 }catch(cause){
  if(options.signal?.aborted)throw options.signal.reason;
  throw Object.assign(new Error(cause.response?.statusCode===404?'App not found (404)':'Error requesting Google Play: '+cause.message),{status:cause.response?.statusCode,code:cause.code,cause});
 }
}
