import { useEffect,useState } from 'react';
import { Badge,Button,Dialog,DialogContent,DialogDescription,DialogTitle,Loader } from 'haui';
import type { AppState } from '../core/types';
import type { EnvironmentReport,UpdateState } from '../core/system';
import { RELEASES_URL,REPOSITORY } from '../core/system';
import { Notice } from './common';

export function SystemCenter({state,open,onOpenChange,checkTrigger,onRecovered}:{state:AppState|null;open:boolean;onOpenChange:(value:boolean)=>void;checkTrigger:number;onRecovered:(value:AppState)=>void}){
  const [report,setReport]=useState<EnvironmentReport|null>(null),[update,setUpdate]=useState<UpdateState|null>(null),[error,setError]=useState('');
  const [working,setWorking]=useState(false);
  useEffect(()=>{if(state)setReport(state.environment);},[state?.environment]);
  useEffect(()=>{if(!window.tokenBalance)return;let active=true;void window.tokenBalance.updateState().then(s=>{if(active)setUpdate(s);}).catch(e=>{if(active)setError(e.message);});const off=window.tokenBalance.subscribeUpdate(s=>{if(active)setUpdate(s);});return()=>{active=false;off();};},[]);
  const run=async(fn:()=>Promise<unknown>)=>{setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'操作失败，请重试。');}};
  const check=()=>run(async()=>setUpdate(await window.tokenBalance.checkUpdate()));
  useEffect(()=>{if(checkTrigger>0)void check();},[checkTrigger]);
  const inProgress=working||!!update&&['checking','downloading','verifying','installing'].includes(update.phase);
  const download=async()=>{setWorking(true);try{await run(async()=>{const next=await window.tokenBalance.downloadUpdate();setUpdate(next);if(next.phase==='ready')setUpdate(await window.tokenBalance.installUpdate());});}finally{setWorking(false);}};
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="system-dialog"><DialogTitle>环境检测与版本更新</DialogTitle><DialogDescription>当前版本 {state?.version??'加载中'}。每次启动先检查本地环境，联网检查版本由你手动触发。</DialogDescription>
    <section className="system-section" aria-label="版本更新"><h2>版本更新</h2><p role="status">{update?.message??'正在读取更新状态…'}</p>
      {update&&['downloading','verifying'].includes(update.phase)&&<div className="update-progress"><progress max={100} value={update.progress} aria-label="更新下载进度"/><span>{update.progress}%</span></div>}
      {update?.candidate&&<p className="muted">新版本 {update.candidate.version} · {(update.candidate.bytes/1024/1024).toFixed(1)} MB</p>}
      <div className="button-row"><Button variant="default" disabled={inProgress||update?.phase==='ready'} onClick={()=>void check()}>{update?.phase==='checking'?<Loader size="sm"/>:null}检测新版本</Button>
        {update?.candidate&&['available','error'].includes(update.phase)&&<Button variant="default" disabled={inProgress} onClick={()=>void download()}>下载并自动更新</Button>}
        {update?.phase==='ready'&&<Button variant="default" disabled={working} onClick={()=>void run(async()=>setUpdate(await window.tokenBalance.installUpdate()))}>应用已下载更新</Button>}
        <Button variant="outline" onClick={()=>void run(()=>window.tokenBalance.open(RELEASES_URL))}>在 GitHub 下载</Button>
      </div><p className="muted">更新会校验完整安装包、关闭并重启程序，保留当前账号数据及旧版文件夹。网络或校验失败时仍可使用当前版本。</p>
      <Button variant="link" onClick={()=>void run(()=>window.tokenBalance.open(REPOSITORY))}>{REPOSITORY}</Button>
      {update?.candidate?.notes&&<details><summary>查看新版说明</summary><pre className="release-notes">{update.candidate.notes}</pre></details>}
    </section>
    <section className="system-section" aria-label="启动环境检查"><h2>启动环境检查</h2><p className="muted">{report?`已完成 ${report.checks.length} 项检查 · ${new Date(report.checkedAt).toLocaleTimeString('zh-CN')}`:'正在加载检查结果…'}</p>
      <ul className="environment-checks">{report?.checks.map((check,i)=><li key={`${check.id}-${i}`}><Badge variant={check.status==='pass'?'default':check.status==='warn'?'warn':'destructive'}>{check.status==='pass'?'满足':check.status==='warn'?'需留意':'未满足'}</Badge><div><strong>{check.label}</strong><p>{check.detail}</p>{check.url&&check.status!=='pass'&&<Button variant="link" size="sm" onClick={()=>void run(()=>window.tokenBalance.open(check.url!))}>查看需求 / 下载</Button>}</div></li>)}</ul>
      <div className="button-row"><Button variant="outline" onClick={()=>void run(async()=>setReport(await window.tokenBalance.environment()))}>重新检查</Button><Button variant="text" onClick={()=>void run(()=>window.tokenBalance.openDiagnostics())}>打开检测日志</Button></div>
      {state?.readOnly&&<Notice error>此电脑无法读取旧配置。先归档原文件，再导入从原电脑导出的口令备份。<div className="button-row"><Button variant="outline" onClick={()=>void run(async()=>{const next=await window.tokenBalance.recoverData();if(next)onRecovered(next);})}>归档旧配置并恢复</Button></div></Notice>}
    </section>{error&&<Notice error>{error}</Notice>}
  </DialogContent></Dialog>;
}
