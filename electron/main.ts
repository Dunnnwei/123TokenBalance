import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell, clipboard, nativeImage, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { Account, AppState, Settings, Snapshot } from '../src/core/types';
import { errorMessage, AppError, safeUrl, validateAccount } from '../src/core/validation';
import { withBackgroundBrowser } from './browser-reader';
import { Repository, encodeBackup, decodeBackup } from './repository';
import { AccountService } from './service';
import { parseSample, query } from './transport';
import { toCsv } from './csv';
import { CaptureManager } from './capture-manager';
import { parseAgentConfig } from '../src/core/agent-config';
import { publicAccount } from '../src/core/validation';
import { environmentReport,resolveDataPath,startupArgument } from './environment';
import { Updater } from './updater';
import type { EnvironmentReport } from '../src/core/system';

app.setName('123TokenBalance');
app.disableHardwareAcceleration();
const appRoot=app.isPackaged?path.dirname(app.getPath('exe')):app.getAppPath();
const local=process.env.LOCALAPPDATA??app.getPath('appData');
const argument = process.argv.find(a=>a.startsWith('--data-dir='))?.slice(11);
let dataPath='',fallback=false;
try {const resolved=resolveDataPath(appRoot,argument,local);dataPath=resolved.dataPath;fallback=resolved.fallback;app.setPath('userData',path.join(dataPath,'runtime'));}
catch {dialog.showErrorBox('无法创建数据目录','请将完整程序放到可写文件夹，或使用 --data-dir 指定当前用户可写目录。');app.exit(1);}
const nativeReport=startupArgument(process.argv,'report',local),readyFile=startupArgument(process.argv,'ready',local);
const logDir=path.join(dataPath,'logs'),startupLog=path.join(logDir,'startup.log');
function log(event:string,detail=''){try{fs.mkdirSync(logDir,{recursive:true});if(fs.existsSync(startupLog)&&fs.statSync(startupLog).size>512*1024)fs.renameSync(startupLog,path.join(logDir,`startup-${Date.now()}.log`));fs.appendFileSync(startupLog,`${new Date().toISOString()} ${event} ${detail}\n`);}catch{}}
log('starting',`version=${app.getVersion()} software-rendering=true`);
function signalReady(){if(readyFile)try{fs.writeFileSync(readyFile,'ready\n',{flag:'wx'});}catch{}log('ready');}
let main:BrowserWindow|null=null;let service:AccountService;let repository:Repository;
let environment:EnvironmentReport;let updater:Updater;let startupTimer:NodeJS.Timeout|undefined;let quitting=false;
let captures:CaptureManager;
const windows=new Map<string,BrowserWindow>();
let scheduler:NodeJS.Timeout|undefined;let backupBusy=false;
const uiFile=path.join(__dirname,'../dist/index.html');
const version=app.getVersion();
function inspectEnvironment(){environment=environmentReport({root:appRoot,dataPath,packaged:app.isPackaged,secure:safeStorage.isEncryptionAvailable(),readOnly:repository.readOnly,fallback,nativeReport,logPath:startupLog});return environment;}
function state():AppState {return{schema:1,accounts:service.list(),settings:repository.data.settings,version,dataPath,secureStorage:safeStorage.isEncryptionAvailable(),warnings:repository.warnings,readOnly:repository.readOnly,environment};}
function changed(){if(main&&!main.isDestroyed())main.webContents.send('tb:changed',state());}
function account(id:unknown):Account {if(typeof id!=='string')throw new AppError('config','账号 ID 无效。');const a=repository.data.accounts.find(a=>a.id===id);if(!a)throw new AppError('config','账号已不存在。');return a;}
const configuredSessions=new Set<string>();
function sessionFor(id:string){const s=session.fromPartition(`persist:account-${id}`);if(!configuredSessions.has(id)){configuredSessions.add(id);s.setPermissionRequestHandler((_w,_p,cb)=>cb(false));s.setPermissionCheckHandler(()=>false);s.on('will-download',event=>event.preventDefault());}return s;}
const allowedNavigation=(url:string)=>{try{return safeUrl(url).protocol==='https:';}catch{return false;}};
function secureRemote(contents:WebContents){
  contents.on('will-navigate',(e,url)=>{if(!allowedNavigation(url))e.preventDefault();});
  contents.on('will-redirect',(e,url)=>{if(!allowedNavigation(url))e.preventDefault();});
  contents.setWindowOpenHandler(({url})=>allowedNavigation(url)?{action:'allow',overrideBrowserWindowOptions:{autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,preload:undefined}}}:{action:'deny'});
  contents.on('did-create-window',child=>secureRemote(child.webContents));
}
async function login(a:Account):Promise<void>{
  const url=safeUrl(a.infoUrl).toString();let win=windows.get(a.id);
  if(win&&!win.isDestroyed()){win.show();win.focus();return;}
  win=new BrowserWindow({width:1120,height:800,title:`${a.platformName} · ${a.account} — 独立登录`,autoHideMenuBar:true,webPreferences:{session:sessionFor(a.browserSessionId??a.id),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  windows.set(a.id,win);secureRemote(win.webContents);win.on('closed',()=>windows.delete(a.id));
  await win.loadURL(url).catch(()=>{throw new AppError('network','登录页面未能打开，请检查网址或网络。');});
}
async function browserRead(a:Account):Promise<Snapshot>{
  const open=windows.get(a.id);
  const remote=captures.remote(a.id)??(open&&!open.isDestroyed()?open.webContents:undefined);
  return withBackgroundBrowser(a,()=>{
    const win=new BrowserWindow({show:false,skipTaskbar:true,webPreferences:{session:sessionFor(a.browserSessionId??a.id),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}});
    secureRemote(win.webContents);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    return win;
  },remote);
}
async function run(a:Account):Promise<Snapshot>{return query(a,(url,options)=>sessionFor(a.browserSessionId??a.id).fetch(url,options),browserRead);}
function startSchedule(){clearInterval(scheduler);const interval=repository.data.settings.intervalMinutes;if(interval>0)scheduler=setInterval(()=>{if(!repository.readOnly)void service.refresh();},interval*60000);}
function handle(name:string,fn:(...args:any[])=>unknown,allowCapture=false){
  ipcMain.handle('tb:'+name,async(event,...args)=>{
    const trustedMain=!!main&&event.sender===main.webContents&&event.senderFrame===main.webContents.mainFrame&&event.senderFrame?.url===pathToFileURL(uiFile).href;
    if(!trustedMain&&!(allowCapture&&captures.owns(event.sender,event.senderFrame,args[0])))return{ok:false,error:'请求来源无效。'};
    try{return{ok:true,value:await fn(...args)};}catch(e){return{ok:false,error:errorMessage(e)};}
  });
}
function register(){
  handle('ready',()=>{clearTimeout(startupTimer);signalReady();});
  handle('environment',()=>inspectEnvironment());
  handle('openDiagnostics',async()=>{fs.mkdirSync(logDir,{recursive:true});const error=await shell.openPath(nativeReport?path.dirname(nativeReport):logDir);if(error)throw new AppError('data','检测日志目录无法打开。');});
  handle('recoverData',async()=>{
    if(!repository.readOnly)return state();
    const answer=await dialog.showMessageBox(main!,{type:'warning',title:'保留原始文件后恢复使用',message:'将原始加密配置完整归档，再创建空配置。',detail:'此操作不会解密另一台电脑的数据。完成后请导入原电脑导出的 .tbb 口令备份，或重新添加账号。原文件保存在 data/recovery-*，不会删除。',buttons:['取消','归档旧配置并恢复'],defaultId:0,cancelId:0,noLink:true});
    if(answer.response!==1)return null;
    repository.archiveAndReset();inspectEnvironment();startSchedule();changed();return state();
  });
  handle('updateState',()=>updater.state);handle('checkUpdate',()=>updater.check());handle('downloadUpdate',()=>updater.download());
  handle('installUpdate',async()=>{if(backupBusy||service.list().some(a=>a.status==='refreshing'))throw new AppError('data','账号刷新或备份仍在进行，请完成后点击应用更新。');return updater.install();});
  handle('state',()=>state());
  handle('reveal',(id:string,revision:number)=>service.reveal(id,revision));
  handle('copy',async(text:string)=>{if(typeof text!=='string'||text.length>4*1024*1024)throw new AppError('config','复制内容无效或超过 4 MB。');await clipboard.writeText(text);});
  handle('chooseLogo',async()=>{
    const selected=await dialog.showOpenDialog(main!,{title:'选择 Logo 图片',properties:['openFile'],filters:[{name:'Logo 图片',extensions:['png','jpg','jpeg','webp']}]});
    if(selected.canceled||!selected.filePaths[0])return null;
    const file=selected.filePaths[0];if(fs.statSync(file).size>4*1024*1024)throw new AppError('config','图片超过 4 MB，请选择较小图片。');
    const data=fs.readFileSync(file);const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=data[0]===255&&data[1]===216,webp=data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
    if(!png&&!jpeg&&!webp)throw new AppError('config','请选择真实 PNG、JPG 或 WebP 图片。');
    const picture=nativeImage.createFromBuffer(data);if(picture.isEmpty())throw new AppError('config','图片无法读取，请换成 PNG 或 JPG。');
    const {width,height}=picture.getSize();if(width>4096||height>4096)throw new AppError('config','图片尺寸超过 4096，请缩小后上传。');
    const small=Math.max(width,height)>256?picture.resize(width>=height?{width:256,quality:'best'}:{height:256,quality:'best'}):picture;
    const result=small.toDataURL();if(result.length>450000)throw new AppError('config','图片内容过大，请使用更简单的 Logo。');return result;
  });
  handle('move',(id:string,targetId:string)=>{service.move(id,targetId);return state();});
  handle('previewConfig',(text:string)=>parseAgentConfig(text).map(publicAccount));
  handle('importConfig',(text:string)=>{service.import({schema:1,accounts:parseAgentConfig(text),settings:repository.data.settings});return state();});
  handle('readConfigFile',async()=>{const selected=await dialog.showOpenDialog(main!,{title:'选择 Agent 生成的 JSON 配置',properties:['openFile'],filters:[{name:'JSON 配置',extensions:['json']}]});if(selected.canceled||!selected.filePaths[0])return null;const file=selected.filePaths[0];if(fs.statSync(file).size>4*1024*1024)throw new AppError('config','配置文件超过 4 MB。');return fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');});
  handle('startCapture',(url:string,targetId?:string,revision?:number)=>{const a=targetId?account(targetId):undefined;if(a&&(a.revision!==revision||a.status==='refreshing'))throw new AppError('conflict','账号已变化或正在刷新，请稍候重新打开。');return captures.start(a?.infoUrl??url,a);});
  handle('captureInfo',(id:string)=>captures.info(id),true);
  handle('navigateCapture',(id:string,url:string)=>captures.navigate(id,url),true);
  handle('readCapture',(id:string)=>captures.read(id),true);
  handle('focusCapture',(id:string)=>captures.focus(id));
  handle('closeCapture',(id:string)=>captures.close(id));
  handle('saveCapture',(id:string,name:string,plan:string,targetId?:string,revision?:number)=>{captures.save(id,name,plan,service,targetId,revision);return state();});
  handle('save',(a:Account)=>{service.save(a);return state();});
  handle('remove',async(id:string)=>{const a=account(id);service.remove(id);windows.get(id)?.close();await sessionFor(a.browserSessionId??id).clearStorageData();return state();});
  handle('refresh',async(ids?:string[])=>{if(ids!==undefined&&(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string')))throw new AppError('config','刷新列表无效。');await service.refresh(ids);return state();});
  handle('settings',(s:Settings)=>{service.settings(s);startSchedule();return state();});
  handle('login',async(id:string)=>login(account(id)));
  handle('clearSession',async(id:string)=>{const a=account(id);windows.get(id)?.close();await sessionFor(a.browserSessionId??id).clearStorageData();await sessionFor(a.browserSessionId??id).clearCache();});
  handle('open',async(url:string)=>{if(typeof url!=='string'||url.length>4096)throw new AppError('config','网址无效。');await shell.openExternal(safeUrl(url).toString());});
  handle('openData',async()=>{const error=await shell.openPath(dataPath);if(error)throw new AppError('data','数据目录无法打开。');});
  handle('preview',(a:Account,sample:string)=>{validateAccount(service.resolve(a));if(typeof sample!=='string')throw new AppError('config','样本无效。');return parseSample(a,sample);});
  handle('test',async(a:Account)=>{const resolved=service.resolve(a);if(!resolved.id)resolved.id='test-'+Date.now();return run(resolved);});
  handle('exportCsv',async()=>{const save=await dialog.showSaveDialog(main!,{title:'导出额度 CSV（包含账号标识，不含密钥）',defaultPath:'额度快照.csv',filters:[{name:'CSV',extensions:['csv']}]});if(save.canceled||!save.filePath)return false;fs.writeFileSync(save.filePath,toCsv(repository.data.accounts),'utf8');return true;});
  handle('exportBackup',async(password:string)=>{
    if(backupBusy)throw new AppError('backup','备份操作正在进行。');backupBusy=true;
    try{const encrypted=await encodeBackup(repository.data,password);const save=await dialog.showSaveDialog(main!,{title:'保存口令加密备份（包含 API 凭据，不含网页登录会话）',defaultPath:'123TokenBalance-backup.tbb',filters:[{name:'加密备份',extensions:['tbb']}]});if(save.canceled||!save.filePath)return false;fs.writeFileSync(save.filePath,encrypted,{encoding:'utf8',mode:0o600});return true;}finally{backupBusy=false;}
  });
  handle('importBackup',async(password:string)=>{
    if(backupBusy)throw new AppError('backup','备份操作正在进行。');backupBusy=true;
    try{const open=await dialog.showOpenDialog(main!,{title:'导入口令加密备份',properties:['openFile'],filters:[{name:'加密备份',extensions:['tbb']}]});if(open.canceled||!open.filePaths[0])return null;const file=open.filePaths[0];if(fs.statSync(file).size>16*1024*1024)throw new AppError('backup','备份超过 16 MB，未读取。');service.import(await decodeBackup(fs.readFileSync(file,'utf8'),password));return state();}finally{backupBusy=false;}
  });
}
if(!app.requestSingleInstanceLock()){signalReady();app.quit();}
else{
  app.on('second-instance',()=>{main?.show();main?.focus();});
  app.whenReady().then(()=>{
    repository=new Repository(path.join(dataPath,'accounts.enc.json'),{encrypt:v=>{if(!safeStorage.isEncryptionAvailable())throw new AppError('crypto','Windows 加密服务不可用，未保存凭据。');return safeStorage.encryptString(v);},decrypt:v=>safeStorage.decryptString(v)});
    service=new AccountService(repository,run,changed);
    inspectEnvironment();
    updater=new Updater({version,root:appRoot,dataPath,local,packaged:app.isPackaged,notify:s=>{if(main&&!main.isDestroyed())main.webContents.send('tb:update',s);},install:async(helper,args)=>{
      await new Promise<void>((resolve,reject)=>{const child=spawn(helper,args,{detached:true,stdio:'ignore',windowsHide:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
      clearInterval(scheduler);setTimeout(()=>app.quit(),150);
    }});
    captures=new CaptureManager(uiFile,path.join(__dirname,'preload.cjs'),sessionFor,secureRemote,windows,result=>{if(main&&!main.isDestroyed()){main.webContents.send('tb:capture',result);main.show();main.focus();}});
    register();
    session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
    session.defaultSession.setPermissionCheckHandler(()=>false);
    main=new BrowserWindow({width:1440,height:920,minWidth:900,minHeight:600,title:'123 Token Balance · 正在加载',icon:path.join(__dirname,'../assets/icon.png'),backgroundColor:'#ffffff',show:true,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
    main.webContents.setWindowOpenHandler(()=>({action:'deny'}));main.webContents.on('will-navigate',e=>e.preventDefault());
    const startupFailure=(message:string)=>{log('startup-failed',message);if(!quitting&&!process.argv.includes('--update-healthcheck'))dialog.showErrorBox('工作台启动失败',message+'\n请查看 data/logs/startup.log，或从 GitHub 下载完整发布包。');app.exit(1);};
    startupTimer=setTimeout(()=>startupFailure('界面未在 35 秒内完成加载。'),35000);
    main.webContents.on('render-process-gone',(_event,details)=>{if(!quitting)startupFailure(`渲染进程退出：${details.reason} (${details.exitCode})`);});
    main.webContents.on('did-fail-load',(_event,code,description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)startupFailure(`资源加载失败：${code} ${description}`);});
    main.webContents.once('did-finish-load',()=>main?.setTitle('123 Token Balance'));
    void main.loadFile(uiFile).catch(()=>startupFailure('程序界面资源未能加载。'));main.on('closed',()=>{main=null;app.quit();});
    startSchedule();
    // Stored snapshots remain visible immediately. Network starts after the UI is loaded.
    main.webContents.once('did-finish-load',()=>{if(!repository.readOnly&&repository.data.settings.intervalMinutes>0)setTimeout(()=>{if(!repository.readOnly&&repository.data.settings.intervalMinutes>0)void service.refresh();},500);});
  }).catch(e=>{log('initialization-failed',e instanceof Error?e.message.slice(0,500):'unknown');if(!process.argv.includes('--update-healthcheck'))dialog.showErrorBox('启动失败','程序无法读取自身资源或数据目录。请查看 data/logs/startup.log，并完整解压发布包到可写目录。');app.exit(1);});
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{quitting=true;clearInterval(scheduler);clearTimeout(startupTimer);for(const a of repository?.data.accounts??[]){const s=sessionFor(a.browserSessionId??a.id);s.flushStorageData();void s.cookies.flushStore().catch(()=>{});}});
