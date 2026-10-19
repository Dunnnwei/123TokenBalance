import type { ReactNode } from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Progress, Badge } from 'haui';
import type { Metric, Snapshot } from '../core/types';
export function Field({label,hint,children,wide=false}:{label:ReactNode;hint?:ReactNode;children:ReactNode;wide?:boolean}){return <div className={wide?'field wide':'field'}><div className="field-label">{label}</div>{children}{hint&&<div className="field-hint">{hint}</div>}</div>;}
export function Choice({value,onChange,options,label,id,disabled}:{value:string;onChange:(v:string)=>void;options:{value:string;label:string}[];label:string;id?:string;disabled?:boolean}){return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={label} id={id}><SelectValue/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>;}
export const number=(n:number)=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(n);
export const time=(v?:string)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'尚未查询';
export function metricText(m:Metric):string{
  if(m.period==='balance'&&(m.remaining??m.value)!==undefined){const v=m.remaining??m.value!;return `${m.unit==='USD'?'$':m.unit==='CNY'?'¥':''}${number(v)}${['USD','CNY'].includes(m.unit)?'':m.unit?' '+m.unit:''}`;}
  if(m.remainingPercent!==undefined)return `${number(m.remainingPercent)}%`;
  const v=m.remaining??m.value;if(v===undefined)return '未提供';
  return `${m.unit==='USD'?'$':m.unit==='CNY'?'¥':''}${number(v)}${['USD','CNY'].includes(m.unit)?'':m.unit?' '+m.unit:''}`;
}
export function MetricView({metric,threshold=20,detail=false}:{metric?:Metric;threshold?:number;detail?:boolean}){
  if(!metric)return <span className="unavailable">—<span>未提供</span></span>;
  const low=metric.remainingPercent!==undefined&&metric.remainingPercent<=threshold;
  return <div className={`metric ${low?'metric-low':''}`}><div className="metric-main"><span>{metricText(metric)}</span>{low&&<span className="low-tag">偏低</span>}</div>{metric.remainingPercent!==undefined&&<Progress value={metric.remainingPercent} label={`${metric.label}剩余 ${number(metric.remainingPercent)}%`}/>}<div className="metric-caption">{metric.remaining!==undefined&&metric.total!==undefined?`${number(metric.remaining)} / ${number(metric.total)} ${metric.unit}`:metric.remainingPercent!==undefined?'剩余额度':metric.label}</div>{detail&&metric.resetsAt&&<div className="metric-caption">重置于 {time(metric.resetsAt)}</div>}</div>;
}
export function SnapshotPreview({snapshot}:{snapshot:Snapshot}){return <div className="snapshot-preview"><div className="preview-heading"><strong>{snapshot.plan}</strong><Badge>{snapshot.source==='manual'?'手动录入':snapshot.source==='web'?'网页读取':'API 查询'}</Badge></div><div className="preview-grid">{snapshot.metrics.map((m,i)=><div key={i}><div className="field-label">{m.label}</div><MetricView metric={m} detail/></div>)}</div></div>;}
export function Notice({children,error=false}:{children:ReactNode;error?:boolean}){return <div className={`notice ${error?'notice-error':''}`} role={error?'alert':'status'}>{children}</div>;}
