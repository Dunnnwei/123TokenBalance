import { BrowserWindow, WebContentsView, type WebContents, type Session, type WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { CaptureResult, PageScan, Account } from '../src/core/types';
import { safeUrl, AppError } from '../src/core/validation';
import { collectVisiblePage, recognizePage } from '../src/core/capture';
import type { AccountService } from './service';

interface Entry { window:BrowserWindow; view:WebContentsView; sessionId:string; windowKey:string; target?:Account; result?:CaptureResult; saved:boolean; reading:boolean; }
export class CaptureManager {
  private entries=new Map<string,Entry>();
  constructor(private uiFile:string,private preload:string,private sessions:(id:string)=>Session,private secure:(contents:WebContents)=>void,private windows:Map<string,BrowserWindow>,private onResult:(result:CaptureResult)=>void){}
  owns(sender:WebContents,frame:WebFrameMain|null,id:unknown):boolean {
    if(typeof id!=='string')return false;const e=this.entries.get(id);
    return !!e&&sender===e.window.webContents&&frame===sender.mainFrame&&frame.url===`${pathToFileURL(this.uiFile).href}?capture=${id}`;
  }
  remote(id:string):WebContents|undefined {return [...this.entries.values()].find(e=>e.windowKey===id)?.view.webContents;}
  private get(id:string):Entry {const e=this.entries.get(id);if(!e||e.window.isDestroyed())throw new AppError('capture','抓取窗口已关闭，请重新打开订阅页面。');return e;}
  async start(url:string,targetAccount?:Account):Promise<string>{
    const target=safeUrl(url).href;
    if([...this.entries.values()].filter(e=>!e.saved).length>=3)throw new AppError('capture','请先完成或关闭已有抓取窗口。');
    const id=randomUUID();
    const targetRecord=targetAccount?structuredClone(targetAccount):undefined;
    const sessionId=targetRecord?.browserSessionId??targetRecord?.id??id,windowKey=targetRecord?.id??id;
    this.windows.get(windowKey)?.close();
    const win=new BrowserWindow({width:1180,height:850,minWidth:860,minHeight:600,title:'123Token · 订阅页面快速接入',autoHideMenuBar:true,backgroundColor:'#fff',webPreferences:{preload:this.preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    const view=new WebContentsView({webPreferences:{session:this.sessions(sessionId),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
    this.secure(view.webContents);win.contentView.addChildView(view);
    const layout=()=>{const [width,height]=win.getContentSize();view.setBounds({x:0,y:180,width,height:Math.max(0,height-180)});};layout();win.on('resize',layout);
    const entry:Entry={window:win,view,sessionId,windowKey,target:targetRecord,saved:false,reading:false};this.entries.set(id,entry);this.windows.set(windowKey,win);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    win.on('closed',()=>{
      if(this.windows.get(entry.windowKey)===win)this.windows.delete(entry.windowKey);this.entries.delete(id);
      if(!view.webContents.isDestroyed())view.webContents.close();
      if(!entry.saved&&!entry.target)void this.sessions(sessionId).clearStorageData().catch(()=>{});
      else void this.sessions(sessionId).cookies.flushStore().catch(()=>{});
    });
    await win.loadFile(this.uiFile,{query:{capture:id}});
    void view.webContents.loadURL(target).catch(()=>{});
    return id;
  }
  info(id:string){const e=this.get(id);return{url:e.view.webContents.getURL(),title:e.view.webContents.getTitle(),loading:e.view.webContents.isLoading()};}
  async navigate(id:string,url:string){const e=this.get(id),target=safeUrl(url).href;e.result=undefined;await e.view.webContents.loadURL(target).catch(()=>{throw new AppError('network','页面加载未完成，请检查网址或网络后重试。');});}
  focus(id:string){const e=this.get(id);e.window.show();e.window.focus();}
  close(id:string){const e=this.entries.get(id);if(e&&!e.window.isDestroyed())e.window.close();}
  async read(id:string):Promise<CaptureResult>{
    const e=this.get(id);if(e.reading)throw new AppError('capture','正在识别，请稍候。');
    const url=safeUrl(e.view.webContents.getURL()).href;
    if(e.view.webContents.isLoading())throw new AppError('capture','页面还在加载，看到订阅信息后再抓取。');
    e.reading=true;let timer:NodeJS.Timeout|undefined;
    try{
      const scan=await Promise.race([e.view.webContents.executeJavaScriptInIsolatedWorld(999,[{code:`(${collectVisiblePage.toString()})()`}]) as Promise<PageScan>,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AppError('capture','页面读取超时，请加载完成后再试。')),10000);})]);
      if(e.view.webContents.isDestroyed()||safeUrl(e.view.webContents.getURL()).href!==url||scan.url!==url)throw new AppError('capture','读取过程中页面跳转，请回到用量页重新抓取。');
      const result=recognizePage(scan,id);e.result=result;this.onResult(result);return result;
    }finally{clearTimeout(timer);e.reading=false;}
  }
  save(id:string,name:string,plan:string,service:AccountService,targetId?:string,revision?:number){
    const e=this.get(id);if(!e.result||e.saved)throw new AppError('capture','请重新抓取后保存。');
    if(typeof name!=='string'||!name.trim()||name.length>200||typeof plan!=='string'||plan.length>100)throw new AppError('config','请填写账号名称，套餐名称最多 100 字。');
    if(e.target&&(targetId!==e.target.id||revision!==e.target.revision))throw new AppError('conflict','本窗口绑定原账号，请重新打开抓取。');
    service.saveCapture(e.result,e.sessionId,name,plan,targetId,revision);e.saved=true;
    const savedId=targetId??e.sessionId;
    if(savedId!==e.windowKey){this.windows.get(savedId)?.close();this.windows.delete(e.windowKey);e.windowKey=savedId;this.windows.set(savedId,e.window);}
    void this.sessions(e.sessionId).cookies.flushStore().catch(()=>{});
  }
}
