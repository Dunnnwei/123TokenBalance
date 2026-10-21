import { BrowserWindow, type WebContents } from 'electron';
import type { Account, PageScan, Snapshot } from '../src/core/types';
import { AppError, safeUrl } from '../src/core/validation';
import { collectVisiblePage, recognizePage } from '../src/core/capture';
import { assertIdentity, requireComplete } from '../src/core/capture-account';
import { extractedNumber, mappedSnapshot, selectorParts, selectors } from '../src/core/parse';

export const usesRecognition=(a:Account)=>a.browserRecognition??(!!a.browserAutoRefresh&&a.mappings.length>0&&a.mappings.every(m=>m.id.startsWith('capture-')));

export async function readBrowser(a:Account, contents:WebContents, forceLoad:boolean):Promise<Snapshot> {
  const expected=safeUrl(a.infoUrl);
  if(!usesRecognition(a)&&!a.mappings.some(m=>m.valuePath))throw new AppError('config','请在此账号内点击「程序内打开并重新抓取」，或补充额度字段映射。');
  if(forceLoad||a.browserAutoRefresh){
    await new Promise<void>((resolve,reject)=>{
      let complete=false,loadError:AppError|undefined;
      const finish=(error?:Error)=>{if(complete)return;complete=true;clearTimeout(timer);contents.removeListener('did-finish-load',loaded);contents.removeListener('did-fail-load',failed);contents.removeListener('did-navigate',navigated);contents.removeListener('destroyed',closed);error?reject(error):resolve();};
      const loaded=()=>finish(loadError);
      const navigated=(_event:unknown,_url:string,status:number)=>{if([502,503,504].includes(status))loadError=new AppError('network',`平台网页暂时不可用（HTTP ${status}），已保留旧数据，请稍后重试。`);else if([401,403].includes(status))loadError=new AppError('auth','平台网页需要重新登录或人工验证，请在此账号内「程序内打开并重新抓取」。');};
      const failed=(_event:unknown,_code:number,_description:string,_url:string,isMainFrame:boolean)=>{if(isMainFrame&&_code!==-3)finish(new AppError('network','网页加载失败，已保留旧数据。请稍后重试或在程序内打开页面检查。'));};
      const closed=()=>finish(new AppError('auth','网页已关闭，请重新刷新或在程序内打开并重新抓取。'));
      const timer=setTimeout(()=>finish(new AppError('timeout','网页加载超时，已保留旧数据。请稍后重试。')),20000);
      contents.once('did-finish-load',loaded);contents.on('did-fail-load',failed);contents.on('did-navigate',navigated);contents.once('destroyed',closed);
      if(contents.getURL()===expected.href)contents.reload();
      else void contents.loadURL(expected.href).catch(()=>finish(new AppError('network','网页未能加载，已保留旧数据。')));
    });
  }
  const checkOrigin=()=>{
    if(contents.isDestroyed())throw new AppError('auth','网页已关闭，请重新刷新。');
    let current:URL;try{current=new URL(contents.getURL());}catch{throw new AppError('auth','网页尚未准备好，请在程序内打开并重新抓取。');}
    if(current.origin!==expected.origin||/\/(?:login|signin|sign-in|auth)(?:\/|$)/i.test(current.pathname))throw new AppError('auth','网页登录已失效或跳转到登录页，请在此账号内「程序内打开并重新抓取」。');
  };
  let last:unknown=new AppError('parse','页面尚未提供额度，请在程序内打开并重新抓取。');
  const specs=selectors(a).map(p=>({path:p,...selectorParts(p)}));
  const automatic=usesRecognition(a);
  const code=automatic?`(${collectVisiblePage.toString()})()`:`(() => {const out={};for(const spec of ${JSON.stringify(specs)}){try{const el=document.querySelector(spec.selector);out[spec.path]=el?String(spec.attribute?el.getAttribute(spec.attribute)??'':el.textContent??'').trim().slice(0,2000):null;}catch{out[spec.path]=null;}}return out;})()`;
  for(let attempt=0;attempt<25;attempt++){
    checkOrigin();const before=contents.getURL();let timer:NodeJS.Timeout|undefined;
    try {
      const data=await Promise.race([contents.executeJavaScriptInIsolatedWorld(999,[{code}]),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AppError('timeout','网页读取超时，已保留旧数据。')),3000);})]);
      checkOrigin();if(contents.getURL()!==before)throw new AppError('auth','读取时网页跳转，请重新刷新。');
      let result:Snapshot;
      if(automatic){
        const scan=data as PageScan;
        let recognized;
        try{recognized=recognizePage(scan,a.id);}catch(e){if(scan.fields.some(f=>/^(?:sign in|log in|登录|登入)(?:\s|$)/i.test(f.text)))throw new AppError('auth','网页登录已失效，请在此账号内「程序内打开并重新抓取」，完成登录后更新原账号。');throw e;}
        assertIdentity(a,recognized.draft);result=recognized.snapshot;if(result.planSource==='unknown'&&a.plan){result.plan=a.plan;result.planSource='config';}
      }
      else {
        if(a.mappings.some(m=>extractedNumber(data[m.valuePath],m.extract)===undefined))throw new AppError('parse','部分额度字段未加载或页面布局已变化，请在此账号内重新抓取。');
        result=mappedSnapshot(a,p=>data[p],'web');
      }
      requireComplete(a,result);return result;
    }catch(e){if(e instanceof AppError&&['conflict','auth','timeout'].includes(e.code))throw e;last=e;}
    finally{clearTimeout(timer);}
    if(attempt<24)await new Promise(resolve=>setTimeout(resolve,400));
  }
  throw last;
}

/** Temporary hidden windows share only this account's persistent partition. */
export async function withBackgroundBrowser(a:Account,create:()=>BrowserWindow,remote?:WebContents):Promise<Snapshot>{
  if(remote&&!remote.isDestroyed())return readBrowser(a,remote,false);
  const window=create();
  try{return await readBrowser(a,window.webContents,true);}
  finally{if(!window.isDestroyed())window.destroy();}
}
