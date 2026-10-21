// Uses an isolated copy of this application's own data. Outputs no account, credential or metric values.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {_electron} from 'playwright';
import {build} from 'esbuild';
const original=path.resolve(process.argv.slice(2).find(v=>!v.startsWith('--'))??'D:/Program Files/123TokenBalance/data');
const qa=path.resolve('artifacts/qa');
const isolated=fs.mkdtempSync(path.join(qa,'private-local-refresh-'));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before=Object.fromEntries(['accounts.enc.json','accounts.enc.json.bak'].filter(name=>fs.existsSync(path.join(original,name))).map(name=>[name,sha(path.join(original,name))]));
for(const name of ['accounts.enc.json','accounts.enc.json.bak','runtime'])if(fs.existsSync(path.join(original,name)))fs.cpSync(path.join(original,name),path.join(isolated,name),{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
  app=await _electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[path.resolve('.'),`--data-dir=${isolated}`],env});
  const page=await app.firstWindow();await page.getByRole('heading',{name:'额度总览.'}).waitFor();
  await page.evaluate(async()=>{const s=await window.tokenBalance.state();await window.tokenBalance.settings({...s.settings,intervalMinutes:0});});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.hide()));
  const report=await page.evaluate(async()=>{
    const before=await window.tokenBalance.state();
    await window.tokenBalance.refresh();const after=await window.tokenBalance.state();
    return {version:after.version,readOnly:after.readOnly,accounts:after.accounts.map((a,i)=>({row:i+1,provider:a.providerId,engine:a.engine,status:a.status,errorClass:/登录|授权|会话/.test(a.error??'')?'authentication':/完整|识别|字段/.test(a.error??'')?'incomplete-or-mapping':/网络|连接|HTTP|超时/.test(a.error??'')?'network':a.error?'other':undefined,beforePeriods:before.accounts[i].snapshot?.metrics.map(m=>m.period),afterPeriods:a.snapshot?.metrics.map(m=>m.period),resetPeriods:a.snapshot?.metrics.filter(m=>m.resetsAt).map(m=>m.period),fetchedThisRun:a.status==='ok'&&a.snapshot?.fetchedAt!==before.accounts[i].snapshot?.fetchedAt,retainedOnFailure:a.status==='error'?JSON.stringify(a.snapshot)===JSON.stringify(before.accounts[i].snapshot):undefined}))};
  });
  if(process.argv.includes('--inspect-web')){
    const bundle=await build({entryPoints:['src/core/capture.ts'],bundle:true,format:'iife',globalName:'CaptureProbe',write:false,platform:'browser'});
    const accounts=(await page.evaluate(()=>window.tokenBalance.state())).accounts.filter(a=>a.engine==='browser');
    report.webStructure=await app.evaluate(async({BrowserWindow,session},{accounts,probe})=>{
      const result=[];
      const clean=text=>text.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g,'[email]').replace(/https?:\/\/\S+/g,'[url]').replace(/[a-zA-Z0-9_-]{18,}/g,'[redacted]').replace(/\d/g,'#').slice(0,220);
      for(const a of accounts){
        const win=new BrowserWindow({show:false,webPreferences:{session:session.fromPartition('persist:account-'+(a.browserSessionId??a.id)),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
        try{await win.loadURL(a.infoUrl);await new Promise(resolve=>setTimeout(resolve,2200));const scan=await win.webContents.executeJavaScriptInIsolatedWorld(999,[{code:probe+";(()=>{const s=CaptureProbe.collectVisiblePage();try{s.recognized=CaptureProbe.recognizePage(s,'probe').draft.mappings;}catch{};return s;})()"}]);result.push({provider:a.providerId,mapped:scan.recognized?.map(m=>({period:m.period,kind:m.kind,text:clean(scan.fields.find(f=>f.selector===m.valuePath)?.text??''),context:clean(scan.fields.find(f=>f.selector===m.valuePath)?.context??'')})),fields:scan.fields.filter(f=>/重置|刷新|用量|额度|使用|剩余|周|小时|天|reset|weekly|hours|usage|remaining|[%％]/i.test(f.text)).map(f=>({text:clean(f.text),context:clean(f.context),tag:f.tag})).slice(0,70)});}catch{result.push({provider:a.providerId,error:'page-not-readable'});}finally{win.destroy();}
      }
      return result;
    },{accounts,probe:bundle.outputFiles[0].text});
  }
  await app.close();app=undefined;
  report.originalAccountFilesUnchanged=Object.entries(before).every(([name,hash])=>sha(path.join(original,name))===hash);
  report.checkedAt=new Date().toISOString();report.scope='One live read-only refresh using isolated copy; no long-term or cross-machine acceptance.';
  fs.writeFileSync(path.join(qa,'local-refresh-1.3.0.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
  if(app)await app.close();
  if(path.dirname(isolated)!==qa||!path.basename(isolated).startsWith('private-local-refresh-'))throw new Error('Unexpected private cleanup target');
  for(let attempt=0;;attempt++){try{fs.rmSync(isolated,{recursive:true,force:true});break;}catch(e){if(attempt>=20)throw e;await new Promise(resolve=>setTimeout(resolve,250));}}
}
