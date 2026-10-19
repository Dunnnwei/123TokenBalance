import type { Account, Settings } from './types';
import { PROVIDERS } from './providers';
import { LOGO_NAMES } from './types';
import { isCalendarDate } from './subscription';
export class AppError extends Error {
  constructor(public code: string, message: string, public retrySeconds?: number) { super(message); }
}
export function safeUrl(value: string): URL {
  let u: URL;
  try { u = new URL(value); } catch { throw new AppError('config', '请输入完整的 HTTPS 网址。'); }
  if (u.protocol !== 'https:' || u.username || u.password || /[\r\n]/.test(value)) throw new AppError('config', '网址必须使用 HTTPS，且不能包含用户名或密码。');
  return u;
}
export function parseHeaders(value: string): Record<string, string> {
  if (!value.trim()) return {};
  let obj: unknown;
  try { obj = JSON.parse(value); } catch { throw new AppError('config', '附加请求头必须是 JSON 对象，例如 {"X-Project-Id":"项目 ID"}。'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).length > 24) throw new AppError('config', '请求头必须是最多 24 项的 JSON 对象。');
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(k) || /^(host|content-length|connection|proxy-.*|transfer-encoding)$/i.test(k) || typeof v !== 'string' || /[\r\n]/.test(v) || v.length > 16000) throw new AppError('config', '请求头包含不允许的名称、换行或过长内容。');
    result[k] = v;
  }
  return result;
}
export function validateAccount(a: Account): void {
  if (!a || typeof a !== 'object') throw new AppError('config', '账号配置无效。');
  if(a.browserAutoRefresh!==undefined&&typeof a.browserAutoRefresh!=='boolean')throw new AppError('config','网页刷新设置无效。');
  for (const key of ['providerId', 'platformName', 'account', 'website', 'infoUrl', 'endpoint', 'secret', 'headers', 'body', 'plan', 'planPath', 'authHeader'] as const) {
    if (typeof a[key] !== 'string' || a[key].length > (['secret', 'headers', 'body'].includes(key) ? 32000 : 2048)) throw new AppError('config', '配置字段无效或过长。');
  }
  if (!a.account.trim() || !a.platformName.trim()) throw new AppError('config', '请填写平台名称和账号标识。');
  if (!PROVIDERS.some(p => p.id === a.providerId) || !['preset','json','html','browser','manual'].includes(a.engine) || !['none','bearer','api-key','cookie','session'].includes(a.auth) || !['GET','POST'].includes(a.method)) throw new AppError('config', '请选择有效的接入方式、平台和认证方式。');
  safeUrl(a.website); safeUrl(a.infoUrl);
  if (['json','html','preset'].includes(a.engine)) safeUrl(a.endpoint);
  if (a.endpoint.includes('{') && a.engine === 'preset') throw new AppError('config', '请把查询地址中的 {orgId} 替换为该账号的组织 ID。');
  if (/[\r\n]/.test(a.secret)) throw new AppError('config', '密钥或 Cookie 必须为单行，请只粘贴凭据值。');
  if (a.auth === 'api-key' && !/^[a-z0-9-]{1,80}$/i.test(a.authHeader)) throw new AppError('config', 'API Key 请求头名称无效。');
  parseHeaders(a.headers);
  if (a.method === 'POST' && a.body.trim()) { try { JSON.parse(a.body); } catch { throw new AppError('config', '请求体必须是有效 JSON。'); } }
  if (!Array.isArray(a.mappings) || a.mappings.length > 40) throw new AppError('config', '每个账号最多配置 40 条额度映射。');
  for (const m of a.mappings) {
    if (m?.extract !== undefined && !['number','percent','ratio-first'].includes(m.extract) || m?.totalExtract !== undefined && m.totalExtract !== 'ratio-last') throw new AppError('config','数值提取方式无效。');
    if (!m || !['5h','week','month','day','balance','other'].includes(m.period) || !['remainingPercent','usedPercent','remaining','used','value'].includes(m.kind) || !Number.isFinite(m.scale) || m.scale === 0 || Math.abs(m.scale) > 1e9) throw new AppError('config', '额度映射的周期、类型或换算倍率无效。');
    for (const k of ['id','label','valuePath','totalPath','resetPath','unit'] as const) if (typeof m[k] !== 'string' || m[k].length > 512) throw new AppError('config', '映射字段无效或过长。');
  }
  if (a.manual) validateSnapshot(a.manual);
  if(a.subscription!==undefined){const s=a.subscription;if(!s||typeof s.startedOn!=='string'||typeof s.renewsOn!=='string'||s.startedOn!==''&&!isCalendarDate(s.startedOn)||s.renewsOn!==''&&!isCalendarDate(s.renewsOn)||!['monthly','yearly','custom'].includes(s.cycle)||!Number.isInteger(s.remindDays)||s.remindDays<0||s.remindDays>90)throw new AppError('config','订阅日期无效，提醒天数必须为 0–90。');}
  if(a.appearance!==undefined){
    const v=a.appearance;
    if(!v||typeof v!=='object'||v.backgroundOpacity!==undefined&&(!Number.isFinite(v.backgroundOpacity)||v.backgroundOpacity<0||v.backgroundOpacity>0.2))throw new AppError('config','Logo 背景透明度必须在 0–20% 之间。');
    for(const logo of [v.logo,v.backgroundLogo]){
      if(logo===undefined)continue;
      if(!logo||!['builtin','image','none'].includes(logo.kind))throw new AppError('config','Logo 配置无效。');
      if(logo.kind==='builtin'&&!Object.hasOwn(LOGO_NAMES,logo.name))throw new AppError('config','请选择内置 Logo。');
      if(logo.kind==='image'){
        if(typeof logo.dataUrl!=='string'||logo.dataUrl.length>450000||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(logo.dataUrl))throw new AppError('config','上传 Logo 必须为经过处理的 PNG 图片。');
        try{const decoded=atob(logo.dataUrl.slice(22));const bytes=Uint8Array.from(decoded.slice(0,24),c=>c.charCodeAt(0));const view=new DataView(bytes.buffer);if(bytes.length<24||view.getUint32(16)<1||view.getUint32(20)<1||view.getUint32(16)>256||view.getUint32(20)>256)throw new Error();}catch{throw new AppError('config','Logo 图像尺寸无效，最多 256 × 256。');}
      }
    }
  }
}
export function validateSnapshot(s: unknown): asserts s is import('./types').Snapshot {
  if (!s || typeof s !== 'object') throw new AppError('config', '手动快照无效。');
  const v = s as import('./types').Snapshot;
  if (typeof v.plan !== 'string' || v.plan.length > 300 || !Array.isArray(v.metrics) || v.metrics.length > 100 || !['api','web','manual'].includes(v.source) || !['api','config','unknown'].includes(v.planSource) || typeof v.fetchedAt !== 'string' || !Number.isFinite(Date.parse(v.fetchedAt))) throw new AppError('config', '快照格式无效。');
  for (const m of v.metrics) {
    if (!m || typeof m.label !== 'string' || m.label.length > 300 || typeof m.unit !== 'string' || m.unit.length > 60 || !['5h','week','month','day','balance','other'].includes(m.period)) throw new AppError('config', '额度格式无效。');
    let found = false;
    for (const k of ['remaining','total','remainingPercent','value'] as const) if (m[k] !== undefined) {
      found = true;
      if (!Number.isFinite(m[k]) || (k === 'remainingPercent' && (m[k]! < 0 || m[k]! > 100)) || (k === 'total' && m[k]! < 0)) throw new AppError('config', '额度数值无效，百分比必须在 0–100 之间。');
    }
    if (!found) throw new AppError('config', '每条额度至少需要一个有效数值。');
    if (m.resetsAt !== undefined && (typeof m.resetsAt !== 'string' || !Number.isFinite(Date.parse(m.resetsAt)))) throw new AppError('config', '重置时间无效。');
  }
}
export function validateSettings(v: Settings): void {
  if (!v || ![0,5,15,30,60].includes(v.intervalMinutes) || !Number.isFinite(v.lowThreshold) || v.lowThreshold < 0 || v.lowThreshold > 100 || typeof v.privacy !== 'boolean') throw new AppError('config', '设置值无效。');
}
export function publicAccount(a: Account): Account {
  return { ...a, secret: '', headers: '', hasSecret: !!a.secret, hasHeaders: !!a.headers.trim(), preserveSecret: true, preserveHeaders: true };
}
export function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return '操作未完成，请检查网络或配置后重试。原始响应未写入日志。';
}
