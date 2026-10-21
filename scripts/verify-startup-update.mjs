import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const qa=path.resolve('artifacts/qa'),source=path.resolve('artifacts/package/win-unpacked');
const base=fs.mkdtempSync(path.join(qa,'native-lifecycle-')),target=path.join(base,'程序 中文 space');
const report={version:JSON.parse(fs.readFileSync('package.json','utf8')).version,startedAt:new Date().toISOString(),cases:[],base};
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];
env.PATH=`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
fs.cpSync(source,target,{recursive:true});
const exe=()=>path.join(target,'123TokenBalance.exe');
const data=path.join(target,'data');
function processRun(file,args){const child=spawn(file,args,{env,cwd:base,stdio:'ignore',windowsHide:true});const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});return{child,done};}
async function bounded(promise,ms=65000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Verification timed out')),ms);})]);}finally{clearTimeout(timer);}}
async function poll(fn,ms=15000){const start=Date.now();while(Date.now()-start<ms){const value=await fn();if(value)return value;await delay(100);}throw new Error('Condition timed out');}
async function diagnostic(label){const output=path.join(base,`${label}.tsv`);const p=processRun(exe(),[`--diagnose-output=${output}`,`--data-dir=${data}`]);const code=await bounded(p.done);return{code,text:fs.readFileSync(output,'utf8')};}
async function connect(){const file=path.join(data,'runtime','DevToolsActivePort');const port=await poll(()=>{try{return fs.readFileSync(file,'utf8').split('\n')[0];}catch{return false;}});const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const page=await poll(()=>browser.contexts()[0]?.pages().find(p=>p.url().startsWith('file:')));await page.getByRole('heading',{name:'额度总览.'}).waitFor();return{browser,page};}
async function start(){fs.rmSync(path.join(data,'runtime','DevToolsActivePort'),{force:true});const run=processRun(exe(),['--remote-debugging-port=0']);const ui=await connect();assert.equal(await bounded(run.done),0);return ui;}
async function close(ui){const stopped=new Promise(resolve=>ui.browser.once('disconnected',resolve));await ui.page.evaluate(()=>window.close()).catch(()=>{});await bounded(stopped,10000);await delay(700);}
async function markStage(stage){const files=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);fs.writeFileSync(path.join(stage,'VERSION.txt'),report.version+'\nWindows x64 portable\n');const list=files(stage).filter(f=>path.basename(f)!=='SHA256SUMS.txt');const text=list.map(file=>`${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.relative(stage,file).replaceAll('\\','/')}`).sort().join('\n')+'\n';fs.writeFileSync(path.join(stage,'SHA256SUMS.txt'),text);return crypto.createHash('sha256').update(text).digest('hex');}
let ui;
try{
  const clean=await diagnostic('clean');assert.equal(clean.code,0);assert(clean.text.includes('pass\truntime'));report.cases.push('native preflight with restricted PATH');
  fs.renameSync(path.join(target,'ffmpeg.dll'),path.join(target,'ffmpeg.dll.saved'));try{const missing=await diagnostic('missing');assert.equal(missing.code,1);assert(missing.text.includes('缺少 ffmpeg.dll'));}finally{fs.renameSync(path.join(target,'ffmpeg.dll.saved'),path.join(target,'ffmpeg.dll'));}report.cases.push('missing runtime file gives actionable diagnostic');
  const pak=path.join(target,'locales','zh-CN.pak'),pakBytes=fs.readFileSync(pak);fs.appendFileSync(pak,'x');try{const damaged=await diagnostic('damaged');assert.equal(damaged.code,1);assert(damaged.text.includes('尺寸不符'));}finally{fs.writeFileSync(pak,pakBytes);}report.cases.push('damaged runtime size detected');
  ui=await start();let state=await ui.page.evaluate(()=>window.tokenBalance.state());assert.equal(state.version,report.version);assert.equal(state.dataPath,data);assert.equal(state.readOnly,false);assert(state.environment.checks.some(c=>c.id==='runtime-deps'));
  await ui.page.getByRole('button',{name:'添加账号',exact:true}).first().click();await ui.page.getByRole('combobox',{name:'平台模板'}).click();await ui.page.getByRole('option',{name:'DeepSeek',exact:true}).click();await ui.page.getByLabel('账号标识 *').fill('native-portable@example.invalid');await ui.page.getByLabel('API Key / OAuth Access Token',{exact:true}).fill('dummy-native-portable-secret');await ui.page.getByRole('switch',{name:'参与全部刷新'}).click();await ui.page.getByRole('button',{name:'保存账号',exact:true}).click();await ui.page.getByRole('dialog').waitFor({state:'hidden'});
  const account=(await ui.page.evaluate(()=>window.tokenBalance.state())).accounts[0];await close(ui);ui=null;report.cases.push('real native launcher to Electron UI handshake, Chinese path, different working directory');
  // Exercise directory replacement against real binaries; no fabricated public version.
  const stage=fs.mkdtempSync(path.join(base,'.123TokenBalance-update-'));fs.cpSync(source,stage,{recursive:true});const digest=await markStage(stage);const helper=path.join(base,'UpdateHelper.exe');fs.copyFileSync(exe(),helper);
  const install=processRun(helper,['--apply-update',target,stage,'4294967294',data,digest]);assert.equal(await bounded(install.done),0);
  assert(fs.readdirSync(base).some(n=>n.startsWith('程序 中文 space.backup-')));report.cases.push('native installation switches directories and retains previous full program');
  // The updater starts the app without a debug port. Reopening forwards to it, so
  // close that exact window through the Win32 test helper, then inspect normally.
  const closeScript=path.resolve('scripts/close-test-window.ps1');
  const ps=processRun(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-File',closeScript,'-Executable',path.join(target,'123TokenBalance.App.exe')]);assert.equal(await bounded(ps.done,15000),0);await delay(700);
  ui=await start();state=await ui.page.evaluate(()=>window.tokenBalance.state());assert.equal(state.accounts[0].id,account.id);const secrets=await ui.page.evaluate(a=>window.tokenBalance.reveal(a.id,a.revision),state.accounts[0]);assert.equal(secrets.secret,'dummy-native-portable-secret');await close(ui);ui=null;report.cases.push('encrypted account, stable UUID and credential survive native update');
  // Fail after package hashing but before readiness: a byte-valid ZIP can still
  // be internally incomplete. The native bootstrap must reject and roll back.
  const badStage=fs.mkdtempSync(path.join(base,'.123TokenBalance-update-'));fs.cpSync(source,badStage,{recursive:true});fs.unlinkSync(path.join(badStage,'ffmpeg.dll'));const badDigest=await markStage(badStage);
  const rollback=processRun(helper,['--apply-update',target,badStage,'4294967294',data,badDigest]);await poll(()=>fs.readdirSync(base).some(n=>n.startsWith('程序 中文 space.failed-')),30000);
  const closeHelper=processRun(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-File',closeScript,'-Executable',helper]);assert.equal(await bounded(closeHelper.done,15000),0);assert.equal(await bounded(rollback.done,15000),1);
  const closeRestored=processRun(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-File',closeScript,'-Executable',path.join(target,'123TokenBalance.App.exe')]);assert.equal(await bounded(closeRestored.done,15000),0);await delay(700);
  ui=await start();state=await ui.page.evaluate(()=>window.tokenBalance.state());assert.equal(state.accounts[0].id,account.id);await close(ui);ui=null;report.cases.push('invalid new runtime triggers rollback with original encrypted data intact');
  const hangStage=fs.mkdtempSync(path.join(base,'.123TokenBalance-update-'));fs.cpSync(source,hangStage,{recursive:true});
  const hanging=path.resolve('artifacts/native/no-ready.exe');assert(fs.existsSync(hanging),'Build the no-ready fixture with node scripts/build-launcher.mjs --fixtures');
  fs.copyFileSync(hanging,path.join(hangStage,'123TokenBalance.App.exe'));
  const runtimeFile=path.join(hangStage,'runtime-files.txt');fs.writeFileSync(runtimeFile,fs.readFileSync(runtimeFile,'utf8').replace(/^\d+\t123TokenBalance.App.exe$/m,`${fs.statSync(hanging).size}\t123TokenBalance.App.exe`));
  const hangDigest=await markStage(hangStage),failedBefore=fs.readdirSync(base).filter(n=>n.includes('.failed-')).length;
  const hangInstall=processRun(helper,['--apply-update',target,hangStage,'4294967294',data,hangDigest]);
  await poll(()=>fs.readdirSync(base).filter(n=>n.includes('.failed-')).length>failedBefore,65000);
  const closeHangHelper=processRun(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-File',closeScript,'-Executable',helper]);await bounded(closeHangHelper.done,15000);assert.equal(await bounded(hangInstall.done,15000),1);
  const closeHangRestored=processRun(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-File',closeScript,'-Executable',path.join(target,'123TokenBalance.App.exe')]);await bounded(closeHangRestored.done,15000);await delay(700);
  ui=await start();state=await ui.page.evaluate(()=>window.tokenBalance.state());assert.equal(state.accounts[0].id,account.id);await close(ui);ui=null;report.cases.push('no-window no-ready child times out; owned process tree released and original app/data restored');
  // A foreign-machine DPAPI Local State fixture must be archived before Chromium starts.
  fs.writeFileSync(path.join(data,'runtime','Local State'),JSON.stringify({os_crypt:{encrypted_key:Buffer.from('DPAPIforeign-machine-invalid-key').toString('base64')}}));
  const foreign=await diagnostic('foreign-key');assert.equal(foreign.code,0);assert(foreign.text.includes('跨机浏览器配置'));assert(fs.readdirSync(data).some(n=>n.startsWith('runtime-unreadable-')));
  ui=await start();state=await ui.page.evaluate(()=>window.tokenBalance.state());assert.equal(state.readOnly,true);assert(fs.existsSync(path.join(data,'accounts.enc.json')));await ui.page.screenshot({path:path.join(qa,`foreign-machine-recovery-${report.version}.png`)});await close(ui);ui=null;report.cases.push('simulated foreign DPAPI browser state archived; original accounts preserved and recovery UI opens');
  report.result='passed';
}catch(error){report.result='failed';report.error=error.stack;throw error;}
finally{if(ui)await close(ui).catch(()=>{});report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(qa,`native-lifecycle-${report.version}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
