import { Input,Button,Badge } from 'haui';
import type { SubscriptionRecord } from '../core/types';
import { nextRenewal,renewalStatus } from '../core/subscription';
import { Field,Choice,Notice } from './common';
export function SubscriptionEditor({value,onChange}:{value?:SubscriptionRecord;onChange:(value:SubscriptionRecord|undefined)=>void}){
  const record=value??{startedOn:'',renewsOn:'',cycle:'monthly',remindDays:7};
  return <><p className="section-copy">记录自己的订阅和续费时间。临近续费或已到期的账号会进入「需要关注」。这里是你的手动记录，不会更改平台上的订阅。</p><div className="form-grid">
    <Field label={<label htmlFor="subscription-start">订阅日期</label>}><Input id="subscription-start" type="date" value={record.startedOn} onChange={e=>onChange({...record,startedOn:e.target.value,renewsOn:record.cycle==='custom'?record.renewsOn:nextRenewal(e.target.value,record.cycle)})}/></Field>
    <Field label="订阅周期" hint="按月/按年会根据订阅日期生成建议续费日；请与平台日期核对。"><Choice label="订阅周期" value={record.cycle} onChange={v=>{const cycle=v as SubscriptionRecord['cycle'];onChange({...record,cycle,renewsOn:cycle==='custom'?record.renewsOn:nextRenewal(record.startedOn,cycle)});}} options={[{value:'monthly',label:'按月'},{value:'yearly',label:'按年'},{value:'custom',label:'自定日期'}]}/></Field>
    <Field label={<label htmlFor="subscription-renew">续费 / 到期日期</label>}><Input id="subscription-renew" type="date" value={record.renewsOn} onChange={e=>onChange({...record,renewsOn:e.target.value,cycle:'custom'})}/></Field>
    <Field label={<label htmlFor="subscription-remind">提前提醒天数</label>} hint="0 为到期当天提醒，最多 90 天；打开程序后显示提醒。"><Input id="subscription-remind" type="number" min={0} max={90} value={record.remindDays} onChange={e=>onChange({...record,remindDays:Number(e.target.value)})}/></Field>
  </div><div className="button-row"><Button variant="text" onClick={()=>onChange(undefined)}>清除订阅日期</Button></div>{record.renewsOn&&<Notice>{renewalStatus(record)?.label} · {record.renewsOn}。完成续费后请更新日期。</Notice>}</>;
}
export function SubscriptionSummary({value,detail=false}:{value?:SubscriptionRecord;detail?:boolean}){if(!value?.startedOn&&!value?.renewsOn)return null;const due=renewalStatus(value);return <div className={detail?'subscription-summary detail':'subscription-summary'}>{value.startedOn&&<span className="cell-subtitle">订阅：{value.startedOn}</span>}{value.renewsOn&&<span className="cell-subtitle">续费：{value.renewsOn}</span>}{due&&<Badge variant={due.days<0?'destructive':due.attention?'warn':'muted'}>{due.label}</Badge>}{detail&&<p className="field-hint">手动记录 · 提前 {value.remindDays} 天提醒 · 不会自动续费或修改平台订阅</p>}</div>;}
