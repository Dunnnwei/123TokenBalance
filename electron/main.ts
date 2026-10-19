import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell, clipboard, nativeImage, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Account, AppState, Settings, Snapshot } from '../src/core/types';
import { errorMessage, AppError, safeUrl, validateAccount } from '../src/core/validation';
import { mappedSnapshot, selectorParts, selectors } from '../src/core/parse';
import { Repository, encodeBackup, decodeBackup } from './repository';
import { AccountService } from './service';
import { parseSample, query } from './transport';
import { toCsv } from './csv';
import { CaptureManager } from './capture-manager';
import { parseAgentConfig } from '../src/core/agent-config';
import { publicAccount } from '../src/core/validation';

app.setName('123TokenBalance');
const argument = process.argv.find(a=>a.startsWith('--data-dir='))?.slice(11);
const dataPath=argument?path.resolve(argument):path.join(app.isPackaged?path.dirname(app.getPath('exe')):app.getAppPath(),'data');
try {fs.mkdirSync(dataPath,{recursive:true});app.setPath('userData',path.join(dataPath,'runtime'));}
catch {dialog.showErrorBox('无法创建数据目录','请将整个程序文件夹放到可写位置，例如 D 盘或桌面。');app.exit(1);}
let main:BrowserWindow|null=null;let service:AccountService;let repository:Repository;
let captures:CaptureManager;
const windows=new Map<string,BrowserWindow>();
let scheduler:NodeJS.Timeout|undefined;let backupBusy=false;
const uiFile=path.join(__dirname,'../dist/index.html');
const version=app.getVersion();
function state():AppState {return{schema:1,accounts:service.list(),settings:repository.data.settings,version,dataPath,secureStorage:safeStorage.isEncryptionAvailable(),warnings:repository.warnings};}
function changed(){if(main&&!main.isDestroyed())main.webContents.send('tb:changed',state());}
function account(id:unknown):Account {if(typeof id!=='string')throw new AppError('config','账号 ID 无效。');const a=repository.data.accounts.find(a=>a.id===id);if(!a)throw new AppError('config','账号已不存在。');return a;}
function sessionFor(id:string){const s=session.fromPartition(`persist:account-${id}`);s.setPermissionRequestHandler((_w,_p,cb)=>cb(false));s.setPermissionCheckHandler(()=>false);return s;}
const allowedNavigation=(url:string)=>{try{return safeUrl(url).protocol==='https:';}catch{return false;}};
function secureRemote(contents:WebContents){
  contents.on('will-navigate',(e,url)=>{if(!allowedNavigation(url))e.preventDefault();});
  contents.on('will-redirect',(e,url)=>{if(!allowedNavigation(url))e.preventDefault();});
  contents.setWindowOpenHandler(({url})=>allowedNavigation(url)?{action:'allow',overrideBrowserWindowOptions:{autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,preload:undefined}}}:{action:'deny'});
  contents.on('did-create-window',child=>secureRemote(child.webContents));
  contents.session.on('will-download',(event)=>event.preventDefault());
}
async function login(a:Account):Promise<void>{
  const url=safeUrl(a.infoUrl).toString();let win=windows.get(a.id);
  if(win&&!win.isDestroyed()){win.show();win.focus();return;}
  win=new BrowserWindow({width:1120,height:800,title:`${a.platformName} · ${a.account} — 独立登录`,autoHideMenuBar:true,webPreferences:{session:sessionFor(a.id),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  windows.set(a.id,win);secureRemote(win.webContents);win.on('closed',()=>windows.delete(a.id));
  await win.loadURL(url).catch(()=>{throw new AppError('network','登录页面未能打开，请检查网址或网络。');});
}
async function browserRead(a:Account):Promise<Snapshot>{
  if(!a.mappings.some(m=>m.valuePath))throw new AppError('config','网页方式需要配置额度 CSS 选择器。请在「编辑 → 字段映射」中填写，可先用 HTML 样本预览。');
  const win=windows.get(a.id);if(!win||win.isDestroyed())throw new AppError('auth','请先点击此账号的「登录页面」，完成登录并打开用量页面后，再点击刷新。');
  const contents=captures.remote(a.id)??win.webContents;
  const expected=safeUrl(a.infoUrl);let current:URL;try{current=new URL(contents.getURL());}catch{throw new AppError('auth','登录页面尚未准备好。');}
  if(current.origin!==expected.origin)throw new AppError('auth','登录窗口当前位于其他网站。请回到信息页面所属网站后再读取。');
  if(a.browserAutoRefresh){
    await new Promise<void>((resolve,reject)=>{
      const finish=(error?:Error)=>{clearTimeout(timer);contents.removeListener('did-finish-load',loaded);contents.removeListener('did-fail-load',failed);contents.removeListener('destroyed',closed);error?reject(error):resolve();};
      const loaded=()=>finish();
      const failed=(_event:unknown,_code:number,_description:string,_url:string,isMainFrame:boolean)=>{if(isMainFrame)finish(new AppError('network','订阅页面刷新失败，请检查登录状态或网络。'));};
      const closed=()=>finish(new AppError('auth','订阅页面已关闭，请重新打开登录页面。'));
      const timer=setTimeout(()=>finish(new AppError('timeout','订阅页面刷新超时，请检查登录状态或网络。')),15000);
      contents.once('did-finish-load',loaded);contents.on('did-fail-load',failed);contents.once('destroyed',closed);
      // Navigating to an identical URL with a hash may only fire in-page navigation.
      // An explicit reload guarantees that the saved page actually fetches current usage.
      if(contents.getURL()===expected.href)contents.reloadIgnoringCache();
      else void contents.loadURL(expected.href).catch(()=>finish(new AppError('network','订阅页面刷新失败，请检查登录状态或网络。')));
    });
  }
  const specs=selectors(a).map(p=>({path:p,...selectorParts(p)}));
  const code=`(async() => { let out = {}; for(let attempt=0; attempt<${a.browserAutoRefresh?13:1}; attempt++){ out={}; for (const spec of ${JSON.stringify(specs)}) { try { const el = document.querySelector(spec.selector); out[spec.path] = el ? String(spec.attribute ? el.getAttribute(spec.attribute) ?? '' : el.textContent ?? '').trim().slice(0, 2000) : null; } catch { out[spec.path] = null; } } if(${JSON.stringify(a.mappings.map(m=>m.valuePath))}.every(path=>out[path]&&/\\d/.test(out[path])))return out; if(attempt<${a.browserAutoRefresh?12:0})await new Promise(resolve=>setTimeout(resolve,400)); } return out; })()`;
  let data:Record<string,unknown>;
  let timeout:NodeJS.Timeout|undefined;
  try {data=await Promise.race([contents.executeJavaScriptInIsolatedWorld(999,[{code}]),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new AppError('timeout','网页读取超时，请确认用量页面已加载完成。')),10000);})]);}
  finally{clearTimeout(timeout);}
  // Check navigation again so values from an intervening login redirect cannot be attributed to this account.
  if(new URL(contents.getURL()).origin!==expected.origin)throw new AppError('auth','读取时页面发生跳转，请返回用量页面重试。');
  return mappedSnapshot(a,p=>data[p],'web');
}
async function run(a:Account):Promise<Snapshot>{return query(a,(url,options)=>sessionFor(a.id).fetch(url,options),browserRead);}
function startSchedule(){clearInterval(scheduler);const interval=repository.data.settings.intervalMinutes;if(interval>0)scheduler=setInterval(()=>{if(!repository.readOnly)void service.refresh();},interval*60000);}
function handle(name:string,fn:(...args:any[])=>unknown,allowCapture=false){
  ipcMain.handle('tb:'+name,async(event,...args)=>{
    const trustedMain=!!main&&event.sender===main.webContents&&event.senderFrame===main.webContents.mainFrame&&event.senderFrame?.url===pathToFileURL(uiFile).href;
    if(!trustedMain&&!(allowCapture&&captures.owns(event.sender,event.senderFrame,args[0])))return{ok:false,error:'请求来源无效。'};
    try{return{ok:true,value:await fn(...args)};}catch(e){return{ok:false,error:errorMessage(e)};}
  });
}
function register(){
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
  handle('startCapture',(url:string)=>captures.start(url));
  handle('captureInfo',(id:string)=>captures.info(id),true);
  handle('navigateCapture',(id:string,url:string)=>captures.navigate(id,url),true);
  handle('readCapture',(id:string)=>captures.read(id),true);
  handle('focusCapture',(id:string)=>captures.focus(id));
  handle('closeCapture',(id:string)=>captures.close(id));
  handle('saveCapture',(id:string,name:string,plan:string)=>{captures.save(id,name,plan,service);return state();});
  handle('save',(a:Account)=>{service.save(a);return state();});
  handle('remove',async(id:string)=>{account(id);service.remove(id);windows.get(id)?.close();await sessionFor(id).clearStorageData();return state();});
  handle('refresh',async(ids?:string[])=>{if(ids!==undefined&&(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string')))throw new AppError('config','刷新列表无效。');await service.refresh(ids);return state();});
  handle('settings',(s:Settings)=>{service.settings(s);startSchedule();return state();});
  handle('login',async(id:string)=>login(account(id)));
  handle('clearSession',async(id:string)=>{account(id);windows.get(id)?.close();await sessionFor(id).clearStorageData();await sessionFor(id).clearCache();});
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
if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>{main?.show();main?.focus();});
  app.whenReady().then(()=>{
    repository=new Repository(path.join(dataPath,'accounts.enc.json'),{encrypt:v=>{if(!safeStorage.isEncryptionAvailable())throw new AppError('crypto','Windows 加密服务不可用，未保存凭据。');return safeStorage.encryptString(v);},decrypt:v=>safeStorage.decryptString(v)});
    service=new AccountService(repository,run,changed);
    captures=new CaptureManager(uiFile,path.join(__dirname,'preload.cjs'),sessionFor,secureRemote,windows,result=>{if(main&&!main.isDestroyed()){main.webContents.send('tb:capture',result);main.show();main.focus();}});
    register();
    session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
    session.defaultSession.setPermissionCheckHandler(()=>false);
    main=new BrowserWindow({width:1440,height:920,minWidth:900,minHeight:600,title:'123 Token Balance',icon:path.join(__dirname,'../assets/icon.png'),backgroundColor:'#ffffff',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
    main.webContents.setWindowOpenHandler(()=>({action:'deny'}));main.webContents.on('will-navigate',e=>e.preventDefault());
    main.once('ready-to-show',()=>main?.show());
    void main.loadFile(uiFile);main.on('closed',()=>{main=null;app.quit();});
    startSchedule();
    // Stored snapshots remain visible immediately. Network starts after the UI is loaded.
    main.webContents.once('did-finish-load',()=>{if(!repository.readOnly&&repository.data.settings.intervalMinutes>0)setTimeout(()=>void service.refresh(),500);});
  }).catch(()=>{dialog.showErrorBox('启动失败','程序无法读取自身资源或数据目录。请完整解压发布包到可写目录后重新启动。');app.quit();});
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>clearInterval(scheduler));
