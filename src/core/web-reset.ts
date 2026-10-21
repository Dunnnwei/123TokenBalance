/** Web text needs an explicit timezone or an unambiguous countdown. Never infer a weekday. */
export function webReset(value: unknown, now = Date.now()): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const iso = text.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/i)?.[0];
  if (iso && Number.isFinite(Date.parse(iso))) return new Date(iso).toISOString();
  if (!/重置|刷新|恢复|reset|refresh|renew/i.test(text) || !/\bin\s*\d|\d.*(?:后|until)|后.*\d/i.test(text)) return undefined;
  const units = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(days?|hours?|hrs?|minutes?|mins?|seconds?|secs?|[dhms]\b|天|小时|时|分钟|分|秒)/gi)];
  if (!units.length || /\d+\s*[%％]|\d{4}-\d{2}-\d{2}/.test(text)) return undefined;
  const used = new Set<string>(); let seconds = 0;
  for (const [, amount, unit] of units) {
    const key = /^(d|天)/i.test(unit) ? 'd' : /^(h|小时|时)/i.test(unit) ? 'h' : /^(m|分钟|分)/i.test(unit) ? 'm' : 's';
    if (used.has(key)) return undefined;
    used.add(key);seconds += Number(amount) * ({d:86400,h:3600,m:60,s:1}[key]);
  }
  if (seconds > 8 * 86400) return undefined;
  return new Date(now + seconds * 1000).toISOString();
}
