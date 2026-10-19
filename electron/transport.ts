import * as cheerio from 'cheerio';
import type { Account, Snapshot } from '../src/core/types';
import { AppError, parseHeaders, safeUrl, validateAccount } from '../src/core/validation';
import { mappedSnapshot, parseJson, selectorParts } from '../src/core/parse';
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export function requestOptions(a: Account): RequestInit {
  const headers = new Headers({ Accept: a.engine === 'html' ? 'text/html' : 'application/json' });
  for (const [k,v] of Object.entries(parseHeaders(a.headers))) headers.set(k, v);
  if (['bearer','api-key','cookie'].includes(a.auth)) {
    if (!a.secret.trim()) throw new AppError('auth','尚未填写认证信息，请编辑账号并填入 API Key、OAuth Token 或 Cookie。');
    if (a.auth === 'bearer') headers.set('Authorization', `Bearer ${a.secret.trim().replace(/^Bearer\s+/i,'')}`);
    if (a.auth === 'cookie') headers.set('Cookie', a.secret.trim().replace(/^Cookie:\s*/i,''));
    if (a.auth === 'api-key') headers.set(a.authHeader, a.secret.trim());
  }
  if (a.method === 'POST') headers.set('Content-Type', 'application/json');
  return { method: a.method, headers, body: a.method === 'POST' ? a.body || '{}' : undefined, redirect:'manual', credentials: a.auth === 'session' ? 'include' : 'omit', cache:'no-store' };
}
export function parseHtml(a: Account, html: string): Snapshot {
  const $ = cheerio.load(html);
  return mappedSnapshot(a, path => {
    if (!path) return undefined;
    try { const s = selectorParts(path), el = $(s.selector).first(); return s.attribute ? el.attr(s.attribute) : el.text().trim(); }
    catch { throw new AppError('config','CSS 选择器无效，请检查字段映射。'); }
  }, 'web');
}
export function parseSample(a: Account, sample: string): Snapshot {
  if (Buffer.byteLength(sample) > 2 * 1024 * 1024) throw new AppError('config','样本超过 2 MB 限制。');
  if (a.engine === 'html' || a.engine === 'browser') return parseHtml(a, sample);
  let json: unknown; try { json = JSON.parse(sample); } catch { throw new AppError('parse','样本不是有效的 JSON。'); }
  return parseJson(a, json);
}
export async function query(a: Account, fetcher: Fetcher, browserRead: (a: Account) => Promise<Snapshot>): Promise<Snapshot> {
  validateAccount(a);
  if (a.engine === 'manual') {
    if (!a.manual?.metrics.length) throw new AppError('config','尚未填写手动额度。');
    return { ...a.manual, plan: a.plan || a.manual.plan || '未提供', planSource: a.plan ? 'config' : 'unknown', source:'manual' };
  }
  if (a.engine === 'browser') return browserRead(a);
  const url = safeUrl(a.endpoint).toString();
  const options = requestOptions(a), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetcher(url, { ...options, signal: controller.signal });
    if (response.status === 401 || response.status === 403) throw new AppError('auth','授权已失效、权限不足或被平台访问校验拦截，请重新登录或更新凭据。');
    if (response.status === 429) {
      const raw = response.headers.get('retry-after');
      const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : raw ? Math.ceil((Date.parse(raw) - Date.now()) / 1000) : 60;
      throw new AppError('rate','请求过于频繁，已暂缓刷新；到期后可重试。', Number.isFinite(seconds) ? Math.max(30,Math.min(3600,seconds)) : 60);
    }
    if (response.status >= 300 && response.status < 400) throw new AppError('redirect','查询地址发生重定向。请把表单中的地址更新为最终 HTTPS 查询地址，再重新验证认证目标。');
    if (!response.ok) throw new AppError('http', `平台返回 HTTP ${response.status}，请检查查询地址或稍后重试。`);
    if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new AppError('parse','响应过大（超过 2 MB），请改用专用额度查询地址。');
    const reader = response.body?.getReader(); if (!reader) throw new AppError('parse','平台返回空响应。');
    let size = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const {done,value} = await reader.read(); if(done) break; size += value.byteLength; if(size > 2 * 1024 * 1024) { await reader.cancel(); throw new AppError('parse','响应超过 2 MB。'); } chunks.push(value); } } finally { reader.releaseLock(); }
    const content = Buffer.concat(chunks).toString('utf8');
    if (a.engine === 'html') return parseHtml(a, content);
    let data: unknown; try { data = JSON.parse(content); } catch { throw new AppError('parse','查询地址返回的不是 JSON；可能是登录页、验证码或普通网页。可改用网页读取方式。'); }
    return parseJson(a, data);
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (controller.signal.aborted) throw new AppError('timeout','查询超时（20 秒），已保留上次成功的数据。');
    throw new AppError('network','连接失败，请检查网络、系统代理或平台地址。上次成功的数据仍保留。');
  } finally { clearTimeout(timer); }
}
