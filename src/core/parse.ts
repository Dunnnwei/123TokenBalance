import type { Account, Metric, MetricMapping, Period, Snapshot } from './types';
import { AppError, validateSnapshot } from './validation';

export function at(root: unknown, path: string): unknown {
  if (!path.trim()) return undefined;
  const parts = path.trim().replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').replace(/\[['"]([^'"\]]+)['"]\]/g, '.$1').split('.').filter(Boolean);
  if (!parts.length) return root;
  let v: unknown = root;
  for (const key of parts) {
    if (['__proto__','prototype','constructor'].includes(key) || !v || typeof v !== 'object' || !Object.hasOwn(v, key)) return undefined;
    v = (v as Record<string, unknown>)[key];
  }
  return v;
}
export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const normalized = v.trim().replace(/[,，\s]/g, '').replace(/[%％]$/, '').replace(/^(CNY|USD|RMB|¥|￥|\$)/i, '');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(normalized)) return undefined;
  const n = Number(normalized); return Number.isFinite(n) ? n : undefined;
}
export function date(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = num(v);
  if (n !== undefined && n <= 0) return undefined;
  const d = n !== undefined ? new Date(n > 1e12 ? n : n * 1000) : typeof v === 'string' ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}
export function percent(n: number): number { return Math.min(100, Math.max(0, n)); }
export function extractedNumber(value: unknown, extract?: string): number | undefined {
  if (!extract) return num(value);
  if (typeof value !== 'string') return num(value);
  if (extract === 'percent') {
    const matches = [...value.matchAll(/([+-]?\d[\d,，]*(?:\.\d+)?)\s*[%％]/g)];
    return matches.length === 1 ? num(matches[0][1]) : undefined;
  }
  if (extract === 'ratio-first' || extract === 'ratio-last') {
    const ratio = value.match(/^\D*?(\d[\d,，]*(?:\.\d+)?)\s*(?:\/|of|out of)\s*(\d[\d,，]*(?:\.\d+)?)\D*$/i);
    return ratio ? num(ratio[extract === 'ratio-first' ? 1 : 2]) : undefined;
  }
  const matches = value.match(/[+-]?\d[\d,，]*(?:\.\d+)?/g);
  return matches?.length === 1 ? num(matches[0]) : undefined;
}
function text(v: unknown): string { return typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 300) : ''; }
function record(v: unknown): Record<string, any> { return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}; }
function array(v: unknown): any[] { return Array.isArray(v) ? v.slice(0, 100) : []; }
export function periodMinutes(n: unknown): Period {
  return n === 300 ? '5h' : n === 10080 ? 'week' : n === 1440 ? 'day' : typeof n === 'number' && n >= 40320 && n <= 44640 ? 'month' : 'other';
}
function remaining(label: string, period: Period, value: unknown, total: unknown, unit = '次', reset?: unknown): Metric | undefined {
  const r = num(value), t = num(total);
  if (r === undefined || (t !== undefined && t < 0)) return undefined;
  return { label, period, remaining: r, total: t, remainingPercent: t && t > 0 ? percent(r / t * 100) : undefined, unit, resetsAt: date(reset) };
}
function pct(label: string, period: Period, value: unknown, reset?: unknown, used = false): Metric | undefined {
  const n = num(value); if (n === undefined || n < 0 || n > 100) return undefined;
  return { label, period, remainingPercent: used ? 100 - n : n, unit: '%', resetsAt: date(reset) };
}
export function mappedSnapshot(a: Account, get: (path: string) => unknown, source: Snapshot['source']): Snapshot {
  const metrics: Metric[] = [];
  for (const m of a.mappings) {
    const value = extractedNumber(get(m.valuePath), m.extract); if (value === undefined) continue;
    const v = value * m.scale, t = extractedNumber(get(m.totalPath), m.totalExtract);
    const total = t === undefined ? undefined : t * m.scale;
    const label = m.label || ({'5h':'5 小时',week:'每周',month:'每月',day:'每日',balance:'余额',other:'额度'}[m.period]);
    const base = { label, period: m.period, unit: m.unit, resetsAt: date(get(m.resetPath)) };
    if (m.kind === 'remainingPercent' || m.kind === 'usedPercent') {
      const item = pct(label, m.period, v, get(m.resetPath), m.kind === 'usedPercent');
      if (!item) throw new AppError('parse', `「${label}」百分比超出 0–100，请检查倍率与字段。`);
      metrics.push(item);
    } else if (m.kind === 'value') metrics.push({ ...base, value: v });
    else if (m.kind === 'used') {
      if (total === undefined || total <= 0) throw new AppError('parse', `「${label}」已用量需要大于 0 的总额度字段。`);
      metrics.push({ ...base, total, remaining: Math.max(0, total - v), remainingPercent: percent((total - v) / total * 100) });
    } else metrics.push({ ...base, total, remaining: v, remainingPercent: total && total > 0 ? percent(v / total * 100) : undefined });
  }
  const apiPlan = text(get(a.planPath));
  return finish(a, apiPlan, metrics, source);
}
function finish(a: Account, apiPlan: string, metrics: (Metric | undefined)[], source: Snapshot['source'] = 'api', note?: string): Snapshot {
  const present = metrics.filter((m): m is Metric => !!m);
  if (!present.length) throw new AppError('parse', '未识别到有效额度。请检查响应字段或网页选择器；未把缺失数据当成 0。');
  const result: Snapshot = { plan: apiPlan || a.plan || '未提供', planSource: apiPlan ? 'api' : a.plan ? 'config' : 'unknown', metrics: present, fetchedAt: new Date().toISOString(), source, note };
  validateSnapshot(result); return result;
}
export function parseJson(a: Account, input: unknown): Snapshot {
  if (a.engine === 'json') return mappedSnapshot(a, path => at(input, path), 'api');
  const r = record(input), d = record(r.data);
  if (r.error || r.success === false || (r.base_resp?.status_code !== undefined && r.base_resp.status_code !== 0) || (d.base_resp?.status_code !== undefined && d.base_resp.status_code !== 0)) throw new AppError('api', '平台返回业务错误，请核对账号凭据与查询权限。');
  const plan = text(r.plan_type ?? r.plan_name ?? r.planName ?? d.planName ?? d.plan_name ?? d.packageName ?? d.current_subscribe_title ?? r.current_subscribe_title ?? d.current_plan_title ?? r.current_plan_title ?? d.current_combo_card?.title);
  let metrics: (Metric | undefined)[] = [];
  switch (a.providerId) {
    case 'codex': {
      for (const [k, label] of [['rate_limit', '订阅'], ['code_review_rate_limit','代码审查']] as const) {
        for (const window of ['primary_window','secondary_window']) {
          const w = record(r[k]?.[window]);
          const mins = num(w.limit_window_seconds);
          const period = periodMinutes(mins === undefined ? undefined : mins / 60);
          metrics.push(pct(label, k === 'code_review_rate_limit' ? 'other' : period, w.used_percent, w.reset_at, true));
        }
      }
      if (num(r.credits?.balance) !== undefined) metrics.push({ label: '额外点数', period: 'other', unit: '点', value: num(r.credits.balance) });
      break;
    }
    case 'claude': case 'claude-web': {
      for (const [key,label,period] of [['five_hour','订阅','5h'],['seven_day','订阅','week'],['seven_day_sonnet','Sonnet 每周','other'],['seven_day_opus','Opus 每周','other'],['seven_day_oauth_apps','OAuth 应用每周','other']] as const) metrics.push(pct(label,period,r[key]?.utilization,r[key]?.resets_at,true));
      if (r.extra_usage?.is_enabled && num(r.extra_usage.monthly_limit) !== undefined && num(r.extra_usage.used_credits) !== undefined) metrics.push(remaining('额外用量月预算', 'other', (num(r.extra_usage.monthly_limit)! - num(r.extra_usage.used_credits)!) / 100, num(r.extra_usage.monthly_limit)! / 100, 'USD'));
      break;
    }
    case 'deepseek':
      for (const b of array(r.balance_infos)) {
        const unit = text(b.currency); if (!['CNY','USD'].includes(unit)) continue;
        metrics.push(remaining('可用余额','balance',b.total_balance,undefined,unit));
        metrics.push(remaining('赠金','other',b.granted_balance,undefined,unit));
        metrics.push(remaining('充值余额','other',b.topped_up_balance,undefined,unit));
      } break;
    case 'moonshot': case 'moonshot-cn': {
      if (r.code !== undefined && ![0,200].includes(r.code)) throw new AppError('api', '平台返回业务错误，请检查 API Key。');
      metrics.push(remaining('可用余额','balance',d.available_balance,undefined,a.providerId === 'moonshot-cn' ? 'CNY' : 'USD')); break;
    }
    case 'siliconflow':
      if (r.code !== undefined && r.code !== 20000 && r.code !== 0) throw new AppError('api','硅基流动返回业务错误，请检查 API Key。');
      metrics.push(remaining('总余额','balance',d.totalBalance,undefined,'CNY'));
      metrics.push(remaining('充值余额','other',d.chargeBalance,undefined,'CNY'));
      metrics.push(remaining('赠送余额','other',d.balance,undefined,'CNY')); break;
    case 'openrouter':
      metrics.push(remaining('Key 预算剩余','balance',d.limit_remaining,d.limit,'USD'));
      if (num(d.usage) !== undefined) metrics.push({ label:'Key 累计已用',period:'other',unit:'USD',value:num(d.usage) });
      break;
    case 'kimi-code': {
      const u = record(r.usage);
      const derive = (o: Record<string, any>) => num(o.remaining) ?? (num(o.limit) !== undefined && num(o.used) !== undefined ? Math.max(0, num(o.limit)! - num(o.used)!) : undefined);
      metrics.push(remaining('订阅','week',derive(u),u.limit,'次',u.resetTime));
      for (const l of array(r.limits)) {
        const w = record(l.window), detail = record(l.detail);
        const mult = w.timeUnit === 'TIME_UNIT_MINUTE' ? 1 : w.timeUnit === 'TIME_UNIT_HOUR' ? 60 : w.timeUnit === 'TIME_UNIT_DAY' ? 1440 : undefined;
        metrics.push(remaining('速率窗口',periodMinutes(mult && num(w.duration)! * mult),derive(detail),detail.limit,'次',detail.resetTime));
      } break;
    }
    case 'gemini':
      for (const b of array(r.buckets)) { const n = num(b.remainingFraction); metrics.push(pct(text(b.modelId) || '模型额度','other', n === undefined ? undefined : n * 100,b.resetTime)); }
      break;
    case 'zhipu': case 'zai': {
      if (r.code !== undefined && r.code !== 200) throw new AppError('api', '平台返回业务错误，请检查 Coding Plan 权限。');
      const mult: Record<number,number> = {1:1440,3:60,5:1,6:10080};
      for (const l of array(d.limits)) {
        if (!['TOKENS_LIMIT','CREDIT_LIMIT','TIME_LIMIT'].includes(l.type)) continue;
        const period = l.type === 'TIME_LIMIT' ? 'other' : periodMinutes(mult[l.unit] * l.number);
        const label = l.type === 'TIME_LIMIT' ? 'MCP 次数' : '订阅';
        const total = num(l.usage), used = num(l.currentValue), rem = num(l.remaining);
        const computed = total && total > 0 && (rem !== undefined || used !== undefined) ? Math.min(rem ?? total, used !== undefined ? total - used : total) : undefined;
        metrics.push(computed !== undefined ? remaining(label,period,Math.max(0,computed),total,l.type === 'CREDIT_LIMIT' ? '点' : '次',l.nextResetTime) : pct(label,period,l.percentage,l.nextResetTime,true));
      } break;
    }
    case 'minimax': case 'minimax-cn': {
      const body = r.model_remains || r.services ? r : d;
      for (const m of array(body.model_remains)) {
        for (const [prefix,period,reset] of [['current_interval','5h','end_time'],['current_weekly','week','weekly_end_time']] as const) {
          const n = num(m[`${prefix}_remaining_percent`]);
          const label = text(m.model_name) || '订阅';
          const total = num(m[`${prefix}_total_count`]);
          if (n !== undefined) metrics.push(pct(label,period,n,m[reset]));
          else if (total !== undefined && total > 0) metrics.push(remaining(label,period,m[`${prefix}_usage_count`],total,'次',m[reset]));
        }
      }
      for (const s of array(body.services)) {
        const total = num(s.limit), used = num(s.usage), label = text(s.service_type) || '服务额度';
        const window = text(s.window_type).toLowerCase();
        const period:Period = /^(5.?hour|5小时|5.?hours)$/.test(window)?'5h':/^(weekly|week|周)$/.test(window)?'week':/^(monthly|month|月)$/.test(window)?'month':/^(daily|day|日)$/.test(window)?'day':'other';
        if(total!==undefined&&total>0&&used!==undefined) metrics.push(remaining(label,period,Math.max(0,total-used),total,'点',s.end_time));
        else metrics.push(pct(label,period,s.percent,s.end_time,true));
      }
      const points = num(body.points_balance ?? body.point_balance ?? body.credits_balance ?? body.credit_balance);
      if(points!==undefined)metrics.push({label:'额外点数',period:'other',unit:'点',value:points});
      break;
    }
    default: throw new AppError('config','此平台使用通用连接器，请选择 JSON、HTML 或网页接入并配置字段。');
  }
  return finish(a, plan, metrics, 'api', a.providerId === 'openrouter' ? '此处为当前 Key 预算，不代表 OpenRouter 账户总余额。' : a.providerId === 'gemini' ? '模型额度周期按服务返回；未假定为 5 小时或周额度。' : undefined);
}
export function selectors(a: Account): string[] {
  return [...new Set([a.planPath, ...a.mappings.flatMap(m => [m.valuePath,m.totalPath,m.resetPath])].filter(Boolean))];
}
export function selectorParts(value: string): { selector: string; attribute?: string } {
  const match = value.match(/^(.*?)::attr\(([a-zA-Z0-9_-]+)\)$/);
  return match ? { selector: match[1], attribute: match[2] } : { selector: value };
}
