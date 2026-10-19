import { describe,it,expect,vi } from 'vitest';
import { mkdtempSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID,createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { Repository,encodeBackup,decodeBackup,validateStore } from '../../electron/repository';
import { requestOptions,query } from '../../electron/transport';
import { createAccount } from '../../src/core/providers';
import { DEFAULT_SETTINGS } from '../../src/core/types';
import { parseHeaders,publicAccount,safeUrl,validateAccount } from '../../src/core/validation';
import { toCsv } from '../../electron/csv';
const account=()=>({...createAccount('deepseek'),id:randomUUID(),revision:1,account:'=FORMULA',secret:'dummy-test-key'});
const store=()=>({schema:1 as const,accounts:[account()],settings:{...DEFAULT_SETTINGS}});
describe('request boundaries',()=>{
  it.each(['http://example.com','file:///c:/secret','javascript:alert(1)','https://user:pass@example.com'])('rejects unsafe URL %s',url=>expect(()=>safeUrl(url)).toThrow());
  it('permits explicit HTTPS custom endpoints',()=>expect(safeUrl('https://my-platform.example/usage').hostname).toBe('my-platform.example'));
  it('rejects header injection and transport override',()=>{expect(()=>parseHeaders('{"Host":"evil"}')).toThrow();expect(()=>parseHeaders(JSON.stringify({'X-Test':'a\r\nb'}))).toThrow();});
  it('credentials are not exposed by list API',()=>{const a=publicAccount({...account(),headers:'{"Cookie":"dummy"}'});expect(a.secret).toBe('');expect(a.headers).toBe('');expect(a.hasSecret).toBe(true);});
  it('bearer has one prefix and requests do not follow redirects',()=>{const opts=requestOptions({...account(),secret:'Bearer dummy'});expect(new Headers(opts.headers).get('Authorization')).toBe('Bearer dummy');expect(opts.redirect).toBe('manual');expect(opts.credentials).toBe('omit');});
  it('never follows redirect to another domain',async()=>{const fetch=vi.fn(async()=>new Response('',{status:302,headers:{Location:'https://evil.example/'}}));await expect(query(account(),fetch,vi.fn())).rejects.toThrow('重定向');expect(fetch).toHaveBeenCalledTimes(1);});
  it.each([401,403])('HTTP %s is a clear auth error',async status=>{await expect(query(account(),async()=>new Response('private',{status}),vi.fn())).rejects.toThrow('授权');});
  it('honors bounded 429 cooldown',async()=>{await expect(query(account(),async()=>new Response('',{status:429,headers:{'Retry-After':'120'}}),vi.fn())).rejects.toMatchObject({retrySeconds:120});});
  it('rejects oversized responses',async()=>{await expect(query(account(),async()=>new Response('',{headers:{'content-length':'999999999'}}),vi.fn())).rejects.toThrow('过大');});
  it('does not echo provider response or network secret',async()=>{await expect(query(account(),async()=>{throw new Error('dummy-test-key');},vi.fn())).rejects.not.toThrow('dummy-test-key');});
  it('identifies HTML at a JSON endpoint',async()=>{await expect(query(account(),async()=>new Response('<html>Login</html>'),vi.fn())).rejects.toThrow('不是 JSON');});
  it('rejects unresolved organization placeholder',()=>expect(()=>validateAccount({...createAccount('claude-web'),account:'a'})).toThrow('orgId'));
});
describe('encrypted portable backup',()=>{
  it('roundtrips and rejects wrong password or modified ciphertext',async()=>{const s=store();const encoded=await encodeBackup(s,'a-long-test-password');expect(encoded).not.toContain('dummy-test-key');expect(await decodeBackup(encoded,'a-long-test-password')).toEqual(s);await expect(decodeBackup(encoded,'wrong-password')).rejects.toThrow('口令错误');const tampered=JSON.parse(encoded);tampered.tag=randomBytes(16).toString('base64');await expect(decodeBackup(JSON.stringify(tampered),'a-long-test-password')).rejects.toThrow();});
  it('requires a nontrivial password and fixed KDF',async()=>{await expect(encodeBackup(store(),'short')).rejects.toThrow('10');await expect(decodeBackup('{"format":"bad"}','long-password')).rejects.toThrow();});
  it('rejects duplicate identities in imported data',()=>{const s=store();s.accounts.push(s.accounts[0]);expect(()=>validateStore(s)).toThrow('ID');});
});
describe('durable encrypted repository',()=>{
  const key=randomBytes(32);
  const codec={encrypt:(s:string)=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(s),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]);},decrypt:(v:Buffer)=>{const c=createDecipheriv('aes-256-gcm',key,v.subarray(0,12));c.setAuthTag(v.subarray(12,28));return Buffer.concat([c.update(v.subarray(28)),c.final()]).toString();}};
  it('never writes plaintext and reloads',()=>{const file=path.join(mkdtempSync(path.join(tmpdir(),'tb-unit-')),'accounts.enc.json');const repo=new Repository(file,codec);const s=store();repo.commit(s);expect(readFileSync(file,'utf8')).not.toContain('dummy-test-key');expect(new Repository(file,codec).data.accounts[0].secret).toBe('dummy-test-key');});
  it('damaged primary uses previous backup in read-only mode without overwriting evidence',()=>{const file=path.join(mkdtempSync(path.join(tmpdir(),'tb-unit-')),'accounts.enc.json');const repo=new Repository(file,codec);repo.commit(store());repo.commit({...repo.data,settings:{...DEFAULT_SETTINGS,intervalMinutes:30}});writeFileSync(file,'broken');const recovered=new Repository(file,codec);expect(recovered.readOnly).toBe(true);expect(recovered.data.settings.intervalMinutes).toBe(15);expect(()=>recovered.commit(store())).toThrow('只读');expect(readFileSync(file,'utf8')).toBe('broken');});
  it('CSV escapes formula injection and omits secrets',()=>{const a={...account(),snapshot:{plan:'Pro',planSource:'api' as const,source:'api' as const,fetchedAt:new Date().toISOString(),metrics:[{label:'balance',period:'balance' as const,unit:'CNY',remaining:8}]}};const csv=toCsv([a]);expect(csv).toContain("'=FORMULA");expect(csv).not.toContain('dummy-test-key');});
});
