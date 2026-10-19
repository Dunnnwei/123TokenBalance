import type { Account } from '../src/core/types';
import { PERIODS } from '../src/core/types';
function cell(value: unknown): string { let s=value===undefined?'':String(value);if(/^[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'; }
export function toCsv(accounts:Account[]):string {
  const rows:unknown[][]=[['平台','账号','套餐','周期','额度名称','剩余量','总量','剩余百分比','数值','单位','重置时间','采集时间','来源','状态']];
  for(const a of accounts) for(const m of a.snapshot?.metrics??[]) rows.push([a.platformName,a.account,a.snapshot?.plan,PERIODS[m.period],m.label,m.remaining,m.total,m.remainingPercent,m.value,m.unit,m.resetsAt,a.snapshot?.fetchedAt,a.snapshot?.source,a.status]);
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
