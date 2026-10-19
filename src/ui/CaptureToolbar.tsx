import { useEffect, useRef, useState } from 'react';
import { Button, Input, Loader, ActivityIcon, ArrowRightIcon } from 'haui';
import { Notice } from './common';

export function CaptureToolbar({id}:{id:string}){
  const [url,setUrl]=useState(''),[actual,setActual]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const editing=useRef(false);
  useEffect(()=>{let live=true;const poll=async()=>{try{const info=await window.tokenBalance.captureInfo(id);if(live){setActual(info.url);setLoading(info.loading);if(!editing.current)setUrl(info.url);}}catch{}};void poll();const timer=setInterval(()=>void poll(),700);return()=>{live=false;clearInterval(timer);};},[id]);
  const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}};
  return <main className="capture-toolbar"><div className="capture-toolbar-heading"><strong>123Token <span>网页快速接入</span></strong><span>先登录 → 打开订阅信息页 → 一键抓取</span></div><div className="capture-address"><Input aria-label="订阅页面网址" value={url} onFocus={()=>editing.current=true} onBlur={()=>editing.current=false} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){editing.current=false;void run(()=>window.tokenBalance.navigateCapture(id,url));}}}/><Button variant="outline" disabled={busy} onClick={()=>{editing.current=false;void run(()=>window.tokenBalance.navigateCapture(id,url));}}><ArrowRightIcon aria-hidden="true"/>打开网址</Button><Button variant="default" disabled={loading||busy||!actual.startsWith('https:')} onClick={()=>void run(async()=>{const r=await window.tokenBalance.readCapture(id);setMessage(`已识别 ${r.snapshot.metrics.length} 项，回到主窗口核对并保存。`);})}>{busy?<Loader size="sm"/>:<ActivityIcon aria-hidden="true"/>}一键抓取</Button></div><div className="capture-message">{error?<Notice error>{error}</Notice>:message?<Notice>{message}</Notice>:<p>{loading?'页面加载中…':'下方是平台官方网页。'} 登录信息保留在此账号的独立会话，抓取只读取当前页面可见的订阅数据。</p>}</div></main>;
}
