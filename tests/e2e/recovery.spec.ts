import {test,expect} from '@playwright/test';
import {_electron,type ElectronApplication,type Page} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {createAccount} from '../../src/core/providers';
import {recognizePage} from '../../src/core/capture';
import type {Account} from '../../src/core/types';

let app:ElectronApplication,page:Page,dataDir:string;
const qa=path.resolve('artifacts/qa');
const url='https://recovery.invalid/usage';
async function launch(override?:string){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await _electron.launch({executablePath:override||process.env.TB_EXECUTABLE||path.resolve('node_modules/electron/dist/electron.exe'),args:[...(override||process.env.TB_EXECUTABLE?[]:[path.resolve('.')]),`--data-dir=${dataDir}`],env:env as Record<string,string>});page=await app.firstWindow();await expect(page.getByRole('heading',{name:'额度总览.'})).toBeVisible();}
async function fixture(options:Record<string,unknown>={}){
  await app.evaluate(({app},options)=>{
    (globalThis as any).__fixture={value:81,layout:1,...options};
    app.on('session-created',s=>s.protocol.handle('https',request=>{
      const f=(globalThis as any).__fixture;
      if(f.network||f.networkOnce){f.networkOnce=false;return new Response('',{status:503});}
      if(f.redirect)return Response.redirect('https://auth.other.invalid/login');
      const email=f.email??'work@example.invalid';
      const body=`<!doctype html><html lang="zh-CN"><title>Fixture AI</title><body><header><span>${email}</span></header><section><h2>Current plan</h2><span>Pro</span></section><main id="root"></main><script>
      const f=${JSON.stringify(f)};
      if(!f.requireSession){document.cookie='fixture_login=kept; Secure; Path=/; Max-Age=604800';localStorage.setItem('fixture_account','work');}
      const valid=!f.expired&&(!f.requireSession||(document.cookie.includes('fixture_login=kept')&&localStorage.getItem('fixture_account')==='work'));
      const card=(name,value,reset,id)=>'<article id="'+id+'"><h2>'+name+'</h2><div><span>Remaining</span><strong>'+value+'%</strong></div><p>'+reset+'</p></article>';
      const render=()=>{const value=f.valueFromCookie?Number(document.cookie.match(/fixture_quota=(\\d+)/)?.[1]):f.value;document.querySelector('#root').innerHTML=valid?(f.layout===2?'<div>新布局</div>':'')+card('5 hour limit',value,'Resets in 2h 30m','five-v'+f.layout)+(f.partial?'':card('Weekly limit',63,'Resets at 2026-11-01T10:00:00+08:00','week-v'+f.layout)):'<h1>Sign in</h1><p>登录已过期</p>';};
      setTimeout(render,f.delay??0);
      </script></body></html>`;
      return new Response(body,{headers:{'content-type':'text/html; charset=utf-8'}});
    }));
  },options);
}
async function change(options:Record<string,unknown>){await app.evaluate((_e,options)=>Object.assign((globalThis as any).__fixture,options),options);}
async function beginCapture(target?:Account){
  if(target){await page.getByRole('button',{name:`${target.platformName} ${target.account}`,exact:true}).click();await page.getByRole('button',{name:'程序内打开并重新抓取',exact:true}).click();}
  else {await page.getByRole('button',{name:'网页快速添加',exact:true}).first().click();await page.getByLabel('能看到订阅或余额信息的网址').fill(url);}
  const created=app.waitForEvent('window');await page.getByRole('button',{name:'打开订阅页面',exact:true}).click();const toolbar=await created;
  await expect(toolbar.getByRole('button',{name:'一键抓取',exact:true})).toBeEnabled();
  await expect.poll(()=>app.evaluate(({webContents})=>webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://recovery.invalid'))?.executeJavaScript('!!document.querySelector("#root article")'))).toBe(true);
  await toolbar.getByRole('button',{name:'一键抓取',exact:true}).click();await expect(page.locator('.capture-review')).toBeVisible();return toolbar;
}
async function addExisting(extra:Partial<Account>={}){
  const result=recognizePage({url,title:'Fixture',fields:[{text:'work@example.invalid',selector:'#email',context:'Account'},{text:'80%',context:'5 hours remaining 80%',selector:'#five'},{text:'70%',context:'Weekly remaining 70%',selector:'#week'}]},'fixture');
  const draft:Account={...result.draft,account:'我的工作账号',browserIdentity:'work@example.invalid',appearance:{logo:{kind:'builtin',name:'kimi'}},subscription:{startedOn:'2026-10-01',renewsOn:'2026-11-01',cycle:'monthly',remindDays:7},...extra};
  await page.evaluate(a=>window.tokenBalance.save(a),draft);
  return (await page.evaluate(()=>window.tokenBalance.state())).accounts[0];
}
test.beforeEach(async()=>{fs.mkdirSync(qa,{recursive:true});dataDir=fs.mkdtempSync(path.join(qa,'recovery-data-'));await launch();await page.evaluate(async()=>{const s=await window.tokenBalance.state();await window.tokenBalance.settings({...s.settings,intervalMinutes:0});});});
test.afterEach(async()=>{await app?.close();});

test('round 1: closing capture and restarting keeps the account session usable without an open website',async()=>{
  await fixture();const toolbar=await beginCapture();await expect(page.locator('.capture-review')).toContainText('81%');await expect(page.locator('.capture-review')).toContainText('63%');await expect(page.locator('.capture-review')).toContainText('重置');
  await page.getByRole('button',{name:'保存并添加账号',exact:true}).click();const original=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];await toolbar.close();
  await change({value:47,layout:2,requireSession:true});await page.evaluate(()=>window.tokenBalance.refresh());let a=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];expect(a.status).toBe('ok');expect(a.snapshot?.metrics[0].remainingPercent).toBe(47);expect(a.snapshot?.metrics[1].resetsAt).toBe('2026-11-01T02:00:00.000Z');expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1);
  await app.close();await launch();await fixture({value:32,layout:2,requireSession:true});await page.evaluate(()=>window.tokenBalance.refresh());a=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];expect(a.id).toBe(original.id);expect(a.status).toBe('ok');expect(a.snapshot?.metrics[0].remainingPercent).toBe(32);await page.screenshot({path:path.join(qa,'round1-background-restored.png')});
});
test('round 1: detail recovery updates original account and preserves custom metadata',async()=>{
  const previous=await addExisting();await fixture();const toolbar=await beginCapture(previous);await expect(page.getByRole('dialog')).toContainText('将更新原账号');await page.getByRole('button',{name:'更新原账号',exact:true}).click();const accounts=(await page.evaluate(()=>window.tokenBalance.state())).accounts;expect(accounts).toHaveLength(1);expect(accounts[0].id).toBe(previous.id);expect(accounts[0].revision).toBe(previous.revision+1);expect(accounts[0].account).toBe(previous.account);expect(accounts[0].appearance).toEqual(previous.appearance);expect(accounts[0].subscription).toEqual(previous.subscription);await toolbar.close();await page.evaluate(()=>window.tokenBalance.refresh());expect((await page.evaluate(()=>window.tokenBalance.state())).accounts[0].status).toBe('ok');
});
test('round 1: homepage capture suggests exact identity and merges without creating a duplicate',async()=>{
  const previous=await addExisting();await fixture();const toolbar=await beginCapture();await expect(page.getByRole('combobox',{name:'保存到哪个账号'})).toContainText(previous.account);await page.screenshot({path:path.join(qa,'round1-merge-confirmation.png')});await page.getByRole('button',{name:'更新原账号',exact:true}).click();await toolbar.close();await change({value:44,requireSession:true});await page.evaluate(()=>window.tokenBalance.refresh());const accounts=(await page.evaluate(()=>window.tokenBalance.state())).accounts;expect(accounts).toHaveLength(1);expect(accounts[0].id).toBe(previous.id);expect(accounts[0].browserSessionId).not.toBe(previous.id);expect(accounts[0].status).toBe('ok');expect(accounts[0].snapshot?.metrics[0].remainingPercent).toBe(44);
  await app.close();await launch();await fixture({value:29,requireSession:true});await page.evaluate(()=>window.tokenBalance.refresh());expect((await page.evaluate(()=>window.tokenBalance.state())).accounts[0].snapshot?.metrics[0].remainingPercent).toBe(29);
});
test('round 1: account editor contains a direct in-app recovery action',async()=>{
  const a=await addExisting();await page.getByRole('button',{name:`${a.account} 操作`,exact:true}).click();await page.getByRole('menuitem',{name:'编辑账号',exact:true}).click();await expect(page.getByRole('button',{name:'程序内打开并重新抓取',exact:true})).toBeVisible();await page.getByRole('button',{name:'程序内打开并重新抓取',exact:true}).click();await expect(page.getByRole('heading',{name:'重新抓取原账号',exact:true})).toBeVisible();
});

test('round 2: delayed DOM and changed selectors still refresh; incomplete data preserves the successful snapshot',async()=>{
  await fixture();const toolbar=await beginCapture();await page.getByRole('button',{name:'保存并添加账号',exact:true}).click();await toolbar.close();await change({value:36,layout:2,delay:1800,requireSession:true});await page.evaluate(()=>window.tokenBalance.refresh());let a=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];expect(a.status).toBe('ok');expect(a.snapshot?.metrics[0].remainingPercent).toBe(36);const old=a.snapshot;
  await change({partial:true,delay:0});await page.evaluate(()=>window.tokenBalance.refresh());a=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];expect(a.status).toBe('error');expect(a.error).toContain('周');expect(a.snapshot).toEqual(old);await page.getByRole('button',{name:'查看原因',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('以下为上次成功数据');await page.screenshot({path:path.join(qa,'round2-incomplete-retains-old.png')});
});
test('round 2: expired login exposes recovery and never replaces old usage with a login page',async()=>{
  await fixture();const toolbar=await beginCapture();await page.getByRole('button',{name:'保存并添加账号',exact:true}).click();await toolbar.close();const old=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0].snapshot;await change({expired:true});await page.evaluate(()=>window.tokenBalance.refresh());const a=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];expect(a.status).toBe('error');expect(a.snapshot).toEqual(old);await page.getByRole('button',{name:'查看原因',exact:true}).click();await expect(page.getByRole('button',{name:'程序内打开并重新抓取',exact:true})).toBeVisible();
});
test('round 2: wrong visible identity is rejected and late capture cannot overwrite edits',async()=>{
  const a=await addExisting();await fixture({email:'other@example.invalid'});let toolbar=await beginCapture(a);await page.getByRole('button',{name:'更新原账号',exact:true}).click();await expect(page.getByRole('alert')).toContainText('邮箱');expect((await page.evaluate(()=>window.tokenBalance.state())).accounts[0].revision).toBe(1);await page.getByRole('button',{name:'取消',exact:true}).click();
  await change({email:'work@example.invalid'});toolbar=await beginCapture(a);await page.evaluate(async()=>{const a=(await window.tokenBalance.state()).accounts[0];await window.tokenBalance.save({...a,account:'另一次修改'});});await page.getByRole('button',{name:'更新原账号',exact:true}).click();await expect(page.getByRole('alert')).toContainText('修改或删除');expect((await page.evaluate(()=>window.tokenBalance.state())).accounts[0].account).toBe('另一次修改');
});
test('round 2: clearing the saved merged session actually requires login on next refresh',async()=>{
  await fixture();const toolbar=await beginCapture();await page.getByRole('button',{name:'保存并添加账号',exact:true}).click();await toolbar.close();const a=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];await page.evaluate(id=>window.tokenBalance.clearSession(id),a.id);await change({requireSession:true});await page.evaluate(()=>window.tokenBalance.refresh());expect((await page.evaluate(()=>window.tokenBalance.state())).accounts[0].status).toBe('error');
});
test('round 2: two accounts keep separate cookies over repeated concurrent refreshes and restart',async()=>{
  await fixture({valueFromCookie:true});
  const ids:string[]=[];
  for(const name of ['独立甲','独立乙']){const draft:Account={...createAccount('custom'),account:name,platformName:'Fixture',website:'https://recovery.invalid',infoUrl:url,engine:'browser',auth:'session',browserRecognition:true,browserAutoRefresh:true};await page.evaluate(a=>window.tokenBalance.save(a),draft);ids.push((await page.evaluate(()=>window.tokenBalance.state())).accounts.at(-1)!.id);}
  await app.evaluate(async({session},ids)=>{for(let i=0;i<ids.length;i++)await session.fromPartition('persist:account-'+ids[i]).cookies.set({url:'https://recovery.invalid',name:'fixture_quota',value:String(i===0?26:73),secure:true,expirationDate:Date.now()/1000+604800});},ids);
  for(let attempt=0;attempt<5;attempt++)await page.evaluate(()=>window.tokenBalance.refresh());
  let accounts=(await page.evaluate(()=>window.tokenBalance.state())).accounts;expect(accounts.map(a=>a.snapshot?.metrics[0].remainingPercent)).toEqual([26,73]);expect(accounts.every(a=>a.status==='ok')).toBe(true);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1);
  await app.close();await launch();await fixture({valueFromCookie:true});await page.evaluate(()=>window.tokenBalance.refresh());accounts=(await page.evaluate(()=>window.tokenBalance.state())).accounts;expect(accounts.map(a=>a.snapshot?.metrics[0].remainingPercent)).toEqual([26,73]);
});
test('round 2: temporary HTTP failure recovers once, sustained failure retains the original snapshot',async()=>{
  await fixture();const toolbar=await beginCapture();await page.getByRole('button',{name:'保存并添加账号',exact:true}).click();await toolbar.close();await change({networkOnce:true,value:52});await page.evaluate(()=>window.tokenBalance.refresh());let a=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];expect(a.status).toBe('ok');expect(a.snapshot?.metrics[0].remainingPercent).toBe(52);const previous=a.snapshot;
  await change({network:true});await page.evaluate(()=>window.tokenBalance.refresh());a=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];expect(a.status).toBe('error');expect(a.error).toContain('503');expect(a.snapshot).toEqual(previous);
});
test('round 3: table and recovery confirmation fit dark narrow windows and keyboard controls',async()=>{
  const a=await addExisting();await fixture();await page.setViewportSize({width:940,height:760});await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.getByRole('radio',{name:'深色',exact:true}).click();await page.getByRole('button',{name:'额度总览',exact:false}).first().click();await beginCapture(a);await expect(page.getByRole('button',{name:'更新原账号',exact:true})).toBeVisible();await page.screenshot({path:path.join(qa,'round3-dark-recovery-confirmation.png')});await page.getByRole('button',{name:'更新原账号',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);await page.screenshot({path:path.join(qa,'round3-dark-narrow.png')});
});
test('round 3: upgrading actual 1.2.0 encrypted data preserves identity, credentials and metadata',async()=>{
  await app.close();await launch(path.resolve('发布/123TokenBalance-1.2.0-win-x64/123TokenBalance.App.exe'));expect((await page.evaluate(()=>window.tokenBalance.state())).version).toBe('1.2.0');
  const draft:Account={...createAccount('deepseek'),account:'1.2.0 虚构迁移账号',secret:'legacy-120-dummy-key',headers:'{"X-Project":"legacy-120-dummy-header"}',enabled:false,appearance:{logo:{kind:'builtin',name:'kimi'}},subscription:{startedOn:'2026-10-01',renewsOn:'2026-11-01',cycle:'monthly',remindDays:7}};
  await page.evaluate(a=>window.tokenBalance.save(a),draft);const original=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];await app.close();await launch();const state=await page.evaluate(()=>window.tokenBalance.state());expect(state.version).toBe('1.3.0');expect(state.readOnly).toBe(false);expect(state.accounts[0].id).toBe(original.id);expect(state.accounts[0].appearance).toEqual(original.appearance);expect(state.accounts[0].subscription).toEqual(original.subscription);expect(await page.evaluate(a=>window.tokenBalance.reveal(a.id,a.revision),state.accounts[0])).toEqual({secret:draft.secret,headers:draft.headers});
});
