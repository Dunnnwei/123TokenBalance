import type { SubscriptionRecord } from './types';
export function localDay(now=new Date()):string{return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
export function isCalendarDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
  return y>=1900&&y<=2200&&date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;
}
export function nextRenewal(day:string,cycle:SubscriptionRecord['cycle']):string {
  if(!isCalendarDate(day)||cycle==='custom')return '';
  const [y,m,d]=day.split('-').map(Number),next=new Date(Date.UTC(y+(cycle==='yearly'?1:0),m-1+(cycle==='monthly'?1:0),1));
  const last=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();next.setUTCDate(Math.min(d,last));
  return next.toISOString().slice(0,10);
}
export function renewalStatus(record?:SubscriptionRecord,now=new Date()):{attention:boolean;label:string;days:number}|undefined {
  if(!record?.renewsOn||!isCalendarDate(record.renewsOn))return undefined;
  const days=Math.round((Date.parse(record.renewsOn+'T00:00:00Z')-Date.parse(localDay(now)+'T00:00:00Z'))/86400000);
  return {days,attention:days<=record.remindDays,label:days<0?`已到期 ${-days} 天`:days===0?'今天续费':`${days} 天后续费`};
}
