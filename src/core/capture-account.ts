import type { Account, CaptureResult, Snapshot } from './types';
import { AppError, safeUrl } from './validation';

const email = (v: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v.trim()) ? v.trim().toLowerCase() : '';
export function compatibleSite(a: Account, b: Account): boolean {
  // Exact origin prevents unrelated tenants of a shared hosting domain being merged.
  const family=(id:string)=>({claude:'claude-web',gemini:'gemini-web'} as Record<string,string>)[id]??id;
  return safeUrl(a.infoUrl).origin === safeUrl(b.infoUrl).origin && (family(a.providerId) === family(b.providerId) || a.providerId === 'custom' || b.providerId === 'custom');
}
export function assertIdentity(a: Account, b: Account): void {
  if (!compatibleSite(a,b)) throw new AppError('conflict','网页所属平台与原账号不一致，请回到原信息页面。');
  const expected = email(a.browserIdentity || a.account), actual = email(b.browserIdentity || b.account);
  if (expected && actual && expected !== actual) throw new AppError('conflict','网页登录的邮箱与原账号不一致，请切换到正确账号后重新抓取。');
}
export function suggestedCaptureTarget(accounts: Account[], result: CaptureResult): Account | undefined {
  const identity = email(result.draft.browserIdentity || result.draft.account);
  if (!identity) return undefined;
  const matches = accounts.filter(a=>compatibleSite(a,result.draft) && email(a.browserIdentity || a.account)===identity);
  return matches.length===1 ? matches[0] : undefined;
}
export function requireComplete(previous: Account, snapshot: Snapshot): void {
  const periods = new Set(snapshot.metrics.map(m=>m.period));
  const expected = new Set([...(previous.snapshot?.metrics ?? []), ...previous.mappings].map(m=>m.period).filter(p=>['5h','week','month','day','balance'].includes(p)));
  const missing = [...expected].filter(p=>!periods.has(p));
  const labels:Record<string,string>={'5h':'5 小时',week:'周',month:'月',day:'日',balance:'余额'};
  if (missing.length) throw new AppError('parse',`页面尚未完整提供${missing.map(p=>labels[p]??p).join('、')}额度，已保留上次成功数据。请打开完整用量页后重新抓取。`);
}
