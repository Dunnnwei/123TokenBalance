import { useEffect, useState } from 'react';
import { Button, Input, Dialog, DialogContent, DialogTitle, DialogDescription, ExternalLinkIcon, Loader, CopyIcon } from 'haui';
import type { CaptureResult } from '../core/types';
import { safeUrl } from '../core/validation';
import { Field, Notice, SnapshotPreview } from './common';
import { AgentHelp } from './AgentHelp';

export function QuickConnect({initialUrl='',onClose,onSaved}:{initialUrl?:string;onClose:()=>void;onSaved:()=>void}){
  const [url,setUrl]=useState(initialUrl),[id,setId]=useState(''),[result,setResult]=useState<CaptureResult|null>(null),[name,setName]=useState(''),[plan,setPlan]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[agent,setAgent]=useState(false);
  useEffect(()=>window.tokenBalance.subscribeCapture(r=>{if(r.id===id){setResult(r);setName(r.draft.account);setPlan(r.draft.plan);setError('');}}),[id]);
  const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}};
  const close=()=>{if(id)void window.tokenBalance.closeCapture(id).catch(()=>{});onClose();};
  return <><Dialog open onOpenChange={o=>{if(!o&&!busy)close();}}><DialogContent className="account-dialog" onPointerDownOutside={e=>e.preventDefault()}><DialogTitle>网页快速添加</DialogTitle><DialogDescription>填订阅信息页网址，登录后点击「一键抓取」。无需先查找 API Key 或字段路径。</DialogDescription>
    <div className="quick-steps"><span>1 输入网址</span><span>2 在窗口登录</span><span>3 一键抓取并保存</span></div>
    <Field label={<label htmlFor="quick-url">能看到订阅或余额信息的网址</label>} hint="例如官方账户的用量、订阅或余额页面。打开后也可以在窗口地址栏切换。"><Input id="quick-url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…" autoFocus disabled={!!id}/></Field>
    <div className="button-row"><Button variant="default" disabled={busy||!url.trim()} onClick={()=>void run(async()=>{if(id)await window.tokenBalance.focusCapture(id);else setId(await window.tokenBalance.startCapture(safeUrl(url.trim()).href));})}>{busy?<Loader size="sm"/>:<ExternalLinkIcon aria-hidden="true"/>}{id?'返回订阅窗口':'打开订阅页面'}</Button><Button variant="text" onClick={()=>setAgent(true)}><CopyIcon aria-hidden="true"/>不会接入？让 Agent 帮忙</Button></div>
    {id&&!result&&<Notice>在新窗口中完成官方登录，打开用量页，然后点击窗口上方的「一键抓取」。识别完成后会自动回到这里。</Notice>}
    {result&&<div className="capture-review"><div className="preview-heading"><strong>已识别 {result.snapshot.metrics.length} 项额度 · {result.draft.platformName}</strong><span className="field-hint">保存前请对照官方页面核对</span></div><SnapshotPreview snapshot={result.snapshot}/><div className="form-grid"><Field label={<label htmlFor="capture-account">账号名称 *</label>} hint="未识别到邮箱时，可填工作账号、个人账号等备注。"><Input id="capture-account" value={name} onChange={e=>setName(e.target.value)} maxLength={200}/></Field><Field label={<label htmlFor="capture-plan">套餐名称</label>}><Input id="capture-plan" value={plan} onChange={e=>setPlan(e.target.value)} maxLength={100}/></Field></div><details className="prompt-details"><summary>查看识别原文和提示</summary><ul>{result.evidence.map((text,i)=><li key={i}>{text}</li>)}</ul>{result.warnings.map((w,i)=><p key={i}>{w}</p>)}</details><p className="field-hint">信息页：{result.draft.infoUrl}。保存后保留此独立登录窗口，后续刷新读取页面最新额度。</p></div>}
    {error&&<Notice error>{error}</Notice>}<div className="editor-footer"><span className="field-hint">抓取仅在本机处理，无法识别的数值不会编造。</span><div><Button variant="text" disabled={busy} onClick={close}>取消</Button><Button variant="default" disabled={busy||!result||!name.trim()} onClick={()=>void run(async()=>{await window.tokenBalance.saveCapture(id,name,plan);onSaved();onClose();})}>保存并添加账号</Button></div></div>
  </DialogContent></Dialog>{agent&&<AgentHelp context={result?.draft??{infoUrl:url}} onClose={()=>setAgent(false)} onImported={onSaved}/>}</>;
}
