import {randomBytes, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
export const token = () => randomBytes(32).toString('base64url');
export const digest = s => createHash('sha256').update(s).digest('hex');
export function hashPassword(password) {const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password,salt,64).toString('hex');}
export function verifyPassword(password, stored) {try {const [salt,hash] = stored.split(':');return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(hash,'hex'));} catch {return false;}}
export function requireString(value, name, max = 500) {if(typeof value !== 'string' || !value.trim() || value.length > max) throw Object.assign(new Error(`Проверьте поле «${name}» (до ${max} символов).`),{status:400}); return value.trim();}
export const fail = (message, status = 400) => {throw Object.assign(new Error(message),{status});};
