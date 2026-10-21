import { describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAccount } from '../../src/core/providers';
import { recognizePage } from '../../src/core/capture';
import { webReset } from '../../src/core/web-reset';
import { assertIdentity,requireComplete,suggestedCaptureTarget } from '../../src/core/capture-account';
import { AccountService } from '../../electron/service';
import { AppError } from '../../src/core/validation';
import type { RepositoryLike } from '../../electron/repository';
import { DEFAULT_SETTINGS,type Account,type Snapshot } from '../../src/core/types';

const capture=(identity='work@example.invalid')=>recognizePage({url:'https://fixture.invalid/usage',title:'Fixture',fields:[{text:identity,selector:'#email',context:'Account'},{text:'80%',selector:'#five',context:'5 hours remaining 80%'},{text:'60%',selector:'#week',context:'Weekly remaining 60%'}]},randomUUID());
const fixture=()=>{const a:Account={...capture().draft,id:randomUUID(),revision:1,account:'工作账号',browserIdentity:'work@example.invalid',snapshot:capture().snapshot,appearance:{logo:{kind:'builtin',name:'kimi'}},subscription:{startedOn:'2026-10-01',renewsOn:'2026-11-01',cycle:'monthly',remindDays:7}};const repo:RepositoryLike={data:{schema:1,accounts:[a],settings:{...DEFAULT_SETTINGS}},commit(next){this.data=next;}};return repo;};
describe('capture updates preserve stable identity',()=>{
  it('updates original UUID, ordering, name, appearance and subscription with an independent session',()=>{const repo=fixture(),previous=structuredClone(repo.data.accounts[0]),s=new AccountService(repo,async()=>capture().snapshot),result=capture();s.saveCapture(result,result.id,'changed name','Pro',previous.id,1);const a=repo.data.accounts[0];expect(repo.data.accounts).toHaveLength(1);expect(a.id).toBe(previous.id);expect(a.revision).toBe(2);expect(a.account).toBe(previous.account);expect(a.appearance).toEqual(previous.appearance);expect(a.subscription).toEqual(previous.subscription);expect(a.browserSessionId).toBe(result.id);});
  it('rejects changed or deleted original account',()=>{const repo=fixture(),s=new AccountService(repo,async()=>capture().snapshot),result=capture(),id=repo.data.accounts[0].id;expect(()=>s.saveCapture(result,result.id,'work','',id,0)).toThrow('修改或删除');s.remove(id);expect(()=>s.saveCapture(result,result.id,'work','',id,1)).toThrow('修改或删除');expect(repo.data.accounts).toHaveLength(0);});
  it('rejects a different visible identity and different website',()=>{const repo=fixture(),a=repo.data.accounts[0];expect(()=>assertIdentity(a,capture('other@example.invalid').draft)).toThrow('邮箱');expect(()=>assertIdentity(a,{...capture().draft,infoUrl:'https://other.invalid'})).toThrow('平台');});
  it('allows the original Claude API record to reconnect through its own web provider',()=>{expect(()=>assertIdentity({...fixture().data.accounts[0],providerId:'claude',infoUrl:'https://claude.ai/settings/usage'},{...capture().draft,providerId:'claude-web',infoUrl:'https://claude.ai/settings/usage'})).not.toThrow();});
  it('suggests only a unique exact visible email, never same-platform notes',()=>{const repo=fixture(),a=repo.data.accounts[0],result=capture();expect(suggestedCaptureTarget([a],result)?.id).toBe(a.id);expect(suggestedCaptureTarget([{...a,browserIdentity:undefined}],result)).toBeUndefined();expect(suggestedCaptureTarget([a,{...a,id:randomUUID()}],result)).toBeUndefined();});
  it('cannot turn balance-only capture into a successful complete usage update',()=>{const repo=fixture(),a=repo.data.accounts[0],result=capture();result.snapshot.metrics=[{label:'余额',period:'balance',unit:'USD',remaining:5}];expect(()=>new AccountService(repo,async()=>result.snapshot).saveCapture(result,result.id,'work','',a.id,1)).toThrow('5 小时、周');expect(a.snapshot?.metrics).toHaveLength(2);});
  it('backup import gives new UUID and drops private browser partition reference',()=>{const repo=fixture();repo.data.accounts[0].browserSessionId=randomUUID();const s=new AccountService(repo,async()=>capture().snapshot);s.import(structuredClone(repo.data));expect(repo.data.accounts[1].browserSessionId).toBeUndefined();expect(repo.data.accounts[1].id).not.toBe(repo.data.accounts[0].id);});
});
describe('complete refresh and bounded recovery',()=>{
  it('keeps original timestamp and all old periods on partial response',async()=>{const repo=fixture(),old=structuredClone(repo.data.accounts[0].snapshot),partial={...capture().snapshot,metrics:[capture().snapshot.metrics[0]]};await new AccountService(repo,async()=>partial).refresh();expect(repo.data.accounts[0].status).toBe('error');expect(repo.data.accounts[0].snapshot).toEqual(old);expect(repo.data.accounts[0].error).toContain('周');});
  it('does not retry expired authorization',async()=>{const repo=fixture(),run=vi.fn(async()=>{throw new AppError('auth','登录已失效');});await new AccountService(repo,run).refresh();expect(run).toHaveBeenCalledTimes(1);});
  it('retries a transient network failure only once',async()=>{const repo=fixture(),run=vi.fn().mockRejectedValueOnce(new AppError('network','offline')).mockResolvedValue(capture().snapshot);await new AccountService(repo,run).refresh();expect(run).toHaveBeenCalledTimes(2);expect(repo.data.accounts[0].status).toBe('ok');});
  it('never fills an unprovided week with zero',()=>expect(()=>requireComplete(fixture().data.accounts[0],{...capture().snapshot,metrics:[]})).toThrow('保留'));
});
describe('conservative reset times',()=>{
  const now=Date.parse('2026-10-21T04:00:00Z');
  it.each([['Resets in 2h 30m',9000],['2小时30分钟后重置',9000],['Resets in 1 day 3 hours',97200],['0 分钟后刷新',0]])('anchors %s to collection time',(text,seconds)=>expect(webReset(text,now)).toBe(new Date(now+seconds*1000).toISOString()));
  it.each(['Resets Friday at 10:00','重置 周五 10:00','2026-10-22 10:00','5 小时额度 50%','Resets in 9 days','Resets in 2h or 3h'])('leaves ambiguous time absent: %s',text=>expect(webReset(text,now)).toBeUndefined());
  it('accepts explicit timezone dates without shifting the instant',()=>expect(webReset('重置 2026-10-22T10:30:00+08:00',now)).toBe('2026-10-22T02:30:00.000Z'));
  it('attaches distinct reset fields to their own quota cards',()=>{const r=recognizePage({url:'https://fixture.invalid',title:'x',fields:[{text:'80%',context:'5 hours remaining 80% Resets in 2h',selector:'#five',group:'#five-card'},{text:'Resets in 2h',context:'5 hours remaining 80% Resets in 2h',selector:'#five-reset',group:'#five-card'},{text:'60%',context:'Weekly remaining 60%',selector:'#week',group:'#week-card'},{text:'重置 2026-10-24T10:00:00+08:00',context:'Weekly reset',selector:'#week-reset',group:'#week-card'}]},'id');expect(r.snapshot.metrics).toHaveLength(2);expect(r.snapshot.metrics.every(m=>m.resetsAt)).toBe(true);expect(r.snapshot.metrics[1].resetsAt).toBe('2026-10-24T02:00:00.000Z');});
});
