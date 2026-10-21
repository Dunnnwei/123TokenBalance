import { randomUUID } from 'node:crypto';
import type { Account, CaptureResult, Settings, Snapshot, StoreData } from '../src/core/types';
import { assertIdentity, requireComplete } from '../src/core/capture-account';
import type { RepositoryLike } from './repository';
import { AppError, errorMessage, publicAccount, validateAccount, validateSettings } from '../src/core/validation';
export class AccountService {
  private jobs = new Map<string,Promise<void>>();
  private active = 0; private waiters: (()=>void)[] = [];
  constructor(public repo: RepositoryLike, private run: (a: Account)=>Promise<Snapshot>, public changed: ()=>void = ()=>{}) {}
  list(): Account[] { return this.repo.data.accounts.map(publicAccount); }
  resolve(draft: Account): Account {
    const previous = this.repo.data.accounts.find(a=>a.id===draft.id);
    if (draft.id && !previous) throw new AppError('conflict','账号已删除，请关闭编辑窗口后重试。');
    if (previous && draft.revision !== previous.revision) throw new AppError('conflict','账号配置已变更，请重新打开编辑窗口。');
    return {...draft, secret: draft.preserveSecret && previous ? previous.secret : draft.secret, headers:draft.preserveHeaders && previous ? previous.headers : draft.headers};
  }
  save(draft: Account, captured?: {id:string;snapshot:Snapshot}): void {
    const a=this.resolve(draft); validateAccount(a);
    const previous=this.repo.data.accounts.find(x=>x.id===a.id);
    const sameQuery=!!previous&&(['providerId','account','website','infoUrl','engine','endpoint','method','auth','secret','authHeader','headers','body','plan','planPath','mappings','manual','browserSessionId','browserIdentity','browserRecognition'] as const).every(key=>JSON.stringify(a[key])===JSON.stringify(previous[key]));
    if(!previous && this.repo.data.accounts.length >= 500) throw new AppError('config','最多添加 500 个账号。');
    const next: Account={...a,id:previous?.id??captured?.id??randomUUID(),revision:(previous?.revision??0)+1,account:a.account.trim(),platformName:a.platformName.trim(),snapshot:captured?.snapshot??(a.engine==='manual'?a.manual:undefined),status:captured||a.engine==='manual'&&a.manual?'ok':'idle',error:undefined,retryAt:undefined,checkedAt:undefined};
    if(sameQuery&&!captured&&a.engine!=='manual'){next.snapshot=previous.snapshot;next.status=previous.status==='refreshing'?(previous.snapshot?'ok':'idle'):previous.status;next.error=previous.error;next.retryAt=previous.retryAt;next.checkedAt=previous.checkedAt;}
    delete next.hasSecret;delete next.hasHeaders;delete next.preserveSecret;delete next.preserveHeaders;
    this.repo.commit({...this.repo.data,accounts:previous?this.repo.data.accounts.map(x=>x.id===next.id?next:x):[...this.repo.data.accounts,next]});this.changed();
  }
  saveCapture(result:CaptureResult,sessionId:string,name:string,plan:string,targetId?:string,revision?:number):void {
    const previous=targetId?this.repo.data.accounts.find(a=>a.id===targetId):undefined;
    if(targetId&&(!previous||previous.revision!==revision))throw new AppError('conflict','原账号已修改或删除，请关闭抓取窗口并重新打开。');
    if(previous){assertIdentity(previous,result.draft);requireComplete(previous,result.snapshot);}
    const draft:Account={...result.draft,id:previous?.id??'',revision:previous?.revision??0,account:previous?.account??name.trim(),plan:plan||previous?.plan||'',browserSessionId:sessionId,browserIdentity:result.draft.browserIdentity??previous?.browserIdentity,browserRecognition:true,browserAutoRefresh:true,
      platformName:previous?.platformName??result.draft.platformName,appearance:previous?.appearance,subscription:previous?.subscription,enabled:previous?.enabled??true};
    const snapshot=structuredClone(result.snapshot);
    if(plan!==result.draft.plan){draft.planPath='';snapshot.plan=draft.plan||'未提供';snapshot.planSource=draft.plan?'config':'unknown';}
    this.save(draft,{id:sessionId,snapshot});
  }
  remove(id:string):void {this.repo.commit({...this.repo.data,accounts:this.repo.data.accounts.filter(a=>a.id!==id)});this.changed();}
  move(id:string,targetId:string):void {
    const accounts=[...this.repo.data.accounts],from=accounts.findIndex(a=>a.id===id),to=accounts.findIndex(a=>a.id===targetId);
    if(from<0||to<0)throw new AppError('conflict','账号已变化，请刷新列表后重试。');
    if(from===to)return;
    [accounts[from],accounts[to]]=[accounts[to],accounts[from]];
    this.repo.commit({...this.repo.data,accounts});this.changed();
  }
  reveal(id:string,revision:number):{secret:string;headers:string} {
    const a=this.repo.data.accounts.find(a=>a.id===id);
    if(!a||a.revision!==revision)throw new AppError('conflict','账号已变更，请重新打开编辑窗口。');
    return {secret:a.secret,headers:a.headers};
  }
  settings(settings:Settings):void {validateSettings(settings);this.repo.commit({...this.repo.data,settings:{...settings}});this.changed();}
  import(data:StoreData):void {
    if(data.accounts.length+this.repo.data.accounts.length>500) throw new AppError('backup','导入后账号超过 500 个，未修改现有账号。');
    const accounts=data.accounts.map(a=>({...a,id:randomUUID(),revision:1,browserSessionId:undefined,status:a.engine==='manual'&&a.manual?'ok' as const:'idle' as const,error:undefined,retryAt:undefined,snapshot:a.engine==='manual'?a.manual:undefined}));
    this.repo.commit({...this.repo.data,accounts:[...this.repo.data.accounts,...accounts]});this.changed();
  }
  async refresh(ids?:string[]):Promise<void> {
    const wanted=new Set(ids??this.repo.data.accounts.filter(a=>a.enabled&&a.engine!=='manual').map(a=>a.id));
    await Promise.all([...wanted].map(id=>this.refreshOne(id)));
  }
  private async acquire():Promise<void> {if(this.active>=3) await new Promise<void>(resolve=>this.waiters.push(resolve)); else this.active++;}
  private release():void {const next=this.waiters.shift();if(next)next();else this.active--;}
  private refreshOne(id:string):Promise<void> {
    const existing=this.jobs.get(id);if(existing)return existing;
    const task=this.perform(id).finally(()=>this.jobs.delete(id));this.jobs.set(id,task);return task;
  }
  private async perform(id:string):Promise<void> {
    await this.acquire();
    try {
      const current=this.repo.data.accounts.find(a=>a.id===id);
      if(!current||!current.enabled||(current.retryAt&&Date.parse(current.retryAt)>Date.now()))return;
      const a=structuredClone(current);
      // Transient busy state is never written by itself; the committed result is revision checked.
      current.status='refreshing';this.changed();
      let result: Partial<Account>;
      try {let snapshot:Snapshot;try{snapshot=await this.run(a);}catch(e){if(!(e instanceof AppError)||!['network','timeout'].includes(e.code))throw e;await new Promise(resolve=>setTimeout(resolve,1000));const latest=this.repo.data.accounts.find(x=>x.id===id);if(!latest||latest.revision!==a.revision)return;snapshot=await this.run(a);}requireComplete(a,snapshot);result={snapshot,status:'ok',error:undefined,retryAt:undefined,checkedAt:new Date().toISOString()};}
      catch(e) {result={status:'error',error:errorMessage(e),checkedAt:new Date().toISOString(),retryAt:e instanceof AppError&&e.retrySeconds?new Date(Date.now()+e.retrySeconds*1000).toISOString():undefined};}
      const latest=this.repo.data.accounts.find(x=>x.id===id);
      if(!latest||latest.revision!==a.revision)return;
      try {this.repo.commit({...this.repo.data,accounts:this.repo.data.accounts.map(x=>x.id===id?{...x,...result}:x)});}
      catch(e) {latest.status='error';latest.error=errorMessage(e);}
      this.changed();
    } finally {this.release();}
  }
}
