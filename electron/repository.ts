import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import type { StoreData } from '../src/core/types';
import { DEFAULT_SETTINGS } from '../src/core/types';
import { AppError, validateAccount, validateSettings, validateSnapshot } from '../src/core/validation';
export interface Codec { encrypt(value: string): Buffer; decrypt(value: Buffer): string; }
export function validateStore(value: unknown): asserts value is StoreData {
  const s = value as StoreData;
  if (!s || s.schema !== 1 || !Array.isArray(s.accounts) || s.accounts.length > 500) throw new AppError('data','配置文件版本或账号数量无效。');
  const ids = new Set<string>();
  for (const a of s.accounts) {
    validateAccount(a);
    if (typeof a.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(a.id) || ids.has(a.id) || !Number.isInteger(a.revision) || a.revision < 1) throw new AppError('data','账号 ID 或配置版本无效。');
    if (a.snapshot) validateSnapshot(a.snapshot);
    ids.add(a.id);
  }
  validateSettings(s.settings);
}
export interface RepositoryLike { data: StoreData; commit(next: StoreData): void; }
export class Repository implements RepositoryLike {
  data: StoreData = { schema:1,accounts:[],settings:{...DEFAULT_SETTINGS} };
  warnings: string[] = []; readOnly = false;
  constructor(public file: string, private codec: Codec) {
    fs.mkdirSync(path.dirname(file), {recursive:true});
    if (!fs.existsSync(file)) return;
    try { this.data = this.read(file); }
    catch {
      try { this.data = this.read(file + '.bak'); this.warnings.push('主配置无法读取，已加载加密备份。为保护原文件，本次为只读模式；请导出备份后检查数据目录。'); }
      catch { this.warnings.push('配置无法解密或已损坏。本次为只读模式，原文件未覆盖。换电脑后请用原电脑导出的口令备份迁移；也可将原 data 目录另存后重新启动。'); }
      this.readOnly = true;
    }
    this.data.accounts.forEach(a => { if(a.status === 'refreshing') a.status = a.snapshot ? 'ok' : 'idle'; });
  }
  private read(file: string): StoreData {
    if (fs.statSync(file).size > 16 * 1024 * 1024) throw new Error('size');
    const envelope = JSON.parse(fs.readFileSync(file,'utf8'));
    if(envelope.version !== 1 || typeof envelope.encrypted !== 'string') throw new Error('format');
    const parsed: unknown = JSON.parse(this.codec.decrypt(Buffer.from(envelope.encrypted,'base64'))); validateStore(parsed); return parsed;
  }
  archiveAndReset():string {
    if(!this.readOnly)throw new AppError('data','当前配置可正常读取，无需恢复。');
    // Prove encryption is usable before touching the protected source files.
    this.codec.encrypt('{}');
    const archive=fs.mkdtempSync(path.join(path.dirname(this.file),'recovery-'));
    for(const file of [this.file,this.file+'.bak'])if(fs.existsSync(file))fs.copyFileSync(file,path.join(archive,path.basename(file)),fs.constants.COPYFILE_EXCL);
    const localState=path.join(path.dirname(this.file),'runtime','Local State');
    if(fs.existsSync(localState))fs.copyFileSync(localState,path.join(archive,'Local State'),fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(archive,'README.txt'),'原始加密账号与可用的浏览器密钥文件已保留。跨机恢复请在原电脑导出口令加密 .tbb 备份，再在新电脑导入。此目录含敏感加密材料，请勿上传或公开。\n');
    this.readOnly=false;
    try{this.commit({schema:1,accounts:[],settings:{...DEFAULT_SETTINGS}});}catch(e){this.readOnly=true;throw e;}
    this.warnings=[`原始配置已归档到 ${archive}。现在可以导入口令加密备份，或添加新账号；网页登录需重新进行。`];
    return archive;
  }
  commit(next: StoreData): void {
    if(this.readOnly) throw new AppError('data','配置处于保护性只读模式，未覆盖原始文件。请查看顶部的数据恢复提示。');
    validateStore(next);
    const serialized = JSON.stringify(next);
    if(Buffer.byteLength(serialized)>8*1024*1024)throw new AppError('data','配置总量超过 8 MB，请减少过大的请求头或账号数量。');
    const ciphertext = this.codec.encrypt(serialized);
    const temp = this.file + '.tmp';
    try {
      const fd = fs.openSync(temp,'w',0o600);
      try { fs.writeFileSync(fd, JSON.stringify({version:1,encrypted:ciphertext.toString('base64')})); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if(fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
      fs.renameSync(temp,this.file);
      this.data = next;
    } catch { throw new AppError('data','无法写入配置，请确认程序位于可写文件夹且磁盘空间充足。'); }
  }
}
const derive = (password: string, salt: Buffer): Promise<Buffer> => new Promise((resolve,reject) => scrypt(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024},(err,key)=>err?reject(err):resolve(key)));
export async function encodeBackup(data: StoreData, password: string): Promise<string> {
  if(typeof password !== 'string' || password.length < 10 || password.length > 1024) throw new AppError('backup','备份口令至少需要 10 个字符。');
  const salt=randomBytes(16),iv=randomBytes(12),key=await derive(password,salt);
  try { const c=createCipheriv('aes-256-gcm',key,iv); const dataBytes=Buffer.concat([c.update(JSON.stringify(data),'utf8'),c.final()]); return JSON.stringify({format:'123tokenbalance-backup',version:1,kdf:'scrypt-32768-8-1',salt:salt.toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:dataBytes.toString('base64')},null,2); } finally { key.fill(0); }
}
export async function decodeBackup(input: string, password: string): Promise<StoreData> {
  if(typeof password !== 'string' || password.length > 1024 || input.length > 16*1024*1024) throw new AppError('backup','备份或口令无效。');
  try {
    const v=JSON.parse(input);
    if(v.format!=='123tokenbalance-backup'||v.version!==1||v.kdf!=='scrypt-32768-8-1') throw new Error('format');
    const salt=Buffer.from(v.salt,'base64'),iv=Buffer.from(v.iv,'base64'),tag=Buffer.from(v.tag,'base64');
    if(salt.length!==16||iv.length!==12||tag.length!==16) throw new Error('format');
    const key=await derive(password,salt);
    try {const c=createDecipheriv('aes-256-gcm',key,iv);c.setAuthTag(tag); const parsed:unknown=JSON.parse(Buffer.concat([c.update(Buffer.from(v.data,'base64')),c.final()]).toString('utf8')); validateStore(parsed);return parsed;} finally {key.fill(0);}
  } catch {throw new AppError('backup','无法打开备份：口令错误、文件损坏或格式不受支持。现有账号未修改。');}
}
