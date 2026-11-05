import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';

export function openDatabase(directory) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const db = new DatabaseSync(join(directory,'assistant.sqlite'));
  chmodSync(join(directory,'assistant.sqlite'),0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER NOT NULL,kind TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,filename TEXT NOT NULL,pages TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,key TEXT NOT NULL,value TEXT NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,page INTEGER NOT NULL,quote TEXT NOT NULL,confirmed INTEGER NOT NULL DEFAULT 1,UNIQUE(company_id,key));
    CREATE TABLE IF NOT EXISTS corrections(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,host TEXT NOT NULL,field TEXT NOT NULL,message TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY,calls INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS extracted_fields(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,key TEXT NOT NULL,value TEXT NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,page INTEGER NOT NULL,quote TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL,automatic INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS company_confirmations(company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,signature TEXT NOT NULL,confirmed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS registry_previews(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,payload TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS company_registry_sources(company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,url TEXT NOT NULL,fetched_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS company_profiles(company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,values_json TEXT NOT NULL,source_signature TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_settings(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,encrypted_key TEXT NOT NULL,model TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS form_mappings(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,host TEXT NOT NULL,fingerprint TEXT NOT NULL,field_json TEXT NOT NULL,key TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,UNIQUE(company_id,host,fingerprint));
  `);
  return db;
}
