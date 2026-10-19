import { describe,it,expect } from 'vitest';
import { nextRenewal,isCalendarDate,renewalStatus } from '../../src/core/subscription';
import { validateAccount } from '../../src/core/validation';
import { createAccount } from '../../src/core/providers';
describe('manual renewal records',()=>{
  it('handles month ends without overflowing the next month',()=>{expect(nextRenewal('2026-01-31','monthly')).toBe('2026-02-28');expect(nextRenewal('2026-12-31','monthly')).toBe('2027-01-31');});
  it('handles leap-year annual and monthly renewals',()=>{expect(nextRenewal('2024-02-29','yearly')).toBe('2025-02-28');expect(nextRenewal('2024-01-31','monthly')).toBe('2024-02-29');});
  it('rejects impossible dates',()=>{expect(isCalendarDate('2026-02-29')).toBe(false);expect(isCalendarDate('2026-13-01')).toBe(false);expect(isCalendarDate('2026-04-31')).toBe(false);});
  it('uses local calendar days and recognizes due/overdue/nearby dates',()=>{const now=new Date(2026,9,18,22,59);const status=(renewsOn:string)=>renewalStatus({startedOn:'',renewsOn,cycle:'custom',remindDays:7},now)!;expect(status('2026-10-18').label).toBe('今天续费');expect(status('2026-10-17').days).toBe(-1);expect(status('2026-10-25').attention).toBe(true);expect(status('2026-10-26').attention).toBe(false);});
  it('does not roll an overdue date forward or invent a date',()=>{expect(renewalStatus()).toBeUndefined();expect(nextRenewal('','monthly')).toBe('');expect(nextRenewal('2026-10-01','custom')).toBe('');});
  it('validates dates and reminder bounds',()=>{const a={...createAccount('deepseek'),account:'x',subscription:{startedOn:'2026-02-30',renewsOn:'',cycle:'monthly' as const,remindDays:7}};expect(()=>validateAccount(a)).toThrow('订阅日期');expect(()=>validateAccount({...a,subscription:{...a.subscription,startedOn:'2026-10-01',remindDays:100}})).toThrow('订阅日期');});
});
