import { describe,it,expect,vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { releaseCandidate,newer,safeArchivePath } from '../../electron/update-contract';
import { extractUpdate } from '../../electron/update-archive';
import { githubFetch,Updater } from '../../electron/updater';
import { startupArgument,resolveDataPath } from '../../electron/environment';
import { REPOSITORY } from '../../src/core/system';
import { releaseFixture,zipFixture } from '../fixtures/zip';
const meta=(bytes=100,sha256='a'.repeat(64))=>({draft:false,prerelease:false,tag_name:'v1.3.0',html_url:`${REPOSITORY}/releases/tag/v1.3.0`,body:'New version',assets:[{name:'123TokenBalance-1.3.0-win-x64.zip',state:'uploaded',size:bytes,digest:`sha256:${sha256}`,browser_download_url:`${REPOSITORY}/releases/download/v1.3.0/123TokenBalance-1.3.0-win-x64.zip`}]});
describe('pinned GitHub stable release contract',()=>{
  it('compares versions numerically and rejects ambiguous versions',()=>{expect(newer('1.10.0','1.9.9')).toBe(true);expect(newer('1.2.0','1.2.0')).toBe(false);expect(newer('1.1.9','1.2.0')).toBe(false);expect(()=>newer('1.3.0-beta','1.2.0')).toThrow();expect(()=>newer('01.3.0','1.2.0')).toThrow();});
  it('accepts a uniquely named uploaded asset with GitHub SHA-256',()=>{expect(releaseCandidate(meta(),'1.2.0')?.version).toBe('1.3.0');expect(releaseCandidate(meta(),'1.3.0')).toBe(null);});
  it.each(['draft','prerelease'] as const)('rejects %s releases',key=>{const value=meta();value[key]=true;expect(()=>releaseCandidate(value,'1.2.0')).toThrow();});
  it('rejects external repositories, ambiguous assets, missing digests and oversize downloads',()=>{
    const url=meta();url.assets[0].browser_download_url='https://evil.example/update.zip';expect(()=>releaseCandidate(url,'1.2.0')).toThrow();
    const duplicate=meta();duplicate.assets.push(duplicate.assets[0]);expect(()=>releaseCandidate(duplicate,'1.2.0')).toThrow();
    const digest=meta();digest.assets[0].digest='';expect(()=>releaseCandidate(digest,'1.2.0')).toThrow();expect(()=>releaseCandidate(meta(800*1024*1024),'1.2.0')).toThrow();
  });
  it('blocks unsafe redirect before requesting the redirected host',async()=>{const fetcher=vi.fn(async()=>new Response(null,{status:302,headers:{location:'https://evil.example/private'}}));await expect(githubFetch(REPOSITORY,AbortSignal.timeout(1000),fetcher)).rejects.toThrow('不受信任');expect(fetcher).toHaveBeenCalledTimes(1);});
  it('uses explicit HTTPS only and no credentials on approved CDN redirects',async()=>{const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/test'}})).mockResolvedValueOnce(new Response('ok'));expect(await(await githubFetch(REPOSITORY,AbortSignal.timeout(1000),fetcher)).text()).toBe('ok');expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty('Authorization');await expect(githubFetch('http://github.com',AbortSignal.timeout(1000),fetcher)).rejects.toThrow();});
});
describe('ZIP extraction boundaries',()=>{
  const root='123TokenBalance-1.3.0-win-x64';
  it.each(['../escape','a/../../escape','C:/evil','a\\b','/absolute','NUL.txt','x:stream','a.','data/secret','DATA/secret','.git/config'])('rejects %s',bad=>expect(()=>safeArchivePath(`${root}/${bad}`,root)).toThrow());
  async function unpack(bytes:Buffer){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tb-zip-test-')),zip=path.join(dir,'test.zip'),stage=path.join(dir,'stage');fs.mkdirSync(stage);fs.writeFileSync(zip,bytes);try{return await extractUpdate(zip,stage,root);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
  it('validates every hash and version of a complete package',async()=>expect(await unpack(releaseFixture())).toMatch(/^[a-f0-9]{64}$/));
  it('rejects a corrupt file despite a valid archive',async()=>await expect(unpack(releaseFixture('1.3.0',files=>{files[0].content='tampered';}))).rejects.toThrow('哈希'));
  it('rejects unlisted payloads',async()=>await expect(unpack(releaseFixture('1.3.0',files=>files.push({name:'unknown.exe',content:'payload'})))).rejects.toThrow('未列入'));
  it('rejects duplicate case-insensitive paths',async()=>await expect(unpack(zipFixture([{name:root+'/a',content:'one'},{name:root+'/A',content:'two'}]))).rejects.toThrow('大小写'));
  it('rejects symbolic links',async()=>await expect(unpack(zipFixture([{name:root+'/link',content:'target',attributes:(0xa1ff<<16)>>>0}]))).rejects.toThrow('链接'));
  it('rejects traversal without writing outside the staging directory',async()=>await expect(unpack(zipFixture([{name:root+'/../escaped.txt',content:'bad'}]))).rejects.toThrow());
});
describe('updater lifecycle and errors',()=>{
  function fixture(fetcher:(url:string,init:RequestInit)=>Promise<Response>){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tb-update-test-')),root=path.join(dir,'app'),dataPath=path.join(root,'data');fs.mkdirSync(dataPath,{recursive:true});const install=vi.fn(async()=>{}),notify=vi.fn();const updater=new Updater({version:'1.2.0',root,dataPath,local:dir,packaged:true,notify,install,fetcher});return{dir,root,dataPath,updater,install};}
  it('keeps the current app and data intact when SHA-256 verification fails',async()=>{const bytes=Buffer.from('badzip'),f=fixture(async url=>url.includes('api.github.com')?Response.json(meta(bytes.length)):new Response(new Uint8Array(bytes)));fs.writeFileSync(path.join(f.dataPath,'untouched'),'keep');try{expect((await f.updater.check()).phase).toBe('available');expect((await f.updater.download()).phase).toBe('error');expect(f.updater.state.message).toContain('SHA-256');expect(fs.readFileSync(path.join(f.dataPath,'untouched'),'utf8')).toBe('keep');expect(f.install).not.toHaveBeenCalled();}finally{fs.rmSync(f.dir,{recursive:true,force:true});}});
  it('downloads, validates and stages a real fixture without stopping the current process',async()=>{const bytes=releaseFixture(),hash=createHash('sha256').update(bytes).digest('hex'),f=fixture(async url=>url.includes('api.github.com')?Response.json(meta(bytes.length,hash)):new Response(new Uint8Array(bytes)));try{await f.updater.check();expect((await f.updater.download()).phase).toBe('ready');const stage=fs.readdirSync(f.dir).find(n=>n.startsWith('.123TokenBalance-update-'))!;expect(fs.existsSync(path.join(f.dir,stage,'resources/app.asar'))).toBe(true);expect(f.install).not.toHaveBeenCalled();}finally{fs.rmSync(f.dir,{recursive:true,force:true});}});
  it('reports offline, GitHub rate limiting and missing releases',async()=>{for(const [status,message]of [[403,'受限'],[404,'暂未发布']] as const){const f=fixture(async()=>new Response(null,{status}));try{expect((await f.updater.check()).phase).toBe('error');expect(f.updater.state.message).toContain(message);}finally{fs.rmSync(f.dir,{recursive:true,force:true});}}const f=fixture(async()=>{throw new TypeError('fetch failed');});try{expect((await f.updater.check()).message).toContain('无法连接');}finally{fs.rmSync(f.dir,{recursive:true,force:true});}});
  it('serializes concurrent checks',async()=>{let complete!:(r:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(r=>complete=r)),f=fixture(fetcher);try{const first=f.updater.check();await f.updater.check();complete(Response.json(meta()));await first;expect(fetcher).toHaveBeenCalledTimes(1);}finally{fs.rmSync(f.dir,{recursive:true,force:true});}});
});
describe('startup configuration',()=>{
  it('limits launcher handshake paths to the local diagnostic directory',()=>{const local=path.resolve('local-fixture'),file=path.join(local,'123TokenBalance/logs/startup-20261019-1.ready');expect(startupArgument([`--startup-ready=${file}`],'ready',local)).toBe(file);expect(startupArgument(['--startup-ready=C:\\other\\file'],'ready',local)).toBeUndefined();});
  it('uses current-user fallback if the default data path is a file',()=>{const base=fs.mkdtempSync(path.join(os.tmpdir(),'tb-env-')),root=path.join(base,'app');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'data'),'occupied');try{const result=resolveDataPath(root,undefined,base);expect(result.fallback).toBe(true);expect(result.dataPath).toContain('portable-');expect(()=>resolveDataPath(root,path.join(root,'data'),base)).toThrow('不可写');}finally{fs.rmSync(base,{recursive:true,force:true});}});
});
